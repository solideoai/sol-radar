# 회사 GPU 서버 모델 라우터 (ADR-025)

회사 nginx 가 `https://acropolissg.com/sol-radar` 하나만 등록할 수 있어, 그 뒤에서 경로를 나누는 작은 nginx 를 둔다.
노트북 ai-gateway 는 `KEV_BASE_URL=https://acropolissg.com/sol-radar/kev` 로 붙는다. `QWEN_BASE_URL` 은 이 라우터가 아니라 회사가 운영하는 vLLM API `https://acropolissg.com/vllm/v1` 이다(아래).

2026-10-20 ADR-034: `:8009` 런타임은 `kev.serve` 대신 우리 결정 서버 `sol_decision.serve`(Bosun v3.1 0.6B, Kev wire 호환)다. 추출·설명 `Qwen3.8-Flash-Next-AWQ-INT4`(2026-10-21 `Qwen/Qwen3.5-27B` 에서 교체)는 회사가 이미 운영하는 vLLM API(`https://acropolissg.com/vllm/v1`, env 값은 회사 안내 그대로 `https://acropolissg.com/vllm/v1`, 게이트웨이가 `/v1` 중복을 정규화한다(B1))를 쓰므로 `:8001` 에는 아무것도 띄우지 않고 `/qwen` 규칙은 백업(미사용)으로 남긴다. 라우터 설정·경로·포트·회사 nginx 는 바꾸지 않는다.

## 회사 nginx 에 부탁할 것 (location 하나)

```nginx
location /sol-radar/ {
    proxy_pass http://127.0.0.1:8080;          # 접두어를 떼지 않는다(떼도 라우터가 받는다)
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;   # 기본값도 통과시키지만 명시한다
    proxy_read_timeout 300s;                   # 기본 60s 면 긴 RFP 추출이 504 로 끊긴다
    proxy_send_timeout 300s;
    client_max_body_size 20m;                  # 기본 1m 면 첨부 본문을 담은 추출 요청이 413 이다
    proxy_buffering off;
}
```

## GPU 서버에서 띄우기

1. 결정 서버 `sol_decision.serve`(Bosun v3.1 0.6B, venv `.venv-bosun`)를 아래 명령(`docs/10-DEPLOYMENT.md` "회사 GPU 추론 엔드포인트" 와 같다)으로 호스트 `127.0.0.1:8009` 에 띄운다. `DECISION_API_KEY` 필수(노트북 `KEV_API_KEY` 와 같은 값, 셸 변수로만). 물리 GPU 1 에서 PaddleOCR 와 공유한다. `:8001` 에는 아무것도 띄우지 않는다(추출·설명은 회사 운영 vLLM API). `sol_decision` 은 2026-10-20 기준 미구현(B1)이고 기동은 사용자 승인 뒤에 한다.

   ```bash
   export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1     # 물리 GPU 1. 가시성만 제한한다(독점 아님)
   # --package: 고정 snapshot(Hanno-Labs/bosun-v3.1-0.6b 리비전 5e78a37c8d86860ebac9ef2d5327d6299498498e) 또는 학습본 run 디렉터리.
   # 서버가 manifest.json 의 sha256 과 파일을 대조해 다르면 기동을 거부한다. HF_HUB_OFFLINE=1 로 다운로드를 막는다
   HF_HUB_OFFLINE=1 DECISION_API_KEY="$DECISION_API_KEY" python -m sol_decision.serve --package <snapshot dir> --host 127.0.0.1 --port 8009
   ```

2. 라우터: 컨테이너면 `docker compose -f infra/compose.gpu.yaml up -d`(Linux, host 네트워크). 호스트 nginx 를 쓰면 `infra/gpu/model-router.conf` 를 `/etc/nginx/conf.d/sol-radar-router.conf` 로 두고 `nginx -t && nginx -s reload`.
3. 서버 안에서 확인(키는 셸 변수로만, 값을 출력하지 않는다):

```bash
curl -s http://127.0.0.1:8080/healthz                                   # ok
curl -s -H "Authorization: Bearer $DECISION_API_KEY" http://127.0.0.1:8080/sol-radar/kev/v1/models
#   기대: data[0].id == bosun-v3.1-0.6b, run == Hanno-Labs/bosun-v3.1-0.6b@5e78a37c, base == Qwen/Qwen3-0.6B@c1899de,
#         lora == 어댑터 sha256(961d237b…), revision == 5e78a37c8d86860ebac9ef2d5327d6299498498e
# /sol-radar/qwen/* 은 백업 경로(미사용). :8001 이 비어 있으면 라우터가 연결 실패(502)를 돌려주는 것이 정상이다
# 추출 모델 확인은 회사 운영 vLLM API 로 한다(키는 회사 제공):
curl -s -H "Authorization: Bearer $QWEN_API_KEY" https://acropolissg.com/vllm/v1/models     # data[].id 에 Qwen3.8-Flash-Next-AWQ-INT4
```

