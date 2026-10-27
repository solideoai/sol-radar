---
title: "11-04 발표용 DEMO 공고 마감 +15일 이동 실행서와 리허설"
status: review
tags: [sol-radar, db, ops, demo]
updated: 2026-10-27
---

# 11-04 발표용 DEMO 공고 마감 +15일 이동 실행서와 리허설

운영 DB(Supabase `brtysdocxemrqhdezzqg`)의 가상(DEMO) 공고 마감을 15일 뒤로 옮기는 1회용 데이터 작업이다. 공식 제출은 2026-11-03이고, 발표는 2026-11-04에 운영 사이트 `?origin=demo` 로 한다(사용자 결정 2026-10-27, [[../../integration/20261025-release-runbook|10-25 release 실행서]] D1). 운영 DEMO 공고 19건은 2026-10-20 13:58 KST 에 seed 했다. 마감을 15일 옮기면 11-04 화면이 seed 당일과 같은 상대 상태가 된다(FX-02 D-10, 마감 임박 1건, 열린 공고 15건).

**이 작업은 운영 DB 에 접속하지 않았다.** SQL 은 로컬 PGlite 와 PostgreSQL 17.11 컨테이너에서만 돌렸다. 운영 실행은 사용자 승인 뒤 메인 세션이 한다. migration 이 아니다. `supabase/migrations/` 는 고치지 않았다.

> [!warning] 실행 기한
> 운영 적용은 FX-02 의 지금 마감 **2026-10-30 18:00 KST** 전에 끝낸다. 10-28 리허설 전에 끝내면 리허설 화면도 발표 당일과 같아진다.

## 파일

| 파일 | 하는 일 | DB 쓰기 |
|---|---|---|
| `01-check.sql` | 사전 조회. Q1 대상 19건, Q2 점검 보고(A 실행 조건 · B 대상 표 sha256 · C 비대상 행 수 · D 날짜 JSON 경로), Q3 기준 시각별 화면 숫자, Q4 D-day, Q5 FX-02 분석·결정 | 없음 |
| `02-shift.sql` | 한 트랜잭션에서 마감 이동, 기록 스키마 `demo_deadline_shift_20261027` 생성. 기본값은 dry-run | 있음 |
| `03-verify.sql` | 적용 뒤 확인. 대상 38행(공고 19·revision 19. 그중 마감 있는 32행은 +15일, 마감 없는 6행은 그대로), 다른 열, 대상 밖 행(실공고·분석 기록) | 없음 |
| `04-rollback.sql` | 기록 스키마의 옮기기 전 값으로 정확히 되돌림. 기본값은 dry-run | 있음 |
| `rehearsal-pglite.log` · `rehearsal-pg17.log` | 리허설 출력 | — |

## 옮길 것·둘 것

옮기는 곳은 두 곳, 32행이다. 둘 다 **마감 있는 DEMO 공고 16건**의 값이다(19건 중 3건은 마감이 없다).

