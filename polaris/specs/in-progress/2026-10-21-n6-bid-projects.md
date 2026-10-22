# N6 입찰 프로젝트 스펙

상태: in-progress(2026-10-21 착수, sol-radar-30). 배정 sol-radar-12(ADR-042 P1 병행, 담당 30). 브랜치 `feat/n6-bid-projects`, base main `086ac1e`. 마이그레이션 대역 `20261022000300`~.

## 설계 출처

- [사이드바 설계](../../../docs/plans/2026-10-16-sidebar-ia-design.md) §2.2 `/projects` 행, §2.3 카드 슬롯 5, §2.4 권한 표, §2.5 표 정의, §2.6 API, §3.2 P1-3 완료 기준, D3·D4·D12, M9·M11·M12·M13·M14 (2026-10-16 사용자 승인)
- `docs/04-DATABASE.md` §3.1 `tasks` P1 행, §3.8 `bid_projects`·`bid_project_events`, §4 `bid_project_status`·`bid_project_result`
- `docs/05-API-SPEC.md` §2 `/projects` 세 행, §5 `PROJECT_REQUIRES_BID_DECISION`·`LATEST_DECISION_NOT_BID`
- `docs/09-SECURITY.md` RBAC 표 P1 행, 감사 절(입찰 프로젝트 상태·결과 변경)
- `docs/11-TESTING.md` NAV-P1-02
- `docs/16-DECISIONS.md` ADR-021, ADR-042 P1 병행 조건 6개

설계와 이 스펙이 다르면 설계를 따른다. 설계에 없는 세부는 아래 "이 스펙이 정한 것"에 적고 12 에 알린다.

## 불변 조건

- 추가형이다. 핵심 컷 경로(`ingest_save_revision`, analysis job, `analyze()`, 골든 94/72/68), `bid_reviews` 계약, `GET /bids/:id` 계약을 바꾸지 않는다.
- 사람 결정의 정본은 `bid_reviews` 다. 프로젝트는 결정을 복제하지 않고 `opened_by_review_id` 로 가리킨다.
- 결과(`result`)는 점수·결정 모델·평가셋·학습셋에 쓰지 않는다(D4). 점수·분석 코드는 프로젝트 표를 읽지 않는다.
- 마감은 공고 `deadline_at` 을 읽는다. 덮어쓸 때만 `submission_due_override` 에 둔다(복제 금지).
- 담당자는 로그인 계정(조직 멤버십)이다. 200명 명부(`team_members`)는 담당자가 아니다(D12).
- 확률·승률·"수주 가능성" 수치나 문구를 두지 않는다(ADR-007).
- 데스크톱 1280px 이상. 확인은 1440·1280.
- 모든 요청에서 조직은 서버가 정한다. 본문·쿼리·헤더로 조직 ID 를 받지 않는다(M17).

## 1. 저장 (새 마이그레이션 `20261022000300_bid_projects.sql`)

- `bid_projects`: 04 §3.8 열 그대로. UNIQUE(`org_id`,`bid_id`), UNIQUE(`id`,`org_id`). `opened_by_review_id` 는 (`opened_by_review_id`,`org_id`) 로 같은 조직의 결정만. `owner_id` 는 (`org_id`,`owner_id`) → `memberships` 복합 FK, 멤버십이 지워지면 담당자만 비운다. `status`·`result` 는 check 제약.
- `bid_project_events`: 04 §3.8 열 그대로. 추가만. (`bid_project_id`,`org_id`) 복합 FK.
- `tasks.bid_project_id` nullable 열 + (`bid_project_id`,`org_id`) → `bid_projects(id, org_id)` 복합 FK(프로젝트가 지워지면 체크리스트도 지운다).
- `audit_logs.action` 값에 `PROJECT_OPEN`·`PROJECT_STATUS_CHANGE`·`PROJECT_RESULT_RECORD` 를 더한다(새 마이그레이션에서 check 제약을 바꿔 건다).
- 권한:
  - 읽기: 세 표 모두 조직 전원(`my_org_ids()`).
  - `bid_projects` 직접 쓰기: SALES·ADMIN 의 `update (owner_id, submission_due_override)` 만. insert·status·result 는 DB 함수만.
  - `bid_project_events`·`audit_logs`: 화면 역할 쓰기 권한 없음. DB 함수(security definer)가 같은 트랜잭션에 쓴다(M9).
  - `tasks`: `bid_project_id` 가 있는 행의 insert·update·delete 는 SALES·ADMIN 만(M13). 템플릿 정책은 그대로 두고 restrictive 정책을 더한다. `bid_project_id` 는 insert 때만 정하고 update 로 바꾸지 못한다.
