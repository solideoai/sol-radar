#!/usr/bin/env bash
# SOL RADAR — Kev-9B LoRA F1-B/F1-C 메모리 검증 실행 (회사 GPU 서버, 물리 GPU 1 전용, 기본 20 step).
# 정본: docs/22-FINETUNE-RUNBOOK.md §4.2, docs/23-WEEKEND-FINETUNE.md §5.2. 결과 기록은 docs/evidence/kev-train-feasibility.md.
#
# 사용(서버 셸):
#   export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1
#   bash infra/gpu/kev-preflight.sh                       # 먼저. 통과 표식 $SOL_RUNS_DIR/preflight-ok 를 남긴다
#   bash infra/gpu/kev-f1.sh --max_state 1024             # F1-B 기본 후보: bf16·batch 1·accum 8·checkpointing 1
#   bash infra/gpu/kev-f1.sh --max_state 2048             # F1-C: 앞 단계가 PASS 일 때만 다음 값
#   bash infra/gpu/kev-f1.sh --max_state 2048 --batch 2 --accum 4 --tag b2
# 옵션: --max_state N(필수) --batch B(1) --accum A(8) --max_steps S(20) --row_budget N(0) --length_sort 0|1(0) --tag 이름
# 환경 변수(SOL_WORK·SOL_GPU_INDEX·SOL_KEV_VENV·SOL_KEV_SRC·HF_HOME·SOL_TRAIN_DATA·SOL_RUNS_DIR·SOL_MIN_FREE_MIB)는 kev-preflight.sh 와 같다.
#   SOL_MEM_BUDGET_MIB  41000   nvidia-smi memory.used 최대값이 이 값을 넘으면 FAIL(46,068 MiB 의 약 89%. 안전 여유)
#
# 하지 않는 것: 다른 프로세스 종료(kill·pkill·killall), docker compose down, 기존 run 폴더 덮어쓰기·삭제, GPU 0·2 사용.
# 이 스크립트가 끝낼 때 멈추는 것은 자기가 띄운 nvidia-smi 기록 프로세스 하나뿐이다.
# --init_from·--base·--base_revision·--lora·--head_dim·--lora_targets·--option_isolation·--special_embeddings 는 Kev-9B v1.0
# 체크포인트 호환 값으로 고정한다(kev/checkpoint.py COMPAT_FIELDS, docs/22 §4.2). 새 LoRA 를 처음부터 학습하지 않는다.
# --init_from 에는 Hub 태그(jaredpalmer/kev-9b@v1.0)가 아니라 preflight 가 sha256 을 대조한 로컬 snapshot 디렉터리
# (태그 v1.0 이 가리키는 커밋 3afdec81…)를 준다. 실행 직전에 adapter_model.safetensors·head.pt 의 sha256 을 다시 대조하고
# 다르면 시작하지 않는다(head.pt 는 pickle 이라 검증 안 된 파일을 torch.load 에 넣지 않는다). 학습은 HF_HUB_OFFLINE=1 로 돌아
# 네트워크에서 아무것도 새로 받지 않는다(SOL_HF_OFFLINE=0 으로만 해제).
set -euo pipefail

SOL_WORK="${SOL_WORK:-/data/www/ai_workspace/sol-radar}"
SOL_GPU_INDEX="${SOL_GPU_INDEX:-1}"
SOL_KEV_VENV="${SOL_KEV_VENV:-$SOL_WORK/.venv-kev}"
SOL_KEV_SRC="${SOL_KEV_SRC:-$SOL_WORK/kev}"
export HF_HOME="${HF_HOME:-$SOL_WORK/hf}"
SOL_TRAIN_DATA="${SOL_TRAIN_DATA:-$SOL_WORK/sol-dataset-v0.1/kev/train.en.jsonl}"
SOL_RUNS_DIR="${SOL_RUNS_DIR:-$SOL_WORK/runs}"
SOL_MIN_FREE_MIB="${SOL_MIN_FREE_MIB:-40000}"
SOL_MEM_BUDGET_MIB="${SOL_MEM_BUDGET_MIB:-41000}"
export CUDA_DEVICE_ORDER="${CUDA_DEVICE_ORDER:-PCI_BUS_ID}"