| 위치 | 결정 | 이유 |
|---|---|---|
| `bid_notices.deadline_at` (16행) | **+15일** | 목록·대시보드·D-day·상태(마감 여부)·마감 알림이 모두 이 값을 읽는다. 상태 `CLOSED` 는 저장하지 않는다. 읽을 때 `deadline_at < now()` 로 계산한다(`opportunity_list_items`·`effectiveStatus`). 상태를 고칠 일이 없다 |
| `bid_revisions.normalized -> 'deadlineAt'` (같은 16건, revision 1) | **+15일**(같은 순간의 `YYYY-MM-DDTHH:MI:SS.000Z` 글자) | 재분석 입력이다. 점수의 일정 요소(`staffAvailability` 의 영업일 계수·기본 사업 기간)는 공고 표가 아니라 이 값으로 계산한다. 옮기지 않으면 11-04 재분석이 옛 마감으로 계산된다 |
| `bid_notices.published_at`, `normalized.noticeDate` | 둠 | 게시일은 지난 사실이다. 점수에 쓰지 않는다. 옮기면 10-28~11-02 리허설 동안 게시일이 미래(예: 11-02)로 보인다 |
| `bid_notices.fetched_at`·`created_at`·`last_synced_at`, `normalized.fetchedAt` | 둠 | 수집 기록이다. 화면 날짜와 무관하다 |
| `bid_notices.updated_at` | 둠 | 트랜잭션 안에서만 `bid_notices_touch_updated_at` 트리거를 끄고 커밋 전에 다시 켠다. 03 이 "적용 뒤 수집이 바꾼 행"을 `updated_at` 으로 가리므로 그대로 둬야 한다 |
| `bid_opportunities.first_seen_at`, `opportunity_notice_links.decided_at` | 둠 | 목록·대시보드가 `first_seen_at <= 기준 시각` 으로 거른다. 옮기면 11-04 13:58 KST 전까지 DEMO 공고가 화면에서 사라진다. 그래서 11-04 "신규 발견"은 0 이다(seed 당일은 15) |
| `bid_revisions.checksum`·`content_hash`·`raw_payload` | 둠 | `raw_payload` 는 상대일(`+10d`) 글자라 날짜가 없다. checksum 은 옛 normalized 기준으로 남는다. 운영 worker 는 live 모드라 fixture 출처를 받지 않아(`acceptsSource`) 다시 계산할 곳이 없다 |
| revision 2 를 새로 만드는 방법 | 쓰지 않음 | 공고 이력에 "마감 변경"이 생기고, S5 변경 감지·알림 흐름에 섞인다 |
| `score_runs`(`input_snapshot`·hash)·`score_factors`·`requirement_extractions` | 둠 | 분석 당시 입력 기록이다. 재현성 hash 를 깨지 않는다. 가정 재계산(BOOST-2)·인력 배치(N7)·분석 비교(N5)는 이 snapshot 만 읽는다 |
| `bid_reviews`, 업무 배정(`assignments`, 2027 절대 날짜), `ingest_runs.params.anchor`, outbox·notifications payload | 둠 | 결정·이력이다. 발표 날짜와 무관하다 |
| `bid_projects.submission_due_override` | 확인만 | 대상에 값이 있으면 02 가 `DDS_OVERRIDE_PRESENT` 로 멈춘다. 있으면 같이 옮길지 사람이 정한다(로컬 0건) |

옮긴 뒤 마감(모두 18:00 KST):

| FX | 공고 | 지금 | 옮긴 뒤 | 11-04 D-day |
|---|---|---|---|---|
| FX-14 | 광주 AI 행정 비서 | 10-22 | 11-06 | D-2 |
| FX-18 | 과기정통부 AI 행정서비스 사전규격(PRE_SPEC) | 10-27 | 11-11 | D-7 |
| FX-19 | 세종 행정정보 연계 플랫폼 사전규격(PRE_SPEC) | 10-27 | 11-11 | D-7 |
| FX-02 | 경기도교육청 통합 LMS | 10-30 | 11-14(토) | D-10 |
| FX-04 | NIA 데이터 거버넌스 컨설팅 | 11-01 | 11-16 | D-12 |
| FX-06 | 대전 스마트시티 유지보수 | 11-03 | 11-18 | D-14 |
| FX-10 | 강원 관광정보시스템(재공고) | 11-03 | 11-18 | D-14 |
| FX-03 | 부산 CCTV 통합관제 | 11-04 | 11-19 | D-15 |
| FX-08 | 충북 농업기술정보 | 11-05 | 11-20 | D-16 |
| FX-07 | 도로공사 교통정보 | 11-07 | 11-22 | D-18 |
| FX-13 | 울산 산업안전 | 11-08 | 11-23 | D-19 |
| FX-05 | 건보 대국민 포털 | 11-09 | 11-24 | D-20 |
| FX-16 | 국방부 지휘통제 SW | 11-09 | 11-24 | D-20 |
| FX-01 | 세종 차세대 행정정보 | 11-10 | 11-25 | D-21 |
| FX-09 | 서울 공공데이터 개방 | 11-14 | 11-29 | D-25 |
| FX-15 | 행안부 지방행정 공통기반 | 11-19 | 12-04 | D-30 |
| FX-11·FX-17·FX-20 | 인천 챗봇·과기정통부 발주계획·경남 발주계획 | 없음 | 없음 | — |

