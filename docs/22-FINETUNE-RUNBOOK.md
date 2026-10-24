---
title: "22. 회사 GPU 파인튜닝 실행서: Bosun v3.1 0.6B LoRA (Qwen 은 회사 API, 학습 없음)"
doc: "22"
status: draft
tags:
  - sol-radar
  - ai
  - ops
updated: 2026-10-24
---

# 22. 회사 GPU 파인튜닝 실행서: Bosun v3.1 0.6B LoRA (Qwen 은 회사 API, 학습 없음)

> [!tip] 이 문서의 역할
> [[21-MODEL-TRAINING|21 모델 학습]]은 **무엇을 왜** 학습하는지(데이터셋·라벨·평가 지표·착수 판단)를 정한다. 이 문서는 **어떻게** 하는지를 적는다. 모델을 어디서 받는지, GPU 서버 환경을 어떻게 만드는지, 학습 데이터를 무엇으로 만드는지, 어떤 명령을 돌리고 무엇을 돌려받는지다. 회사 GPU 서버 셸에서 회사 담당자가 그대로 따라 할 수 있게 쓴다([[16-DECISIONS|ADR-025]]: 학습 실행은 회사).

> [!warning] 범위 (2026-10-20, [[16-DECISIONS|ADR-034]] 개정)
> - **Bosun v3.1 0.6B LoRA 이어 학습**: 해커톤 비교 실험이다. 데모·S-LIVE 모델은 **공개 Bosun** `Hanno-Labs/bosun-v3.1-0.6b@5e78a37c` 그대로다(ADR-034 9번, Q7). 학습본은 같은 test 세트에서 개선·회귀 안정성을 보이고 **사용자 승인**을 받은 뒤에만 교체 후보가 된다.
> - **Qwen 파인튜닝은 하지 않는다**(2026-10-20 저녁 사용자 결정, ADR-034 8번 개정). 추출·설명 모델은 회사가 이미 운영 중인 vLLM API 의 `Qwen/Qwen3.8-Flash-Next` 를 재사용한다(2026-10-21 사용자 보고로 Qwen3.5-27B 에서 교체. 게이트웨이 `QWEN_BASE_URL`·`QWEN_API_KEY`, 주소·키 확정은 [[03-AI-PIPELINE|03]]·[[10-DEPLOYMENT|10]]). 처음 안이던 Qwen3-4B-Instruct-2507 은 **백업으로만 보존**하고 다운로드·venv·서빙·학습 작업을 중단한다. 이 문서의 Qwen 몫은 EX0(회사 API 추출 품질 기준 측정)만이다.
> - Kev-9B·Qwen3.5-9B 경로(`kev.train`·`kev.benchmark`·`kev.compare`·`kev.serve`, `.venv-kev`, `infra/gpu/kev-preflight.sh`·`kev-f1.sh`)는 **퇴역(2026-10-20)** 이다. 스크립트·증거 파일은 지우지 않고 보존한다(ADR-034 10·11번). 이 문서에서는 이력 표기로만 남는다.
> - 이 문서가 부르는 우리 쪽 도구(`services/decision` 의 `sol_decision.serve`·`sol_decision.train`·`sol_decision.parity`·`sol_decision.trainer.calibrate`, `sol_eval` 의 `bosun_score`·`export --format bosun`·`leakage`·`compare`, `infra/gpu/bosun-preflight.sh`·`infra/gpu/bosun-f1.sh`)는 B1 로 main `1b68f9b` 에 들어갔다(2026-10-21, [분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) §6·§9). 아래 명령의 인자는 그 코드 기준이다. 이 문서의 B1 도구·스크립트는 회사 서버에서 아직 실행하지 않았다(2026-10-20 환경 확인과 회사의 2-step CPU 학습은 별도, §3.1·§3.2).
> - GPU 학습·모델 서빙 시작·nginx 변경은 **사용자 승인 전까지 하지 않는다**(ADR-034 10번). 아래 명령은 승인 뒤 회사가 실행한다.

## 1. 한눈에

| | Bosun v3.1 0.6B | Qwen3.8-Flash-Next(회사 API, 학습 없음) |
|---|---|---|
| 하는 일 | 요구사항별 충족 분류·기술 적합성·리스크 확률([[03-AI-PIPELINE\|03]] §5.10). 점수 입력이 아니고 `review_flags` 만 더한다 | 공고문 요구조건 추출·영어 표기(`translations`)·설명([[03-AI-PIPELINE\|03]] §4) |
| 출발 모델 | `Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`(백본 `Qwen/Qwen3-0.6B@c1899de`, 256 decision token) | 회사가 운영하는 vLLM API 의 `Qwen/Qwen3.8-Flash-Next`(리비전·서빙 설정은 회사 운영, 우리가 고정하지 않음). 백업: `Qwen/Qwen3-4B-Instruct-2507@cdbee75f`(미사용) |
| 학습 방식 | 공개 LoRA(r=16, 392 텐서, 10,092,544 파라미터) 이어 학습, decision 임베딩·백본 동결 + dev 로 온도 보정 | **없음** |
| 도구 | 우리 `services/decision`(`sol_decision.train`), 채점 `sol_eval bosun_score`(main `1b68f9b`) | 없음(게이트웨이 어댑터 그대로, `QWEN_BASE_URL` 값만 갱신) |
| 학습 데이터 | 실제 공고 × 가상 기업 변형의 영어 state + `kev-qs/v0.2` 라벨을 **질문 하나 = 레코드 하나**로 변환(§4.1). 공개 replay 없음 | 없음 |
| 비교 | E4(학습본) 대 **E1'(공개 Bosun zero-shot)**, 같은 test·seed 0~5([[21-MODEL-TRAINING\|21]] §4.2) | EX0 기준 측정만(EX1 없음, §5) |
| 해커톤 | 실행(F1·F2 10-25 오후, 채점 10-26 오전. 2026-10-24 개정, [[23-WEEKEND-FINETUNE\|23]]) | 학습 없음 |

역할은 [[16-DECISIONS|ADR-025]]·ADR-034 대로 나눈다.

| 우리(SOL RADAR) | 회사(GPU 서버) |
|---|---|
| 평가셋·학습셋 번들(`sol-dataset-{version}/` 폴더, 파일별 sha256)·이 실행서·학습 요청서(§6)·`services/decision` 코드·`bosun-*.sh` 를 만든다(B1, main `1b68f9b`) | Bosun·백본을 받고(§2) `.venv-bosun` 환경을 만든다(§3). 사용자 승인 뒤 `sol_decision.serve`(8009)를 띄운다. 회사 Qwen3.8-Flash-Next API 는 키 전달·`GET /v1/models` 확인만 |
| 사람 라벨(사용자 직접, ADR-027 에서 보존) | F1 smoke·F2 학습·F3 보정·E4·E1' 채점을 **물리 GPU 1(PaddleOCR 와 공유)** 에서 돌린다(§4) |
| 돌려받은 채점 출력을 노트북에서 오프라인으로 읽어 E4 지표를 내고(21 §4.1) 레지스트리 항목을 쓴다 | 서버 안에서 `sol_eval bosun_score` 를 E4·E1' × test·dev 로 돌린다(ADR-034 7번). 학습본을 HTTPS 로 서빙하지 않는다 |
| 결과를 제출물에 적는다 | 돌려줄 것(§4.5)을 넘긴다. 데이터셋은 학습이 끝나면 지운다 |

회사 측 실행은 GPU 서버 셸(호스트 `sol-NF5280M6`, 계정 `bim`, 2026-10-20 확인)에서 한다. 서버에는 A40 46,068 MiB 가 3장 있고 SOL RADAR 는 **물리 index 1 한 장**을 회사 PaddleOCR 서비스와 **공유**해 쓴다(§3.1). GPU 1 에 올리는 우리 것은 `sol_decision` Bosun 서빙과 Bosun LoRA 학습뿐이다(Qwen 은 회사 API). 2026-10-20 오전 환경 확인 기록(당시 Kev 기준)은 [F1 기록](evidence/kev-train-feasibility.md) §0 이고, Bosun 결과는 새 파일 `docs/evidence/bosun-train-feasibility.md`(B4 에서 만든다)에 쓴다.

## 2. 모델과 자료 출처

### 2.1 출처 표 (2026-10-20 확인)

받는 것은 Hugging Face Hub 공개 자료 2개다. 토큰 없이 받는다(gated 아님). 리비전을 고정해 받고, 받은 뒤 sha256 을 대조한다(§2.2).

| 무엇 | 어디서 | 고정 리비전 | 라이선스 | 크기·확인 값 |
|---|---|---|---|---|
| **결정 모델** Bosun v3.1 0.6B(공개 LoRA 어댑터 + decision 임베딩 + 모델 코드) | https://huggingface.co/Hanno-Labs/bosun-v3.1-0.6b | `5e78a37c8d86860ebac9ef2d5327d6299498498e`(= main, 2026-10-09) | Apache-2.0(Clause Logic Inc.) | `adapter/adapter_model.safetensors` sha256 `961d237bc60a88f133bc723dd3cbf1133f743a7fde673cee96d1171c67b425d5`, `decision_embeddings.safetensors` sha256 `88f9e856054f78ac521ba0180052d25720c3786d1db4e80aa7a8ecf39be01188`(`manifest.json`, content-addressed). PEFT LoRA r=16, alpha 32, dropout 0.05, target 7개(`q_proj k_proj v_proj o_proj gate_proj up_proj down_proj`), 28층 × 7 × (A,B) = 392 텐서, 10,092,544 파라미터 |
| Bosun 백본(동결) | https://huggingface.co/Qwen/Qwen3-0.6B | `c1899de289a04d12100db370d81485cdf75e47ca` | Apache-2.0 | 28층, hidden 1024, inter 3072, ctx 40,960. 파일 크기·sha256 은 미확인(B2 에서 기록) |
| **추출·설명 모델** Qwen3.8-Flash-Next | 회사가 운영하는 vLLM API(게이트웨이 `QWEN_BASE_URL`, [[03-AI-PIPELINE\|03]]·[[10-DEPLOYMENT\|10]] 참조) | 회사 운영 값(우리가 고정하지 않음) | 회사 운영 | 받지 않는다. 게이트웨이가 `GET /v1/models` 의 `id` 를 레지스트리 `run: Qwen/Qwen3.8-Flash-Next` 와 대조만 한다. 키는 회사가 `QWEN_API_KEY` 로 제공 |
| ~~Qwen3-4B-Instruct-2507~~ `Qwen/Qwen3-4B-Instruct-2507` | — | **백업(미사용, 2026-10-20 저녁)**. 리비전 `cdbee75f17c01a7cc42f958dc650907174af0554` 기록만 | Apache-2.0 | 다운로드·venv·서빙·학습 작업 중단. 레지스트리 `status: backup` |
| ~~Kev-9B 체크포인트~~ `jaredpalmer/kev-9b` | — | **퇴역(2026-10-20)**. 가중치는 2026-10-20 오후 서버에 받았다(snapshot `db029f08`, 사용자 보고). `kev` 패키지 설치·`kev.serve`·F1 은 미실행 | Apache-2.0 | 서빙·학습·비교에 쓰지 않는다. 캐시는 지우지 않아도 된다(회사 결정) |
| ~~Qwen3.5-9B·Qwen3.5-9B-Base·`kev-suites` replay·LLaMA-Factory~~ | — | **퇴역(2026-10-20)** | — | 받지 않는다 |

