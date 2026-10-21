---
title: "공공 입찰 확장 — Phase 0~8 및 승인 후 구현 계획"
doc: "plan-public-procurement-20261021"
status: review
tags:
  - sol-radar
  - pipeline
  - architecture
  - test
updated: 2026-10-21
---

# 공공 입찰 확장 — Phase 0~8 및 승인 후 구현 계획

> **실행 승인:** 2026-10-21 사용자 “승인할게 시작해.”에 따라 I1~I7 로컬 구현을 시작했다. 운영 DB 적용/배포/실수집/모델·인프라 변경은 승인 범위에 포함하지 않는다. Phase0~8의 과거 완료 문구는 최초 설계 단계 기록이며 후속 결과는 [구현 보고](../evidence/procurement-expansion/20261021-implementation.md)에 따로 기록한다.

> **2026-10-22 운영 추가 승인:** 사용자 지시로 커밋·main 병합·운영 DB 적용·배포를 진행한다. 위 운영 금지는 최초 로컬 구현 승인 시점의 경계다. 신규 API 활성화/실수집·모델 교체·Nginx 변경은 포함하지 않으며 [운영 적용 기록](../evidence/procurement-expansion/20261022-release.md)에서 실제 결과를 구분한다.

**목표:** 기존4+신규6 공식 API와 Source/기관/단계/분야를 분리해 고유 사업기회를 보여주고 기존 AI·점수·사람 결정을 연결한다.

**구조:** 기존 Next 서버 도메인/Route Handler·수집 Worker·Postgres/RLS·Redis/BullMQ·AI Gateway를 확장한다. source bid/revision은 보존하고 opportunity 읽기 모델을 추가한다. 파일 저장과 Gateway는 병렬 작업의 승인/병합 기준을 따른다.

**기술:** 현재 저장소의 Next.js16·React19·Tailwind4·Supabase·Redis/BullMQ·Python. 현재 main의 MinIO와 별도 Storage 작업을 구분한다.

**스펙:** [승인용 설계](../../polaris/specs/in-progress/2026-10-21-public-procurement-expansion.md). 아래 파일의 “신규” 표시는 미래 생성 제안이며 현재 존재 주장과 구분한다.

## 공통 제약과 검토 초점

- SOL Score `sol-v0.1.0`, 가중치30/25/20/15/10, 임계값75/50, `KEV_*`·`/kev`, 사람 결정·DEMO·RLS를 유지한다.
- 기본 `SOL_RUN_MODE=mock`. live에서만 외부 수집, fixture/mock에는 외부 호출0. 자동 실모델/mock 전환 없음.
- 기존 미커밋 파일·migration 이력을 수정/삭제하지 않는다. DB 타입은 새 migration과 같은 커밋에서 생성한다. 커밋 게이트/린트를 끄지 않는다.
- 1440/1280 데스크톱만 설계한다. 모바일·결제·자동 투찰·승률 예측은 제외한다.
- ADR-046을 따른다. 개발 중 `pnpm verify:changed`, 통합/제출 전 `pnpm verify`와 영향 흐름 E2E, 독립 리뷰는 통합1회. 삭제한 시험 전수 행렬을 복원하지 않는다.

가장 중요한 실패 조건은 ① 출처 사본의 잘못된 통합이 사람 결정을 다른 공고에 적용함 ② 수정/취소 누락을 진행 공고로 노출함 ③ 조회 기준/단위 차이로 마감·예산을 오판함 ④ apiKey가 query/오류/원본에서 유출됨 ⑤ 여러 Worker의 quota/접수 중복이다. 각각 I1/I3, I2/I3, I2, I2, I2/I6에서 직접 검증한다.

## Phase 0 — 기존 코드 및 문서 분석

- **목표:** main 구현·병렬 branch·정본·미구현 차이를 증거로 고정한다.
- **수정 대상:** 이번 [조사 기록](../evidence/procurement-expansion/20261021-review.md), 신규 스펙의 현재 상태. 코드는 읽기만 한다.
- **선행 조건:** `docs/CLAUDE.md`·00 인덱스·17 검증 정책·Git 상태 확인. 미션 부재는 작업 중단 조건이 아니다.
- **위험:** 다른 worktree의 완료/승인을 main 완료·운영 승인으로 오인함.
- **검증:** branch HEAD/조상 여부, 원본 파일 hash, 코드·migration·문서 경로 대조. 운영 DB 현재 성공은 주장하지 않는다.
- **완료 조건:** 4기존 API·AI·UI·인력·권한·운영 기능의 구현/계획 구분표와 공유 파일 충돌표 작성. **이번 문서에서 수행함.**

