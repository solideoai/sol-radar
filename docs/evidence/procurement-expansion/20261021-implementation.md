---
title: "공공조달 확장 — 승인 구현·검증 보고"
doc: "procurement-implementation-20261021"
status: review
updated: 2026-10-21
---

# 공공조달 확장 구현 보고

> 이 문서는 10-21 격리 구현 시점 기록이다. 10-22 사용자 추가 운영 승인과 최신 main 통합·실제 적용 결과는 [후속 기록](20261022-release.md)을 따른다.


사용자 후속 “승인할게 시작해.”에 따른 격리 브랜치 `feat/public-procurement`, baseline `7133636` 구현 기록이다. 원래 main과 다른 작업 트리의 변경은 수정하지 않았다. 변경은 해당 작업 트리에 미커밋 상태로 남겼으며 main 병합·push는 하지 않았다. 최초 [조사](20261021-review.md)와 [문서 검사 JSON](20261021-document-check.json)은 설계 단계 증거이며 현재 코드 검증 결과를 뜻하지 않는다.

## 1. 현재 구현

기존 Next.js16·Supabase RLS·Redis/BullMQ·Qwen/Bosun·SOL Score를 유지한다. source 공고/revision과 조직별 분석/최종 결정의 ID는 바꾸지 않고, 공통 사업기회 조회·관련성·다기관 수집 경로를 추가한다. 관심 공고/입찰 프로젝트/Storage/Gateway/문서 소비자 등 병렬 브랜치 기능은 자동 병합하지 않았다. 모델 registry나 가중치를 수정하지 않는다.

## 2. 기존 조달청 4개

15129394 입찰공고와 보조3조회는 기존 경로를 유지한다. live Worker는 정보화 사전 필터만 해제해 수집 후 관련성 분류로 전환하며 Connector의 기본값/인증/호출 예산은 보존한다. 15129437 사전규격·15129462 발주계획·15129467 업종/법규는 승인/녹음 증거를 유지하지만 정기 적재 미완성 상태를 정상 서비스로 꾸미지 않는다. 신규 사업기회 투영은 기존 공고에도 적용되며 기존 `/api/v1/bids` source ID 계약은 보존한다.

## 3. 신규 API6 검증

| 서비스 | 코드/정규화 | 실제 활성화 조건 |
|---|---|---|
| K-water 입찰 | JSON/XML 전송·월별 조회 분할 | servcList 필수입력/상태 의미·실인증 검증 전 NOT_VERIFIED |
| LH 입찰 | XML 전송/파싱 | 상태 코드 의미·실인증 검증 전 정규화 차단 |
| K-water 발주계획 | 전송/단위 보존 | servc 입력·안정 ID 검증 전 격리 |
| LH 사전규격 | XML 파싱/의견 일정 분리 | 안정 ID 검증 전 격리 |
| G2B 조달요청 | operation별 입력 제한 | 용역 목록 입력/제목·식별 계약 검증 필요, detail을 목록처럼 취급하지 않음 |
| KEPCO | 14 companyId·상태/일정/첨부·대소문자 alias·결측 처리 | 실인증/회사 전체조회/완전성 미검증, PARTIAL·대표예산 null |

6서비스 모두 기본 disabled/NOT_VERIFIED다. 미검증을 성공/정상0건으로 기록하지 않는다. 데이터가 없는 기관의 제공을 보장하지 않는다. 실제 API 호출은 이번 구현에서 수행하지 않았다.

## 4. 키 상태

기존4개는 과거 활용승인/실호출 증거 유지. KEPCO 40자리 키는 사용자 확인으로 **발급 완료**, 실인증 미검증이다. 나머지 신규5개는 **발급 상태 미확인**이며 미발급으로 단정하지 않는다. 실제 비밀 파일/키를 읽거나 복사하지 않았다. 지정 env 이름을 `web/.env.example`에 추가했고 NEXT_PUBLIC 키는 없다.

## 5. KEPCO 실연동 검증

