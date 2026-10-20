#!/usr/bin/env bash
# SOL RADAR — Kev-9B LoRA F1-A 사전 검증 (회사 GPU 서버 sol-NF5280M6, 물리 GPU 1 전용).
# 정본: docs/22-FINETUNE-RUNBOOK.md §3·§4.2, docs/23-WEEKEND-FINETUNE.md §5.2, docs/10-DEPLOYMENT.md "학습 전용 GPU".
#
# 읽기만 한다. GPU 0·2 와 다른 프로세스는 보기만 하고, 어떤 프로세스도 종료하지 않으며(kill·pkill·docker compose down 없음),
# 파일을 지우거나 덮어쓰지 않는다. 비밀 값을 출력하지 않는다(set -x 금지).
# 통과 표식(runs/preflight-ok)은 FAIL 이 0건일 때만 남긴다. 체크포인트(kev-9b 고정 커밋 snapshot)·백본 캐시가 없거나
# sha256 이 다르면 FAIL 이다. 모델을 받기 전에 환경·커널만 보려고 돌리면 FAIL 로 끝나는 것이 정상이고 표식은 생기지 않는다.
#
# 사용(서버 셸, 계정 bim):
#   export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1
#   bash infra/gpu/kev-preflight.sh
# SSH 를 다시 열면 위 export 는 사라진다. 매 세션 다시 적고, 이 스크립트가 그 값을 확인한다.
#
# 환경 변수(없으면 기본값):
#   SOL_WORK          /data/www/ai_workspace/sol-radar      SOL RADAR 전용 작업 루트
#   SOL_GPU_INDEX     1                                       허용된 물리 GPU index(nvidia-smi 기준). 0·2 는 회사 서비스
#   SOL_KEV_VENV      $SOL_WORK/.venv-kev                     Python 3.12 가상환경(torch 2.8.0+cu128 설치됨)
#   SOL_KEV_SRC       $SOL_WORK/kev                           jaredpalmer/kev 소스(고정 커밋)
#   SOL_KEV_COMMIT    1f04cfa28e6a708485b28a9585010b9e436b776e
#   HF_HOME           $SOL_WORK/hf                            Hugging Face 캐시
#   SOL_TRAIN_DATA    $SOL_WORK/sol-dataset-v0.1/kev/train.en.jsonl   없으면 데이터 검사만 건너뛴다
#   SOL_RUNS_DIR      $SOL_WORK/runs                          로그·결과·통과 표식(preflight-ok)
#   SOL_MIN_FREE_MIB  40000                                   GPU 1 최소 여유 메모리(MiB)
#   SOL_ALLOW_SHARED_GPU  (비워 둠)  1 이면 GPU 1 에 다른 프로세스가 있어도 FAIL 대신 warn
#   SOL_EXPECT_TORCH  2.8.0+cu128    venv 의 torch 가 이 값과 다르면 FAIL(설치가 torch 를 바꿨다는 뜻)
#   SOL_EXPECT_TRITON 3.4.0          venv 의 triton 이 이 값과 다르면 FAIL(torch 2.8.0 의 고정값)
set -euo pipefail

SOL_WORK="${SOL_WORK:-/data/www/ai_workspace/sol-radar}"
SOL_GPU_INDEX="${SOL_GPU_INDEX:-1}"
SOL_KEV_VENV="${SOL_KEV_VENV:-$SOL_WORK/.venv-kev}"
SOL_KEV_SRC="${SOL_KEV_SRC:-$SOL_WORK/kev}"
SOL_KEV_COMMIT="${SOL_KEV_COMMIT:-1f04cfa28e6a708485b28a9585010b9e436b776e}"
export HF_HOME="${HF_HOME:-$SOL_WORK/hf}"
SOL_TRAIN_DATA="${SOL_TRAIN_DATA:-$SOL_WORK/sol-dataset-v0.1/kev/train.en.jsonl}"
SOL_RUNS_DIR="${SOL_RUNS_DIR:-$SOL_WORK/runs}"
SOL_MIN_FREE_MIB="${SOL_MIN_FREE_MIB:-40000}"
SOL_ALLOW_SHARED_GPU="${SOL_ALLOW_SHARED_GPU:-}"
SOL_EXPECT_TORCH="${SOL_EXPECT_TORCH:-2.8.0+cu128}"
SOL_EXPECT_TRITON="${SOL_EXPECT_TRITON:-3.4.0}"
export CUDA_DEVICE_ORDER="${CUDA_DEVICE_ORDER:-PCI_BUS_ID}"

