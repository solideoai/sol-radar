---
title: "10-26 운영 DEMO 공고 19건 정리 실행서와 격리 리허설"
status: done
tags: [sol-radar, evidence, demo-cleanup, database, runbook]
updated: 2026-10-26
---

# 10-26 운영 DEMO 공고 19건 정리 실행서와 격리 리허설

운영 DB(Supabase 프로젝트 `brtysdocxemrqhdezzqg`)에서 DEMO 공고 19건(`source='fixture'`, `is_demo=true`)과 분석 기록(`score_runs`) 19건, 거기 딸린 행을 지우는 실행서다. 같은 실행서를 격리 로컬 Supabase 에서 끝까지 돌려 삭제와 복구를 검증했다.

**이 작업은 운영 DB 에 접속하지 않았다.** 운영 행 수 가운데 이 문서가 아는 것은 공고 19건·score_runs 19건뿐이다. 이 두 숫자는 다른 세션이 읽기 전용으로 확인한 값이다([[../../live-default-origin/20261026/summary|10-26 실공고 기본 출처 확인]]). 나머지 운영 행 수는 01 을 돌려야 알 수 있다.

## 산출물

| 파일 | 하는 일 | 운영 DB 변경 |
|---|---|---|
| `01-inventory.sql` | Q1 대상 목록, Q2 영향 보고(A 대상·B 대상 행·C 차단·D 보존), Q3 Storage 객체 목록 | 없음 |
| `02-backup.sql` | 지우거나 바꿀 행을 표별 JSON 으로 내보낸다. meta 1행과 표 25개, 모두 26행. 표마다 행 수와 sha256 을 단다 | 없음 |
| `02b-backup-in-db.sql` | 02 와 같은 백업을 운영 DB 안의 `demo_cleanup_20261026.backup` 표 하나에 남긴다. `begin`…`commit` 한 트랜잭션이다. `public`·`anon`·`authenticated`·`service_role` 권한을 거두고, 커밋 전에 권한이 남았으면 `DC_BACKUP_EXPOSED` 로 전체를 되돌린다. 끝의 확인 SELECT 두 개(26행 `sha_ok`, 네 역할 권한)는 커밋 뒤에 돈다 | **있음**(새 스키마와 표 1개) |
| `03-delete.sql` | DO 블록 하나라 한 트랜잭션이다. 대상과 범위 행을 잠그고, 차단 검사(C41~C57)와 백업 대조를 한 뒤, 자식부터 지우고, 사후 검사까지 한다. `v_dry_run` 의 기본값은 true 다 | **있음**(dry-run 이 false 일 때만) |
| `04-restore.sql` | 백업(02 JSON 또는 02b 표)에서 FK 순서대로 되살리고, 기본 키 기준 sha256 으로 검증한다. Storage 원장이 03 의 보호 상태일 때만 되돌린다. `v_dry_run` 의 기본값은 true 다 | **있음**(dry-run 이 false 일 때만) |

리허설 스크립트·로그·덤프는 세션 임시 폴더(`scratchpad/demo78/`, 리뷰 반영 회차는 `scratchpad/demo78/r2/`)에 있다. 오래 남지 않는다.

## 대상

- 공고 19건: `DEMO-2026-0001`~`0020` 중 `0012` 를 뺀 것이다. FX-12 는 seed 때 `MISSING_REQUIRED_FIELD` 로 격리되어 공고가 되지 않는다.
- id 는 `scripts/demo/plan.mjs` 의 `demoIdFor` 가 만든 uuid v5 라서 어느 DB 에서나 같다. 01 Q1 은 목록과 조건(`is_demo AND source='fixture'`)을 full join 한다. 운영 id 가 다르면 Q1 에 바로 드러난다.
- 분석 기록 id 는 무작위다. 그래서 목록에 박지 않고 `bid_id` 로 고른다.

## 영향 표

FK 는 로컬 카탈로그(`pg_constraint`, 마이그레이션 60개 적용)에서 뽑았다. 범위 표를 가리키는 FK 는 42개다. 01 의 C 절은 실행서가 모르는 FK 가 생기면 멈춘다(`카탈로그: 범위 표를 가리키는 FK 중 이 실행서가 모르는 것`).

