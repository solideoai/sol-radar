# SOL RADAR — Kev-9B / Qwen3.5-9B → Bosun v3.1 0.6B / Qwen3-4B-Instruct-2507 마이그레이션 지시서

작성 기준: 2026-10-20. **사용자가 첨부한 4개 문서**(10-DEPLOYMENT, 21-MODEL-TRAINING, 22-FINETUNE-RUNBOOK, 23-WEEKEND-FINETUNE)와 회사 서버에서 수행한 검증 결과. 이 파일은 *변경 요청안*이며 기존 ADR을 자동으로 폐기하지 않는다.

## Claude Code 실행 요청

SOL RADAR 프로젝트 전체를 탐색하여 첨부한 문서와 실제 코드 간의 차이를 식별하고, 다음 모델 아키텍처 변경을 **기존 API 및 데이터 계약을 최대한 유지하는 방식으로** 설계·구현하라. 실제 코드와 정본 문서를 확인한 후 ADR 변경안을 먼저 작성하고, 의존하는 코드/테스트/문서 변경을 일관되게 반영하라. 없는 API/스크립트/기능을 구현 완료로 표시하지 말 것. 원격 운영 서버의 프로세스, nginx, 포트, GPU 작업은 승인 없이 변경하지 말 것.

### 1. 신규 모델 및 리비전

- Decision AI: `Hanno-Labs/bosun-v3.1-0.6b` revision `5e78a37c8d86860ebac9ef2d5327d6299498498e`
- Bosun backbone: `Qwen/Qwen3-0.6B` revision `c1899de289a04d12100db370d81485cdf75e47ca`
- Explanation/Extraction AI: `Qwen/Qwen3-4B-Instruct-2507` revision `cdbee75f17c01a7cc42f958dc650907174af0554`
- Old: `jaredpalmer/kev-9b@v1.0` and `Qwen/Qwen3.5-9B` — default active models에서 교체. 이전 실험 파일/기록과 모델 레지스트리 이력은 백업·보존, 새로운 경로가 동작하기 전 삭제 금지.
- 실행 환경: 회사 `sol-NF5280M6`, Linux x86_64, Python 3.12.3, PyTorch 2.8.0+cu128. 프로젝트 `/data/www/ai_workspace/sol-radar`. `.venv-bosun` / `.venv-qwen` 분리, HF 캐시 `hf/hub/`.
- 확인: Bosun checkpoint → CPU 로딩 → 392개 LoRA 텐서 (10,092,544 params) gradient → optimizer 1-step → adapter save/reload → CPU 2 optimizer steps 성공. `runs/bosun/smoke-step1`, `smoke-step2`는 **장난감 6건의 기술 검증용**으로 성능 증거 및 운영 모델 사용 금지.
- **Qwen3-4B의 추론/QLoRA는 아직 패키지 import, 저장소 다운로드 수준만 확인. 모델 실제 로딩/학습/서빙 검증 안 됨.**

### 2. 기존 정본에서 보존할 논리와 결정

- 기존 21·22문서는 Kev가 `req.{itemId}.status`의 `SATISFIED | NOT_SATISFIED | NEEDS_REVIEW`와 `risk.*`, `techFit`, `perfRelevance` 등 **질문별 결정**을 담당한다고 정함. 공고 전체 `BID | WATCH | NO-BID` 단일 예측 모델로 축소하거나 무단 대체하지 말 것.
- `NEEDS_REVIEW`는 정보 부족, `NOT_SATISFIED`는 명시적 미충족 증거가 있는 경우. 사유 코드는 기존 계약대로 보존.
- 참가자격 규칙 엔진과 SOL Score는 별도 결정적 로직. BOSUN이 하드 제약이나 점수 산식을 덮어쓰지 않도록. 최종 BID/WATCH/NO-BID는 기존 최종 결정 정책/권한에서 도출한다.
- 선택지 분류뿐 아니라 `risk.*` 등의 `noul`, score 타입 존재. Bosun이 지원하는 타입 `choice|score|noul`과 기존 `kev-qs/v0.2` 질문별 타입을 대조해 **각 유형별 후보, 기준, 후처리 계약**을 설계할 것. 이전의 3라벨 smoke 샘플로 전체 API 호환을 증명하지 말 것.
- 학습/실행 프롬프트는 공식 Bosun `render_decision_prompt`, `presented_slot` mapping, 256 decision tokens, `decision_logits()` 사용. `predict()`는 inference_mode이므로 학습 사용 금지. 이전 `kev state builder`, question-set `v0.2`, 한국어/영어 평가 설계를 분석 후 Bosun typed contract로 명시적으로 변환하라.
- Qwen 담당 기능은 단순한 서술만이 아니라 **공고·RFP RequirementExtraction 구조화 추출 + 인용/증거 검증 + 설명**. 기존 `req-extract/v0.1`, `/extract`, `/explain`, `RequirementExtraction` 스키마, `KNOWN/UNKNOWN/CONFLICTED`를 보존. 실제 스키마와 엔드포인트 정의는 03-AI-PIPELINE, 05-API-SPEC, 15-DATA-CONTRACTS와 코드에서 확인.
- 실제 낙찰 결과 예측, 근거 없는 확률/승률 추정, 인용 없는 KNOWN 출력 금지.