쓰지 않는 것:
- Kev 전부(`kev` 패키지, `kev.serve`·`kev.train`·`kev.benchmark`·`kev.compare`, Kev-9B·Kev-4B, `--init_from`·`--max_state`): 퇴역. 이력은 ADR-027(폐기)·[F1 기록](evidence/kev-train-feasibility.md)에 있다.
- Qwen 파인튜닝 전부(QLoRA·LLaMA-Factory·병합 서빙, Qwen 4B 다운로드·`.venv-qwen`): 2026-10-20 저녁 사용자 결정으로 하지 않는다(§5).
- Hanno `jev-compatible-server`: LICENSE 파일 없음, 인증·`GET /v1/models`·`latency_ms` 없음, `0.0.0.0:8000` 고정. 요청 계약의 **참고**로만 삼고 코드는 복사하지 않는다(계획 §1.3). Bosun 은 우리 `sol_decision.serve` 로만 띄운다(Q1).
- Bosun 의 GGUF 등 양자화 변환본, Bosun-4B·Bosun-XS(Qwen3-Reranker 기반 yes/no 크로스인코더, "Introducing Bosun" 2026-06-11): v3.1 0.6B(decision token)와 다른 세대다. 문서 인용 때 섞지 않는다.
- stock vLLM 으로 Bosun 서빙: decision token 확률을 Kev wire 로 바꾸는 계층이 없다.
- 유료 hosted API·클라우드 GPU(ADR-010 승인 대상).

> [!success] 검증됨 (2026-10-20, Hugging Face API `api/models/*`·파일 원문. 확인 주체는 [분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) §1 세션)
> - 리비전 존재: `Hanno-Labs/bosun-v3.1-0.6b@5e78a37c…`(main), `Qwen/Qwen3-0.6B@c1899de…`(백업 `Qwen/Qwen3-4B-Instruct-2507@cdbee75f…` 도 존재 확인됨).
> - Bosun 파일 원문: `modeling_bosun.py`·`configuration_bosun.py`·`config.json`·`serving.json`·`manifest.json`·`adapter/adapter_config.json`. decision token 256개 `<|decision_000|>`~`<|decision_255|>`(id 151669~151924), `max_runtime_choices 255`, `null_token_index 255`, `prompt_schema: bosun-decision-prompt-v3-stable-slots`.
> - 공개 API: `BosunForDecision.from_pretrained(path, revision=…)`(`trust_remote_code=True`), `predict(*, state, instructions, candidates, decision_type="choice", seed=0, row_id="0") → {"probabilities": [...]}`(**`torch.inference_mode()` 안**), `decision_logits(*, input_ids, attention_mask) → [B, 256]`(no_grad 아님 → 학습용), `render_decision_prompt(...) → (content, presentation_order, candidate_to_slot)`. state 길이 제한 없음(`truncation=False`). 어댑터는 `PeftModel.from_pretrained(..., is_trainable=False)` 로 올라오므로 학습 때 LoRA 파라미터의 `requires_grad=True` 를 직접 켠다.
> - 공개 성능(DecisionBench 23,900행): acc 0.8118, ECE 0.0659. 후보 2개 0.946, 3개 0.983, 5개 0.953. 가장 약한 가족 `rubric_scoring_prioritization` 0.707(우리 `score` 문항과 가장 비슷).
> - Bosun **학습 코드는 공개되지 않았다**(모델 카드·Hanno GitHub 11개 저장소). 우리 trainer 를 만든다(§4.3).

> [!warning] 미검증 가정 (2026-10-20)
> - 리비전 `5e78a37c`(main) 와 Hanno 레지스트리 핀 `87cea31`(2026-09-22) 사이 6개 커밋은 메시지 기준 README·LICENSE·`.eval_results` 만이다(diff 는 보지 않았다). B2 에서 두 리비전의 `manifest.json` sha256 이 같은지 확인한다.
> - 회사 서버 사실(PaddleOCR 약 9,167 MiB, `.venv-bosun`, Bosun CPU 2-step 학습 성공, `datasets/decision/smoke.jsonl` 6건)과 회사 Qwen3.8-Flash-Next API(주소·키 별도 제공)는 **사용자 보고**다. B2 에서 `nvidia-smi`·`pip list`·`GET /v1/models` 기록으로 교차 확인한다.

### 2.2 받는 법과 무결성 확인

회사 GPU 서버는 밖에서 들어올 수 없다(ADR-025). 서버에서 밖으로(huggingface.co·pypi.org) 나갈 수 있는지는 확인하지 않았다(§7). 나갈 수 있으면 1안, 없으면 2안이다.

**1안: GPU 서버에서 직접 받는다**

```bash
export SOL_WORK=/data/www/ai_workspace/sol-radar     # SOL RADAR 전용 경로(2026-10-20 확인). /data 가용 약 1,011 GB
export HF_HOME=$SOL_WORK/hf                           # Bosun 어댑터·임베딩 + 백본 0.6B(크기 미확인, B2 에서 기록). 9B 두 개 기준이던 "100 GB" 는 해당 없음

# hf CLI 는 huggingface_hub 패키지에 있다(venv 의 hf). venv 에 아직 없으면 `uvx --from huggingface_hub hf download …`
hf download Hanno-Labs/bosun-v3.1-0.6b --revision 5e78a37c8d86860ebac9ef2d5327d6299498498e
hf download Qwen/Qwen3-0.6B            --revision c1899de289a04d12100db370d81485cdf75e47ca
# Qwen3-4B-Instruct-2507(cdbee75f…)은 백업이라 받지 않는다(2026-10-20 저녁 결정). 이미 받았으면 지우지 않아도 된다
```

**2안: 다른 기계에서 받아 반입한다.** 같은 명령을 외부망이 있는 기계에서 돌리고 `$HF_HOME/hub`(+ 파이썬 wheel 묶음 `uv pip download` 결과, `services/decision` 소스)를 GPU 서버로 옮긴다. 서버에서는 `export HF_HUB_OFFLINE=1` 로 캐시만 쓴다. `BosunForDecision.from_pretrained` 의 Hub 해석은 `huggingface_hub` 를 따르므로 `HF_HOME`·`HF_HUB_OFFLINE` 이 그대로 적용된다.

**무결성 확인**(받은 직후, 그리고 서빙·학습 기동 전. `infra/gpu/bosun-preflight.sh` 가 레지스트리 값과 대조한다)

```bash
snap=$HF_HOME/hub/models--Hanno-Labs--bosun-v3.1-0.6b/snapshots/5e78a37c8d86860ebac9ef2d5327d6299498498e   # 고정 커밋의 snapshot 만 쓴다
sha256sum "$snap/adapter/adapter_model.safetensors" "$snap/decision_embeddings.safetensors"
# 기대(manifest.json, 2026-10-20 Hugging Face API 확인):
#   adapter/adapter_model.safetensors 961d237bc60a88f133bc723dd3cbf1133f743a7fde673cee96d1171c67b425d5
#   decision_embeddings.safetensors   88f9e856054f78ac521ba0180052d25720c3786d1db4e80aa7a8ecf39be01188
# 백본 Qwen3-0.6B shard: 받은 뒤 sha256sum 결과를 docs/evidence/bosun-train-feasibility.md 에 기록한다(기대값은 아직 없다 — B2 에서 기록)
```

레지스트리(`services/ai/models/registry.yaml` 항목 `bosun-v3.1-0.6b`, main `1b68f9b`)의 `lora` 가 어댑터 sha256, `decision_embeddings_sha256` 이 임베딩 sha256 이다(계획 §5.3. 값은 §2.1 과 같다). `sol_decision.serve` 는 기동 때 패키지 `manifest.json` 의 sha256 과 파일을 대조하고 다르면 **기동을 거부**한다(계획 §5.1). 학습본 패키지(§4.3)도 같은 레이아웃·같은 대조다. 게이트웨이는 `GET /v1/models` 의 `run`·`base`·`lora` 로 레지스트리를 대조하고 sha256 은 검사하지 않으므로(운영자 몫, [[03-AI-PIPELINE|03]] §11) 이 대조를 빼지 않는다.

## 3. 학습 환경

### 3.1 GPU와 메모리

> [!success] 확인됨 (2026-10-20 오전, 사용자가 서버 `sol-NF5280M6` 셸에서 실행. 출력 전문은 [F1 기록](evidence/kev-train-feasibility.md) §0 — 당시 기록)
> NVIDIA A40 **3장**(각 46,068 MiB). 드라이버 580.173.02(CUDA 13.0), CUDA Toolkit 12.8, RAM 약 125 GiB(가용 약 54 GiB), `/data` 가용 약 1,011 GB. GPU 0(4,747 MiB 사용 중)·2(9,240 MiB 사용 중)는 회사 기존 서비스가 쓰고 있어 **쓰지 않는다**. GPU 1 은 당시 5 MiB 사용 중(Compute Capability 8.6)이었고, venv 안에서 `CUDA_VISIBLE_DEVICES=1` 로 torch 2.8.0+cu128 이 A40 을 `cuda:0` 으로 잡고 bf16 지원, 가용 44.16 GiB(총 44.42 GiB)를 확인했다.

