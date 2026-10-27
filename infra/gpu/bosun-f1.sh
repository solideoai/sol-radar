#!/usr/bin/env bash
# SOL RADAR — Bosun v3.1 0.6B LoRA F1-B 메모리·step 시간 smoke (회사 GPU 서버, 물리 GPU 1 **공유**, 기본 20 step).
# 정본: docs/16-DECISIONS.md ADR-034 상세 7·10번, docs/22-FINETUNE-RUNBOOK.md §4.2·§4.3.
# 결과는 docs/evidence/bosun-train-feasibility.md 에 옮긴다(Kev 기록은 개서하지 않는다). Kev 용 kev-f1.sh 는 보존·퇴역(수정하지 않는다).
#
# 사용(서버 셸):
#   export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1
#   SOL_GPU_SHARE_APPROVED=1 bash infra/gpu/bosun-preflight.sh          # 먼저. 표식 $SOL_RUNS_DIR/bosun-preflight-ok 를 남긴다
#   SOL_GPU_SHARE_APPROVED=1 SOL_TRAIN_APPROVED=1 bash infra/gpu/bosun-f1.sh                      # 격자 1: batch 1 · accum 8
#   SOL_GPU_SHARE_APPROVED=1 SOL_TRAIN_APPROVED=1 bash infra/gpu/bosun-f1.sh --batch 2 --accum 4   # 격자 2: 앞 칸 PASS 뒤에만
# 옵션: --max-steps N(20) --batch B(1) --accum A(8) --max-state-tokens N(6144) --tag 이름(기본 b<B>a<A>-ms<N>) --no-parity
# 환경 변수(SOL_WORK·SOL_GPU_INDEX·SOL_BOSUN_VENV·SOL_REPO·SOL_REGISTRY·HF_HOME·SOL_BOSUN_REV·SOL_BOSUN_BASE_REV·SOL_TRAIN_DATA·
#   SOL_RUNS_DIR·SOL_REQUIRED_MIB·SOL_RESERVE_MIB)는 bosun-preflight.sh 와 같다. 추가:
#   SOL_GPU_SHARE_APPROVED  1 이어야 시작(회사 GPU 1 공유 승인 확인)
#   SOL_TRAIN_APPROVED      1 이어야 시작(사용자의 GPU 학습 승인. ADR-034 10번 "GPU 학습은 사용자 승인 전까지 하지 않는다")
#   SOL_MEM_BUDGET_MIB      기본 = 시작 직전 memory.free − SOL_RESERVE_MIB(3000). 학습 중 "GPU 전체 memory.used 최대 − 시작 직전 used"
#                           (= 우리 프로세스가 더 쓴 최대)가 이 값을 넘으면 FAIL. 공유 상태 기준이라 Kev 판의 41,000 MiB 는 쓰지 않는다
#
# 승인 둘 중 하나라도 없으면 "승인 전 실행 금지" 로 멈춘다. 하지 않는 것: 다른 프로세스 종료(kill·pkill·killall 을 쓰지 않는다 —
# 자기 기록 프로세스도 정지 파일로 멈춘다), docker compose down, 기존 run 폴더 덮어쓰기·삭제, GPU 0·2 사용, 네트워크 다운로드(HF_HUB_OFFLINE=1).
# 실행 직전에 패키지의 adapter/adapter_model.safetensors·decision_embeddings.safetensors sha256 을 registry.yaml 값과 다시 대조하고
# 다르면 시작하지 않는다. 학습기 CLI(`python -m sol_decision.train …`)와 parity(`python -m sol_decision.parity …`)는 다른 작업자가
# 만들고 있다. 인자 이름·로그 줄 형식의 미세 차이는 F1 전에 여기와 맞춘다(아래 "학습기 인터페이스"·"로그 파싱" 주석).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOL_WORK="${SOL_WORK:-/data/www/ai_workspace/sol-radar}"
SOL_GPU_INDEX="${SOL_GPU_INDEX:-1}"
SOL_BOSUN_VENV="${SOL_BOSUN_VENV:-$SOL_WORK/.venv-bosun}"
SOL_REPO="${SOL_REPO:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
SOL_REGISTRY="${SOL_REGISTRY:-$SOL_REPO/services/ai/models/registry.yaml}"
export HF_HOME="${HF_HOME:-$SOL_WORK/hf}"
export HF_HUB_OFFLINE=1
SOL_BOSUN_REV="${SOL_BOSUN_REV:-5e78a37c8d86860ebac9ef2d5327d6299498498e}"
SOL_BOSUN_BASE_REV="${SOL_BOSUN_BASE_REV:-c1899de289a04d12100db370d81485cdf75e47ca}"
SOL_TRAIN_DATA="${SOL_TRAIN_DATA:-$SOL_WORK/sol-dataset-v0.1/bosun/train.en.jsonl}"
SOL_RUNS_DIR="${SOL_RUNS_DIR:-$SOL_WORK/runs}"
SOL_RESERVE_MIB="${SOL_RESERVE_MIB:-3000}"
SOL_REQUIRED_MIB="${SOL_REQUIRED_MIB:-16000}"
SOL_MEM_BUDGET_MIB="${SOL_MEM_BUDGET_MIB:-}"
SOL_GPU_SHARE_APPROVED="${SOL_GPU_SHARE_APPROVED:-}"
SOL_TRAIN_APPROVED="${SOL_TRAIN_APPROVED:-}"
export CUDA_DEVICE_ORDER="${CUDA_DEVICE_ORDER:-PCI_BUS_ID}"