### 왜 +15일인가

점수식(`web/server/scoring`)을 fixture 팀·프로필로 다시 계산해 이동량을 견줬다. 일정 계수는 영업일 10 이상 1.0, 5 이상 0.7, 그 밖 0.4 다.

| FX | seed 10-20 | 11-04 · 이동 없음 | 11-04 · +14일 | 11-04 · **+15일** | 10-28 · +15일 |
|---|---|---|---|---|---|
| FX-01 | 94 BID | 82 BID | 94 BID | **94 BID** | 94 BID |
| FX-02 | 72 WATCH (영업일 8) | 66 WATCH (0) | 72 WATCH (7) | **72 WATCH (8)** | 78 BID (13) |
| FX-06 | 78 BID | 66 WATCH | 72 WATCH | **78 BID** | 78 BID |
| FX-07 | 76 BID | 64 WATCH | 76 BID | **76 BID** | 76 BID |
| FX-10 | 65 WATCH | 53 WATCH | 59 WATCH | **65 WATCH** | 65 WATCH |
| FX-14 | 65 WATCH | 65 WATCH | 65 WATCH | **65 WATCH** | 71 WATCH |
| FX-18 | 82 BID | 76 BID | 76 BID | **82 BID** | 88 BID |
| FX-19 | 93 WATCH | 87 WATCH | 87 WATCH | **93 WATCH** | 99 WATCH |

+15일이면 11-04 의 18건 점수·권고가 seed 당일과 모두 같다. 표에 없는 FX-03·04·05·08·09·11·15·16·17·20 도 +14·+15일에서 seed 당일과 같다. 옮기지 않으면 마감 있는 공고 대부분의 점수가 6~12점 떨어진다. FX-13 은 계산 보조가 입력을 만들지 못해 비교에서 뺐다.

요일을 지키는 +14일은 FX-06·FX-10·FX-18 이 바뀐다. +15일은 요일이 하루 밀려 FX-02 마감이 토요일(11-14)이 된다. 주말 마감은 FX-02·07·09 3건이다(지금은 FX-04·07·09·13 4건). 웹 화면은 요일을 보이지 않는다(`MM.DD`·D-day). 카카오 피드만 `(토)` 를 붙인다.

## 영향받는 화면

리허설 DB(운영과 같은 DEMO 19건, 로컬 전용 가장자리 행은 뺌)에서 01 Q3·Q4 로 센 값이다. 날짜에만 기대는 숫자다. BID 권고·WATCH 수는 운영 분석 기록에 따라 다르다. 운영 값은 01 Q3 로 본다.

| 기준 시각 | 이동 전: 목록 기본 / 마감 임박(7일) / 마감됨 | 이동 뒤 |
|---|---|---|
| 10-28 10:00 KST | 14 / 4 (FX-02·04·06·10) / 1 (FX-14) | 15 / 0 / 0 |
| 11-03 10:00 KST | 12 / 8 / 3 | 15 / 1 (FX-14) / 0 |
| 11-04 14:00 KST(발표) | 10 / 7 / 5 | **15 / 1 (FX-14) / 0** |

seed 당일(10-20 13:58) 마감으로 세어도 목록 15, 마감 임박 1(FX-14 D-2), 마감 0 이다.

- 대시보드 카드(`procurement_summary`): 마감 임박. BID 권고·진행 중 WATCH 에서 마감된 공고가 빠지지 않는다.
- 입찰 공고 목록(기본 필터 OPEN·AMENDED, 계산된 상태)과 마감 열(`MM.DD`, D-day). FX-14 는 지금 "마감"인데 다시 열린다(10-27 기준 D-10).
- 공고 상세 D-day, 입찰 프로젝트 마감(`submission_due_override ?? deadline_at`).
- 마감 알림(D-3·D-1 인앱, `send_deadline_reminders`) 시각.
- 재분석 결과(일정 요소). 기존 분석 화면·가정 재계산·인력 배치(N7) 기간은 분석 당시 snapshot 그대로다. 새 마감으로 보려면 재분석해야 한다.
- 영향 없음: 게시일, 신규 발견(`first_seen_at`), 단계 타임라인(날짜를 안 씀), 실공고 전부.