허용된 소량 창에서 인증 성공/실패/정상0건을 먼저 구별한다. companyId 생략과 회사별 응답의 집합·누락·중복을 비교하고 90일 경계/일정 정밀도/금액별 의미/상태 전환을 확인한다. API는 페이지/총량을 보장하지 않아 완전성 증거 전 cursor/watermark를 전진시키지 않는다. 첨부 URL은 별도 HTTPS 호스트 허용/리디렉션/익명 접근 검증 후 허용하며 HTTP는 자동 다운로드하지 않는다. apiKey·serviceKey·URL·오류·정제 payload 마스킹 시험을 통과해야 활성화한다.

## 6. PostgreSQL 변경

새 migration `20261023000100_procurement_opportunities.sql`·`20261023000200_procurement_reads.sql`과 생성 DB 타입을 추가했다. source family/기관·opportunity/link·중복 후보·이벤트·관련성 평가·private payload/run item을 추가한다. 대표 선정은 최초 연결·출처 수정/취소·분리 뒤에도 같은 NOTICE 우선 규칙과 선정 근거를 적용한다. 업무 읽기는 security_invoker 뷰/RLS, 운영 상태 함수는 업무 역할 확인 뒤 안전한 요약 열만 반환한다. Worker 전용 연결/보완 함수는 authenticated에서 실행할 수 없다. **운영 DB에는 적용하지 않았다.**

## 7. 정규화·중복

v0.2 fixture/G2B를 유지하고 신규 외부 DTO는 v0.3다. source family·service key·agency namespace·companyId·stage·provider event를 분리한다. 원본 공고의 FK/개정은 보존하며 확정 공식 식별 근거만 기회 연결에 사용한다. 제목 유사성은 후보로 저장한다. 정정은 revision/event, 취소와 유찰/개찰/종료는 다른 의미다. DEMO/live는 병합하지 않는다.

private payload는 키/담당자를 제거한 파싱 구조 JSONB이며 원 전송 byte 사본은 아니다. 원본 형식은 content_type에 남긴다. Storage 병렬 구현과 중복 SDK/원장을 만들지 않았으며 object_ref는 이후 통합용이다.

## 8. 공공 SI·AI 우선

제목30/공식업종20/본문25/첨부25의 근거 채널 점수·5상태·분야/태그·인용·버전/해시를 저장한다. 미분류/낮은 관련성도 삭제하지 않고 SI·AI 우선은 기본 정렬로만 작동한다. 관련성 점수는 SOL Score에 넣지 않는다. 첨부 근거/verified classifier 입력 훅은 있으나 문서 소비자·AI 자동 분류 실행이 완료된 것으로 보고하지 않는다. 제목만으로 RELEVANT를 확정하지 않는다.

## 9. AI 영향

기존 PLAN/PRE_SPEC/NOTICE 입력·sol-v0.1.0·가중치30/25/20/15/10·임계75/50·법적 자격 NEEDS_REVIEW를 유지한다. 새 source의 NOTICE는 기존 분석 경로를 사용한다. PROCUREMENT_REQUEST/OPENING/AWARD/CONTRACT는 현재 조회 단계이며 기존 AI wire가 받지 않으므로 STAGE_NOT_SUPPORTED로 접수 전에 거절한다. 원문 부족과 첨부 실패는 기존 PARTIAL/검토 필요 정책을 따른다. 출처 사본에 예전 분석 점수를 복사하지 않는다.

## 10. 대시보드

5 KPI·우선 검토·4 Source/10 서비스 상태·예정 사업/사전규격·권고 포트폴리오를 DB 집계로 연결한다. 원본 행 수와 고유 기회 수를 구별한다. DEMO는 표시하고 집계 origin을 분리한다. [UI 명세](../../plans/2026-10-21-public-procurement-ui-spec.md)를 따른다.

## 11. 입찰 공고

11열·Source/기관/단계/상태/분야/권고/결정·명시 정렬·SI/AI 우선 기본ON·early 기본OFF를 제공한다. HMAC 커서가 조직/필터/정렬/실제 표시 상태 해시와 묶이며 서버에서 페이지/총수를 계산한다. 상세는 대표 source bid ID로 열고 새 필터로 복귀한다. LH 포함 SourceBadge는 같은 중앙 정렬 부품이다. 서버는 현재 revision/profile에 유효한 완료 점수와 최신 실행 상태를 분리하며 재분석 대기·실패로 기존 유효 점수/사람 결정을 지우지 않는다. 출처 간 취소/금액/마감 충돌은 별도 경고·BID/마감 집계 보류·포트폴리오 별도 검토로 표시한다.

