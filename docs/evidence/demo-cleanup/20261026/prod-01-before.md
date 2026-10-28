---
title: "운영 DB DEMO 정리 전 조회(01-inventory)"
status: done
tags: [sol-radar, evidence, demo-cleanup, production]
updated: 2026-10-26
---

# 운영 DB DEMO 정리 전 조회(01-inventory)

- 대상: 운영 Supabase `brtysdocxemrqhdezzqg`(MCP `get_project_url` 로 확인)
- 실행: 2026-10-26, Supabase MCP `execute_sql`(읽기 전용 설정 `read_only=true`), `set timezone to 'UTC'`
- 실행서: [[summary|DEMO 공고 정리 실행서]]의 `01-inventory.sql` Q1·Q2·Q3. 운영 DB 는 바꾸지 않았다.

## Q1 대상 목록

19행. 모두 `is_demo=true`·`source=fixture`·`status=OPEN`이고 `in_list`·`matches_condition` 이 true 다. 조건에 맞지만 목록 밖인 공고는 없다(DEMO-2026-0001~0020, 0012 없음).

## Q2 영향 보고

A 절 6개와 C 차단 17개(C41~C57)가 모두 기대값과 같다(`ok=true`). tz 는 UTC.

| B 표 | 행 | sha256 |
|---|---:|---|
| bid_notices | 19 | `714b6fbd49ea735b44cc408593bc51f2fd8869314de3f8a290f8cc9b3a57852b` |
| bid_revisions | 19 | `433539442aea9e765ad2325305559a3c46b84c7f88137f2aa3fd07a4602774aa` |
| bid_documents | 18 | `870a7281c3e35494ee6d8634823899a2739d9a4eec3348608575dee24b3f8753` |
| requirement_extractions | 19 | `7899b88e72c7004aeb93d42360128058ef168bb6f04f7da0afaa37e7356a0566` |
| score_runs | 19 | `f0f3c3580d54a1d374e79407b6f471b219adaaaf75d92174b8074e1aa1ce103a` |
| score_factors | 95 | `5944fea2d57845026a55306a4046d0b809ba8e30c109d2f1cefc046603dfe7dd` |
| qualification_checks | 23 | `8c8ead0113626f28cb800285160522cd51ee4267c1dcbc3c8b2f44e90b705934` |
| requirement_assessments | 56 | `9bf0b15e3ae732fa67691b428112cf28f415e06d466f3c4edd3974802dcbd7a1` |
| bid_reviews | 3 | `4f6d0f7d3d5659da339b2b367e4e757a39399a449c5120fdf5d82736474b0b27` |
| assignments | 2 | `3689cf8cc5faad68aaa5e6ec3008db82852a5d8d7640b7a02fec541b213d0f76` |
| outbox_events | 22 | `2d7f20e3528531ccf85deff0c5fcec931d7f404702ac1374e80305f2c70cd440` |
| bid_opportunities | 19 | `aeca1d71d8b325e75bcdddd9a7911e0605fa33192b25573701484ed1ee3ef82f` |
| opportunity_notice_links | 19 | `972ded83a11456815a932122504b5e953efa2132e3fe517dd4767a081a5ef933` |

나머지 12개 표(bid_structured_requirements·bid_projects·bid_project_events·tasks·bid_watches·kakao_send_claims·notifications·notice_match_candidates·bid_notice_events·bid_relevance_assessments·ingest_run_items·document_storage_objects)는 0행이다(sha256 `4f53cda1…b945` = `[]`).
지울 행은 모두 333행이다. 백업 크기 합계는 667,009 bytes 다(그중 score_runs 358,244).

C 참고: 대상 outbox 22행이 모두 PENDING·FAILED 다(지우면 나가지 않는다). 인력 배정 2행, 대상을 가리키는 감사 기록 22행(남긴다), 대상 경로 Storage 객체 0개.

D 보존(정리 뒤 같아야 한다): bid_notices 대상 밖 90(모두 `is_demo=false`), bid_revisions 대상 밖 92, score_runs 대상 밖 0, outbox_events 대상 밖 92, bid_opportunities 대상 밖 90, ingest_runs 2(fixture 1), ingest_errors 1, ingest_run_items 0, audit_logs 27, activities 4, organizations 2, profiles 6, auth.users 6, memberships 5, team_members 200, company_profiles 3, document_storage_objects 0, procurement_agencies 72, eval_runs 0. 나머지 대상 밖 수는 0 이다.

## Q3 Storage 객체

0행. 대상 첨부에 원장·버킷 객체가 없다.