# 고정 리비전·sha256(kev-preflight.sh·docs/22 §2.2·services/ai/models/registry.yaml 과 같은 값)
KEV9B_REV="3afdec81efc91da83dee06d30714adf54ee35531"   # jaredpalmer/kev-9b 태그 v1.0 이 가리키는 커밋(2026-10-20 Hub refs)
KEV9B_ADAPTER_SHA="2b2a70cf4ef4440b6c22899e1f72c2f8ea5c6f65b19aa344539b4b8971d1f13d"
KEV9B_HEAD_SHA="8e1dab2c8e3664f6fee843e0257d57946c25e0210c61901ea77e71761f4244e1"
KEV_SNAP="$HF_HOME/hub/models--jaredpalmer--kev-9b/snapshots/$KEV9B_REV"
INIT_FROM="$KEV_SNAP"                                    # 로컬 디렉터리 → kev 는 Hub 를 조회하지 않는다(kev/checkpoint.py resolve_run)
INIT_LABEL="jaredpalmer/kev-9b@v1.0 (snapshot $KEV9B_REV)"
BASE="Qwen/Qwen3.5-9B-Base"
BASE_REV="68c46c4b3498877f3ef123c856ecfde50c39f404"

MAX_STATE="" BATCH=1 ACCUM=8 MAX_STEPS=20 ROW_BUDGET=0 LENGTH_SORT=0 TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --max_state) MAX_STATE="$2"; shift 2 ;;
    --batch) BATCH="$2"; shift 2 ;;
    --accum) ACCUM="$2"; shift 2 ;;
    --max_steps) MAX_STEPS="$2"; shift 2 ;;
    --row_budget) ROW_BUDGET="$2"; shift 2 ;;
    --length_sort) LENGTH_SORT="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "모르는 옵션: $1 (--help)" >&2; exit 2 ;;
  esac
done
case "$MAX_STATE" in ''|*[!0-9]*) echo "--max_state N 이 필요하다(예: 1024). kev.train 범위는 [384, 65536]" >&2; exit 2 ;; esac
for v in "$BATCH" "$ACCUM" "$MAX_STEPS" "$ROW_BUDGET" "$LENGTH_SORT"; do
  case "$v" in ''|*[!0-9]*) echo "숫자가 아닌 인자: $v" >&2; exit 2 ;; esac
done
# --tag 는 run 이름의 일부다. 경로 문자(/ ..)·공백을 받지 않는다(runs/ 밖으로 나가지 못하게)
if [ -n "$TAG" ] && ! printf '%s' "$TAG" | grep -qE '^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$'; then
  echo "--tag 는 영문·숫자로 시작하는 [A-Za-z0-9._-] 1~41자만 된다: '$TAG'" >&2; exit 2
fi

die() { echo "중단: $*" >&2; exit 1; }

# ── 사전 조건: 환경 변수, preflight 표식, GPU 1 점유, 파일 ───────────────────────────────────────
[ "${CUDA_VISIBLE_DEVICES:-}" = "$SOL_GPU_INDEX" ] || die "CUDA_VISIBLE_DEVICES 가 '$SOL_GPU_INDEX' 이 아니다(현재 '${CUDA_VISIBLE_DEVICES:-<없음>}'). export CUDA_VISIBLE_DEVICES=$SOL_GPU_INDEX"
[ "$CUDA_DEVICE_ORDER" = "PCI_BUS_ID" ] || die "CUDA_DEVICE_ORDER 가 PCI_BUS_ID 가 아니다"
MARK="$SOL_RUNS_DIR/preflight-ok"
[ -f "$MARK" ] || die "preflight 통과 표식이 없다($MARK). 먼저 bash infra/gpu/kev-preflight.sh"
PY="$SOL_KEV_VENV/bin/python"
[ -x "$PY" ] || die "venv python 이 없다: $PY"
[ -f "$SOL_TRAIN_DATA" ] || die "학습 데이터가 없다: $SOL_TRAIN_DATA"
command -v nvidia-smi >/dev/null 2>&1 || die "nvidia-smi 가 없다"
GPU_UUID="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=uuid --format=csv,noheader | tr -d ' ')"
MARK_UUID="$(sed -n 's/^gpu_uuid=//p' "$MARK")"
[ -n "$GPU_UUID" ] && [ "$GPU_UUID" = "$MARK_UUID" ] || die "GPU $SOL_GPU_INDEX uuid($GPU_UUID)가 preflight 때($MARK_UUID)와 다르다. preflight 를 다시"
APPS="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>/dev/null || true)"
[ -z "$APPS" ] || die "GPU $SOL_GPU_INDEX 에 다른 프로세스가 있다(종료하지 않는다. 회사에 확인): $APPS"
FREE_MIB="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=memory.free --format=csv,noheader,nounits | tr -d ' ')"
[ "${FREE_MIB:-0}" -ge "$SOL_MIN_FREE_MIB" ] || die "GPU $SOL_GPU_INDEX 여유 메모리 ${FREE_MIB} MiB < ${SOL_MIN_FREE_MIB} MiB"