## Phase 1 — 신규 API 명세 검증

- **목표:** 6서비스 문서 계약과 실호출에서 확인할 공백을 분리한다.
- **수정 대상:** 이번 API metadata JSON·조사 기록. 향후 `infra/sources/registry.yaml`은 I2 승인 후에만 수정한다.
- **선행 조건:** 공식 공개 페이지/Swagger, KEPCO 사용자 제공 명세. live 검증에는 키·활용승인·허용된 소량 조회 범위가 필요하다.
- **위험:** LH XML/월별 조회/의견마감 조회/부분 Swagger/키 미발급 여부를 추정함.
- **검증:** 문서 endpoint·파라미터·응답 단위·인증 경로 확인. 향후 read-only 소량 검증은 정상/0건/오류·잘림·첨부를 별도 기록한다.
- **완료 조건:** 공개 문서 확인은 완료, **6종 인증/완전성 실호출은 보류**. 생략 companyId·초기 안정 ID·operation별 입력은 활성화 전 해결한다.

## Phase 2 — 데이터 모델 및 수집 파이프라인 설계

- **목표:** 기존 공고/revision/Worker 재사용과 새 원본·서비스별 실행/사업기회 계약을 정한다.
- **수정 대상:** 스펙§4~5, 정본02/04/07/15의 검토 중 설계 절. 미래 코드 파일은 I1/I2.
- **선행 조건:** Phase0~1, Gateway/Storage 병합 기준과 object 참조 계약 확인.
- **위험:** source 문자열/공고ID FK 파괴, 개인정보 원본 공개, 미완성 documents 의존성 누락.
- **검증:** ER 관계/유일성·RLS·공용/조직 경계·새 DTO와 기존 v0.2 호환 점검.
- **완료 조건:** append-only DB 변경안·조회/증분/cursor/실패/원본 정책 제안 작성. **설계 작성함, SQL 미생성.**

## Phase 3 — 중복 통합 및 SI·AI 분류 설계

- **목표:** 동일 사본/정정/재공고/단계 연결을 구분하고 관련성·점수를 분리한다.
- **수정 대상:** 스펙§6~7, 정본07/15의 승인 전 안내.
- **선행 조건:** 원발급 namespace·공식 연결 필드·stable identity 확보 계획.
- **위험:** 비슷한 제목만으로 확정 통합, 저관련 행 삭제, 미분류를 비관련으로 오인.
- **검증:** 동일번호 다른기관·같은기회 여러출처·변경차수·재입찰·단계연결 사례로 ID/집계/근거 설계를 추적한다.
- **완료 조건:** 확정/후보/별도3상태·연결/복구 이력·관련성5상태·근거/버전·기본 우선 정렬 정의. **설계 작성함.**

## Phase 4 — 기존 AI 분석 연계 설계

- **목표:** 새 출처를 기존 추출·증거·규칙·Bosun·SOL Score에 연결한다.
- **수정 대상:** 스펙§8, 정본03/08/21의 영향도 절. 모델 registry/운영 설정은 수정하지 않는다.
- **선행 조건:** 안정된 revision, 파싱한 원문 또는 부족 표시, 현재 모델/질문세트 계약.
- **위험:** 관련성을 회사 적합도에 혼입, 다른 출처의 예전 분석을 최신으로 복사, 모델 추정으로 법적 자격 확정.
- **검증:** 기존 골든/규칙/Bosun 비덮어쓰기·PARTIAL 계약 검토. 평가 split은 opportunity/revision/첨부 묶음으로 누수 차단.
- **완료 조건:** 현 모델·점수 정책 유지, 별도 관련성 DTO·새 출처 근거 연결·snapshot 무효화 조건 작성. **설계 작성함, 실추론 미실행.**

## Phase 5 — 대시보드 UI 변경 설계

- **목표:** KPI5개와 검토목록/소스상태/early/포트폴리오를 실제 집계 계약으로 정의한다.
- **수정 대상:** 스펙§10, 정본06/05/14 보충. 기존 reference PNG는 보존한다.
- **선행 조건:** opportunity 집계·현재 회사/revision 유효 분석·안전한 Source summary.
- **위험:** 신규발견/검토대기/분석대기를 혼동, 모드/출처/중복을 중복 합산, +3px 정책과 2열 배치 충돌.
- **검증:** KPI와 전체 보기의 동일 scope/시각·null/0/오류 상태 검토, 1440/1280 배치 제안.
- **완료 조건:** 데이터 정의·부품/토큰·표시상태·폭별 배치 명세 작성. **설계 작성함, 브라우저 구현 검증 전.**