## 실행 순서(운영)

운영 연결 역할은 `postgres`(표 주인)다. 10-26 DEMO 백업과 같은 방법으로 Supabase MCP `execute_sql` 또는 `psql -v ON_ERROR_STOP=1 -f` 로 보낸다.

1. **01 조회.** `01-check.sql` 을 돌린다. MCP 로 Q 를 하나씩 보내면 각 Q 앞에 `set timezone to 'UTC';` 를 붙인다.
   - Q2 A 절 14줄이 모두 `ok=true`, A14 "02 를 돌려도 되는가"가 `예` 여야 한다. 하나라도 아니면 멈춘다.
   - A12 실행 역할 권한이 `true` 여야 한다. 트리거를 끄려면 표 주인이어야 한다.
   - Q2 B 절 sha256 을 적어 둔다. 10-26 이후 DEMO 공고·revision 이 그대로면 `bid_notices` 는 `714b6fbd…`, `bid_revisions` 는 `43353944…` 이다([[../../demo-cleanup/20261026/summary|10-26 DEMO 정리]] 조회값). 달라도 02 는 막지 않는다(참고 값).
   - Q2 D 절에 `normalized.deadlineAt`·`.fetchedAt`·`.noticeDate` 말고 다른 날짜 경로가 보이면 멈춘다.
   - Q3·Q4·Q5 결과를 저장한다(이동 뒤 비교용).
2. **02 dry-run.** `02-shift.sql` 을 그대로 한 번에 보낸다. `ERROR: DRY_RUN_ROLLBACK: 모든 확인 통과(공고 16·revision 16 …, 대상 밖 묶음 13 개 그대로)` 가 나와야 한다. 아무것도 남지 않는다.
3. **02 적용.** `v_dry_run constant boolean := true;  -- ←` 한 줄만 `false` 로 바꿔 한 번에 보낸다. 끝의 SELECT 가 19행, `ok` 가 모두 true 여야 한다. 공고·revision 표를 1초 남짓 `share row exclusive` 로 잠근다. 수집 worker 쓰기는 기다린다. 5초 안에 못 잠그면 `lock_timeout` 으로 멈추고 아무것도 바뀌지 않는다. 그때는 다시 돌린다.
4. **03 확인.** `03-verify.sql`: Q1 38행이 모두 true, Q2 `ok` 가 모두 true 여야 한다. D 절의 `changed_after`·`new` 는 적용 뒤 수집이 바꾼 실공고라 정상이다. `changed_other`·`missing` 은 0 이어야 한다.
5. **01 다시.** Q1 상태가 `SHIFTED`(마감 없는 3건은 `NO_DEADLINE`)로 바뀐다. Q3·Q4 를 1단계 결과와 견준다. 화면은 `?origin=demo` 대시보드·입찰 공고 목록을 1440·1280 폭에서 본다.

### 되돌리기

1. `04-rollback.sql` 을 그대로 보낸다. `DRY_RUN_ROLLBACK` 이 나와야 한다.
2. `v_dry_run` 한 줄만 `false` 로 바꿔 보낸다. 38행 모두 `restored=true` 여야 한다.
3. 01 을 다시 돌린다. Q2 B 절 sha256 이 1단계 값과 같아야 한다.

- 02 적용 뒤 누가 대상 공고·revision 을 바꿨으면 04 는 `DDR_STATE_CHANGED` 로 멈춘다. 덮어쓰지 않는다. 사람이 원인을 본다.
- 기록 스키마는 지우지 않는다. 그래서 04 뒤 02 를 다시 돌리면 `DDS_ALREADY_APPLIED` 로 막힌다. 다시 옮겨야 하면 사람이 확인한 뒤 `drop schema demo_deadline_shift_20261027 cascade;` 를 돌리고 01 부터 한다. PG17 리허설 2회차가 이 길로 돌았다.
- **발표 뒤 DEMO 정리(실운영 전환 A단계)는 04 로 되돌린 뒤에 한다.** 10-26 백업 표(`demo_cleanup_20261026.backup`)가 옮기기 전 행을 담고 있다. 정리 실행서는 이 백업과 대조한다. 리허설·발표에서 새로 생긴 분석·결정은 이 작업과 별개로 정리 실행서가 다룬다. 정리를 끝낸 뒤 기록 스키마를 지울지는 사람이 정한다.