- DB 함수(security definer, `search_path=''`, 호출자 `auth.uid()` 의 `sol_role` 을 함수 안에서 검사):
  - `open_bid_project(review_id)` — 그 결정이 BID 이고 그 공고의 최신 결정이어야 한다. 프로젝트가 없으면 `PREPARING` 으로 만든다. 같은 공고에 `CLOSED` 프로젝트가 있고 그 결정이 종료 뒤의 BID 면 다시 연다(M12 ③). 열린 프로젝트가 이미 있으면 거절한다.
  - `change_bid_project_status(project_id, to_status, note)` — §3 전이 규칙.
  - `record_bid_project_result(project_id, result, note)` — 결과 기록. 상태는 바꾸지 않는다.
- 정책 시험은 `scripts/database.test.mjs` 에 더한다. `pnpm db:types` 를 같은 커밋에 넣는다.

## 2. API (`/api/v1`, 05 §2)

| 메서드 | 경로 | 권한 | 내용 |
|---|---|---|---|
| GET | `/projects` | 조직 전원 | 보드용 목록. 열린·종료 프로젝트 전부(조직당 공고 1개라 수가 작다) + "검토 대기" 공고(최신 분석이 있고 사람 결정이 없는 공고, 대시보드 카드 2 와 같은 정의) |
| POST | `/projects` | ADMIN·SALES | `{reviewId}`. 201 새 프로젝트, 200 다시 연 프로젝트 |
| GET | `/projects/:id` | 조직 전원 | 상세: 프로젝트, 공고 요약·실효 마감, 여는 결정, 최신 결정, 경고(최신 결정이 BID 아님·공고 정정됨), 상태 이력, 체크리스트 |
| PATCH | `/projects/:id` | ADMIN·SALES | `{status?, note?, ownerId?, submissionDueOverride?}`. 상태는 DB 함수, 담당자·마감은 직접 update |
| POST | `/projects/:id/result` | ADMIN·SALES | `{result, note?}` |

- 오류: 401·403(`FORBIDDEN`)·404(없음·다른 조직)·400(`VALIDATION_ERROR`), 409 `PROJECT_REQUIRES_BID_DECISION`(결정이 BID 아님 또는 최신 결정 아님 또는 종료 전 결정으로 다시 열기), 409 `LATEST_DECISION_NOT_BID`(상태 전진), 409 `PROJECT_ALREADY_OPEN`(`{projectId}`), 409 `INVALID_PROJECT_TRANSITION`(`{from,to}`).
- 쿠키 인증의 상태 변경 요청은 `X-Requested-With` 를 요구한다(기존 Route Handler 와 같다).
- 체크리스트 쓰기는 템플릿 작업 기능(server action)에 `bidProjectId` 를 더해 쓴다(설계 §2.6).

## 3. 상태와 수명 (D3·M12·M14)

- 저장 상태 4개: `PREPARING`(제안 준비) → `SUBMITTED`(제출 완료) → `AWAITING_RESULT`(결과 확인) → `CLOSED`(종료).
- 전이:
  - 앞으로 한 칸: 최신 결정이 BID 일 때만. 아니면 409 `LATEST_DECISION_NOT_BID`.
  - 뒤로 한 칸(`SUBMITTED`→`PREPARING`, `AWAITING_RESULT`→`SUBMITTED`): 잘못 누른 것을 되돌린다. 결정 검사 없음.
  - 열린 상태 → `CLOSED`: 언제나(종료는 사람이 한다). `closed_at` 을 채운다.
  - `CLOSED` 에서 나가기: PATCH 로는 못 한다. 종료 뒤 새 BID 결정으로 `POST /projects` 가 다시 연다(`PREPARING`, `closed_at`·결과 비움, 이전 값은 감사에 남는다).
  - 같은 상태로 바꾸기·두 칸 이상 건너뛰기는 409 `INVALID_PROJECT_TRANSITION`.