## Phase 6 — 입찰 공고 UI 변경 설계

- **목표:** 기본 SI·AI 우선/early OFF·출처/기관/분야 필터·11열·배지 정렬을 정한다.
- **수정 대상:** 스펙§9/11/12, 정본06/05/09 보충.
- **선행 조건:** 새 목록 DTO/cursor·단계/event 구분·기존 status-badge 모듈.
- **위험:** origin을 Source로 바꾸어 호환 파괴, 지자체를 수집처로 오인, LH 정렬·11열 넘침.
- **검증:** 필터 조합/명시 정렬·early 모순 처리·회사코드 매핑·키보드 접근·1280 표 내부 스크롤 예외 검토.
- **완료 조건:** 레퍼런스/문구/11열 순서·상태·배지 규칙·정책 충돌안 작성. **설계 작성함, 화면 코드는 미수정.**

## Phase 7 — 정본 문서 및 ADR 업데이트

- **목표:** 현행 계약을 보존하면서 승인용 설계와 차이를 정본에서 찾게 한다.
- **수정 대상:** 00/01/02/03/04/05/06/07/08/09/10/11/12/14/15/21, 16 ADR-047, PROGRESS. 내용의 단일 원천은 Polaris 스펙이다.
- **선행 조건:** Phase0~6 결과와 사용자 허용 범위. 충돌 조항은 채택으로 바꾸지 않는다.
- **위험:** 제안 문구가 구현 완료/기존 ADR 개정으로 읽힘, 다른 세션의 ADR-043~045 덮어쓰기.
- **검증:** 새 ADR 번호 main/확인 branch 충돌 확인, frontmatter·위키링크·실재 파일 경로·문서 전용 diff 점검.
- **완료 조건:** 검토 중 보충·ADR 제안·진행기록 작성. **이번 작업의 문서 산출물.**

## Phase 8 — 테스트·배포 계획 수립

- **목표:** 승인 후 핵심 시험·순차 활성화·복구·운영 승인 경계를 정한다.
- **수정 대상:** 본 계획, 정본10/11/12의 보충. 실제 시험/배포 설정은 변경하지 않는다.
- **선행 조건:** Phase7 설계 검토, 신규 키 상태/실응답과 통합 기준 SHA 확정.
- **위험:** 전수 조합 시험 복원·전체 API 자동 분석·freeze 일정 무단 변경·배포 승인 혼동.
- **검증:** 아래 I1~I7이 API/데이터/AI/UI/권한/모드 요구를 덮는지 self-review. 문서 검사 결과와 향후 실행 시험을 분리한다.
- **완료 조건:** 단계별 코드 파일·핵심 시험·활성화 차단 조건·운영 롤백 계획 작성. **계획만 작성, 구현 시작 안 함.**

## 승인 후 구현 단위

다음 체크리스트는 최초 승인 전 작업 정의로 보존한다. 후속 실행의 현재 상태는 아래 표와 [구현 보고](../evidence/procurement-expansion/20261021-implementation.md)가 기준이다. 기준 main7133636/격리 feat/public-procurement이며 설치된 Next16 안내를 읽고 구현했다. 운영/병렬 브랜치를 먼저 자동 병합하지 않았다.

| 단위 | 현재 로컬 결과 | 미완료/운영 전 조건 |
|---|---|---|
| I1 | migration2·RLS·기회 조회·생성 타입·FK/org 회귀 통과 | 공유 DB 미적용·커밋/병합 미실행 |
| I2 | P0 Adapter/Worker·마스킹·capture·부분응답·창 재개 검증 | 실인증/금액/완전성·quota 원자 예약/활성화 미실행 |
| I3 | 근거 관련성/매칭·후보 최신판정·대표/충돌·재수신 검증 | source별 사람 라벨·자동 AI 분류·문서 소비자 미완료 |
| I4 | P1 전송/정규화 차단·월 분할·early 읽기·NOTICE 중복 제외 | 안정 ID/상태/operation 입력 미검증, 기존 G2B early 정기 적재 미완성 |
| I5 | 기존 AI/점수 회귀·새 단계 접수 가드 | 신규4단계 AI 계약·실추론 미실행 |
| I6 | 독립 UI 명세 후 대시보드/공고/admin 구현·Chromium2 통과 | 실제 로그인/API E2E 미실행 |
| I7 | 최종 전체 verify165/331/101/57+빌드·독립 리뷰/수정 재확인 | 활성화/공유 DB/배포·predeploy·데모 GO/NO-GO 미실행 |