| 03 순서 | 표 | 대상 고르기(FK) | ON DELETE | 03 처리 | 리허설 행 수 | 운영 예상(seed·코드 기준) |
|---|---|---|---|---|---|---|
| 24 | `bid_notices` | 목록 ∩ 조건 | — | DELETE | 19 | 19(확인됨) |
| 23 | `bid_revisions` | `bid_id` | CASCADE | DELETE | 19 | 19 이상 |
| 16 | `bid_documents` | `bid_id`·(`bid_id`,`revision_id`) | CASCADE | DELETE | 18 | seed 18 |
| 15 | `bid_structured_requirements` | `bid_id`·(`bid_id`,`revision_id`) | CASCADE | DELETE | 0 | 01 로 확정 |
| 12 | `requirement_extractions` | `bid_id`·(`bid_id`,`revision_id`) | CASCADE | DELETE | 19 | 01 로 확정 |
| 11 | `score_runs` | `bid_id`·(`bid_id`,`revision_id`) | CASCADE | DELETE | 19 | 19(확인됨) |
| 8 | `score_factors` | (`score_run_id`,`org_id`) | CASCADE | DELETE | 95 | run 당 5개로 추정 |
| 10 | `qualification_checks` | `bid_id`·`score_run_id` | CASCADE | DELETE | 19 | 01 로 확정 |
| 9 | `requirement_assessments` | (`score_run_id`,`org_id`) | CASCADE | DELETE | 19 | 01 로 확정 |
| 7 | `bid_reviews` | `bid_id`·(`bid_id`,`revision_id`) | CASCADE | DELETE | 3 | seed 2 + 사용자 결정 |
| 6 | `bid_projects` | `bid_id` | CASCADE | DELETE | 1 | 01 로 확정 |
| 5 | `bid_project_events` | (`org_id`,`bid_project_id`) | CASCADE | DELETE | 1 | 01 로 확정 |
| 4 | `tasks` | (`org_id`,`bid_project_id`) | CASCADE | DELETE(`tasks_log_activity` 를 트랜잭션 안에서 끔) | 2 | 01 로 확정 |
| 13 | `assignments` | `bid_id` | CASCADE | DELETE | 2 | seed 2 |
| 14 | `bid_watches` | `bid_id` | CASCADE | DELETE | 4 | 01 로 확정 |
| 1 | `kakao_send_claims` | `bid_id` CASCADE, `notification_id`·`outbox_event_id` SET NULL | 섞임 | DELETE | 1 | 01 로 확정 |
| 2 | `notifications` | FK 없음: `payload->>'bidId'` | — | DELETE | 4 | 01 로 확정 |
| 3 | `outbox_events` | FK 없음: `aggregate_id` ∈ 공고·run·결정·프로젝트, 또는 `payload->>'bidId'` | — | DELETE | 22 | seed 19(BID_CREATED) 이상 |
| 21 | `bid_opportunities` | `canonical_notice_id` | CASCADE | DELETE | 19 | seed 19 |
| 20 | `opportunity_notice_links` | `bid_id`·`opportunity_id` | CASCADE | DELETE | 19 | seed 19 |
| 19 | `notice_match_candidates` | `left_bid_id`·`right_bid_id` | CASCADE | DELETE | 2 | seed 2 |
| 18 | `bid_notice_events` | `bid_id`·`revision_id` CASCADE, `related_bid_id` NO ACTION | 섞임 | DELETE | 19 | seed 19 |
| 17 | `bid_relevance_assessments` | `revision_id` | CASCADE | DELETE | 19 | seed 19 |
| 22 | `ingest_run_items` | `bid_id`·`revision_id` | SET NULL | UPDATE: 두 열만 null(행은 남는다). 그 항목의 run 이 `source='fixture'` 가 아니면 C57 이 막는다 | 1(합성) | 0 예상(코드는 외부 레코드에만 항목을 쓴다) |
| 25 | `document_storage_objects` | 대상 첨부의 `raw_storage_id`·`parsed_storage_id` | `bid_documents` 쪽 NO ACTION | UPDATE: `lease_until='infinity'`(정리 job 에서 보호, 행과 객체는 남는다) | 2 | 01 로 확정 |

남기는 것(03 이 지우지 않는다):

- `audit_logs`: append-only 감사다. 리허설에서 대상을 가리키는 감사는 22행이었다.
- `activities`
- `ingest_runs`·`ingest_errors`·`ingest_payloads`: fixture run 도 남긴다.
- 조직·계정·멤버십·회사 프로필, 가상 직원 200명과 명부
- `is_demo=false` 공고 전부
- Storage 객체

FK 없이 id 를 들고 있는 곳:

| 위치 | 담는 것 | 처리 |
|---|---|---|
| `notifications.payload.bidId` | 공고 id | 지운다 |
| `outbox_events.aggregate_id`·`payload.bidId` | 공고·run·결정·프로젝트 id | 지운다 |
| `audit_logs.target_id`·`before`/`after` | 공고·run·결정·프로젝트 id | 남긴다. 03 뒤 고아 감사가 된다(리허설 19+3) |
| `kakao_send_claims.claim_key` | `BID:<user_id>:<bid_id>`(추천 공고 알림) 또는 `TEST:<outbox_event_id>`(카카오 연결 시험). 형식은 `claim_kakao_notification`·`claim_kakao_test`(`supabase/migrations/20261023000704_kakao_send_claims.sql`), 조회는 `web/server/notifications/kakao.repo.ts` | 03 은 `claim_key` 를 보지 않고 `bid_id` 가 대상 공고인 행만 지운다. `bid_id` 가 없는 `TEST:` claim(outbox 쪽)은 남는다. `claim_key` 는 외부 발송 중복을 막는 기록일 뿐 FK 가 없다(FK 는 `bid_id` CASCADE, `outbox_event_id`·`notification_id` SET NULL 뿐이고, 남는 claim 이 지울 알림·outbox 를 가리키면 C49 가 막는다) |
| `ingest_payloads` | fixture 원문 | 남긴다 |