BOSUN_ID="bosun-v3.1-0.6b"
BOSUN_SNAP="$HF_HOME/hub/models--Hanno-Labs--bosun-v3.1-0.6b/snapshots/$SOL_BOSUN_REV"
BASE_SNAP="$HF_HOME/hub/models--Qwen--Qwen3-0.6B/snapshots/$SOL_BOSUN_BASE_REV"
ADAPTER_REL="adapter/adapter_model.safetensors"
EMB_REL="decision_embeddings.safetensors"

MAX_STEPS=20 BATCH=1 ACCUM=8 MAX_STATE=6144 TAG="" PARITY=1
while [ $# -gt 0 ]; do
  case "$1" in
    --max-steps) MAX_STEPS="$2"; shift 2 ;;
    --batch) BATCH="$2"; shift 2 ;;
    --accum) ACCUM="$2"; shift 2 ;;
    --max-state-tokens) MAX_STATE="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --no-parity) PARITY=0; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "모르는 옵션: $1 (--help)" >&2; exit 2 ;;
  esac
done
for v in "$MAX_STEPS" "$BATCH" "$ACCUM" "$MAX_STATE" "$SOL_RESERVE_MIB" "$SOL_REQUIRED_MIB" "${SOL_MEM_BUDGET_MIB:-0}"; do
  case "$v" in ''|*[!0-9]*) echo "숫자가 아닌 인자: '$v'" >&2; exit 2 ;; esac
done
[ "$MAX_STEPS" -ge 1 ] && [ "$BATCH" -ge 1 ] && [ "$ACCUM" -ge 1 ] && [ "$MAX_STATE" -ge 1 ] || { echo "--max-steps·--batch·--accum·--max-state-tokens 는 1 이상" >&2; exit 2; }
# --tag 는 run 이름의 일부다. 경로 문자(/ ..)·공백을 받지 않는다(runs/ 밖으로 나가지 못하게)
TAG="${TAG:-b${BATCH}a${ACCUM}-ms${MAX_STATE}}"
if ! printf '%s' "$TAG" | grep -qE '^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$'; then
  echo "--tag 는 영문·숫자로 시작하는 [A-Za-z0-9._-] 1~41자만 된다: '$TAG'" >&2; exit 2
fi

die() { echo "중단: $*" >&2; exit 1; }
sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
mark_val() { sed -n "s/^$1=//p" "$MARK" | head -1; }

# ── 승인: 둘 다 있어야 GPU 를 쓴다 ─────────────────────────────────────────────────────────────────────────
[ "$SOL_GPU_SHARE_APPROVED" = "1" ] && [ "$SOL_TRAIN_APPROVED" = "1" ] || die "승인 전 실행 금지: SOL_GPU_SHARE_APPROVED=1(회사 GPU $SOL_GPU_INDEX 공유 승인)과 SOL_TRAIN_APPROVED=1(사용자 학습 승인) 둘 다 있어야 시작한다(현재 share='${SOL_GPU_SHARE_APPROVED:-<없음>}' train='${SOL_TRAIN_APPROVED:-<없음>}'. ADR-034 10번)"