아래 미체크 항목은 당시 계획의 묶음 단위이며 일부 로컬 검증이 끝났더라도 실호출/운영 조건까지 완료한 것으로 바꾸지 않는다.

### I1. 출처 식별·사업기회와 RLS

**파일:** 기존 `web/server/ingestion/{normalized-bid.model,ingestion.repo,ingestion.port}.ts`, `web/server/bids/{bid.model,bid-row.mapper}.ts`; 신규 `web/server/opportunities/{model,query,repo,index}.ts`, 신규 migration(번호는 착수 시 main 최대/예약대역 확인), 생성 `web/lib/database.types.ts`, 기존 `scripts/database.test.mjs`.

**인터페이스:** v0.2→v0.3 호환 정규화, source-family/agency identity, opportunity/link 관계. 기존 bidId/revisionId와 review/watch/project FK는 그대로다. public 데이터 읽기/worker 쓰기·운영 자료 ADMIN 제한·org별 score/review 경계를 명시한다.

- [ ] 동일 공고2출처·정정revision·다른org분석을 한 시나리오에서 검증하는 핵심 DB/서비스 시험을 먼저 추가한다. source row2/기회1/review FK불변/다른org0행을 단언한다.
- [ ] additive migration·유일성·RLS·호환 DTO를 구현하고 DB 타입을 생성한다. 이력 수정/파괴적 backfill은 하지 않는다.
- [ ] `pnpm verify:changed` 통과와 기존 source 목록/상세 호환 확인 뒤 커밋한다.

### I2. P0 Adapter 3종·서비스별 수집

**파일:** 기존 `infra/sources/registry.yaml`, `infra/run-modes.json`, `.env.example`, `web/.env.example`, `scripts/check-env.mjs`, `web/worker/{env,main,ingest-queue,quota-store}.ts`, `web/server/ingestion/{connector.model,ingestion.service,source-registry,redaction,retry}.ts`; 신규 `kwater-bid-connector.ts`, `lh-bid-connector.ts`, `kepco-contract-connector.ts`와 각 정규화 모듈/필요한 계약 시험.

**인터페이스:** service/operation/partition별 `BidSourceConnector.fetchPage`→공통 정규화→기존 revision 저장. 등록 서비스가 비활성이면 키 누락으로 전체 mock 기동을 막지 않는다. 기존 live4키 정책은 유지하고 신규 활성 서비스에만 승인/key를 요구한다. KEPCO apiKey는 Worker에서만 주입한다.

- [ ] 공식 스키마의 정상1건+기관별 실제 다른 실패형식에 필요한 최소 계약 시험, JSON/XML 단건/배열 차이를 추가한다. 인증 실패·정상0건·장애를 혼동하지 않는지 단언한다.
- [ ] KEPCO query/error/encoded secret 비노출, 90일/91일 분할·company identity·`-`·case 충돌·HTTP첨부 차단을 직접 시험한다. 정상 키 고의 실패는 mock transport로만 검증한다.
- [ ] quota 공유/재시도 호출 수·페이지 재개·운영 병렬 계획의 원자 예약 계약을 연결하고, read→call 경합 상태에서는 여러 호출자를 활성화하지 않는다.
- [ ] 승인된 소량 read-only 실호출로 키/승인·operation 요청·응답완전성·금액/첨부를 확인한다. 확인 전 registry를 callable로 만들지 않는다.
- [ ] 한 서비스씩 활성화하고 `pnpm verify:changed`로 검증한다. 최초 수집 범위/비용은 승인한 창으로 제한한다.

### I3. 중복/단계 연결·관련성

**파일:** 기존 `web/server/ingestion/{revision,stage-link,g2b-filter,checksum}.ts`; 신규 ingestion의 opportunity 매칭/관련성 모듈(상세 파일 분할은 단일 담당자가 확정), I1 표의 repo, 신규 최소 재현 시험.

**인터페이스:** 확정/후보/별도, stage-link와 duplicate 구분, append-only 판정 이력. `relevance-v0.1`은 스펙§7의 채널점수·missing·근거를 입력으로 하고 SOL Score를 소비/생성하지 않는다.

