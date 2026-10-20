---
title: "23. 주말 파인튜닝 계획: 회사 GPU 엔드포인트·오픈 데이터·Hugging Face 모델"
doc: "23"
status: draft
tags:
  - sol-radar
  - ai
  - ops
  - hackathon
updated: 2026-10-20
---

# 23. 주말 파인튜닝 계획: 회사 GPU 엔드포인트·오픈 데이터·Hugging Face 모델

> [!tip] 이 문서의 역할
> 회사 GPU 서버에서 **2026-10-24(토)~10-25(일)** 한 번에 돌릴 Kev-9B LoRA 파인튜닝(ADR-027 X6c~X6e)에 대해 ① 엔드포인트, ② 학습 데이터를 **오픈 데이터**에서 어떻게 가져오는지, ③ Hugging Face 에서 어떤 모델을 받는지를 확정하고, 금요일까지 준비할 것과 주말 시간표를 정한다. [[21-MODEL-TRAINING|21 모델 학습]]은 "무엇을 왜", [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]는 "어떤 명령으로"가 정본이다. 이 문서는 그 둘을 주말 한 번의 실행에 맞게 고른 **선택과 일정**이다. 21·22와 다르면 주말 실행에 한해 이 문서를 따르고, 끝나면 §9의 제안대로 정본에 되돌린다.

> [!success] 승인됨 (2026-10-19, 사용자)
> ① E4 평가는 §2.2 A안(서버 안 오프라인 `kev.benchmark` 채점, 엔드포인트·라우터 변경 없음), ② 주말 일정(§1), ③ 정본 반영은 `docs/sync-2`(ADR-031) 병합 뒤 같은 날 ADR-027 개정으로 16·22·10·21·12 에 반영했다(§9, 브랜치 `docs/adr027-weekend`).

> [!warning] 범위
> - 학습 대상은 **Kev-9B@v1.0 → LoRA 이어 학습**(`en` state)뿐이다. Qwen 파인튜닝은 하지 않는다(ADR-027 U1).
> - 데모·S-LIVE 모델과 레지스트리 서빙 항목 `kev-9b-v1.0`은 바꾸지 않는다. 학습본은 E4 비교에만 쓴다(ADR-027 2번).
> - 유료 hosted API·클라우드 GPU 임대·유료 LLM 라벨 생성은 쓰지 않는다(ADR-010). 돈이 드는 경로는 이 문서에 없다.
> - 회사 GPU 사양은 2026-10-20 서버에서 확인했다: NVIDIA A40 46,068 MiB **3장** 중 **물리 index 1 한 장**만 학습·채점에 쓴다(§2.4, [[22-FINETUNE-RUNBOOK|22]] §3.1). 외부망·학습 시간대·GPU 1 독점 가능 여부·추론 런타임 위치는 미확인이다(16 미결정 22). 메모리·시간 수치는 A40 실측(F1) 전 추정이다.

## 0. 한눈에

| 항목 | 결정 |
|---|---|
| 언제 | 2026-10-24(토) F1 메모리 검증 → F2 학습, 10-25(일) F3 보정 → E4 평가. 10-26(월) 제출물 반영(X6f). [[12-ROADMAP\|12 로드맵]] 간트의 X6c(10-21~22)·X6d(10-22~23)·X6e(10-25)를 주말로 모은다(§9 제안) |
| 어디서 | 회사 GPU 서버 `sol-NF5280M6`(외부 접근 불가. 셸은 계정 `bim`), **물리 GPU 1(A40 46,068 MiB) 한 장**. GPU 0·2 는 회사 서비스라 건드리지 않는다(§2.4). 실행은 회사 측, 우리는 번들·요청서·평가([[16-DECISIONS\|ADR-025]]) |
| 모델 | 출발점 `jaredpalmer/kev-9b@v1.0`(백본 `Qwen/Qwen3.5-9B-Base@68c46c4b`). F1 이 전부 실패하면 `jaredpalmer/kev-4b@v1.0` 은 **사용자 승인 뒤**(§3.3). 추론용 `Qwen/Qwen3.5-9B@c2022362`는 그대로(§3) |
| 데이터 | 오픈 데이터 3층. **A** 나라장터 Open API 실공고(서비스키 보유, 이용허락 제한 없음) × 가상 기업 원형의 구성 라벨, **B** Kev 공개 replay `jaredpalmer/kev-suites` `decision-v7`, **C** 우리가 만든 가상 기업 원형 6개(§4) |
| 엔드포인트 | 회사 nginx 등록은 `https://acropolissg.com/sol-radar` **하나**뿐이고 주말에도 더 요청하지 않는다. 그 뒤의 우리 라우터가 `/qwen`·`/kev` 로 나눈다(ADR-025). 학습본은 HTTPS 로 서빙하지 않고 **서버 안 오프라인 채점**(§2.2 A안)으로 평가한다 |
| 결과 | `docs/evidence/kev-train-feasibility.md`(F1), `docs/evidence/eval/e4-<일시>.md`(E4 Δ·95% CI), `docs/submission/experiment-tables.md` 표 (c) |
| 중단선 | 토요일 18:00 KST 까지 F2 가 시작되지 않으면 사용자에게 보고한다. 승인하면 Kev-4B 경로(§7), 아니면 "회사 측 미실행"으로 적는다(ADR-027 2번) |

## 1. 시간표

날짜는 KST. 회사 측 작업은 **회사**, 우리 쪽은 **우리**로 표시한다.

| 날짜 | 누가 | 할 일 | 산출물 |
|---|---|---|---|
| 10-20(화) | 우리 | §4.3 수집 1일차(목록 60일 + 보조 조회 150건). 가상 기업 원형 6개 JSON 작성(§4.2 C). state 빌더·`sol_eval.export` 뼈대(X6b) | `fixtures/recorded/train/`(마스킹 JSON) 또는 Supabase live 공고, `fixtures/eval/companies/*.json` |
| 10-20(화) | 회사 | **서버 환경 확인 완료**: 전용 경로·venv `.venv-kev`(Python 3.12.3)·torch 2.8.0+cu128·CUDA·bf16·GPU 1 전용 변수(`CUDA_VISIBLE_DEVICES=1`). 미완: Kev 설치·모델 다운로드·F1(22 §3.2·§4.2) | [F1 기록](evidence/kev-train-feasibility.md) §0 |
| 10-21(수) | 우리 | 수집 2일차(보조 조회 150건). 갈래 ①(§4.4) 레코드 생성·충돌·누수 검사. 회사 답(§8) 받기 | train JSONL 초안, 검사 로그 |
| 10-21(수) | 회사 | Kev 설치(22 §3.2: `uv pip install --dry-run` 으로 계획 확인 뒤 설치, torch·triton 불변) → `infra/gpu/kev-preflight.sh` 1차(모델 전이라 체크포인트·백본 항목이 FAIL 로 끝나는 것이 정상. 환경·GPU 매핑·커널 smoke 항목만 본다. 통과 표식은 10-23 전부 통과 때 생긴다) | `runs/preflight-*.log` |
| 10-22(목) | 우리 | **번들 확정** `sol-dataset-v0.1.tar` + sha256. 갈래 ②(Qwen 추출) 가능 여부는 이날 저녁 C1 ③·파서 상태로 정한다. 학습 요청서 전송(§8) | 번들, manifest, 요청서 |
| 10-23(금) | 회사 | 모델·코드·replay 내려받기(§3.4) 또는 반입(외부망 미확인), 번들 반입·sha256 대조, `kev-preflight.sh` 전부 통과(모델 sha256·`--max_state` 별 데이터 길이 표 포함), `nvidia-smi` 기록 | 준비 완료 통보, `runs/preflight-ok` |
| 10-23(금) | 우리 | 기능 freeze. `sol_eval` 이 `kev.benchmark` 출력 폴더(`rows.json`·`predictions.jsonl`·`report.json`)를 읽어 E4 지표를 내는 경로를 가짜 출력으로 시험(§2.2 A안·§6). 실제 스키마는 토요일 F1 출력으로 확정 | E4 하네스(오프라인) |
| 10-24(토) 09:00~12:00 | 회사 | **F1-B·C**(§5.2): `infra/gpu/kev-f1.sh --max_state 1024` → `2048`(→ `4096` → `6144`, 데이터 길이 표에 따라). 물리 GPU 1 만. 앞 칸 PASS 때만 다음 칸. 결과 표 전송 | `runs/f1-results.md`, `runs/f1-*.summary.md` |
| 10-24(토) 13:00~ | 회사 | **F2** 학습(§5.3), F1 PASS 설정으로. 소요 시간은 F1 의 step 시간으로 재추정한다(A40 실측 전 **미확정**. H200 2.6시간은 쓰지 않는다). 토요일 안에 끝나지 않으면 일요일 오전으로 넘기고 F3·채점을 뒤로 민다. 로그의 `dropped`·`replay` 줄 확인 | `runs/kev-9b-sol-lora-v0.1`, `train.log`, `training_metrics.json` |
| 10-25(일) 09:00~ | 회사 | **F3** dev 보정(22 §4.4) → 서버 안 채점 4회(`kev.benchmark` E4·E1 × test·development, `--rotations 6`, GPU 1 에서 한 모델씩 순차) → `kev.compare --out` → 출력 폴더 4개를 통째로 전송(§2.2 A안). 엔드포인트·라우터 변경 없음 | `MODEL_CARD.md`, `report.json`·`rows.json`·`predictions.jsonl` 4벌, `kev.compare` 결과, sha256 |
| 10-25(일) 오후 | 우리 | 받은 출력의 체크포인트 id·test 파일 sha256 을 번들 manifest 와 대조 → `sol_eval` 오프라인 채점(E4·E1 같은 출력 형식) → 짝 부트스트랩 Δ·95% CI | `docs/evidence/eval/e4-<일시>.md` |
| 10-26(월) | 우리 | X6f: `experiment-tables.md` (c)·`limitations.md` E4 문장·슬라이드 9장 | 제출물 |