# 고정 리비전과 2026-10-20 Hugging Face 에서 받아 계산한 sha256(docs/22 §2.1·§2.2, services/ai/models/registry.yaml).
# 다르면 학습을 시작하지 않는다. 체크포인트는 태그(v1.0)가 아니라 커밋 sha 의 snapshot 디렉터리로만 쓴다(태그는 옮겨질 수 있다).
KEV9B_BASE="Qwen/Qwen3.5-9B-Base"
KEV9B_BASE_REV="68c46c4b3498877f3ef123c856ecfde50c39f404"
KEV9B_REV="3afdec81efc91da83dee06d30714adf54ee35531"   # jaredpalmer/kev-9b 태그 v1.0 이 가리키는 커밋(2026-10-20 Hub refs)
KEV9B_ADAPTER_SHA="2b2a70cf4ef4440b6c22899e1f72c2f8ea5c6f65b19aa344539b4b8971d1f13d"
KEV9B_HEAD_SHA="8e1dab2c8e3664f6fee843e0257d57946c25e0210c61901ea77e71761f4244e1"
KEV_SUITES_REV="cc4bac803e73112689ec327ffa481c519cbc7a05"

mkdir -p "$SOL_RUNS_DIR"
LOG="$SOL_RUNS_DIR/preflight-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

FAILS=()
WARNS=()
ok() { echo "ok    $*"; }
info() { echo "info  $*"; }
warn() { echo "warn  $*"; WARNS+=("$*"); }
fail() { echo "FAIL  $*"; FAILS+=("$*"); }
# python 블록이 내는 "ok|warn|FAIL|info <메시지>" 줄을 같은 집계로 모은다
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

echo "== SOL RADAR Kev F1-A preflight $(date -Iseconds) host=$(hostname) user=$(id -un)"
echo "== 로그: $LOG"
echo "== SOL_WORK=$SOL_WORK  GPU=$SOL_GPU_INDEX  venv=$SOL_KEV_VENV  kev=$SOL_KEV_SRC  HF_HOME=$HF_HOME"

# ── 1. 환경 변수: 물리 GPU 1 만 보이게 ─────────────────────────────────────────────────────────
echo "-- 1 환경 변수"
if [ "${CUDA_VISIBLE_DEVICES:-}" = "$SOL_GPU_INDEX" ]; then
  ok "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES (프로세스 안에서는 cuda:0 으로 보인다. 정상)"
else
  fail "CUDA_VISIBLE_DEVICES 가 '$SOL_GPU_INDEX' 이 아니다(현재 '${CUDA_VISIBLE_DEVICES:-<없음>}'). export CUDA_VISIBLE_DEVICES=$SOL_GPU_INDEX 뒤 다시 실행"
fi
if [ "$CUDA_DEVICE_ORDER" = "PCI_BUS_ID" ]; then
  ok "CUDA_DEVICE_ORDER=PCI_BUS_ID (nvidia-smi 번호와 CUDA 번호를 맞춘다)"
else
  fail "CUDA_DEVICE_ORDER 가 PCI_BUS_ID 가 아니다('$CUDA_DEVICE_ORDER'). export CUDA_DEVICE_ORDER=PCI_BUS_ID"
fi

# ── 2. nvidia-smi: GPU 3장 상태, GPU 1 점유 프로세스·여유 메모리 ───────────────────────────────
echo "-- 2 nvidia-smi"
GPU_UUID=""
if ! command -v nvidia-smi >/dev/null 2>&1; then
  fail "nvidia-smi 가 없다"
