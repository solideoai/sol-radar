---
title: "B2 런북 — 회사 GPU 서버에 Bosun 결정 서버(8009) 올리기와 회사 Qwen API 실연결 확인"
doc: plan
status: draft
tags:
  - sol-radar
  - ai
  - decision
  - runbook
updated: 2026-10-21
---

# B2 런북 — Bosun 결정 서버(8009)·회사 Qwen API 실연결 확인

> [!danger] 실행 금지 조건 (맨 위에 둔다)
> 1. **`fix/decision-hardening`(커밋 `aa198cb` 이상)이 main 에 들어가기 전에는 이 문서의 어떤 서버 단계도 실행하지 않는다.** 결정 서버 상한(본문 128 KiB·state 24,000자)·대기열 503·마감 뒤 즉시 504·한글 state 422·`trust_remote_code` 전 패키지 검증이 그 커밋에 있다(3e 보안 검토 M1·L1·L2·L3, 사용자 결정 2026-10-21). §0 에서 main 해시로 확인한다.
> 2. **키 값(`DECISION_API_KEY`·`KEV_API_KEY`·`QWEN_API_KEY`)은 어떤 명령·로그·보고·증거 파일에도 출력하지 않는다.** `echo $…`·`env`·`set -x`·`printenv` 금지. 키는 셸 변수로만 넣고, 보고에는 "설정됨" 만 적는다.
> 3. 서버 명령은 지금까지처럼 **사용자가 `sol-NF5280M6`(계정 `bim`)에서 직접** 돌린다. 세션은 명령 순서와 판정 기준을 주고 결과를 받아 적는다. 어떤 프로세스도 종료·이동하지 않는다(kill·pkill·docker compose down 없음). GPU 0·2 는 보지도 쓰지도 않는다. nginx·운영 포트·회사 vLLM 서버는 바꾸지 않는다. 학습(`SOL_TRAIN_APPROVED`)은 이번 범위 밖이다.
> 4. 메모리가 부족하거나(§1·§4) 어느 단계가 FAIL 이면 **멈추고 보고**한다. 낮춰서 통과시키지 않는다.

사용자 결정(2026-10-21, 마스터 세션 12 경유, "결정이 필요한 것들은 다 추천안대로"): B2 실모델 서빙·preflight 와 회사 vLLM 실호출을 진행한다. 조건은 위 네 줄과 [[10-DEPLOYMENT|10]](정본)·[[16-DECISIONS|ADR-034]]. 설치는 기존 `.venv-bosun` 에 `pip install -e . --no-deps`(`uv sync --frozen --extra model` 금지 — `uv.lock` 의 `model` extra 는 torch 2.14.1 이라 서버 torch 2.8.0+cu128 을 바꾼다). 실호출은 live 호출 예산(24h 창 ≈260회, [[plans/2026-10-20-bosun-qwen4b-migration-plan|계획]] §9 B2 행) 안에서.

이 세션(ed)에서 서버 작업과 실호출을 **직접** 하려면 사용자가 이 세션에 직접 승인 문구를 입력해야 한다(12 경유 승인으로는 내 세션의 "회사 서버 기동·실호출 금지" 지시를 풀지 않는다). 기본은 사용자 실행이다.

## 0. 전제 확인 (서버·노트북)

```bash
# 노트북: main 에 보강 커밋이 들어갔는지. aa198cb(또는 그 뒤 7f3b528·이 런북 커밋)가 조상이면 0 이 나온다
git -C /Users/leegwanghui/dev/hackathon/sol-radar fetch -q origin && git -C /Users/leegwanghui/dev/hackathon/sol-radar merge-base --is-ancestor aa198cb origin/main && echo "OK: hardening in main" || echo "STOP: hardening not in main"

# 서버(bim@sol-NF5280M6): 저장소를 그 main 으로 맞춘다. 로컬 변경이 있으면 멈추고 보고(덮어쓰지 않는다)
cd /data/www/ai_workspace/sol-radar/sol-radar && git status --short && git fetch -q origin && git checkout -q main && git pull -q --ff-only && git log --oneline -1
```

판정: 노트북 `OK`, 서버 `git status --short` 가 비고 `git log -1` 해시가 노트북 `origin/main` 과 같다.

## 1. GPU 상태 (읽기만)

```bash
nvidia-smi --query-gpu=index,pci.bus_id,name,memory.used,memory.free,memory.total --format=csv
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv
```

판정: 물리 GPU 1(PCI 순서)의 `memory.free` 가 **6,000 MiB 이상**(서빙 추정 3,000 + PaddleOCR 피크 여유 3,000. 학습 추정 10,000 은 이번 범위 밖). 모자라면 멈추고 보고. GPU 0·2 의 숫자는 기록만 한다. 프로세스 목록은 보고에 pid·used_memory 만 적는다(명령 줄은 적지 않는다).