10-24 최종 리허설(C9)과 겹친다. 학습은 물리 GPU 1 만 쓰므로 추론 런타임이 GPU 0·2 에 있으면 겹치지 않는다. 추론 런타임이 GPU 1 에 뜨는 경우에만 리허설의 `live`·`fixture` 확인을 **토요일 오전(F1 전) 또는 일요일 저녁**에 한다(§2.4). 어느 GPU 에 뜨는지는 미확인이다(§8).

## 2. 엔드포인트

### 2.1 등록은 하나뿐이다

회사 nginx 에 등록할 수 있는 것은 `https://acropolissg.com/sol-radar` **location 하나**다([[16-DECISIONS|ADR-025]]). 이 문서는 그 제약 안에서만 움직인다.

- 회사 nginx 에 **주말에도 아무것도 더 요청하지 않는다.** 새 도메인·새 location·설정 변경 없음.
- 경로 분기(`/qwen` → vLLM `127.0.0.1:8001`, `/kev` → `kev.serve` `127.0.0.1:8009`)는 등록된 location 뒤에 있는 우리 모델 라우터(`infra/gpu/model-router.conf`, GPU 서버 안 `127.0.0.1:8080`)가 한다. 밖에서 `…/sol-radar/qwen`·`…/sol-radar/kev` 두 주소가 보이는 것은 회사 nginx 가 둘을 따로 아는 게 아니라 `/sol-radar/` 아래를 통째로 8080 에 넘기기 때문이다.
- 학습본(LoRA run)은 **HTTPS 로 서빙하지 않는다.** E4 평가는 서버 안 오프라인 채점으로 한다(§2.2 A안). 그래서 라우터도 바꾸지 않고 8010 인스턴스도 띄우지 않는다. ADR-027 10번(평가 전용 `kev.serve` 8010 + `/kev-lora`)은 같은 날 저녁 이 방식으로 개정됐다([[16-DECISIONS|16]]).

| 밖에서 보이는 주소 | 회사 nginx | 우리 라우터(8080) | 런타임 | 주말 변경 |
|---|---|---|---|---|
| `https://acropolissg.com/sol-radar/healthz` | location 하나로 통과 | `200 ok` | — | 없음 |
| `https://acropolissg.com/sol-radar/qwen/v1/*` | 같은 location | → `127.0.0.1:8001` | vLLM `Qwen/Qwen3.5-9B` | 없음 |
| `https://acropolissg.com/sol-radar/kev/v1/*` | 같은 location | → `127.0.0.1:8009` | `kev.serve` `jaredpalmer/kev-9b@v1.0` | 없음 |
| (주소 없음) | — | — | 학습본 `runs/kev-9b-sol-lora-v0.1` | 서빙하지 않는다. 오프라인 채점(§2.2) |

### 2.2 학습본을 엔드포인트 없이 평가하는 법

**A안(기본): 서버 안 오프라인 채점.** 회사가 같은 test 파일로 학습본과 v1.0 을 각각 `kev.benchmark` 로 채점하고 출력 폴더를 그대로 돌려준다. 우리 `sol_eval` 은 그 출력(`rows.json`·`predictions.jsonl`·`report.json`)을 읽어 21 §4.3 지표를 낸다. 네트워크·라우터·추가 GPU 메모리가 필요 없다.

```bash
# 회사, 일요일(22 §4.4 와 같은 명령. 물리 GPU 1 만, 모델은 한 번에 하나씩. 출력 폴더 4개를 통째로 돌려준다)
export SOL_WORK=/data/www/ai_workspace/sol-radar
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1
cd "$SOL_WORK"
# 기준선 E1 은 태그가 아니라 sha256 을 대조한 로컬 snapshot(태그 v1.0 = 커밋 3afdec81…)으로 올린다(22 §4.2 콜아웃)
KEV9B="$HF_HOME/hub/models--jaredpalmer--kev-9b/snapshots/3afdec81efc91da83dee06d30714adf54ee35531"
sha256sum "$KEV9B/adapter_model.safetensors" "$KEV9B/head.pt"      # 22 §2.2 값과 같아야 한다
export HF_HUB_OFFLINE=1
python -m kev.benchmark --run runs/kev-9b-sol-lora-v0.1 --data sol-dataset-v0.1/kev/test.en.jsonl --out runs/e4-test --rotations 6
python -m kev.benchmark --run "$KEV9B"                  --data sol-dataset-v0.1/kev/test.en.jsonl --out runs/e1-test --rotations 6
python -m kev.compare --candidate runs/e4-test --reference runs/e1-test --out runs/e4-vs-e1      # --out 은 필수 인자
python -m kev.benchmark --run runs/kev-9b-sol-lora-v0.1 --suite "$SOL_WORK/kev/evals/v7/decision-v7" --out runs/e4-regression
python -m kev.benchmark --run "$KEV9B"                  --suite "$SOL_WORK/kev/evals/v7/decision-v7" --out runs/e1-regression
```

- 선택지 순서 민감도는 서빙 `/v1/systemone/permute` 대신 `kev.benchmark --rotations` 로 잰다(저장소 `kev/benchmark.py` 옵션, [[21-MODEL-TRAINING|21]] §4.1 콜아웃). `permute n_perm=6` 과 뜻이 같은지는 F1 20 step 출력으로 확인한다(§10).
- 요청당 지연 p50·p95 는 서빙이 없으므로 **E4 에서는 재지 않는다.** 같은 백본·같은 LoRA rank 라 E1 과 다르지 않다고 가정하고 그 가정을 리포트에 적는다. E1 지연은 C1 ③ G3 값이다.
- 우리가 체크포인트를 직접 띄우지 않으므로 `kev.serve` 의 `runs/smoke` 대체 위험이 없다. 대신 돌려받은 `report.json` 의 체크포인트 id 와 test 파일 sha256 이 번들 manifest 와 같은지 대조한다. 다르면 그 결과는 쓰지 않는다.