Qdrant 쪽은 코드에서 공고 벡터를 쓰는 경로를 찾지 못했다. `services/ai` 의 `QDRANT_FALLBACK` 메모만 있다(grep 기준).

트리거: 범위 표에 DELETE 를 막는 트리거는 없다. DELETE 에 반응하는 사용자 트리거는 `tasks_log_activity`(AFTER DELETE → `activities` 에 `task_deleted`) 하나다. INSERT 쪽 트리거는 복구 때 문제가 된다(복구 절).

## 위험

1. **FK 3곳이 삭제를 막는다(NO ACTION).** 아래 경우에는 그냥 `delete from bid_notices` 하면 실패한다. 03 은 C41~C43 에서 미리 멈춘다.
   - `bid_notice_events.related_bid_id`: 대상 밖 이벤트가 대상 공고를 가리킬 때
   - `bid_opportunities.superseded_by`: 대상 밖 기회가 대상 기회를 가리킬 때
   - `bid_projects`(`opened_by_review_id`): 대상 밖 프로젝트가 대상 결정을 가리킬 때
2. **CASCADE 가 남길 데이터를 같이 지운다.** 실공고가 DEMO 사업기회에 묶여 있으면 실공고의 `opportunity_notice_links` 가 사라진다. DEMO 공고가 실공고 기회에 묶인 경우와 DEMO–실공고 쌍의 `notice_match_candidates` 도 같다. 03 은 C44~C46 에서 멈춘다. 리허설 neg4 에서 그냥 삭제했더니 보존 공고의 연결이 1에서 0으로 조용히 사라졌다.
3. **SET NULL 이 남길 행을 바꾼다.** 대상 밖 행이 대상 run·추출·알림을 가리키면 그 행이 바뀐다. 해당 FK 는 `bid_reviews.score_run_id`, `score_runs.extraction_id`, `kakao_send_claims.notification_id`·`outbox_event_id` 다. 03 은 C47~C49 에서 멈춘다. 수집 이력(`ingest_run_items`)은 03 이 직접 null 로 비우고 원래 값을 백업에 남긴다. 단 그 항목의 run 이 `source='fixture'` 일 때만이다. 실수집(g2b 등) run 의 항목이 대상 공고·개정을 가리키면 03 은 C57 에서 멈춘다. 코드상 항목은 외부 레코드에만 쓰인다(`web/server/ingestion/ingestion.service.ts` 의 `recordRunItem`). 그래서 운영에서는 대상 항목이 0 이어야 정상이다.
4. **DB 행만 지워도 Storage 객체가 사라진다.** worker 정리 job 이 10분마다 `document_storage_candidates` 에서 참조 없음·`lease_until <= now()`·생성 24시간 경과인 객체를 찾아 객체와 원장 행을 함께 지운다. 되돌릴 수 없다. 03 은 지운 첨부가 가리키던 원장 행을 `lease_until='infinity'` 로 둔다. fence-test 에서 보호 상태의 후보는 0, `claim_document_storage_delete` 는 null 이었다. neg4 의 그냥 삭제에서는 후보가 0에서 2로 늘었다.
5. **FK 가 없는 곳에 고아가 남는다.** neg4 의 그냥 삭제에서 알림 4행(없는 공고를 가리킴), outbox 19행, `task_deleted` 활동 2행이 남았다. 03 은 알림과 outbox 를 지우고 활동 트리거를 끈 채 지운다. 03 이 도는 동안 다른 세션이 대상 공고를 가리키는 알림·outbox 를 새로 커밋할 수도 있다(FK 가 없어 잠금이 막지 못한다). 03 의 사후 검사는 이 두 표를 시작 때 굳힌 id 목록이 아니라 조건(`payload->>'bidId'`, `aggregate_id`)으로 다시 세서, 그런 행이 있으면 `DC_POSTCHECK` 로 전체를 되돌린다(리허설 r2 g2).
6. **진행 중인 작업이 실패한다.** run 이 `QUEUED`·`RUNNING` 이면 worker 가 run 을 끝내려다 실패한다(C50). 첨부 lease 가 유효하면 documents job 과 부딪힌다(C51). worker 가 한가할 때, 수집 일정 사이에 돌린다. 03 은 대상 공고와 범위 표 25개의 대상 행(`score_runs`·`bid_documents` 포함)을 차단 검사보다 먼저 `FOR UPDATE` 로 잠근다. 그래서 C50·C51 이 본 상태가 지우는 순간까지 그대로다. `lock_timeout` 은 10초다. 다른 세션이 대상 행을 10초 넘게 잡고 있으면 03 은 잠금에서 멈춘다(리허설 r2 g3). 실행 중 worker 가 보존 표(실공고·알림·outbox·감사 등)에 행을 더하면 보존 수 비교가 달라져 `DC_POSTCHECK` 로 전체가 되돌아간다. 안전한 쪽의 중단이므로 다시 돌린다.
7. **백업과 삭제 사이에 데이터가 바뀌면 03 이 멈춘다**(`DC_EXPECTED_MISMATCH`, 리허설 neg2). 백업을 다시 받는다.
8. **NOT VALID 제약이 복구를 막을 수 있다.** `score_runs_idempotency_key_org_check` 는 새 insert 에 적용된다. 이 제약을 어기는 run 은 지우면 되살릴 수 없다. 03 은 C52 에서 미리 멈춘다.
9. **02 JSON 을 MCP 응답으로 받지 않는다.** 02 결과는 리허설에서 2,228,192 bytes 다(그중 `score_runs` 2,027,712 bytes). 대부분이 `score_runs.input_snapshot` 이고, 여기에 가상 직원 200명 명부 스냅샷이 들어 있다. 이 크기는 MCP 응답 한도에 걸릴 수 있고, 명부가 대화 기록에 남는다. **02b(DB 안 백업) + 로컬 `pg_dump`(DB 밖 사본)를 먼저 쓴다.** 02 JSON 은 `pg_dump` 를 쓸 수 없을 때 로컬 `psql` 로 받아 파일에만 저장한다. 조각 SELECT 는 마지막 수단이다.
10. **제품 영향.** 운영에서 데모 시나리오 S0~S7 을 더는 돌릴 수 없다. `?origin=demo` 화면이 빈다. DEMO 공고의 인력 배정(`assignments`)이 인력 화면과 가용 FTE 계산에서 빠진다. 감사 화면에는 없는 대상을 가리키는 감사 행이 남는다.
11. **02b 는 운영에 쓴다.** 새 스키마는 PostgREST 노출 스키마가 아니다. `service_role` 은 RLS 를 무시하므로 `public`·`anon`·`authenticated` 와 함께 권한을 거둔다. 02b 는 한 트랜잭션이라 중간 문장이 실패하면 스키마·표·권한 회수가 모두 되돌아간다. 그래도 사용자 확인 뒤에 만들고 끝나면 지운다.
12. **운영에서 `pnpm demo:reset` 을 다시 돌리면 DEMO 공고가 다시 생긴다.** 이때 04 는 `DR_ALREADY_PRESENT` 로 거절한다.

