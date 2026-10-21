#!/usr/bin/env bash
# SOL RADAR — Bosun v3.1 0.6B LoRA F1-A 사전 검증 (회사 GPU 서버 sol-NF5280M6, 물리 GPU 1 **공유**).
# 정본: docs/16-DECISIONS.md ADR-034 상세 7·10·16번, docs/22-FINETUNE-RUNBOOK.md §3·§4.2, docs/23-WEEKEND-FINETUNE.md §2.4·§5,
#       docs/10-DEPLOYMENT.md "GPU 1 공유". Kev 용 kev-preflight.sh 는 보존·퇴역(수정하지 않는다). 구조·로그 형식은 그것을 본떴다.
#
# 읽기만 한다. GPU 0·2 와 다른 프로세스는 보기만 하고, 어떤 프로세스도 종료하지 않으며(kill·pkill·docker compose down 없음),
# 파일을 지우거나 덮어쓰지 않는다. 비밀 값을 출력하지 않는다(set -x 금지). GPU 에는 CUDA 컨텍스트 하나만 잠깐 만들고
# 모델은 CPU 로 올린다(⑧). 통과 표식(runs/bosun-preflight-ok)은 FAIL 이 0건일 때만 남긴다.
#
# GPU 1 은 회사 PaddleOCR vLLM 과 공유한다(ADR-034 10번). 다른 프로세스가 있어도 FAIL 이 아니다(기록만). 대신
# 회사의 공유 승인을 사용자가 확인했다는 뜻으로 SOL_GPU_SHARE_APPROVED=1 이 있어야 한다. 없으면 FAIL "회사 공유 승인 미확인".
#
# 사용(서버 셸, 계정 bim):
#   export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1
#   SOL_GPU_SHARE_APPROVED=1 bash infra/gpu/bosun-preflight.sh [--skip-load]
# SSH 를 다시 열면 위 export 는 사라진다. 매 세션 다시 적고, 이 스크립트가 그 값을 확인한다.
# --skip-load: ⑧(CPU 로 모델 로드·LoRA 텐서 수 확인)을 건너뛴다(warn 으로 기록). 표식은 남지만 F1 전에는 한 번은 통과해야 한다.
#
# 환경 변수(없으면 기본값):
#   SOL_WORK             /data/www/ai_workspace/sol-radar     SOL RADAR 전용 작업 루트
#   SOL_GPU_INDEX        1                                      허용된 물리 GPU index(nvidia-smi 기준). 0·2 는 회사 서비스 → FAIL
#   SOL_BOSUN_VENV       $SOL_WORK/.venv-bosun                  Python 3.12 가상환경(torch 2.8.0+cu128)
#   SOL_REPO             이 스크립트가 든 저장소 체크아웃(보통 $SOL_WORK/sol-radar)
#   SOL_DECISION_SRC     $SOL_REPO/services/decision            sol_decision 소스(학습기·parity·serve)
#   SOL_REGISTRY         $SOL_REPO/services/ai/models/registry.yaml   기대 sha256·리비전의 정본. bosun-v3.1-0.6b 항목이 없으면 FAIL
#   HF_HOME              $SOL_WORK/hf                           Hugging Face 캐시(HF_HUB_OFFLINE=1 로 읽는다)
#   SOL_BOSUN_REV        5e78a37c8d86860ebac9ef2d5327d6299498498e    Hanno-Labs/bosun-v3.1-0.6b 리비전. registry.yaml 값과 같아야
#   SOL_BOSUN_BASE_REV   c1899de289a04d12100db370d81485cdf75e47ca    Qwen/Qwen3-0.6B 리비전. registry.yaml 값과 같아야
#   SOL_TRAIN_DATA       $SOL_WORK/sol-dataset-v0.1/bosun/train.en.jsonl   없으면 데이터 검사만 건너뛴다(warn)
#   SOL_RUNS_DIR         $SOL_WORK/runs                         로그·표식
#   SOL_EXPECT_TORCH     2.8.0+cu128                            venv 의 torch 가 이 값과 다르면 FAIL
#   SOL_GPU_SHARE_APPROVED  (비워 둠)  1 이면 회사 GPU 1 공유 승인 확인. 없으면 FAIL
#   SOL_EST_TRAIN_MIB    10000   F1 학습 추정(bf16·batch 1·6k 토큰·grad checkpointing. 문서 추정 6~10 GB 의 상한)
#   SOL_EST_SERVE_MIB    3000    sol_decision.serve 추정(1.5~3 GB 의 상한)
#   SOL_RESERVE_MIB      3000    PaddleOCR 피크·컨텍스트 여유
#   SOL_REQUIRED_MIB     위 세 값의 합(기본 16000)   memory.free 가 이보다 작으면 FAIL. 실측 뒤 갱신한다
#   SOL_MIN_FREE_MIB     (기본값 없음)  선택. 정하면 memory.free 가 이보다 작아도 FAIL. SOL_REQUIRED_MIB 를 낮추는 데는 쓰이지 않는다
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOL_WORK="${SOL_WORK:-/data/www/ai_workspace/sol-radar}"
SOL_GPU_INDEX="${SOL_GPU_INDEX:-1}"
SOL_BOSUN_VENV="${SOL_BOSUN_VENV:-$SOL_WORK/.venv-bosun}"
SOL_REPO="${SOL_REPO:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
SOL_DECISION_SRC="${SOL_DECISION_SRC:-$SOL_REPO/services/decision}"
SOL_REGISTRY="${SOL_REGISTRY:-$SOL_REPO/services/ai/models/registry.yaml}"
export HF_HOME="${HF_HOME:-$SOL_WORK/hf}"
export HF_HUB_OFFLINE=1
SOL_BOSUN_REV="${SOL_BOSUN_REV:-5e78a37c8d86860ebac9ef2d5327d6299498498e}"
SOL_BOSUN_BASE_REV="${SOL_BOSUN_BASE_REV:-c1899de289a04d12100db370d81485cdf75e47ca}"
SOL_TRAIN_DATA="${SOL_TRAIN_DATA:-$SOL_WORK/sol-dataset-v0.1/bosun/train.en.jsonl}"
SOL_RUNS_DIR="${SOL_RUNS_DIR:-$SOL_WORK/runs}"
SOL_EXPECT_TORCH="${SOL_EXPECT_TORCH:-2.8.0+cu128}"
SOL_GPU_SHARE_APPROVED="${SOL_GPU_SHARE_APPROVED:-}"
SOL_EST_TRAIN_MIB="${SOL_EST_TRAIN_MIB:-10000}"
SOL_EST_SERVE_MIB="${SOL_EST_SERVE_MIB:-3000}"
SOL_RESERVE_MIB="${SOL_RESERVE_MIB:-3000}"
SOL_REQUIRED_MIB="${SOL_REQUIRED_MIB:-$((SOL_EST_TRAIN_MIB + SOL_EST_SERVE_MIB + SOL_RESERVE_MIB))}"
SOL_MIN_FREE_MIB="${SOL_MIN_FREE_MIB:-}"
export CUDA_DEVICE_ORDER="${CUDA_DEVICE_ORDER:-PCI_BUS_ID}"

