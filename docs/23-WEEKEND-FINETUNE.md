---
title: "23. 주말 파인튜닝 계획: Bosun v3.1 0.6B 평가·학습 — 회사 GPU 엔드포인트·오픈 데이터·Hugging Face 모델"
doc: "23"
status: draft
tags:
  - sol-radar
  - ai
  - ops
  - hackathon
updated: 2026-10-21
---

# 23. 주말 파인튜닝 계획: Bosun v3.1 0.6B 평가·학습 — 회사 GPU 엔드포인트·오픈 데이터·Hugging Face 모델

> [!tip] 이 문서의 역할
> 회사 GPU 서버에서 **2026-10-24(토)~10-25(일)** 에 돌릴 Bosun v3.1 0.6B LoRA 이어 학습과 오프라인 평가([[16-DECISIONS|ADR-034]] 7·12번)에 대해 ① 엔드포인트, ② 학습 데이터를 **오픈 데이터**에서 어떻게 가져오는지, ③ Hugging Face 에서 어떤 모델을 받는지를 확정하고, 주중 준비(B1~B3)와 주말 시간표를 정한다. [[21-MODEL-TRAINING|21 모델 학습]]은 "무엇을 왜", [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]는 "어떤 명령으로"가 정본이다. 이 문서는 그 둘을 주말 한 번의 실행에 맞게 고른 **선택과 일정**이다. 21·22와 다르면 주말 실행에 한해 이 문서를 따르고, 끝나면 §9의 상태대로 정본에 되돌린다.

> [!success] 채택 (2026-10-20, 사용자. [[16-DECISIONS|ADR-034]])
> ① 결정 모델은 `Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`, 학습은 공개 LoRA 이어 학습, 기준선은 E1'(공개 Bosun zero-shot), 채점은 서버 안 오프라인 `sol_eval.bosun_score`. ② 추출·설명 모델은 회사가 이미 운영 중인 vLLM API 의 `Qwen/Qwen3.8-Flash-Next`(같은 날 저녁 개정. 모델은 2026-10-21 사용자 보고로 Qwen3.5-27B 에서 교체) — **Qwen 파인튜닝은 하지 않는다**. ③ GPU 1 은 PaddleOCR 와 공유. ④ 엔드포인트·라우터·`/kev` 경로·`KEV_*` 이름은 변경 없음. ⑤ 주말 10-24~25 는 Bosun 평가·학습 일정으로 재계획(ADR-034 12번).
> 2026-10-19 승인(ADR-027: Kev-9B LoRA, `kev.benchmark` A안)은 ADR-034 로 **폐기**됐고 아래는 그 개정판이다. 보존한 원칙: 데모 모델은 공개본, 학습본은 E4 비교만, 서버 안 오프라인 채점, Δ 95% CI 가 0 을 배제해야 "개선", 사람 라벨은 사용자, 중단선.

> [!warning] 범위
> - 학습 대상은 **Bosun v3.1 0.6B 공개 LoRA 이어 학습**(`en` state, decision 임베딩 동결)뿐이다. Qwen 파인튜닝은 하지 않는다(ADR-034 8번 개정). Kev-9B·Kev-4B 경로는 퇴역이다.
> - 데모·S-LIVE 모델은 **공개 Bosun** 그대로다. 학습본은 E4 비교에만 쓰고, 교체는 개선·회귀 안정성 입증 + 사용자 승인 뒤에만(Q7).
> - 유료 hosted API·클라우드 GPU 임대·유료 LLM 라벨 생성은 쓰지 않는다(ADR-010). 돈이 드는 경로는 이 문서에 없다.
> - 회사 GPU 는 A40 46,068 MiB **3장** 중 **물리 index 1 한 장**을 PaddleOCR 와 **공유**해 쓴다(§2.4, [[22-FINETUNE-RUNBOOK|22]] §3.1). GPU 학습·서빙 시작·nginx 변경은 사용자 승인 전까지 하지 않는다. 메모리·시간 수치는 F1 실측 전 추정이다.
> - 이 문서가 부르는 `services/decision`·`sol_eval bosun_score`·`infra/gpu/bosun-preflight.sh`·`bosun-f1.sh` 는 B1 로 main `1b68f9b` 에 들어갔다(2026-10-21). 이 도구들은 회사 서버에서 아직 실행하지 않았다(2026-10-20 환경 확인과 회사의 2-step CPU 학습은 별도, [[22-FINETUNE-RUNBOOK|22]] §3.1·§3.2).

## 0. 한눈에

| 항목 | 결정 |
|---|---|
| 언제 | 10-21~22 B1 코드·B2 서버 준비, 10-22~23 B3 번들·EX0·E3 측정, **10-24(토) F1 smoke → F2 학습, 10-25(일) E4·E1' 오프라인 채점**, 10-26(월) 제출물 반영(§1, ADR-034 12번) |
| 어디서 | 회사 GPU 서버 `sol-NF5280M6`(외부 접근 불가. 셸은 계정 `bim`), **물리 GPU 1(A40 46,068 MiB), PaddleOCR 와 공유**. GPU 0·2 는 회사 서비스라 건드리지 않는다(§2.4). 실행은 회사 측, 우리는 코드·번들·요청서·평가([[16-DECISIONS\|ADR-025]]) |
| 모델 | 결정 `Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`(백본 `Qwen/Qwen3-0.6B@c1899de`, 동결). 추출·설명 `Qwen/Qwen3.8-Flash-Next` = **회사 운영 vLLM API**(GPU 1 에 띄우지 않음, 학습 없음). 백업(미사용) `Qwen/Qwen3-4B-Instruct-2507@cdbee75f`(§3) |
| 데이터 | 오픈 데이터. **A** 나라장터 Open API 실공고(서비스키 보유, 이용허락 제한 없음) × **C** 우리가 만든 가상 기업 원형 6개의 구성 라벨 → **질문 하나 = 레코드 하나**(§4). Kev 공개 replay(옛 **B**)는 퇴역 |
| 엔드포인트 | **변경 없음**. 회사 nginx 의 SOL RADAR location `https://acropolissg.com/sol-radar` 하나, 라우터 `/kev`→`127.0.0.1:8009`(런타임만 `sol_decision` Bosun). Qwen 호출은 회사가 운영하는 vLLM API(`QWEN_BASE_URL`, 03·10). 학습본은 HTTPS 로 서빙하지 않고 **서버 안 오프라인 채점**(§2.2) |
| 결과 | `docs/evidence/bosun-train-feasibility.md`(F1·F2), `docs/evidence/eval/e4-<일시>.md`(E4 Δ·95% CI), `docs/evidence/phase-5/endpoint-bosun-<일시>.md`(B2), `docs/submission/experiment-tables.md` 표 (c). Kev 기록(`docs/evidence/kev-train-feasibility.md`)은 보존 |
| 중단선 | **토요일 18:00 KST 까지 F2 가 시작되지 않으면 사용자에게 보고한다**(ADR-034 12번). 그 뒤 선택은 사용자 몫이고 이 문서는 대체 모델 경로를 두지 않는다 |

## 1. 시간표

날짜는 KST. 회사 측 작업은 **회사**, 우리 쪽은 **우리**로 표시한다. 정본은 [[16-DECISIONS|ADR-034]] 12번·[분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) §9 다.