## 실행 순서(운영)

모든 단계는 사용자 확인 뒤에 한다. 단계 3(02b)·4·5 는 운영을 바꾼다.

1. 준비: 대상 run 에 `QUEUED`·`RUNNING` 이 없고 수집 일정 사이인지 본다.
2. `01-inventory.sql` 의 Q1·Q2·Q3 를 돌린다. Q1 은 19행이고 `in_list`·`matches_condition` 이 모두 true 여야 한다. Q2 는 `ok=false` 0(C 절 C41~C57 포함), tz 는 UTC. Q2 B 절의 표별 행 수와 sha256 을 기록한다. C 절이 0 이 아니면 멈추고 아래 "C 절이 0 이 아닐 때"를 따른다.
3. 백업: **02 JSON(약 2.2MB, `score_runs.input_snapshot` 에 가상 직원 명부 스냅샷 포함)을 MCP 응답으로 받지 않는다. 02b + 로컬 `pg_dump` 를 먼저 쓴다.**
   1. `02b-backup-in-db.sql` 을 돌린다(한 트랜잭션). 확인 SELECT 1 은 26행 `sha_ok` 가 모두 true, 확인 SELECT 2 는 `public`·`anon`·`authenticated`·`service_role` 의 `schema_usage`·`schema_create`·`table_any` 가 모두 false 이고 `rls` 가 true 여야 한다. `DC_BACKUP_EXPOSED` 나 다른 오류가 나면 아무것도 만들어지지 않은 것이다.
   2. 로컬에서 `pg_dump --data-only --table=demo_cleanup_20261026.backup` 으로 DB 밖 사본을 받는다. 받은 파일을 다른 DB(로컬)에 넣어 26행·`sha_ok` 를 확인한다(아래 "pg_dump 사본 복원").
   3. `pg_dump` 를 쓸 수 없을 때만 로컬 `psql` 로 `02-backup.sql` 을 돌려 결과 26행을 JSON 파일 하나로 저장하고 아래 확인 명령을 돌린다. 조각 SELECT 는 마지막 수단이다.
4. `03-delete.sql` 을 `v_dry_run := true` 로 돌린다. `v_expected` 는 02b 를 썼으면 `null`, 02 JSON 을 썼으면 아래 명령 출력. 기대: `ERROR: DRY_RUN_ROLLBACK`(detail 에 표별 처리 수).
5. `03-delete.sql` 을 `v_dry_run := false` 로 돌린다. 기대: `NOTICE: DC_DONE {...}`.
6. 01 을 다시 돌린다. B 절 모두 0. A·B 절의 `ok=false` 는 정상(기대값이 삭제 전 기준). D 절은 처음과 같다(예외 `tasks: 전체` 는 지운 수만큼 준다). Q3 는 0행(보호 원장은 `lease_until='infinity'` 로 찾는다).
7. 화면 확인: `/bids?origin=demo` 0건, 실공고 화면 그대로.
8. 되돌릴 일이 생기면:
   1. notify worker(회사 Compose `worker` 서비스 안의 outbox dispatcher, `web/worker/notify-outbox.ts`)를 멈추거나, 카카오 발송이 mock(`NOTIFY_KAKAO_PROVIDER` 가 비었거나 `mock`)인지 확인한다. 04 는 PENDING outbox 를 원래 상태로 되살리므로, dispatcher 가 돌면 DEMO 알림을 다시 처리한다. 발송 수단이 `memo` 면 카카오로 실제 나간다. outbox 상태는 SQL 로 바꾸지 않는다(원상 복구가 목적이다).
   2. 04 dry-run → 04 실제 → 01 을 다시 돌려 처음 결과(행 수·sha256)와 같은지 본다.
   3. worker 를 멈췄다면 카카오가 mock 인지 확인한 뒤 다시 켠다. 켜는 순간 되살린 PENDING outbox 가 처리된다(지우기 전과 같은 동작).