> [!warning] 정정 (2026-10-20 오후, 사용자 보고. ADR-034 10번)
> GPU 1 은 **전용이 아니다**. 회사 PaddleOCR vLLM 서비스가 GPU 1 에서 약 **9,167 MiB** 를 쓰고 있다. 오전의 "5 MiB" 는 그 시점 스냅샷이다. 가용은 약 **36,900 MiB**(추정, PaddleOCR 피크 미확인). SOL RADAR 가 GPU 1 에 올리는 것은 `sol_decision` Bosun 서빙과 Bosun LoRA 학습·채점뿐이고 PaddleOCR 와 **공존**한다. 어떤 프로세스도 종료·이동하지 않는다. 이 보고는 B2 의 `nvidia-smi` 기록으로 교차 확인한다.

| 물리 GPU index(nvidia-smi) | 총 VRAM | 2026-10-20 사용량 | 정책 |
|---|---:|---:|---|
| 0 | 46,068 MiB | 4,747 MiB(오전) | 회사 기존 서비스. 프로세스 종료·모델 이동·설정 변경 금지 |
| 1 | 46,068 MiB | 오전 5 MiB(당시 기록) → **PaddleOCR 약 9,167 MiB**(오후, 사용자 보고) | **SOL RADAR Bosun 서빙·학습·채점, PaddleOCR 와 공유**. 기존 서비스 보호 최우선 |
| 2 | 46,068 MiB | 9,240 MiB(오전) | 회사 기존 서비스. 위와 같다 |

바로잡는 것: ① GPU 는 3장이고 학습에 쓸 수 있는 것은 그중 1장(공유)이다. 3장의 VRAM 을 합산해 보지 않고 다중 GPU 학습도 하지 않는다. ② 80 GB GPU·H100·H200 은 없다. ③ nvidia-smi 의 46,068 MiB 와 PyTorch 의 44.42 GiB 는 다른 수치다. ④ Qwen 은 회사 API 라 GPU 1 에 vLLM 을 띄우지 않는다(라우터 `/sol-radar/qwen`→8001 규칙은 백업으로 남는다). ⑤ 학습·서빙이 들어가는지는 F1 결과로만 확정한다.

메모리 계획은 아래다(**전부 추정**, F1 실측 전. 계획 §8). A40 에서 잰 값은 아직 없다.

| 상주·작업 | 추정 | 비고 |
|---|---|---|
| PaddleOCR vLLM(회사) | 약 9.2 GB | 건드리지 않음. 피크는 미확인(§6 물을 것) |
| `sol_decision.serve` Bosun bf16 서빙 | 약 1.5~3 GB | 6k 토큰 state 활성값 포함 |
| Bosun LoRA 학습(bf16, batch 1, 6k 토큰, gradient checkpointing) | 약 6~10 GB | F1 20 step 으로 실측(§4.2) |
| ~~vLLM Qwen3-4B·Qwen 4B QLoRA~~ | — | 철회(2026-10-20 저녁). Qwen 은 회사 API, GPU 1 에 올리지 않는다 |

- **GPU 1 공유**: 모든 학습·보정·채점 명령은 `export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1` 아래에서 돌린다. 프로세스 안에서 GPU 1 은 `cuda:0` 으로 보인다(정상). 이 변수는 **가시성만 제한하고 독점이 아니다**. `infra/gpu/bosun-preflight.sh`·`infra/gpu/bosun-f1.sh`(main `1b68f9b`)는 `CUDA_VISIBLE_DEVICES` 가 없으면 멈춘다. `CUDA_DEVICE_ORDER` 는 비어 있으면 스크립트가 `PCI_BUS_ID` 로 채우고, 다른 값이면 FAIL 이다. GPU 1 의 다른 프로세스(PaddleOCR 등)는 기록만 하고 FAIL 로 보지 않는다. 대신 회사의 공유 승인을 사용자가 확인했다는 뜻으로 `SOL_GPU_SHARE_APPROVED=1` 이 없으면 FAIL 이다(설계의 "미지 프로세스가 있으면 멈춘다" 대신 이 코드 동작이 정본이다. [[16-DECISIONS|16]] 미결정 29-4). 두 스크립트는 `kill`·`pkill`·`docker compose down` 을 쓰지 않는다. 여유 메모리 기준은 `SOL_REQUIRED_MIB`(기본 16,000 = 학습 추정 10,000 + 서빙 3,000 + 여유 3,000, 실측 뒤 갱신)이고, GPU 1 `memory.free` 가 이보다 작으면 FAIL 이다. `SOL_MIN_FREE_MIB` 는 선택인 추가 기준이다. Kev 스크립트의 40,000 MiB(전용 전제)는 쓰지 않는다.
- 추론 런타임 중 GPU 1 에 뜨는 우리 것은 `sol_decision.serve`(`:8009`)만이다(ADR-034 10번). 2026-10-20 기준 아직 띄우지 않았고, 기동은 사용자 승인 뒤 B2 에서 한다. 학습 시간대에 서빙을 내리지 않는 것이 기본 계획이다(위 합계 추정 약 17~22 GB). 합계가 가용을 넘으면 회사에 보고하고 사용자가 정한다 — 우리가 끄지 않는다.
- GPU 메모리는 두 값을 함께 적는다. trainer 가 남기는 `torch.cuda.max_memory_allocated()` 최대값과, `nvidia-smi -i 1 --query-gpu=memory.used --format=csv -l 1` 로 학습 내내 기록한 GPU 전체 최대값(PaddleOCR·서빙 포함, 안전 여유 판정 기준). `bosun-f1.sh` 가 nvidia-smi 값을 기록한다. torch 최대 메모리는 학습기가 `training_metrics.json` 의 `metrics.peakMemoryMb` 에 남긴다. 지금 `bosun-f1.sh` 의 summary 칸은 키 이름이 달라 `-` 로 나온다(코드 후속, [[16-DECISIONS|16]] 미결정 26-15).

### 3.2 Bosun 환경 (`.venv-bosun`)

venv 는 서버에 있다(`$SOL_WORK/.venv-bosun`, 사용자 보고. 경로·Python·torch 버전은 B2 에서 아래 명령으로 확인해 기록). **지우거나 다시 만들지 않는다.** torch 는 `2.8.0+cu128` 을 유지한다(2026-10-20 오전 `.venv-kev` 에서 확인한 빌드와 같은 값이어야 한다. 다르면 멈추고 보고). 이 venv 에서 회사가 Bosun 2-step CPU 학습을 성공했다(장난감 6건 `datasets/decision/smoke.jsonl`, 사용자 보고 — **파이프라인 증거**로만 쓰고 성능 주장에 쓰지 않는다. 그 코드는 저장소 밖이라 B1 학습기 `services/decision/src/sol_decision/train.py` 가 대체했다(`services/decision/docs/TRAINING.md`. 계획 §10 10번의 "반입 뒤 흡수"에서 바뀜). 결과 비교는 B2).

> [!warning] 미검증 가정 (2026-10-21)
> 의존성 범위는 `services/decision/pyproject.toml` 이 정했다(B1, main `1b68f9b`): 기본 `fastapi>=0.144.0`·`uvicorn>=0.54.0`·`pydantic>=2.11`·`pydantic-settings>=2.10`, 모델 extra `model` = `torch>=2.8`·`transformers>=4.57,<5`·`peft>=0.21`·`safetensors>=0.5`·`accelerate>=1.10`. `uv.lock` 은 torch 를 `2.14.1` 로 고정한다. 그래서 `services/decision/docs/TRAINING.md` 의 `uv sync --frozen --extra model` 은 이 절의 torch 2.8.0+cu128 유지와 맞지 않는다. B2 에서 아래 `uv pip install --dry-run` 결과로 **torch 가 바뀌지 않는지** 확인한 뒤 설치한다. 지금 venv 에 들어 있는 버전은 `pip list` 로 받아 §6 물을 것 3번에 쓴다. Bosun 은 `trust_remote_code=True` 와 PEFT 가 필요하다(계획 §1.1).

```bash
export SOL_WORK=/data/www/ai_workspace/sol-radar
source "$SOL_WORK/.venv-bosun/bin/activate"
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"   # 2.8.0+cu128 True 이어야 한다. 아니면 멈추고 보고
mkdir -p "$SOL_WORK/runs"
python -m pip list --format=freeze > "$SOL_WORK/runs/venv-bosun-freeze.txt"      # 현재 핀 목록(우리에게 보낸다)

# 우리 패키지 셋(sol-decision·sol-ai·sol-eval)을 --no-deps editable 로 올리고, 빠진 순수 파이썬 의존성만 따로 넣는다.
# torch·transformers·peft·safetensors·accelerate 는 venv 것을 그대로 쓴다(ed 확인 2026-10-21, 16 미결정 29-2. services/decision README 와 같은 원칙. hardening 7f3b528, main 36edfb6)
# sol_eval 은 services/ai/kev/·fixtures/ 를 소스 트리 경로로 읽으므로 wheel 이 아니라 저장소 체크아웃 + editable 이어야 한다
PY="$SOL_WORK/.venv-bosun/bin/python"
"$PY" --version                        # 3.12 이상(services/ai·services/ai/eval 의 requires-python). 아니면 멈추고 보고(별도 venv 는 사용자 결정)
export HF_HOME="$SOL_WORK/hf"                    # preflight 기본값과 같게
snap=$HF_HOME/hub/models--Hanno-Labs--bosun-v3.1-0.6b/snapshots/5e78a37c8d86860ebac9ef2d5327d6299498498e   # §2.2 와 같은 고정 snapshot. 4) 에서 쓴다
SOL_REPO="$SOL_WORK/sol-radar"; cd "$SOL_REPO"   # 저장소 체크아웃(services/decision·services/ai·services/ai/eval). 경로가 다르면 바꾼다. 아래 스크립트도 이 위치 기준이다
# 1) 계획만 본다(설치 안 함). torch·transformers·peft·safetensors·accelerate 줄이 있으면 멈추고 보고
uv pip install --python "$PY" --dry-run --no-deps -e services/decision -e services/ai -e services/ai/eval 2>&1 | tee "$SOL_WORK/runs/install-plan-bosun.txt"
# 2) 우리 패키지 셋을 --no-deps 로 올린다(torch 계열을 건드리지 않는다)
uv pip install --python "$PY" --no-deps -e services/decision -e services/ai -e services/ai/eval
# 3) 빠진 순수 파이썬 의존성만 넣는다. 설치 전 dry-run 에 torch 계열 줄이 없어야 한다
uv pip check --python "$PY"            # 여기서는 빠진 의존성 때문에 실패가 정상이다. torch 계열 충돌 줄만 본다
uv pip install --python "$PY" --dry-run "pydantic>=2.11" "pydantic-settings>=2.16" "pyyaml>=6.0.3" "jsonschema>=4.26" "rapidfuzz>=3.14.6" "httpx>=0.28.1" "httpcore>=1.0.9,<2" "fastapi>=0.144" "uvicorn>=0.54" 2>&1 | tee "$SOL_WORK/runs/install-plan-deps.txt"
if grep -qE '^\s*[-+] (torch|transformers|peft|safetensors|accelerate)==' "$SOL_WORK/runs/install-plan-deps.txt"; then
  echo "바뀐다. 설치하지 말고 보고"
else
  uv pip install --python "$PY" "pydantic>=2.11" "pydantic-settings>=2.16" "pyyaml>=6.0.3" "jsonschema>=4.26" "rapidfuzz>=3.14.6" "httpx>=0.28.1" "httpcore>=1.0.9,<2" "fastapi>=0.144" "uvicorn>=0.54"
fi
uv pip check --python "$PY"            # 충돌 0
"$PY" -c "import torch, transformers, peft, safetensors, sol_decision, sol_eval; print(torch.__version__, transformers.__version__, peft.__version__, safetensors.__version__)"   # torch 2.8.0+cu128 그대로
# 4) 동작 확인(네트워크·GPU 없이)
"$PY" -m sol_eval --help
"$PY" -c "from pathlib import Path; from sol_eval.package_check import verify_package_dir; verify_package_dir(Path('$snap')); print('package ok')"   # $snap 은 이 블록 머리에서 정했다(§2.2 와 같다). package_check 는 main 36edfb6(hardening)에 있다

# 5) F1-A: GPU 1 매핑·bf16·snapshot sha256·데이터 형식까지 한 번에(§4.2). SOL_GPU_SHARE_APPROVED=1 은 회사 공유 승인을 사용자가 확인한 뒤에만 준다
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1
SOL_GPU_SHARE_APPROVED=1 bash infra/gpu/bosun-preflight.sh
```