- 모든 상태 변경은 `bid_project_events` 1행 + `audit_logs` 1행(`PROJECT_STATUS_CHANGE`, 열기는 `PROJECT_OPEN`).
- 열린 뒤 BID 가 아닌 결정이 새로 들어와도 자동 종료하지 않는다. 화면이 경고하고 앞으로 가는 버튼을 막는다(M12 ①).
- 공고 정정: 여는 결정의 `revision_id` 가 공고의 최신 revision 이 아니면 "공고 정정됨" 배지 + 공고 상세 링크(M12 ②).
- 보드 열: 검토 대기 → 제안 준비 → 제출 완료 → 결과 확인 → 종료(M14). "검토 대기" 는 저장하지 않고 기존 표에서 계산한다. "관심"·"분석 중" 열은 없다.

## 4. 화면

- `/projects` 보드(5열). 카드: 공고 제목·기관·실효 마감(D-n)·담당자·체크리스트 진행(완료/전체)·경고 배지. 검토 대기 카드는 공고 상세로 간다.
- `/projects/[id]` 상세: 머리(제목·상태·경고), 상태 바꾸기(SALES·ADMIN), 담당자·마감 덮어쓰기, 체크리스트, 결과 기록, 상태 이력, 관련 링크(공고·분석·결정).
- `/bids/[id]`: 최신 결정이 BID 이고 프로젝트가 없으면 "입찰 프로젝트 만들기"(SALES·ADMIN), 있으면 "입찰 프로젝트 보기". `bid-detail-view.tsx` 는 93·54 와 겹치므로 줄 단위로 알린다.
- 사이드바 `/projects` 를 `released` 로(완료 기준을 채운 뒤).
- 대시보드 슬롯 5 를 "진행 중 입찰 프로젝트"(`CLOSED` 가 아닌 수)로 바꾼다. N9(`dashboard-card-slots.ts`)가 main 에 들어간 뒤 54 와 맞춘다.
- 화면 상세는 web-designer 스펙을 따른다.

## 5. 이 스펙이 정한 것 (설계에 없는 세부, 12 에 알린다)

1. 감사 action 3개 `PROJECT_OPEN`·`PROJECT_STATUS_CHANGE`·`PROJECT_RESULT_RECORD`. 담당자·마감 변경은 감사 대상이 아니다(설계 §2.4 는 상태·결과만).
2. 오류 코드 2개 `PROJECT_ALREADY_OPEN`·`INVALID_PROJECT_TRANSITION`.
3. 열기는 "그 공고의 최신 결정이 BID" 일 때만. 다시 열기도 `POST /projects` 로 하고, 종료 뒤에 내린 BID 결정이어야 한다.
4. 뒤로 한 칸을 허용한다.
5. 결과 기록은 상태와 따로다(어느 상태에서나 기록·덮어쓰기, 상태는 그대로).
6. 프로젝트가 지워지는 경로는 없다(화면 역할에 delete 권한 없음). 공고·조직이 지워질 때만 함께 지워진다.
7. 템플릿 작업 화면(`/{slug}/tasks`)에도 체크리스트 행이 보인다. 쓰기는 restrictive 정책이 SALES·ADMIN 만 허용한다.

## 6. 완료 기준 (설계 §3.2 P1-3 + 11 NAV-P1-02)

- BID 결정 없이 생성 거부(DB 함수·API 둘 다), M12 수명 규칙(결정 변경 시 경고·전진 차단·자동 종료 없음, 다시 열기), 상태 이력·감사 기록, 체크리스트 쓰기 SALES·ADMIN 만(정책 시험), 결과가 점수·결정 모델에 쓰이지 않음(구조 시험: 점수·분석·worker 코드가 프로젝트 도메인·표를 참조하지 않음).
- 다른 조직 404, VIEWER·ANALYST 쓰기 403·RLS 거부.
- 브라우저 시험 + 1440·1280 스크린샷(`docs/evidence/p1-n6/`).
- `pnpm verify` 초록불. 실행 못 한 검사는 미검증으로 적는다.
- freeze(10-24 22:00)까지 green 이 아니면 사이드바 "준비 중" 그대로, 경로는 404(ADR-042 조건 3).