else
  nvidia-smi --query-gpu=index,name,uuid,memory.used,memory.total,compute_cap --format=csv || nvidia-smi -L
  GPU_UUID="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=uuid --format=csv,noheader 2>/dev/null | tr -d ' ' || true)"
  if [ -z "$GPU_UUID" ]; then
    fail "nvidia-smi -i $SOL_GPU_INDEX 가 GPU 를 돌려주지 않는다"
  else
    ok "GPU $SOL_GPU_INDEX uuid=$GPU_UUID"
    FREE_MIB="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-gpu=memory.free --format=csv,noheader,nounits | tr -d ' ')"
    if [ "${FREE_MIB:-0}" -ge "$SOL_MIN_FREE_MIB" ]; then
      ok "GPU $SOL_GPU_INDEX 여유 메모리 ${FREE_MIB} MiB (기준 ${SOL_MIN_FREE_MIB} MiB 이상)"
    else
      fail "GPU $SOL_GPU_INDEX 여유 메모리 ${FREE_MIB:-?} MiB < ${SOL_MIN_FREE_MIB} MiB. 다른 작업이 쓰고 있다. 종료하지 말고 회사에 확인"
    fi
    APPS="$(nvidia-smi -i "$SOL_GPU_INDEX" --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>/dev/null || true)"
    if [ -z "$APPS" ]; then
      ok "GPU $SOL_GPU_INDEX 에 다른 compute 프로세스 없음"
    elif [ "$SOL_ALLOW_SHARED_GPU" = "1" ]; then
      warn "GPU $SOL_GPU_INDEX 에 다른 프로세스가 있다(SOL_ALLOW_SHARED_GPU=1 로 계속): $APPS"
    else
      fail "GPU $SOL_GPU_INDEX 에 다른 프로세스가 있다(종료하지 않는다. 회사에 확인): $APPS"
    fi
  fi
fi

# ── 3. 디스크 ───────────────────────────────────────────────────────────────────────────────────
echo "-- 3 디스크"
if [ -d "$SOL_WORK" ]; then
  AVAIL_MB="$(df -Pm "$SOL_WORK" | awk 'NR==2 {print $4}')"
  if [ "${AVAIL_MB:-0}" -ge 102400 ]; then ok "$SOL_WORK 여유 $((AVAIL_MB / 1024)) GB"; else warn "$SOL_WORK 여유 $((AVAIL_MB / 1024)) GB < 100 GB(백본 19.3 GB + 체크포인트·캐시)"; fi
else
  fail "SOL_WORK 가 없다: $SOL_WORK"
fi

# ── 4. venv·torch·CUDA·bf16·GPU 매핑, 패키지, fla 커널 smoke ──────────────────────────────────────
echo "-- 4 Python 환경 ($SOL_KEV_VENV)"
PY="$SOL_KEV_VENV/bin/python"
if [ ! -x "$PY" ]; then
  fail "venv python 이 없다: $PY"
else
  SOL_GPU_UUID="$GPU_UUID" SOL_GPU_INDEX="$SOL_GPU_INDEX" SOL_MIN_FREE_MIB="$SOL_MIN_FREE_MIB" SOL_KEV_SRC="$SOL_KEV_SRC" \
  SOL_EXPECT_TORCH="$SOL_EXPECT_TORCH" SOL_EXPECT_TRITON="$SOL_EXPECT_TRITON" SOL_ENV_FILE="$SOL_RUNS_DIR/preflight-env.tmp" "$PY" -I - <<'PY' | collect
import os, sys, time

def say(level, msg): print(f"{level} {msg}", flush=True)

seen = {}   # 통과 표식에 적을 버전(SOL_ENV_FILE)
def note(key, value):
    seen[key] = value
    with open(os.environ["SOL_ENV_FILE"], "w", encoding="utf-8") as fh:
        fh.write("".join(f"{k}={v}\n" for k, v in seen.items()))

def vtuple(v):
    out = []
    for part in str(v).split("+")[0].split("."):
        digits = "".join(ch for ch in part if ch.isdigit())
        out.append(int(digits) if digits else 0)
    return tuple(out)

pyv = sys.version.split()[0]
say("ok" if sys.version_info[:2] in ((3, 12), (3, 13)) else "FAIL", f"python {pyv} (kev: >=3.12,<3.14)")

try:
    import numpy
    if vtuple(numpy.__version__) >= (2, 5, 3):
        say("ok", f"numpy {numpy.__version__} (kev 요구 >=2.5.3)")
    else:
        say("warn", f"numpy {numpy.__version__} < 2.5.3 (kev 요구. kev 설치가 올린다)")
except Exception as e:
    say("FAIL", f"numpy 없음 ({e.__class__.__name__}). kev 설치(uv pip install) 가 함께 넣는다. torch import 경고의 원인")