# ── 체크포인트: preflight 가 본 고정 snapshot 과 같은 경로인지, 파일 sha256 이 지금도 같은지(실행 직전 재대조) ─────────
MARK_SNAP="$(sed -n 's/^kev_snapshot=//p' "$MARK")"
[ "$MARK_SNAP" = "$KEV_SNAP" ] || die "preflight 표식의 kev_snapshot($MARK_SNAP)이 이 스크립트의 고정 snapshot($KEV_SNAP)과 다르다. preflight 를 다시"
[ -d "$KEV_SNAP" ] || die "체크포인트 snapshot 이 없다: $KEV_SNAP"
for f in adapter_model.safetensors head.pt adapter_config.json; do [ -f "$KEV_SNAP/$f" ] || die "snapshot 에 $f 가 없다"; done
GOT_ADAPTER="$(sha256sum "$KEV_SNAP/adapter_model.safetensors" | awk '{print $1}')"
GOT_HEAD="$(sha256sum "$KEV_SNAP/head.pt" | awk '{print $1}')"
[ "$GOT_ADAPTER" = "$KEV9B_ADAPTER_SHA" ] || die "adapter_model.safetensors sha256 불일치: $GOT_ADAPTER (기대 $KEV9B_ADAPTER_SHA). 학습 금지"
[ "$GOT_HEAD" = "$KEV9B_HEAD_SHA" ] || die "head.pt sha256 불일치: $GOT_HEAD (기대 $KEV9B_HEAD_SHA). 학습 금지(검증 안 된 pickle 을 로드하지 않는다)"
BASE_SNAP="$HF_HOME/hub/models--Qwen--Qwen3.5-9B-Base/snapshots/$BASE_REV"
[ -f "$BASE_SNAP/config.json" ] || die "백본 캐시가 없다: $BASE_SNAP (HF_HUB_OFFLINE=1 로 돌아 새로 받지 않는다)"
export HF_HUB_OFFLINE="${SOL_HF_OFFLINE:-1}"

NAME="f1-ms${MAX_STATE}-b${BATCH}a${ACCUM}${TAG:+-$TAG}"
OUT="$SOL_RUNS_DIR/$NAME"
[ ! -e "$OUT" ] && [ ! -e "$OUT.log" ] || die "이미 있다: $OUT (덮어쓰지 않는다. --tag 로 이름을 바꾼다)"
mkdir -p "$SOL_RUNS_DIR"

echo "== F1 $NAME $(date -Iseconds) host=$(hostname) GPU=$SOL_GPU_INDEX($GPU_UUID) 여유 ${FREE_MIB} MiB"
echo "== 인자: --max_state $MAX_STATE --batch $BATCH --accum $ACCUM --max_steps $MAX_STEPS --row_budget $ROW_BUDGET --length_sort $LENGTH_SORT"
echo "== init_from: $INIT_LABEL (sha256 대조 통과, HF_HUB_OFFLINE=$HF_HUB_OFFLINE)"
nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv > "$OUT.pre.txt"
cat "$OUT.pre.txt"

# ── GPU 메모리 1초 간격 기록(이 스크립트의 자식 프로세스. 끝나면 이 PID 만 멈춘다) ───────────────────
SAMPLER_LOG="$OUT.nvidia-smi.csv"
nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=timestamp,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits -l 1 > "$SAMPLER_LOG" &
SAMPLER_PID=$!
stop_sampler() { kill "$SAMPLER_PID" 2>/dev/null || true; wait "$SAMPLER_PID" 2>/dev/null || true; }
trap stop_sampler EXIT

# ── 학습 20 step ────────────────────────────────────────────────────────────────────────────────
cd "$SOL_KEV_SRC"
START="$(date +%s)"
set +e
"$PY" -m kev.train \
  --data "$SOL_TRAIN_DATA" \
  --init_from "$INIT_FROM" \
  --base "$BASE" --base_revision "$BASE_REV" \
  --lora 16 --head_dim 256 --lora_targets all --option_isolation 0 --special_embeddings 0 \
  --device cuda --dtype bf16 --weights_dtype bf16 --checkpointing 1 \
  --batch "$BATCH" --accum "$ACCUM" --max_state "$MAX_STATE" \
  --row_budget "$ROW_BUDGET" --length_sort "$LENGTH_SORT" \
  --max_steps "$MAX_STEPS" --out "$OUT" --seed 0 2>&1 | tee "$OUT.log"
TRAIN_EXIT=${PIPESTATUS[0]}
set -e
END="$(date +%s)"
stop_sampler
trap - EXIT
nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv > "$OUT.post.txt"