- [ ] 같은번호 다른기관·재입찰·공식중복·수정/취소순서·오래된응답·후보미통합을 대표 사례로 고정한다. 무차별 조합 행렬은 만들지 않는다.
- [ ] 동일 입력 재수집에서 원본/처리량만 기록되고 새 revision/기회가 늘지 않는지 확인한다.
- [ ] 제목에 AI가 없는 SW유지보수 양성·데이터케이블 음성·본문미확보 미분류·증거충돌을 검증하고 source별 사람이 라벨링한 소량 표본으로 초기 정책을 검토한다.
- [ ] KPI distinct와 후보 별도표시·대표revision 변경 후 점수 stale 처리를 검증한다.

### I4. P1 3서비스와 기존 early 서비스

**파일:** 신규 K-water plan/LH pre-spec/G2B request Connector/normalizer, 기존 `infra/sources/registry.yaml`, `normalized-bid.model.ts`, Worker 서비스 선택. 기존 G2B pre-spec/order-plan fieldMapping을 완성하고 업종 마스터를 참조 데이터로 분리한다.

**인터페이스:** PLAN/PROCUREMENT_REQUEST/PRE_SPEC 공통 읽기 + 각 조회 기준/날짜정밀도. K-water/LH stable ID 미확보 row는 provisional, 자동 통합에서 제외한다.

- [ ] 월 단위/의견마감일 조회·백만원 단위·동일 이름 계획2건·안정 ID 미확보를 직접 검증한다.
- [ ] 키/활용승인·날짜상한·정정탐지를 실제 확인한 operation만 켠다. 지원 안 되는 필드는 결측으로 보존한다.
- [ ] NOTICE가 존재하는 확정 동일기회는 early panel 중복에서 제외하고, 제목만 비슷한 계획은 숨기지 않는다.

### I5. 기존 AI 연계·회귀

**파일:** 기존 `web/worker/{analysis-job,analysis-runtime}.ts`, `web/server/analysis`, `web/server/scoring`, `services/ai/src/sol_ai`의 필요 adapter/별도 관련성 DTO. 기존 model registry·점수 상수는 변경하지 않는다.

**인터페이스:** source revision→기존 Extraction/Evidence→같은 score input. 관련성 Gateway 작업은 별도 버전, 조직의 최종 결정을 생성하지 않는다. 실첨부 downloader/Storage/parser 소비자는 별도 선행 계획에서 완료되어야 한다.

- [ ] 현재 기준 SHA의 기존 골든·필수자격미충족·정보부족·Bosun비덮어쓰기·모델장애PARTIAL을 재사용한다. 200명 통합 변경이 먼저 들어오면 승인된 새 기준과 그 근거를 확인하고 기대값을 임의 복사하지 않는다.
- [ ] 새기관 원문근거 누락/인용불일치→NEEDS_REVIEW, 대표source 변경→기존run불변을 시험한다.
- [ ] 필요할 때만 소량 실추론을 별도로 승인/측정한다. 성능평가·파인튜닝·모델 승격은 기존21/22 절차를 유지한다.

### I6. 업무 UI·운영 통계

**파일:** 신규 `web/app/api/v1/opportunities/route.ts`, `web/app/api/v1/dashboard/opportunity-summary/route.ts`, `web/app/api/v1/ingestion/source-summary/route.ts`, `web/app/api/v1/admin/ingestion/services/route.ts`; 기존 `web/app/(app)/(work)/dashboard/{page.tsx,dashboard-view.tsx,dashboard-queries.ts}`, `web/app/(app)/(work)/bids/{page.tsx,bid-list-view.tsx,list-query.ts}`, `web/components/bids/{bid-filters,bid-table,status-badge}.tsx`, 기존 admin ingestion 폴더·service/model/repo.

**인터페이스:** 스펙§9 DTO/정렬/cursor, §10 KPI, §11 11열/SourceBadge, §12 통계/ADMIN. 새 RPC/VIEW는 사용자 세션 RLS를 보존하고 서비스롤을 웹에 들이지 않는다. API contract 버전을 먼저 고정한다.

- [ ] 독립 web-designer 설계 검토를 **UI 구현 전**에 받는다. 이번 산출물은 메인 에이전트가 작성한 디자인 제안이며 독립 디자인 검토 완료로 보고하지 않는다.
- [ ] 목록 조건과 KPI 전체보기가 같은 scope/수치를 쓰는 통합 시험1개, explicit sort·필터변경cursor초기화·early모순을 계약 수준에서 검증한다.
- [ ] ADMIN 수동접수 성공·일반역할403·다른조직분석404·통계GET의 queue 호출0을 검증한다. 기존 rate/idempotency 시험을 재사용한다.
- [ ] SourceBadge/LH 중앙정렬·긴기관명·11열·0/null·DEMO를 대표 화면으로 검증한다. 기능흐름은1440, 배치/넘침은1280에서 확인한다.