## 밖에서 확인 (우리 쪽 C1 ③ G1·G2)

```bash
curl -sS -o /dev/null -w 'http=%{http_code}\n' https://acropolissg.com/sol-radar/healthz    # 200, TLS 유효(-k 금지)
curl -sS -o /dev/null -w 'http=%{http_code}\n' https://acropolissg.com/sol-radar/kev/v1/models   # 인증 없이 401 또는 403
curl -sS -o /dev/null -w 'http=%{http_code}\n' https://acropolissg.com/vllm/v1/models            # 회사 vLLM API. 인증 없이 무엇을 주는지 미확인 — 기록한다
```

## 바뀌면 알려 줄 것

- 바깥 nginx 가 접두어를 떼는지(둘 다 동작하지만 기록한다)
- 라우터 포트(8080)·런타임 포트(8001·8009)를 바꿨는지
- 회사 프록시 단의 추가 인증(기본 인증·IP 허용·별도 헤더)이 있는지
- 회사 운영 vLLM API(`/vllm/v1`)의 주소·모델 id(`Qwen3.8-Flash-Next-AWQ-INT4`)·키·인증 방식·호출 한도가 바뀌는지

## GPU 1 공유: Bosun v3.1 0.6B LoRA F1 (ADR-034, 2026-10-20)