**B안(회사가 우리 라우터 컨테이너를 운영하고 재기동해 줄 때만): 라우터 하위 경로.** 회사 nginx 는 그대로 두고 **우리** `infra/gpu/model-router.conf` 에 아래 블록을 더해 라우터 컨테이너만 다시 띄운다(`docker compose -f infra/compose.gpu.yaml up -d --force-recreate model-router`). 그러면 `https://acropolissg.com/sol-radar/kev-lora/v1/*` 가 `127.0.0.1:8010` 의 평가 전용 `kev.serve` 로 간다. 회사 nginx 등록은 늘지 않는다. GPU 메모리가 9B 하나(약 21.9 GB)만큼 더 들고 회사가 컨테이너 재기동을 해 줘야 한다. A안으로 충분하므로 **지연·`permute` 실측이 꼭 필요할 때만** 쓴다.

```nginx
  # B안. E4 평가 전용(10-25~26). 회사 nginx 는 손대지 않는다. 인증은 kev.serve 가 한다
  location ~ ^/(?:sol-radar/)?kev-lora/(.*)$ {
    proxy_pass http://127.0.0.1:8010/$1$is_args$args;
  }
```

**C안(마지막 수단, 사용자 재승인 필요): `/kev` 를 시간 한정으로 학습본으로 교체.** 일요일 14:00~16:00 에만 8009 의 `kev.serve --run` 을 학습본으로 바꿨다가 되돌린다. 데모 앱은 `mock` 이라 영향이 없지만 그 시간에는 `live`·`fixture` 리허설과 레지스트리 대조(`kev-9b-v1.0`)가 깨진다. [ADR-027 변경안](plans/2026-10-19-finetune-schedule-pull.md) §4.2 D1 ②로 한 번 기각된 안이라 다시 묻는다.

### 2.3 주말 확인 순서 (A안)

바뀌는 것이 없으므로 평소 확인과 같다. 서버 안(회사, 키 값은 셸 변수로만):

```bash
curl -s http://127.0.0.1:8080/healthz                                                        # ok
curl -s -H "Authorization: Bearer $KEV_API_KEY" http://127.0.0.1:8080/sol-radar/kev/v1/models   # run: jaredpalmer/kev-9b@v1.0 (데모 경로 불변)
ls runs/e4-test runs/e1-test runs/e4-regression runs/e1-regression                         # report.json rows.json predictions.jsonl
sha256sum sol-dataset-v0.1/kev/test.en.jsonl                                               # manifest 값과 같아야 한다
```

밖(우리, 노트북): 데모 경로만 본다.

```bash
curl -sS -o /dev/null -w 'http=%{http_code}\n' https://acropolissg.com/sol-radar/healthz        # 200, -k 금지
curl -sS -o /dev/null -w 'http=%{http_code}\n' https://acropolissg.com/sol-radar/kev/v1/models  # 인증 없이 401 또는 403
```

### 2.4 학습과 추론의 GPU 동시 점유

2026-10-20 확인(16 미결정 22 일부 종결): A40 46,068 MiB 가 **3장**이고, 학습·채점에 쓸 수 있는 것은 **물리 GPU 1 한 장**(가용 44.16 GiB)이다. GPU 0(4,747 MiB 사용 중)·2(9,240 MiB 사용 중)는 회사 기존 서비스가 쓰고 있어 어떤 경우에도 쓰지 않고, 그 프로세스를 종료·이동하지 않는다(22 §3.1). 3장의 VRAM 을 합치지 않고 다중 GPU 학습도 하지 않는다. 모든 학습·채점 명령은 `CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1` 아래에서 돌리고 프로세스 안에서는 `cuda:0` 으로 보인다. 수치는 모델 카드·22 §3.1 기준이고 학습 메모리는 추정이다.

| 상주·작업 | 메모리 |
|---|---|
| vLLM Qwen3.5-9B 서빙 | 가중치 약 19.3 GB + KV 캐시(`--gpu-memory-utilization`) |
| `kev.serve` Kev-9B v1.0 | 약 21.9 GB(모델 카드) |
| Kev-9B LoRA 학습(bf16 백본, `--checkpointing 1`, `--batch 1 --accum 8`, `--max_state` 1024~6144) | **추정** 30~45 GB. 공식 설정(fp32 백본, `max_state 7552`)은 74.1 GB. F1 에서 실측 |
| `kev.benchmark` 채점(체크포인트 하나씩) | fp32 기본 경로는 가중치 약 38.6 GB + 작업 메모리(44 GiB 에 들어가는지 미검증, 22 §4.4). bf16 이면 약 21.9 GB. 4회를 순서대로 돌리면 동시 점유는 1회분 |

GPU 1 한 장에는 두 추론 런타임(합쳐 약 41 GB)과 학습을 같이 둘 수 없다. 추론 런타임이 어느 GPU 에 뜰지는 미확인이다(2026-10-20 사용량으로는 아직 떠 있지 않다, §8).

| 경우 | 토요일(F1·F2) | 일요일(F3·채점 4회) |
|---|---|---|
| 추론 런타임이 GPU 0·2 에 있다(회사 결정, 미확인) | GPU 1 에서 학습만. 데모 `live`·`fixture` 는 영향 없음 | GPU 1 에서 채점을 순서대로. 영향 없음 |
| 추론 런타임이 GPU 1 에 있다 | 학습 전에 회사가 vLLM·`kev.serve` 를 내린다(우리가 끄지 않는다). 리허설의 `live`·`fixture` 확인은 F1 전 오전 또는 일요일 저녁 | 서빙을 내리고 채점 4회를 순서대로. 끝나면 v1.0 서빙 복구 |
| 추론 런타임이 아직 없다(2026-10-20 상태) | 학습만 | 채점만 |

2026-10-19 에 적어 두었던 "1장 80 GB 이상"·"1장 24 GB"·"2장 이상" 경우는 해당 없음으로 닫는다(A40 46 GB 1장, 다중 GPU 학습 없음). 학습이 GPU 1 을 쓰는 동안 데모 앱은 `mock` 모드로 두면 영향이 없다(발표 본편 모드). 발표 전 리허설·S-LIVE 사전 run(C8)은 추론 런타임이 GPU 1 에 있을 때만 학습 시간과 겹치지 않게 잡는다.

### 2.5 선행 조건

| # | 조건 | 받을 곳 | 기한 |
|---|---|---|---|
| P2 | 엔드포인트 경로·인증 방식(Bearer 외 추가 인증 여부). 등록된 location 은 `/sol-radar/` 하나로 확정 | 회사 | 10-21 |
| P3 | vLLM·`kev.serve` 기동 완료 통보 | 회사 | 10-21 |
| P4 | GPU 모델·장수·VRAM 은 **2026-10-20 확인**(A40 ×3, 학습은 물리 GPU 1). 남은 것: 토·일 GPU 1 독점 가능 여부·학습 시간대, 추론 런타임을 띄울 GPU, 외부망(huggingface.co·github.com·pypi.org) 가능 여부 | 회사(미결정 22) | **10-22** |
| P5 | 일요일에 서버 안에서 채점 4회를 돌리고 출력 폴더(`report.json`·`rows.json`·`predictions.jsonl`, 수십 MB)를 보내 줄 수 있는지. 회사 nginx·라우터 변경은 요청하지 않는다 | 회사 | 10-22 |

외부망 답이 10-22 까지 없으면 §3.4 의 **반입 2안**(우리가 다른 기계에서 받아 넘김)을 기본으로 준비한다. Kev-4B 는 F1 결과와 사용자 승인 뒤에만이다(§3.3).

## 3. 모델 (Hugging Face)

### 3.1 받을 것