cuda_ok = False
try:
    import torch
    tv = torch.__version__
    note("torch", tv)
    want_torch = os.environ["SOL_EXPECT_TORCH"]
    if tv == want_torch:
        say("ok", f"torch {tv} (2026-10-20 확인값과 같다)")
    else:
        say("FAIL", f"torch {tv} 가 기대값 {want_torch} 와 다르다. 설치가 torch 를 바꿨다(cu128 빌드가 아니면 CUDA 경로가 다르다). docs/22 §3.2 의 --dry-run 으로 원인 확인. 의도한 값이면 SOL_EXPECT_TORCH 로 명시")
    if not torch.cuda.is_available():
        say("FAIL", "torch.cuda.is_available() False")
    else:
        n = torch.cuda.device_count()
        say("ok" if n == 1 else "FAIL", f"보이는 GPU 수 {n} (CUDA_VISIBLE_DEVICES 가 적용되면 1)")
        p = torch.cuda.get_device_properties(0)
        say("ok" if "A40" in p.name else "warn", f"cuda:0 = {p.name}")
        say("ok" if (p.major, p.minor) == (8, 6) else "warn", f"compute capability {p.major}.{p.minor} (A40 = 8.6, Ampere. Hopper 아님 → fla 의 triton 3.4~3.7.0 거부 조건에 해당하지 않음)")
        free, total = torch.cuda.mem_get_info(0)
        say("info", f"cuda:0 free {free / 2**30:.2f} GiB / total {total / 2**30:.2f} GiB (nvidia-smi 의 46,068 MiB 와 단위가 다르다)")
        say("ok" if free / 2**20 >= float(os.environ["SOL_MIN_FREE_MIB"]) else "FAIL", f"cuda:0 여유 {free / 2**20:.0f} MiB (기준 {os.environ['SOL_MIN_FREE_MIB']} MiB)")
        say("ok" if torch.cuda.is_bf16_supported() else "FAIL", f"bf16 지원 {torch.cuda.is_bf16_supported()}")
        want = os.environ.get("SOL_GPU_UUID", "").replace("GPU-", "").lower()
        have = str(getattr(p, "uuid", "")).lower()
        if not have:
            say("warn", "torch 가 GPU uuid 를 주지 않는다. nvidia-smi 번호와의 대응은 CUDA_DEVICE_ORDER=PCI_BUS_ID 가정")
        elif want and have == want:
            say("ok", f"cuda:0 uuid 가 nvidia-smi GPU {os.environ.get('SOL_GPU_INDEX', '1')} uuid 와 같다 ({have})")
        else:
            say("FAIL", f"cuda:0 uuid {have} 가 nvidia-smi 의 {want or '<없음>'} 과 다르다. 다른 GPU 를 잡았다. 학습 금지")
        cuda_ok = n >= 1
except Exception as e:
    say("FAIL", f"torch import·CUDA 확인 실패: {e!r}")

for name, lo, hi, must in (("transformers", (5, 17), (6,), True), ("peft", (0, 21), None, True), ("accelerate", (1, 15), None, True),
                            ("datasets", (3,), None, True), ("safetensors", None, None, True), ("huggingface_hub", None, None, True),
                            ("sklearn", None, None, True), ("pydantic", (2, 9), None, True)):
    try:
        m = __import__(name)
        v = getattr(m, "__version__", "?")
        bad = (lo and vtuple(v) < lo) or (hi and vtuple(v) >= hi)
        say("warn" if bad else "ok", f"{name} {v}" + (f" (kev 요구 >={'.'.join(map(str, lo))}{', <' + '.'.join(map(str, hi)) if hi else ''})" if bad else ""))
    except Exception as e:
        say("FAIL" if must else "info", f"{name} 없음 ({e.__class__.__name__})")

try:
    import triton
    note("triton", triton.__version__)
    want_triton = os.environ["SOL_EXPECT_TRITON"]
    if triton.__version__ == want_triton:
        say("ok", f"triton {triton.__version__} (torch 2.8.0 의 고정값. A40 에서는 올리지 않는다)")
    else:
        say("FAIL", f"triton {triton.__version__} 가 기대값 {want_triton} 와 다르다. 설치가 triton 을 바꿨다(torch 2.8.0 은 3.4.0 고정). 의도한 값이면 SOL_EXPECT_TRITON 로 명시")
except Exception as e:
    say("FAIL", f"triton 없음 ({e.__class__.__name__})")

