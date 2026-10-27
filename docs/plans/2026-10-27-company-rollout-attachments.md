---
title: "10-27 회사 반영 실행서: 첨부 처리·분석 연결·수집 격리"
doc: "plan-20261027-company-rollout-attachments"
status: active
tags:
  - sol-radar
  - ops
  - documents
updated: 2026-10-27
---

# 10-27 회사 반영 실행서: 첨부 처리·분석 연결·수집 격리

회사 서버(`/data/www/ai_workspace/sol-radar-deploy`)에서 사람이 실행한다. 메인 세션은 회사 서버에 접속하지 않는다. 단계마다 출력을 메인 세션에 붙여 넣고, 다음 단계로 갈지 함께 판단한다. **[승인]** 단계는 운영을 바꾼다.

## 0. 이미 끝난 것 (회사 밖)

| 항목 | 상태 |
|---|---|
| Vercel web | main `8cfaac31` 배포 완료(10-27 12:37 KST). 분석 준비 판정이 첨부 텍스트를 본다. 운영 첨부가 모두 PENDING 이라 화면 변화는 아직 없다 |
| 운영 DB | migration `20261027000500`(첨부 처리 리스 함수 5개)·`000600`(가입 동의) 적용 완료. 버킷 `bid-documents`·`bid-parsed` 비공개 |
| DEMO 마감 | +15일 적용 완료([[../evidence/demo-deadline/20261027/prod-run\|실행 기록]]) |

이번 회사 반영이 맞추는 코드는 main 의 이 실행서 커밋(아래 `<SHA>`)이다. 10-27 수집 격리(`43e4e024`, [[2026-10-27-ingest-source-isolation-deploy|격리 배포 실행서]] 단계 5~12)도 같은 갱신에 들어 있다.

## 1. 순서와 이유

아래 절 번호 순서로 한다.

- §2 D0 읽기 확인
- §3 Git 갱신 **[승인]**
- §4 redis-api 재생성 **[승인]**
- §5 ingest Worker 재생성 **[승인]**(KST 정각 +15분 ~ 다음 정각 −30분)
- §6 AI gateway 파서 반영 **[승인]**
- §7 Analysis Worker 교체 **[승인]**
- §8 Documents Worker 기동 **[승인]**(나라장터 첨부 실다운로드 시작)
- §9 확인(읽기)

이유:

- §6 이 §8 보다 먼저다. 파서 없는 gateway 로 §8 을 띄우면 원본만 받고 파싱은 2시간 미루다 PENDING 으로 남는다.
- §7 이 §8 보다 먼저다. §8 이 첨부를 PARSED 로 만들면 새 redis-api(§4)와 web 이 분석을 받는다. 그때 Analysis Worker 가 옛 코드면 첨부를 읽지 않고 본문 없는 분석을 만든다.
- §4·§5 는 첨부와 무관하다. 둘 다 격리 배포 실행서의 단계 6·7~10 그대로다.

## 2. D0 읽기 확인 (운영 영향 없음)

```bash
cd /data/www/ai_workspace/sol-radar-deploy
docker ps --no-trunc --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker ps --format '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}\t{{.Names}}\t{{.Image}}'
git -C . branch --show-current
git -C . log --oneline -3
git -C . status --short
curl -sS http://172.20.0.1:8000/health
ss -ltnp 2>/dev/null | grep ':8000 '
```

붙여 넣을 것: 위 출력 전부. 키 값이 찍히는 명령은 없다.

멈출 조건:

- 전체 Worker(`worker/main.ts`)가 같은 Redis 에서 돈다.
- Analysis Worker 컨테이너 라벨이 `sol-radar-analysis-only`·`analysis-worker` 가 아니다(§7 의 방법을 다시 정한다).
- `git status --short` 가 비어 있지 않다.

`/health` 와 `ss` 출력으로 AI gateway 가 어떻게 떠 있는지(컨테이너·호스트 프로세스, 실행 디렉터리, `AI_PROVIDER`) 확인한다. §6 의 명령은 이 결과로 확정한다.

## 3. Git 갱신 — [승인]

[[2026-10-27-ingest-source-isolation-deploy|격리 배포 실행서]] 단계 5 와 같다. 새 브랜치 이름만 다르다.

```bash
CUR=$(git -C . branch --show-current); echo "$CUR"
git -C . rev-parse --short=12 HEAD
git -C . fetch origin main
git -C . log --oneline origin/main..HEAD
B=$(git -C . merge-base HEAD origin/main)
git -C . diff --name-only "$B" HEAD
git -C . diff --name-only "$B" origin/main
git -C . switch -c deploy/main-20261027b origin/main
git -C . cherry-pick $(git -C . rev-list --reverse "origin/main..$CUR")
git -C . diff --stat "$CUR" HEAD -- infra/sources infra/compose.company.yaml infra/compose.ingest-only.company.yaml infra/compose.analysis-only.company.yaml web/worker/analysis-only-main.ts
git -C . log --oneline -3
```

- 기대: 두 경로 목록에 겹침 없음, cherry-pick 성공, 마지막 `diff --stat` 출력 없음.
- 회사 checkout 에 `web/worker/analysis-only-main.ts`·`infra/compose.analysis-only.company.yaml` 이 untracked 로 남아 있으면 switch 가 거부한다. 그때는 [[../../infra/company/README|회사 런타임 배포]] §7.2 로 백업·비교한 뒤 다시 한다.
- 되돌리기: `git -C . cherry-pick --abort; git -C . switch "$CUR"`. 실행 중 컨테이너는 바뀌지 않는다.