# ── 측정값 정리(F1-D 표 한 줄) ──────────────────────────────────────────────────────────────────
OOM=no
grep -qiE 'OutOfMemoryError|out of memory' "$OUT.log" && OOM=yes
DROPPED_LINE="$(grep -E '^dropped [0-9]+ of [0-9]+ records' "$OUT.log" | tail -1 || true)"
DROPPED="${DROPPED_LINE:+$(echo "$DROPPED_LINE" | awk '{print $2}')}"; DROPPED="${DROPPED:-0}"
LAST_STEP_LINE="$(grep -E '^ep[0-9]+ step ' "$OUT.log" | tail -1 || true)"
SEC_PER_REC="$(echo "$LAST_STEP_LINE" | grep -oE '[0-9.]+s/rec' | tr -d 's/rec' || true)"
MAX_USED_MIB="$(awk -F', *' 'NF>=2 && $2 ~ /^[0-9]+$/ {if ($2+0 > m) m = $2+0} END {print m+0}' "$SAMPLER_LOG")"
CKPT=no
[ -f "$OUT/adapter_model.safetensors" ] && [ -f "$OUT/head.pt" ] && [ -f "$OUT/training_config.json" ] && CKPT=yes
SHA_ADAPTER="-"; SHA_HEAD="-"
if [ "$CKPT" = yes ]; then
  SHA_ADAPTER="$(sha256sum "$OUT/adapter_model.safetensors" | awk '{print $1}')"
  SHA_HEAD="$(sha256sum "$OUT/head.pt" | awk '{print $1}')"
fi
METRICS="$("$PY" -I - "$OUT" <<'PY'
import json, os, sys
out = sys.argv[1]
m = {}
p = os.path.join(out, "training_metrics.json")
if os.path.exists(p):
    j = json.load(open(p))
    m["peak_alloc_gib"] = round(j.get("peak_device_bytes", 0) / 2**30, 2)
    m["wall_s"] = round(j.get("wall_seconds", 0), 1)
    m["records_seen"] = j.get("records_seen")
c = os.path.join(out, "training_config.json")
if os.path.exists(c):
    j = json.load(open(c))
    src = j.get("init_source") or {}
    m["init_resolved"] = src.get("resolved", "")
    # kev/checkpoint.py warm_start: weights_sha256 = 어댑터 파일의 sha256, head_sha256 = head.pt 의 sha256
    m["init_weights_sha256"] = src.get("weights_sha256") or src.get("adapter_sha256", "")
    m["init_head_sha256"] = src.get("head_sha256", "")
    m["base_revision"] = j.get("base_revision", "")
try:
    import torch; m["torch"] = torch.__version__
except Exception:
    m["torch"] = "?"
print(json.dumps(m, ensure_ascii=False))
PY
)"
val() { echo "$METRICS" | "$PY" -I -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], "-"))' "$1"; }
PEAK_ALLOC="$(val peak_alloc_gib)"; WALL="$(val wall_s)"; SEEN="$(val records_seen)"; TORCH_V="$(val torch)"
INIT_RESOLVED="$(val init_resolved)"; INIT_WSHA="$(val init_weights_sha256)"; INIT_HSHA="$(val init_head_sha256)"; BASE_REV_USED="$(val base_revision)"
KEV_COMMIT="$(git -C "$SOL_KEV_SRC" rev-parse HEAD 2>/dev/null || echo '?')"
STEP_S="-"
if [ -n "$SEC_PER_REC" ]; then STEP_S="$(awk -v s="$SEC_PER_REC" -v b="$BATCH" -v a="$ACCUM" 'BEGIN {printf "%.1f", s*b*a}')"; fi

VERDICT=PASS
REASONS=()
[ "$TRAIN_EXIT" -eq 0 ] || { VERDICT=FAIL; REASONS+=("kev.train exit $TRAIN_EXIT"); }
[ "$OOM" = no ] || { VERDICT=FAIL; REASONS+=("OOM"); }
[ "$DROPPED" = 0 ] || { VERDICT=FAIL; REASONS+=("dropped $DROPPED (state 가 잘려 요구사항이 빠진다. 22 §4.1 길이 제한)"); }
[ "$CKPT" = yes ] || { VERDICT=FAIL; REASONS+=("checkpoint 저장 안 됨"); }
[ "${MAX_USED_MIB:-0}" -le "$SOL_MEM_BUDGET_MIB" ] || { VERDICT=FAIL; REASONS+=("nvidia-smi 최대 ${MAX_USED_MIB} MiB > 예산 ${SOL_MEM_BUDGET_MIB} MiB (안전 여유 부족)"); }
# kev 가 training_config.json 에 적은 출발 체크포인트 해시가 기대값과 같은지(실행 전 대조의 사후 확인)
if [ "$CKPT" = yes ]; then
  [ "$INIT_WSHA" = "$KEV9B_ADAPTER_SHA" ] || { VERDICT=FAIL; REASONS+=("init_source.weights_sha256 ${INIT_WSHA:-?} ≠ 기대 어댑터 sha256"); }
  [ "$INIT_HSHA" = "$KEV9B_HEAD_SHA" ] || { VERDICT=FAIL; REASONS+=("init_source.head_sha256 ${INIT_HSHA:-?} ≠ 기대 head sha256"); }