| 날짜 | 단계 | 누가 | 할 일 | 산출물 |
|---|---|---|---|---|
| 10-20(화) | B0 | 우리 | ADR-034 채택 기록, 22·23 개정(이 문서). §4.3 수집 1일차는 **실행하지 않는다**(10-20 실사용 762/1,000, §4.3). 가상 기업 원형 6개 JSON 작성(§4.2 C) | 16·22·23, `fixtures/recorded/train/` 또는 Supabase live 공고, `fixtures/eval/companies/*.json` |
| 10-20(화) | — | 회사 | **당시 기록**: 오전 서버 환경 확인(A40 ×3, torch 2.8.0+cu128, 당시 `.venv-kev`), 오후 Kev-9B 가중치 다운로드(`db029f08`, 퇴역)·`.venv-bosun` 에서 Bosun CPU 2-step 학습 성공(장난감 6건)·PaddleOCR 가 GPU 1 약 9,167 MiB 사용 보고 | [F1 기록](evidence/kev-train-feasibility.md) §0, 사용자 보고(미검증) |
| 10-21(수)~22(목) | B1 | 우리 | `services/decision`(`sol_decision.serve`·`train`, 호환성 테스트), 레지스트리·settings·`local_setup`, `sol_eval` `--format bosun`·`bosun_score`·`leakage`, `infra/gpu/bosun-preflight.sh`·`bosun-f1.sh`, UI 문구 중립화, 테스트 갱신. `pnpm verify`·`uv run pytest` 초록, `kev-no-override`·`review.independent` **무수정 통과** | 코드, 핀 목록, 22 §3.2 명령의 인자 확정 |
| 10-21(수)~22(목) | B2 | 회사 | `.venv-bosun` 핀 `uv pip install --dry-run` → 설치(torch 불변), Bosun·백본 다운로드 + sha256 대조(22 §2.2), `bosun-preflight.sh` 통과. **사용자 승인 뒤** `sol_decision.serve`(8009) 기동(GPU 1, PaddleOCR 공존). 라우터 그대로. 회사 Qwen3.8-Flash-Next API 는 키 전달·`GET /v1/models` id·guided JSON·`prompt_logprobs` 확인만 | `runs/preflight-*.log`, `venv-bosun-freeze.txt`, 서버 안 `curl …/sol-radar/kev/v1/models` 응답 |
| 10-22(목)~23(금) | B3 | 우리 | **번들 확정** `sol-dataset-v0.1/` 폴더(`bosun/` 레코드·manifest·leakage 리포트) + 파일별 sha256(tar 로 묶지 않는다, 미결정 29-3), 학습 요청서(22 §6) 전송. `bosun_score` 를 가짜 출력으로 시험(§6). EX0(회사 Qwen API)·E3 기준선을 노트북에서 엔드포인트로 측정(E2 는 보조. E1' 은 B5 오프라인 채점, [[16-DECISIONS\|16]] 미결정 29-1). 밖에서 C1 ③ G1~G6 재실행 | 번들, 요청서, `docs/evidence/eval/`(EX0·E3), `docs/evidence/phase-5/endpoint-bosun-<일시>.md` |
| 10-23(금) | — | 우리 | 기능 freeze. 회사 답(§8) 받기 | — |
| 10-24(토) 09:00~12:00 | B4 | 회사 | **F1** `bosun-f1.sh`(기본 `--max-steps 20`, 22 §4.2): 격자 1→2(→3). 물리 GPU 1(공유). 앞 칸 PASS 때만 다음 칸. 결과 표 전송 | `runs/f1-results.md`, `runs/bosun-f1-*.summary.md`, `nvidia-smi` csv |
| 10-24(토) 13:00~ | B4 | 회사 | **F2** 학습(22 §4.3), F1 PASS 설정으로. 소요 시간은 F1 의 step 시간(`training_metrics.json` 의 `metrics.meanStepSeconds`. f1 요약 칸은 로딩 포함 wall/step 이다, 미결정 26-15)으로 재추정한다(**미확정**). 토요일 안에 끝나지 않으면 일요일 오전으로 넘기고 채점을 뒤로 민다. 패키지 저장·재로딩 확인. **18:00 까지 F2 미시작이면 사용자 보고** | `runs/bosun-sol-lora-v0.1/`, `train.log`, 메트릭 |
| 10-25(일) 09:00~ | B5 | 회사 | **F3** dev 보정 → 서버 안 `sol_eval bosun_score` 4회(E4·E1' × test·dev, `--seeds 0-5`, 한 모델씩 순차. 언어 짝 비교용 E2 는 `bosun/{split}.ko.jsonl` 내보내기(B2 뒤 ed)가 생기면 같은 방식으로 더한다, 미결정 29-6) → 출력 폴더 4개를 통째로 전송(§2.2). 엔드포인트·라우터 변경 없음 | `MODEL_CARD.md`, `report.json`·`rows.json`·`predictions.jsonl` 4벌, `calibration.json`, sha256 |
| 10-25(일) 오후 | B5 | 우리 | 받은 출력의 패키지 sha256·test 파일 sha256 을 번들 manifest 와 대조 → `sol_eval` 오프라인 지표 → 사업 클러스터 짝 부트스트랩 Δ·95% CI | `docs/evidence/eval/e4-<일시>.md`, 레지스트리 `bosun-sol-lora-v0.1.reports` |
| 10-26(월) | B6 | 우리 | `experiment-tables.md` (c)·`limitations.md` E4 문장·슬라이드 | 제출물 |

Qwen 학습 일정은 **없다**(2026-10-20 저녁 개정. 옛 "10-25 조건부 Qwen 4B QLoRA" 행 삭제).

10-24 최종 리허설(C9)과 겹친다. 우리 추론 런타임 중 GPU 1 에 있는 것은 `sol_decision` Bosun(8009)뿐이고, 학습과 같은 GPU 에 공존하는 것이 기본 계획이다(§2.4 추정 합계 안). 우리 절차로 8009 를 내리지 않는다 — 어떤 프로세스도 종료·이동하지 않는다([[10-DEPLOYMENT|10]] GPU 절 "추론 런타임과의 관계", ADR-034 10번). F1 에서 합계가 넘치면 멈추고 회사에 보고한다. 8009 를 내릴지·언제 내릴지와 그때의 `live`·`fixture` 리허설 시간은 사람이 정한다. 데모 본편은 `mock` 이라 영향이 없다.

## 2. 엔드포인트

### 2.1 등록은 하나뿐이다 (변경 없음)

회사 nginx 의 SOL RADAR location 은 `https://acropolissg.com/sol-radar` **하나**다([[16-DECISIONS|ADR-025]]). 이 문서는 그 제약 안에서만 움직인다.

- 회사 nginx 에 **주말에도 아무것도 더 요청하지 않는다.** 새 도메인·새 location·설정 변경 없음.
- 경로 분기는 등록된 location 뒤에 있는 우리 모델 라우터(`infra/gpu/model-router.conf`, GPU 서버 안 `127.0.0.1:8080`)가 한다. `/kev` → `127.0.0.1:8009` 는 그대로고 **런타임만 `kev.serve` 에서 우리 `sol_decision.serve`(Bosun)로 바뀐다**(ADR-034 3·4번). `/qwen` → `127.0.0.1:8001` 규칙은 **백업(미사용)** 으로 남고 8001 에 vLLM 을 띄우지 않는다 — Qwen 호출은 회사가 이미 운영하는 vLLM API(`QWEN_BASE_URL`, 주소·키는 [[03-AI-PIPELINE|03]]·[[10-DEPLOYMENT|10]])로 간다.
- 학습본은 **HTTPS 로 서빙하지 않는다.** E4 평가는 서버 안 오프라인 채점으로 한다(§2.2). 라우터도 바꾸지 않고 평가 전용 인스턴스(옛 B안 `/kev-lora`·8010)도 띄우지 않는다. 옛 C안(`/kev` 를 시간 한정으로 학습본으로 교체)도 **삭제**한다 — 데모 모델은 공개 Bosun 이고 레지스트리 대조(`bosun-v3.1-0.6b`)를 깨지 않는다.

| 밖에서 보이는 주소 | 회사 nginx | 우리 라우터(8080) | 런타임 | 주말 변경 |
|---|---|---|---|---|
| `https://acropolissg.com/sol-radar/healthz` | location 하나로 통과 | `200 ok` | — | 없음 |
| `https://acropolissg.com/sol-radar/kev/v1/*` | 같은 location | → `127.0.0.1:8009` | **`sol_decision.serve` Bosun v3.1 0.6B**(B2 에서 사용자 승인 뒤 기동) | 없음 |
| `https://acropolissg.com/sol-radar/qwen/v1/*` | 같은 location | → `127.0.0.1:8001` | **백업(미사용)**. 띄우지 않는다 | 없음 |
| 회사 vLLM API(`QWEN_BASE_URL`, 03·10) | 회사 운영 location | — | `Qwen/Qwen3.8-Flash-Next`(회사 운영) | 없음(키·`/v1/models` 확인만) |
| (주소 없음) | — | — | 학습본 `runs/bosun-sol-lora-v0.1` | 서빙하지 않는다. 오프라인 채점(§2.2) |

### 2.2 학습본을 엔드포인트 없이 평가하는 법: 서버 안 오프라인 `sol_eval bosun_score`

회사가 같은 test·dev 파일로 학습본과 공개 Bosun 을 각각 `python -m sol_eval bosun_score`(main `1b68f9b`)로 채점하고 출력 폴더를 그대로 돌려준다. 우리 `sol_eval` 은 그 출력(`predictions.jsonl`·`rows.json`·`report.json`)을 읽어 21 §4.3 지표를 낸다. 네트워크·라우터·추가 GPU 메모리가 필요 없다.

```bash
# 회사, 일요일(22 §4.4 와 같은 명령. 물리 GPU 1 만, 모델은 한 번에 하나씩. 출력 폴더 4개를 통째로 돌려준다)
export SOL_WORK=/data/www/ai_workspace/sol-radar
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1 HF_HUB_OFFLINE=1
export HF_HOME="$SOL_WORK/hf"                                   # preflight 기본값과 같게
source "$SOL_WORK/.venv-bosun/bin/activate"                     # sol_eval 설치는 22 §3.2(uv run 아님)
cd "$SOL_WORK"
snap=$HF_HOME/hub/models--Hanno-Labs--bosun-v3.1-0.6b/snapshots/5e78a37c8d86860ebac9ef2d5327d6299498498e
sha256sum "$snap/adapter/adapter_model.safetensors" "$snap/decision_embeddings.safetensors"      # 22 §2.2 값과 같아야 한다
# 경로는 모두 절대 경로로 준다. 상대 --out 은 sol_eval 이 저장소 clone 기준으로 풀어 출력이 clone 의 runs/ 에 생긴다
D="$SOL_WORK/sol-dataset-v0.1/bosun"; R="$SOL_WORK/runs"
python -m sol_eval bosun_score --package "$R/bosun-sol-lora-v0.1" --data "$D/dev.en.jsonl"  --seeds 0-5 --out "$R/e4-dev"
python -m sol_eval bosun_score --package "$R/bosun-sol-lora-v0.1" --data "$D/test.en.jsonl" --seeds 0-5 --out "$R/e4-test"
python -m sol_eval bosun_score --package "$snap"                  --data "$D/test.en.jsonl" --seeds 0-5 --out "$R/e1p-test"
python -m sol_eval bosun_score --package "$snap"                  --data "$D/dev.en.jsonl"  --seeds 0-5 --out "$R/e1p-dev"
```

- 지금(main `4e62170`) `bosun_score` 는 장치를 지정하지 않아 CPU fp32 로 돈다. 10-25 B5 채점도 CPU fp32 로 돌리고, 소요 시간은 미측정이다. read-check(§4.5) 때 시간을 재서 일정을 다시 잡는다. E1'·E4 가 같은 CPU fp32 로 돌아 비교는 성립하고 느리다. GPU bf16 으로 바꾸면(해커톤 뒤, [[16-DECISIONS|16]] 미결정 26-16) E1'·E4 를 같은 장치·dtype 으로 다시 잰다.
- 선택지 순서 민감도는 Kev 의 `permute`·`--rotations` 대신 Bosun 의 제시 순서 seed(`--seeds 0-5`, 6회)로 잰다(22 §4.1).
- 요청당 지연 p50·p95 는 서빙이 없으므로 **E4 에서는 재지 않는다.** 지연은 B2 의 G3(공개 Bosun 서빙)에서 잰다.
- 돌려받은 `report.json` 의 패키지 sha256·test 파일 sha256 이 번들 manifest 와 같은지 대조한다. 다르면 그 결과는 쓰지 않는다.
- 옛 B안(라우터 `/kev-lora` → 8010 평가 전용 서빙)과 C안(`/kev` 교체)은 삭제했다. 지연·순서 실측이 꼭 필요해도 라우터를 바꾸지 않는다.

### 2.3 확인 순서

서버 안(회사, 키 값은 셸 변수로만):

```bash
curl -s http://127.0.0.1:8080/healthz                                                        # ok
curl -s -H "Authorization: Bearer $KEV_API_KEY" http://127.0.0.1:8080/sol-radar/kev/v1/models   # run: Hanno-Labs/bosun-v3.1-0.6b@5e78a37c… (B2 기동 뒤. 데모 경로 불변)
nvidia-smi -i 1 --query-gpu=memory.used --format=csv                                         # PaddleOCR + sol_decision 합계 기록
ls "$SOL_WORK"/runs/{e4-dev,e4-test,e1p-test,e1p-dev}                                      # report.json rows.json predictions.jsonl
sha256sum "$SOL_WORK/sol-dataset-v0.1/bosun/test.en.jsonl"                                   # manifest 값과 같아야 한다
```

밖(우리, 노트북): 데모 경로와 회사 Qwen API 만 본다.

```bash
curl -sS -o /dev/null -w 'http=%{http_code}\n' https://acropolissg.com/sol-radar/healthz        # 200, -k 금지
curl -sS -o /dev/null -w 'http=%{http_code}\n' https://acropolissg.com/sol-radar/kev/v1/models  # 인증 없이 401 또는 403
curl -s -H "Authorization: Bearer $QWEN_API_KEY" "$QWEN_BASE_URL/models"                        # id: Qwen/Qwen3.8-Flash-Next (값이 /v1 로 끝나므로 /models 만 붙인다)
```

게이트웨이 쪽은 `/api/v1/admin/ai/status` 의 `kev.modelId=bosun-v3.1-0.6b`·`kev.registryMatch: true`·`qwen.model=Qwen/Qwen3.8-Flash-Next` 로 확인한다(계획 개정 콜아웃).

### 2.4 학습과 추론의 GPU 동시 점유 (GPU 1 공유)

2026-10-20 확인·보고: A40 46,068 MiB 가 **3장**이고 SOL RADAR 가 쓰는 것은 **물리 GPU 1 한 장**이다. GPU 0(4,747 MiB)·2(9,240 MiB)는 회사 기존 서비스가 쓰고 있어 어떤 경우에도 쓰지 않고 그 프로세스를 종료·이동하지 않는다. GPU 1 도 **전용이 아니다** — 회사 PaddleOCR vLLM 이 약 9,167 MiB 를 쓰고 있다(사용자 보고, 오전 "5 MiB" 는 당시 스냅샷). 3장의 VRAM 을 합치지 않고 다중 GPU 학습도 하지 않는다. 모든 학습·채점 명령은 `CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1` 아래에서 돌리고 프로세스 안에서는 `cuda:0` 으로 보인다(가시성만 제한, 독점 아님).

| 상주·작업 | 추정 메모리 | 비고 |
|---|---|---|
| PaddleOCR vLLM(회사) | 약 9.2 GB | 건드리지 않음. 피크 미확인(§8) |
| `sol_decision.serve` Bosun bf16 서빙 | 약 1.5~3 GB | 6k 토큰 state 활성값 포함 |
| Bosun LoRA 학습(bf16, batch 1, 6k 토큰, gradient checkpointing) | 약 6~10 GB | F1 20 step 으로 실측 |
| `sol_eval bosun_score` 채점(패키지 하나씩) | 지금은 CPU fp32 라 GPU 메모리를 쓰지 않는다(26-16 뒤 GPU 로 바꾸면 서빙과 비슷, 추정) | 4회를 순서대로 돌리면 동시 점유는 1회분 |
| ~~vLLM Qwen3-4B·Qwen 4B QLoRA~~ | — | 철회(2026-10-20 저녁). Qwen 은 회사 API, GPU 1 에 올리지 않는다 |

**전부 추정, F1 실측 전**([분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) §8). 합계 약 17~22 GB 로 가용 약 36,900 MiB 안에 들어간다고 **가정**한다. PaddleOCR 피크가 크면 달라진다.

| 경우 | 토요일(F1·F2) | 일요일(F3·채점 4회) |
|---|---|---|
| 합계가 들어간다(기본 가정) | GPU 1 에서 PaddleOCR + Bosun 서빙 + 학습 공존. 데모 `live`·`fixture` 영향 없음 | PaddleOCR + 서빙 + 채점(순차). 영향 없음 |
| F1 에서 합계가 넘친다 | 멈추고 회사에 보고한다. 우리 절차로 `sol_decision.serve` 를 내리지 않는다(PaddleOCR 도 대상 아님). 서빙을 내릴지·언제 내릴지와 리허설의 `live`·`fixture` 확인 시간은 사람이 정한다 | 토요일에 사람이 정한 방식을 따르고 채점 4회는 순서대로. 그 결정으로 서빙이 멈췄으면 끝난 뒤 공개 Bosun 서빙 복구를 회사에 확인한다 |
| PaddleOCR 피크로 OOM | 종료·이동하지 않고 멈춘다. 회사에 시간대를 확인하고 다시 돈다 | 같다 |

옛 "1장 80 GB"·"24 GB"·"2장 이상"·"GPU 1 전용" 경우는 해당 없음으로 닫는다. 학습이 GPU 1 을 쓰는 동안 데모 앱은 `mock` 모드로 두면 영향이 없다(발표 본편 모드).

### 2.5 선행 조건

| # | 조건 | 받을 곳 | 기한 |
|---|---|---|---|
| P2 | `/sol-radar/` location·Bearer 인증은 확정(ADR-025). 남은 것: 회사 Qwen3.8-Flash-Next API 의 키 전달·`GET /v1/models` id·추가 인증·호출 한도 | 회사 | 10-21 |
| P3 | `sol_decision.serve`(8009) 기동 완료 통보 — **사용자 승인 뒤** B2 에서 | 회사 | 10-22 |
| P4 | GPU 1 공유 조건: PaddleOCR 피크 메모리·시간대, 토·일 학습 시간대, 외부망(huggingface.co·pypi.org) 가능 여부, `.venv-bosun` 핀 목록 | 회사(미결정 22) | **10-22** |
| P5 | 일요일에 서버 안에서 `bosun_score` 4회를 돌리고 출력 폴더(`report.json`·`rows.json`·`predictions.jsonl`, 수십 MB)를 보내 줄 수 있는지. 회사 nginx·라우터 변경은 요청하지 않는다 | 회사 | 10-22 |

외부망 답이 10-22 까지 없으면 22 §2.2 의 **반입 2안**(우리가 다른 기계에서 받아 넘김)을 기본으로 준비한다.

## 3. 모델 (Hugging Face)

### 3.1 받을 것·쓰는 것

| 역할 | id | 고정 리비전 | 라이선스 | 크기·메모리 | 쓰임 |
|---|---|---|---|---|---|
| **결정 모델(출발 체크포인트)** | `Hanno-Labs/bosun-v3.1-0.6b` | `5e78a37c8d86860ebac9ef2d5327d6299498498e`(main, 2026-10-09) | Apache-2.0(Clause Logic Inc.) | LoRA r=16(392 텐서, 10,092,544 파라미터) + decision 임베딩 256행. 서빙 추정 1.5~3 GB, 학습 추정 6~10 GB | `sol_decision.serve --package <snapshot>`, `sol_decision.train` 출발점, E1' 기준선 |
| 백본(동결) | `Qwen/Qwen3-0.6B` | `c1899de289a04d12100db370d81485cdf75e47ca` | Apache-2.0 | 28층, hidden 1024, ctx 40,960. 크기·sha256 은 B2 에서 기록 | `BosunForDecision.from_pretrained` 가 읽는다 |
| 추출·설명(데모) | `Qwen/Qwen3.8-Flash-Next` | 회사 운영 값(우리가 고정하지 않음) | 회사 운영 | 회사 vLLM API. **GPU 1 에 띄우지 않는다** | 게이트웨이 `/extract`·`/explain`·`translations`, E3 logprob(`prompt_logprobs` 지원 여부 B2 확인), 갈래 ② train 추출 |
| **백업(미사용)** | `Qwen/Qwen3-4B-Instruct-2507` | `cdbee75f17c01a7cc42f958dc650907174af0554` | Apache-2.0 | bf16 약 8 GB | 2026-10-20 저녁 철회. 다운로드·venv·서빙·학습 중단. 레지스트리 `status: backup` |

> [!success] 검증됨 (2026-10-20, Hugging Face API·파일 원문. 확인 주체는 [분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) §1 세션)
> - 리비전 존재: Bosun `5e78a37c…`(main), `Qwen/Qwen3-0.6B@c1899de…`, (백업) `Qwen/Qwen3-4B-Instruct-2507@cdbee75f…`.
> - Bosun: `adapter/adapter_model.safetensors` sha256 `961d237b…`, `decision_embeddings.safetensors` sha256 `88f9e856…`(전체 값은 22 §2.1). decision token 256개, `prompt_schema: bosun-decision-prompt-v3-stable-slots`. API `predict`(inference_mode)·`decision_logits`(학습용)·`render_decision_prompt`. state 길이 제한 없음. DecisionBench acc 0.8118, ECE 0.0659, 후보 2~5개 0.95 안팎, `rubric_scoring_prioritization` 0.707.
> - Bosun 학습 코드는 공개되지 않았다. Hanno `jev-compatible-server` 는 LICENSE 없음·인증 없음·`/v1/models` 없음 → 참고만.

### 3.2 쓰지 않는 것

- Kev 전부: `jaredpalmer/kev-9b`(가중치는 2026-10-20 서버에 받았다, `db029f08` — 퇴역, 지우지 않아도 됨)·`kev-4b`·`kev-suites` replay·`kev` 패키지(`kev.train`·`kev.benchmark`·`kev.compare`·`kev.serve`)·`Qwen/Qwen3.5-9B(-Base)`. 이력은 ADR-027(폐기).
- Hanno `jev-compatible-server`: Bosun 을 이것으로 띄우지 않는다(Q1). 우리 `sol_decision.serve` 만.
- Bosun 의 GGUF 등 양자화 변환본, Bosun-4B·Bosun-XS(Qwen3-Reranker 기반 yes/no 크로스인코더, 다른 세대).
- Qwen 파인튜닝 전부(QLoRA·LLaMA-Factory·병합 서빙)와 Qwen 4B 다운로드·`.venv-qwen`(백업, 중단).
- hosted API·클라우드 GPU 임대(ADR-010).

### 3.3 받는 명령 (회사, B2)

22 §2.2 그대로다. 외부망이 있으면 1안, 없으면 2안(우리가 다른 기계에서 같은 명령으로 받아 `$HF_HOME/hub` 와 `services/decision` 소스·wheel 묶음을 넘기고, 서버에서는 `HF_HUB_OFFLINE=1`).

```bash
export SOL_WORK=/data/www/ai_workspace/sol-radar          # 전용 경로(2026-10-20 확인). /data 가용 약 1,011 GB
export HF_HOME=$SOL_WORK/hf
hf download Hanno-Labs/bosun-v3.1-0.6b --revision 5e78a37c8d86860ebac9ef2d5327d6299498498e
hf download Qwen/Qwen3-0.6B            --revision c1899de289a04d12100db370d81485cdf75e47ca
# Qwen3-4B-Instruct-2507 은 백업이라 받지 않는다
```

받은 뒤 `adapter/adapter_model.safetensors`·`decision_embeddings.safetensors` 의 sha256 을 22 §2.2 기대값(전체 값 기록됨)과 대조한다. `infra/gpu/bosun-preflight.sh`(main `1b68f9b`)가 고정 snapshot 디렉터리(`snapshots/5e78a37c…`)에서 같은 대조를 하고 없거나 다르면 FAIL, `bosun-f1.sh` 는 실행 직전에 다시 대조한 뒤 그 로컬 디렉터리를 `--package` 에 준다. 다르면 학습을 시작하지 않는다.

## 4. 데이터: 오픈 데이터에서 가져온다

### 4.1 원칙

1. **공개·무료·이용 조건이 확인된 출처만** 쓴다. 필요한 것은 data.go.kr 서비스키 4개(이미 보유, ADR-022)뿐이다.
2. 라벨은 **구성(`CONSTRUCTED`)·규칙(`RULE_SILVER`)·사람(`HUMAN`)** 으로만 만든다. 유료 외부 모델 라벨은 없다(22 §4.1).
3. 담당자 이름·전화·이메일은 처음부터 넣지 않는다. 본문의 전화·이메일 패턴은 같은 길이로 마스킹한다([[21-MODEL-TRAINING|21]] §3.6).
4. 첨부(RFP) 원문은 번들에 **원문 전체로 넣지 않는다**. state 에는 추출값·인용 구절만 들어간다. 저작권·학습 사용 권리는 미확인이라(16 미결정 18) 회사 내부 학습에만 쓰고 Hugging Face 에 올리지 않는다.
5. test·dev 사업 클러스터는 train 에 0건(21 §3.6). fixture `FX-01`~`FX-20` 은 넣지 않는다(회귀용).
6. 낙찰·개찰 결과는 수집도 라벨로도 쓰지 않는다(승률 예측 범위 밖, [[01-PRD|01]]).

### 4.2 출처 표

| 층 | 출처 | 무엇을 쓰나 | 이용 조건 | 양·한도 | 상태 |
|---|---|---|---|---|---|
| **A1** | 나라장터 입찰공고정보서비스 `15129394`(data.go.kr) — `getBidPblancListInfoServc`(목록)·`…ChgHstryServc`(변경이력)·`…LicenseLimit`(면허제한)·`…PrtcptPsblRgn`(참가가능지역)·`…EorderAtchFileInfo`(e발주 첨부) | 공고 메타·예산·마감·**면허제한·참가지역**(구조화 자격 필드) | 이용허락범위 제한 없음(`infra/sources/registry.yaml` `redistributionLimit`, data.go.kr 명세 2026-10-16). 개발계정 **1,000건/일/서비스**, `numOfRows` 최대 999 | 7일 용역 공고 3,555건(2026-10-12~19 실측). 정보화사업(`infoBizYn='Y'`) 표본 6/100 → 약 6% | 서비스키 있음, 실호출 통과(C1 ①) |
| A2 | 업종 및 근거법규 `15129467` | 업종 코드·근거 법규 전체 2,916행 → 자격 사전, `RULE_SILVER` 라벨 근거 | 같음 | 3페이지(999×3) 녹음본 `fixtures/recorded/15129467/` | 이미 받음 |
| A3 | 사전규격 `15129437`·발주계획 `15129462` | 단계 연결(P0-8) | 같음 | — | 확장 컷. **주말 학습에 안 쓴다** |
| A4 | g2b 첨부(`https://www.g2b.go.kr`, 익명 GET) | 공고문·제안요청서 HWPX·PDF → 파싱 텍스트 → 회사 Qwen3.8-Flash-Next API 추출(갈래 ②) | 다운로드는 로그인 없이 200(C1 ②). 이용약관·저작권 미확인(미결정 16·18) → 내부 학습만 | 공고당 1~3건 | 파서(`/parse`) 미구현. C1 ④·C3 뒤에만 |
| ~~B~~ | ~~`jaredpalmer/kev-suites` `v7/decision-v7`~~ | ~~Kev 공개 replay 2,000건(망각 방지)~~ | — | — | **퇴역(2026-10-20)**. Bosun 학습 레시피(계획 §4.2)에 replay 는 없다. 회귀·망각 확인은 내부 dev 세트가 기본이고 DecisionBench 는 조건 확인 뒤 보조 평가로만 쓴다(**결정 2026-10-20**, ADR-034 9번, §10) |
| **C** | 가상 기업 원형 6개(`fixtures/eval/companies/*.json`, 21 §3.2) + 항목별 변형(21 §3.3) | 회사 쪽 state 와 라벨 | 우리가 만든 가상 데이터(실제 회사 이름·실적 없음) | 원형 6 × 변형 3~4 | **아직 없음**. 10-20~21 작성 |
| 참고 | 솔리데오 가상 프로필 `fixtures/company/solideo-profile.json`(08 §6.1) | 원형 2(중견 공공 SI)의 출발점 | 가상 | 1 | 있음 |

검토했으나 **쓰지 않는** 오픈 데이터:

| 후보 | 이유 |
|---|---|
| AI Hub(aihub.or.kr) 공공 행정문서·기계독해 데이터 | 이용 신청·약관 절차가 있어 주말 전 확보가 불확실하고, 입찰 공고·RFP 도메인 데이터는 2026-10-19 검색에서 확인하지 못했다 |
| Hugging Face 공개 한국어 데이터셋(KLUE·KorQuAD 등) | 조달 도메인이 아니고, Bosun 입력은 영어 템플릿 state 라 쓸 자리가 없다. 나라장터 공고를 모은 공개 HF 데이터셋은 2026-10-19 검색에서 찾지 못했다 |
| DecisionBench(Bosun 공개 학습·평가 데이터) | 도메인이 다르고 state 가 14~18.9k 자다. 회귀 기본 세트가 아니다. 라이선스·중복·재배포 조건 확인 뒤 보조 평가로만 쓴다(`bosun_score --suite … --suite-format decisionbench`, 실행은 별도 승인. §10, ADR-034 9번) |
| EU TED(Tenders Electronic Daily) XML | 재사용 조건 페이지를 확인하지 못했고(2026-10-19, 404), 한국 조달 자격 체계와 달라 라벨 구성이 맞지 않는다 |
| 조달정보개방포털(data.g2b.go.kr) 대용량 파일 | 이용허락·다운로드 한도를 확인하지 못했다. A1 API 로 같은 공고를 받을 수 있어 필요 없다 |
| 낙찰·개찰·계약 데이터 | 범위 밖(§4.1 6번) |

### 4.3 수집 계획 (A1, 10-20~21)

호출 예산은 서비스당 1,000건/일이고, 리허설·시연 몫으로 매일 100건을 남긴다.

> [!warning] 10-20 계획은 실행하지 않는다 (2026-10-20)
> 10-20 실사용이 15129394 762/1,000이다(C8 live run 1회 266회 포함, [야간 기록](plans/2026-10-20-overnight-decisions.md)). 아래 표의 10-20 몫(목록 약 30회 + 보조 조회 450회)은 남은 예산을 넘으므로 그날 계획은 실행하지 않는다. 다시 잡는 날짜와 건수는 정하지 않았다.

| 단계 | 호출 | 건수 | 날짜 |
|---|---|---|---|
| 목록 | `getBidPblancListInfoServc` `inqryDiv=1` 60일(2026-08-20~10-19) `numOfRows=999` | 약 30회(전체 약 30,000행 추정) | 10-20 |
| 정보화 필터 | 클라이언트 쪽(`infoBizYn` 은 요청 파라미터로 무시된다, ADR-029 A4 확대 필터) | 약 1,800건 추정 → **300건** 표본(기관·예산·마감 분포를 고르게) | 10-20 |
| 보조 조회 | 공고당 면허제한·참가지역·e발주 첨부 3회(`inqryDiv=2`, `bidNtceNo`·`bidNtceOrd`) | 150건 × 3 = 450회 | 10-20 |
| 보조 조회 | 나머지 150건 | 450회 | 10-21 |
| 변경이력 | `…ChgHstryServc` 같은 60일 | 약 10회 | 10-21 |

저장 경로는 둘 중 하나다. 주말 전 확실한 쪽은 2안이다.

1. **C3 live 수집**(`OfficialApiConnector` → Supabase `bid_notices` `is_demo=false`) → `EvalItem` → `python -m sol_eval export --format bosun`(먼저 `python -m sol_eval build` 가 만든 `items.{split}.jsonl` 이 있어야 한다). 지금(main `1b68f9b`) `sol_eval` 은 DB 를 읽지 않는다: `sol_eval build` 가 녹음 구조화 필드(갈래 ①)에서 `EvalItem` 을 만들고, DB 에서 만드는 Node 빌더(`pnpm dataset:build`)는 예정이다(21 §3.7). 보조 조회 3종·documents job 이 main 에 아직 없다(C3 남은 일).
2. **녹음 스크립트**: C1 ① 과 같은 방식으로 마스킹한 응답 JSON 을 `fixtures/recorded/train/<serviceId>/<operation>.<date>.pN.masked.json` 에 저장하고, 빌더가 DB 없이 이 파일을 읽는다. 담당자 필드 10개 마스킹과 `serviceKey` 제거 규칙은 `docs/evidence/phase-0/external-deps-api-20261019.md` 를 따른다. 저장소에는 넣지 않고(`.gitignore`) 번들에만 넣는다.

### 4.4 레코드 구성: 질문 단위, 두 갈래

**질문 하나 = 레코드 하나**다(22 §4.1, 계획 §4.2). Kev 의 "state 하나 + 질문 여러 개" 레코드가 아니다. 질문 문구는 `services/ai/kev/question-sets/v0.2.json` 원문(확정, [[16-DECISIONS|ADR-033]] E10), state 는 `services/ai/kev/state-templates/en.v0.2.txt` 와 **서빙과 같은 빌더**로 만든다(둘 다 main 에 있다. 질문 세트 `85a30c6`, state 템플릿 `51ad173`, main 병합 `b4a23fc`). 레코드마다 `qid`·`questionType`·`instructions`·`candidates`(타입별 변환 표 22 §4.1)·`state`·`stateHash`·`gold`·`labelSource`·`reason`·증거를 둔다. Bosun 은 state 를 자르지 않으므로(`truncation=False`, ctx 40,960) Kev 의 `--max_state` 는 없고, state 토큰 수는 manifest 기록용이다.

**갈래 ① 구조화 필드만(엔드포인트·파서 없이 된다. 주말 기본)**

| 구성 | 값 |
|---|---|
| NOTICE 블록 | A1 목록·보조 조회 필드: 단계·기관(종류만)·예산·마감·계약 방법·**면허제한 행**(A2 업종 코드로 정규화)·참가가능지역·첨부 유무 |
| 추출 필드(`requiredSkills`·`pastPerformance`·`staffing` 본문 요구) | `UNKNOWN`(추출 안 함). "첨부를 읽지 못했다" 한 줄(17 절대 규칙) |
| COMPANY 블록 | 원형 6개 × 변형: 보유 면허(`HELD`/`NOT_HELD`/증빙 삭제), 수행 상한, 가용 FTE, 지역 |
| 질문·라벨 | `req.qualifications[*].status`(면허제한 ↔ 보유 면허: `SATISFIED`/`NOT_SATISFIED`/`NEEDS_REVIEW`, 구성 라벨), `risk.scale`(예산 vs 수행 상한, 규칙), `risk.schedule`(마감 vs 오늘, 규칙), `risk.staffing`(가용 FTE, 구성). 면허제한이 여러 행이면 `NEEDS_REVIEW`(`AMBIGUOUS_MATCH`, 미결정 19) |
| 규모 | 300 공고 × 원형 5(1개 홀드아웃) × 변형 3 × 질문 수 → 질문 레코드 수천 행 → **train ≥ 1,000행** 으로 샘플링(계획 §9 B3). 선택지마다 정답 비율 5% 이상, 세 값이 1/3 에 가깝게 |
| state 길이 | 약 500~1,200 토큰(참고. Bosun 은 자르지 않는다) |

이 갈래가 가르치는 것은 "구조화 자격 필드와 회사 보유 상태를 보고 세 값을 가르는 것"과 "정보가 없으면 `NEEDS_REVIEW`" 다. 규칙이 이미 계산하는 항목이지만, 결정 모델은 참고 지표라 규칙과 **같은 방향**으로 보수적으로 답하게 만드는 것이 목적이다(03 §5.5).

**갈래 ② 추출 포함(10-22 저녁 기준 회사 Qwen3.8-Flash-Next API 와 `/parse` PDF·HWPX 가 동작할 때만)**

- 갈래 ① 위에 A4 첨부 → `/parse` → `/extract`(회사 Qwen3.8-Flash-Next API, train 은 silver: 스키마·인용 검증 통과분만) 을 더해 `req.requiredSkills[*].status`·`req.pastPerformance[*].status`·`risk.techGap` 을 구성 라벨로 더한다(22 §4.1 표).
- Qwen 호출은 공고당 1회, 300건 ≤ 300회. 지연·호출 한도는 B2 확인 뒤 계산한다.
- state 길이 최대 6,000 토큰(03 §5.6). Bosun 에는 들어가고, 메모리·step 시간은 F1 에서 긴 레코드로 잰다.

두 갈래 모두 같은 JSONL 형식이라 회사 쪽 명령은 같다. 어느 갈래로 번들을 만들었는지 manifest 와 E4 리포트에 적는다.

**dev·test**: test 20·dev 10 사업(사람 라벨, 사용자 직접)을 쓴다. 10-22 까지 test 라벨이 끝나지 않으면 축소판(fixture 20건 + 실공고 5건, ADR-023 X1, 21 §3.5)을 test 로 쓰고 그 사실을 리포트 첫 줄에 적는다. 어느 쪽이든 train 과 사업 클러스터가 겹치지 않는다.

### 4.5 번들

`sol-dataset-v0.1/` 폴더(22 §4.1 번들 절, tar 로 묶지 않는다):

- `manifest.json`: 데이터셋 버전, git commit, 질문 세트 `kev-qs/v0.2`, state 템플릿 `en.v0.2`, 마스킹 버전, **갈래(①/②)**, 출처별 개수(A1 공고 수·C 원형), 분할별 레코드 수·질문별·선택지별 분포(각 ≥ 5%), train state 토큰 최대값(Bosun 패키지 토크나이저), 파일별 sha256, test·dev 클러스터 교차 0건 확인(`python -m sol_eval leakage`).
- `bosun/train.en.jsonl`·`bosun/dev.en.jsonl`·`bosun/test.en.jsonl`. `kev/`·`qwen/` 디렉터리는 없다.
- 22 §2~§4 와 이 문서 §5~§6.
- 들어가지 않는 것: 서비스키·Supabase 키·담당자 개인정보·첨부 원문 전체·실제 회사 자료·`datasets/decision/smoke.jsonl`(기능 검증용, 번들 밖).

검사(10-22, 우리): JSONL 각 줄이 22 §4.1 형식인지, 같은 `(stateHash, qid)` 에 다른 gold 0건, 선택지 비율, 클러스터 누수(`python -m sol_eval leakage --bundle`, main `1b68f9b`). 회사 쪽에서는 `bosun-preflight.sh` 의 데이터 형식 검사(`SOL_TRAIN_DATA` 의 train 파일 하나)와 `python -m sol_eval bosun_score --package "$snap" --data "$SOL_WORK/sol-dataset-v0.1/bosun/dev.en.jsonl" --seeds 0 --out "$SOL_WORK/runs/read-check-dev"` 로 읽힘을 확인한다(F1 과 같은 시간, §2.2 블록의 env·venv 아래).

## 5. 학습 레시피 (주말용 값)

명령 원문은 22 §4.2·§4.3 이다. `sol_decision.train` 은 main `1b68f9b`(B1)에 있고 인자는 22 §4.3·`services/decision/docs/TRAINING.md` 다. 여기서는 주말에 고정할 것과 F1 로 정할 것을 나눈다.

### 5.1 고정값

| 항목 | 값 | 근거 |
|---|---|---|
| 출발 패키지 | `$snap` = 공개 Bosun snapshot `5e78a37c…`(sha256 대조 뒤 로컬 경로) | 공개 LoRA 에서 이어 학습. 새 LoRA 를 만들지 않는다(ADR-034 7번) |
| LoRA 구조 | **r=16 유지**, alpha 32, dropout 0.05, target 7개, 392 텐서(10,092,544 파라미터)만 `requires_grad=True` | 공개 어댑터 구조 그대로(추가 지시 1) |
| 동결 | decision token 임베딩(입·출력 256행)·백본·토크나이저 | 초기 단계 동결(ADR-034 7번) |
| 손실 | `render_decision_prompt` → `decision_logits[:, :K]` CE(one-hot) / soft-CE(`gold.probabilities`) | 서빙과 같은 프롬프트·슬롯(계획 §4.2) |
| 제시 순서 | 에폭마다 `seed = --seed + epoch` 순열 | slot 편향 방지 |
| 패딩·dtype | 왼쪽 패딩, bf16, gradient checkpointing | `decision_logits` 요구·메모리 |
| smoke | `--max-steps 20`(F1) | 메모리·step 시간 |
| `--seed --out` | `0` `runs/bosun-sol-lora-v0.1` | 재실행은 `v0.2` 로 새 이름 |
| 데이터 | `bosun/train.en.jsonl`(≥ 1,000행), replay 없음 | 계획 §4.2·§9 |

에폭 수·학습률·유효 배치는 **이 문서가 정하지 않는다**. 학습기 기본값(`--lr 1e-4`·`--epochs 1`·`--batch 1`·`--accum 8`)으로 시작해 F1(§5.2)·dev 로 정하고, 쓴 값과 근거를 `MODEL_CARD.md` 에 적는다.

### 5.2 F1 격자 (토요일 오전)

22 §4.2 의 F1-A → B → D 를 그대로 따른다. F1-A(`infra/gpu/bosun-preflight.sh`)는 B2 에서 끝내 둔다. 토요일 오전은 F1-B 다. 칸마다 `SOL_GPU_SHARE_APPROVED=1 SOL_TRAIN_APPROVED=1 bash infra/gpu/bosun-f1.sh`(저장소 루트, 기본 `--max-steps 20`. 두 승인 env 가 없으면 시작하지 않는다)가 최대 GPU 메모리 두 값(torch `max_memory_allocated`·`nvidia-smi -i 1` 전체 최대 — PaddleOCR·서빙 포함. torch 값은 `training_metrics.json` 의 `metrics.peakMemoryMb` 이고, 지금 summary 칸은 키 이름이 달라 `-` 다. step 시간 칸도 로딩을 포함한 wall/step 이라 F2 소요 재추정에는 `metrics.meanStepSeconds` 를 본다, 미결정 26-15)과 우리 증가분·step 시간·OOM·패키지 저장·재로딩 parity 를 `runs/f1-results.md` 에 적는다. 앞 칸이 PASS 일 때만 다음 칸이고, OOM 이면 더 큰 값을 시도하지 않는다. Kev 의 state 토큰 상한(`--max_state`) 격자는 없다. 학습기는 state 를 자르지 않고 `--max-state-tokens`(기본 6,144)를 넘는 레코드를 건너뛴다.

| 순서 | 값 | 통과 기준 |
|---|---|---|
| 1 | batch 1 · accum 8(기본 후보. Kev 레시피에서 가져온 출발값) | OOM 없음, 20 step 완료, 우리 증가분 최대 ≤ 메모리 예산(22 §4.2 F1-D), 패키지 저장·재로딩 parity |
| 2 | batch 2 · accum 4(속도) | 같다 |
| 3(선택) | batch 4 · accum 2 | 같다. 들어가면 F2 에 쓴다 |

합격선은 `bosun-f1.sh` 의 메모리 예산이다: 학습 중 우리 증가분(GPU 전체 `memory.used` 최대 − 시작 직전 used) ≤ 시작 직전 `memory.free` − 3,000 MiB(`SOL_RESERVE_MIB`). 예산을 직접 정하려면 `SOL_MEM_BUDGET_MIB` 를 준다. 시작 전 여유는 `SOL_REQUIRED_MIB`(기본 16,000) 이상이어야 한다(22 §4.2. Kev 판의 41,000 MiB 는 전용 전제라 쓰지 않는다). 학습 전에 `python -m sol_decision.parity --package "$snap" --data "$SOL_WORK/sol-dataset-v0.1/bosun/test.en.jsonl" --n 8 --device cpu` 를 통과시킨다(preflight 와 같이 CPU, 승인 불필요. `--device` 기본값 `auto` 는 GPU 1 을 승인 검사 없이 쓰므로 빼지 않는다, 미결정 26-20. 넘으면 exit 1, 학습 금지). F1 의 20 step 패키지로 F3 보정·`bosun_score` 채점 경로도 dev 로 한 번 돌려 출력이 읽히는지 확인한다. 격자 1번부터 OOM 이면 22 §4.2 의 ①~③(state 축약·accum·서빙 잠시 내리기)을 먼저 검토하고, 그 밖(다중 GPU·클라우드 GPU·GPU 0·2)은 사용자 승인 대상이다. 모델 변경(다른 결정 모델로 전환) 경로는 이 문서에 없다.

### 5.3 F2 받아들이는 기준

- loss 가 발산하지 않는다.
- 패키지 `runs/bosun-sol-lora-v0.1/` 이 HF 레이아웃으로 저장되고 `BosunForDecision.from_pretrained(<dir>)` 재로딩 뒤 `predict` 가 돈다.
- `manifest.json` 의 sha256 과 파일이 일치한다. `sha256sum adapter/adapter_model.safetensors decision_embeddings.safetensors` 를 적어 둔다(임베딩은 공개본과 같아야 한다 — 동결).
- F1 PASS 값과 다른 하이퍼파라미터를 썼으면 근거를 `MODEL_CARD.md` 에 적는다.

## 6. E4 평가 (일요일)

22 §4.4 그대로다. 주말에 챙길 것만 적는다.

1. **보정은 dev 로만**(온도 → `calibration.json`). test 로 맞추지 않는다. 방법을 `MODEL_CARD.md` 에 적는다.
2. 회사 쪽 채점 4회: `sol_eval bosun_score` E4(학습본)·E1'(공개 Bosun `$snap`) × test·dev, `--seeds 0-5`. 출력 `predictions.jsonl`·`rows.json`·`report.json`.
3. 우리 쪽 오프라인 지표(21 §4.3): Macro-F1(`req.*` 3분류), 정보부족→미충족 혼동률, Brier, ECE(보정 전·후), 순서 민감도(`argmax_stable`·`spread`, seed 0~5), E1' 대비 Δ·95% CI. 지연은 재지 않는다(§2.2). E1' 도 같은 날 서버에서 같은 test 로 채점한 출력을 쓴다. 엔드포인트는 쓰지 않는다.
4. 받아들이는 기준(ADR-034 9번, 22 §4.4. ECE 는 21 §4.4 초기 목표): dev·test 모두 E1' 대비 회귀 없음, E1' 대비 개선은 Δ 95% CI 가 0 을 배제할 때만(아래 5번), 보정 뒤 ECE ≤ 0.08. 확신 오류율(p ≥ 0.9 오답)은 보고만 하는 보조 지표다([[16-DECISIONS|16]] 미결정 29-5). 기준을 어기면 결과는 보고하되 "서빙 후보 아님" 으로 적는다. 서빙 후보라도 교체는 사용자 승인 뒤다.
5. "E4 가 E1' 보다 낫다" 는 Δ 의 95% CI 가 0 을 포함하지 않을 때만 쓴다. 포함하면 "차이 없음". CI 는 사업 클러스터 단위 paired bootstrap 을 우선 낸다(같은 사업에서 파생된 회사 변형·질문은 독립 표본이 아니다, 21 §4.3). 클러스터가 적으면 개선을 확정하지 않고 탐색적 결과로 적는다. test 20(또는 축소판 25)은 표본이 작아 CI 가 넓다는 문장을 표 아래에 둔다(`experiment-tables.md` (c)).
6. 리포트 첫 줄에 적을 것: 데이터셋 버전·commit·갈래·질문 세트·템플릿·출발 리비전(`5e78a37c…`, 어댑터 sha256)·회사 GPU(NVIDIA A40 46,068 MiB, 물리 index 1, PaddleOCR 공유, 드라이버 580.173.02, torch 2.8.0+cu128)·학습 시간(실측)·batch/accum·에폭·seed 집합·dtype.
7. 데모 교체는 E4 결과와 별개로 **사용자 승인**이 필요하다(Q7). 이 문서는 교체를 정하지 않는다.

## 7. 위험과 대체 경로

| 위험 | 판단 시점 | 대체 |
|---|---|---|
| **Bosun 0.6B zero-shot 품질(E1')이 낮다**(DecisionBench `rubric_scoring` 가족 0.707) | B5 E1' 오프라인 채점(10-25) | 그대로 보고한다. τ 재조정은 dev 로만. 플래그 노이즈는 규칙이 최종이라 점수에 영향 없음. 모델 변경은 사용자 결정 |
| **질문당 지연**: 6k 토큰 × 20문항 순차 prefill 이 `KEV_TIMEOUT_MS` 5000 을 넘는다 | B2 G3 p95 | 질문 배치 forward(왼쪽 패딩)·ADR-033 E4 산식 개정(`settings.py`·`gateway.model.ts` 함께). state KV 공유는 후속 |
| **GPU 1 공유 간섭**: PaddleOCR 피크로 OOM·지연 | F1·B2 `nvidia-smi` | 종료·이동하지 않고 멈춘다. 회사에 시간대 확인(§8). 합계가 넘쳐도 우리 절차로 8009 를 내리지 않는다. 그다음은 사람이 정한다(§2.4) |
| **회사 Qwen3.8-Flash-Next API**: `/v1/models` id 불일치·guided JSON·`prompt_logprobs` 미지원·호출 한도·지연 | B2 | 레지스트리 `run` 값 조정은 사용자 결정. guided JSON 없으면 추출 PARTIAL 경로(02 장애 원칙), `prompt_logprobs` 없으면 E3 방법 재설계. 백업 Qwen 4B 로 돌아가는 것도 사용자 결정 |
| **trainer 재현**: 우리 `sol_decision.train` 이 서빙 분포와 다른 프롬프트·슬롯을 쓴다 | `services/decision/tests/test_train_pure.py`(배선)·`python -m sol_decision.parity`(학습 전, 모델 필요) | 확률 동일성(seed 고정)이 허용치를 넘으면(exit 1) 학습을 시작하지 않는다 |
| 회사 GPU 서버에 외부망이 없다 | 10-22 P4 | 22 §2.2 2안. 우리가 10-23 외부망 기계에서 받아 넘긴다(Bosun·백본·`services/decision` 소스·wheel). 서버는 `HF_HUB_OFFLINE=1` |
| `.venv-bosun` 핀 설치가 torch 를 바꾼다 | B2 `--dry-run` | 설치하지 않고 보고. 별도 venv 는 사용자 결정 |
| 10-22 까지 회사 Qwen API·`/parse` 가 없다 | 10-22 저녁 | **갈래 ①** 로 번들 확정. 갈래 ② 는 하지 않는다 |
| 10-22 까지 test 20 사람 라벨이 없다 | 10-22 | 축소판 test(fixture 20 + 실공고 5)로 E4. 리포트에 명시 |
| 토요일 18:00 까지 F2 미시작 | 10-24 18:00 | 사용자 보고(ADR-034 12번). 대체 모델 경로는 없다. 미실행이면 "회사 측 미실행" 문장(`limitations.md`) |
| 회사가 `report.json` 만 보내고 `rows.json`·`predictions.jsonl` 을 못 보낸다 | 10-25 | E4 Δ·CI 는 `report.json` 의 요약으로 적고, 행 단위 지표(정보부족→미충족 혼동률·사유별)는 "미측정" 으로 남긴다 |
| 돌려받은 출력을 우리가 다시 재현해야 한다(출력 누락·의심) | 10-25 | 0.6B 라 노트북(Apple M3 Pro, 18 GB)에서 `bosun_score` 재실행을 **시도할 수 있다**(mps 지원·속도 미확인, §10). 결과가 다르면 서버 출력을 쓰지 않는다 |
| 결과가 E1' 보다 나쁘다 | 10-25 | 그대로 보고한다. 데모 모델은 어차피 공개 Bosun 이다. 오류 분석(21 §4.4 원인 코드)을 한 줄 붙인다 |

## 8. 회사에 보낼 것·물을 것 (10-22 목요일까지)

보낼 것:

1. `sol-dataset-v0.1/` 폴더 + 파일별 sha256(§4.5). 실제 공고(공공 데이터, 개인정보 마스킹)와 가상 기업만 들어 있다.
2. B1 산출물(main `1b68f9b`: `services/decision`·`sol_eval`·`infra/gpu/bosun-preflight.sh`·`bosun-f1.sh`·핀 목록)과 22 §2~§4, 이 문서 §3~§6.
3. 일요일 채점 명령 4줄(§2.2)과 돌려줄 출력 폴더 목록. **회사 nginx·라우터 변경은 없다.**
4. 실행 순서·시간표(§1)와 받아들이는 기준(§5.3·§6 4번).

물을 것(P2~P5, 16 미결정 22·24):

1. **PaddleOCR 피크 메모리와 시간대**(GPU 1 `nvidia-smi` 추이). 우리 Bosun 서빙·학습이 공존해도 되는 시간대와 메모리 상한. 토·일 학습 시간대.
2. huggingface.co·pypi.org 로 나갈 수 있는지(없으면 반입 2안).
3. `.venv-bosun` 의 현재 핀 목록(`pip list --format=freeze`)·Python·torch 버전. `uv` 설치 여부.
4. 일요일에 서버 안에서 `bosun_score` 4회를 돌리고 출력 폴더를 보내 줄 수 있는지(P5). SOL RADAR location 은 `/sol-radar/` 하나뿐이라 그 밖의 nginx 변경은 묻지 않는다.
5. 회사 Qwen3.8-Flash-Next API: `QWEN_API_KEY` 전달 방법, `GET /v1/models` 의 `id`, 추가 인증·호출 한도, guided JSON·`prompt_logprobs` 지원 여부(주소 정본은 03·10).
6. 돌려줄 것(22 §4.5): 학습본 패키지·로그·`bosun_score` 출력 4벌·`calibration.json`·`MODEL_CARD.md`·sha256·`venv-bosun-freeze.txt`. 데이터셋 원문은 돌려받지 않고, 회사는 학습 뒤 번들을 지운다.

## 9. 정본 반영 상태

2026-10-19 저녁의 ADR-027 개정 반영(16·22·10·21·12, 브랜치 `docs/adr027-weekend`)은 이력이다 — ADR-027 은 2026-10-20 ADR-034 로 폐기됐다. 아래는 ADR-034 기준이다.

| 정본 | 반영한 것 | 상태 |
|---|---|---|
| [[16-DECISIONS\|16 ADR]] ADR-034 행·상세(1~14번), ADR-027 폐기 콜아웃, ADR-004·012·020·023·025·033 개정 각주, 미결정 2(종결)·3·17·22·24 | 결정 모델 Bosun, Qwen3.5-27B 회사 API 재사용(저녁 개정), `sol_decision` 런타임, GPU 1 공유, 일정 | **반영(2026-10-20, B0)** |
| [[22-FINETUNE-RUNBOOK\|22 실행서]] 전면 | 출처 2개·sha256, `.venv-bosun`, Bosun 학습·채점 명령(B1 미구현 표기), Qwen 학습 없음, 요청서·미확인 | **반영(2026-10-20, B0, 이 개정)** |
| [[23-WEEKEND-FINETUNE\|23]](이 문서) | 일정·엔드포인트(변경 없음·B/C안 삭제)·GPU 공유·모델 3개·레코드 단위·레시피·E1' | **반영(2026-10-20, B0)** |
| `services/decision`·`sol_eval` 의 `bosun_score`·`export --format bosun`·`leakage`·`infra/gpu/bosun-preflight.sh`·`bosun-f1.sh`·레지스트리·settings·UI 문구 | — | **반영(main `1b68f9b`, 2026-10-21)**. 계획 §9 |
| [[03-AI-PIPELINE\|03]] §2·§3.2·§4.3·§5·§11, [[10-DEPLOYMENT\|10]] 엔드포인트·`QWEN_BASE_URL`·GPU 공유, [[21-MODEL-TRAINING\|21]] §4.2 E1'·§5·§6·§7, [[05-API-SPEC\|05]]·[[08-SCORING\|08]]·[[15-DATA-CONTRACTS\|15]]·[[12-ROADMAP\|12]]·[[18-HACKATHON\|18]]·[[19-DEMO-SCENARIO\|19]]·[[20-GLOSSARY\|20]] | 모델명·런타임·S-LIVE 칩·용어 | **반영(2026-10-20, B0 `1c063e5`, main `9048995`)**. B1 코드 값에 맞추는 나머지(레지스트리 값·UI 중립 문구·`sol_decision`·`services/decision` 구현 표기)는 B1 병합(main `1b68f9b`) 뒤 6-2 동기화(2026-10-21, 문서별 담당)에서 반영 중 |
| `docs/submission/` | `experiment-tables.md` (c)·`limitations.md` E4 문장·`slides-outline.md`·`evidence-list.md` | 후속(B6, 10-26) |
| `docs/evidence/bosun-train-feasibility.md`·`docs/evidence/eval/e4-<일시>.md`·`docs/evidence/phase-5/endpoint-bosun-<일시>.md` | F1·F2·E4·B2 증거 | 후속(B2·B4·B5). Kev 기록은 보존 |

## 10. 미확인

| 항목 | 상태 | 확인 방법·시점 |
|---|---|---|
| 회사 GPU 모델·VRAM·장수 | **확인(2026-10-20 오전)**: A40 46,068 MiB ×3, SOL RADAR 는 물리 GPU 1 | [F1 기록](evidence/kev-train-feasibility.md) §0(당시 기록) |
| GPU 1 공유 상태(PaddleOCR 약 9,167 MiB)·피크·`.venv-bosun`·Bosun CPU 2-step 성공 | 사용자 보고, 미검증 | B2 `nvidia-smi`·`pip list`(P4) |
| 외부망·학습 시간대·출력 전송 | 미확인 | P4·P5(10-22) |
| `sol_decision.serve` 기동·`/v1/models` 응답·인증·지연 p50/p95(G1~G6) | 미실행(기동은 사용자 승인 뒤) | B2 → C1 ③ |
| 회사 Qwen3.8-Flash-Next API: `/v1/models` id·추가 인증·호출 한도·지연·guided JSON(G4)·`prompt_logprobs`(E3)·Qwen3.8-Flash-Next 추출·번역 품질 | 미검증(사용자 보고) | B2 확인, B3 EX0 |
| `.venv-bosun` 핀과 torch 2.8.0+cu128 유지, `uv` 여부 | 미확인 | 22 §3.2 `--dry-run`(B2) |
| Bosun·백본 다운로드·sha256·로딩, 리비전 `5e78a37c` vs `87cea31` `manifest.json` 동일성 | 미실행 | 22 §2.2 → `bosun-preflight.sh`(B2) |
| Bosun 0.6B 우리 도메인 zero-shot 품질(E1'), 한국어·장문 state(E2) | 미측정 | B5 오프라인 E1'·E2(16 미결정 29-1) |
| Bosun LoRA 학습 실제 메모리(추정 6~10 GB)·step 시간·학습 시간, 서빙 1.5~3 GB | 추정 | F1(§5.2)·B2 |
| 우리 trainer 의 `render_decision_prompt`·slot 손실 재현(서빙 분포 동일성) | 미검증 | `test_train_pure.py`(배선, B1)·`python -m sol_decision.parity`(모델 필요, 미실행) |
| 유효 배치·에폭·학습률의 Bosun 전용 값 | 미정(이 문서는 정하지 않음) | 학습기 기본값 lr 1e-4·에폭 1·batch 1·accum 8(출발값) → F1 → dev |
| 회귀·망각 확인용 공개 데이터(DecisionBench 등)를 둘지 | **결정(2026-10-20)**: 기본 회귀 검사는 내부 dev 세트. dev 만으로 일반 Decision 능력 망각을 평가했다고 주장하지 않는다. DecisionBench 공개 분할은 라이선스·중복·재배포 조건 확인 뒤 보조 평가로만(설계만, ADR-034 9번) | 조건 확인은 미결정 24번 |
| 노트북(Apple M3 Pro, 18 GB)에서 `bosun_score` 재실행(mps)·속도 | 미확인 | §7 대체 경로를 쓸 때만 |
| 60일 목록의 실제 건수와 정보화사업 비율 | 7일 표본 추정(3,555건, 약 6%) | 10-20 수집 |
| 면허제한 여러 행의 AND/OR | 미확인(미결정 19) | 주말 학습에서는 `NEEDS_REVIEW` 로 라벨 |
| 첨부 원문의 학습 사용 권리 | 미확인(미결정 18) | 법무. 주말에는 갈래 ② 라도 원문 전체를 번들에 넣지 않는다 |
| 회사 2-step 학습 코드(저장소 밖) | 미반입. B1 학습기 `services/decision/src/sol_decision/train.py` 가 대체했다(`services/decision/docs/TRAINING.md`. 계획 §10 10번의 "반입 뒤 흡수"에서 바뀜) | B2 에서 결과 비교 |

## 관련 문서

- [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]] — 모델 출처·환경·명령·반입(정본)
- [[21-MODEL-TRAINING|21 모델 학습]] — 데이터셋·라벨·분할·지표·착수 판단
- [[16-DECISIONS|16 ADR]] — ADR-034(Bosun 전환·Qwen3.8-Flash-Next 회사 API·GPU 공유·일정)·ADR-010(유료 승인)·ADR-022(서비스키)·ADR-025(엔드포인트)·ADR-027(폐기, 이력)·미결정 16·18·19·22·24
- [분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) — Qwen3.5-27B 개정 §0.2, 외부 사실 §1, 학습 계약 §4, 서버·env §5, GPU 공유 §8, 일정 §9, 위험 §10
- [[12-ROADMAP|12 로드맵]] — 일정, freeze 10-23
- [[10-DEPLOYMENT|10 배포]] — 모델 라우터·`sol_decision` 기동·`QWEN_BASE_URL`
- [[03-AI-PIPELINE|03 AI 파이프라인]] — `kev-qs/v0.2`·state 템플릿·레지스트리 검증·회사 Qwen API
- [[07-DATA-PIPELINE|07 수집]] — 나라장터 API 필드·보조 조회·마스킹
- [[09-SECURITY|09 보안]] — 데이터 경계·개인정보 마스킹
- [[18-HACKATHON|18 해커톤]] — §7 정직성 표(파인튜닝 행), §8 13번 답
- [[PROGRESS|진행 상황]]