### 3. 파인튜닝 데이터 요구 사항

**Bosun**
- 정본 `EvalItem` 기반, 실제 나라장터 공고·RFP × 가상 기업 원형/변형.
- 각 요구사항/리스크 질문의 `questionType`, `instructions`, `criteria`, `candidate IDs`, `label`, `reason code`, `labelSource`, `noticeEvidence`, `companyEvidence`, `clusterId`, `split` 보존.
- `SATISFIED` / `NOT_SATISFIED` / `NEEDS_REVIEW`의 구성 라벨, 사람 골드, 규칙 실버를 구분; RULE_SILVER는 학습에만. 의미유사도, 기술 적합성, 실적 연관성처럼 구성으로 참값을 결정하기 어려운 항목은 사람 라벨 없이는 정답화하지 말 것.
- `presented_slot` 정답 매핑, 후보 순서 순열 실험, 동일 사업 cluster split, 유사 RFP 중복 방지, held-out company, 평가용 fixture 분리, 개인정보 마스킹.
- 출발점은 Bosun LoRA 392개 텐서만 trainable, 256개 decision token input/output embedding frozen. 공식 model loading은 `is_trainable=False`; 학습 코드에서 명시적으로 trainable 설정. 실제 save/reload 확인됨. 학습본을 독립 모델로 착각하지 말 것 — base, original decision rows, customized loader/prompt 계약 필요.
- 실측 2-step 결과를 일반화 성능 개선이라고 주장하지 말 것. 20-step은 학습 파이프라인 smoke 목적, 실제 훈련 전에 train/dev/test와 E0 대비 베이스라인 결과 정리.

**Qwen3-4B**
- 목적 1: 공고·첨부 → gold `RequirementExtraction` JSON, citation/offset 검사, `UNKNOWN/CONFLICTED`, 필수자격/인력/실적 누락 회피.
- 목적 2: 별도의 근거 기반 설명 입력/정답 계약을 설계(결정·규칙·SOL Score·evidence를 제공; 생성 모델이 없는 근거·점수를 창작하지 않도록). 기존 설명 프롬프트/엔드포인트 실제 구현을 살펴 학습 범위 결정.
- 원칙: 초기 베이스라인(학습 전)을 먼저 재고, `EXTRACTION` 또는 `EXPLANATION` 원인 오류가 클 경우 LoRA/QLoRA SFT. 사용자 모델 학습 선택은 반영하되, 기존 문서의 'Qwen 학습 해커톤 제외' 결정을 ADR로 개정하도록 제안.
- `train/dev/test` 사업 클러스터 분리, JSON schema fidelity, 필수 요구 재현율, 인용 정확도, 환각률 지표 확보.

### 4. 엔드포인트 계약: 꼭 지켜야 하는 것

- 회사 nginx 외부 등록은 **오직 하나**: `https://acropolissg.com/sol-radar/`. 서버 접근 제한, nginx 새 location/도메인 추가 요청 금지.
- 기존 `infra/gpu/model-router.conf`(127.0.0.1:8080)는 `/sol-radar/qwen/*` → 127.0.0.1:8001 (vLLM), `/sol-radar/kev/*` → 127.0.0.1:8009 (`kev.serve`)로 설계됨. **문서상의 설계이지 실제 운영 확인은 아님.**
- 목표 제안: `/sol-radar/qwen/v1/*`는 유지하면서 served model ID를 Qwen3-4B로 교체(정확한 vLLM 지원 검증 필요). Decision 경로는 `/sol-radar/bosun/...`로 새로 정의할지 기존 `/kev/...` URL을 compatibility alias로 쓸지 **기존 gateway 클라이언트와 `/v1/systemone` 호출 계약을 파악한 뒤 ADR로 결정**. 새 nginx 회사 location은 추가하지 않는다.
- Bosun은 custom decision model이고 stock `vllm serve` / `kev.serve` 드롭인 대체라고 가정하지 말 것. GPU 서버 내부 CPU/GPU inference adapter를 구축하여 선택지와 `candidate_to_slot` 결과를 기존 gateway가 기대하는 typed response로 명시적으로 변환. `/v1/models`, health, auth, timeout, log, version identity 호환 검증.
- 환경변수 `KEV_*` / `KEV_ENABLED` / `KEV_ALLOW_KO_STATE` / `KEV_QUESTION_SET`는 의미가 바뀌므로 `BOSUN_*`로 이관할지 호환 env를 둘지 마이그레이션 표를 작성. `QWEN_MODEL`을 새로운 ID로 갱신. 실제 secret 값을 문서/로그에 노출하지 말 것.
- `SOL_RUN_MODE=live|fixture|mock`, `AI_PROVIDER=local|mock`, CI mock 동작, live의 자동 mock fallback 금지, Supabase cloud, 노트북 Docker Compose 서비스 경계는 그대로.
- Qwen/Bosun 학습본 평가 단계는 오프라인 우선, **학습본을 바로 공개 HTTPS로 서빙하지 말 것**. E4, EX1 등 실험 레지스트리와 운영 승격은 분리. 기존 score_runs/analyses 덮어쓰기 금지.