### 안전장치

02·04 는 하나라도 어긋나면 트랜잭션 전체가 되돌아간다. 반쯤 적용되는 경우는 없다.

| 코드 | 언제 |
|---|---|
| `DDS_ALREADY_APPLIED` | 기록 스키마가 이미 있다 |
| `DDS_PRIVILEGE` | 실행 역할이 `bid_notices` 주인의 권한이 없다. 또는 `bid_revisions` UPDATE·DB CREATE 권한이 없다 |
| `DDS_TARGET_MISMATCH` | 조건(`is_demo AND source='fixture'`)에 맞는 공고가 목록 19건과 다르다. 또는 마감이 기존 값이 아니다 |
| `DDS_REVISION_MISMATCH` | revision 이 19건(모두 1차·latest)이 아니다. 또는 `normalized.deadlineAt` 이 공고 마감과 다른 글자다 |
| `DDS_SHAPE` · `DDS_LINK_FOREIGN` · `DDS_OVERRIDE_PRESENT` | normalized 모양이 다르다 · 대상 사업기회에 실공고가 묶였다 · 프로젝트 마감 덮어쓰기가 있다 |
| `DDS_TRIGGER` | `updated_at` 트리거가 처음부터 꺼져 있었다. 또는 다시 켜지지 않았다 |
| `DDS_UPDATE_COUNT` · `DDS_VERIFY` | 바뀐 행이 16·16 이 아니다 · 옮긴 열만 되돌린 행 해시가 옮기기 전과 다르다 |
| `DDS_COLLATERAL` | 같은 스냅샷에서 13개 묶음의 해시가 달라졌다. 묶음은 대상 밖 공고·revision 과, 사업기회·연결·분석·요인·추출·결정·첨부·프로젝트·outbox·알림·감사 표 전체다 |
| `DDS_LOG_EXPOSED` | 기록 스키마에 `public`·`anon`·`authenticated`·`service_role` 권한이 남았다 |
| `DDR_*` (04) | 적용 안 됨 · 이미 되돌림 · 적용 뒤 행이 바뀜 · 권한 · 트리거 · 행 수 · 해시 |

## 리허설 결과(2026-10-27, 운영 접속 없음)

두 엔진에서 같은 seed 로 돌렸다. seed 는 `seedFixtureBids`(demo:reset 과 같은 적재, RPC `ingest_save_revision`), anchor 10-20 13:58 KST, migration 60개다. 운영 모양도 흉내 냈다. FX-02 LIVE 66 WATCH(10-24)와 그 결정, 분석 19건, 결정 3건, 실공고와 그 분석이 있다. 가장자리 행 2건도 넣었다(`is_demo=false` fixture, `is_demo=true` g2b).