# ── 사전 조건: GPU 선택, preflight 표식, venv, 데이터, nvidia-smi, GPU 동일성 ─────────────────────────────────
case " $SOL_GPU_INDEX " in *" 0 "*|*" 2 "*) die "SOL_GPU_INDEX=$SOL_GPU_INDEX 는 회사 서비스 GPU 다. 0·2 는 어떤 경우에도 쓰지 않는다" ;; esac
[ "${CUDA_VISIBLE_DEVICES:-}" = "$SOL_GPU_INDEX" ] || die "CUDA_VISIBLE_DEVICES 가 정확히 '$SOL_GPU_INDEX' 이 아니다(현재 '${CUDA_VISIBLE_DEVICES:-<없음>}'). export CUDA_VISIBLE_DEVICES=$SOL_GPU_INDEX"
[ "$CUDA_DEVICE_ORDER" = "PCI_BUS_ID" ] || die "CUDA_DEVICE_ORDER 가 PCI_BUS_ID 가 아니다"
MARK="$SOL_RUNS_DIR/bosun-preflight-ok"
[ -f "$MARK" ] || die "preflight 통과 표식이 없다($MARK). 먼저 SOL_GPU_SHARE_APPROVED=1 bash infra/gpu/bosun-preflight.sh"
[ "$(mark_val model_load_checked)" = "1" ] || die "preflight 가 --skip-load 로 통과했다(모델 로드·LoRA 텐서 수 미확인). F1 전에는 --skip-load 없이 다시 통과해야 한다"
PY="$SOL_BOSUN_VENV/bin/python"
[ -x "$PY" ] || die "venv python 이 없다: $PY"
[ -f "$SOL_TRAIN_DATA" ] || die "학습 데이터가 없다: $SOL_TRAIN_DATA"
command -v nvidia-smi >/dev/null 2>&1 || die "nvidia-smi 가 없다"
GPU_UUID="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=uuid --format=csv,noheader | tr -d ' ')"
MARK_UUID="$(mark_val gpu_uuid)"
[ -n "$GPU_UUID" ] && [ "$GPU_UUID" = "$MARK_UUID" ] || die "GPU $SOL_GPU_INDEX uuid($GPU_UUID)가 preflight 때($MARK_UUID)와 다르다. preflight 를 다시"
[ "$(mark_val venv)" = "$SOL_BOSUN_VENV" ] || die "preflight 표식의 venv($(mark_val venv))가 지금 값($SOL_BOSUN_VENV)과 다르다. preflight 를 다시"

# ── GPU 1 상태(기록만. 다른 프로세스는 FAIL 사유도 종료 대상도 아니다) ─────────────────────────────────────────
APPS="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>/dev/null || true)"
FREE_MIB="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=memory.free --format=csv,noheader,nounits | tr -d ' ')"
PRE_USED_MIB="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=memory.used --format=csv,noheader,nounits | tr -d ' ')"
TOTAL_MIB="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=memory.total --format=csv,noheader,nounits | tr -d ' ')"
case "$FREE_MIB$PRE_USED_MIB$TOTAL_MIB" in ''|*[!0-9]*) die "nvidia-smi 메모리 값을 읽지 못했다(free='$FREE_MIB' used='$PRE_USED_MIB' total='$TOTAL_MIB')" ;; esac
[ "$FREE_MIB" -ge "$SOL_REQUIRED_MIB" ] || die "GPU $SOL_GPU_INDEX free ${FREE_MIB} MiB < 필요 ${SOL_REQUIRED_MIB} MiB (preflight 뒤 다른 작업이 늘었다. 종료하지 말고 회사에 확인)"
if [ -z "$SOL_MEM_BUDGET_MIB" ]; then
  SOL_MEM_BUDGET_MIB=$((FREE_MIB - SOL_RESERVE_MIB))
  BUDGET_NOTE="기본: free ${FREE_MIB} − 여유 ${SOL_RESERVE_MIB}"
else
  BUDGET_NOTE="SOL_MEM_BUDGET_MIB 로 지정"
