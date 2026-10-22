---
title: "N3 관심 공고 — 검증 보고(2026-10-21)"
tags:
  - sol-radar
  - evidence
updated: 2026-10-21
---

# N3 관심 공고 — 검증 보고

배정: sol-radar-12 → sol-radar-fa(ADR-042 P1). 브랜치 `feat/n3-watchlist`(base main `ca0e5f7`).
스펙 [N3 관심 공고](../../../../polaris/specs/in-progress/2026-10-21-n3-watchlist.md), 계획 [구현 계획](../../../plans/2026-10-21-n3-watchlist-plan.md), 화면 [디자인 스펙](../../../plans/2026-10-21-n3-watchlist-design.md).

## 1. 만든 것

- 마이그레이션 `20261022000100_bid_watches.sql`
  - 표 `bid_watches`(PK `org_id, user_id, bid_id`). `memberships (org_id, user_id)`·`bid_notices (id)` 에 cascade FK.
  - RLS 는 본인 행만 읽고 넣고 지운다. 화면 역할 권한은 SELECT·DELETE 와 `org_id, user_id, bid_id` 열 INSERT 뿐이다.
  - `bid_watch_count(p_bid_id uuid)`: security definer, `search_path = ''`. 부른 사람 조직(`my_org_ids()`) 안의 관심 인원만 센다. authenticated 만 실행.
  - 뷰 `watched_bid_list_items`(`security_invoker`): `bid_list_items` 중 내가 관심 등록한 공고만.
- 마이그레이션 `20261022000110_deadline_reminders.sql`
  - `send_deadline_reminders(p_now timestamptz) returns integer`: KST(UTC+9 고정) 09:00 이후, 마감 D-3·D-1 인 `OPEN`·`AMENDED` 공고.
  - 수신자는 조직마다 최신 결정 담당자 ∪ 관심 등록자. 조직 구성원이고 `profiles.status = 'active'` 인 사람만.
  - 키 `<bidId>:<userId>:DEADLINE_APPROACHING:D-<n>` 에 `on conflict do nothing` 으로 바로 넣는다(outbox 를 거치지 않는다, 스펙 §8 Q1 ①). service_role 만 실행.
- 서버: 도메인 `web/server/watchlist`, `PUT·DELETE /api/v1/bids/:id/watch`, 목록 조건 `watched=me`(`bid_list_items` 대신 `watched_bid_list_items` 를 읽는다), 상세 뒤로 링크 `/watchlist?…`.
- worker: `deadline-reminders` 주기 작업. `DEADLINE_REMINDER_INTERVAL_MS`(기본 300000, 60000~3600000), 로그 `notify.deadline.sent`.
- 화면: `/bids` 표 첫 열 ★ 토글, `/watchlist`(필터·정렬·더 보기, 빈 상태 둘), 상세 머리 ★ + "관심 N명", 사이드바 "관심 공고" 출시.
- `scripts/db-verify.mjs` 의 `ALLOWED_DEFINER_FUNCTIONS` 에 `public.bid_watch_count(uuid)` 를 이유와 함께 더했다(기존 항목과 같은 형식, 검사는 약해지지 않는다).

## 2. 검증 결과

| 검사 | 결과 | 명령 |
|---|---|---|
| `pnpm verify` | (채움) | `verify-slot.sh pnpm verify` |
| 브라우저 시험(N3 관련 6파일) | (채움) | `verify-slot.sh pnpm exec vitest run --config vitest.browser.config.ts …` |
| 웹 단위(관련 폴더) | 80파일 1984/1984 | `vitest run "app/(app)/(work)" components server/bids server/watchlist server/notifications app/api/v1 worker` |
| DB 정책(PGlite) | 303/303. N3 +19(관심 7, 마감 알림 12) | `node --test scripts/database.test.mjs` |
| DB 변형 확인 | 26회 중 24회 잡힘. 살아남은 2회는 예상대로(아래) | scratchpad `n3-mut/run-mutations.mjs` |
| `pnpm type-check` | exit 0 | `pnpm -C web type-check` |

DB 변형에서 살아남은 2회:

- M25 `deadline_at > p_now` 빼기: D-n 이 3·1 이면 마감은 늘 미래라 같은 결과다(중복 방어).
- M26 `memberships` 조인 빼기: 수신자 원천 두 표가 모두 `memberships` FK 를 가져 구성원이 아닌 사람이 들어올 수 없다.

M2~M4(insert·delete 정책 변형)는 처음 돌렸을 때 살아남았다. 원인은 시험이 `returning`·`where` 를 써서 select 정책이 함께 걸린 것이다. 시험을 `returning` 없는 insert, `where` 없는 delete 로 고친 뒤 셋 다 잡힌다(2026-10-21 다시 실행).

