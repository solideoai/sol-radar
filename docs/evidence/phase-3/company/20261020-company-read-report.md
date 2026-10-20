---
title: "/company 회사 역량(읽기 전용) — 검증 보고(2026-10-20)"
tags:
  - sol-radar
  - evidence
updated: 2026-10-20
---

# `/company` 회사 역량(읽기 전용) — 검증 보고

배정: 사용자 지시(사이드바 메뉴 중 해커톤 노출 화면, 06 §4.1 "해커톤 노출: 예"). 작업 세션: sol-radar-fa(이전 이름 7d).
브랜치 `feat/company-read`(base main `9048995`), worktree `sol-radar-worktrees/company-read`. main 병합 `bf16806`(3e).
스크린샷 14장은 병합 뒤 main `e92e4a6`(개발 표시 위치 수정 `4342bd8` 포함)에서 다시 찍었다(브랜치 `docs/company-evidence-shots`).

## 1. 만든 것

- 도메인 `web/server/company-profile/`(model·repo·service·index): 최신 revision 읽기, revision 이력, 인력 수 요약(`team_members`·`team_member_scoring` 개수만).
  JSONB 는 `@/server/scoring` 의 `companyProfileSchema` 로 검증하고, 맞지 않으면 값을 싣지 않고 오류를 던진다.
- Route Handler 2개(05 §2): `GET /api/v1/company-profile`(없으면 404 `NOT_FOUND`), `GET /api/v1/company-profile/revisions`. 업무 역할 4개 모두 읽기.
- 화면 `web/app/(app)/(work)/company/`(page·loading·error)와 부품 `web/components/company/`: 링크 탭 7개
  (기술 스택·보유 자격·수행 실적·인력·선호 설정·재무·변경 이력, `?tab=`), 탭마다 어느 점수 요소(08)에 쓰이는지 한 줄 설명.
- 하지 않은 것: 편집·새 revision 저장(06 §5.6 의 쓰기), 사이드바 메뉴 전환(`app-nav.ts` 는 사이드바 세션 몫), 공고 상세의 "프로필 rev N" 링크.

판단으로 정한 것:

- 06 §5.6 의 "변경 이력"은 별도 화면 대신 일곱째 탭으로 두었다.
- 인력 탭은 27명(점수 계산 대상)·200명(전체 명부)만 보인다. 가용 FTE 는 공고 수행 기간마다 달라 고정 숫자로 보이지 않는다.
- 수행 실적은 저장 모양(08: id·name·domain·amountKrw·completedAt·evidenceRef)을 그대로 보인다. 05 §2 예시(title·startedAt)와 다르다.
- 만든 사람의 계정이 지워진 revision(`created_by` null)은 `createdBy: { id: "deleted-user", name: "탈퇴한 사용자" }` 로 내보낸다.
  05 의 `createdBy` 는 null 이 아니고, 결정한 사람 삭제(05 `Review.reviewer`, ADR-032 D6)와 같은 값이다(3e 보안 검토 Low 1 반영).

## 2. 검증 결과

| 검사 | 결과 | 명령 |
|---|---|---|
| `pnpm verify` | exit 0. 루트 node 729/729, web vitest 212 파일 6751/6751, web build 통과(`/company`·`/api/v1/company-profile`·`/revisions` 포함), AI pytest 1369/1369 | `verify-slot.sh pnpm verify` |
| 도메인·계약 시험 | 40/40. 4역할 200, org-02 격리, 404, 401, 개인 조직 403, 잘못된 JSONB 500(값 미노출), revisions, 탈퇴한 작성자, 서비스 운영자(`profiles.is_admin`)도 남의 조직 프로필은 404·이력 0건(`?orgId=` 를 붙여도 같다, 3e 보안 검토 Low 2 반영) | `pnpm -C web exec vitest run server/company-profile app/api/v1/company-profile components/company/company-tabs.test.ts` |
| 부품 브라우저 시험 | 23/23. 탭 7개 × 본문 폭 960·1024px 가로 넘침 0, 탭 aria-current, 빈 상태 | `pnpm -C web exec vitest run --config vitest.browser.config.ts components/company` |
| 변형 확인 | repo 의 `eq("org_id")` 를 빼면 격리·404·운영자·이력 시험 5개가 실패함을 확인하고 되돌렸다 | — |
| DB 정책 | 새 표 없음. `company_profiles` 조직 격리는 기존 G5 시험(`scripts/database.test.mjs` ORG_TABLES)이 덮는다 | `pnpm verify` 안 |

## 3. 실앱 확인(격리)

공용 로컬 DB(54321)와 클라우드는 쓰지 않았다. 이 작업 전용 격리 Supabase 를 띄웠다.

- project_id `sol-radar-company-7d`, API `127.0.0.1:59621`, DB `59622`(studio·realtime·storage 끔). 마이그레이션 전부 적용.
- seed 는 `pnpm demo:reset` 하나(`orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true`).
- 웹 `next dev -p 3107`, `SOL_RUN_MODE=mock`. Redis·AI gateway·MinIO 없음.
- 로그인 `sales@soltech.invalid`(SALES). 탭 7개 × 1440·1280px 에서 문서 가로 넘침 0px, `main` 안 잘린 요소 0개.

| 폭 | 탭 | 문서 넘침(px) | 잘린 요소 | 스크린샷 |
|---|---|---|---|---|
| 1440 | tech | 0 | 0 | `20261020-phase3-company-tech-1440.png` |
| 1440 | licenses | 0 | 0 | `20261020-phase3-company-licenses-1440.png` |
| 1440 | projects | 0 | 0 | `20261020-phase3-company-projects-1440.png` |
| 1440 | people | 0 | 0 | `20261020-phase3-company-people-1440.png` |
| 1440 | preferences | 0 | 0 | `20261020-phase3-company-preferences-1440.png` |
| 1440 | financials | 0 | 0 | `20261020-phase3-company-financials-1440.png` |
| 1440 | history | 0 | 0 | `20261020-phase3-company-history-1440.png` |
| 1280 | tech | 0 | 0 | `20261020-phase3-company-tech-1280.png` |
| 1280 | licenses | 0 | 0 | `20261020-phase3-company-licenses-1280.png` |
| 1280 | projects | 0 | 0 | `20261020-phase3-company-projects-1280.png` |
| 1280 | people | 0 | 0 | `20261020-phase3-company-people-1280.png` |
| 1280 | preferences | 0 | 0 | `20261020-phase3-company-preferences-1280.png` |
| 1280 | financials | 0 | 0 | `20261020-phase3-company-financials-1280.png` |
| 1280 | history | 0 | 0 | `20261020-phase3-company-history-1280.png` |

브라우저 콘솔 오류는 상단바의 `GET /health/ready` 503 뿐이다(Redis·AI gateway 를 띄우지 않은 격리 환경의 기대값). `/company` 자체의 오류는 없다.
Next.js 개발 표시("N" 동그라미, `nextjs-portal`)는 운영 빌드에 없는 것이라 촬영 직전에 페이지에서 숨겼다(앱 코드는 바꾸지 않았다). 넘침 측정은 숨기기 전에 했다.

## 4. 남은 일

- 사이드바: `web/components/app-nav.ts` 의 `/company` 를 `status: "released"` 로 바꾸는 일은 사이드바 세션이 한다.
- 병합: 3e 병합 게이트에 기준점을 보고한다. `docs/PROGRESS.md`·`docs/evidence/README.md` 색인은 docs-keeper·e8 몫이다.