| 역할 | Hugging Face id | 고정 리비전 | 라이선스 | 크기·메모리 | 쓰임 |
|---|---|---|---|---|---|
| **출발 체크포인트** | `jaredpalmer/kev-9b` | 태그 `v1.0`(커밋 `3afdec81efc91da83dee06d30714adf54ee35531`). `main` 은 `db029f08…`, 파일 oid 는 같다(22 §2.1) | Apache-2.0(어댑터·head) | LoRA rank 16 + pointer head. 추론 약 21.9 GB. 영어 전용 | `--init_from jaredpalmer/kev-9b@v1.0` |
| 백본(동결) | `Qwen/Qwen3.5-9B-Base` | `68c46c4b3498877f3ef123c856ecfde50c39f404`(Kev-9B `training_config.json` `base_revision`) | Apache-2.0 | 9.65B, bf16 약 19.3 GB. 32층(Gated DeltaNet 24 + attention 8), 컨텍스트 262k | `--base --base_revision` |
| 공개 replay | `jaredpalmer/kev-suites`(dataset) `v7/decision-v7/*` | `cc4bac803e73112689ec327ffa481c519cbc7a05` | manifest 에 라이선스 없음. 출처 10개 데이터셋 각각의 조건을 따른다 → 회사 내부 학습에만 | train 12,576 레코드, 전체 약 295 MB | `--suite "$SOL_WORK/kev/evals/v7/decision-v7" --replay 2000` |
| 추론(데모, 바꾸지 않음) | `Qwen/Qwen3.5-9B` | `c202236235762e1c871ad0ccb60c8ee5ba337b9a` | Apache-2.0 | 9.65B, bf16 약 19.3 GB. thinking 기본 → gateway 는 비사고 모드로 부른다(C1 ③ G4) | vLLM `/qwen`, 갈래 ② train 추출 |
| **대안** | `jaredpalmer/kev-4b` | 태그 `v1.0`(커밋 `591dcb5bd6d05eb0b5131ea6608f93f10243335c`), 백본 `Qwen/Qwen3.5-4B-Base@1001bb4d826a52d1f399e183466143f4da7b741b` | Apache-2.0 | 추론 약 14.3 GB. 학습 base recipe 최대 24.6 GB(H100) | 9B F1 전부 실패 + 사용자 승인 뒤(§3.3) |
| 코드 | GitHub `jaredpalmer/kev` | `1f04cfa28e6a708485b28a9585010b9e436b776e` | Apache-2.0 | `kev.train`·`kev.benchmark`·`kev.compare`·`kev.serve`·`scripts/calibrate_checkpoint.py` | 소스 설치(`pip install kev` 는 무관한 패키지) |

