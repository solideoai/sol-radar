---
title: 자격 갭 레이더 질의 로컬 DB 확인
status: done
tags: [sol-radar, evidence, gaps, database]
updated: 2026-10-28
---

# 자격 갭 레이더 질의 로컬 DB 확인

2026-10-28, sol-radar-ac. 격리 로컬 Supabase 에 합성 공고를 넣고, 시드 사용자 세션(anon 키 + 사용자 토큰, RLS 적용)으로 `/gaps` 서버가 보내는 것과 같은 PostgREST 요청을 보냈다. 운영 DB·회사 서버·공공 API 는 부르지 않았다.

## 환경

| 항목 | 값 |
|---|---|
| 스택 | `supabase start --workdir <scratchpad>/gapsdb`, project_id `sol-radar-gaps-ac`, API 59621·DB 59622·메일 59624/59625, studio·realtime 끔 |
| 마이그레이션 | gaps-radar worktree(기준 5fa888db)의 63개 전부 적용, bid-calendar worktree 와 목록 같음 |
| 계정 | `scripts/db-seed.mjs`(격리 대상 env `SOL_RADAR_TEST_SUPABASE_WORKDIR`·`_API_URL`). 시드 팀 owner(ADMIN)·member(VIEWER), 조직 밖 사람 outsider |
| 회사 프로필 | 시드 팀 revision 1(면허 없음, 가상), revision 2(정보통신공사업 HELD, 공개 자료) |
| 요청 | `readLiveNotices(db, now)`(`web/server/gaps/gaps.repo.ts`)를 그대로 부르고 `toGapRadarView`(`gaps.service.ts`)로 화면 데이터를 만들었다. 키는 `supabase status` 에서 읽어 메모리로만 썼다 |
| 실행 | `node --conditions=react-server --import tsx <scratchpad>/gaps-localdb-check.mts scenario\|bulk\|numeric` |

## 합성 공고

| 공고 | 조건 | 기대 |
|---|---|---|
| S1 | 정보통신공사업/0036 1행, aux OK, RELEVANT, 3억 | 참가 가능 |
| S2 | 소프트웨어사업자/1468 1행, aux OK, RELEVANT, 5억 | 회사 기록 없음 |
| S3 | AMENDED, revision 1 = 0036·LOW_RELEVANCE, 최신 revision 2 = 1468·관련성 이력(LOW → CANDIDATE), 2억 | 최신 revision 으로 회사 기록 없음 |
| S4 | 0036 + 1468 2행, 9억 | 확인 필요(면허제한 여러 행) |
| S5 | 학술.연구용역/1169 1행, 0.5억 | 확인 필요(사전 밖), 순위 "사전 밖" |
| S6 | 행 없음, auxLookup 없음, 0.7억 | 확인 필요(보조 조회 결과 없음) |
| S7 | 행 없음, auxLookup FAILED, 0.8억 | 확인 필요(보조 조회 미완료) |
| S8 | 행 없음, aux OK, 0.4억 | 참가 가능 |
| S9 | 1468 1행, LOW_RELEVANCE, 6억 | 전체 보기에서만 |
| S10 | 0036 1행, 관련성 판정 없음, 0.1억 | 전체 보기에서만 |
| X1~X7 | CANCELLED · 마감 지남 · is_demo+fixture · 사업기회 superseded(LH 출처) · 사전규격 · source=fixture · 마감 없음 | 늘 빠짐 |

## 결과

| 확인 | 결과 |
|---|---|
| 임베드 FK 이름(`bid_opportunities_canonical_notice_id_fkey`·`bid_revisions_bid_id_fkey`·`bid_structured_requirements_revision_fkey`·`bid_relevance_assessments_revision_id_fkey`) | 오류 없이 응답 |
| 읽힌 공고 | S1~S10 10건. X1~X7 0건. `!inner` + `opportunity.superseded_by=is.null` 이 superseded 공고(X4)를 부모 행에서 뺐다 |
| `aux:normalized->auxLookup` | S7 `{"status":"FAILED","failed":["g2b-bid-region"]}`, S6 `null`(키 없음 → 규칙 엔진 입력에 auxLookup 없음) |
| 최신 revision | S3 은 revision 2(1468)를 써서 회사 기록 없음. 관련성은 최신 CANDIDATE |
| 화면 데이터(owner, 관련 공고) | 대상 8건·21.4억. 참가 가능 2건·3.4억, 회사 기록 없음 2건·7억, 미보유 0, 확인 필요 4건·11억. 손계산과 같음 |
| 순위 | `SW_BUSINESS_REG`(API 1468) 회사 기록 없음 2건·7억·조건 묶음 1건, `1169` 사전 밖 1건·0.5억 |
| 확인 필요 사유 | 면허제한 여러 행 1 · 사전 밖 1 · 보조 조회 미완료 1 · 보조 조회 결과 없음 1 |
| 보유 가정 `SW_BUSINESS_REG`(member) | 참가 가능 2 → 4건, 3.4억 → 10.4억. 새로 열리는 공고 S2(5억)·S3(2억) |
| 전체 보기 | 대상 10건·27.5억, 참가 가능 3건·3.5억, 회사 기록 없음 3건·13억 |
| 조직 밖 사람(outsider) | 공고 10건은 읽히고(활동 중 회원 읽기), 시드 팀 회사 프로필은 RLS 로 0행 → `NO_PROFILE` |
| 규모(관련 공고 1,108건 + 전체 1,110건) | keyset 3쪽(첫 쪽 → `id=gt.6aae8160…` → `id=gt.e56d8713…`), 중복 없이 1,110건. 응답 합 약 829KB, 질의 313ms(keyset 1회. 고치기 전 offset 방식은 같은 데이터로 658~808ms·3회, 캐시 상태가 달라 속도 비교 근거는 아니다) |
| 예산 정밀도 | `budget_krw:budget_krw::text` 로 12345678901234567 이 문자열 그대로 온다 |

## 파트 C 질의(읽기만)

bid-calendar worktree 9ec773a5 의 `web/server/calendar/calendar.repo.ts` select 문자열을 그대로 보냈다. 같은 DB 에 관심(owner: S2·X1, member: S5)과 입찰 프로젝트(S4 PREPARING·담당 owner, S6 SUBMITTED·제출 마감 override, S7 CLOSED)를 넣었다.

| 확인 | 결과 |
|---|---|
| `bid_watches_bid_id_fkey`·`bid_projects_bid_id_fkey`·`bid_projects_owner_fkey`·`memberships_user_id_fkey` 임베드 | 오류 없이 응답 |
| owner 관심 | S2·X1(X1 은 status CANCELLED 로 옴) |
| owner 프로젝트 | S4(담당 이름 김소유)·S6(담당 null, override 있음). CLOSED 인 S7 은 빠짐 |
| member | 관심 S5, 프로젝트 2건 |
| outsider | 관심 0·프로젝트 0 |

## 정리

`supabase stop --workdir <scratchpad>/gapsdb --no-backup` 으로 이 스택의 컨테이너·볼륨만 지웠다. 다른 세션 스택(live78·rh1025·photo81·dashboard-43f8·공용 54321)은 건드리지 않았다.

## 관련 문서

- [[11-TESTING|11 테스트]]
- [[09-SECURITY|09 보안]]