## 2. venv 설치 (`.venv-bosun`, `--no-deps`)

```bash
cd /data/www/ai_workspace/sol-radar
source .venv-bosun/bin/activate
python -c "import sys, torch, transformers, peft; print(sys.version.split()[0], torch.__version__, torch.cuda.is_available(), transformers.__version__, peft.__version__)"
pip install -e sol-radar/services/decision --no-deps
pip check
python -c "import sol_decision, fastapi, pydantic, pydantic_settings, uvicorn; print('deps ok')"
```

판정: Python 3.12.x, torch `2.8.0+cu128`, `cuda True`, transformers 4.57 이상 5 미만, peft 0.21 이상. `pip check` 가 "No broken requirements found". 마지막 줄 `deps ok`.
`ImportError` 가 나면 **그 네 개만** 설치하고 다시 `pip check` 한다(torch·transformers·peft·triton 은 건드리지 않는다):

```bash
pip install 'fastapi>=0.144.0' 'pydantic>=2.11' 'pydantic-settings>=2.10' 'uvicorn>=0.54.0'
pip check
python -c "import torch; print(torch.__version__)"   # 여전히 2.8.0+cu128 이어야 한다. 바뀌었으면 멈추고 보고
```

## 3. 가중치 다운로드와 sha256 대조

```bash
export HF_HOME=/data/www/ai_workspace/sol-radar/hf
hf download Hanno-Labs/bosun-v3.1-0.6b --revision 5e78a37c8d86860ebac9ef2d5327d6299498498e
hf download Qwen/Qwen3-0.6B --revision c1899de289a04d12100db370d81485cdf75e47ca
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
BOSUN_SNAP="$HF_HOME/hub/models--Hanno-Labs--bosun-v3.1-0.6b/snapshots/5e78a37c8d86860ebac9ef2d5327d6299498498e"
ls "$BOSUN_SNAP"
python - <<'PY'
import os
from pathlib import Path
from sol_decision.package import build_identity, verify_package
info = verify_package(Path(os.environ["BOSUN_SNAP"]))      # manifest 의 모든 파일 + 최상위 *.py 대조. 위반이면 PackageError
identity = build_identity(info)
print("run", identity.run)
print("base", identity.base)
print("revision", identity.revision)
print("lora", identity.lora)
print("decision_embeddings_sha256", identity.decision_embeddings_sha256)
PY
grep -nE "bosun-v3.1-0.6b|revision|sha256|requestModel" sol-radar/services/ai/models/registry.yaml | head -20
```

판정: `verify_package` 가 예외 없이 끝나고, 출력 다섯 줄이 `services/ai/models/registry.yaml` 의 `bosun-v3.1-0.6b` 항목(run `Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`, base `Qwen/Qwen3-0.6B@c1899de2`, revision 전체 sha, lora `961d237b…`, decision_embeddings `88f9e856…`)과 **글자 그대로** 같다. 다르면 멈추고 보고(공개 snapshot 이 바뀐 것이다 — ADR-034 6번).
`ls` 에 `manifest.json`·`config.json`·`modeling_bosun.py`·`configuration_bosun.py`·`adapter/`·`decision_embeddings.safetensors`·`tokenizer/` 가 있어야 한다.

## 4. preflight (서빙 전용 예산)

```bash
cd /data/www/ai_workspace/sol-radar/sol-radar
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1
# 이번 B2 는 서빙·preflight 만이라 학습 추정(SOL_EST_TRAIN_MIB)을 0 으로 둔다 → SOL_REQUIRED_MIB = 3000 + 3000 = 6000.
# SOL_MIN_FREE_MIB·SOL_REQUIRED_MIB 를 직접 낮추지 않는다. 뒤에 학습(F1)을 할 때는 기본값(16000)으로 다시 돌린다.
SOL_GPU_SHARE_APPROVED=1 SOL_EST_TRAIN_MIB=0 bash infra/gpu/bosun-preflight.sh 2>&1 | tee "/data/www/ai_workspace/sol-radar/runs/bosun-preflight-$(date +%Y%m%d-%H%M).log"
```

`SOL_GPU_SHARE_APPROVED=1` 은 "회사가 GPU 1 공유를 승인했음을 사용자가 확인했다" 는 뜻이다. 명령을 치는 사람(사용자)이 넣는다. 세션은 대신 넣지 않는다.
판정: 요약(`-- 12`)에 FAIL 0건, 표식 `runs/bosun-preflight-ok` 생성. ⑧(CPU 로드)에서 LoRA 392 텐서·10,092,544 파라미터. FAIL 이 있으면 멈추고 로그 파일 경로와 FAIL 줄만 보고한다(로그에 키는 없다).

## 5. 결정 서버 기동 (8009, GPU 1)