fla_ok = False
try:
    import fla
    fv = getattr(fla, "__version__", "?")
    say("ok" if fv == "0.5.2" else "FAIL", f"flash-linear-attention {fv} (kev 의 fused 커널은 정확히 0.5.2)")
    fla_ok = fv == "0.5.2"
except Exception as e:
    say("FAIL", f"flash-linear-attention 없음 ({e.__class__.__name__}). uv pip install flash-linear-attention==0.5.2")

try:
    import causal_conv1d
    say("info", f"causal-conv1d {getattr(causal_conv1d, '__version__', '?')} (선택. 없으면 transformers 가 느린 참조 구현을 쓴다)")
except Exception:
    say("info", "causal-conv1d 없음 (선택)")

try:
    import kev
    src = os.path.realpath(os.path.dirname(kev.__file__))
    want_src = os.path.realpath(os.environ["SOL_KEV_SRC"])
    say("ok" if src.startswith(want_src) else "warn", f"kev import {src}" + ("" if src.startswith(want_src) else f" (SOL_KEV_SRC={want_src} 밖이다)"))
    from kev.model import MAX_STATE, MAX_TRAIN_STATE
    say("info", f"kev.train --max_state 범위 [{MAX_STATE}, {MAX_TRAIN_STATE}]")
except Exception as e:
    say("FAIL", f"kev import 실패 ({e!r}). uv pip install \"kev @ file://$SOL_KEV_SRC\"")

if cuda_ok and fla_ok:
    try:
        import torch
        from fla.ops.gated_delta_rule import chunk_gated_delta_rule
        B, T, H, K, V = 1, 512, 4, 64, 64
        dev = torch.device("cuda:0")
        q = torch.randn(B, T, H, K, device=dev, dtype=torch.bfloat16, requires_grad=True)
        k = torch.randn(B, T, H, K, device=dev, dtype=torch.bfloat16, requires_grad=True)
        v = torch.randn(B, T, H, V, device=dev, dtype=torch.bfloat16, requires_grad=True)
        g = (-torch.nn.functional.softplus(torch.randn(B, T, H, device=dev))).requires_grad_(True)
        beta = torch.sigmoid(torch.randn(B, T, H, device=dev, dtype=torch.bfloat16))
        torch.cuda.synchronize(); t0 = time.time()
        o, _ = chunk_gated_delta_rule(q, k, v, g, beta, output_final_state=False)
        o.float().sum().backward()
        torch.cuda.synchronize()
        say("ok", f"Gated DeltaNet 커널 smoke(chunk_gated_delta_rule fwd+bwd, bf16, T={T}) {time.time() - t0:.1f}s (첫 호출은 Triton 컴파일 포함), peak {torch.cuda.max_memory_allocated() / 2**20:.0f} MiB")
    except Exception as e:
        say("FAIL", f"Gated DeltaNet 커널 smoke 실패: {e!r}. A40(Ampere) + triton 3.4.0 조합의 실행 가능 여부를 여기서 판단한다. docs/22 §3.2")
else:
    say("info", "fla 커널 smoke 건너뜀(torch/CUDA 또는 fla 확인 실패)")
PY
fi

# ── 5. Kev 소스 고정 커밋, CLI ──────────────────────────────────────────────────────────────────
echo "-- 5 Kev 소스"
if [ ! -d "$SOL_KEV_SRC/.git" ]; then
  fail "Kev 소스가 없다: $SOL_KEV_SRC (git clone https://github.com/jaredpalmer/kev.git \"$SOL_KEV_SRC\" && git -C \"$SOL_KEV_SRC\" checkout $SOL_KEV_COMMIT)"
else
  HEAD="$(git -C "$SOL_KEV_SRC" rev-parse HEAD 2>/dev/null || echo '?')"
  if [ "$HEAD" = "$SOL_KEV_COMMIT" ]; then ok "kev commit $HEAD"; else fail "kev commit 이 $HEAD 다. 고정 커밋 $SOL_KEV_COMMIT 로 checkout"; fi
  if [ -n "$(git -C "$SOL_KEV_SRC" status --porcelain 2>/dev/null)" ]; then warn "kev 소스 트리에 수정이 있다(git status). 포크·패치는 22 §4.2 ⑤ 마지막 수단"; fi
  if [ -f "$SOL_KEV_SRC/evals/v7/decision-v7/manifest.json" ]; then ok "decision-v7 manifest 있음(F2 --suite)"; else warn "evals/v7/decision-v7/manifest.json 없음"; fi
  if [ -x "$PY" ]; then
    if "$PY" -m kev.train --help >/dev/null 2>&1; then ok "python -m kev.train --help"; else fail "python -m kev.train --help 실패"; fi
    if "$PY" -m kev.benchmark --help >/dev/null 2>&1; then ok "python -m kev.benchmark --help"; else fail "python -m kev.benchmark --help 실패"; fi
    if [ -f "$SOL_KEV_SRC/scripts/calibrate_checkpoint.py" ]; then ok "scripts/calibrate_checkpoint.py 있음(F3)"; else warn "scripts/calibrate_checkpoint.py 없음(F3)"; fi
  fi