- `uv` 가 서버에 있는지는 미확인이다. 없으면 `"$SOL_WORK/.venv-bosun/bin/pip" install --dry-run …`·`install`·`check` 로 같은 순서를 밟는다.
- 채점(§4.4)에는 `services/ai`(sol-ai)와 `services/ai/eval`(sol-eval)이 같은 `.venv-bosun` 에 있어야 한다. `sol-eval` 은 `sol-ai` 의 uv workspace 멤버이고(`services/ai/pyproject.toml` `members = ["eval"]`), `services/ai` 의 `uv run` 환경에는 torch·transformers 가 없어 실모델 채점을 못 한다. 위 1)~4)가 셋을 한 번에 올린다([[16-DECISIONS|16]] 미결정 29-2, 2026-10-21 ed 초안. 서버 명령은 회사·사용자가 친다).
- 빌드 백엔드는 `uv_build` 다. editable 설치 때 빌드 격리로 `uv_build` 를 내려받으므로, 서버에 외부망이 없으면 그 wheel 을 함께 반입한다.
- 설치가 torch 를 다른 빌드(예: cu126·CPU)로 바꾸려 하면 강행하지 않는다. 원인(인덱스·제약)과 대안을 보고한다.
- 서빙 기동(사용자 승인 뒤, B2. 계획 §5.1):

```bash
# DECISION_API_KEY 값은 노트북 KEV_API_KEY 와 같은 값. 셸 변수로만 넘기고 파일·로그에 적지 않는다
export HF_HUB_OFFLINE=1
DECISION_API_KEY="$DECISION_API_KEY" python -m sol_decision.serve --package "$snap" --host 127.0.0.1 --port 8009
# 확인(서버 안): run 이 Hanno-Labs/bosun-v3.1-0.6b@5e78a37c… 이어야 한다
curl -s -H "Authorization: Bearer $DECISION_API_KEY" http://127.0.0.1:8009/v1/models
```

`sol_decision.serve` 계약(계획 §5.1, main `1b68f9b`): `POST /v1/systemone` 은 게이트웨이의 Kev wire 요청을 받아 **Kev wire 응답**(`responses`·`usage`·`latency_ms`, 헤더 `x-typesafe-request-id`)을 낸다. `GET /v1/models` 는 `{"object":"list","data":[{"id":"bosun-v3.1-0.6b","object":"model","run":"Hanno-Labs/bosun-v3.1-0.6b@5e78a37c","base":"Qwen/Qwen3-0.6B@c1899de2","lora":"<어댑터 sha256>","revision":"5e78a37c…","decision_embeddings_sha256":"<임베딩 sha256>","temperature":null,"questionTypes":["choice","score","noul"]}]}`(`tests/test_models_endpoint.py`). `GET /health` 는 `{status, model, backend, device, loadedAt}`. 인증 없으면 401. `127.0.0.1` 만 바인딩, 요청 본문 128 KiB(413)·state 24,000자와 한글 state 거절(422)·대기열 `DECISION_MAX_QUEUE`(기본 4, 503)·마감 `DECISION_TIMEOUT_MS`(504) 상한(hardening main `36edfb6`, [[03-AI-PIPELINE|03]] §5.3), 질문 ≤ 24, 후보 ≤ 255. 질문 타입 변환은 §4.1 표와 같은 함수다(서빙·학습 공유).

### 3.3 Qwen 환경: 불필요(백업)

Qwen 은 회사가 운영하는 vLLM API(`Qwen/Qwen3.8-Flash-Next`)를 쓰므로 GPU 서버에 우리 Qwen 런타임·학습 환경을 만들지 않는다(2026-10-20 저녁 결정). `.venv-qwen`(사용자 보고로 존재)과 Qwen 4B 다운로드 작업은 **중단**한다 — 지우지 않고 백업으로 둔다. 회사 측 확인은 키 전달과 아래 한 줄이다(주소·키 이름의 정본은 [[03-AI-PIPELINE|03]]·[[10-DEPLOYMENT|10]]. 게이트웨이가 `QWEN_BASE_URL` 끝의 `/v1` 을 떼고 `/v1/models`·`/v1/chat/completions` 를 붙인다(`settings.normalize_qwen_base_url`, main `1b68f9b`)).

```bash
# 노트북(우리) 또는 회사. 키 값은 셸 변수로만. id 가 Qwen/Qwen3.8-Flash-Next 이어야 레지스트리 대조가 통과한다
curl -s -H "Authorization: Bearer $QWEN_API_KEY" "$QWEN_BASE_URL/models"   # 값이 /v1 로 끝나므로(https://acropolissg.com/vllm/v1) /models 만 붙인다
```

회사 vLLM 이 guided JSON(`response_format: json_schema`, G4)과 E3 용 `prompt_logprobs` 를 지원하는지, 호출 한도·추가 인증·지연(`AI_TIMEOUT_MS` 60000 안)은 **미검증**이다(B2, §7).

## 4. Bosun v3.1 0.6B LoRA 이어 학습 ([[16-DECISIONS|ADR-034]] 7번)

순서: B3 평가셋·학습셋 번들·요청서 → **F1** 메모리·step 시간 smoke → **F2** 학습 → **F3** 보정·E4·E1' 평가 → 결과 반영. 일정은 [[23-WEEKEND-FINETUNE|23]] §1(ADR-034 12번)이 정본이다.

### 4.1 학습 데이터: 무엇을 학습하나

**질문 하나 = 레코드 하나**다. Kev 는 "state 1 + 질문 N" 을 한 요청으로 받았지만 Bosun 은 질문마다 forward 1회다. 변환 규칙은 학습(`trainer/prompting.py`)과 서빙(`backend.py` → `model.predict()`)이 **같은 Bosun 패키지 함수** `render_decision_prompt`(`modeling_bosun.py`)를 쓴다(같은지는 `sol_decision.parity` 가 본다, 계획 §4.1). 학습 레코드를 만드는 `sol_eval/bosun_records.py`의 후보 목록(`candidates_for`)은 서버 `contract.py`와 따로 구현돼 있어, F1 학습 전에 교차 시험을 더한다([[16-DECISIONS|16]] 미결정 26-12).

| v0.2 타입 | 후보 `candidates` | gold | 응답(Kev wire) | 후처리 |
|---|---|---|---|---|
| `choice`(`recommendation`, `req.{itemId}.status`) | criteria 키 순서대로 `{id: key, label: key, description: criteria[key]}`(3개) | `candidateId = label`, `probabilities` one-hot(또는 `Label.target` soft) | `{choice: argmax, probabilities{key}, confidence: max}` | `req.*` 는 argmax, 동률은 NEEDS_REVIEW > NOT_SATISFIED > SATISFIED 그대로 |
| `score`(`fit`, `techFit`, `perfRelevance`) | `{id: "0".."4", label: legend[i]}` | one-hot(사람 라벨만) | `{score: Σ i·p_i, probabilities{"0".."4"}, confidence: max, legend}` | `kev_wire` 의 ±0.05 검사 통과(서버가 같은 식으로 계산) |
| `noul`(`mandatoryRisk`, `needsHumanReview`, `risk.*`) | `{id:"true", label:"true", description: criteria.true or "yes"}`, `{id:"false", …}` | true → `[1,0]` | `{noul: P(true)}` | τ 0.7 비교 불변 |

레코드 형식 `bosun/{split}.en.jsonl`(한 줄 = 질문 하나. `EvalItem`·`Label` 필드를 보존, 계획 §4.2):

```json
{"rowId":"sha256(itemId:qid)","itemId":"…","clusterId":"…","split":"train",
 "bid":{"source":"g2b","noticeId":"…","revisionId":"…"},"companyVariantId":"…",
 "qid":"req.requiredSkills[0].status","questionType":"choice",
 "instructions":"<v0.2.json 원문>",
 "candidates":[{"id":"SATISFIED","label":"SATISFIED","description":"<criteria>"},
               {"id":"NOT_SATISFIED","label":"NOT_SATISFIED","description":"<criteria>"},
               {"id":"NEEDS_REVIEW","label":"NEEDS_REVIEW","description":"<criteria>"}],
 "state":"NOTICE\n- stage: NOTICE; agency: (Korean public agency); …\n\nCOMPANY (profile revision 2)\n- …",
 "stateHash":"…","stateTemplate":"en.v0.2","questionSet":"kev-qs/v0.2",
 "gold":{"candidateId":"NEEDS_REVIEW","probabilities":[0,0,1]},
 "labelSource":"CONSTRUCTED","reason":"INSUFFICIENT_EVIDENCE",
 "noticeEvidence":[…],"companyEvidence":[…]}
```

