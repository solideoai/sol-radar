---
title: "Kev-9B LoRA 학습 가능성 (F1) — 회사 GPU 서버 환경 확인과 메모리 검증 기록"
status: draft
tags:
  - sol-radar
  - ai
  - ops
  - test
updated: 2026-10-20
---

# Kev-9B LoRA 학습 가능성 (F1)

[[21-MODEL-TRAINING|21 모델 학습]] §5.2·[[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]] §4.2·[[23-WEEKEND-FINETUNE|23 주말 계획]] §5.2 가 결과를 두기로 한 파일이다. 실행한 것만 적고, 실행하지 않은 단계는 "미실행"으로 둔다. 비밀 값·키·서비스키는 적지 않는다.

> [!warning] 읽는 법
> §0 은 2026-10-20 사용자가 회사 서버 셸에서 직접 실행한 명령의 출력이다(이 저장소의 세션이 서버에 접속한 것이 아니다). §1 이후는 **미실행**이고, 스크립트(`infra/gpu/kev-preflight.sh`·`infra/gpu/kev-f1.sh`)가 남기는 `runs/*.summary.md`·`runs/f1-results.md` 를 옮겨 적는다. PyTorch 가 CUDA 를 잡은 것과 Kev 파인튜닝이 되는 것은 다른 사실이다.

## 0. 서버 환경 (2026-10-20 확인, 사용자 실행)

| 항목 | 값 |
|---|---|
| 호스트 · 계정 | `sol-NF5280M6` · `bim` |
| 작업 경로 | `/data/www/ai_workspace` → SOL RADAR 전용 `/data/www/ai_workspace/sol-radar` |
| Python · venv | 3.12.3 · `/data/www/ai_workspace/sol-radar/.venv-kev` (새로 만들지 않는다) |
| NVIDIA 드라이버 · CUDA | 드라이버 580.173.02(지원 CUDA 13.0) · CUDA Toolkit 12.8 |
| RAM · swap | 약 125 GiB(가용 약 54 GiB) · swap 2 GiB(당시 전부 사용 중) |
| `/data` | 전체 8.7 TB, 가용 약 1,011 GB |
| GPU | NVIDIA A40 ×3 (아래 표). **SOL RADAR 는 물리 index 1 만 쓴다** |

| 물리 GPU index | 총 VRAM | 당시 사용량 | 정책 |
|---|---:|---:|---|
| 0 | 46,068 MiB | 4,747 MiB | 회사 기존 서비스. 사용 금지 |
| 1 | 46,068 MiB | 5 MiB | SOL RADAR 파인튜닝 전용(Compute Capability 8.6) |
| 2 | 46,068 MiB | 9,240 MiB | 회사 기존 서비스. 사용 금지 |

venv 안 검증 출력(`CUDA_VISIBLE_DEVICES=1`):

```text
PyTorch: 2.8.0+cu128
CUDA Available: True
Visible GPU Count: 1
GPU: NVIDIA A40
BF16: True
Free VRAM: 44.16 GiB
Total VRAM: 44.42 GiB
```

- 설치·확인된 패키지: torch 2.8.0+cu128, triton 3.4.0. PyTorch import 때 NumPy 미설치 경고가 났다(CUDA 인식 실패가 아니다. Kev 설치가 `numpy>=2.5.3` 을 넣는다).
- nvidia-smi 의 46,068 MiB(총)와 PyTorch 의 44.42 GiB(`mem_get_info` 총)는 단위와 집계가 다르다. 학습 예산은 작은 쪽(44.16 GiB 가용) 기준으로 잡고 안전 여유를 둔다(22 §4.2).
- 위 값으로 확정된 것: 사용할 GPU(1장, A40 46,068 MiB), venv·torch·CUDA·bf16. 확정되지 않은 것: §4.

## 1. F1-A 환경 사전 검증 (미실행)

`bash infra/gpu/kev-preflight.sh` 출력(`runs/preflight-<일시>.log`)을 여기에 요약한다.