BOSUN_ID="bosun-v3.1-0.6b"
BOSUN_REPO_DIR="models--Hanno-Labs--bosun-v3.1-0.6b"
BASE_REPO_DIR="models--Qwen--Qwen3-0.6B"
BOSUN_SNAP="$HF_HOME/hub/$BOSUN_REPO_DIR/snapshots/$SOL_BOSUN_REV"
BASE_SNAP="$HF_HOME/hub/$BASE_REPO_DIR/snapshots/$SOL_BOSUN_BASE_REV"
ADAPTER_REL="adapter/adapter_model.safetensors"
EMB_REL="decision_embeddings.safetensors"
EXPECT_LORA_TENSORS=392
EXPECT_LORA_PARAMS=10092544

SKIP_LOAD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-load) SKIP_LOAD=1; shift ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "모르는 옵션: $1 (--help)" >&2; exit 2 ;;
  esac
done
for v in "$SOL_EST_TRAIN_MIB" "$SOL_EST_SERVE_MIB" "$SOL_RESERVE_MIB" "$SOL_REQUIRED_MIB" "${SOL_MIN_FREE_MIB:-0}"; do
  case "$v" in ''|*[!0-9]*) echo "숫자가 아닌 MiB 값: '$v'" >&2; exit 2 ;; esac
done

mkdir -p "$SOL_RUNS_DIR"
LOG="$SOL_RUNS_DIR/bosun-preflight-$(date +%Y%m%d-%H%M%S).log"
MARK="$SOL_RUNS_DIR/bosun-preflight-ok"
exec > >(tee -a "$LOG") 2>&1
PY_OUT="$(mktemp "${TMPDIR:-/tmp}/bosun-preflight.XXXXXX")"
PY_ENV_FILE="$SOL_RUNS_DIR/bosun-preflight-env.tmp"
: > "$PY_ENV_FILE"
cleanup() { rm -f "$PY_OUT" "$PY_ENV_FILE"; }   # 자기가 만든 임시 파일 둘만 지운다
trap cleanup EXIT

FAILS=()
WARNS=()
ok() { echo "ok    $*"; }
info() { echo "info  $*"; }
warn() { echo "warn  $*"; WARNS+=("$*"); }
fail() { echo "FAIL  $*"; FAILS+=("$*"); }
# python 블록이 내는 "ok|warn|FAIL|info <메시지>" 줄을 같은 집계로 모은다.
# 출력을 임시 파일($PY_OUT)에 받아 `collect < "$PY_OUT"` 으로 읽는다 — `… | collect` 는 서브셸이라 FAIL 수가 사라지고,
# 프로세스 치환 안의 heredoc 은 bash 3.x 가 파싱하지 못한다
collect() {
  while IFS= read -r line; do
    case "$line" in
      "ok "*) ok "${line#ok }" ;;
      "warn "*) warn "${line#warn }" ;;
      "FAIL "*) fail "${line#FAIL }" ;;
      "info "*) info "${line#info }" ;;
      *) echo "      $line" ;;
    esac
  done
}
# venv python 으로 heredoc 블록을 돈다. 비정상 종료도 FAIL 한 줄로 남기고 스크립트는 계속 간다
py_block() { "$PY" -I - || echo "FAIL python 검사 블록 비정상 종료(exit $?)"; }
sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
is_hex40() { printf '%s' "$1" | grep -qE '^[0-9a-f]{40}$'; }
is_hex64() { printf '%s' "$1" | grep -qE '^[0-9a-f]{64}$'; }

echo "== SOL RADAR Bosun F1-A preflight $(date -Iseconds) host=$(hostname) user=$(id -un)"
echo "== 로그: $LOG"
echo "== SOL_WORK=$SOL_WORK  GPU=$SOL_GPU_INDEX(공유)  venv=$SOL_BOSUN_VENV  repo=$SOL_REPO  HF_HOME=$HF_HOME"
echo "== 예산: 학습 ${SOL_EST_TRAIN_MIB} + 서빙 ${SOL_EST_SERVE_MIB} + 여유 ${SOL_RESERVE_MIB} = 필요 ${SOL_REQUIRED_MIB} MiB (문서 추정치, F1 실측 뒤 갱신)"

