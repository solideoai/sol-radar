---
title: "AI gateway 회사 반영·실공고 분석 기록 (2026-10-29 오전)"
status: active
tags: [sol-radar, ops, ai-gateway, extraction, translation, live-analysis]
updated: 2026-10-29
---

# AI gateway 회사 반영·실공고 분석 기록 (2026-10-29 오전)

[[../../../16-DECISIONS|ADR-064]](첨부 조립 v0.2), 인용 길이 수정([[../../../15-DATA-CONTRACTS|15]] §5.3), [[../../../16-DECISIONS|ADR-065]](번역 비교 표현)를 회사 AI gateway에 반영했다. 메인 세션 45가 회사 망에서 SSH로 스크립트를 돌렸다. 단계마다 사용자 승인을 받았다.

지킨 조건:

- AI gateway 컨테이너 하나만 다시 만들었다. Analysis Worker·ingest·Documents·기업마당 Worker, redis-api는 그대로 두었다.
- 배포 checkout(`/data/www/ai_workspace/sol-radar-deploy`, `sol-radar-app`의 worktree)은 회사 전용 carry 커밋 `9bb24b0`(dependency reporter)을 유지했다. 그 위에 main의 `services/ai`만 얹은 배포 브랜치를 새로 만들었다. Compose 파일과 override는 바꾸지 않았다.
- 교체 직전 운영 DB `score_runs`의 `QUEUED`·`RUNNING`은 두 번 모두 0건이었다.
- `.env*` 파일은 열지 않았다. 컨테이너 env는 이름만 확인했다.

## 1차 교체 — 첨부 조립 v0.2 (09:00)

| 항목 | 내용 |
|---|---|
| main | `32e56025..bac41b5e` push(push 전 검사 공통·ai 통과), Vercel success |
| 배포 브랜치 | `deploy/main-20261029-gw` = `9bb24b0` + main `bac41b5e`의 `services/ai`(커밋 `ae9e9d6`, 변경 6파일이 예상 목록과 같음) |
| 이미지 | `sol-radar-ai-gateway:ae9e9d66045a` |
| 명령 | `docker compose -f infra/compose.ai-worker.company.yaml -f /home/bim/sol-radar-overrides/ai-gateway.sha.yaml up -d --no-deps --no-build ai-gateway`(`AI_GATEWAY_TAG` 지정) |
| `/health` | status ok, `promptHash` `3d667cfa…` → `fa2ff603…`, Qwen3.8-Flash-Next-AWQ-INT4·bosun-v3.1-0.6b `registryMatch: true`·파서 3종 그대로 |

컨테이너 env에 `AI_PROMPT_VERSION`이 없어 코드 기본값 `req-extract/v0.2`가 적용됐다. 교체 뒤에도 Documents Worker의 `/parse`는 200으로 이어졌다.

## 실공고 3건 분석 (1차 교체 뒤, 사용자 승인 "3건 먼저")

운영 화면에서 관리자 계정으로 [분석 실행]·[재분석]을 눌렀다.

| 공고 | run | 결과 | 추출 |
|---|---|---|---|
| 부경대 수요자 맞춤형 정보시스템 고도화 (`95c8abdc`) | `90f85ba6` | 38 `WATCH`, `RULES_ONLY` | `87ea2246`. 공고서 PDF·제안요청서 HWPX 인용으로 10개 항목 `KNOWN`(10-28 v0.1은 전 항목 `UNKNOWN`). `TRANSLATION_MISSING:restrictions[2]`·`[3]`이라 Bosun 생략 |
| 동국대 nDRIMS 연구생활장려금 (`5245956d`) | `54379cd5` | `PARTIAL` 54, `EXTRACTION_FAILED` | 저장 안 됨. Worker `PAYLOAD_INVALID` `restrictions.evidence.1.quotedText: too_big`. Worker zod는 원문 300자를 보고, gateway는 `norm`한 길이를 봤다 |
| 2026년 국가 재난 정신건강 전산시스템 (`feb287a0`) | `e2620667` | 45 `WATCH`, `RULES_WITH_KEV_ASSIST` | `COMPLETED`, `CITATION_FAILED:restrictions` |