fi
[ "$SOL_MEM_BUDGET_MIB" -gt 0 ] || die "메모리 예산이 0 이하다(free ${FREE_MIB} − 여유 ${SOL_RESERVE_MIB}). 시작하지 않는다"

# ── 레지스트리·패키지: 기대 sha256 을 registry.yaml 에서 다시 읽고, 표식 값과 같은지, 파일이 지금도 같은지(실행 직전 재대조) ─────
[ -f "$SOL_REGISTRY" ] || die "registry.yaml 이 없다: $SOL_REGISTRY"
REG_BLOCK="$(awk -v id="$BOSUN_ID" '
  /^[[:space:]]*- id:/ { v = $0; sub(/^[[:space:]]*- id:[[:space:]]*/, "", v); sub(/[[:space:]]*(#.*)?$/, "", v); inblk = (v == id) }
  inblk { print }' "$SOL_REGISTRY")"
[ -n "$REG_BLOCK" ] || die "registry.yaml 에 '$BOSUN_ID' 항목이 없다"
reg_val() {
  printf '%s\n' "$REG_BLOCK" | awk -v k="$1" '
    { line = $0; sub(/^[ \t]+/, "", line) }
    index(line, k ":") == 1 {
      v = substr(line, length(k) + 2); sub(/^[ \t]+/, "", v); sub(/[ \t]+#.*$/, "", v)
      gsub(/^["\x27]|["\x27]$/, "", v); print v; exit }'
}
REG_ADAPTER_SHA="$(reg_val lora)"
REG_EMB_SHA="$(reg_val decision_embeddings_sha256)"
REG_REV="$(reg_val revision)"
printf '%s' "$REG_ADAPTER_SHA" | grep -qE '^[0-9a-f]{64}$' || die "registry lora(어댑터 sha256)가 없다"
printf '%s' "$REG_EMB_SHA" | grep -qE '^[0-9a-f]{64}$' || die "registry decision_embeddings_sha256 가 없다"
[ "$REG_REV" = "$SOL_BOSUN_REV" ] || die "registry revision($REG_REV)과 SOL_BOSUN_REV($SOL_BOSUN_REV)가 다르다"
[ "$(mark_val bosun_snapshot)" = "$BOSUN_SNAP" ] || die "preflight 표식의 bosun_snapshot($(mark_val bosun_snapshot))이 이 스크립트의 snapshot($BOSUN_SNAP)과 다르다. preflight 를 다시"
[ "$(mark_val bosun_adapter_sha256)" = "$REG_ADAPTER_SHA" ] || die "preflight 표식의 어댑터 sha256 이 registry 값과 다르다(registry 가 바뀌었다). preflight 를 다시"
[ "$(mark_val bosun_embeddings_sha256)" = "$REG_EMB_SHA" ] || die "preflight 표식의 임베딩 sha256 이 registry 값과 다르다(registry 가 바뀌었다). preflight 를 다시"
[ -d "$BOSUN_SNAP" ] || die "패키지 snapshot 이 없다: $BOSUN_SNAP"
for f in config.json manifest.json "$ADAPTER_REL" "$EMB_REL" adapter/adapter_config.json; do [ -f "$BOSUN_SNAP/$f" ] || die "snapshot 에 $f 가 없다"; done
GOT_ADAPTER="$(sha256_of "$BOSUN_SNAP/$ADAPTER_REL")"
GOT_EMB="$(sha256_of "$BOSUN_SNAP/$EMB_REL")"
[ "$GOT_ADAPTER" = "$REG_ADAPTER_SHA" ] || die "$ADAPTER_REL sha256 불일치: $GOT_ADAPTER (registry $REG_ADAPTER_SHA). 학습 금지"
[ "$GOT_EMB" = "$REG_EMB_SHA" ] || die "$EMB_REL sha256 불일치: $GOT_EMB (registry $REG_EMB_SHA). 학습 금지"
[ -f "$BASE_SNAP/config.json" ] || die "백본 캐시가 없다: $BASE_SNAP (HF_HUB_OFFLINE=1 로 돌아 새로 받지 않는다)"

NAME="bosun-f1-$TAG"
OUT="$SOL_RUNS_DIR/$NAME"
[ ! -e "$OUT" ] && [ ! -e "$OUT.train.log" ] && [ ! -e "$OUT.summary.md" ] || die "이미 있다: $OUT (덮어쓰지 않는다. --tag 로 이름을 바꾼다)"
mkdir -p "$SOL_RUNS_DIR"

echo "== F1 $NAME $(date -Iseconds) host=$(hostname) user=$(id -un) GPU=$SOL_GPU_INDEX($GPU_UUID, 공유) free ${FREE_MIB} / used ${PRE_USED_MIB} / total ${TOTAL_MIB} MiB"
echo "== 인자: --max-steps $MAX_STEPS --batch $BATCH --accum $ACCUM --max-state-tokens $MAX_STATE --device cuda --bf16 --grad-checkpointing"
echo "== 패키지: Hanno-Labs/bosun-v3.1-0.6b@$SOL_BOSUN_REV (adapter·embeddings sha256 재대조 통과, HF_HUB_OFFLINE=$HF_HUB_OFFLINE)"
echo "== 메모리 예산: 우리 증가분 ≤ ${SOL_MEM_BUDGET_MIB} MiB ($BUDGET_NOTE). 다른 프로세스(PaddleOCR 등)는 종료 대상이 아니다"
if [ -n "$APPS" ]; then echo "== GPU $SOL_GPU_INDEX 의 다른 compute 프로세스(기록만):"; printf '%s\n' "$APPS" | sed 's/^/     /'; fi
nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=index,name,memory.used,memory.free,memory.total --format=csv > "$OUT.pre.txt"
cat "$OUT.pre.txt"

# ── GPU 메모리 1초 간격 기록. kill 을 쓰지 않고 정지 파일로 멈추는 자기 자식 루프(끝나면 이것만 멈춘다) ──────────
SAMPLER_LOG="$OUT.nvidia-smi.csv"
SAMPLER_STOP="$OUT.sampler.stop"
rm -f "$SAMPLER_STOP"
(
  while [ ! -e "$SAMPLER_STOP" ]; do
    nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=timestamp,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits 2>/dev/null || true
    sleep 1
  done
) > "$SAMPLER_LOG" &
SAMPLER_PID=$!
stop_sampler() { : > "$SAMPLER_STOP"; wait "$SAMPLER_PID" 2>/dev/null || true; rm -f "$SAMPLER_STOP"; }
trap stop_sampler EXIT

# ── 학습 N step. 학습기 인터페이스(다른 작업자 구현 중): ────────────────────────────────────────────────
#   python -m sol_decision.train --package DIR --data FILE --out DIR --max-steps N --batch B --accum A --device cuda --bf16
#                                [--grad-checkpointing] [--max-state-tokens N]
#   --package 에는 Hub 태그가 아니라 위에서 sha256 을 대조한 로컬 snapshot 디렉터리를 준다. 공개 LoRA 이어 학습(새 LoRA 금지)
START="$(date +%s)"
set +e
"$PY" -m sol_decision.train \
  --package "$BOSUN_SNAP" \
  --data "$SOL_TRAIN_DATA" \
  --out "$OUT" \
  --max-steps "$MAX_STEPS" --batch "$BATCH" --accum "$ACCUM" \
  --device cuda --bf16 --grad-checkpointing \
  --max-state-tokens "$MAX_STATE" 2>&1 | tee "$OUT.train.log"
TRAIN_EXIT=${PIPESTATUS[0]}
set -e
END="$(date +%s)"
stop_sampler
trap - EXIT
nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=index,name,memory.used,memory.free,memory.total --format=csv > "$OUT.post.txt"

# ── 저장 패키지 확인·재로딩 parity(학습 패키지로 predict ↔ decision_logits 동일성, n=8) ───────────────────────
PKG=no
[ -f "$OUT/manifest.json" ] && [ -f "$OUT/$ADAPTER_REL" ] && [ -f "$OUT/$EMB_REL" ] && [ -f "$OUT/config.json" ] && PKG=yes
OUT_ADAPTER_SHA="-"; OUT_EMB_SHA="-"; EMB_FROZEN="-"
if [ "$PKG" = yes ]; then
  OUT_ADAPTER_SHA="$(sha256_of "$OUT/$ADAPTER_REL")"
  OUT_EMB_SHA="$(sha256_of "$OUT/$EMB_REL")"
  # decision 임베딩은 동결이라 공개본과 같아야 한다(23 §5.3). 어댑터는 학습했으니 달라져야 한다
  if [ "$OUT_EMB_SHA" = "$REG_EMB_SHA" ]; then EMB_FROZEN=yes; else EMB_FROZEN=no; fi
fi
PARITY_EXIT="-"
if [ "$PKG" = yes ] && [ "$PARITY" = 1 ]; then
  set +e
  "$PY" -m sol_decision.parity --package "$OUT" --data "$SOL_TRAIN_DATA" --n 8 --device cuda --bf16 > "$OUT.parity.log" 2>&1
  PARITY_EXIT=$?
  set -e
  tail -n 5 "$OUT.parity.log" | sed 's/^/     parity: /'
fi

# ── 측정값 정리. 로그 파싱은 느슨하게(학습기 로그 줄 형식은 F1 전 확정. 못 찾으면 '-') ─────────────────────────
OOM=no
grep -qiE 'OutOfMemoryError|out of memory|CUDA error: out of memory' "$OUT.train.log" && OOM=yes
LAST_STEP="$(grep -oiE '(^|[^a-z_])step[ =:/]+[0-9]+' "$OUT.train.log" | grep -oE '[0-9]+$' | tail -1 || true)"
LAST_LOSS="$(grep -oiE 'loss[ =:]+[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?' "$OUT.train.log" | sed -E 's/^[^0-9]*//' | tail -1 || true)"
SKIPPED="$(grep -oiE 'skip(ped)?[ =:]+[0-9]+' "$OUT.train.log" | grep -oE '[0-9]+$' | tail -1 || true)"
STEP_S_LOG="$(grep -oiE '[0-9]+(\.[0-9]+)? ?s/step' "$OUT.train.log" | grep -oE '^[0-9]+(\.[0-9]+)?' | tail -1 || true)"
MAX_USED_MIB="$(awk -F', *' 'NF>=2 && $2 ~ /^[0-9]+$/ {if ($2+0 > m) m = $2+0} END {print m+0}' "$SAMPLER_LOG")"
N_SAMPLES="$(grep -c . "$SAMPLER_LOG" || true)"
DELTA_MIB=$((MAX_USED_MIB - PRE_USED_MIB)); [ "$DELTA_MIB" -lt 0 ] && DELTA_MIB=0
# training_metrics.json 이 있으면 우선한다(키 이름 후보는 학습기와 F1 전 맞춘다)
METRICS="$("$PY" -I - "$OUT" <<'PY'
import json, os, sys
out = sys.argv[1]
m = {}
p = os.path.join(out, "training_metrics.json")
if os.path.exists(p):
    try:
        j = json.load(open(p, encoding="utf-8"))
    except Exception:
        j = {}
    def pick(*keys):
        for k in keys:
            if k in j and j[k] is not None:
                return j[k]
        return None
    pb = pick("peak_device_bytes", "peak_memory_bytes", "max_memory_allocated_bytes")
    if pb is not None: m["peak_alloc_mib"] = round(float(pb) / 2**20)
    pm = pick("peak_memory_mib", "max_memory_allocated_mib")
    if pm is not None: m["peak_alloc_mib"] = round(float(pm))
    for k, keys in (("wall_s", ("wall_seconds", "wall_s", "elapsed_seconds")), ("steps", ("steps", "steps_completed", "global_step")),
                    ("skipped", ("skipped", "skipped_records", "n_skipped")), ("final_loss", ("final_loss", "loss", "last_loss")),
                    ("step_s", ("step_seconds", "sec_per_step", "step_time_s")), ("records_seen", ("records_seen", "n_records"))):
        v = pick(*keys)
        if v is not None: m[k] = v
try:
    import torch, transformers, peft
    m["versions"] = f"torch {torch.__version__} · transformers {transformers.__version__} · peft {peft.__version__}"
except Exception:
    m["versions"] = "?"
print(json.dumps(m, ensure_ascii=False))
PY
)"
val() { printf '%s' "$METRICS" | "$PY" -I -c 'import json,sys; v=json.load(sys.stdin).get(sys.argv[1]); print("-" if v is None else v)' "$1"; }
PEAK_ALLOC="$(val peak_alloc_mib)"; WALL="$(val wall_s)"; STEPS_DONE="$(val steps)"; SKIPPED_M="$(val skipped)"; LOSS_M="$(val final_loss)"; STEP_S_M="$(val step_s)"; SEEN="$(val records_seen)"; VERSIONS="$(val versions)"
[ "$STEPS_DONE" = "-" ] && STEPS_DONE="${LAST_STEP:--}"
[ "$SKIPPED_M" = "-" ] && SKIPPED_M="${SKIPPED:--}"
[ "$LOSS_M" = "-" ] && LOSS_M="${LAST_LOSS:--}"
STEP_S="$STEP_S_M"
if [ "$STEP_S" = "-" ]; then
  if [ -n "$STEP_S_LOG" ]; then STEP_S="$STEP_S_LOG"; else STEP_S="$(awk -v t="$((END - START))" -v n="$MAX_STEPS" 'BEGIN {printf "%.1f(wall/step, 로딩 포함)", t / n}')"; fi
fi
[ "$WALL" = "-" ] && WALL="$((END - START))"
REPO_COMMIT="$(git -C "$SOL_REPO" rev-parse HEAD 2>/dev/null || echo '?')"

VERDICT=PASS
REASONS=()
[ "$TRAIN_EXIT" -eq 0 ] || { VERDICT=FAIL; REASONS+=("sol_decision.train exit $TRAIN_EXIT"); }
[ "$OOM" = no ] || { VERDICT=FAIL; REASONS+=("OOM"); }
if [ "$STEPS_DONE" != "-" ] && [ "$STEPS_DONE" -lt "$MAX_STEPS" ] 2>/dev/null; then VERDICT=FAIL; REASONS+=("완료 step $STEPS_DONE < $MAX_STEPS"); fi
[ "$PKG" = yes ] || { VERDICT=FAIL; REASONS+=("패키지 저장 안 됨(manifest.json·${ADAPTER_REL}·${EMB_REL}·config.json)"); }
[ "$EMB_FROZEN" != no ] || { VERDICT=FAIL; REASONS+=("decision_embeddings.safetensors 가 공개본과 다르다(동결이어야 한다. ADR-034 7번)"); }
[ "$PKG" != yes ] || [ "$OUT_ADAPTER_SHA" != "$REG_ADAPTER_SHA" ] || { REASONS+=("경고: 어댑터 sha256 이 공개본과 같다(학습이 가중치를 바꾸지 않았다)"); }
[ "$DELTA_MIB" -le "$SOL_MEM_BUDGET_MIB" ] || { VERDICT=FAIL; REASONS+=("우리 증가분 최대 ${DELTA_MIB} MiB > 예산 ${SOL_MEM_BUDGET_MIB} MiB (여유 ${SOL_RESERVE_MIB} 침범)"); }
[ "$N_SAMPLES" -ge 1 ] || { VERDICT=FAIL; REASONS+=("nvidia-smi 기록 0줄(메모리 최대값 미측정)"); }
if [ "$PARITY" = 1 ]; then
  [ "$PARITY_EXIT" = "0" ] || { VERDICT=FAIL; REASONS+=("재로딩 parity exit ${PARITY_EXIT} (sol_decision.parity --n 8)"); }
else
  REASONS+=("경고: --no-parity 로 재로딩 검사를 건너뛰었다(합격 조건 '저장·재로딩' 미확인)")
fi

SUMMARY="$OUT.summary.md"
{
  echo "# F1 $NAME — $VERDICT"
  echo
  echo "| 항목 | 값 |"
  echo "|---|---|"
  echo "| 실행 시각 | $(date -d "@$START" -Iseconds 2>/dev/null || date -r "$START" -Iseconds 2>/dev/null || echo "$START") ~ $(date -d "@$END" -Iseconds 2>/dev/null || date -r "$END" -Iseconds 2>/dev/null || echo "$END") ($((END - START))s) |"
  echo "| 호스트·계정 | $(hostname) · $(id -un) |"
  echo "| 물리 GPU index | $SOL_GPU_INDEX ($GPU_UUID), 프로세스 안 cuda:0, **공유**(PaddleOCR 등) |"
  echo "| 버전 | $VERSIONS · 저장소 commit $REPO_COMMIT |"
  echo "| 출발 패키지 | Hanno-Labs/bosun-v3.1-0.6b@$SOL_BOSUN_REV · adapter $GOT_ADAPTER · embeddings $GOT_EMB (registry 와 일치) |"
  echo "| 백본 | Qwen/Qwen3-0.6B@$SOL_BOSUN_BASE_REV |"
  echo "| 인자 | --max-steps $MAX_STEPS --batch $BATCH --accum $ACCUM --max-state-tokens $MAX_STATE --device cuda --bf16 --grad-checkpointing |"
  echo "| GPU 시작 직전 used / free | ${PRE_USED_MIB} / ${FREE_MIB} MiB (total ${TOTAL_MIB}) |"
  echo "| GPU 전체 최대(nvidia-smi memory.used, PaddleOCR·서빙 포함) | ${MAX_USED_MIB} MiB (${N_SAMPLES} samples) |"
  echo "| 우리 증가분 최대(전체 최대 − 시작 직전 used) | ${DELTA_MIB} MiB (예산 ${SOL_MEM_BUDGET_MIB} MiB, $BUDGET_NOTE) |"
  echo "| torch peak(max_memory_allocated, 학습기 기록) | ${PEAK_ALLOC} MiB |"
  echo "| step 시간 | ${STEP_S} s · wall ${WALL} s |"
  echo "| 완료 step / loss | ${STEPS_DONE} / ${LOSS_M} |"
  echo "| skip(--max-state-tokens 초과 등) | ${SKIPPED_M} · 레코드 ${SEEN} |"
  echo "| OOM | $OOM |"
  echo "| 패키지 저장 | $PKG (adapter $OUT_ADAPTER_SHA, embeddings $OUT_EMB_SHA, 임베딩 동결 유지 $EMB_FROZEN) |"
  echo "| 재로딩 parity(sol_decision.parity --n 8) | exit ${PARITY_EXIT} |"
  echo "| 로그 | $OUT.train.log, $SAMPLER_LOG, $OUT.pre.txt, $OUT.post.txt$([ "$PARITY" = 1 ] && [ "$PKG" = yes ] && echo ", $OUT.parity.log") |"
  echo "| sol_decision.train exit | $TRAIN_EXIT |"
  if [ "${#REASONS[@]}" -gt 0 ]; then echo; echo "사유: ${REASONS[*]}"; fi
} > "$SUMMARY"
cat "$SUMMARY"

RESULTS="$SOL_RUNS_DIR/f1-results.md"
if [ ! -f "$RESULTS" ]; then
  {
    echo "| run | batch×accum | max-state | GPU 전체 max MiB | 우리 증가분 MiB(예산) | torch peak MiB | step s | steps | loss | skip | OOM | 패키지 | parity | 판정 |"
    echo "|---|---|---:|---:|---|---:|---:|---:|---:|---:|---|---|---|---|"
  } > "$RESULTS"
fi
echo "| $NAME | ${BATCH}×${ACCUM} | $MAX_STATE | $MAX_USED_MIB | $DELTA_MIB ($SOL_MEM_BUDGET_MIB) | $PEAK_ALLOC | $STEP_S | $STEPS_DONE | $LOSS_M | $SKIPPED_M | $OOM | $PKG | $PARITY_EXIT | $VERDICT |" >> "$RESULTS"
echo "== 결과 표: $RESULTS (docs/evidence/bosun-train-feasibility.md 에 옮긴다. Kev 기록은 개서하지 않는다)"
if [ "$VERDICT" = PASS ]; then
  echo "== PASS. 다음 칸(--batch 2 --accum 4)은 이 결과를 적은 뒤 한 번에 하나씩. 20 step PASS 만으로 F2 준비 완료라고 적지 않는다(22 §4.2 F1-D)"
  exit 0
fi
echo "== FAIL. 더 큰 설정을 시도하지 않는다. 22 §4.2 의 ①~③ 을 검토하고 사용자에게 보고(④ 이후는 사용자 승인 대상)"
exit 1