fi

SUMMARY="$OUT.summary.md"
{
  echo "# F1 $NAME — $VERDICT"
  echo
  echo "| 항목 | 값 |"
  echo "|---|---|"
  echo "| 실행 시각 | $(date -d "@$START" -Iseconds 2>/dev/null || date -Iseconds) ~ $(date -d "@$END" -Iseconds 2>/dev/null || date -Iseconds) ($((END - START))s) |"
  echo "| 호스트·계정 | $(hostname) · $(id -un) |"
  echo "| 물리 GPU index | $SOL_GPU_INDEX ($GPU_UUID), 프로세스 안 cuda:0 |"
  echo "| PyTorch | $TORCH_V |"
  echo "| Kev git commit | $KEV_COMMIT |"
  echo "| Base model revision | $BASE@${BASE_REV_USED:-$BASE_REV} |"
  echo "| LoRA checkpoint(init_from) | $INIT_LABEL → ${INIT_RESOLVED:-?}. 실행 전 대조 adapter $GOT_ADAPTER · head $GOT_HEAD. kev 기록 weights_sha256 ${INIT_WSHA:-?} · head_sha256 ${INIT_HSHA:-?} |"
  echo "| 인자 | --max_state $MAX_STATE --batch $BATCH --accum $ACCUM --max_steps $MAX_STEPS --row_budget $ROW_BUDGET --length_sort $LENGTH_SORT --dtype bf16 --weights_dtype bf16 --checkpointing 1 |"
  echo "| GPU peak VRAM (torch max_memory_allocated) | ${PEAK_ALLOC} GiB |"
  echo "| GPU peak VRAM (nvidia-smi memory.used 최대) | ${MAX_USED_MIB} MiB (예산 ${SOL_MEM_BUDGET_MIB} MiB) |"
  echo "| 평균 step 시간 | ${STEP_S} s (${SEC_PER_REC:-?} s/rec × batch × accum, 로그 마지막 줄 기준) · wall ${WALL} s |"
  echo "| 학습된 레코드 수 | ${SEEN} |"
  echo "| dropped | ${DROPPED} (${DROPPED_LINE:-dropped 줄 없음}) |"
  echo "| OOM | $OOM |"
  echo "| checkpoint 저장 | $CKPT (adapter $SHA_ADAPTER, head $SHA_HEAD) |"
  echo "| 로그 | $OUT.log, $SAMPLER_LOG, $OUT.pre.txt, $OUT.post.txt |"
  echo "| kev.train exit | $TRAIN_EXIT |"
  if [ "${#REASONS[@]}" -gt 0 ]; then echo; echo "FAIL 사유: ${REASONS[*]}"; fi
} > "$SUMMARY"
cat "$SUMMARY"

RESULTS="$SOL_RUNS_DIR/f1-results.md"
if [ ! -f "$RESULTS" ]; then
  {
    echo "| run | max_state | batch×accum | peak alloc GiB | nvidia-smi max MiB | step s | records | dropped | OOM | ckpt | 판정 |"
    echo "|---|---:|---|---:|---:|---:|---:|---:|---|---|---|"
  } > "$RESULTS"
fi
echo "| $NAME | $MAX_STATE | ${BATCH}×${ACCUM} | $PEAK_ALLOC | $MAX_USED_MIB | $STEP_S | $SEEN | $DROPPED | $OOM | $CKPT | $VERDICT |" >> "$RESULTS"
echo "== 결과 표: $RESULTS (docs/evidence/kev-train-feasibility.md 에 옮긴다)"
if [ "$VERDICT" = PASS ]; then
  echo "== PASS. 다음 단계(--max_state 를 올리거나 --batch 2 --accum 4)는 이 결과를 적은 뒤 한 번에 하나씩"
  exit 0
fi
echo "== FAIL. 더 큰 설정을 시도하지 않는다. 22 §4.2 의 대안 순서로 검토하고 사용자에게 보고"
exit 1
