---
title: "SOL Score v0.2.1 운영 반영 기록 (2026-10-30)"
status: active
tags: [sol-radar, evidence, scoring, deployment]
updated: 2026-10-31
---

# SOL Score v0.2.1 운영 반영 기록 (2026-10-30)

[[16-DECISIONS|ADR-071]] `sol-v0.2.1` 자격 판정 개정(사전 별칭·면허제한 여러 행)의 운영 반영 기록이다. 실행서는 `infra/company/README.md` §11.7이다. 반영은 다른 세션(`5aa599bd`)이 단계마다 사용자 승인을 받아 했다. 그 세션은 16:20 Vercel 확인 직후 사용 한도로 멈춰 기록을 남기지 못했다. 이 문서는 2026-10-31에 그 세션의 명령 출력 원문과 운영 읽기 확인으로 옮겨 적었다.

## 반영 순서 (2026-10-30 KST)

| 시각 | 단계 | 결과 |
|---|---|---|
| 14:41 | 코드 | `840f60a9`(브랜치 `feat/qual-aliases`), 커밋 게이트 통과 |
| 15:56 | 브랜치 갱신 | 그사이 main에 들어온 `ad21ba04`(가입 이메일 도메인, 가입 화면 10파일)를 병합해 `3aeaff92`. 커밋 게이트·push 전 검사 통과 |
| 15:59 | 회사 읽기(`d0`) | 배포 checkout `sol-radar-deploy` `deploy/sv02-20261030` `7b5a79dc9054`, `sol-radar-app` `main` `cbb3831e86da`(그대로 둔다) |
| 16:00 | 이미지 준비(`prep`) | `deploy/sv021-20261030` = `3aeaff92` + 회사 carry → `efab8acc144b`. Analysis Worker·redis-api 이미지 빌드, redis-api 되돌리기 태그 `rollback-20261030b`. 실행 중 컨테이너는 그대로 |
| 16:01:07 | 재채점 dry-run(일회용 컨테이너, `--changed-only --dry-run`) | `shown=385 current=0 targets=385 written=0 existing=0 busy=0 unchanged=160 invalid=0 failed=0 recommendation_changed=12 before[n=385 min=43 max=95 avg=66.9] after[n=385 min=43 max=95 avg=66.9]`, exit 0, `CHANGED` 225줄 |
| 16:15:13 | Analysis Worker 재생성 | `sol-radar-analysis-worker:efab8acc144b`, restarts 0 |
| 16:15:32 | redis-api 재생성 | `Healthy` |
| 16:18 | main push(Vercel 운영) | `ad21ba04..3aeaff92`. Vercel production `dpl_2PtZJ5WoY4NqLjfqnDXAsp39JeVj` READY, GitHub 상태 success(16:20:06) |

- dry-run에서 바뀌는 225건은 모두 실공고 보류 run이다. DEMO는 없고, 추천 분석이나 검토가 붙은 run도 없다. 225건 모두 저장 판정에 면허 여러 행(`AMBIGUOUS_MATCH`)이 있고, 그중 199건에는 새로 받아들이는 중소기업확인서 표기도 있다. 멈춤 조건(DEMO 변경, `invalid` 0 아님)에 걸리지 않았다.
- AI gateway(`384e469857f0`)·ingest·documents·기업마당·알림 Worker·Redis는 바꾸지 않았다.
- 되돌리기: Worker는 `rb-worker 7b5a79dc9054`, redis-api는 `rollback-20261030b` 태그다. 쓰지 않았다.
- 재채점 쓰기(225건)와 반영 뒤 health 확인은 하지 않은 채 세션이 멈췄다.

## 그 뒤 상태 (2026-10-31 16:54 KST, 읽기만)

- Vercel production은 `7a772753`(10-30 16:41 생성, READY)이다. `3aeaff92` 뒤에 모바일 웹(`07a307f8`)이 더해진 main이다.
- `/health/ready` 200, `{"db":"ok","redis":"ok","storage":"ok","ai":"local"}`.
- 운영 DB `score_runs`: `sol-v0.2.1` 0건, `sol-v0.2.0` `COMPLETED` 782(마지막 10-30 15:12), `sol-v0.1.0` `COMPLETED` 415·`PARTIAL` 1, `QUEUED`·`RUNNING` 0.
- 그래서 화면은 아직 `sol-v0.2.0` run을 보인다. 새로 요청하는 분석은 요청 쪽(redis-api·Vercel)이 `sol-v0.2.1`을 적는다.
- 회사 컨테이너 상태는 10-31에 다시 보지 않았다(회사 망 밖).

## 남은 것

- 재채점 쓰기(§11.7 `--changed-only`). 사용자 결정(2026-10-31)은 촬영 전 실행이다. 실행 결과는 이 문서에 더한다.
- 재채점 뒤 실공고 권고 수와 S-LIVE 동국대 run을 다시 읽어 덱 명세에 넘긴다. dry-run 기준으로 DEMO는 바뀌지 않는다.