- `instructions` 는 `services/ai/kev/question-sets/v0.2.json` **원문 그대로**(2026-10-20 확정, [[16-DECISIONS|ADR-033]] E10 유지). `state` 는 `en.v0.2` 텍스트 문자열 그대로 Bosun `state` 에 넣는다(Bosun 은 `state: Any` 를 canonical JSON 으로 직렬화한다). 구조화 JSON state 는 후속 실험(§7).
- 후보 제시 순서는 Bosun 이 `seed:row_id` 로 섞는다. 서빙은 `seed=0`, `row_id = sha256(qid + stateHash)`(결정적). 순서 민감도는 **seed 0~5** 6회로 잰다(21 §4.3 `argmax_stable`·`spread` 유지).

| 구성 | 어디서 오나 | 규칙 |
|---|---|---|
| 공고 | `live` 모드로 수집한 실제 나라장터 정보화사업 공고·RFP(`is_demo=false`, 첨부 파싱 성공). Supabase·MinIO 에 있다 | 개인정보 마스킹(21 §3.6). fixture `FX-01`~`FX-20` 은 넣지 않는다(회귀용) |
| 추출 | train 은 회사 Qwen3.8-Flash-Next API `/extract` 출력(B2 에서 키 확인 뒤), dev·test 는 사람이 확정한 gold(21 §3.7) | 인용 검증 통과 값만 `KNOWN` |
| 회사 | 가상 기업 원형 6개(`fixtures/eval/companies/*.json`, 21 §3.2)와 항목별 변형(21 §3.3) | 실제 회사 이름·실적은 쓰지 않는다. 원형 하나는 train 에서 뺀다(처음 보는 기업 지표) |
| state | `services/ai/kev` 의 state 빌더(서빙과 **같은 코드**), 템플릿 `en.v0.2` | `ko` state 는 E2 평가 전용이다. 학습은 `en` 만(ADR-012 규칙 유지) |
| 질문 | `v0.2.json` 의 `instructions`·`criteria` **원문 그대로** | 서빙과 문구가 다르면 학습 효과가 줄어든다 |

**어떤 질문에 어떤 라벨을 붙이나**(train. 계획 §4.2, 이전 판과 같다)

| 질문 | 라벨 출처 | train 에 넣나 |
|---|---|---|
| `req.{itemId}.status`(`requiredSkills`·`pastPerformance` 분야·`staffing` 역할·사전 코드 없는 `qualifications`) | `CONSTRUCTED`: 같은 공고에 회사 변형 셋(충족·명시적 미충족·정보 부족)을 만들어 라벨을 구성으로 정한다(21 §3.3) | 넣는다. 세 값이 각각 1/3 가까이 되게 변형을 만든다 |
| 같은 항목 중 규칙이 판정하는 명시 조건(금액·건수·사전 코드 자격) | `RULE_SILVER`: 규칙 엔진 결과 | 넣는다(train 만). test 에는 쓰지 않는다 |
| `risk.techGap`·`risk.scale`·`risk.staffing`·`risk.schedule` | 변형이 그 조건을 직접 바꾼 경우만 `CONSTRUCTED` | 구성으로 정해지는 것만 |
| `techFit`·`perfRelevance`·동의어·상위개념 대응 | `HUMAN` 만 정답이 된다 | 사람 라벨이 있는 것만. 해커톤 사람 라벨은 test·dev 용이라 train 에는 넣지 않는다(학습하지 않은 질문은 공개 Bosun 행동을 유지한다) |
| v0.1 질문(`mandatoryRisk`·`recommendation`·`needsHumanReview`·`fit`) | — | 넣지 않는다. `recommendation` 은 참고 질문으로 서빙에 남긴다(Q4) |

- 정보 부족을 미충족으로 배우지 않게 하는 것이 핵심이다. "정보 부족(회사)" 변형은 증빙·필드를 지운 것이고 라벨은 `NEEDS_REVIEW` 다(21 §2). 각 선택지가 정답인 비율이 5% 아래로 내려가면 안 된다.
- 유료 외부 모델(Claude 등)로 라벨 초안을 만들지 않는다(ADR-010 승인 전). 구성·규칙·사람 라벨만 쓴다.
- 회사 서버의 `datasets/decision/smoke.jsonl` 6건은 **기능 검증 데이터**다(ADR-034 7번). 학습·평가 데이터에 넣지 않는다.

**규모와 분할**

| 분할 | 크기 | 쓰임 |
|---|---|---|
| train | 질문 레코드 1,000행 이상(계획 §9 B3) | F2 학습 |
| dev | 10 사업(21 §3.5) | F3 온도 보정. 학습에 넣지 않는다 |
| test | 20 사업 | E1'·E4 비교. 학습·보정에 쓰지 않는다 |

- 사업 클러스터 단위 분할과 유사 문서 병합(21 §3.6)으로 같은 사업이 두 분할에 걸치지 않게 한다. train∩(dev∪test) 클러스터 0건을 번들 manifest 에 적는다(`python -m sol_eval leakage --bundle`, main `1b68f9b`).
- 같은 `(stateHash, qid)` 에 서로 다른 gold 가 붙은 레코드는 0건이어야 한다. 변형끼리 state 가 한 줄 이상 다른지 내보낼 때 검사한다.

**길이.** Bosun 은 state 를 잘라내지 않는다(`truncation=False`, 백본 ctx 40,960). 우리 state 최대 6,000 토큰([[03-AI-PIPELINE|03]] §5.6)은 들어간다. 그래서 Kev 의 `--max_state`·`dropped` 검사는 없다. 학습기는 state 를 자르지 않고 `--max-state-tokens`(기본 6,144) 를 넘는 레코드를 건너뛰며 그 수를 `training_metrics.json` 의 `metrics.skippedOverLength`(패키지 `manifest.json` 에도 있다)에 남긴다(main `1b68f9b`). 대신 prefill 메모리·시간이 길이에 비례하므로 번들 manifest 에 train 레코드 state 토큰 최대값(Bosun 패키지 토크나이저 기준)을 적고 F1 에서 긴 레코드로 메모리를 잰다.

**번들**: `sol-dataset-{version}/` 폴더 = `manifest.json`(버전·git commit·질문 세트 `kev-qs/v0.2`·state 템플릿 `en.v0.2`·마스킹 버전·분할별 레코드 수·질문별·선택지별 분포(각 ≥ 5%)·파일별 sha256·train state 토큰 최대값·클러스터 교차 0건) + `bosun/train.en.jsonl`·`bosun/dev.en.jsonl`·`bosun/test.en.jsonl` + 이 문서의 해당 절. `kev/`·`qwen/` 디렉터리는 만들지 않는다. 만드는 명령은 `python -m sol_eval export --format bosun`(main `1b68f9b`)이고, 출력은 폴더(`bosun/{split}.en.jsonl`·index·`manifest.json`, 기본 `datasets/sol-eval/<version>/`)다. 회사에는 이 폴더를 통째로 `sol-dataset-v0.1/` 이름으로 보내고(또는 export `--out` 으로 그 이름을 준다. 서버 스크립트 기본 경로가 `$SOL_WORK/sol-dataset-v0.1/` 다) `manifest.json` 의 파일별 sha256 으로 대조한다. `manifest.json` 의 파일 목록은 폴더 전체를 훑어 만든다. tar 로 묶지 않는다([[16-DECISIONS|16]] 미결정 29-3).

### 4.2 F1 메모리·step 시간 smoke

F1 은 세 단계다(A 환경 사전 검증 → B 20 step smoke → D 측정·합격 판정). 실행은 `infra/gpu/bosun-preflight.sh`(F1-A)와 `infra/gpu/bosun-f1.sh`(F1-B)로 하고, 결과는 `docs/evidence/bosun-train-feasibility.md` 에 옮긴다. 두 스크립트는 main `1b68f9b`(B1)에 있다. Kev 용 `kev-preflight.sh`·`kev-f1.sh` 는 보존하되 쓰지 않는다. 모든 단계는 물리 GPU 1(공유)만 쓴다(§3.1). **GPU 실행은 사용자 승인 뒤**다. 2026-10-21 기준 전부 **미실행**이다.

**출발 체크포인트는 검증한 로컬 snapshot 으로 준다.** `bosun-preflight.sh` 가 `$snap`(§2.2)의 `adapter/adapter_model.safetensors`·`decision_embeddings.safetensors` sha256 을 §2.2 값과 대조해 다르거나 없으면 **FAIL**. `bosun-f1.sh`·F2·채점은 그 **로컬 디렉터리**를 `--package` 에 주고 `HF_HUB_OFFLINE=1` 로 돌린다. 채점(`bosun_score`)은 hardening(`fix/decision-hardening`, main `36edfb6`) 뒤 패키지를 `from_pretrained` 전에 `manifest.json` 의 파일 전부·최상위 `*.py`·`config.json` 과 대조한다(`sol_eval.package_check`, 위반이면 exit 2). 데이터 파일 sha256 은 `report.json` 에 기록만 한다(번들 manifest 대조는 해커톤 뒤, 미결정 26-17). 그래서 §4.4 블록 첫 줄의 `sha256sum` 과 `report.json` 대조를 사람이 한다. 처음부터 새 LoRA 를 만드는 변경은 하지 않는다(공개 LoRA 이어 학습, ADR-034 7번).

