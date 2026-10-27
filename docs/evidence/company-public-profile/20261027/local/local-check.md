---
title: 공개 자료 프로필 로컬 격리 스택 확인(9l)
---

# 로컬 격리 스택 확인 (2026-10-27, HEAD 1e7bd6ed)

## 환경
- 격리 Supabase `cpp-t9l`: api 59721, db 59722, inbucket 59724~59725. 마이그레이션 `20261027000700_executive_role_company_sources.sql`까지 적용 확인.
- Compose 프로젝트 `cpp-t9l`: redis 59731, qdrant 59732, ai-gateway 59733, worker. `docker inspect` 로 worker 의 `NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:59721`(격리 DB), `SOL_RUN_MODE=mock` 확인 뒤 분석을 돌렸다.
- 웹 `pnpm -C web dev -p 59734`(`web/.env.local` 은 scratchpad env 파일로의 심볼릭 링크, 끝난 뒤 제거).

## 실행한 명령(키·비밀번호 없음)
- `supabase start --workdir <사본> --exclude imgproxy,studio,postgres-meta,logflare,vector,supavisor,realtime,edge-runtime` (storage-api 유지)
- `pnpm demo:reset -- --env-file <ops env>` → `seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true`
- `docker compose -p cpp-t9l --env-file <compose env> -f infra/compose.yaml up -d --build` (슬롯 스크립트)
- `compose exec -T worker node --conditions=react-server --import tsx worker/demo-preanalyze.ts` → `targets=18 completed=18 partial=0 failed=0` (가상 프로필 rev 2, is_demo=true)
- `pnpm ops:company-profile -- --env-file <ops env> --file docs/evidence/company-public-profile/20261027/profile.json --created-by admin@admin.com` (dry-run) 후 `--apply`

## dry-run 요약
nextRevision 3, 기술 added 19(HTML5·JavaScript·WebGL·BIM·IoT·Nutanix HCI·eGovFrame·Java·Spring 등), 가상 실적 3건 removed(지자체 민원 시스템 고도화·공공기관 데이터 플랫폼 구축·교육기관 AI 챗봇 PoC). row: name ㈜솔리데오, technologies 19(complete=false), licenses 1, industry_codes 0, past_projects 33, sources 40, public_history 43, is_demo=false, financials(2025, 매출 60,249,901,054원·사원 281명), note "공개 자료 기준(2026-10-27 수집)". apply 결과: **revision 3**, id `2fccc281-e35b-4f38-870b-a8b11ff4ad16`.

## EXECUTIVE 지정
ADMIN(admin@admin.com) 으로 `/settings/organization` 구성원 표의 "박분석 업무 역할" 선택에서 EXECUTIVE 를 골라 바꿨다(UI). 격리 DB `memberships.sol_role = EXECUTIVE` 확인. 증거: `role-change-admin.png`.

## 확인 항목
| 항목 | 결과 | 근거 |
|---|---|---|
| /company ADMIN 1440·1280 | 통과 | `company-admin-{1440,1280}.png`. 출처 40건 목록(공개 자료·확인일), 칩 "공개 자료 기준 · 확인일 2026-10-27", rev 3 |
| /company EXECUTIVE 1440·1280 | 통과 | `company-executive-*.png`, 사이드바 "회사 역량" 있음, ADMIN 과 같은 내용 |
| /company VIEWER 1440·1280 | 통과 | `company-viewer-*.png`: "이 화면을 볼 권한이 없습니다", 사이드바에 회사 역량 없음 |
| 정보통신공사업 등록(보유) | 통과 | `?tab=licenses`: ICT_CONSTRUCTION 보유, 만료 "—" |
| 실적 33건·금액 칸 | 통과 | `?tab=projects`: 금액·완료일 빈 값은 "공개 자료 없음", 증빙 "없음" |
| "인증·등록 이력(점수 미사용)" | 통과 | 보유 자격 탭 하단 |
| "가상" 칩 없음 | **부분 실패** | 칩은 없으나 헤더 설명에 "데모용 가상 솔리데오 프로필입니다."가 남음(결함 1) |
| API VIEWER | 통과 | GET /api/v1/company-profile 403, "회사 역량은 ADMIN·EXECUTIVE만 조회할 수 있습니다" |
| API EXECUTIVE·ADMIN | 통과 | 200, revision 3, isDemo=false |
| 공고 상세 PostgREST embed | 통과 | 500 없이 상세 렌더, 배지 두 종류 모두 정상(복합 FK embed 동작) |
| 가상 프로필 분석 배지 | 통과 | DEMO-2026-0001: "가상 회사 프로필로 분석", `bid-virtual-{1440,1280}.png` |
| 새 분석(FX-02 = DEMO-2026-0002) | 통과 | 화면 "분석 실행" → COMPLETED. `score_runs.company_profile_id = 2fccc281…`(rev 3, is_demo=f), profile_revision 3. 배지 "공개 자료 회사 프로필로 분석", 툴팁 문구 별도, `bid-public-*.png` |
| 점수·판정 | 기록 | 37점 WATCH, 소프트웨어사업자 신고확인서·직접생산확인증명서 2건 NEEDS_REVIEW(COMPANY_EVIDENCE_MISSING), 기술 2/6 보유, 규모·선호 미확인, review_flags KEV_NEEDS_REVIEW(mock) |
| 공고 목록 | 기록 | `list-1440.png`: 가상 프로필(rev 2) 분석 공고는 모두 "미분석"(설계상 예상, 최신 revision 분석만 붙임). 최종 결정 BID 는 유지 |

## 결함
1. `/company` 헤더 설명이 공개 프로필에서도 "데모용 가상 솔리데오 프로필입니다."로 나온다. 원인: `web/components/company/company-tabs.ts:29` 의 고정 `COMPANY_DESCRIPTION`. is_demo 에 따라 문구를 갈라야 한다. 사용자에게 보이는 허위 안내라 운영 전에 고쳐야 한다.
2. (참고, 이 브랜치와 무관 가능) `/health/ready` 가 이 격리 구성에서 503. 웹 env 에 AI gateway 주소가 없어서로 추정, 미확인.

## 콘솔·네트워크
- `GET /health/ready` 503 (대시보드 로드 때 매번), 콘솔 "Failed to load resource 503" 1종. 그 밖의 4xx·5xx 는 의도한 VIEWER 403 외 없음.

## 정리
next dev(PID 32191·32170·32087) 종료, compose `cpp-t9l down -v`, `supabase stop --no-backup`(컨테이너·볼륨 0), `web/.env.local` 링크·scratchpad `.env.t9l-*` 삭제.

## 이 확인 뒤 고친 것 (2026-10-27)

이 스크린샷은 최종 리뷰 수정 전 코드(1e7bd6ed)로 찍었다. 다음은 그 뒤 고쳤고, 운영 반영 뒤 ADMIN 화면에서 다시 본다.

- 결함 1(설명 "데모용 가상"): 중립 문장 "SOL Score 와 필수 자격 판정이 읽는 회사 프로필입니다."로 바꿨다.
- 설명문 "회사 실적 없음": "금액이 확인된 회사 실적 없음"으로 바꿨다.
- 설명문 "… 경험 없음": `technologiesComplete=false` 이면 "회사 기술 목록에서 확인 안 됨(확인 필요)"로 바꿨다.
- 기술 이름 `eGovFrame(전자정부표준프레임워크)`: `eGovFrame` 으로 바꿨다. 별칭 일치 때문이다.
- 선호 분야(D13): 민원·데이터 플랫폼·AX·스마트시티를 넣었다. 그래서 규모·선호 미확인 2개가 규모 1개로 준다.
