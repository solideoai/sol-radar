---
title: "IT 공고만 보이기 운영 반영 확인 (2026-10-29)"
tags: [sol-radar, evidence, it-scope, deployment]
updated: 2026-10-29
---

# IT 공고만 보이기 운영 반영 확인 (2026-10-29)

[[16-DECISIONS|ADR-069]] 운영 반영 기록이다. 스펙은 `polaris/specs/done/2026-10-29-it-bid-scope.md`.

## 반영

| 순서 | 단계 | 결과 |
|---|---|---|
| 1 | 운영 DB | `20261029000300_it_bid_scope.sql`·`20261029000400_bid_list_it_scope.sql` 적용(`db-push.sh --check` 로 미적용 2개만 확인 뒤). `db-verify` 통과(마이그레이션 68개) |
| 2 | main | `cbfcc363`(코드) · `7f6909ec`(문서) push. push 전 검사 통과(공통·ai·web). GitHub Vercel 상태 생성 14:10 |
| 3 | Vercel | GitHub 상태 `Vercel success`, `/health/ready` 200. 화면 확인은 14:12~14:15 |
| 4 | 회사 dry-run | 별도 worktree `/data/www/ai_workspace/sol-radar-itbatch`(detached `7f6909ec`)에서 일회용 이미지 `sol-radar-analysis-worker:7f6909ec3fa7`(`c8ef1a7c…`, 14:19) 빌드. 배포 checkout `sol-radar-deploy` 는 `384e469857f0` 그대로, `sol-radar-app` 은 `cbb3831e86da` 그대로. `docker compose … run --rm --no-deps analysis-worker … it-batch-analyze.ts --org-slug org-01 --dry-run` → `it-batch: dry-run targets=371 skipped_no_source=3`, exit 0. 운영 Analysis Worker 컨테이너 ID·시작 시각 전후 같음 |
| 5 | 일괄 분석 실행 | 사용자 승인 뒤 같은 이미지·같은 compose 로 `--org-slug org-01 --max-in-flight 2`, `nohup` 으로 회사에서 돌렸다(로그 `/data/www/ai_workspace/sol-itbatch-20261029/run.log`). 14:20 시작, 16:28 끝. 마지막 줄 `it-batch: targets=371 skipped_no_source=3 enqueued=371 existing=0 completed=371 partial=0 failed=0 unfinished=0`, exit 0 |

## 일괄 분석 결과 (운영 DB 읽기)

- 멱등 키 `it-batch-` run 371건 모두 `COMPLETED`, `PARTIAL` 0·`FAILED` 0. 요청자(`requested_by`) 있는 run 0건.
- 권고는 371건 모두 보류(WATCH)다. SOL Score 최소 23·중간값 45·최대 60. 한 건 평균 38초(생성→완료, 대기 포함).
- 분석 중 outbox 에 생긴 이벤트는 수집의 `BID_CREATED` 173·`BID_CHANGED` 22 뿐이다. 분석 완료·추천 알림 이벤트는 없다.
- 운영 Analysis Worker(`384e469857f0`)는 시작 시각 `02:34:58Z`, 재시작 0 그대로다. 일회용 컨테이너는 `--rm` 으로 지워졌다. 별도 worktree `sol-radar-itbatch` 와 이미지 `sol-radar-analysis-worker:7f6909ec3fa7` 는 남겨 두었다.
- 분석 뒤 `/bids`(1440·1280): "IT 공고 446건"(15:00 정기 수집분 포함), 맨 위가 분석된 AI 공고(60·60·58·58…). `/projects` 검토 대기는 3건 그대로(일괄 분석 run 제외, [[16-DECISIONS|ADR-069]] 6번). 그림 `bids-after-batch-1440.png`·`bids-after-batch-1280.png`.

## 운영 DB 읽기 확인 (org-01, 입찰공고·진행 중)

| 출처 | IT 범위 | 전체 | AI 묶음 | SI 묶음 | 나머지 |
|---|---|---|---|---|---|
| 실공고 | 409 | 2,168 | 53 | 342 | 14 |
| DEMO | 15 | 15 | 2 | 0 | 13 |

- DEMO 는 늘 IT 범위다. 운영 DEMO 공고는 관련성 분류가 없어 분야가 "미분류"이고, 제목에 AI 단어가 있는 2건만 AI 묶음이다.
- 분석된 실공고 3건(부경대 38·동국대 44·재난 정신건강 45)은 모두 IT 범위라 그대로 보인다. S-LIVE 촬영 공고(동국대 44)도 남는다.
- 공식 분류가 IT인 나라장터 분류명 15종을 확인했다. IT가 아닌 분류명은 없었다. `정보화교육서비스` 2건은 IT 분류라 남는다.

## 화면 확인 (로그인, 1440·1280)

| 화면 | 확인한 것 | 그림 |
|---|---|---|
| `/bids` | "IT 공고 409건", 맨 위가 AI·AX 공고, 칩 8개·"AI·SI 우선" 켬·정렬 "추천순" | `bids-live-1440.png`·`bids-live-1280.png` |
| `/bids?origin=demo` | "IT 공고 15건", AI 묶음(인천 챗봇·광주 AI 행정 비서) 먼저, FX-02(경기도교육청) 미분석 | `bids-demo-1280.png` |
| `/dashboard` | "우선 검토할 입찰" 설명 "AI·SI 우선 · 추천순", 수집 지표 "수집된 IT 공고 449", 금지어 0 | `dashboard-live-1280.png` |
| `/dashboard?origin=demo` | 분석 대기 1·추천 권고 0(덱 명세 클립 1 기대값과 같다), 수집된 IT 공고 15 | `dashboard-demo-1440.png` |
| `/workforce` | 공고 고르기 선택지가 IT 공고만(AX 솔루션·정보시스템 유지보수 등) | `workforce-1280.png` |
| `/bids/programs` | IT 관련 지원사업 30건 | `programs-1280.png` |
| `/calendar` | "IT 공고의 일정입니다" | `calendar-1280.png` |
| `/market` | 최근 90일 게시 공고 415 "IT 공고만", 금지어 0 | `market-1280.png` |
| `/gaps` | 대상 공고 377 "마감 전 · IT 공고" | `gaps-1280.png` |
| `/projects` | 검토 대기 3건(분석된 실공고 3건) | — |

- 10개 화면 모두 1440·1280 에서 가로 넘침 0px(`scrollWidth = clientWidth`), "읽지 못했습니다" 오류 없음.
- 지원사업 30건에는 관련성 규칙(`relevance-v0.1`, 이번에 바꾸지 않음)이 IT로 본 "스마트 물류장비"·"탄소중립 그린도시 리빙랩" 같은 공고가 섞인다.

## 관련 문서

- [[16-DECISIONS|결정 기록]]
- [[PROGRESS|진행 상황]]