`tmux` 세션 하나를 전용으로 쓴다(SSH 가 끊겨도 살고, 끝낼 때는 그 창에서 Ctrl-C 로 **우리 프로세스만** 끝낸다).

```bash
tmux new -s sol-decision
cd /data/www/ai_workspace/sol-radar && source .venv-bosun/bin/activate
export HF_HOME=/data/www/ai_workspace/sol-radar/hf HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1
read -rs -p "DECISION_API_KEY: " DECISION_API_KEY && export DECISION_API_KEY && echo   # 화면에 안 보인다. 노트북 게이트웨이 KEV_API_KEY 와 같은 값
export DECISION_MAX_QUEUE=4
python -m sol_decision.serve \
  --package "$HF_HOME/hub/models--Hanno-Labs--bosun-v3.1-0.6b/snapshots/5e78a37c8d86860ebac9ef2d5327d6299498498e" \
  --alias bosun-v3.1-0.6b --host 127.0.0.1 --port 8009 --dtype bf16
```

`DECISION_ALLOW_KO_STATE` 는 **넣지 않는다**(운영 가드. 평가용은 별도 인스턴스·다른 포트, [[16-DECISIONS|16]] 미결정 27).
기동 로그에 `Uvicorn running on http://127.0.0.1:8009` 가 나오면 다른 창에서:

```bash
nvidia-smi --query-gpu=index,memory.used,memory.free --format=csv          # 기동 전과 비교. 우리 몫은 3,000 MiB 아래가 기대값
curl -sS http://127.0.0.1:8009/health
curl -sS -H "Authorization: Bearer $DECISION_API_KEY" http://127.0.0.1:8009/v1/models
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8009/v1/models                      # 401
curl -sS -i -H "Authorization: Bearer $DECISION_API_KEY" -H 'Content-Type: application/json' \
  http://127.0.0.1:8009/v1/systemone -d '{"model":"bosun-v3.1-0.6b","state":"NOTICE: public SI project, budget 1.2B KRW, deadline in 14 days.\nCOMPANY: 12 engineers, 3 similar past projects.","questions":{"recommendation":{"type":"choice","instructions":"Recommend BID, WATCH, or NO_BID.","criteria":{"BID":"Pursue","WATCH":"Monitor","NO_BID":"Skip"}},"needsHumanReview":{"type":"noul","instructions":"Should a human check this?"}}}'
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $DECISION_API_KEY" -H 'Content-Type: application/json' \
  http://127.0.0.1:8009/v1/systemone -d '{"state":"회사 솔리데오","questions":{"q":{"type":"noul","instructions":"x"}}}'    # 422 STATE_NOT_ENGLISH
```

판정: `/health` 가 `"backend":"bosun","device":"cuda"`, `/v1/models` 의 run·base·lora·revision·decision_embeddings_sha256 이 §3 출력과 같고, 무인증 401, systemone 200 + `x-typesafe-request-id` + `probabilities` 합 1, 한글 state 422. 응답 지연(`latency_ms`)을 적는다(G3 p50/p95 는 노트북에서 24묶음으로 §7).
GPU 1 사용량이 기동 전보다 3,000 MiB 넘게 늘었거나 `memory.free` 가 3,000 MiB 아래면 Ctrl-C 로 **우리 서버만** 내리고 보고한다.
서버 로그에는 요청 id·질문 수·상태·지연·예외 종류 이름만 남는다(state·키 없음) — 확인해서 보고에 한 줄.

## 6. 라우터 경유 (서버 안 → 바깥)

```bash
# 서버 안: 모델 라우터(127.0.0.1:8080, infra/compose.gpu.yaml, 변경 없음)가 /sol-radar/kev/* 를 8009 로 넘기는지
curl -sS -H "Authorization: Bearer $DECISION_API_KEY" http://127.0.0.1:8080/sol-radar/kev/v1/models
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/sol-radar/healthz
```

```bash
# 노트북: 바깥 nginx(회사, 변경 없음) 경유. KEV_API_KEY 는 셸 변수로만
curl -sS -o /dev/null -w '%{http_code}\n' https://acropolissg.com/sol-radar/healthz
curl -sS -H "Authorization: Bearer $KEV_API_KEY" https://acropolissg.com/sol-radar/kev/v1/models
curl -sS -o /dev/null -w '%{http_code}\n' https://acropolissg.com/sol-radar/kev/v1/models        # 401
```

판정: 200·401 이 서버 안과 같다. 바깥 nginx 가 접두어를 떼는지(`/sol-radar/kev/v1/models` → 8009 의 `/v1/models`)는 여기서 처음 확인된다(10 콜아웃 "미확인"). 다르면 **nginx 를 고치지 않고** 보고한다.