## 4. redis-api 재생성 — [승인]

격리 배포 실행서 단계 6 그대로다(되돌리기용 태그를 먼저 남기고 `build redis-api` → `up -d --no-deps --wait redis-api`). 이번 코드로 redis-api 는 본문이 비어도 파싱된 첨부가 있는 공고의 분석을 받는다. §8 전에는 그런 공고가 없어 동작이 같다.

## 5. ingest Worker 재생성 — [승인]

격리 배포 실행서 단계 7~10 그대로다. 시간 창(KST 정각 +15분 ~ 다음 정각 −30분)과 `--status` 의 waiting·active·prioritized 0 을 지킨다.

2026-10-27 18:09 완료. 실행 중인 Worker 가 `sol-radar-app/infra` 에서 떠 있어 그 checkout 에서 했다. 21:00 회차 `SUCCEEDED`([[../evidence/company-rollout/20261027/ingest-worker-recreate|재생성 기록]]).

## 6. AI gateway 파서 반영 — [승인]

D0 결과로 명령을 확정한다. 지켜야 할 것:

- 실제 모델 설정(`AI_PROVIDER`, Qwen·결정 모델 주소, 키)은 바꾸지 않는다. 새 env 는 필요 없다(파서 기본 어댑터가 켜진다).
- 새 의존성 `pdfplumber>=0.11.10`·`olefile>=0.47`(`services/ai/uv.lock`)을 설치할 수 있어야 한다.
- 다시 띄운 뒤 `curl -sS http://172.20.0.1:8000/health` 에서 다음을 본다.
  - `parsers` 가 형식마다 parserId 를 보인다: `pdfplumber@0.11.10`·`sol-hwpx@1`·`sol-hwp5@1+olefile@0.47`
  - provider·모델 항목이 D0 와 같다
- 되돌리기: 이전 이미지(또는 이전 checkout)로 다시 띄운다. 파서가 없어도 `/extract`·`/kev` 는 이전과 같다.

## 7. Analysis Worker 교체 — [승인]

[[../../infra/company/README|회사 런타임 배포]] §8.6 의 1번이다. 원본 Compose 는 그대로 두고, 덮어쓰기 파일로 같은 서비스를 SHA 태그 이미지로 다시 만든다. `sol-radar-ai-worker-worker:latest` 는 빌드·태그하지 않는다.

```bash
docker ps --filter label=com.docker.compose.project=sol-radar-analysis-only --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
export ANALYSIS_WORKER_TAG="$(git -C . rev-parse --short=12 HEAD)"
A="docker compose -f infra/compose.analysis-only.company.yaml -f infra/compose.analysis-only.sha.company.yaml"
$A config --quiet
$A build analysis-worker
$A up -d --no-deps analysis-worker
$A ps analysis-worker
$A logs --tail 30 analysis-worker
```

- 교체 직전 메인 세션이 운영 DB 에서 진행 중 분석(`QUEUED`·`RUNNING`)이 없는지 본다.
- 기대: 이미지 `sol-radar-analysis-worker:<SHA>`, 로그 `analysis-only worker started`.
- 되돌리기: `docker compose -f infra/compose.analysis-only.company.yaml up -d --no-deps analysis-worker`(원본 `latest` 이미지).

## 8. Documents Worker 기동 — [승인]

[[../../infra/company/README|회사 런타임 배포]] §8.2~8.4 그대로다.

```bash
export DOCUMENTS_WORKER_TAG="$(git -C . rev-parse --short=12 HEAD)"
D="docker compose -f infra/compose.documents-only.company.yaml"
$D config --quiet
$D build documents-worker
$D run --rm --no-deps documents-worker node --conditions=react-server --import tsx worker/documents-only-main.ts --check
$D up -d --no-deps documents-worker
```

- `--check` 기대 출력은 README §8.3 이다.
- `up` 하면 바로 나라장터 첨부를 내려받는다. 회차(60초)당 최대 10공고 × 3건, 요청 간격 2초다. 10-27 기준 대상은 마감 전 live 공고 686건 × 최대 3건이다.
- 되돌리기: `$D stop documents-worker`. 받은 원본·텍스트·상태 기록은 지우지 않는다.

## 9. 확인 (읽기)

```bash
$D ps documents-worker
$D logs --tail 100 documents-worker
$A logs --tail 30 analysis-worker
```

- 로그에 `documents.enabled`, 60초마다 `documents.reconcile`, job 마다 `documents.job` 이 보인다.
- `DEFERRED` 가 계속되면 `detail` 을 보고 멈춘다. `AUTH_REQUIRED`·`HTTP_4XX` 가 대부분이면 나라장터가 자동 다운로드를 막는 것이다. 멈추고 보고한다.
- 메인 세션이 운영 DB 에서 `bid_documents` 상태별 수(`OK`·`PARSED` 증가, `FAILED` 사유 분포)를 본다.
- 실공고 한 건의 분석은 별도 승인으로 한다(회사 Qwen·결정 모델 호출).

## 관련 문서

- [[../../infra/company/README|회사 런타임 배포]]
- [[2026-10-27-ingest-source-isolation-deploy|10-27 수집 격리 배포 실행서]]
- [[../evidence/attachment-pipeline/20261027-implementation|첨부 파이프라인 구현 기록]]
- [[../PROGRESS|진행 상황]]