9. 보존 기간이 끝나면 Storage 보호를 풀고 백업 스키마를 지운다. **둘 다 되돌릴 수 없고, 하면 04 로 복구할 수 없다.**

C 절이 0 이 아닐 때: 03 은 같은 번호로 `DC_BLOCKED` 를 내고 아무것도 바꾸지 않는다. 실공고(`is_demo=false`) 쪽 행을 지우거나 고쳐서 차단을 풀지 않는다. 차단 행을 01 로 뽑아 사람이 판단하고, 실행서를 그 경우에 맞게 고친 뒤 격리 리허설부터 다시 한다.

02 JSON 확인 명령(26행·표마다 `sha256(rows_text)`):

```bash
node -e 'const c=require("crypto");const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));let bad=0;for(const r of a){const h=c.createHash("sha256").update(r.rows_text,"utf8").digest("hex");const n=r.table_name==="meta"?null:JSON.parse(r.rows_text).length;if(h!==r.sha256||(n!==null&&n!==Number(r.row_count))){bad++;console.log("불일치",r.table_name)}}console.log(a.length===26&&bad===0?"backup OK (26 rows)":"backup NG")' backup.json
```

03 의 `v_expected` 값 만들기(02 JSON 에서):

```bash
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(JSON.stringify(Object.fromEntries(r.filter(x=>x.table_name!=="meta").map(x=>[x.table_name,{row_count:Number(x.row_count),sha256:x.sha256}]))))' backup.json
```

02b 표를 DB 밖으로 받는 조각 SELECT(조각 100,000자, 리허설 최대 101,158 bytes). 한 번에 어려우면 `where` 에 `b.ord = <n>` 이나 `p.part = <k>` 를 더해 나눠 받고 `ord`·`part` 순으로 이어 붙인다. 이어 붙인 뒤 위 확인 명령을 돌린다.

```sql
select b.ord, b.table_name, b.action, b.row_count, b.sha256, p.part, p.parts,
       substr(b.rows_text, (p.part - 1) * 100000 + 1, 100000) as chunk
from demo_cleanup_20261026.backup b
cross join lateral (
  select g as part, greatest(1, ceil(length(b.rows_text) / 100000.0))::int as parts
  from generate_series(1, greatest(1, ceil(length(b.rows_text) / 100000.0))::int) g
) p
order by b.ord, p.part;
```

Storage 보호 풀기(정리를 확정할 때만. 리허설에서는 롤백 트랜잭션 안에서만 돌렸다):

```sql
update public.document_storage_objects o
set lease_until = now() - interval '1 second', updated_at = now()
where o.lease_until = 'infinity' and o.status = 'STORED'
  and not exists (select 1 from public.bid_documents d where d.raw_storage_id = o.id or d.parsed_storage_id = o.id);
```

pg_dump 사본 복원(빈 표를 만든 뒤 데이터만 넣는다. 02b 의 `create table … as` 는 지금 행으로 표를 채우므로 쓰지 않는다):

```sql
begin;
create schema demo_cleanup_20261026;
revoke all on schema demo_cleanup_20261026 from public, anon, authenticated, service_role;
create table demo_cleanup_20261026.backup (ord integer primary key, table_name text, action text, row_count bigint, sha256 text, rows_text text);
alter table demo_cleanup_20261026.backup enable row level security;
revoke all on table demo_cleanup_20261026.backup from public, anon, authenticated, service_role;
\i backup-table.data.sql
select count(*) as rows, count(*) filter (where encode(sha256(convert_to(rows_text, 'UTF8')), 'hex') = sha256) as sha_ok
from demo_cleanup_20261026.backup;  -- 26, 26
commit;
```

백업 스키마 정리(보존 기간 뒤, 사용자 확인 뒤. 운영에서 돌린 적 없다. 격리 스택에서는 r2 시작 때 지웠다): `drop schema demo_cleanup_20261026 cascade;`

## 복구 방안(PITR 이 꺼져 있다는 전제)

PITR 이 없으면 특정 시점으로 되돌릴 수 없다. 03 전에 받은 행 백업이 복구 수단의 전부다.