| 항목 | 결과 | 비고 |
|---|---|---|
| `CUDA_VISIBLE_DEVICES=1` · `CUDA_DEVICE_ORDER=PCI_BUS_ID` | 미실행 | |
| GPU 1 uuid = `cuda:0` uuid | 미실행 | 다른 GPU 를 잡으면 학습 금지 |
| GPU 1 다른 프로세스 없음 · 여유 ≥ 40,000 MiB | 미실행 | |
| Kev 소스 `1f04cfa…` · `kev.train --help` | 미실행 | |
| numpy · transformers ≥5.17 · peft ≥0.21 | 미실행 | |
| flash-linear-attention 0.5.2 · triton 3.4.0 · Gated DeltaNet 커널 smoke(fwd+bwd) | 미실행 | A40 실행 가능 여부는 여기서 판단 |
| `kev-9b@v1.0` adapter/head sha256 | 미실행 | 기대값 22 §2.2 |
| `Qwen3.5-9B-Base@68c46c4b…` 캐시 | 미실행 | |
| 학습 데이터 형식 · `--max_state` 별 dropped | 미실행 | X6b 번들 뒤 |

## 2. F1-B·F1-C 메모리 검증 (미실행)

`bash infra/gpu/kev-f1.sh --max_state N` 의 `runs/f1-results.md` 를 옮긴다. 앞 단계가 PASS 일 때만 다음 값. OOM 이 나면 더 큰 값을 시도하지 않는다.

| run | max_state | batch×accum | peak alloc GiB (torch) | nvidia-smi max MiB | step s | records | dropped | OOM | ckpt | 판정 |
|---|---:|---|---:|---:|---:|---:|---:|---|---|---|
| f1-ms1024-b1a8 | 1024 | 1×8 | 미실행 | | | | | | | |
| f1-ms2048-b1a8 | 2048 | 1×8 | 미실행 | | | | | | | |
| f1-ms4096-b1a8 | 4096 | 1×8 | 미실행 | | | | | | | |
| f1-ms6144-b1a8 | 6144 | 1×8 | 미실행 | | | | | | | |
| (선택) f1-ms…-b2a4 | | 2×4 | 미실행 | | | | | | | |

각 run 의 F1-D 기록 항목(GPU index, PyTorch, Kev commit, Base revision, LoRA checkpoint revision·sha256, peak VRAM 두 값, 평균 step 시간, 레코드 수, dropped, OOM, checkpoint 저장, 로그 경로)은 `runs/<run>.summary.md` 에 있고 여기에 링크 대신 값을 옮긴다.

## 3. 판정 (미정)

- F2 에 쓸 설정: 미정. 20 step PASS 만으로 F2 준비 완료라고 적지 않는다. `dropped 0`, 안전 여유(nvidia-smi 최대 ≤ 41,000 MiB), 데이터 보고 항목(21 §7)까지 갖춰야 한다.
- F1 전부 FAIL 이면 22 §4.2 의 대안 순서로 검토한 결과와 사용자 승인 대상(Kev-4B 전환·다중 GPU·클라우드 GPU)을 여기 적는다.
- F2 예상 시간: A40 F1 의 step 시간 × F2 step 수로 재추정한다. 실측 전 **미확정**(H200 2.6시간은 쓰지 않는다).

## 4. 미검증 (2026-10-20 기준)

Kev 공식 소스 설치, Kev 학습 의존성 호환성, `flash-linear-attention` A40 호환성, Gated DeltaNet 커널 실행, Kev-9B 체크포인트·Qwen3.5-9B-Base 다운로드, Kev 모델 로딩, F1 20 step, 최대 GPU 메모리, 실제 학습 시간, F2·F3·E4, 회사 서버의 Hugging Face·GitHub·PyPI 접근, 모델 라우터 포트(8080·8001·8009)의 실제 실행 상태, GPU 1 을 다른 회사 작업에 쓸 가능성, `uv` 설치 여부.

## 관련 문서

- [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]] — §3 환경, §4.2 F1
- [[23-WEEKEND-FINETUNE|23 주말 계획]] — §5.2 F1 격자, §7 대체 경로
- [[21-MODEL-TRAINING|21 모델 학습]] — §5.2·§7
- [[10-DEPLOYMENT|10 배포]] — 학습 전용 GPU
- [[16-DECISIONS|16 ADR]] — ADR-025·027, 미결정 22