# ── 0. 레지스트리: 기대 sha256·리비전의 정본(services/ai/models/registry.yaml 의 bosun-v3.1-0.6b 항목) ─────────────
echo "-- 0 레지스트리 ($SOL_REGISTRY)"
REG_BLOCK=""
if [ -f "$SOL_REGISTRY" ]; then
  REG_BLOCK="$(awk -v id="$BOSUN_ID" '
    /^[[:space:]]*- id:/ { v = $0; sub(/^[[:space:]]*- id:[[:space:]]*/, "", v); sub(/[[:space:]]*(#.*)?$/, "", v); inblk = (v == id) }
    inblk { print }' "$SOL_REGISTRY")"
fi
# 항목 블록 안에서 "key: value" 한 줄을 읽는다(따옴표·끝 주석 제거). 없으면 빈 문자열
reg_val() {
  printf '%s\n' "$REG_BLOCK" | awk -v k="$1" '
    { line = $0; sub(/^[ \t]+/, "", line) }
    index(line, k ":") == 1 {
      v = substr(line, length(k) + 2); sub(/^[ \t]+/, "", v); sub(/[ \t]+#.*$/, "", v)
      gsub(/^["\x27]|["\x27]$/, "", v); print v; exit }'
}
REG_ADAPTER_SHA=""; REG_EMB_SHA=""; REG_REV=""; REG_BASE_REV=""
if [ ! -f "$SOL_REGISTRY" ]; then
  fail "registry.yaml 이 없다: $SOL_REGISTRY (SOL_REGISTRY 로 경로를 준다)"
elif [ -z "$REG_BLOCK" ]; then
  fail "registry.yaml 에 '$BOSUN_ID' 항목이 없다(ADR-034 6번). 레지스트리 작업자가 넣기 전이면 F1 을 시작하지 않는다"
else
  REG_ADAPTER_SHA="$(reg_val lora)"
  REG_EMB_SHA="$(reg_val decision_embeddings_sha256)"
  REG_REV="$(reg_val revision)"
  REG_BASE_REV="$(reg_val base_revision)"
  # base_revision 이 없으면 base: <repo>@<sha> 의 @ 뒤를 쓴다(앞 8자 표기일 수 있다)
  if [ -z "$REG_BASE_REV" ] || [ "$REG_BASE_REV" = "null" ]; then REG_BASE_REV="$(reg_val base | sed -n 's/^.*@//p')"; fi
  if is_hex64 "$REG_ADAPTER_SHA"; then ok "registry lora(어댑터 sha256) $REG_ADAPTER_SHA"; else fail "registry '$BOSUN_ID'.lora 가 sha256(64 hex)이 아니다: '${REG_ADAPTER_SHA:-<없음>}'"; fi
  if is_hex64 "$REG_EMB_SHA"; then ok "registry decision_embeddings_sha256 $REG_EMB_SHA"; else fail "registry '$BOSUN_ID'.decision_embeddings_sha256 가 sha256 이 아니다: '${REG_EMB_SHA:-<없음>}'"; fi
  if is_hex40 "$REG_REV"; then
    if [ "$REG_REV" = "$SOL_BOSUN_REV" ]; then ok "registry revision == SOL_BOSUN_REV ($REG_REV)"; else fail "registry revision $REG_REV 와 SOL_BOSUN_REV $SOL_BOSUN_REV 가 다르다. 스크립트가 아니라 사람이 정한다"; fi
  else
    fail "registry '$BOSUN_ID'.revision 이 전체 sha(40 hex)가 아니다: '${REG_REV:-<없음>}'"
  fi
  if is_hex40 "$REG_BASE_REV"; then
    if [ "$REG_BASE_REV" = "$SOL_BOSUN_BASE_REV" ]; then ok "registry base revision == SOL_BOSUN_BASE_REV ($REG_BASE_REV)"; else fail "registry base revision $REG_BASE_REV 와 SOL_BOSUN_BASE_REV $SOL_BOSUN_BASE_REV 가 다르다"; fi
  elif [ "${#REG_BASE_REV}" -ge 7 ] && [ "${SOL_BOSUN_BASE_REV#"$REG_BASE_REV"}" != "$SOL_BOSUN_BASE_REV" ]; then
    ok "registry base '@$REG_BASE_REV' 는 SOL_BOSUN_BASE_REV $SOL_BOSUN_BASE_REV 의 앞부분(8자 표기)"
  else
    fail "registry '$BOSUN_ID' 에 백본 리비전(base_revision 또는 base: …@sha)이 없거나 SOL_BOSUN_BASE_REV 와 다르다: '${REG_BASE_REV:-<없음>}'"
  fi
fi

# ── 1. 환경 변수: 물리 GPU 1 만 보이게(가시성만 제한, 독점 아님) ──────────────────────────────────────
echo "-- 1 환경 변수"
case " $SOL_GPU_INDEX " in *" 0 "*|*" 2 "*) fail "SOL_GPU_INDEX=$SOL_GPU_INDEX 는 회사 서비스 GPU 다. 0·2 는 어떤 경우에도 쓰지 않는다(ADR-034 10번)" ;; esac
if [ "${CUDA_VISIBLE_DEVICES:-}" = "$SOL_GPU_INDEX" ]; then
  ok "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES (프로세스 안에서는 cuda:0 으로 보인다. 정상. 다른 사람의 GPU $SOL_GPU_INDEX 사용은 막지 못한다)"
else
  fail "CUDA_VISIBLE_DEVICES 가 정확히 '$SOL_GPU_INDEX' 이 아니다(현재 '${CUDA_VISIBLE_DEVICES:-<없음>}'). export CUDA_VISIBLE_DEVICES=$SOL_GPU_INDEX 뒤 다시 실행"
fi
if [ "$CUDA_DEVICE_ORDER" = "PCI_BUS_ID" ]; then
  ok "CUDA_DEVICE_ORDER=PCI_BUS_ID (nvidia-smi 번호와 CUDA 번호를 맞춘다)"
else
  fail "CUDA_DEVICE_ORDER 가 PCI_BUS_ID 가 아니다('$CUDA_DEVICE_ORDER'). export CUDA_DEVICE_ORDER=PCI_BUS_ID"
fi
ok "HF_HUB_OFFLINE=1 (이 스크립트와 F1 은 네트워크에서 아무것도 받지 않는다)"

# ── 2. nvidia-smi: GPU 목록, 물리 index ↔ PCI bus id, GPU 1 메모리 ──────────────────────────────────────
echo "-- 2 nvidia-smi"
GPU_UUID=""; GPU_BUS=""; GPU_NAME=""; FREE_MIB=""; USED_MIB=""; TOTAL_MIB=""
if ! command -v nvidia-smi >/dev/null 2>&1; then
  fail "nvidia-smi 가 없다"
else
  nvidia-smi --query-gpu=index,name,uuid,pci.bus_id,memory.used,memory.free,memory.total,compute_cap --format=csv 2>/dev/null || nvidia-smi -L || true
  GPU_UUID="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=uuid --format=csv,noheader 2>/dev/null | tr -d ' ' || true)"
  if [ -z "$GPU_UUID" ]; then
    fail "nvidia-smi -i $SOL_GPU_INDEX 가 GPU 를 돌려주지 않는다"
  else
    GPU_BUS="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=pci.bus_id --format=csv,noheader 2>/dev/null | tr -d ' ' || true)"
    GPU_NAME="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=name --format=csv,noheader 2>/dev/null | sed 's/^ *//; s/ *$//' || true)"
    FREE_MIB="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=memory.free --format=csv,noheader,nounits | tr -d ' ')"
    USED_MIB="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=memory.used --format=csv,noheader,nounits | tr -d ' ')"
    TOTAL_MIB="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=memory.total --format=csv,noheader,nounits | tr -d ' ')"
    ok "물리 GPU $SOL_GPU_INDEX = $GPU_NAME uuid=$GPU_UUID pci.bus_id=${GPU_BUS:-?} (used ${USED_MIB} / free ${FREE_MIB} / total ${TOTAL_MIB} MiB)"
    case "$GPU_NAME" in *A40*) ok "GPU 이름에 A40 포함(2026-10-20 확인 모델)" ;; *) warn "GPU $SOL_GPU_INDEX 이름이 A40 이 아니다: '$GPU_NAME'. 서버·index 를 확인" ;; esac
  fi
fi

# ── 3. GPU 1 의 다른 프로세스: 기록만(PaddleOCR 공존 정상). 승인 env 가 없으면 FAIL ────────────────────────
echo "-- 3 GPU $SOL_GPU_INDEX 프로세스(기록만 한다. 종료·이동하지 않는다)"
APPS=""
if command -v nvidia-smi >/dev/null 2>&1 && [ -n "$GPU_UUID" ]; then
  APPS="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>/dev/null || true)"
  if [ -z "$APPS" ]; then
    info "GPU $SOL_GPU_INDEX 에 지금 다른 compute 프로세스 없음(PaddleOCR 가 보이지 않는다 — 시간대·컨테이너 네임스페이스 차이일 수 있다. 공유 전제는 그대로)"
  else
    N_APPS="$(printf '%s\n' "$APPS" | grep -c . || true)"
    info "GPU $SOL_GPU_INDEX 의 compute 프로세스 ${N_APPS}개(pid, process_name, used_memory). FAIL 아님. 종료 대상 아님:"
    printf '%s\n' "$APPS" | sed 's/^/        /'
  fi
fi
if [ "$SOL_GPU_SHARE_APPROVED" = "1" ]; then
  ok "SOL_GPU_SHARE_APPROVED=1 (회사 GPU $SOL_GPU_INDEX 공유 승인을 사용자가 확인했다. ADR-034 10번)"
else
  fail "회사 공유 승인 미확인: SOL_GPU_SHARE_APPROVED=1 이 없다. GPU $SOL_GPU_INDEX 는 PaddleOCR 와 공유하므로 회사 승인·시간대 확인 뒤 사용자가 이 변수를 준다(ADR-034 10번, 23 §2.5 P4)"
fi

# ── 4. 가용 VRAM 과 필요 예산 ───────────────────────────────────────────────────────────────────────────
echo "-- 4 VRAM 예산(공유 상태 기준)"
if [ -n "$FREE_MIB" ]; then
  if [ "$FREE_MIB" -ge "$SOL_REQUIRED_MIB" ]; then
    ok "GPU $SOL_GPU_INDEX free ${FREE_MIB} MiB ≥ 필요 ${SOL_REQUIRED_MIB} MiB (학습 ${SOL_EST_TRAIN_MIB} + 서빙 ${SOL_EST_SERVE_MIB} + 여유 ${SOL_RESERVE_MIB}; 추정치, F1 실측 뒤 갱신)"
  else
    fail "GPU $SOL_GPU_INDEX free ${FREE_MIB} MiB < 필요 ${SOL_REQUIRED_MIB} MiB. 다른 작업(PaddleOCR 등)이 쓰고 있다. 종료하지 말고 회사에 시간대를 확인한다(22 §4.2 ③ 은 회사가 서빙을 내리는 경로, 우리가 끄지 않는다)"
  fi
  if [ -n "$SOL_MIN_FREE_MIB" ]; then
    if [ "$FREE_MIB" -ge "$SOL_MIN_FREE_MIB" ]; then ok "free ${FREE_MIB} MiB ≥ SOL_MIN_FREE_MIB ${SOL_MIN_FREE_MIB} MiB (추가 기준)"; else fail "free ${FREE_MIB} MiB < SOL_MIN_FREE_MIB ${SOL_MIN_FREE_MIB} MiB (추가 기준)"; fi
    [ "$SOL_MIN_FREE_MIB" -lt "$SOL_REQUIRED_MIB" ] && info "SOL_MIN_FREE_MIB 는 SOL_REQUIRED_MIB 를 낮추지 않는다(둘 다 만족해야 통과)"
  fi
  F1_BUDGET_MIB=$((FREE_MIB - SOL_RESERVE_MIB))
  [ "$F1_BUDGET_MIB" -gt 0 ] && info "bosun-f1.sh 의 기본 SOL_MEM_BUDGET_MIB(우리 프로세스가 더 쓸 수 있는 최대) = free − 여유 = ${F1_BUDGET_MIB} MiB (지금 값. F1 시작 때 다시 잰다)"
else
  fail "GPU $SOL_GPU_INDEX 여유 메모리를 읽지 못해 예산을 판정할 수 없다"
fi

# ── 5. venv: python 3.12, torch 고정, transformers/peft/safetensors, cuda:0 ↔ 물리 GPU 1 매핑(② 보충) ───────
echo "-- 5 Python 환경 ($SOL_BOSUN_VENV)"
PY="$SOL_BOSUN_VENV/bin/python"
if [ ! -x "$PY" ]; then
  fail "venv python 이 없다: $PY (지우거나 다시 만들지 않는다. 22 §3.2)"
else
  SOL_GPU_UUID="$GPU_UUID" SOL_GPU_BUS="$GPU_BUS" SOL_GPU_INDEX="$SOL_GPU_INDEX" SOL_EXPECT_TORCH="$SOL_EXPECT_TORCH" \
  SOL_ENV_FILE="$PY_ENV_FILE" py_block > "$PY_OUT" <<'PY'
import os, sys

def say(level, msg): print(f"{level} {msg}", flush=True)

def note(key, value):
    with open(os.environ["SOL_ENV_FILE"], "a", encoding="utf-8") as fh:
        fh.write(f"{key}={value}\n")

pyv = sys.version.split()[0]
say("ok" if sys.version_info[:2] == (3, 12) else "FAIL", f"python {pyv} (.venv-bosun 은 3.12. 다르면 venv 가 바뀐 것 — 멈추고 보고)")
note("python", pyv)

try:
    import torch
    tv = torch.__version__
    note("torch", tv)
    want = os.environ["SOL_EXPECT_TORCH"]
    if tv == want:
        say("ok", f"torch {tv} (고정값과 같다)")
    else:
        say("FAIL", f"torch {tv} 가 기대값 {want} 와 다르다. 설치가 torch 를 바꿨다(22 §3.2 --dry-run 으로 원인 확인). 의도한 값이면 SOL_EXPECT_TORCH 로 명시")
    if not torch.cuda.is_available():
        say("FAIL", "torch.cuda.is_available() False")
    else:
        n = torch.cuda.device_count()
        say("ok" if n == 1 else "FAIL", f"보이는 GPU 수 {n} (CUDA_VISIBLE_DEVICES={os.environ.get('SOL_GPU_INDEX')} 가 적용되면 1)")
        p = torch.cuda.get_device_properties(0)
        say("info", f"cuda:0 = {p.name}, compute capability {p.major}.{p.minor}, total {p.total_memory / 2**20:.0f} MiB")
        say("ok" if torch.cuda.is_bf16_supported() else "FAIL", f"bf16 지원 {torch.cuda.is_bf16_supported()}")
        # ② 물리 index ↔ PCI bus id: nvidia-smi 의 pci.bus_id(도메인:버스:장치.기능, 16진수)와 torch 의 pci_* 정수 비교
        want_bus = os.environ.get("SOL_GPU_BUS", "")
        have = {k: getattr(p, k, None) for k in ("pci_domain_id", "pci_bus_id", "pci_device_id")}
        if want_bus and all(v is not None for v in have.values()):
            try:
                dom, bus, dev_fn = want_bus.split(":")
                dev = dev_fn.split(".")[0]
                same = (int(dom, 16), int(bus, 16), int(dev, 16)) == (have["pci_domain_id"], have["pci_bus_id"], have["pci_device_id"])
                say("ok" if same else "FAIL", f"cuda:0 pci {have['pci_domain_id']:08x}:{have['pci_bus_id']:02x}:{have['pci_device_id']:02x} vs nvidia-smi GPU {os.environ.get('SOL_GPU_INDEX')} {want_bus}" + ("" if same else " — 다른 GPU 를 잡았다. 학습 금지"))
            except Exception as e:
                say("warn", f"pci.bus_id 비교 실패({e!r}). uuid 로 대신 확인")
        else:
            say("warn", "torch 가 pci_* 속성을 주지 않거나 nvidia-smi pci.bus_id 가 없다. uuid 로 대신 확인")
        want_uuid = os.environ.get("SOL_GPU_UUID", "").replace("GPU-", "").lower()
        have_uuid = str(getattr(p, "uuid", "")).lower()
        if not have_uuid:
            say("warn", "torch 가 GPU uuid 를 주지 않는다. CUDA_DEVICE_ORDER=PCI_BUS_ID 가정")
        elif want_uuid and have_uuid == want_uuid:
            say("ok", f"cuda:0 uuid 가 nvidia-smi GPU {os.environ.get('SOL_GPU_INDEX')} uuid 와 같다 ({have_uuid})")
        else:
            say("FAIL", f"cuda:0 uuid {have_uuid} 가 nvidia-smi 의 {want_uuid or '<없음>'} 과 다르다. 다른 GPU 를 잡았다. 학습 금지")
        free, total = torch.cuda.mem_get_info(0)
        say("info", f"cuda:0 free {free / 2**20:.0f} MiB / total {total / 2**20:.0f} MiB (torch 기준. nvidia-smi 값과 단위·컨텍스트가 다르다)")
except Exception as e:
    say("FAIL", f"torch import·CUDA 확인 실패: {e!r}")

for name in ("transformers", "peft", "safetensors", "accelerate", "huggingface_hub"):
    try:
        m = __import__(name)
        v = getattr(m, "__version__", "?")
        note(name, v)
        say("ok", f"{name} {v} (핀은 services/decision/pyproject.toml 이 정한다. 버전만 기록)")
    except Exception as e:
        say("FAIL" if name in ("transformers", "peft", "safetensors") else "warn", f"{name} 없음 ({e.__class__.__name__})")
PY
  collect < "$PY_OUT"
fi

# ── 6. Bosun snapshot: 고정 리비전 디렉터리, manifest.json 의 파일 sha256 전부, 핵심 두 파일 ↔ registry ─────────
echo "-- 6 Bosun 패키지 ($BOSUN_SNAP)"
SNAP_OK=0
FAILS_BEFORE_6=${#FAILS[@]}
if [ ! -d "$BOSUN_SNAP" ]; then
  fail "Hanno-Labs/bosun-v3.1-0.6b 고정 snapshot 없음: $BOSUN_SNAP. hf download Hanno-Labs/bosun-v3.1-0.6b --revision $SOL_BOSUN_REV (HF_HOME=$HF_HOME, 22 §2.2)"
elif [ ! -f "$BOSUN_SNAP/manifest.json" ]; then
  fail "snapshot 에 manifest.json 이 없다: $BOSUN_SNAP"
else
  for f in config.json "$ADAPTER_REL" "$EMB_REL" adapter/adapter_config.json; do
    [ -e "$BOSUN_SNAP/$f" ] || fail "snapshot 에 $f 가 없다"
  done
  if [ -x "$PY" ]; then
    SNAP="$BOSUN_SNAP" ADAPTER_REL="$ADAPTER_REL" EMB_REL="$EMB_REL" REG_ADAPTER_SHA="$REG_ADAPTER_SHA" REG_EMB_SHA="$REG_EMB_SHA" py_block > "$PY_OUT" <<'PY'
import hashlib, json, os, re

def say(level, msg): print(f"{level} {msg}", flush=True)

snap = os.environ["SNAP"]
HEX = re.compile(r"^(sha256:)?[0-9a-f]{64}$")

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def clean(s): return s.replace("sha256:", "")
def looks_path(k): return isinstance(k, str) and ("/" in k or "." in k)

pairs = {}
# manifest 형식은 content-addressed 라고만 알려져 있어(계획 §1.1) {path: sha}·{path: {sha256}}·[{path, sha256}] 세 꼴을 다 받는다
def walk(o, parent_key=None):
    if isinstance(o, dict):
        s = o.get("sha256") or o.get("sha256sum") or o.get("digest")
        p = o.get("path") or o.get("file") or o.get("name") or (parent_key if looks_path(parent_key) else None)
        if isinstance(s, str) and HEX.match(s) and isinstance(p, str):
            pairs.setdefault(p, clean(s))
        for k, v in o.items():
            if isinstance(v, str) and HEX.match(v) and looks_path(k):
                pairs.setdefault(k, clean(v))
            elif isinstance(v, (dict, list)):
                walk(v, k)
    elif isinstance(o, list):
        for it in o:
            walk(it, parent_key)

try:
    with open(os.path.join(snap, "manifest.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
except Exception as e:
    say("FAIL", f"manifest.json 을 읽지 못했다: {e!r}"); raise SystemExit(0)
walk(manifest)
if not pairs:
    say("warn", "manifest.json 에서 (파일, sha256) 쌍을 찾지 못했다(형식 미확인). 핵심 두 파일만 registry 값으로 대조한다")
bad = 0
for rel, want in sorted(pairs.items()):
    path = os.path.join(snap, rel)
    if not os.path.isfile(path):
        say("FAIL", f"manifest 의 {rel} 이 snapshot 에 없다"); bad += 1; continue
    got = sha(path)
    if got == want:
        say("ok", f"manifest {rel} sha256 일치")
    else:
        say("FAIL", f"manifest {rel} sha256 불일치: {got} (manifest {want}). 학습 금지"); bad += 1
if pairs and bad == 0:
    say("ok", f"manifest.json 의 파일 {len(pairs)}개 sha256 전부 일치")

for rel, env in ((os.environ["ADAPTER_REL"], "REG_ADAPTER_SHA"), (os.environ["EMB_REL"], "REG_EMB_SHA")):
    want = os.environ.get(env, "")
    path = os.path.join(snap, rel)
    if not os.path.isfile(path):
        continue   # 위에서 '없다' FAIL 을 이미 냈다
    got = sha(path)
    if not re.fullmatch(r"[0-9a-f]{64}", want):
        say("FAIL", f"{rel} 의 registry 기대값이 없어 대조할 수 없다(0번 FAIL 참고). 실제 {got}")
    elif got == want:
        say("ok", f"{rel} sha256 == registry ({got})")
    else:
        say("FAIL", f"{rel} sha256 {got} ≠ registry {want}. 학습 금지")
    if pairs and rel in pairs and pairs[rel] != want:
        say("warn", f"manifest 의 {rel} 값({pairs[rel]})과 registry 값({want})이 다르다. 두 정본 중 하나가 틀렸다")
PY
    collect < "$PY_OUT"
  else
    warn "venv 가 없어 manifest 대조를 bash 로만 한다(핵심 두 파일)"
    for pair in "$ADAPTER_REL:$REG_ADAPTER_SHA" "$EMB_REL:$REG_EMB_SHA"; do
      rel="${pair%%:*}"; want="${pair#*:}"
      [ -f "$BOSUN_SNAP/$rel" ] || continue
      got="$(sha256_of "$BOSUN_SNAP/$rel")"
      if [ -n "$want" ] && [ "$got" = "$want" ]; then ok "$rel sha256 == registry ($got)"; else fail "$rel sha256 $got ≠ registry ${want:-<없음>}. 학습 금지"; fi
    done
  fi
fi
# ⑧ 은 snapshot 의 modeling_bosun.py(trust_remote_code)를 실행하므로 이 절(6)에서 FAIL 이 하나도 없을 때만 돈다
if [ -d "$BOSUN_SNAP" ] && [ -f "$BOSUN_SNAP/manifest.json" ] && [ "${#FAILS[@]}" -eq "$FAILS_BEFORE_6" ]; then SNAP_OK=1; fi

# ── 7. 백본 snapshot ─────────────────────────────────────────────────────────────────────────────────
echo "-- 7 백본 ($BASE_SNAP)"
if [ -f "$BASE_SNAP/config.json" ]; then
  N_SHARDS="$(find "$BASE_SNAP" -maxdepth 1 -name '*.safetensors' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$N_SHARDS" -ge 1 ]; then ok "Qwen/Qwen3-0.6B@$SOL_BOSUN_BASE_REV 캐시 있음 (safetensors ${N_SHARDS}개)"; else fail "백본 snapshot 에 *.safetensors 가 없다: $BASE_SNAP"; fi
  for f in "$BASE_SNAP"/*.safetensors; do [ -f "$f" ] && info "백본 $(basename "$f") sha256 $(sha256_of "$f") (기대값 없음. docs/evidence/bosun-train-feasibility.md 에 기록, 22 §2.2)"; done
else
  fail "Qwen/Qwen3-0.6B@$SOL_BOSUN_BASE_REV 캐시 없음: $BASE_SNAP. hf download Qwen/Qwen3-0.6B --revision $SOL_BOSUN_BASE_REV (HF_HUB_OFFLINE=1 로 돌아 없으면 멈춘다)"
fi

# ── 8. CPU 로 Bosun 로드, LoRA 텐서 392·파라미터 10,092,544 ───────────────────────────────────────────────
echo "-- 8 모델 로드(CPU, HF_HUB_OFFLINE=1, local_files_only)"
if [ "$SKIP_LOAD" = 1 ]; then
  warn "--skip-load: 모델 로드·LoRA 텐서 수 확인을 건너뛰었다. F1 전에 한 번은 이 항목 없이 통과해야 한다"
elif [ ! -x "$PY" ]; then
  warn "venv 가 없어 모델 로드를 건너뛴다"
elif [ "$SNAP_OK" != 1 ] || [ ! -f "$BASE_SNAP/config.json" ]; then
  fail "snapshot sha256·백본 확인이 통과하지 않아 모델 코드를 실행하지 않는다(trust_remote_code 는 검증된 snapshot 에만)"
else
  SNAP="$BOSUN_SNAP" EXPECT_T="$EXPECT_LORA_TENSORS" EXPECT_P="$EXPECT_LORA_PARAMS" py_block > "$PY_OUT" <<'PY'
import os, time

def say(level, msg): print(f"{level} {msg}", flush=True)

os.environ["HF_HUB_OFFLINE"] = "1"
snap = os.environ["SNAP"]
want_t, want_p = int(os.environ["EXPECT_T"]), int(os.environ["EXPECT_P"])
try:
    import torch
    from transformers import AutoModelForCausalLM
    t0 = time.time()
    model = AutoModelForCausalLM.from_pretrained(snap, trust_remote_code=True, local_files_only=True)
    say("ok", f"from_pretrained {time.time() - t0:.1f}s, class {type(model).__name__}" + ("" if type(model).__name__ == "BosunForDecision" else " (BosunForDecision 이 아니다 — auto_map 확인)"))
    devs = {str(p.device) for p in model.parameters()}
    say("ok" if devs == {"cpu"} else "FAIL", f"파라미터 device {sorted(devs)} (CPU 로만 올려야 한다)")
    lora = [(n, p) for n, p in model.named_parameters() if "lora_" in n]
    n_t, n_p = len(lora), sum(p.numel() for _, p in lora)
    say("ok" if (n_t, n_p) == (want_t, want_p) else "FAIL", f"lora_ 텐서 {n_t}개, 파라미터 {n_p:,} (기대 {want_t}개·{want_p:,}. r=16 × 7모듈 × 28층, ADR-034 7번)")
    n_tr = sum(1 for _, p in model.named_parameters() if p.requires_grad)
    say("info", f"requires_grad=True 파라미터 {n_tr}개 (어댑터가 is_trainable=False 로 올라오면 0. 학습기가 lora_ 만 켠다)")
    emb = [n for n, _ in model.named_parameters() if "embed" in n or "lm_head" in n]
    say("info", f"임베딩·출력 텐서 {len(emb)}개는 동결 대상(decision token 256행 포함)")
    api = [a for a in ("predict", "decision_logits", "render_decision_prompt") if hasattr(model, a)]
    say("ok" if len(api) == 3 else "warn", f"공개 API {api} (서빙·학습이 쓰는 세 함수)")
except Exception as e:
    say("FAIL", f"모델 로드 실패: {e!r}")
PY
  collect < "$PY_OUT"
fi

# ── 9. 학습 데이터: 레코드 수, state 길이 분포(문자/4), --max-state-tokens 후보별 초과 건수 ──────────────────
echo "-- 9 학습 데이터 ($SOL_TRAIN_DATA)"
if [ ! -f "$SOL_TRAIN_DATA" ]; then
  warn "학습 데이터 없음: $SOL_TRAIN_DATA (B3 번들 반입 전이면 정상. bosun-f1.sh 전에는 필요)"
elif [ ! -x "$PY" ]; then
  warn "venv 가 없어 데이터 검사를 건너뛴다"
else
  SOL_TRAIN_DATA="$SOL_TRAIN_DATA" SNAP="$BOSUN_SNAP" SNAP_OK="$SNAP_OK" py_block > "$PY_OUT" <<'PY'
import collections, json, os, statistics

def say(level, msg): print(f"{level} {msg}", flush=True)

path = os.environ["SOL_TRAIN_DATA"]
recs, bad = [], 0
with open(path, encoding="utf-8") as fh:
    for i, line in enumerate(fh, 1):
        line = line.strip()
        if not line:
            continue
        try:
            recs.append(json.loads(line))
        except Exception:
            bad += 1
if bad:
    say("FAIL", f"{path}: JSON 이 아닌 줄 {bad}개")
if not recs:
    say("FAIL", f"{path}: 레코드 0건"); raise SystemExit(0)
need = ("rowId", "qid", "questionType", "instructions", "candidates", "state", "gold")
missing = collections.Counter(k for r in recs for k in need if k not in r)
say("ok" if not missing else "FAIL", f"레코드 {len(recs)}건" + ("" if not missing else f", 필수 필드 누락 {dict(missing)} (22 §4.1 형식)"))
types = collections.Counter(r.get("questionType") for r in recs)
say("info", "questionType: " + ", ".join(f"{k}={v}" for k, v in sorted(types.items(), key=str)))
labels = collections.Counter((r.get("qid", "?").split("[")[0], str((r.get("gold") or {}).get("candidateId"))) for r in recs)
by_q = collections.defaultdict(int)
for (q, _), c in labels.items():
    by_q[q] += c
for (q, l), c in sorted(labels.items()):
    pct = 100 * c / by_q[q]
    say("info", f"  {q} / {l}: {c} ({pct:.1f}%)" + (" <5% (22 §4.1 선택지 비율)" if pct < 5 else ""))
src = collections.Counter(r.get("labelSource") for r in recs)
say("info", "labelSource: " + ", ".join(f"{k}={v}" for k, v in sorted(src.items(), key=str)))
if any(r.get("split") not in (None, "train") for r in recs):
    say("warn", f"split 이 train 이 아닌 레코드 {sum(1 for r in recs if r.get('split') not in (None, 'train'))}건 (dev·test 누수?)")
conflict = collections.defaultdict(set)
for r in recs:
    conflict[(r.get("stateHash"), r.get("qid"))].add(str((r.get("gold") or {}).get("candidateId")))
n_conf = sum(1 for v in conflict.values() if len(v) > 1)
say("ok" if n_conf == 0 else "FAIL", f"같은 (stateHash, qid) 에 다른 gold 가 붙은 경우 {n_conf}건 (0 이어야 한다. 22 §4.1)")

est = sorted(len(str(r.get("state", ""))) / 4 for r in recs)   # 문자/4 추정 토큰
def pct_(p): return est[min(len(est) - 1, int(p * (len(est) - 1)))]
say("info", f"state 추정 토큰(문자/4): min {est[0]:.0f} · median {statistics.median(est):.0f} · p95 {pct_(0.95):.0f} · max {est[-1]:.0f}")
exact = None
if os.environ.get("SNAP_OK") == "1":
    try:
        from transformers import AutoTokenizer
        snap = os.environ["SNAP"]
        tok = None
        for cand in (snap, os.path.join(snap, "tokenizer")):
            try:
                tok = AutoTokenizer.from_pretrained(cand, local_files_only=True); break
            except Exception:
                continue
        if tok is not None:
            exact = sorted(len(tok(str(r.get("state", "")), add_special_tokens=False)["input_ids"]) for r in recs)
            say("info", f"state 실제 토큰(패키지 토크나이저): min {exact[0]} · median {statistics.median(exact):.0f} · p95 {exact[min(len(exact)-1, int(0.95*(len(exact)-1)))]} · max {exact[-1]} (프롬프트·instructions 는 제외)")
        else:
            say("warn", "패키지 토크나이저를 못 열어 실제 토큰 수는 건너뛴다(문자/4 추정만)")
    except Exception as e:
        say("warn", f"토크나이저 길이 검사 실패 ({e.__class__.__name__}). 문자/4 추정만")
say("info", "--max-state-tokens 후보별 초과 건수(초과 레코드는 학습기가 skip 한다. Bosun 자체는 state 를 자르지 않는다 — 22 §4.1):")
for ms in (1024, 2048, 4096, 6144):
    over_est = sum(1 for v in est if v > ms)
    line = f"  {ms}: 추정 초과 {over_est} / {len(est)}"
    if exact is not None:
        line += f" · 실제 초과 {sum(1 for v in exact if v > ms)}"
    say("ok" if over_est == 0 else "info", line)
PY
  collect < "$PY_OUT"
fi

# ── 10. sol_decision: venv 에서 import, CLI --help ─────────────────────────────────────────────────────
echo "-- 10 sol_decision ($SOL_DECISION_SRC)"
if [ -d "$SOL_DECISION_SRC" ]; then ok "소스 디렉터리 있음: $SOL_DECISION_SRC"; else warn "소스 디렉터리가 없다: $SOL_DECISION_SRC (wheel 로 설치했으면 정상. SOL_DECISION_SRC 로 경로를 준다)"; fi
if [ -d "$SOL_REPO/.git" ]; then info "저장소 commit $(git -C "$SOL_REPO" rev-parse HEAD 2>/dev/null || echo '?')"; fi
if [ -x "$PY" ]; then
  if "$PY" -c 'import sol_decision' >/dev/null 2>&1; then
    ok "import sol_decision ($("$PY" -c 'import sol_decision, os; print(os.path.dirname(sol_decision.__file__))' 2>/dev/null || echo '?'))"
    if "$PY" -m sol_decision --help >/dev/null 2>&1; then ok "python -m sol_decision --help"; else warn "python -m sol_decision --help 실패(__main__ 없음일 수 있다. import 는 된다)"; fi
    # 학습기·parity CLI. 인터페이스(--package --data --out --max-steps --batch --accum --device --bf16 --grad-checkpointing --max-state-tokens / --n)는
    # 다른 작업자가 만들고 있다. 미세 차이는 F1 전에 bosun-f1.sh 와 맞춘다
    if "$PY" -m sol_decision.train --help >/dev/null 2>&1; then ok "python -m sol_decision.train --help"; else fail "python -m sol_decision.train --help 실패(bosun-f1.sh 가 부르는 학습기)"; fi
    if "$PY" -m sol_decision.parity --help >/dev/null 2>&1; then ok "python -m sol_decision.parity --help"; else warn "python -m sol_decision.parity --help 실패(F1 뒤 재로딩·predict 동일성 검사에 쓴다)"; fi
  else
    fail "venv 에서 import sol_decision 실패. 22 §3.2 의 --dry-run → 설치 순서(torch 불변 확인 뒤)"
  fi
fi

# ── 11. 디스크 ──────────────────────────────────────────────────────────────────────────────────────────
echo "-- 11 디스크"
if [ -d "$SOL_WORK" ]; then
  AVAIL_MB="$(df -Pm "$SOL_WORK" | awk 'NR==2 {print $4}')"
  if [ "${AVAIL_MB:-0}" -ge 20480 ]; then ok "$SOL_WORK 여유 $((AVAIL_MB / 1024)) GB"; else warn "$SOL_WORK 여유 $((AVAIL_MB / 1024)) GB < 20 GB(0.6B 패키지·run 디렉터리·로그)"; fi
else
  fail "SOL_WORK 가 없다: $SOL_WORK"
fi

# ── 12. 요약·안전한 시작·중단 조건·통과 표식 ───────────────────────────────────────────────────────────────
echo "-- 12 요약"
echo "모델별 안전한 시작·중단 조건(GPU $SOL_GPU_INDEX 공유, 단위 MiB. 추정치는 F1 실측 뒤 갱신):"
echo "  | 상주·작업 | 값 | 비고 |"
echo "  |---|---:|---|"
echo "  | GPU 총량 | ${TOTAL_MIB:-?} | nvidia-smi memory.total |"
echo "  | 지금 사용 중(PaddleOCR 등, 회사) | ${USED_MIB:-?} | 종료·이동 금지. 기록만 |"
echo "  | 지금 free | ${FREE_MIB:-?} | |"
echo "  | sol_decision.serve(추정) | ${SOL_EST_SERVE_MIB} | GPU 승인 + 예산 통과 뒤 **사용자 승인** 시에만 기동. 8009 는 127.0.0.1 만 |"
echo "  | Bosun LoRA 학습 F1(추정) | ${SOL_EST_TRAIN_MIB} | 서빙과 동시에 돌리지 않는다. 돌려야 하면 합산 $((SOL_EST_SERVE_MIB + SOL_EST_TRAIN_MIB)) 이 free 안에 들어야 한다 |"
echo "  | 여유 | ${SOL_RESERVE_MIB} | PaddleOCR 피크·CUDA 컨텍스트 |"
echo "  | 필요 합계 | ${SOL_REQUIRED_MIB} | free ≥ 이 값이어야 통과(④) |"
echo "  중단: 자기 PID(학습기·자기 기록 프로세스)만 멈춘다. GPU 0·1·2 의 다른 프로세스는 어떤 경우에도 kill·pkill 하지 않는다. OOM 이면 더 큰 설정을 시도하지 않고 사용자에게 보고."
if [ "${#WARNS[@]}" -gt 0 ]; then echo "warn ${#WARNS[@]}건:"; printf '   - %s\n' "${WARNS[@]}"; fi
if [ "${#FAILS[@]}" -gt 0 ]; then
  echo "FAIL ${#FAILS[@]}건:"; printf '   - %s\n' "${FAILS[@]}"
  echo "preflight 실패. bosun-f1.sh 를 돌리지 않는다. 표식을 남기지 않는다. 로그: $LOG"
  exit 1
fi
{
  echo "date=$(date -Iseconds)"
  echo "host=$(hostname)"
  echo "gpu_index=$SOL_GPU_INDEX"
  echo "gpu_uuid=$GPU_UUID"
  echo "gpu_bus_id=$GPU_BUS"
  echo "gpu_free_mib=$FREE_MIB"
  echo "gpu_used_mib=$USED_MIB"
  echo "required_mib=$SOL_REQUIRED_MIB"
  echo "share_approved=1"
  echo "venv=$SOL_BOSUN_VENV"
  echo "registry=$SOL_REGISTRY"
  echo "bosun_snapshot=$BOSUN_SNAP"
  echo "bosun_revision=$SOL_BOSUN_REV"
  echo "bosun_adapter_sha256=$REG_ADAPTER_SHA"
  echo "bosun_embeddings_sha256=$REG_EMB_SHA"
  echo "base_snapshot=$BASE_SNAP"
  echo "base_revision=$SOL_BOSUN_BASE_REV"
  echo "model_load_checked=$([ "$SKIP_LOAD" = 1 ] && echo 0 || echo 1)"
  [ -s "$PY_ENV_FILE" ] && cat "$PY_ENV_FILE"   # python=·torch=·transformers=·peft=·safetensors=…
  echo "log=$LOG"
} > "$MARK"
echo "preflight 통과 (warn ${#WARNS[@]}건). 표식: $MARK, 로그: $LOG"
echo "다음(사용자 승인 뒤): SOL_GPU_SHARE_APPROVED=1 SOL_TRAIN_APPROVED=1 bash infra/gpu/bosun-f1.sh --max-steps 20"