| 순위 | 백업 | 복구 | 리허설 |
|---|---|---|---|
| 1 | 02b 표 `demo_cleanup_20261026.backup`(운영 DB 안) | 04 를 `v_source := 'schema'` 로 돌린다 | 했다(회차 2, r2) |
| 2 | `pg_dump --data-only --table=demo_cleanup_20261026.backup` 파일(DB 밖) | 위 "pg_dump 사본 복원"으로 빈 표에 넣는다 → 04 schema 모드 | r2 에서 했다(pg_dump 17.11, 2,232,464 bytes). 백업 스키마를 비운 자리에 복원해 26행이 원본과 같고, 04 가 백업 검사를 통과했다(롤백). 운영 연결로 덤프한 적은 없다 |
| 3 | 02 결과 JSON 파일(DB 밖, 로컬 `psql` 로 받거나 02b 조각) | 04 를 `v_source := 'json'`, `v_json` 에 배열. SQL 이 2MB 이상이라 MCP 로는 보내지 않는다 | 했다(최종 회차). 조각을 이은 결과가 02 와 같음도 확인(meta 의 `generatedAt` 만 다름) |
| 4 | (추가 안전망) 범위 표 25개 통째 `pg_dump --data-only` | 별도 DB 에 넣고 대상 행만 옮긴다 | 하지 않았다 |
| — | Supabase 일일 백업(요금제에 따라 다름) | 프로젝트 전체를 되돌린다. 그 뒤의 실공고 수집도 사라진다 | 확인하지 않았다 |

04 의 순서(부모부터): `bid_notices` → `bid_opportunities` → `opportunity_notice_links` → `bid_revisions` → `document_storage_objects`(UPDATE) → `bid_documents` → `bid_structured_requirements` → `requirement_extractions` → `score_runs` → `score_factors` → `qualification_checks` → `requirement_assessments` → `bid_reviews` → `bid_projects` → `bid_project_events` → `tasks` → `assignments` → `bid_watches` → `notifications` → `outbox_events` → `kakao_send_claims` → `notice_match_candidates` → `bid_notice_events` → `bid_relevance_assessments` → `ingest_run_items`(UPDATE)

한계:

- **트리거를 끈다.** 넣는 동안 사용자 트리거를 트랜잭션 안에서만 끈다(`DISABLE TRIGGER USER`). 그대로 두면 `initialize_bid_opportunity` 가 새 사업기회를 만들어 기본 키가 부딪히고, 감사 트리거 2개(`log_score_run_audit`·`log_bid_review_audit`)가 감사 행을 중복으로 만들고, `prepare_bid_review`·`populate_procurement_source` 가 열을 다시 계산하고, `tasks_*` 가 활동 행을 더하고 시각을 덮어쓴다. FK·check 제약은 그대로 검사한다. public 표 주인(postgres) 권한이 필요하다.
- **시퀀스가 없다.** 범위 표는 모두 uuid 기본 키다.
- **Storage 는 원장이 03 의 보호 상태로 남아 있을 때만 복구된다.** 04 는 원장 행이 모두 있고 `lease_until='infinity'`·`STORED` 일 때만 백업 값으로 되돌린다. 객체가 정리 job 에 지워졌거나, 보호가 풀렸거나, 다른 작업이 lease 를 잡았으면 04 는 멈춘다(`DR_STATE`, 리허설 r2 가드 5 음성).
- **outbox 는 원래 상태로 돌아온다.** 리허설에서 20행이 `PENDING` 이었다. 복구하면 dispatcher 가 지우기 전과 똑같이 처리한다. 그래서 04 전에 notify worker 를 멈추거나 카카오가 mock 인지 확인한다(실행 순서 8).
- **지금 상태가 깨끗해야 한다.** 대상 공고나 지운 행이 하나라도 있으면 04 는 멈춘다(`DR_ALREADY_PRESENT`·`DR_STATE`).
- **demo:reset 과 demo:preanalyze 로 다시 만드는 것은 복구가 아니다.** run id 가 바뀌고, 사용자가 남긴 결정·관심·체크리스트가 없고, seed 범위 전체를 다시 쓴다.

## 격리 리허설

- 스택: Supabase CLI 2.120.0, Postgres 17.11, `project_id` `sol-radar-live78`(API 57421, DB 57422). 마이그레이션 60개는 worktree `live-ops-78` 과 같다.
- 데이터는 운영 데이터가 아니다.
  - `pnpm demo:reset`(seed): orgs 2, users 5, people 200, bids 19, quarantined 1, reviews 2
  - 합성 행(`rehearsal-fixture.sql`): 분석(추출 19, run 19(명부 200명 스냅샷 포함), 요소 95, 자격 19, 요구 평가 19), 사용자 쪽(FX-02 사용자 결정·프로젝트·이벤트·체크리스트 2, 관심 2, 알림 4, 카카오 claim 1, outbox 3), 기타(Storage 원장 2, fixture 수집 항목 1), 보존 쪽(실공고처럼 만든 공고 3건: g2b 2, `is_demo=false` fixture 1, 그 하위 행, 카카오 TEST claim)
- 실행 방식은 psql 과 pg 드라이버(simple query, MCP `execute_sql` 흉내) 두 가지다.