사용자 결정으로 두 결함을 09 세션이 고쳤다. 인용 길이는 `4caaa17a`, 번역 비교 표현은 `65a66a04`(ADR-065)다.

## 2차 교체 — 인용 길이·번역 비교 표현·키 정리 (09:35)

| 항목 | 내용 |
|---|---|
| main | `bac41b5e..65a66a04` push(push 전 검사 공통·ai 통과) |
| 배포 브랜치 | `deploy/main-20261029-gw2` = `ae9e9d6` + main `65a66a04`의 `services/ai`(커밋 `2deb118`, 변경 6파일이 예상 목록과 같음) |
| 이미지 | `sol-radar-ai-gateway:2deb11861b3a` |
| 키 정리 | 사용자가 회사에서 `infra/.env.ai-local`을 `.env.ai-local.bak-20261029`로 백업했다. 그 뒤 쓰지 않는 6줄을 지웠다: `SUPABASE_SERVICE_ROLE_KEY`·`REDIS_PASSWORD`·`G2B_ORDER_PLAN_SERVICE_KEY`·`G2B_BID_NOTICE_SERVICE_KEY`·`G2B_PRE_SPEC_SERVICE_KEY`·`G2B_INDUSTRY_MASTER_SERVICE_KEY`. 이 파일을 쓰는 컨테이너는 gateway뿐이다(회사 Compose 파일 grep, `docker inspect` 라벨). `services/ai/src`에는 이 이름을 읽는 코드가 없다. 재생성 뒤 컨테이너 env 이름 목록에서 6개가 빠진 것을 확인했다 |
| `/health` | status ok, `promptHash` `fa2ff603…` 그대로, 모델·`registryMatch`·파서 그대로 |

### 2차 교체 뒤 재분석

| 공고 | run | 결과 | 추출 |
|---|---|---|---|
| 부경대 (`95c8abdc`) | `ee75b55c` | 38 `WATCH`, `RULES_ONLY` | 사용자 승인으로 v0.2 추출 행 `87ea2246` 하나를 지웠다. 이 때문에 `score_runs.extraction_id`가 `ON DELETE SET NULL`이라 run `90f85ba6`의 연결이 비었다. 다시 추출한 `3e75cad3`(PENDING_REVIEW)에서 "공동수급체 구성원 2개사 이하, 최소 지분율 10% 이상"이 "2 or fewer … 10% or more"로 통과했다. 이번에는 `restrictions[0]` "대기업 및 중견기업 참여 불가 (사업금액 20억원 미만)"이 gateway 로그 `reason=REJECTED`라 Bosun이 빠졌다 |
| 동국대 (`5245956d`) | `f262e632` | 44 `WATCH`, `RULES_WITH_KEV_ASSIST`, `MODEL_RULE_DISAGREEMENT` | `9ab22699` `COMPLETED` |

부경대의 남은 거부는 Qwen이 낸 번역문이 남지 않아 원인을 확정하지 못했다. 검증기에 후보 문장을 넣어 보면 두 경우에 거부됐다. 하나는 "2 billion KRW"처럼 숫자를 바꾼 번역이고(설계상 거부), 다른 하나는 "under"·"not eligible" 같은 아직 등록하지 않은 표현이다. 사용자 결정("여기서 멈추기")으로 더 고치지 않는다. 판정은 규칙 엔진이 하므로 빠지는 것은 Bosun 참고 의견뿐이다.

## 되돌리기

- gateway: 같은 Compose 명령에 `AI_GATEWAY_TAG=ae9e9d66045a`(1차) 또는 `9bb24b002f9b`(10-27)를 준다. 이전 이미지는 남아 있다.
- 키: `.env.ai-local.bak-20261029`를 되돌린 뒤 gateway를 재생성한다.
- 배포 브랜치: `deploy/main-20261027b`(`9bb24b0`)가 남아 있다.

## 관련 문서

- [[../../../PROGRESS|진행 상황]]
- [[../20261028/sources-rollout|10-28 수집 서비스 회사 반영]]
- [[../../../../infra/company/README|회사 런타임 배포]]