**F1-A 환경 사전 검증** — `bash infra/gpu/bosun-preflight.sh`(§3.2 끝). 확인 항목: `CUDA_VISIBLE_DEVICES=1`·`CUDA_DEVICE_ORDER=PCI_BUS_ID`, nvidia-smi GPU 1 uuid 와 `cuda:0` uuid 일치, GPU 1 프로세스 목록(기록만, FAIL 아님)·회사 공유 승인 `SOL_GPU_SHARE_APPROVED=1`(없으면 FAIL)·여유 메모리 ≥ `SOL_REQUIRED_MIB`(기본 16,000), torch 2.8.0+cu128(정확히 일치, `SOL_EXPECT_TORCH`)·CUDA·bf16, transformers·peft·safetensors 설치 여부(버전은 기록만), Bosun snapshot 파일 sha256(§2.2 값)·백본 캐시(없으면 FAIL), CPU 로 Bosun 로드·LoRA 텐서 392·파라미터 10,092,544, `sol_decision` import 와 `sol_decision.train`·`sol_decision.parity` CLI(CLI 확인 실패는 FAIL 이 아니라 경고), 학습 데이터 형식(`SOL_TRAIN_DATA` 의 train 파일 하나. 없으면 경고. 각 줄 §4.1 필수 필드)·라벨 비율·같은 `(stateHash, qid)` 의 gold 충돌·state 토큰 분포와 `--max-state-tokens` 후보별 초과 건수, 디스크. 여유 메모리 기준 `SOL_REQUIRED_MIB` 는 학습·서빙 추정과 예비분의 합이라 서빙 공존이 전제다. 스크립트 끝 요약의 "서빙과 동시에 돌리지 않는다" 한 줄은 코드와 반대인 문구다(문구 수정은 ed, [[16-DECISIONS|16]] 미결정 26-18). 통과하면 `runs/bosun-preflight-ok` 를 남기고 `bosun-f1.sh` 가 그것을 요구한다. 로그는 `runs/bosun-preflight-<시각>.log` 다. `predict()` 와 `decision_logits()` 경로의 확률 동일성(계획 §10 4번)은 preflight 가 돌리지 않는다. 학습 전에 `python -m sol_decision.parity --package "$snap" --data "$SOL_WORK/sol-dataset-v0.1/bosun/test.en.jsonl" --n 8 --device cuda --bf16` 을 GPU 1(`CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1`)에서 따로 통과시키고(서빙과 같은 장치·dtype. Bosun 은 회사 A40 GPU 1 에서 돈다, 2026-10-21 사용자 확인, [[16-DECISIONS|16]] 미결정 26-20 닫음. 실행은 ADR-034 10번 승인 절차를 따른다. 넘으면 exit 1, 학습 금지. `services/decision/docs/TRAINING.md`), `bosun-f1.sh` 는 학습 뒤 저장한 패키지로 같은 검사를 한다(데이터는 test 가 아니라 `SOL_TRAIN_DATA` 앞 8건).

**F1-B 20 step smoke** — `bosun-f1.sh`(기본 `--max-steps 20`)가 아래를 돌리고 `nvidia-smi -i 1` 1초 간격 기록(`runs/bosun-f1-<tag>.nvidia-smi.csv`)을 함께 남긴다. 기본 후보: bf16, gradient checkpointing, batch 1, accum 8(Kev 레시피에서 가져온 출발값. Bosun 전용 값은 F1·dev 로 정한다).

```bash
export SOL_WORK=/data/www/ai_workspace/sol-radar
cd "$SOL_WORK/sol-radar"                                    # 저장소 체크아웃(스크립트는 저장소 루트 기준, §3.2)
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1    # 물리 GPU 1 → 프로세스 안 cuda:0. HF_HUB_OFFLINE=1 은 스크립트가 켠다
# 승인 둘 다 있어야 시작한다: 회사 GPU 공유 승인(SOL_GPU_SHARE_APPROVED), 사용자의 GPU 학습 승인(SOL_TRAIN_APPROVED)
# 패키지는 $HF_HOME 의 고정 snapshot, 데이터는 SOL_TRAIN_DATA(기본 $SOL_WORK/sol-dataset-v0.1/bosun/train.en.jsonl),
# 출력은 $SOL_WORK/runs/bosun-f1-<tag>(기본 tag b<B>a<A>-ms<N>. N 은 `--max-state-tokens`, 예 `b1a8-ms6144`). 이미 있으면 덮어쓰지 않고 멈춘다(--tag 로 이름을 바꾼다)
SOL_GPU_SHARE_APPROVED=1 SOL_TRAIN_APPROVED=1 bash infra/gpu/bosun-f1.sh                       # 격자 1: batch 1 · accum 8(기본)
SOL_GPU_SHARE_APPROVED=1 SOL_TRAIN_APPROVED=1 bash infra/gpu/bosun-f1.sh --batch 2 --accum 4   # 격자 2: 앞 칸 PASS 뒤에만
```

격자(앞 칸 PASS 때만 다음 칸. OOM 이면 더 큰 값을 시도하지 않는다. Kev 의 `--max_state` 격자는 없다. 학습기는 state 를 자르지 않고 `--max-state-tokens`(기본 6,144)를 넘는 레코드를 건너뛴다):

| 순서 | 값 | 통과 기준 |
|---|---|---|
| 1 | batch 1, accum 8 | OOM 없음, 20 step 완료, 우리 증가분 최대 ≤ 메모리 예산(F1-D), 패키지 저장·재로딩 parity |
| 2 | batch 2, accum 4(속도) | 같다 |
| 3(선택) | batch 4, accum 2 | 같다. 들어가면 F2 에 쓴다 |

**F1-D 측정과 합격 조건** — 칸마다 `bosun-f1.sh` 가 `runs/<run>.summary.md` 와 `runs/f1-results.md` 에 적는다: 물리 GPU index(+uuid), PyTorch·transformers·peft 버전, `sol_decision` git commit, Bosun snapshot 리비전·어댑터 sha256, GPU 최대 메모리 두 값(`torch.cuda.max_memory_allocated`, nvidia-smi `memory.used` 전체 최대 — PaddleOCR·서빙 포함), 평균 step 시간(wall), 학습된 레코드 수(torch 최대 메모리·step 시간·레코드 수는 지금 파서 키가 달라 `-`·로딩 포함 wall 로 나온다. `training_metrics.json` 의 `metrics` 를 직접 본다, 미결정 26-15), OOM 여부, 패키지 저장 여부(어댑터 sha256)·재로딩 뒤 `predict` 동작, 로그 경로. 합격(`bosun-f1.sh` 의 PASS, main `1b68f9b`)은 다음 전부다: 학습기 exit 0 · OOM 없음 · 지정 step 완료 · 패키지 저장(`manifest.json`·어댑터·임베딩·`config.json`) · decision 임베딩이 공개본과 같음(동결) · 우리 증가분 최대(학습 중 GPU 전체 `memory.used` 최대 − 시작 직전 used) ≤ 메모리 예산 · nvidia-smi 기록 1줄 이상 · 재로딩 parity(`python -m sol_decision.parity --n 8`) exit 0(`--no-parity` 면 경고만 남기고 PASS 가 날 수 있으므로 F1 에서는 쓰지 않는다. step 시간을 로그에서 못 읽으면 step 조건은 건너뛴다). 메모리 예산 기본값은 시작 직전 `memory.free` − `SOL_RESERVE_MIB`(3,000)이고 `SOL_MEM_BUDGET_MIB` 로 바꿀 수 있다. 공유 상태 기준이라 Kev 판의 41,000 MiB(전용 전제)는 쓰지 않는다. **20 step PASS 만으로 F2 준비 완료라고 적지 않는다.** 21 §7 의 데이터 보고 항목(클러스터 수·변형 수·질문 수·라벨 출처 비율·의미 판단 HUMAN 수·요구사항 유형 분포)도 F2 전에 채운다.

F1 이 전부 실패하면 이 순서로 검토하고 결과를 사용자에게 보고한다. ①·② 는 같은 모델·같은 LoRA 구조 안의 조정이라 바로 해 본다. ③ 은 멈추고 보고하는 단계이고 그다음은 사람이 정한다. ④ 는 **사용자 승인 대상**이다. 어느 단계도 자동으로 넘어가지 않는다.

① 불필요하게 긴 state 제거·구조 개선(`pastPerformance` 상한) ② batch 1·accum 늘리기·gradient checkpointing 확인 ③ 그래도 GPU 1 메모리가 넘치면 멈추고 회사에 보고한다. 학습과 `sol_decision.serve`(8009)는 공존이 기본이고 우리 절차로 8009 를 내리지 않는다 — 어떤 프로세스도 종료·이동하지 않는다([[10-DEPLOYMENT|10]] GPU 절 "추론 런타임과의 관계", ADR-034 10번). 8009 를 내릴지·언제 내릴지는 사람이 정하고, 그 결정으로 서빙이 멈추는 시간에는 S-LIVE 리허설을 잡지 않는다. PaddleOCR 는 대상이 아니다 ④ 다중 GPU·클라우드 GPU 임대(ADR-010)·GPU 0·2 사용은 모두 **사용자 승인 대상**이고, GPU 0·2 는 어떤 경우에도 쓰지 않는다. Kev-4B 전환 같은 모델 변경 경로는 이 문서에 없다.

같은 F1 시간에 F3 보정·채점 경로(§4.4)도 20 step 패키지와 dev 로 한 번 돌려 `bosun_score`·`calibrate` 출력이 읽히는지 확인한다.

### 4.3 F2 학습

F1 을 통과한 설정만 쓴다. batch·accum 은 F1-D 의 PASS 칸 값이다. F1 값과 다르게 바꾸면 그 근거를 `MODEL_CARD.md` 와 `docs/evidence/bosun-train-feasibility.md` 에 적는다. 물리 GPU 1(공유)만 쓴다. `sol_decision.train`(main `1b68f9b`)은 계획 §4.2 를 따른다(상세는 `services/decision/docs/TRAINING.md`):

- **loader**: 패키지 `manifest.json` sha256 을 대조한 뒤 `AutoModelForCausalLM.from_pretrained(<snapshot>, trust_remote_code=True, local_files_only=True)` 로 올리고, LoRA 파라미터(392 텐서·10,092,544)만 학습한다. 집계가 다르면 중단한다. decision token 임베딩(입·출력 256행)·백본·토크나이저는 **동결**(초기 단계, ADR-034 7번).
- **손실**: `render_decision_prompt(...)` → (content, presentation_order, candidate_to_slot) → `decision_logits(input_ids, attention_mask)[:, :K]`(K = 후보 수)에 CE(one-hot) 또는 soft-CE(`gold.probabilities`). 에폭마다 `seed = --seed + epoch` 로 제시 순서를 바꿔 slot 편향을 막는다. **왼쪽 패딩 필수**(`decision_logits` 가 마지막 열 attention 1 요구). `predict()` 는 `inference_mode` 라 학습에 쓰지 않는다.
- **저장**: `runs/bosun-sol-lora-v0.1/` 에 HF 레이아웃 그대로(`config.json`·`adapter/`·`decision_embeddings.safetensors`(복사, 변경 없음)·`tokenizer/`·`serving.json`·`manifest.json` 에 파일 sha256) + `training_metrics.json`·`MODEL_CARD.md`. `--verify-reload` 면 저장 직후 다시 올려 `predict` 1회를 확인한다.