| 단계 | 결과 |
|---|---|
| 01 처음 | A·C 절 `ok=false` 0. 대상 행 수는 영향 표와 같다. 백업 크기 2,228,192 bytes |
| 02 백업(pg 드라이버) | 26행, 표마다 sha256·행 수 일치(`backup OK`) |
| 03 dry-run | `DRY_RUN_ROLLBACK`. 그 뒤 01 은 처음과 글자까지 같다 |
| 03 실제 | `DC_DONE`. 공고 19, run 19, 개정 19, 첨부 18, 추출 19, 요소 95, 자격 19, 요구 평가 19, 결정 3, 프로젝트 1, 이벤트 1, 체크리스트 2, 배정 2, 관심 4, 카카오 1, 알림 4, outbox 22, 기회 19, 연결 19, 중복 후보 2, 공고 이벤트 19, 관련도 19, 수집 항목 1(null), 원장 2(보호), 구조화 요구 0 |
| 삭제 뒤 01·무결성 | B 절 전부 0. D 절 차이는 `tasks: 전체` 3→1 하나뿐. FK 103개 위반 0. 알림·outbox 고아 0. 남긴 감사 고아 19+3. `is_demo=false` 3건 유지. 원장 보호 2, 정리 후보 0. `task_deleted` 활동 0. 꺼진 트리거 0 |
| 04 dry-run(json) | `DRY_RUN_ROLLBACK`. 그 뒤 01 은 삭제 직후와 같다 |
| 04 실제(json) | `DR_DONE`. 복구 수는 03 처리 수와 같다 |
| 복구 뒤 비교 | 01 전체(Q1·Q2·Q3, 행 수·sha256·보존 수)가 처음과 같다. 02 를 다시 받아 표별 sha256·행 수 25/25 일치. FK 위반 0, 고아 0, 원장 보호 0(원래 lease 로 돌아감) |
| 회차 2: 02b 경로 | 02b 26행 `sha_ok`. 다시 돌리면 `relation ... already exists` 로 거절. anon·authenticated 의 스키마 USAGE·표 SELECT false, RLS 켜짐. 03(`v_expected` null)·04(schema) 뒤 01 이 처음과 같다. 04 재실행은 `DR_ALREADY_PRESENT` |
| 조각 SELECT | 46조각을 이어 26행. `backup OK`. 표 25개의 `rows_text` 가 02 결과와 같다 |
| pg_dump(데이터만, 백업 표) | 2,232,457 bytes, 26행, sha 가 DB 와 같다 |
| 음성 neg1 | `related_bid_id` 를 넣었더니 `DC_BLOCKED`(C41) |
| 음성 neg2 | 백업 뒤 관심 등록 → `DC_EXPECTED_MISMATCH`(bid_watches) |
| 음성 neg3 | 교차 기회 연결 → `DC_BLOCKED`(C44) |
| 음성 neg5 | 체크리스트 0건 분기도 dry-run 통과 |
| 대조 neg4(실행서 없이 `delete from bid_notices where is_demo`, 롤백) | related_bid_id 가 있으면 FK 오류. 없으면 보존 공고 연결 1→0, 정리 후보 0→2, `task_deleted` 2, 알림 고아 4, outbox 고아 19 |

음성 시험은 모두 롤백했다. 끝난 뒤 01 은 처음과 같았다(15:25 KST 에 최종 회차 처음과 같음을 확인).

### r2: 리뷰 반영 뒤 다시 한 바퀴(10-26 16:08 KST)

리뷰 지적 8건을 반영한 실행서(C57 추가, 03 잠금 순서·사후 검사, 04 Storage 보호 가드, 02b 한 트랜잭션·`service_role` 회수)로 같은 스택에서 다시 돌렸다. 이번에는 메인 세션이 녹화 응답으로 넣은 **실공고 97건**(g2b, `is_demo=false`)이 더 있었다. `is_demo=false` 공고는 모두 100건(실공고 97 + 합성 3)이다. 앞 회차의 백업 스키마는 격리 스택에서만 `drop schema … cascade` 로 지우고 시작했다. DB 접속은 `docker exec … psql` 과 pg 드라이버(`run-sql.mjs`)만 썼다.