### 5. GPU/운영 안전

- 회사 NVIDIA A40 46,068 MiB × 3; 접근 대상은 물리 index 1만. 0·2에서 실행/종료/이동 금지.
- 2026-10-20 현재 GPU 1에는 **PaddleOCR vLLM 서비스 약 9,167 MiB 사용 중**인 것이 실제 `nvidia-smi`로 확인됨. 기존 문서의 'GPU1 5 MiB, 학습 전용'은 오래된 스냅샷 — 문서를 갱신. `CUDA_VISIBLE_DEVICES=1`은 자원 독점이 아님.
- `CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1` 후 PyTorch의 `cuda:0`을 사용. GPU 훈련은 회사 서비스 소유자 승인·점유 확인·메모리 계획 전까지 실행 금지. 다른 서비스 종료, docker compose down, kill 금지.
- 로컬 CPU에서 Bosun forward/backward, 1-step·2-step 완료. 아직 A40에서 Bosun/Qwen GPU 로딩, runtime serving, 병렬 운영은 미검증.

### 6. 문서/코드 변경 영향 범위

반드시 사용자 첨부 4개 문서와 현재 repo를 대조하고 다음 파일 및 의존 문서를 찾아 수정 범위를 제시:
1. `docs/10-DEPLOYMENT.md` — 모델 이름/프로필/외부 단일 엔드포인트/내부 라우팅/키/모델 검증 및 GPU 점유 정정.
2. `docs/21-MODEL-TRAINING.md` — 모델별 학습 태스크·라벨·데이터셋·평가 지표·베이스라인·새 모델 비교 E0..E4 정의.
3. `docs/22-FINETUNE-RUNBOOK.md` — Bosun 전용 loader/train/save/reload + Qwen4B QLoRA SFT + 재현 가능한 리비전, 명령, preflight/학습 승인 게이트, 결과 보관.
4. `docs/23-WEEKEND-FINETUNE.md` — 10/24~25 기존 Kev 중심 일정·산출물·중단선을 새 모델 일정으로 재계획; 기존 사용자 승인/ADR-027 내용과 충돌을 표시.
5. 추가 중요: `docs/03-AI-PIPELINE.md`, `docs/08-SCORING.md`, `docs/15-DATA-CONTRACTS.md`, `docs/16-DECISIONS.md` (ADR-025·027·029·030·033), `docs/05-API-SPEC.md`, `docs/12-ROADMAP.md`; 실제 파일 경로가 다르면 repo의 정본명으로 대응.
6. 코드: `services/ai/` gateway adapters, model registry, question sets, state builder, prompt version, `infra/gpu/model-router.conf`, `infra/gpu/README.md`, `infra/compose.gpu.yaml`, `infra/env/ai-local.env.example`, `infra/run-modes.json`, worker env, tests, evidence, dashboards status. `training/bosun/`의 기존 smoke 코드는 서버에서 별도로 진행한 실험 결과이며 git repo에 있다는 보장 없음. 먼저 `git status`와 실제 파일 존재를 확인.

### 7. Claude Code가 내야 할 결과

(1) **as-is/to-be 모델·API 아키텍처 표**와 모델별 책임 경계, 학습 라벨 변환 규칙.
(2) **구식 Kev-9B/Qwen3.5-9B 참조 전체 목록**(파일/라인/처리) 및 `KEV_*` → `BOSUN_*` 호환·이관표.
(3) ADR 초안: 모델 교체 근거·학습 목표·endpoint path/compatibility·서빙 방식/보안·롤백·데모 컷·리스크/미확인 항목.
(4) 파일별 변경 계획을 먼저 제시한 후 정본과 코드 수정(사용자 승인 범위를 준수), `pnpm check:env`, 타입 검사, 단위/계약/회귀 테스트 결과.
(5) 학습 번들 스키마 예시: Bosun 질문별 `choice|score|noul` + Qwen 추출 SFT + Explanation SFT; 데이터 누수 방지 검증기와 메트릭.
(6) 서버에 실제 배포 없이 mock/fixture 계약 통합 테스트 가능하도록 구성. live 모델 사용·GPU 훈련·회사 nginx/서비스 변경은 승인 전 금지.

**핵심:** 모델 변경에 의해 규칙·SOL Score·데이터 계약·실행 모드 및 오프라인 평가 우선 원칙이 흐트러지지 않도록 하라. 이 문서는 기존 네 문서보다 우선하는 *검토 요청*이며, 정본 확정 전 충돌을 ADR에서 드러내야 한다.