## 3. 실앱 확인(격리)

공용 로컬 DB(54321)는 쓰지 않았다. N3 전용 격리 Supabase 를 띄웠다.

- project_id `sol-radar-fa-n3`, API `127.0.0.1:59961`, DB `59962`. 마이그레이션 전부와 N3 두 파일 적용.
- seed 는 `pnpm demo:reset -- --env-file <격리 seed env>` 하나(orgs 2, users 5, people 200, bids 19).
- 웹 env: `AI_PROVIDER=mock`, Redis·MinIO·Qdrant·AI gateway 없음. 그래서 상단바 "AI: 확인 중"과 `/health/ready` 503 이 이 환경의 기대값이다.

### 화면

| 상태 | 1440 | 1280 |
|---|---|---|
| `/bids` ★ 열(두 행 켬) | `20261021-phase3-bids-list-loaded-1440.png` | `…-1280.png` |
| `/watchlist` 2건 | `20261021-phase3-watchlist-loaded-1440.png` | `…-1280.png` |
| `/watchlist` 빈 상태(관심 없는 계정) | `20261021-phase3-watchlist-empty-1440.png` | `…-1280.png` |
| 관심 공고에서 연 상세("← 관심 공고", ★ 켜짐, "관심 1명") | `20261021-phase3-bid-detail-loaded-1440.png` | `…-1280.png` |
| 마감 알림 1건("마감 임박", "마감 3일 전입니다.") | `20261021-phase3-notifications-deadline-1440.png` | `…-1280.png` |

- 두 폭 모두 가로 넘침 0, `h1` 30px 하나, 콘솔 오류 0(`/health/ready` 503 은 위 이유로 뺐다).
- 사이드바 현재 표시: `/watchlist` 에서 "관심 공고", 상세는 어디서 열든 "입찰 공고"(디자인 D13 ①).

### 마감 알림 함수

`20261021-n3-deadline-reminders.sql` 을 격리 DB 에 돌렸다. 결과는 `20261021-n3-deadline-reminders.out.txt` 다.

- 관심 행 2개(마감 없음 1, 10-28 마감 1).
- `p_now` = 10-25 08:59 KST → 0건. 10:00 KST → 1건(10-28 마감의 D-3). 같은 날 다시 → 0건(키 중복).
- 들어간 알림: 키 `f1b8fdee-…:bf816951-…:DEADLINE_APPROACHING:D-3`, 상태 `SENT`, 링크 `/bids/f1b8fdee-…`.
- `authenticated` 로 부르면 `permission denied for function send_deadline_reminders`.

## 4. 알려진 한계·후속

- 알림 키에 조직이 없다(정본 13 의 키 모양). 공고는 조직 공용이라, 같은 사람이 두 조직에서 같은 공고의 수신자이면 알림은 한 건만 들어간다.
- `watched_bid_list_items` 는 `select i.*` 로 `bid_list_items` 에 기댄다. `bid_list_items` 열을 바꾸는 마이그레이션은 이 뷰도 다시 만든다(S5 와 맞출 것).
- ★ 열(40px)만큼 제목 열이 준다(1280 펼침 184 → 144px, 1440 펼침 344 → 304px). 한 줄이던 제목이 두 줄이 되면 그 행이 약 8px 커진다(디자인 D1 수용).
- 처음 브라우저 시험에서 M4(행 높이 불변)가 실패했다. 원인 둘: ① 한 줄 행(44px)에서 ★ 칸 기본 여백(`py-2.5`)이 행을 52px 로 키웠다 → ★ 칸만 `py-1.5` 로 고쳤다. ② 제목 열이 줄어 생긴 줄바꿈까지 같이 재고 있었다 → 제목 열 폭을 같게 맞춰 ★ 칸만 재도록 시험을 고쳤다(디자인 문서 판단 반영 콜아웃).
- `/notifications` 머리 설명("결정 담당으로 지정되거나 분석이 끝나면…")에 마감 알림이 빠져 있다. 디자인 §2 가 알림 화면을 바꾸지 않기로 해서 그대로 두었다. 후속으로 문구만 고치면 된다.
- 디자인 M12 의 axe 검사는 저장소에 axe 가 없어 돌리지 않았다. 넘침·`h1`·`aria-current` 는 위 실앱 확인으로 대신했다.
- 마이그레이션 두 개는 격리 DB 에만 적용했다. 공용 로컬 DB 는 병합 때 3e 가, 클라우드는 사용자 승인 뒤 적용한다.