| 단계 | 결과 |
|---|---|
| 01 처음 | A·C 절 `ok=false` 0(C41~C57 모두 0). 실공고 97건과 DEMO 사이의 `notice_match_candidates`·`opportunity_notice_links`·`bid_notice_events.related_bid_id` 도 0. 리뷰 전 01 과 출력이 같고 C57 줄만 늘었다. 백업 크기 2,228,192 bytes |
| 02b 음성(커밋 전에 `service_role` 에 SELECT 를 주입, `ON_ERROR_STOP` 없이) | `DC_BACKUP_EXPOSED` → `commit` 이 `ROLLBACK` 이 됨. 스키마가 남지 않았다 |
| 02b 실제 | `BEGIN`·`COMMIT`. 26행 `sha_ok`. 네 역할(`public`·`anon`·`authenticated`·`service_role`)의 스키마 USAGE·CREATE·표 권한 모두 false, RLS 켜짐 |
| 02b 재실행 | `relation "backup" already exists` 뒤 나머지 문장 거절. 백업 표 내용 그대로(md5 같음) |
| 02 JSON(pg 드라이버) | 26행 `backup OK`. 표 25개의 sha256·행 수가 02b 표와 같다 |
| pg_dump(데이터만, 백업 표) | pg_dump 17.11, 2,232,464 bytes. 임시 표 COPY 26행 `sha_ok` 26, 원본과 같음 26. 백업 스키마를 비운 자리에 "pg_dump 사본 복원"대로 넣으니 26행이 원본과 같고 04 가 백업 검사를 통과했다(롤백) |
| 03 dry-run(`v_expected` null) | `DRY_RUN_ROLLBACK`. 그 뒤 01 은 처음과 같다 |
| 03 실제 | `DC_DONE`. 처리 수는 앞 회차와 같다(공고 19, run 19, … 수집 항목 1(null), 원장 2(보호)) |
| 삭제 뒤 01·무결성 | B 절 전부 0. D 절 차이는 `tasks: 전체` 3→1 하나뿐. FK 103개 위반 0. 알림·outbox 고아 0. 남긴 감사 고아 19+3. `is_demo=false` 100건 유지(g2b 99). 원장 보호 2, 정리 후보 0. `task_deleted` 0. 꺼진 트리거 0 |
| 가드 5 음성 | 보호 원장 1행의 `lease_until` 을 `now()+5분` 으로 바꾸고 04 dry → `DR_STATE: … document_storage_objects 보호(lease_until=infinity·STORED) 1/2`. 롤백 뒤 보호 2 |
| 04 dry-run(schema) | `DRY_RUN_ROLLBACK`. 그 뒤 01 은 삭제 직후와 같다 |
| 04 실제(schema) | `DR_DONE`. 복구 수는 03 처리 수와 같다 |
| 복구 뒤 비교 | 01 전체(Q1·Q2·Q3, 행 수·sha256·보존 수)가 처음과 같다. 02 를 다시 받아 표별 sha256·행 수 25/25 일치. FK 위반 0, 고아 0, 원장 보호 0. 04 재실행은 `DR_ALREADY_PRESENT` |
| 가드 1 음성(g1) | g2b run 의 수집 항목이 DEMO 공고를 가리키게 넣으면 01 C57 = 1(`ok=false`), 03 dry → `DC_BLOCKED: … C57 비fixture run 의 수집 항목=1`. 롤백 |
| 지적 2 대조(g2) | 다른 세션이 대상 run 을 5초 잠근 사이 셋째 세션이 DEMO 공고 알림을 커밋했다. 새 03 dry → `DC_POSTCHECK: notifications 남음 1`. 리뷰 전 03 dry → `DRY_RUN_ROLLBACK`(놓침. 실제 실행이었으면 고아 알림이 남았다). 넣은 알림은 지웠다 |
| 지적 3 확인(g3) | 다른 세션이 대상 run 을 12초 잠그면 새 03 은 차단 검사 전의 범위 잠금(`score_runs` FOR UPDATE)에서 `lock timeout` 으로 멈춘다 |

r2 뒤 스택은 복구 상태(DEMO 19건)로 켜 두었다. 실공고 97건, 합성 보존 공고 3건, r2 에서 다시 만든 백업 스키마 `demo_cleanup_20261026`(26행)이 남아 있다. 음성 시험 뒤 01 은 r2 처음과 같았다.

## 확인하지 못한 것

- 운영 행 수 가운데 공고 19·run 19 를 뺀 전부. 운영 id 가 결정적 id 와 같은지(01 Q1 로 확인). 운영의 C 절 차단 여부.
- 운영에서 SQL 을 돌릴 통로: Supabase MCP `execute_sql` 의 실행 역할(public 표 주인 권한·read-only 여부), DO 블록의 `NOTICE`·오류 detail 표시, 한 호출 여러 문장, 요청·응답 크기 한도.
- 운영 PostgREST 노출 스키마 설정, `postgres` 역할의 새 스키마 생성 가능 여부.
- 운영 worker 의 Storage 정리 job 상태, 운영 Storage 대상 객체 수(Q3).
- 운영 Supabase 일일 백업 여부와 PITR 상태(꺼져 있다고 가정).
- 운영 `pg_dump` 연결 방법(직접·pooler, IPv4/IPv6, TLS CA)과 Postgres 버전. pg_dump 17.6 이상이 쓰는 `\restrict` 줄은 같은 세대의 `psql` 로 넣어야 한다(r2 는 17.11 끼리 확인).
- 운영 `score_runs.input_snapshot` 크기.
- 02b 를 Supabase MCP `execute_sql` 로 돌릴 때 `begin`·`commit` 을 어떻게 다루는지(호출을 자체 트랜잭션으로 감싸는지). `psql` 로만 확인했다.
- 회사 worker 의 실제 `NOTIFY_KAKAO_PROVIDER` 값과 worker 를 멈추는 절차(예시 `infra/env/company-worker.env.example` 은 `mock`). 이 작업은 `.env` 를 읽지 않았다.
- 실행 중 동시 변경은 리허설에서 알림 하나와 잠금 대기 두 경우만 만들었다. outbox 의 동시 커밋은 알림과 같은 경로(조건 직접 비교)라 따로 돌리지 않았다.