> [!success] 검증됨 (2026-10-19, Hugging Face refs API `api/models/jaredpalmer/kev-9b/refs`·`api/models/jaredpalmer/kev-4b/refs`, 모델 카드 https://huggingface.co/jaredpalmer/kev-9b · https://huggingface.co/jaredpalmer/kev-4b · https://huggingface.co/Qwen/Qwen3.5-9B · https://huggingface.co/Qwen/Qwen3.5-9B-Base, dataset manifest https://huggingface.co/datasets/jaredpalmer/kev-suites/resolve/main/v7/decision-v7/manifest.json)
> - `kev-9b` 태그: `v1`(`c2391bc1…`, 옛 가중치, 온도 2.30), `v1.0`(`3afdec81…`), `v7-base`. 브랜치 `main`(`db029f08…`)·`night2-du`. 모델 카드는 Kev 1.0 가중치 리비전을 `b5d8c18e` 로 적는다. 태그·브랜치의 커밋 SHA 는 다르지만 파일 oid 는 같다(22 §2.1 API 확인). 카드: 영어 전용, "fits one 24 GB-class GPU", 추론 상주 21.9 GB, 학습 documents-and-skills 단계 H200 1장 2.6시간·최대 74.1 GB, Apple Silicon 에서는 긴 state 가 32 GB 에 안 들어갔다.
> - `kev-4b` 태그: `v1.0`(`591dcb5b…`), `r8-documents-release`, `night2-du-release`, `v7-base`, `qwen3`. 카드: 추론 14.3 GB(CUDA), MLX 10.2~13.0 GB(32 GB Mac 권장), 학습 base recipe 24.6 GB(H100).
> - `Qwen/Qwen3.5-9B`·`-Base`: Apache-2.0, gated 아님, 9B(safetensors 메타 10B), 컨텍스트 262,144. `-9B` 는 thinking 모드 기본, vLLM·transformers 는 main 브랜치 기준이라고 적혀 있다.
> - `kev-suites` `decision-v7` manifest: train 12,576 레코드(질문 15,576), calibration 968, development 1,204, test 1,176. 출처 `CogComp/trec`·`legacy-datasets/banking77`·`stanfordnlp/imdb`·`fancyzhx/ag_news`·`SetFit/amazon_reviews_multi_en`·`fancyzhx/dbpedia_14`·`google/boolq`·`SetFit/sst5`·`nyu-mll/multi_nli`·`Yelp/yelp_review_full`(리비전 고정). `license` 필드 없음.

### 3.2 쓰지 않는 것

- `jaredpalmer/kev-9b@v1`: Kev 1.0 이전 가중치.
- Kev-27B(Qwen3.8 백본): VRAM·시간이 주말 예산을 넘는다.
- `Qwen/Qwen3.5-9B-Base` 로 추출 SFT, Qwen 파인튜닝 전부: 해커톤 범위 밖(ADR-027 U1).
- QLoRA·4bit: Kev 학습 경로에 없고 Qwen3.5 에 권하지 않는다(22 §2.1).
- Kev 공식 `skills/kev-finetune` 의 Modal 경로: 클라우드 과금(ADR-010).
- hosted API·클라우드 GPU 임대(ADR-010).

### 3.3 VRAM 에 따른 선택 규칙

2026-10-20 확인으로 행 하나가 정해졌다: 학습에 쓸 수 있는 VRAM 은 **A40 46,068 MiB 1장(가용 44.16 GiB)** 이다. 기본은 Kev-9B 이고 `--max_state` 는 F1 에서 1024 → 2048 → 4096 → 6144 순으로 올려 들어가는 값이다(22 §4.2). 4B 명령은 요청서에 같이 넣되 **사용자 승인 뒤에만** 쓴다.

| 학습에 쓸 수 있는 VRAM | 모델 | `--max_state` | 비고 |
|---|---|---|---|
| 80 GB 이상 | — | — | 해당 없음(그런 GPU 가 없다. H100·H200 도 없다) |
| **40~48 GB(A40 1장, 현재)** | **Kev-9B** | F1 에서 1024 → 2048 → 4096 → 6144 순으로 올려 들어가는 값 | 추론 런타임이 GPU 1 에 있으면 내린다(§2.4). F1 이 전부 OOM 이면 22 §4.2 ①~⑤ 를 먼저 하고, 그래도 안 되면 아래 행을 **사용자 승인** 대상으로 보고 |
| 24 GB(해당 없음) 또는 9B F1 전부 실패 | Kev-4B(`--init_from jaredpalmer/kev-4b@v1.0 --base Qwen/Qwen3.5-4B-Base --base_revision 1001bb4d…`) | 4096 | **사용자 승인 뒤에만**. E4 는 "Kev-4B+LoRA 대 Kev-4B v1.0" 으로 바꿔 적고, 데모 모델(9B v1.0)과 다르며 9B 실험과 아키텍처·성능 비교 조건이 다르다는 것을 리포트에 명시 |
| 그 아래 | 실행하지 않음 | — | "회사 측 미실행(VRAM 부족)" 으로 기록 |

### 3.4 받는 명령 (회사, 금요일)

22 §2.2 그대로다. 외부망이 있으면 1안, 없으면 2안(우리가 10-23 목요일에 다른 기계에서 같은 명령으로 받아 `$HF_HOME/hub`·`$SOL_WORK/kev`·wheel 묶음을 넘기고, 서버에서는 `HF_HUB_OFFLINE=1`).

```bash
export SOL_WORK=/data/www/ai_workspace/sol-radar          # 전용 경로(2026-10-20 확인). /data 가용 약 1,011 GB
export HF_HOME=$SOL_WORK/hf                                # 100 GB 이상 비워 둔다
git clone https://github.com/jaredpalmer/kev.git "$SOL_WORK/kev" && git -C "$SOL_WORK/kev" checkout 1f04cfa28e6a708485b28a9585010b9e436b776e
hf download jaredpalmer/kev-9b --revision 3afdec81efc91da83dee06d30714adf54ee35531   # 태그 v1.0 이 가리키는 커밋. 태그 대신 커밋으로 받는다(22 §2.2)
hf download Qwen/Qwen3.5-9B-Base --revision 68c46c4b3498877f3ef123c856ecfde50c39f404
hf download jaredpalmer/kev-suites --repo-type dataset --revision cc4bac803e73112689ec327ffa481c519cbc7a05 --include "v7/decision-v7/*"
# Kev-4B 는 사용자 승인 뒤에만 쓴다(§3.3). 미리 받아 두는 것은 무방하다
hf download jaredpalmer/kev-4b --revision v1.0
hf download Qwen/Qwen3.5-4B-Base --revision 1001bb4d826a52d1f399e183466143f4da7b741b
```

받은 뒤 `adapter_model.safetensors`·`head.pt` 의 sha256 을 22 §2.2 기대값(전체 값 기록됨)과 대조한다. `infra/gpu/kev-preflight.sh` 가 고정 snapshot 디렉터리(`snapshots/3afdec81…`)에서 같은 대조를 하고 없거나 다르면 FAIL, `kev-f1.sh` 는 실행 직전에 다시 대조한 뒤 그 로컬 디렉터리를 `--init_from` 에 준다(태그는 실행 중에 해석하지 않는다). 다르면 학습을 시작하지 않는다.

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
| A4 | g2b 첨부(`https://www.g2b.go.kr`, 익명 GET) | 공고문·제안요청서 HWPX·PDF → 파싱 텍스트 → Qwen 추출(갈래 ②) | 다운로드는 로그인 없이 200(C1 ②). 이용약관·저작권 미확인(미결정 16·18) → 내부 학습만 | 공고당 1~3건 | 파서(`/parse`) 미구현. C1 ④·C3 뒤에만 |
| **B** | `jaredpalmer/kev-suites` `v7/decision-v7`(Hugging Face dataset) | 공개 replay 2,000건 → 일반 능력 보존(망각 방지) | 출처 10개 데이터셋 조건 각각. 회사 내부 학습 전용, 재배포 없음 | train 12,576 | 공개, 받기만 하면 됨 |
| **C** | 가상 기업 원형 6개(`fixtures/eval/companies/*.json`, 21 §3.2) + 항목별 변형(21 §3.3) | 회사 쪽 state 와 라벨 | 우리가 만든 가상 데이터(실제 회사 이름·실적 없음) | 원형 6 × 변형 3~4 | **아직 없음**. 10-20~21 작성 |
| 참고 | 솔리데오 가상 프로필 `fixtures/company/solideo-profile.json`(08 §6.1) | 원형 2(중견 공공 SI)의 출발점 | 가상 | 1 | 있음 |

검토했으나 **쓰지 않는** 오픈 데이터:

| 후보 | 이유 |
|---|---|
| AI Hub(aihub.or.kr) 공공 행정문서·기계독해 데이터 | 이용 신청·약관 절차가 있어 주말 전 확보가 불확실하고, 입찰 공고·RFP 도메인 데이터는 2026-10-19 검색에서 확인하지 못했다 |
| Hugging Face 공개 한국어 데이터셋(KLUE·KorQuAD 등) | 조달 도메인이 아니고, Kev 입력은 영어 템플릿 state 라 쓸 자리가 없다. 나라장터 공고를 모은 공개 HF 데이터셋은 2026-10-19 검색에서 찾지 못했다 |
| EU TED(Tenders Electronic Daily) XML | 재사용 조건 페이지를 확인하지 못했고(2026-10-19, 404), 한국 조달 자격 체계와 달라 라벨 구성이 맞지 않는다 |
| 조달정보개방포털(data.g2b.go.kr) 대용량 파일 | 이용허락·다운로드 한도를 확인하지 못했다. A1 API 로 같은 공고를 받을 수 있어 필요 없다 |
| 낙찰·개찰·계약 데이터 | 범위 밖(§4.1 6번) |

### 4.3 수집 계획 (A1, 10-20~21)

호출 예산은 서비스당 1,000건/일이고, 리허설·시연 몫으로 매일 100건을 남긴다.

| 단계 | 호출 | 건수 | 날짜 |
|---|---|---|---|
| 목록 | `getBidPblancListInfoServc` `inqryDiv=1` 60일(2026-08-20~10-19) `numOfRows=999` | 약 30회(전체 약 30,000행 추정) | 10-20 |
| 정보화 필터 | 클라이언트 쪽(`infoBizYn` 은 요청 파라미터로 무시된다, ADR-029 A4 확대 필터) | 약 1,800건 추정 → **300건** 표본(기관·예산·마감 분포를 고르게) | 10-20 |
| 보조 조회 | 공고당 면허제한·참가지역·e발주 첨부 3회(`inqryDiv=2`, `bidNtceNo`·`bidNtceOrd`) | 150건 × 3 = 450회 | 10-20 |
| 보조 조회 | 나머지 150건 | 450회 | 10-21 |
| 변경이력 | `…ChgHstryServc` 같은 60일 | 약 10회 | 10-21 |

저장 경로는 둘 중 하나다. 주말 전 확실한 쪽은 2안이다.

1. **C3 live 수집**(`OfficialApiConnector` → Supabase `bid_notices` `is_demo=false`) → `pnpm dataset:build`(예정) 가 DB 에서 읽는다. 보조 조회 3종·documents job 이 main 에 아직 없다(C3 남은 일).
2. **녹음 스크립트**: C1 ① 과 같은 방식으로 마스킹한 응답 JSON 을 `fixtures/recorded/train/<serviceId>/<operation>.<date>.pN.masked.json` 에 저장하고, 빌더가 DB 없이 이 파일을 읽는다. 담당자 필드 10개 마스킹과 `serviceKey` 제거 규칙은 `docs/evidence/phase-0/external-deps-api-20261019.md` 를 따른다. 저장소에는 넣지 않고(`.gitignore`) 번들에만 넣는다.

### 4.4 레코드 구성: 두 갈래

한 레코드는 state 하나 + 질문 여러 개다(22 §4.1). 질문 문구는 `services/ai/kev/question-sets/v0.2.json` 원문, state 는 `services/ai/kev/state-templates/en.v0.2.txt` 와 **서빙과 같은 빌더**로 만든다(둘 다 main 에 있다. 질문 세트 `85a30c6`, state 템플릿 `51ad173`, main 병합 `b4a23fc`. 질문 세트 status 는 "초안 — 사용자 검토 전"이다).

**갈래 ① 구조화 필드만(엔드포인트·파서 없이 된다. 주말 기본)**

| 구성 | 값 |
|---|---|
| NOTICE 블록 | A1 목록·보조 조회 필드: 단계·기관(종류만)·예산·마감·계약 방법·**면허제한 행**(A2 업종 코드로 정규화)·참가가능지역·첨부 유무 |
| 추출 필드(`requiredSkills`·`pastPerformance`·`staffing` 본문 요구) | `UNKNOWN`(추출 안 함). "첨부를 읽지 못했다" 한 줄(17 절대 규칙) |
| COMPANY 블록 | 원형 6개 × 변형: 보유 면허(`HELD`/`NOT_HELD`/증빙 삭제), 수행 상한, 가용 FTE, 지역 |
| 질문·라벨 | `req.qualifications[*].status`(면허제한 ↔ 보유 면허: `SATISFIED`/`NOT_SATISFIED`/`NEEDS_REVIEW`, 구성 라벨), `risk.scale`(예산 vs 수행 상한, 규칙), `risk.schedule`(마감 vs 오늘, 규칙), `risk.staffing`(가용 FTE, 구성). 면허제한이 여러 행이면 `NEEDS_REVIEW`(`AMBIGUOUS_MATCH`, 미결정 19) |
| 규모 | 300 공고 × 원형 5(1개 홀드아웃) × 변형 3 = 4,500 → **1,500~3,000** 으로 샘플링. 선택지마다 정답 비율 5% 이상, 세 값이 1/3 에 가깝게 |
| state 길이 | 약 500~1,200 토큰 → `--max_state 2048` 로 충분 |

이 갈래가 가르치는 것은 "구조화 자격 필드와 회사 보유 상태를 보고 세 값을 가르는 것"과 "정보가 없으면 `NEEDS_REVIEW`" 다. 규칙이 이미 계산하는 항목이지만, Kev 는 참고 지표라 규칙과 **같은 방향**으로 보수적으로 답하게 만드는 것이 목적이다(03 §5.5).

**갈래 ② 추출 포함(10-22 저녁 기준 C1 ③ 엔드포인트와 `/parse` PDF·HWPX 가 동작할 때만)**

- 갈래 ① 위에 A4 첨부 → `/parse` → `/extract`(회사 엔드포인트 Qwen, train 은 silver: 스키마·인용 검증 통과분만) 을 더해 `req.requiredSkills[*].status`·`req.pastPerformance[*].status`·`risk.techGap` 을 구성 라벨로 더한다(22 §4.1 표).
- Qwen 호출은 공고당 1회, 300건 ≤ 300회. 지연은 C1 ③ G3 실측 뒤 계산한다.
- state 길이 최대 6,000 토큰 → `--max_state 6144`(03 §5.6).

두 갈래 모두 같은 JSONL 형식이라 회사 쪽 명령은 `--max_state` 만 다르다. 어느 갈래로 번들을 만들었는지 manifest 와 E4 리포트에 적는다.

**dev·test**: X6a 의 test 20·dev 10 사업(사람 라벨, 사용자 직접, ADR-027 11번)을 쓴다. 10-22 까지 test 라벨이 끝나지 않으면 축소판(fixture 20건 + 실공고 5건, ADR-023 X1, 21 §3.5)을 test 로 쓰고 그 사실을 리포트 첫 줄에 적는다. 어느 쪽이든 train 과 사업 클러스터가 겹치지 않는다.

### 4.5 번들

`sol-dataset-v0.1.tar`(22 §4.1 번들 절):

- `manifest.json`: 데이터셋 버전, git commit, 질문 세트 `kev-qs/v0.2`, state 템플릿 `en.v0.2`, 마스킹 버전, **갈래(①/②)**, 출처별 개수(A1 공고 수·C 원형·B replay 는 회사가 Hub 에서 받으므로 포함 안 함), 분할별 레코드·질문 수, train state 토큰 최대값, 파일별 sha256, test·dev 클러스터 교차 0건 확인.
- `kev/train.en.jsonl`·`kev/dev.en.jsonl`·`kev/test.en.jsonl`.
- 22 §2~§4 와 이 문서 §5~§6.
- 들어가지 않는 것: 서비스키·Supabase 키·담당자 개인정보·첨부 원문 전체·실제 회사 자료.

검사(10-22, 우리): JSONL 각 줄이 22 §4.1 형식인지, 같은 state 에 다른 라벨 0건, `--max_state` 안인지(토크나이저 `Qwen/Qwen3.5-9B-Base` 로 센다), 선택지 비율, 클러스터 누수. 회사 쪽에서는 `kev.benchmark --data kev/dev.en.jsonl --run jaredpalmer/kev-9b@v1.0` 로 읽힘을 확인한다(F1 과 같은 시간).

## 5. 학습 레시피 (주말용 값)

명령 원문은 22 §4.2·§4.3 이다. 여기서는 주말에 쓸 값만 정한다.

### 5.1 고정값

| 인자 | 값 | 근거 |
|---|---|---|
| `--init_from` | `jaredpalmer/kev-9b@v1.0` | 공개 LoRA·head 에서 이어 학습. 백본부터 새로 시작하면 성능이 크게 떨어진다(Kev README) |
| `--base --base_revision` | `Qwen/Qwen3.5-9B-Base` `68c46c4b…` | `kev.train` 의 `--base` 기본값은 `Qwen/Qwen3-0.6B-Base` 라 **반드시 준다**. `COMPAT_FIELDS` 가 다르면 거부 |
| `--lora 16 --head_dim 256 --lora_targets all --option_isolation 0 --special_embeddings 0` | 고정 | 체크포인트 호환 |
| `--suite --replay` | `$SOL_WORK/kev/evals/v7/decision-v7` `2000` | 공식 이어 학습 레시피. train 이 3,000 을 넘으면 500 으로 줄여도 된다. manifest 에 9B base pin 이 없어 `--base_revision` 도 같이 준다(22 §4.3) |
| `--epochs --lr` | `1` `2e-5` | Kev-9B 자신의 lr. 상한 5e-5. 망각이 보이면 반으로 |
| `--dtype --weights_dtype --checkpointing` | `bf16 bf16 1` | 메모리 |
| `--batch --accum` | `1 8` | 유효 배치 8(공식 2×4 와 같다) |
| `--max_state` | 갈래 ① `2048`, 갈래 ② `6144`(F1 결과로 확정) | 기본 384 면 긴 레코드가 빠진다 |
| `--seed --out` | `0` `runs/kev-9b-sol-lora-v0.1` | 재실행은 `v0.2` 로 새 이름 |

> [!warning] 인자 표기 주의 (2026-10-19 확인)
> `python -m kev.train`(README)은 `--init_from` 과 `--base` 를 쓴다. 공식 `skills/kev-finetune/SKILL.md` 의 Modal 래퍼는 `--init-from` 을 쓰고 `--base` 를 주지 말라고 적는다. 둘은 진입점이 다르다. 회사 GPU 에서는 **README 의 `python -m kev.train` 형식**(22 §4.2·§4.3)만 쓴다.

### 5.2 F1 격자 (토요일 오전, 3칸)

22 §4.2 의 F1-A → B → C → D 를 그대로 따른다. F1-A(`infra/gpu/kev-preflight.sh`)는 금요일까지 끝내 둔다. 토요일 오전은 F1-B·C 다. 칸마다 `infra/gpu/kev-f1.sh` 가 20 step 을 돌리고 최대 GPU 메모리 두 값(torch `peak_device_bytes`·`nvidia-smi -i 1` 최대)·step 시간·OOM·`dropped` 수·checkpoint 저장을 `runs/f1-results.md` 에 적는다. 앞 칸이 PASS 일 때만 다음 칸이고, OOM 이면 더 큰 값을 시도하지 않는다. GPU 를 전부 쓰도록 계획하지 않는다(nvidia-smi 최대 ≤ 41,000 MiB).

| 순서 | 값 | 통과 기준 |
|---|---|---|
| 1 | `--max_state 1024`(기본 후보: bf16·batch 1·accum 8·checkpointing 1) | OOM 없음, `dropped 0 of M`, nvidia-smi 최대 ≤ 41,000 MiB, checkpoint 저장 |
| 2 | `--max_state 2048`(갈래 ① 값) | 같다 |
| 3 | `--max_state 4096` → `6144`(갈래 ② 값. 갈래 ① 번들이면 F1-A 길이 표를 보고 건너뛴다) | 같다 |
| 4 | 통과한 최대값에서 `--batch 2 --accum 4 --tag b2` | 들어가면 F2 에 쓴다(속도). 안 들어가면 1×8 |

F1 의 20 step 체크포인트로 F3 보정 경로(`calibrate_checkpoint.py --allow-in-distribution`)가 우리 dev 행을 받는지와 `kev.benchmark` 채점 dtype 이 GPU 1 에 들어가는지(22 §4.4)도 같이 돌려 본다. 격자 1번부터 OOM 이면 22 §4.2 의 ①~⑤(state 축약·`--max_state` 축소·batch/`--row_budget`·공식 메모리 옵션·`--shared_prefix`)를 먼저 검토하고, Kev-4B 전환은 §3.3 대로 사용자 승인 뒤에만 한다.

### 5.3 F2 받아들이는 기준

- `train.log` 에 `dropped 0 of M records` — 0 이 아니면 받지 않는다.
- `replay: 2000 of … suite training records mixed with …` 줄이 있다.
- loss 가 발산하지 않는다.
- 끝나면 `sha256sum adapter_model.safetensors head.pt` 를 적어 둔다.

## 6. E4 평가 (일요일)

22 §4.4 그대로다. 주말에 챙길 것만 적는다.

1. **보정은 dev 로만**(온도). test 로 맞추지 않는다. 공식 skill 도 development 분할로 온도를 맞추지 말라고 적는다. 어느 경로(1안 `calibrate_checkpoint.py` / 2안 `fit_temperature`)였는지 `MODEL_CARD.md` 에 적는다.
2. 회사 쪽 채점 4종: `kev.benchmark` test(E4·E1), `kev.compare`(짝 부트스트랩), regression(`decision-v7` development, E4·E1).
3. 우리 쪽 `sol_eval --system E4 --from-benchmark runs/e4-test --reference runs/e1-test`(오프라인, §2.2 A안) → 21 §4.3 지표(Macro-F1·정보부족→미충족 혼동률·Brier·ECE, 순서 민감도는 `--rotations`)와 E1 대비 Δ·95% CI. 지연은 재지 않는다(§2.2). E1 도 같은 날 서버에서 같은 test 로 채점한 출력을 쓴다. 엔드포인트는 쓰지 않는다.
4. 받아들이는 기준(공식 kev-finetune): 망각 정확도 하락 약 2%p 이내, 보정 뒤 확신 오류율(p≥0.9 오답)이 기준선 이하, 보정본이 raw 보다 나음. 어기면 결과는 보고하되 "서빙 후보 아님" 으로 적는다.
5. "E4 가 E1 보다 낫다" 는 Δ 의 95% CI 가 0 을 포함하지 않을 때만 쓴다. 포함하면 "차이 없음". CI 는 사업 클러스터 단위 paired bootstrap 을 우선 낸다(같은 사업에서 파생된 회사 변형·질문은 독립 표본이 아니다, 21 §4.3). 클러스터가 적으면 개선을 확정하지 않고 탐색적 결과로 적는다. test 20(또는 축소판 25)은 표본이 작아 CI 가 넓다는 문장을 표 아래에 둔다(`experiment-tables.md` (c)).
6. 리포트 첫 줄에 적을 것: 데이터셋 버전·commit·갈래·질문 세트·템플릿·모델 리비전(`v1.0` = `3afdec81…`)·회사 GPU(NVIDIA A40 46,068 MiB, 물리 index 1, 드라이버 580.173.02, torch 2.8.0+cu128)·학습 시간(실측)·`--max_state`·채점 dtype.

## 7. 위험과 대체 경로

| 위험 | 판단 시점 | 대체 |
|---|---|---|
| 회사 GPU 서버에 외부망이 없다 | 10-22 P4 | §3.4 2안. 우리가 10-23 목요일에 외부망 기계에서 받아 넘긴다(HF 캐시 약 40 GB + `$SOL_WORK/kev` + wheel 묶음). 서버는 `HF_HUB_OFFLINE=1` |
| VRAM 이 9B 학습에 부족(A40 가용 44 GiB) | F1 1번 OOM | 22 §4.2 ①~⑤(state 축약·`--max_state` 축소·batch/`--row_budget`·공식 옵션·`--shared_prefix`) → 사용자 보고. 승인하면 Kev-4B(§3.3)로 바꾸고 E4 이름을 "4B" 로 적는다. 다중 GPU·클라우드 GPU 는 자동으로 가지 않는다 |
| 다른 회사 작업이 GPU 1 을 쓴다 | `kev-preflight.sh`·`kev-f1.sh` 가 다른 프로세스를 발견 | 종료하지 않고 멈춘다. 회사에 시간대를 확인하고 다시 돈다(16 미결정 22) |
| 10-22 까지 엔드포인트(C1 ③)·파서가 없다 | 10-22 저녁 | **갈래 ①** 로 번들 확정. 갈래 ② 는 하지 않는다 |
| 10-22 까지 test 20 사람 라벨이 없다 | 10-22 | 축소판 test(fixture 20 + 실공고 5)로 E4. 리포트에 명시 |
| 토요일 18:00 까지 F2 미시작 | 10-24 18:00 | 사용자 보고. 승인하면 Kev-4B 로 축소 시도, 아니면 "회사 측 미실행" 문장(`limitations.md` §4) |
| 회사가 `report.json` 만 보내고 `rows.json`·`predictions.jsonl` 을 못 보낸다 | 10-25 | E4 Δ·CI 는 `kev.compare` 결과로 적고, `sol_eval` 지표(정보부족→미충족 혼동률·사유별)는 "미측정" 으로 남긴다. 라우터 B안은 그래도 쓰지 않는다 |
| 돌려받은 출력을 우리가 다시 재현해야 한다(출력 누락·의심) | 10-25 | 체크포인트가 Kev-4B 일 때만 노트북(Apple M3 Pro, 18 GB)에서 `kev.benchmark --device mps`(옵션 존재 미확인)를 시도한다. 카드는 32 GB Mac 을 권하고 MLX 최대 13 GB 이므로 **짧은 state(갈래 ①)에서만** 기대할 수 있다. 9B 는 노트북에서 시도하지 않는다 |
| 추론 런타임이 GPU 1 에 떠 학습과 겹친다 | 10-24 | §2.4. 회사가 학습 전에 내리고, 리허설의 `live`·`fixture` 확인은 토요일 오전·일요일 저녁. GPU 0·2 에 있으면 겹치지 않는다 |
| 결과가 E1 보다 나쁘다 | 10-25 | 그대로 보고한다. 데모 모델은 어차피 v1.0 이다. 오류 분석(21 §4.4 원인 코드)을 한 줄 붙인다 |

## 8. 회사에 보낼 것·물을 것 (10-22 수요일까지)

보낼 것:

1. `sol-dataset-v0.1.tar` + sha256(§4.5). 실제 공고(공공 데이터, 개인정보 마스킹)와 가상 기업만 들어 있다.
2. 22 §2~§4 와 이 문서 §3~§6. 9B 명령과 4B 대체 명령을 둘 다 넣는다.
3. 일요일 채점 명령 5줄(§2.2 A안)과 돌려줄 출력 폴더 목록. **회사 nginx·라우터 변경은 없다.** B안을 고를 때만 `model-router.conf` 추가본과 `nginx -t` 기록을 따로 보낸다.
4. 실행 순서·시간표(§1)와 받아들이는 기준(§5.3·§6 4번).

물을 것(P4·P5, 16 미결정 22):

1. GPU 모델·장수·VRAM 은 2026-10-20 확인했다(A40 ×3, 학습은 물리 GPU 1). 토·일에 GPU 1 을 SOL RADAR 가 독점해도 되는지(다른 회사 작업이 GPU 1 을 쓸 가능성)와 학습 시간대.
2. 데모 추론 런타임(vLLM·`kev.serve` v1.0)을 어느 GPU 에 띄울지. GPU 1 이면 학습 중 내려도 되는지. GPU 0·2 는 회사 결정이다.
3. huggingface.co·github.com·pypi.org 로 나갈 수 있는지(없으면 반입 2안).
4. 일요일에 서버 안에서 채점 4회를 돌리고 출력 폴더(`report.json`·`rows.json`·`predictions.jsonl`)를 보내 줄 수 있는지(P5). 등록된 location 은 `/sol-radar/` 하나뿐이라 그 밖의 nginx 변경은 묻지 않는다.
5. 돌려줄 것(22 §4.5): 체크포인트 폴더·로그·리포트 4종·`MODEL_CARD.md`·sha256. 데이터셋 원문은 돌려받지 않고, 회사는 학습 뒤 번들을 지운다.

## 9. 정본 반영 상태

2026-10-19 저녁 사용자 승인 뒤 ADR-027 개정으로 아래를 반영했다(브랜치 `docs/adr027-weekend`, main `1955041` 기준). "후속" 행은 해당 작업 때 한다.

| 정본 | 반영한 것 | 상태 |
|---|---|---|
| [[16-DECISIONS\|16 ADR]] ADR-027 행·상세 머리·5번·7번·9번·10번·콜아웃, 미결정 22 | 주말 일정, 10번을 A안 오프라인 채점으로 개정(8010·`/kev-lora` 불필요, B안은 선택), 미결정 22 를 채점 실행·출력 전송으로 재정의 | 반영(2026-10-19) |
| [[22-FINETUNE-RUNBOOK\|22 실행서]] §4.4·§6·§7 | test 채점에 `--rotations 6`, E4 리포트를 오프라인 출력 기반으로, 평가 전용 서빙을 B안으로 격하, 물을 것 4번 교체, 미확인 행 추가 | 반영(2026-10-19) |
| [[10-DEPLOYMENT\|10 배포]] 엔드포인트 절 | 그림의 `kev-lora` 간선을 점선 "B안 선택, 기본 없음"으로, 라우터 설명을 "두 경로가 전부, 주말에도 불변"으로 | 반영(2026-10-19) |
| [[21-MODEL-TRAINING\|21 모델 학습]] §4.1 | E4 는 엔드포인트에 붙지 않고 서버 채점 출력을 오프라인으로 읽는다 | 반영(2026-10-19) |
| [[12-ROADMAP\|12 로드맵]] X6 행·병렬 순서·freeze~D-day 표·간트 | X6c·X6d 10-24, X6e 10-25, X6b 번들 마감 10-22, 리허설과 학습 시간 분리 | 반영(2026-10-19) |
| [[22-FINETUNE-RUNBOOK\|22 실행서]] §2.1 | `kev-9b` 태그 `v1.0` 커밋 `3afdec81…`(main `db029f08…` 과 파일 동일), `kev-4b` 태그 `v1.0` 커밋 `591dcb5b…`, 인자 표기 주의(§5.1 콜아웃) | 후속(22 §2.1 검증 콜아웃 갱신 때) |
| [[03-AI-PIPELINE\|03 AI 파이프라인]] §11 레지스트리 | 학습본 항목 `kev-9b-sol-lora-v0.1`(또는 `kev-4b-sol-lora-v0.1`)을 체크포인트 sha256·데이터셋·리포트 경로 기록용으로 추가. `GET /v1/models` 서빙 대조는 B안일 때만 | 후속(X6e, 체크포인트 수령 뒤) |
| [[07-DATA-PIPELINE\|07 수집]] | `fixtures/recorded/train/` 녹음 경로와 `.gitignore` 규칙 | 후속(§4.3 2안을 쓸 때) |
| `docs/submission/` | `experiment-tables.md` (c)·`limitations.md` E4 문장·`slides-outline.md` 9장·`evidence-list.md` | 후속(X6f, 10-26) |

## 10. 미확인

| 항목 | 상태 | 확인 방법·시점 |
|---|---|---|
| 회사 GPU 모델·VRAM·장수 | **확인(2026-10-20)**: A40 46,068 MiB ×3, 학습은 물리 GPU 1 | [F1 기록](evidence/kev-train-feasibility.md) §0 |
| 외부망·학습 시간대·GPU 1 독점 가능 여부·추론 런타임 위치·라우터 포트 실행 상태 | 미확인 | P4(10-22), C1 ③ |
| Kev 소스 설치·의존성 호환·모델 다운로드·Kev 로딩·F1 20 step·최대 메모리·학습 시간 | 미실행 | 22 §3.2 → `kev-preflight.sh` → `kev-f1.sh`(10-21~24) |
| 엔드포인트 응답·인증(P2·P3) | 미확인(2026-10-19) | C1 ③ G1~G6 |
| Kev-9B bf16 백본 LoRA 학습 실제 메모리와 `--max_state 6144` 수용 | 추정 | F1(§5.2) |
| 60일 목록의 실제 건수와 정보화사업 비율 | 7일 표본 추정(3,555건, 약 6%) | 10-20 수집 |
| 면허제한 여러 행의 AND/OR | 미확인(미결정 19) | 주말 학습에서는 `NEEDS_REVIEW` 로 라벨 |
| `kev-suites` 출처 데이터셋별 라이선스 | manifest 에 없음 | 내부 학습 전용으로 취급. 공개 전 출처별 확인 |
| 첨부 원문의 학습 사용 권리 | 미확인(미결정 18) | 법무. 주말에는 갈래 ② 라도 원문 전체를 번들에 넣지 않는다 |
| Ampere(A40, CC 8.6)에서 `flash-linear-attention 0.5.2` + triton 3.4.0 | fla 소스상 거부 조건은 Hopper 전용(22 §3.2). A40 실행은 미실행 | `kev-preflight.sh` 커널 smoke → F1 20 step |
| `kev.benchmark` fp32 채점이 GPU 1(44 GiB)에 들어가는지 | 미검증 | F1 때 dev 채점. 안 되면 E1·E4 둘 다 `KEV_DTYPE=bf16`(22 §4.4) |
| `calibrate_checkpoint.py --allow-in-distribution` 이 우리 dev 행을 받는지 | 미확인 | F1 때 20 step 체크포인트로 |
| `kev.benchmark` 출력(`rows.json`·`predictions.jsonl`) 스키마가 `sol_eval` 입력으로 충분한지, `--rotations` 가 `permute n_perm=6` 과 같은 뜻인지 | 미확인 | 토요일 F1 20 step 체크포인트의 dev 채점 출력으로 확인. 부족하면 B안 |
| Kev-4B 학습본을 18 GB Mac 에서 `kev.benchmark`(`--device mps`)로 돌릴 수 있는지 | 미확인(카드는 32 GB 권장, 옵션 존재 미확인) | §7 마지막 대체 경로를 쓸 때만 |
| `Qwen/Qwen3.5-9B` 를 지금 vLLM 버전이 비사고 모드·guided JSON 으로 지원하는지 | 미확인 | C1 ③ G4 |

## 관련 문서

- [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]] — 모델 출처·환경·명령·반입(정본)
- [[21-MODEL-TRAINING|21 모델 학습]] — 데이터셋·라벨·분할·지표·착수 판단
- [[16-DECISIONS|16 ADR]] — ADR-010(유료 승인)·ADR-022(서비스키)·ADR-025(엔드포인트)·ADR-027(X6)·미결정 16·18·19·22
- [[12-ROADMAP|12 로드맵]] — X6 일정, freeze 10-23
- [[10-DEPLOYMENT|10 배포]] — 모델 라우터·`kev.serve`·vLLM 기동
- [[03-AI-PIPELINE|03 AI 파이프라인]] — `kev-qs/v0.2`·state 템플릿·레지스트리 검증
- [[07-DATA-PIPELINE|07 수집]] — 나라장터 API 필드·보조 조회·마스킹
- [[09-SECURITY|09 보안]] — 데이터 경계·개인정보 마스킹
- [[18-HACKATHON|18 해커톤]] — §7 정직성 표(파인튜닝 행), §8 13번 답
- [[PROGRESS|진행 상황]]