## 7. 노트북 게이트웨이 대조 (AI_PROVIDER=local, 사용자 승인 뒤)

`infra/.env` 의 `AI_PROVIDER=local`·`KEV_BASE_URL=https://acropolissg.com/sol-radar/kev`·`KEV_MODEL_ID=bosun-v3.1-0.6b`·`KEV_API_KEY`(= `DECISION_API_KEY`)·`QWEN_*` 를 채운 뒤(값은 `.env` 에만, 이 문서·보고에 적지 않는다):

```bash
docker compose -f infra/compose.yaml up -d --build ai-gateway
curl -sS http://127.0.0.1:8000/health | python3 -m json.tool      # kev.registryMatch: true, qwen 모델 id 일치
```

판정: `registryMatch: true`(03 §11. `/v1/models` 의 run·base·lora·revision 과 레지스트리가 글자 그대로 같을 때만). false 면 어느 필드가 다른지 `/health` 본문으로 보고. 그 다음 11 §4 G3(24묶음 p50/p95)·G6 은 `demo-verifier` 가 맡는다. worker 는 `SOL_RUN_MODE=fixture` 로만(live 는 수집 예산 ≈266회를 쓴다 — 별도 결정).

## 8. 회사 Qwen3.5-27B API 실연결 확인 (probe, 호출 3회)

노트북 `services/ai` 에서. 먼저 `--dry-run`(네트워크 없음)으로 요청 모양·URL 검사 통과를 보고, 그 다음 실호출 **한 번**(= HTTP 3회: `GET /v1/models`, guided JSON `POST /v1/chat/completions`(max_tokens 64), `--logprobs` 로 `prompt_logprobs` 1회). 예산: 24h ≈260회 중 3회.

```bash
cd /Users/leegwanghui/dev/hackathon/sol-radar/services/ai
read -rs -p "QWEN_API_KEY: " QWEN_API_KEY && export QWEN_API_KEY && echo
export QWEN_BASE_URL=https://acropolissg.com/vllm/v1 QWEN_MODEL=Qwen/Qwen3.5-27B
uv run python scripts/probe-qwen-api.py --dry-run                                  # 요청 계획만. authorization 은 bearer(set) 로만 찍힌다
uv run python scripts/probe-qwen-api.py --logprobs --timeout 30 | tee "../../docs/evidence/phase-5/qwen-probe-$(date +%Y%m%d-%H%M).json"
```

판정(출력 JSON): `models.hasRequestedModel: true`(`ids` 에 `Qwen/Qwen3.5-27B`), `chatCompletions.guidedJson: supported`(03 §4.3 guided JSON. `rejected` 면 게이트웨이 어댑터의 대체 경로(26-3)가 쓰이므로 EX0 품질을 따로 본다), `promptLogprobs: present|absent`(E3 가능 여부, 미결정 26-x), `latencyMs` 세 개. exit 0 = 보냈다, 1 = 전송 실패(예외 종류만), 2 = 키 없음, 3 = URL 거부. 출력에 키는 없다(스크립트가 찍지 않는다). 그래도 저장 전에 `grep -c "$QWEN_API_KEY"` 로 0 을 확인하지 **않는다**(키를 명령줄에 올리게 된다) — 스크립트 설계로 충분하다.

## 9. 증거

`docs/evidence/phase-5/endpoint-bosun-<YYYYMMDD-HHMM>.md` 에: §0 해시, §1 nvidia-smi 두 번(기동 전·후), §2 버전 줄과 `pip check`, §3 identity 다섯 줄, §4 preflight 요약(FAIL 0)과 로그 파일 경로, §5 curl 응답(Authorization 헤더는 적지 않는다), §6 200/401, §7 `/health` 본문, §8 probe JSON 경로. 키 값·`Authorization` 값은 어디에도 없어야 한다. [[PROGRESS]] 작업 로그에 한 행.

## 10. 되돌리기

- 8009 만 내린다: `tmux attach -t sol-decision` → Ctrl-C. 다른 프로세스는 건드리지 않는다.
- 설치만 되돌린다: `.venv-bosun` 에서 `pip uninstall -y sol-decision`(torch 계열은 그대로).
- 다운로드한 snapshot 은 두어도 된다(디스크 약 1.5 GB). 지우려면 사용자 결정.

## 관련 문서

- [[plans/2026-10-20-bosun-qwen4b-migration-plan|분석·변경 계획]] §9 B2 행
- [[10-DEPLOYMENT|10 배포]] · [[22-FINETUNE-RUNBOOK|22 런북]] §2.2 · [[16-DECISIONS|16 결정]] ADR-034·미결정 27·28
- `services/decision/README.md`(설치·기동·계약) · `infra/gpu/bosun-preflight.sh` · `services/ai/scripts/probe-qwen-api.py`
- [[PROGRESS|진행 상황]]