| 단계 | PGlite 0.5.10 (PG 18.6) | PostgreSQL 17.11 (역할 `postgres` 비-superuser, `PGTZ=Asia/Seoul`, psql) |
|---|---|---|
| 01 처음 | Q1 19행(BEFORE 16·NO_DEADLINE 3), A 절 모두 ok | 같음. A12 권한 `주인 postgres / 실행 postgres / true` |
| 02 dry-run | `DRY_RUN_ROLLBACK`, 대상 행·01 결과 그대로, 스키마 없음 | 같음(psql exit 3) |
| 02 적용 | 19행 모두 ok | 같음(exit 0) |
| 적용 뒤 수집 흉내 | 실공고 1건 제목 정정, 새 실공고 1건 | 같음 |
| 03 | Q1 38행 어긋남 0. Q2 모두 ok. D 절 공고 same 7·changed_after 1·new 1, changed_other·missing 0 | 같음 |
| 02 재실행 | `DDS_ALREADY_APPLIED`, 행 그대로 | 같음 |
| 기록 스키마 노출 | 02 안의 검사 통과 | `anon`·`authenticated`·`service_role` 모두 `permission denied for schema` |
| 04 dry-run → 04 | `DRY_RUN_ROLLBACK` → 38행 모두 restored | 같음 |
| 04 뒤 비교 | 대상 공고 19·revision 19 행 JSON 전체 = 처음. 01 B 절 sha256 6개 = 처음. Q1·Q3·Q4·Q5 = 처음 | 대상 행 sha256 `4efe1352…` = 처음. 01 B 절 = 처음 |
| 04·02 재실행 | `DDR_ALREADY_ROLLED_BACK` · `DDS_ALREADY_APPLIED` | 같음 |
| 재적용(drop schema → 01 부터) | — | 2회차 전체가 1회차와 같은 결과 |

01 Q2 의 처음과 04 뒤 차이는 기록 스키마 있음·02 가능 `아니오`·수집 흉내로 늘어난 비대상 행 수뿐이다. 로컬 B 절 sha256 은 `bid_notices` `caf19b73…` → 적용 뒤 `e09e3cf4…` → 04 뒤 `caf19b73…`, `bid_revisions` `4fbce798…` → `a672f368…` → `4fbce798…` 이다. 두 엔진 값이 같다. PG17 로 옮긴 13개 표·208행은 표마다 행 JSON 해시가 PGlite 와 같았다.

음성 시험(PGlite 복제 DB, 모두 행 그대로·스키마 없음):

| 바꾼 것 | 02·04 결과 |
|---|---|
| FX-02 마감 1분 다름 | `DDS_TARGET_MISMATCH` |
| FX-02 `normalized.deadlineAt` 글자 다름 | `DDS_REVISION_MISMATCH` |
| 조건에 맞는 목록 밖 공고(`is_demo=false` fixture 를 true 로) | `DDS_TARGET_MISMATCH` |
| 대상 사업기회에 실공고 연결 | `DDS_LINK_FOREIGN` |
| 트리거가 이미 꺼짐 | `DDS_TRIGGER` |
| 대상 revision 2 추가 | `DDS_REVISION_MISMATCH` |
| 주인이 아닌 역할(UPDATE·CREATE 는 있음, PG17) | `DDS_PRIVILEGE` |
| 02 뒤 대상 공고를 바꾸고 04 | `DDR_STATE_CHANGED` |

## 운영에서 예상하는 변경

- UPDATE: `bid_notices` 16행(`deadline_at` 만), `bid_revisions` 16행(`normalized.deadlineAt` 만). 다른 행·표는 바뀌지 않는다(`DDS_COLLATERAL` 이 13개 묶음을 확인).
- 새 스키마 `demo_deadline_shift_20261027`: `meta` 1행, `notice_log` 19행, `revision_log` 19행, `guard_rows`. `guard_rows` 는 대상 밖 공고·revision·score_runs·requirement_extractions 행마다 1행이다(01 Q2 C 절 숫자, 10-27 기준 실공고 592건 안팎). RLS 를 켜고 네 역할 권한을 모두 거둔다.
- DDL(스키마·표 생성, 트리거 끄고 켜기)에 Supabase 기본 이벤트 트리거(PostgREST 스키마 다시 읽기 등)가 반응한다. 10-26 백업 표 생성 때와 같다.

## 남은 위험