위 라우터·`sol_decision.serve`(추론)와 Bosun LoRA 학습(F1·F2)·오프라인 채점(E1'·E4)은 모두 **물리 GPU 1 한 장**에서 돌고, GPU 1 은 회사 PaddleOCR vLLM 서비스(약 9,167 MiB, 2026-10-20 사용자 보고, 미검증)와 **공유**한다. 전용이 아니다. 정본은 `docs/22-FINETUNE-RUNBOOK.md` §3·§4, `docs/23-WEEKEND-FINETUNE.md`, `docs/10-DEPLOYMENT.md` "GPU 1 공유", 메모리 계획은 `docs/plans/2026-10-20-bosun-qwen4b-migration-plan.md` §8.

| 물리 GPU(nvidia-smi index) | 모델 | VRAM | 2026-10-20 오전 스냅샷(당시 기록) | 2026-10-20 사용자 보고(미검증) | 정책 |
|---|---|---:|---:|---|---|
| 0 | NVIDIA A40 | 46,068 MiB | 4,747 MiB | — | 회사 기존 서비스. **쓰지 않는다** |
| 1 | NVIDIA A40 (CC 8.6) | 46,068 MiB | 5 MiB | PaddleOCR vLLM 약 9,167 MiB 상주 | **공유**: 회사 PaddleOCR + SOL RADAR `sol_decision` 서빙·Bosun LoRA 학습·채점. 어떤 프로세스도 종료·이동 금지 |
| 2 | NVIDIA A40 | 46,068 MiB | 9,240 MiB | — | 회사 기존 서비스. **쓰지 않는다** |

GPU 1 메모리 계획(**추정, F1 실측 전**. 계획 §8. 추출·설명 Qwen3.8-Flash-Next 는 회사 vLLM API 라 여기 없다):

| 상주·작업 | 추정 | 비고 |
|---|---|---|
| PaddleOCR vLLM(회사) | 약 9.2 GB | 건드리지 않는다 |
| `sol_decision.serve` Bosun v3.1 0.6B bf16 | 약 1.5~3 GB | 6k 토큰 state 활성값 포함 |
| Bosun LoRA 학습(bf16, batch 1, 6k 토큰, grad checkpointing) | 약 6~10 GB | F1 20 step 으로 실측 |
| 합계 | 약 17~22 GB | 가용 약 36,900 MiB(46,068 − 9,167, 사용자 보고 기준) 안 |

- 서버 `sol-NF5280M6`, 계정 `bim`, 작업 경로 `/data/www/ai_workspace/sol-radar`. venv 는 `.venv-bosun`(2026-10-20 사용자 보고. 패키지 핀은 B2 에서 기록 — 미확인). `.venv-qwen`·Qwen 4B 다운로드는 중단하고 백업으로 보존한다(삭제하지 않는다). 이전 `.venv-kev`(Python 3.12.3, torch 2.8.0+cu128, triton 3.4.0)는 Kev 용 기록이다. 드라이버 580.173.02(CUDA 13.0), CUDA Toolkit 12.8.
- 매 셸 세션마다 `export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1`. 프로세스 안에서는 GPU 1 이 `cuda:0` 으로 보인다(정상). SSH 를 다시 열면 사라진다. 이 변수는 **가시성만 제한하고 독점이 아니다** — 다른 사람의 GPU 1 사용을 막지 못한다.
- **종료·이동 금지(최우선)**: GPU 0·1·2 어느 프로세스도 종료·이동·설정 변경하지 않는다. GPU 1 의 PaddleOCR 는 정상 상주라 **FAIL 사유도 종료 대상도 아니다**. 그 외 미지의 프로세스가 GPU 1 에 있으면 종료하지 않고 멈춘 뒤 회사에 확인한다. `kill`·`pkill`·`docker compose down` 을 쓰지 않는다(스크립트가 끝낼 때 멈추는 것은 자기가 띄운 `nvidia-smi -l 1` 기록 프로세스뿐). 실행 전후 `nvidia-smi -i 1` 로 GPU 1 상태를 기록한다(`*.pre.txt`·`*.post.txt`). GPU 학습·모델 서빙 시작·nginx 변경·배포는 사용자 승인 전까지 하지 않는다.
- **스크립트**: `infra/gpu/kev-preflight.sh`·`kev-f1.sh` 는 Kev-9B 용으로 **보존·퇴역**(ADR-034, 수정하지 않는다). 전용 전제(`SOL_MIN_FREE_MIB=40000`, GPU 1 에 다른 프로세스가 있으면 FAIL)라 공유 GPU 1 에서는 PaddleOCR 때문에 FAIL 하므로 그대로 쓰지 않는다. Bosun 전용은 아래 `infra/gpu/bosun-preflight.sh`·`bosun-f1.sh`(B1, 2026-10-20 작성. **회사 서버에서는 미실행** — 로컬 가짜 `nvidia-smi`·`python` 스텁으로만 승인 미확인 FAIL·메모리 부족 FAIL·정상 경로를 확인했다).
- 출발 패키지는 Hub 태그가 아니라 리비전 `5e78a37c8d86860ebac9ef2d5327d6299498498e`(main, 2026-10-09) 의 snapshot 디렉터리다. 학습은 공개 LoRA(392 텐서)만 이어 학습하고 decision token 임베딩·백본은 동결한다. `HF_HUB_OFFLINE=1` 로 돈다. 기대 sha256·리비전은 스크립트에 박지 않고 `services/ai/models/registry.yaml` 의 `bosun-v3.1-0.6b` 항목(`lora`·`decision_embeddings_sha256`·`revision`·`base_revision` 또는 `base: …@sha`)에서 읽는다 — 항목이 없으면 FAIL.

### `bosun-preflight.sh` (F1-A, 읽기 전용)

어떤 프로세스도 종료하지 않고, GPU 에는 CUDA 컨텍스트만 만들며 모델은 CPU 로 올린다. 로그 `runs/bosun-preflight-<일시>.log`, FAIL 0건일 때만 표식 `runs/bosun-preflight-ok`(uuid·snapshot 경로·sha256·버전을 적는다. `bosun-f1.sh` 가 이 표식과 대조한다). 항목마다 `ok`/`warn`/`FAIL` 한 줄:

| # | 검사 | FAIL 조건 |
|---|---|---|
| 0 | registry.yaml `bosun-v3.1-0.6b` 항목 | 없음, `lora`·`decision_embeddings_sha256` 가 sha256 이 아님, `revision`·백본 리비전이 `SOL_BOSUN_REV`·`SOL_BOSUN_BASE_REV` 와 다름 |
| 1 | `CUDA_DEVICE_ORDER=PCI_BUS_ID`, `CUDA_VISIBLE_DEVICES` == `SOL_GPU_INDEX`, index 0·2 금지 | 값이 다름 |
| 2 | nvidia-smi GPU 목록, 물리 index ↔ uuid ↔ `pci.bus_id` 기록 | GPU 를 못 읽음 |
| 3 | GPU 1 의 compute 프로세스 목록 **기록만**(PaddleOCR 공존 정상) | `SOL_GPU_SHARE_APPROVED=1` 이 없으면 "회사 공유 승인 미확인" |
| 4 | `memory.free` ≥ `SOL_REQUIRED_MIB` | free 가 필요 예산보다 작음(아래 예산) |
| 5 | venv python 3.12, torch == `SOL_EXPECT_TORCH`, transformers·peft·safetensors 설치(버전 기록), `cuda:0` 의 `pci_bus_id`·uuid 가 nvidia-smi GPU 1 과 같음, bf16 | 버전 다름, 다른 GPU 를 잡음 |
| 6 | snapshot `$HF_HOME/hub/models--Hanno-Labs--bosun-v3.1-0.6b/snapshots/<rev>` 존재, `manifest.json` 의 파일 sha256 전부 대조, `adapter/adapter_model.safetensors`·`decision_embeddings.safetensors` == registry | 없음·불일치 |
| 7 | 백본 snapshot `models--Qwen--Qwen3-0.6B/snapshots/<rev>` 존재(shard sha256 은 기록만) | 없음 |
| 8 | `HF_HUB_OFFLINE=1` 에서 `AutoModelForCausalLM.from_pretrained(snapshot, trust_remote_code=True, local_files_only=True)` 를 **CPU** 로 로드, `lora_` 텐서 392개·파라미터 10,092,544 | 로드 실패·수 다름. 6번 FAIL 이면 코드를 실행하지 않음. `--skip-load` 로 건너뛰면 warn(표식에 `model_load_checked=0`, F1 은 이 표식을 거부) |
| 9 | 데이터: 레코드 수·필수 필드·라벨 분포·`(stateHash, qid)` gold 충돌·state 길이(문자/4 + 패키지 토크나이저)·`--max-state-tokens` 1024/2048/4096/6144 별 초과 건수 | 형식 오류·gold 충돌. 파일이 없으면 warn |
| 10 | venv 에서 `import sol_decision`, `python -m sol_decision --help`, `sol_decision.train --help`, `sol_decision.parity --help` | import·train 실패(parity·`__main__` 은 warn) |
| 11 | `SOL_WORK` 디스크 여유 | 없음(20 GB 미만은 warn) |

끝에 "모델별 안전한 시작·중단 조건" 표를 찍는다: 서빙(`sol_decision.serve`)은 승인 + 예산 통과 뒤 **사용자 승인** 시에만, 학습은 서빙과 동시에 돌리지 않음(돌려야 하면 합산이 free 안), 중단은 자기 PID 만.

### `bosun-f1.sh` (F1-B, 기본 20 step)

`runs/bosun-preflight-ok` 필수. **`SOL_GPU_SHARE_APPROVED=1` 과 `SOL_TRAIN_APPROVED=1` 둘 다 있어야 GPU 를 쓴다**(없으면 "승인 전 실행 금지"). 실행 직전에 registry 값으로 두 파일 sha256 을 재대조하고, `HF_HUB_OFFLINE=1` 로 `python -m sol_decision.train --package <snapshot> --data <jsonl> --out runs/bosun-f1-<tag> --max-steps N --batch B --accum A --device cuda --bf16 --grad-checkpointing --max-state-tokens N` 을 돌린다. 학습 중 `nvidia-smi -i 1 … 1초 간격` 기록은 `kill` 없이 정지 파일로 멈추는 자기 자식 루프다. 끝나면 `python -m sol_decision.parity --package runs/bosun-f1-<tag> --data <jsonl> --n 8` 로 재로딩·동일성을 확인한다(`--no-parity` 로 생략 가능, 합격 조건 미확인으로 적힌다). 결과는 `runs/bosun-f1-<tag>.summary.md`(GPU 전체 최대·우리 증가분·torch peak·step 시간·loss·skip·패키지 sha256·parity exit)와 `runs/f1-results.md` 누적 한 줄. 옵션 `--max-steps`(20) `--batch`(1) `--accum`(8) `--max-state-tokens`(6144) `--tag`(기본 `b<B>a<A>-ms<N>`; 같은 이름은 덮어쓰지 않고 멈춘다). 학습기·parity 인터페이스는 다른 작업자가 구현 중이라 인자 이름·로그 줄 형식의 미세 차이는 F1 전에 맞춘다(스크립트 주석).

PASS 조건 전부: `sol_decision.train` exit 0 · OOM 없음 · 완료 step == `--max-steps` · 패키지 저장(`manifest.json`·`adapter/adapter_model.safetensors`·`decision_embeddings.safetensors`·`config.json`) · 임베딩 sha256 이 공개본과 같음(동결) · **우리 증가분 최대 ≤ `SOL_MEM_BUDGET_MIB`** · parity exit 0.

**예산(전부 문서 추정치, F1 실측 뒤 갱신)**: preflight 의 필요 예산 `SOL_REQUIRED_MIB` = 학습 `SOL_EST_TRAIN_MIB`(10,000) + 서빙 `SOL_EST_SERVE_MIB`(3,000) + 여유 `SOL_RESERVE_MIB`(3,000) = **16,000 MiB** 이고 `memory.free` 가 이보다 작으면 FAIL 이다(위 메모리 계획 표의 상한값. Kev 판 `SOL_MIN_FREE_MIB=40000` 은 쓰지 않는다). `SOL_MIN_FREE_MIB` 는 선택 추가 기준으로만 남기고 기본값이 없다 — 필요 예산을 낮추는 데 쓰이지 않는다. F1 의 `SOL_MEM_BUDGET_MIB` 기본값은 시작 직전 `free − SOL_RESERVE_MIB` 이고 "학습 중 GPU 전체 `memory.used` 최대 − 시작 직전 used"(우리가 더 쓴 최대)와 비교한다. PaddleOCR·서빙 상주분은 시작 직전 used 에 들어가므로 공유 상태 기준이다.

| 환경 변수 | 기본값 | 뜻 |
|---|---|---|
| `SOL_WORK` | `/data/www/ai_workspace/sol-radar` | 작업 루트 |
| `SOL_GPU_INDEX` | `1` | 물리 GPU index. 0·2 는 FAIL |
| `SOL_BOSUN_VENV` | `$SOL_WORK/.venv-bosun` | Python 3.12 venv |
| `SOL_REPO` | 스크립트가 든 저장소 체크아웃 | `SOL_DECISION_SRC`(`$SOL_REPO/services/decision`)·`SOL_REGISTRY`(`$SOL_REPO/services/ai/models/registry.yaml`)의 바탕 |
| `HF_HOME` | `$SOL_WORK/hf` | HF 캐시. `HF_HUB_OFFLINE=1` 고정 |
| `SOL_BOSUN_REV` · `SOL_BOSUN_BASE_REV` | `5e78a37c…` · `c1899de2…` | registry 값과 같아야 한다 |
| `SOL_TRAIN_DATA` | `$SOL_WORK/sol-dataset-v0.1/bosun/train.en.jsonl` | 없으면 preflight warn, F1 중단 |
| `SOL_RUNS_DIR` | `$SOL_WORK/runs` | 로그·표식·결과 |
| `SOL_EXPECT_TORCH` | `2.8.0+cu128` | 다르면 FAIL |
| `SOL_GPU_SHARE_APPROVED` | (없음) | `1` = 회사 GPU 1 공유 승인 확인. 두 스크립트 모두 필수 |
| `SOL_TRAIN_APPROVED` | (없음) | `1` = 사용자 학습 승인. `bosun-f1.sh` 필수 |
| `SOL_EST_TRAIN_MIB` · `SOL_EST_SERVE_MIB` · `SOL_RESERVE_MIB` · `SOL_REQUIRED_MIB` | 10000 · 3000 · 3000 · 합 16000 | 예산(위) |
| `SOL_MIN_FREE_MIB` | (없음) | 선택 추가 기준 |
| `SOL_MEM_BUDGET_MIB` | free − 여유 | F1 우리 증가분 상한 |

```bash
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1
# 사용자 승인 뒤에만 실행한다(승인 env 가 없으면 스크립트가 멈춘다)
SOL_GPU_SHARE_APPROVED=1 bash infra/gpu/bosun-preflight.sh                       # F1-A → runs/bosun-preflight-ok
SOL_GPU_SHARE_APPROVED=1 SOL_TRAIN_APPROVED=1 bash infra/gpu/bosun-f1.sh          # F1-B 격자 1: batch 1 · accum 8 · 20 step
SOL_GPU_SHARE_APPROVED=1 SOL_TRAIN_APPROVED=1 bash infra/gpu/bosun-f1.sh --batch 2 --accum 4   # 격자 2: 앞 칸 PASS 뒤에만
```

결과는 `runs/bosun-f1-<tag>.summary.md`·`runs/f1-results.md`·`runs/bosun-f1-<tag>.train.log` 에 남고, 새 파일 `docs/evidence/bosun-train-feasibility.md` 표에 옮긴다(Kev 기록 `docs/evidence/kev-train-feasibility.md` 는 보존, 개서하지 않는다). 20 step PASS(우리 증가분 ≤ 예산, 재로딩 parity 통과)는 F2 착수 조건의 일부일 뿐이다(계획 §9 B4, 22 §4).