fi

# ── 6. Hugging Face 캐시: 체크포인트·백본·replay, sha256 ───────────────────────────────────────────
echo "-- 6 모델 파일 ($HF_HOME)"
sha_check() { # <파일> <기대 sha256> <이름>
  local f="$1" want="$2" name="$3" got
  got="$(sha256sum "$f" | awk '{print $1}')"
  if [ "$got" = "$want" ]; then ok "$name sha256 일치 ($got)"; else fail "$name sha256 불일치: $got (기대 $want). 학습 금지"; fi
}
# 체크포인트: 태그가 아니라 고정 커밋의 snapshot 디렉터리. 없거나 sha256 이 다르면 FAIL(표식을 남기지 않는다 → kev-f1.sh 가 돌지 않는다)
KEV_SNAP="$HF_HOME/hub/models--jaredpalmer--kev-9b/snapshots/$KEV9B_REV"
if [ ! -d "$KEV_SNAP" ]; then
  fail "jaredpalmer/kev-9b 고정 snapshot 없음: $KEV_SNAP. hf download jaredpalmer/kev-9b --revision $KEV9B_REV (HF_HOME=$HF_HOME. 태그 v1.0 으로 받아도 같은 디렉터리가 생긴다)"
else
  info "kev-9b snapshot $KEV_SNAP"
  for f in adapter_model.safetensors head.pt adapter_config.json training_config.json; do
    [ -e "$KEV_SNAP/$f" ] || fail "kev-9b snapshot 에 $f 가 없다"
  done
  [ -e "$KEV_SNAP/adapter_model.safetensors" ] && sha_check "$KEV_SNAP/adapter_model.safetensors" "$KEV9B_ADAPTER_SHA" "kev-9b adapter_model.safetensors"
  [ -e "$KEV_SNAP/head.pt" ] && sha_check "$KEV_SNAP/head.pt" "$KEV9B_HEAD_SHA" "kev-9b head.pt"
fi
BASE_SNAP="$HF_HOME/hub/models--Qwen--Qwen3.5-9B-Base/snapshots/$KEV9B_BASE_REV"
if [ -f "$BASE_SNAP/config.json" ]; then
  N_SHARDS="$(find "$BASE_SNAP" -maxdepth 1 -name '*.safetensors' 2>/dev/null | wc -l | tr -d ' ')"
  ok "$KEV9B_BASE@$KEV9B_BASE_REV 캐시 있음 (safetensors ${N_SHARDS}개)"
else
  fail "$KEV9B_BASE@$KEV9B_BASE_REV 캐시 없음. hf download $KEV9B_BASE --revision $KEV9B_BASE_REV (kev-f1.sh 는 HF_HUB_OFFLINE=1 로 돌아 캐시가 없으면 멈춘다)"
fi
SUITE_SNAP="$HF_HOME/hub/datasets--jaredpalmer--kev-suites/snapshots/$KEV_SUITES_REV/v7/decision-v7"
if [ -f "$SUITE_SNAP/train.jsonl" ]; then ok "kev-suites decision-v7 train.jsonl 캐시 있음(F2 --replay)"; else warn "kev-suites decision-v7 캐시 없음(F1 에는 불필요, F2 전에 받는다)"; fi

# ── 7. 학습 데이터: 형식, max_state 별로 빠지는 레코드 수 ──────────────────────────────────────────
echo "-- 7 학습 데이터"
if [ ! -f "$SOL_TRAIN_DATA" ]; then
  warn "학습 데이터 없음: $SOL_TRAIN_DATA (X6b 번들 반입 전이면 정상. F1-B 전에는 필요)"