1. **운영 엔진 차이.** PG17.11 과 비-superuser 역할 `postgres` 로는 리허설했다. Supabase 기본 이벤트 트리거 7개(`ensure_rls` 등)는 재현하지 않았다. 10-26 백업(같은 모양의 스키마·표 생성)은 운영에서 오류 없이 돌았다.
2. **잠금.** 수집 worker 가 3시간마다 돈다. 겹치면 02·04 가 최대 5초 기다리다 멈출 수 있다. 다시 돌리면 된다.
3. **마감 알림.** idempotency key 에 마감이 없다(`<bidId>:<userId>:DEADLINE_APPROACHING:D-n`). 그래서 옛 마감 기준 D-3 가 이미 나갔으면 새 마감 D-3 는 다시 안 나간다. 리허설 중 FX-14 에 관심 등록·담당자를 두면 11-03 에 D-3, 11-05 에 D-1 인앱 알림이 간다.
4. **오래된 checksum.** 대상 16건의 checksum 은 옛 normalized 기준이다. 운영 live worker 는 fixture 를 받지 않아 문제가 없다. 운영에서 fixture 적재(`demo:reset`)는 돌리지 않는다.
5. **신규 발견 0.** 11-04 DEMO "신규 발견" 카드는 0 이다(seed 당일 15). `first_seen_at` 을 옮기면 공고가 화면에서 사라져서 일부러 둔다.
6. **기존 분석의 날짜.** 18건의 기존 분석과 FX-02 의 10-24 분석은 옛 마감 snapshot 이다. 점수 근거·인력 배치 기간이 옛 날짜로 보일 수 있다. 새 마감으로 보이려면 재분석한다.
7. **DEMO 정리와의 순서.** 정리 실행서의 백업 대조는 옮기기 전 값 기준이다. 정리 전에 04 로 되돌린다.
8. **운영 migration 차이.** 01 이 표·열 없음 오류로 실패하면 운영 스키마가 저장소(60개, `20261025000310` 까지)와 다르다. 그때는 멈춘다.

## S4 "FX-02 즉석 분석" 점검(보고만, 고치지 않음)

설계(19 데모 시나리오 S4)는 FX-02 를 `미분석` 으로 두고 발표에서 라이브 분석한다. 운영 FX-02 에는 이미 10-24 LIVE 분석(66 WATCH)과 결정(WATCH)이 있다. 그래서 발표 화면은 `미분석` 이 아니라 분석 완료 66 WATCH 와 결정 기록으로 시작한다. DEMO 19건 모두 분석이 있어 다른 `미분석` DEMO 공고도 없다.

66 의 원인은 일정 요소로 보인다(추정, 점수식 재계산과 일치). 10-24 기준 마감 10-30 까지 영업일이 5 미만이라 일정 계수가 0.4 였다. seed 당일 골든 72 는 계수 0.7 이다. 이동 뒤 재분석 예상(AI 추출이 mock 과 같을 때):

| 재분석 날짜 | FX-02 영업일 | 예상 |
|---|---|---|
| 10-28 ~ 11-02 | 10 이상 | **78 BID** |
| 11-03 · 11-04 | 9 · 8 | 72 WATCH (골든과 같음) |

선택지:

1. **(추천) 발표 당일 S4 를 "재분석"으로 진행한다.** 66 WATCH 가 보이는 상태에서 [재분석] 을 누르면 72 WATCH(새 마감 D-10 기준)가 된다. 데이터를 지우지 않는다. 10-28~11-02 리허설에서는 FX-02 재분석을 피한다. 그때 하면 78 BID 가 최신 분석이 되고, BID 권고 알림(카카오·메일을 켰다면)과 대시보드 BID 수가 바뀐다. 11-03 이후 재분석은 다시 72 WATCH 가 된다. 대본 문구만 "즉석 분석" → "즉석 재분석"으로 바꾼다.
2. FX-02 의 분석·결정 기록을 지워 `미분석` 으로 되돌린다. 별도 승인과 별도 SQL·되돌리기가 필요하다. 10-26 백업 대조와도 어긋난다(정리 전 복원 필요).
3. 재분석 없이 기존 66 WATCH 로 설명한다. 안전하다. 다만 66 은 옛 마감(영업일 4) 기준이라 화면의 D-10 과 일정 근거가 맞지 않는다.

## 관련 문서

- [[../../demo-cleanup/20261026/summary|10-26 DEMO 공고 정리 실행서]]
- [[../../integration/20261025-release-runbook|10-25 release 실행서]]
- [[2026-10-26-live-ops-cutover|실운영 전환 계획]]
- [[19-DEMO-SCENARIO|19 데모 시나리오]]