```bash
export SOL_WORK=/data/www/ai_workspace/sol-radar
cd "$SOL_WORK/sol-radar"                                           # 저장소 체크아웃(§3.2)
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1 HF_HUB_OFFLINE=1
SOL_GPU_SHARE_APPROVED=1 bash infra/gpu/bosun-preflight.sh          # 다시 통과해야 시작(GPU 1 점유·데이터·캐시)
nvidia-smi -i 1 --query-gpu=timestamp,memory.used --format=csv -l 5 > "$SOL_WORK/runs/bosun-sol-lora-v0.1.nvidia-smi.csv" &
SAMPLER=$!                                                          # 끝나면 이 PID 만 멈춘다(kill "$SAMPLER")
# 학습기 기본값은 --lr 1e-4 --epochs 1 --batch 1 --accum 8 이다. 에폭·lr 은 F1 결과·dev 로 정한다(이 문서는 값을 정하지 않는다)
python -m sol_decision.train \
  --package "$snap" \
  --data "$SOL_WORK/sol-dataset-v0.1/bosun/train.en.jsonl" \
  --out "$SOL_WORK/runs/bosun-sol-lora-v0.1" --seed 0 \
  --epochs <F1·dev 로 정함> --batch <F1 PASS 값> --accum <F1 PASS 값> \
  --device cuda --bf16 --grad-checkpointing --verify-reload 2>&1 | tee "$SOL_WORK/runs/bosun-sol-lora-v0.1.train.log"
```

- 예상 시간은 F1 의 step 시간 × F2 step 수(train 레코드 / 유효 배치 × 에폭)로 재추정한다. **실측 전 미확정**이다.
- 받아들이기 전 확인: loss 가 발산하지 않음, 패키지 재로딩 뒤 `predict` 동작, `manifest.json` sha256 과 파일 일치.
- 학습마다 `--out` 이름을 새로 짓는다(`v0.2`, `v0.3`). 덮어쓰지 않는다.
- 레지스트리 항목 `bosun-sol-lora-v0.1`(`kind: decision`, `init_from: bosun-v3.1-0.6b`)은 사용자 승인 전까지 `status: backup` 으로 둔다(허용값은 `active`·`retired`·`backup` 뿐이고 그 밖의 값은 게이트웨이 기동을 거부한다. 결정 모델은 `KEV_MODEL_ID` + `status: active` 로 고르고, `default` 는 qwen 항목에만 효과가 있다. 계획 §5.3).

### 4.4 F3 보정과 평가 (E4 · E1')

**보정(dev 분할).** 온도는 dev 로만 맞춘다. test 로 맞추지 않는다. `python -m sol_eval bosun_score` 로 dev 를 채점해 `predictions.jsonl` 을 만들고, `python -m sol_decision.trainer.calibrate` 가 그 예측으로 온도 1개를 NLL 최소화(황금분할)로 맞춰 NLL·Brier·ECE 전후를 `calibration.json` 에 적는다(main `1b68f9b`, 아래 명령). 보정은 기록용이고 서빙에 적용하지 않는다. calibrate 는 `MODEL_CARD.md` 를 고치지 않는다(학습기가 "보정: 미적용"으로 써 둔다). 방법은 `calibration.json` 의 `method` 를 보고 사람이 `MODEL_CARD.md` 에 적는다.

**평가.** E4 는 **E1'(공개 Bosun v3.1 0.6B zero-shot)** 과 같은 test 분할·같은 데이터셋 버전·같은 seed 집합에서 비교한다(21 §4.2, Q5). Kev-9B 와의 비교는 범위 밖이다. E1'↔E2 언어 짝 비교도 같은 오프라인 `bosun_score` 로 한다(E2 는 E1' 레코드 형식에 state 만 한국어, 세부는 [[16-DECISIONS|16]] 미결정 29-6 ed 결정, 코드 없음. 29-1). 지금 `compare` 는 두 run 의 데이터 sha256 이 같아야 해 E1'↔E2 를 거부한다. 언어 짝 비교(같은 `rowId`, 다른 데이터 파일)는 `export --language ko` 와 함께 B2 뒤 ed 가 만든다. 회사 서버에 `sol_eval` 을 까는 절차는 §3.2 1)~4)다(미결정 29-2).

```bash
export SOL_WORK=/data/www/ai_workspace/sol-radar
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1 HF_HUB_OFFLINE=1    # bosun_score 기본 --device auto·--dtype auto(CUDA 가 있으면 GPU 1 bf16). 명시는 --device cuda --dtype bf16, CPU 대체는 --device cpu(fp32). 실제 값은 report.json environment 의 device·dtype(main 60c81c9, 미결정 26-16)
export HF_HOME="$SOL_WORK/hf"                                                 # preflight 기본값과 같게
source "$SOL_WORK/.venv-bosun/bin/activate"                                   # sol_eval 설치는 §3.2·미결정 29-2
cd "$SOL_WORK"
snap=$HF_HOME/hub/models--Hanno-Labs--bosun-v3.1-0.6b/snapshots/5e78a37c8d86860ebac9ef2d5327d6299498498e
sha256sum "$snap/adapter/adapter_model.safetensors" "$snap/decision_embeddings.safetensors"   # §2.2 값과 같아야 한다(사람 교차 확인용. bosun_score 도 main 36edfb6 부터 모델 로드 전에 manifest sha256 을 대조한다, 미결정 26-17)
# 경로는 모두 절대 경로로 준다. 상대 --out 은 sol_eval 이 저장소 clone 기준으로 풀어 출력이 clone 의 runs/ 에 생긴다
# 모델은 한 번에 하나씩 순서대로 올린다. 출력 폴더 4개를 통째로 돌려준다
D="$SOL_WORK/sol-dataset-v0.1/bosun"; R="$SOL_WORK/runs"
python -m sol_eval bosun_score --package "$R/bosun-sol-lora-v0.1" --data "$D/dev.en.jsonl"  --seeds 0-5 --out "$R/e4-dev"     # 보정용
python -m sol_eval bosun_score --package "$R/bosun-sol-lora-v0.1" --data "$D/test.en.jsonl" --seeds 0-5 --out "$R/e4-test"
python -m sol_eval bosun_score --package "$snap"                  --data "$D/test.en.jsonl" --seeds 0-5 --out "$R/e1p-test"   # E1' 기준선
python -m sol_eval bosun_score --package "$snap"                  --data "$D/dev.en.jsonl"  --seeds 0-5 --out "$R/e1p-dev"
python -m sol_decision.trainer.calibrate --data "$D/dev.en.jsonl" --predictions "$R/e4-dev/predictions.jsonl" --out "$R/bosun-sol-lora-v0.1/calibration.json"   # F3 보정(dev)
```

- 출력은 폴더마다 `predictions.jsonl`·`rows.json`·`report.json`(계획 §4.2). `report.json` 에는 패키지 경로·어댑터 sha256·`--data` 파일 sha256·seeds·환경(torch·transformers·peft 버전, 장치, dtype)을 적는다. E1'·E4 의 환경이 같아야 비교가 성립한다.
- 우리 쪽 E4 리포트(21 §4.3 지표 전부: Macro-F1·정보부족→미충족 혼동률·Brier·ECE·`argmax_stable`·`spread`)는 `sol_eval` 이 위 출력 폴더를 통째로 돌려받아 **오프라인**으로 낸다(ADR-034 7번). 엔드포인트에 붙지 않는다. 실행 전에 `report.json` 의 패키지 sha256 과 test 파일 sha256 이 번들 manifest 와 같은지 대조한다. 요청당 지연은 E4 에서 재지 않는다(지연은 B2 G3 p50/p95).
- 신뢰구간: 같은 사업에서 파생된 회사 변형·질문은 독립 표본이 아니다. `sol_eval` 이 사업 클러스터 단위 paired bootstrap 95% CI 를 우선 낸다(21 §4.3). 표본이 작으면 개선을 확정하지 않고 탐색적 결과로 적는다.
- 받아들이는 기준: dev·test 모두 E1' 대비 회귀 없음(ADR-034 9번 회귀 안정성), E1' 대비 개선은 Δ 95% CI가 0을 배제할 때만(ADR-034 9번), 보정 뒤 ECE ≤ 0.08(21 §4.4 초기 목표). 확신 오류율(p ≥ 0.9 오답)은 보고만 하는 보조 지표다(출처 없는 문턱으로 합격을 막지 않는다, [[16-DECISIONS|16]] 미결정 29-5). 기준을 하나라도 어기면 결과는 보고하되 서빙 후보로 올리지 않는다. 서빙 후보라도 교체는 사용자 승인 뒤다(ADR-034 9번).
- "E4 가 E1' 보다 낫다"는 Δ 의 95% 신뢰구간이 0 을 포함하지 않을 때만 말한다(ADR-027 에서 보존한 원칙). 데모 교체는 그 뒤에도 **사용자 승인**이 필요하다(Q7).

학습본은 HTTPS 로 서빙하지 않는다(회사 nginx 의 SOL RADAR location 은 `https://acropolissg.com/sol-radar` 하나다). 평가 전용 서빙 인스턴스(옛 B안 `/kev-lora`·8010)는 **없다**.

### 4.5 돌려받을 것

| 받는 것 | 내용 |
|---|---|
| 학습본 패키지 폴더 | `runs/bosun-sol-lora-v0.1/`: `config.json`·`adapter/`(`adapter_model.safetensors`·`adapter_config.json`)·`decision_embeddings.safetensors`·`tokenizer/`·`serving.json`·`manifest.json`(sha256) |
| 로그 | F1: `runs/bosun-preflight-*.log`, `runs/bosun-f1-<tag>.summary.md`·`.train.log`·`.parity.log`·`.nvidia-smi.csv`·`.pre.txt`·`.post.txt`, `runs/f1-results.md`. F2: `train.log`, `training_metrics.json`(step 별 loss·lr·시간·최대 메모리·wall·건너뛴 레코드 수), `nvidia-smi` 기록 csv |
| 리포트 | `bosun_score` 출력 4벌(`runs/e4-dev`·`e4-test`·`e1p-test`·`e1p-dev` 의 `predictions.jsonl`·`rows.json`·`report.json`), `calibration.json` |
| `MODEL_CARD.md` | 데이터셋 버전·sha256, `sol_decision` commit, 하이퍼파라미터(F1 값과 다르면 근거), GPU(NVIDIA A40 46,068 MiB, 물리 index 1, PaddleOCR 공유, 드라이버 580.173.02, torch 2.8.0+cu128), 학습 시간(실측), 보정 방법 |
| sha256·환경 목록 | 어댑터·임베딩 sha256, `venv-bosun-freeze.txt` |