## 12. 정본문서

00~12·14~16·21/PROGRESS, Polaris 승인 스펙, 실행 계획, UI 명세에 승인·실제 구현·운영 미적용을 구분해 기록한다. 최초 조사 기록은 역사적 증거로 보존한다. `docs/CLAUDE.md`의 핵심 정책, 임계값/모델/기존 마이그레이션/운영 설정은 수정하지 않았다.

## 13. ADR

ADR-047을 후속 사용자 승인으로 채택했다. 원본 source/FK 보존·별도 기회 ID·관련성/SOL Score 분리·disabled 신규 서비스·기존 UI 재사용이 핵심이다. 정제 payload의 이번 JSONB 보관, 신규 단계 분석 차단을 구체화한 경계도 승인 스펙에 기록했다.

## 14. 구현·시험

최종 `pnpm verify` **exit 0**: 루트 **165**, 웹 **331**, AI **101**, 결정 모델 서버 **57** 시험과 웹 프로덕션 빌드·서식·타입·린트/가드·계층·토큰·DB 타입 검사를 통과했다. [전체 로그](20261021-verify.txt), [기계 판독 검증 기록](20261021-verification.json). Chromium 부품 시험 **2/2**는 [기록·캡처](ui/20261021-component-verification.md)에 있다. 부품 DEMO props 검증이며 실제 로그인/API 연결 E2E는 아니다.

독립 통합 리뷰 Important4건(재분석 중 유효 점수/결정 보존, 분석 상태 변경 커서 무효화, 단계 대표 선정, 출처 충돌 보류)과 후보 최신판정 집계를 수정했다. 원래 기회에서 대표를 분리할 때 남은 NOTICE가 대표가 되는 동일 PGlite 재현까지 재확인했고 한정 재검토의 잔여 Important는 없다. 관련 DB 시험2개가 전체 루트 검사에 포함됐다. 새 상수 메모리 DB 상태 해시는 완료 시 created_at이 유지돼도 표시 상태가 바뀌면 cursor를 무효화한다. 중복 후보는 pair별 최신 판정과 아직 분리된 기회만 센다.

처음 변경 범위 검사는 공유 Git의 core.bare=true와 상속 GIT_WORK_TREE 때문에 임시 Git 시험이 실패했다. 공유 설정을 바꾸지 않고 명령 프로세스의 core.bare=false override로 해결했다. 중간 검사는 동시 작업 중 서식 파일 때문에 중단됐고, 첫 전체 검사의 알림 시험9개는 시험 도우미가 ilike를 지원하지 않아 실패했다. 도우미에 실제 LIKE 와일드카드/escape 처리를 추가한 뒤 알림23개와 최종 전체 검사가 통과했다. 공백만 입력한 검색어가 cursor 지문을 바꾸는 경우를 재현하고 null로 정규화했다. Next16 설치 문서에 따라 registry를 server file trace에 포함하고 dashboard/admin/source-summary 실제 NFT 포함3개를 확인했다.

Python의 기존 httpx/Starlette 사용 중단 예정 경고와 별도 브라우저 검사의 Vitest core/browser 패치 버전 차이 경고는 남아 있다. 실인증·실모델 추론·운영 서버·전체 Compose·실제 로그인/API E2E는 실행하지 않았다. 실제 신규 API 데이터 수신·분류 정확도·수집 범위가 입증된 것으로 보고하지 않는다.

## 15. 남은 사항·운영 승인

신규5키 발급/활용승인·KEPCO 실제 키 설치/소량 검증·불명확한 API 필드/상태/완전성·첨부 허용 호스트·Storage/Gateway 병합 SHA·신규 단계 AI 계약 확장·실제 로그인/API E2E·source별 사람 라벨 검토는 남아 있다. 기존 Redis read→call 호출 예산의 다중 호출자 원자 예약은 병렬 인프라 계약 통합 전 미완성이므로 다중 수집자 활성화 전 별도 검증한다. 배포/공유 DB migration/신규 API 활성화/전수재수집은 실행하지 않는다. 검토 가능한 코드와 검증 보고를 제출한 뒤 운영 적용 승인을 기다린다.