elif [ ! -x "$PY" ]; then
  warn "venv 가 없어 데이터 검사를 건너뛴다"
else
  SOL_TRAIN_DATA="$SOL_TRAIN_DATA" KEV9B_BASE="$KEV9B_BASE" KEV9B_BASE_REV="$KEV9B_BASE_REV" "$PY" -I - <<'PY' | collect
import collections, os

def say(level, msg): print(f"{level} {msg}", flush=True)

path = os.environ["SOL_TRAIN_DATA"]
try:
    from kev.data import load_records, materialize
    from kev.model import fits, load_tokenizer, training_context
except Exception as e:
    say("FAIL", f"kev 모듈 import 실패 ({e!r})"); raise SystemExit(0)
try:
    recs = load_records(path)
except Exception as e:
    say("FAIL", f"{path} 형식 오류(kev.data.load_records): {e}"); raise SystemExit(0)
n_q = sum(len(r["questions"]) for r in recs)
say("ok", f"{path}: 레코드 {len(recs)}, 질문 {n_q}")
dup = collections.Counter(r["_meta"]["text_sha256"] for r in recs)
dups = sum(c - 1 for c in dup.values() if c > 1)
say("info" if dups == 0 else "warn", f"state 본문이 같은 레코드 {dups}건 (같은 state 에 다른 라벨이면 충돌)")
labels = collections.Counter()
for r in recs:
    for qid, q in r["questions"].items():
        labels[(q.get("type"), str(q.get("label")))] += 1
for (t, l), c in sorted(labels.items()):
    say("info", f"  라벨 {t}/{l}: {c} ({100 * c / n_q:.1f}%)" + (" <5%" if 100 * c / n_q < 5 else ""))
try:
    tok = load_tokenizer(os.environ["KEV9B_BASE"], revision=os.environ["KEV9B_BASE_REV"])
except Exception as e:
    say("warn", f"백본 토크나이저를 못 열어 길이 검사를 건너뛴다 ({e.__class__.__name__}; 백본 캐시 뒤 다시)"); raise SystemExit(0)
mats = [materialize(r) for r in recs]
for ms in (1024, 2048, 4096, 6144):
    try:
        ctx = training_context(ms)
        dropped = sum(0 if fits(m, tok, **ctx) else 1 for m in mats)
        say("ok" if dropped == 0 else "warn", f"--max_state {ms}: dropped {dropped} of {len(mats)} (state {ctx['max_state']} / branch {ctx['max_branch']} / packed {ctx['max_packed']})")
    except Exception as e:
        say("warn", f"--max_state {ms} 길이 검사 실패 ({e!r})")
PY
fi

# ── 8. 요약·통과 표식 ─────────────────────────────────────────────────────────────────────────────
echo "-- 8 요약"
if [ "${#WARNS[@]}" -gt 0 ]; then echo "warn ${#WARNS[@]}건:"; printf '   - %s\n' "${WARNS[@]}"; fi
if [ "${#FAILS[@]}" -gt 0 ]; then
  echo "FAIL ${#FAILS[@]}건:"; printf '   - %s\n' "${FAILS[@]}"
  echo "preflight 실패. kev-f1.sh 를 돌리지 않는다. 로그: $LOG"
  exit 1
fi
{
  echo "date=$(date -Iseconds)"
  echo "host=$(hostname)"
  echo "gpu_index=$SOL_GPU_INDEX"
  echo "gpu_uuid=$GPU_UUID"
  echo "kev_commit=$SOL_KEV_COMMIT"
  echo "venv=$SOL_KEV_VENV"
  echo "kev_snapshot=$KEV_SNAP"
  echo "kev_adapter_sha256=$KEV9B_ADAPTER_SHA"
  echo "kev_head_sha256=$KEV9B_HEAD_SHA"
  echo "base_snapshot=$BASE_SNAP"
  [ -f "$SOL_RUNS_DIR/preflight-env.tmp" ] && cat "$SOL_RUNS_DIR/preflight-env.tmp"   # torch=·triton=
  echo "log=$LOG"
} > "$SOL_RUNS_DIR/preflight-ok"
echo "preflight 통과 (warn ${#WARNS[@]}건). 표식: $SOL_RUNS_DIR/preflight-ok, 로그: $LOG"
echo "다음: bash infra/gpu/kev-f1.sh --max_state 1024"