데이터셋 원문은 돌려받지 않는다. 회사는 학습이 끝나면 번들을 지운다. Hugging Face Hub 에 올리지 않는다. 레지스트리 반입과 운영 교체 규칙은 [[21-MODEL-TRAINING|21]] §5.4 다.

## 5. Qwen 파인튜닝: 하지 않음 (2026-10-20 사용자 결정)

추출·설명 모델은 회사가 운영하는 vLLM API 의 `Qwen/Qwen3.8-Flash-Next` 를 재사용하고 **파인튜닝하지 않는다**([[16-DECISIONS|ADR-034]] 8번 개정). 처음 안(Qwen3-4B-Instruct-2507 을 EX0 뒤 조건부 QLoRA SFT → 병합 → vLLM 서빙)은 철회했고 Qwen 4B 는 백업으로만 보존한다. 이 절에 있던 데이터 계약·LLaMA-Factory yaml·병합 절차는 지웠다(이력은 git 과 [[16-DECISIONS|ADR-027]] 폐기 본문).

남는 것은 **EX0 한 건**이다: B3(10-22~23)에서 회사 API 의 추출 품질을 기준 측정한다 — 21 §4.3 추출 지표(필드 state 정확도·값 일치·필수 항목 재현율·인용 정확도·근거 없는 `KNOWN` 비율·`(untranslated)` 비율), fixture `FX-01`~`FX-20` 인용 검증 통과율, 인젝션 fixture 의 `INJECTION_SUSPECTED` 유지, JSON 스키마 위반률, 지연 p50·p95. 결과는 `docs/evidence/eval/` 에 적고 EX1 은 없다. 추출·설명 SFT 의 데이터 계약 설계는 해커톤 뒤 후속 과제로만 남긴다.

## 6. 회사에 넘기는 학습 요청서 (B3)

보낼 것:
1. 데이터셋 번들 `sol-dataset-{version}/` 폴더와 파일별 sha256(`bosun/` 레코드 + manifest + leakage 리포트). 실제 공고(공공 데이터, 개인정보 마스킹)와 가상 기업만 들어 있다. Supabase 키·서비스키·회사 기밀은 없다.
2. B1 산출물(main `1b68f9b`): `services/decision`(`sol_decision.serve`·`sol_decision.train`·`sol_decision.parity`·`sol_decision.trainer.calibrate`, 테스트, `README.md`·`docs/TRAINING.md`), `sol_eval`(`bosun_score`·`export --format bosun`·`leakage`·`compare`), `infra/gpu/bosun-preflight.sh`·`bosun-f1.sh`, 의존성 범위(`pyproject.toml`·`uv.lock`).
3. 이 문서 §2~§4.
4. 실행 순서와 받아들이는 기준: B2(`.venv-bosun` 핀 `--dry-run` → 설치 → Bosun·백본 다운로드 → sha256 → `bosun-preflight.sh` → **사용자 승인 뒤** `sol_decision.serve` 8009 기동) → F1 smoke(§4.2) → F2(§4.3) → 패키지 저장·재로딩 → F3 보정 → `bosun_score` E4·E1' × test·dev(seed 0~5) → 출력 폴더 4개 전송. 회사 nginx·라우터 변경은 없다. Qwen 관련 서버 작업은 없다(회사 API 키 전달·`GET /v1/models` 확인만).

물을 것(16 미결정 22·24. GPU 모델·VRAM·장수는 2026-10-20 확인했다, §3.1):
1. GPU 1 의 PaddleOCR **피크 메모리와 시간대**(nvidia-smi 추이). 우리 Bosun 서빙·학습이 공존해도 되는 시간대와 메모리 상한.
2. GPU 서버에서 huggingface.co·pypi.org 로 나갈 수 있는지(없으면 §2.2 2안).
3. `.venv-bosun` 의 현재 핀 목록(`pip list --format=freeze`)과 Python·torch 버전.
4. F1·F2(10-25 일 오후)와 채점(10-26 월 오전)을 돌리고(처음 물은 날짜는 토·일 10-24~25, 2026-10-24 개정) 출력 폴더(`report.json`·`rows.json`·`predictions.jsonl`, 수십 MB)를 보내 줄 수 있는지. 라우터·nginx 변경은 요청하지 않는다([[23-WEEKEND-FINETUNE|23]] §8).
5. 회사 Qwen3.8-Flash-Next API 의 `QWEN_API_KEY` 전달 방법, `GET /v1/models` 의 `id`, 호출 한도·추가 인증·guided JSON·`prompt_logprobs` 지원 여부(주소·키 정본은 03·10).

돌려받을 것: §4.5.

## 7. 미확인

| 항목 | 상태 | 확인 방법 |
|---|---|---|
| 회사 GPU 사양 | **확인(2026-10-20 오전)**: A40 46,068 MiB ×3, SOL RADAR 는 물리 GPU 1(§3.1) | [F1 기록](evidence/kev-train-feasibility.md) §0(당시 기록) |
| GPU 1 공유 상태(PaddleOCR 약 9,167 MiB)·`.venv-bosun`·Bosun CPU 2-step 성공·`smoke.jsonl` 6건 | **사용자 보고, 미검증** | B2 `nvidia-smi`·`pip list` 기록(계획 §10 9번) |
| 외부망(Hugging Face·PyPI)·학습 시간대·PaddleOCR 피크 | 미확인 | §6 물을 것(16 미결정 22) |
| 모델 라우터·`:8009` 런타임의 실제 실행 상태 | 미확인(2026-10-20 기준 SOL RADAR 런타임은 아직 띄우지 않았다. 기동은 사용자 승인 뒤) | B2 → C1 ③ G1·G2 |
| 회사 Qwen3.8-Flash-Next API: `/v1/models` 의 `id` 가 `Qwen/Qwen3.8-Flash-Next` 인지, 추가 인증·호출 한도·지연(`AI_TIMEOUT_MS` 60000 안), guided JSON(G4)·`prompt_logprobs`(E3) 지원, Qwen3.8-Flash-Next 추출·번역 품질 | **미검증**(사용자 보고) | B2 확인, B3 EX0(계획 §10 6·7번) |
| `.venv-bosun` 핀(transformers·peft·safetensors·fastapi) 과 torch 2.8.0+cu128 유지, `uv` 설치 여부 | 미확인(`uv.lock` 은 torch 2.14.1, §3.2) | §3.2 `--dry-run` → 설치 → `bosun-preflight.sh` |
| Bosun snapshot·백본 다운로드와 sha256, `BosunForDecision` 로딩 | 미실행 | §2.2 → `bosun-preflight.sh`. 백본 크기·shard sha256 은 B2 에서 기록 |
| 리비전 `5e78a37c` 와 jev 레지스트리 핀 `87cea31` 의 `manifest.json` 동일성 | 미확인(커밋 메시지 기준 문서 차이만) | B2 두 리비전 `manifest.json` sha256 대조(계획 §10 13번) |
| Bosun 0.6B 의 우리 도메인 zero-shot 품질(E1'). DecisionBench `rubric_scoring` 가족 0.707 | 미측정 | B5 E1' 오프라인 채점(16 미결정 29-1). τ 재조정은 dev 로(계획 §10 1번) |
| Bosun 한국어·장문 state. 공개 학습 데이터 state 는 14~18.9k 자 | 미검증 | E1' vs E2(ko, 평가 전용)(계획 §10 2번) |
| 6k 토큰 × 20문항 순차 prefill 지연이 `KEV_TIMEOUT_MS` 5000 안인지 | 미측정(A40 1~3초 예상) | B2 G3 p95. 넘으면 질문 배치 forward·ADR-033 E4 산식 개정(계획 §10 3번) |
| 우리 trainer 가 `render_decision_prompt`·slot 손실을 서빙과 같게 재현하는지 | 미검증(Bosun 공식 학습 코드 없음. 모델 없는 배선 시험 `services/decision/tests/test_train_pure.py` 와 서버 전용 `services/decision/tests_model/test_train_smoke.py`(미실행)가 있다) | `python -m sol_decision.parity --package "$snap" … --n 8`(학습 전, 단건 `--tol 1e-4`·배치 `--batch-tol 1e-2`)와 `bosun-f1.sh` 의 학습 뒤 parity(계획 §10 4번) |
| Bosun LoRA 학습 실제 메모리(추정 6~10 GB)·step 시간·서빙 1.5~3 GB | 추정(계획 §8) | F1-B(§4.2)·B2 `nvidia-smi` |
| GPU 1 공유 간섭(PaddleOCR 피크·지연) | 미지 | 회사 점유 추이(계획 §10 8번) |
| 회사 2-step 학습 코드(저장소 밖) | 미반입. B1 학습기 `services/decision/src/sol_decision/train.py` 가 대체했다(`services/decision/docs/TRAINING.md`. 계획 §10 10번의 "반입 뒤 흡수"에서 바뀜) | B2 에서 결과 비교 |
| 구조화 JSON state 가 텍스트 state 보다 나은지 | 후속 실험 | B7 이후 |
| 첨부 원문의 학습 사용 권리 | 미확인 | 법무([[21-MODEL-TRAINING\|21]] §5.5) |

## 관련 문서

- [[21-MODEL-TRAINING|21 모델 학습]] — 데이터셋·라벨·평가 지표·오류 분석·착수 판단·레지스트리 반입
- [[23-WEEKEND-FINETUNE|23 주말 파인튜닝 계획]] — 10-25~26 일정(2026-10-24 개정)·GPU 공유 표·회사에 물을 것
- [[03-AI-PIPELINE|03 AI 파이프라인]] — Qwen 추출 명세·프롬프트·회사 API 주소, 질문 세트 `kev-qs/v0.2`·state 템플릿, 레지스트리 서빙 검증
- [[16-DECISIONS|16 ADR]] — ADR-034(Bosun 전환·Qwen3.8-Flash-Next 회사 API 재사용), ADR-010(유료 승인), ADR-025(회사 GPU 엔드포인트), ADR-027(폐기, 이력), 미결정 22·24
- [분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) — 외부 사실 §1, Qwen3.5-27B 개정 §0.2, 학습 계약 §4, 서버·env §5, GPU 공유 §8, 일정 §9, 위험 §10
- [[12-ROADMAP|12 로드맵]] — 일정
- [[10-DEPLOYMENT|10 배포]] — 회사 GPU 추론 엔드포인트·모델 라우터·`QWEN_BASE_URL`
- [[09-SECURITY|09 보안]] — 데이터 경계·프롬프트 인젝션
- [[15-DATA-CONTRACTS|15 데이터 계약]] — `EvidenceRef`, 인용 검증