### I7. 통합·단계적 활성화·배포

- [ ] 통합 SHA에서 전체 `pnpm verify`1회, 변경 흐름 E2E, 독립 리뷰1회, 세 실행모드 확인을 수행한다. 변경하지 않은 템플릿/삭제된 전수 시험은 복원하지 않는다.
- [ ] `/predeploy-review`와 데모 GO/NO-GO를 받는다. 실 API/첨부/AI가 일부만 검증됐으면 범위를 표시하고 준비되지 않은 서비스는 disabled로 둔다.
- [ ] 배포할 SHA·migration목록·backfill기간·service별enable·키이름·검사결과·복구안을 구체화한 뒤 운영 DB 적용/배포 승인을 요청한다. 이번 문서 승인이 운영 전체 재수집 승인으로 확장되지 않는다.

## 핵심 검증 범위

| 요구 | 최소한의 직접 검증 | 실행 위치 |
|---|---|---|
| API 인증/실패/0건·XML/JSON·page/rate/date | 각 service 정상 스키마+실제 상이한 envelope, 공통 retry/페이지재개·90일 경계. 실제 quota소진/키실패 유발 금지 | I2/I4 Connector 계약 + 소량 live 증거 |
| 정정/취소/중복/기관·출처 | 공식중복1개·후보1개·별도공고1개에 revision/취소/재입찰 이력을 포함. 기존id/근거 보존 | I1/I3 DB+서비스 |
| 날짜/예산/첨부 | KST/date-only·백만원·금액종류불명/null·HTTP차단·실첨부 접근은 별도 smoke | I2/I4 및 기존 문서 파이프라인 |
| 관련성/추출/점수/권고 | 오탐/미분류/근거누락, 기존 골든/AI비덮어쓰기/법적자격확인필요 | I3/I5, 기존 시험 우선 |
| KPI/필터/검색/정렬/테이블/LH | 같은 조건 count/list 일치, 명시sort 우선·servercursor, 1440흐름/1280배치·중앙정렬 | I6 DB/계약 + 선택 browser/E2E |
| 모드/권한 | fixture/mock 외부호출0, live만활성service, DEMO, 비ADMIN실행거부, org격리, summary 비밀없음 | I2/I6 기존 시험 확장 |

## 운영 전환과 복구 계획

활성화 순서는 새 schema/호환 읽기→disabled Adapter→P0 한 서비스 소량 검증→제한 초기수집→중복/분류 점검→UI 노출→P1 순이다. 실추론 자동 전체 분석·운영 전체 backfill은 기본 단계에 없다. Gateway/Storage/문서처리 변경은 해당 계획의 승인 단위를 유지한다. 현재 ADR-042 일정은 바꾸지 않으며 새 범위가 freeze 안에 들어갈지 검토 후 사용자가 결정한다.

문제가 생기면 해당 서비스 scheduler/신규접수만 멈추고 기존 분석·원본·revision·기회 link·Redis 사용량을 보존한다. quota를0으로 초기화하지 않는다. 이전 UI/읽기 release로 복구할 수 있게 additive schema를 유지한다. 잘못된 통합은 link 판정 이력으로 분리하고 기존 사람 결정·점수 FK를 이동시키지 않는다. 원본/Storage object/DB행을 지우는 롤백은 하지 않는다. DB 보정은 새 migration, 운영 적용은 별도 확인이다.

## 최초 설계 단계의 종료 조건

문서·공식 metadata·새 ADR 제안만 변경했음을 확인하고, 보존 파일 hash와 실제 검증 결과를 PROGRESS/evidence에 남긴다. 승인용 스펙·ADR-047·핵심 미확인 입력을 보고하고 **구현을 시작하지 않은 상태에서 사용자 승인을 기다린다.**

## 관련 문서

- [승인용 설계](../../polaris/specs/in-progress/2026-10-21-public-procurement-expansion.md)
- [[20261021-review|현황·API 조사]]
- [[16-DECISIONS|ADR-047 제안]]
- [[11-TESTING|MVP 시험 정책]]
- [[12-ROADMAP|기존 일정]]
