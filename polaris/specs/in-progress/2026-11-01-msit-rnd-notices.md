# 스펙: 과기정통부 R&D 공모 수집·부처 지원사업 탭 표시

- 최종 갱신: 2026-11-01
- 승인: 2026-11-01 사용자 승인("이대로 승인할게"). 다음은 구현 계획이다.
- 출처 표기: [사용자 결정] = 사용자가 2026-11-01 대화에서 직접 정함. [메인 판단] = 메인 세션이 정하고 사용자에게 보여 준 뒤 이의가 없었음("없어, 설계 문서 써 줘"). [작업자 몫] = 구현자가 정한다.
- 관련: [부처 지원사업 공고 스펙](../done/2026-10-21-agency-program-notices.md)(이 문서가 그 §2 "과기정통부 직접 연결 안 함"을 바꾼다), ADR-040(부처 공고), ADR-069(IT 공고만 보이기), ADR-058(출처 배지 색), ADR-073(화면 동결 11-03).

## 1. 목표

영업팀과 공고 검토 담당자가 입찰 공고를 보던 SOL RADAR 안에서 정부 R&D 연구과제 공모도 함께 본다. [사용자 결정] 첫 출처는 과학기술정보통신부 사업공고이고, 화면 동결(2026-11-03) 전에 운영에 반영한다. [사용자 결정: 1안]

성공 기준: 운영 사이트 `/bids/programs`에서 출처를 "과기정통부"로 고르면 최근 과기정통부 R&D 신규 공모가 보이고, 원문으로 이어진다. 랜딩의 출처 로고 띠에 과기정통부가 있다.

## 2. 비목표

- **NTIS 국가R&D 통합공고는 붙이지 않는다.** [사용자 결정] 공고 Open API가 없다(Open API 8종에 공고 없음). robots.txt가 사이트 전체 수집을 막고(`Disallow: /`), RSS는 로그인을 요구한다(2026-11-01 확인).
- **IRIS 연구과제 공고는 발표 뒤 약관을 확인하고 다시 정한다.** [사용자 결정] 공고 API가 없다. 목록 화면은 robots.txt가 허용하지만 이용약관을 확인하지 않았고, 운영 기관이 KISTEP에서 KISTI로 넘어가는 중이다(2026-08-27 협약 보도).
- 따라서 `NTIS_API_KEY`·`IRIS_API_KEY`는 만들지 않는다. env 예시에도 넣지 않는다.
- AI 추출, SOL Score, 권고(BID/WATCH/NO-BID), 알림은 하지 않는다. 기존 부처 공고와 같다(ADR-040).
- 대시보드(`/dashboard`)에 R&D 칸을 더하지 않는다. 발표 첫 화면이라 동결 직전에 건드리지 않는다. [사용자 결정: A안] 발표 뒤 다시 정할 수 있다.
- "R&D 연구과제" 탭을 따로 만들지 않는다. [사용자 결정: A안]
- 첨부 HWP에서 신청 기간·마감일을 뽑지 않는다. 발표 뒤 일이다. [메인 판단]
- 담당자 이름·전화번호(`managerName`·`managerTel`)는 저장하지 않는다. [메인 판단] 원문에서 확인한다. 2026-10-21 스펙 §5의 개인정보 원칙과 같다.
- 탭 이름 "부처 지원사업"은 바꾸지 않는다. [메인 판단]
- 상세 페이지 HTML 긁기는 하지 않는다. API 응답만 쓴다. [메인 판단]
- 기존 기업마당 수집의 동작(분야 `02`, 최대 100건, 일정, 기동 검사)은 바꾸지 않는다. 중기부 RSS를 회사 운영에서 끈 상태(2026-10-28 사용자 결정, `web/worker/program-notices-only-main.ts` `SCHEDULED_SOURCES`)도 유지한다.

## 3. 소스

| 항목 | 내용 (2026-11-01 공개 문서로 확인, 실호출은 아직) |
| --- | --- |
| 이름 | 공공데이터포털 15074634 "과학기술정보통신부_사업공고" (과학기술정보통신부 정보화담당관) |
| 문서 | https://www.data.go.kr/data/15074634/openapi.do |
| 요청 | `GET https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList` |
| 파라미터 | `ServiceKey`, `pageNo`, `numOfRows`(문서상 두 자리, 99까지로 추정), `returnType`(`xml` 기본, `json`). 기간·검색어 파라미터는 없다 |
| 응답 필드 | `subject`(제목), `viewUrl`(상세 주소), `deptName`(담당 부서), `managerName`, `managerTel`, `pressDt`(게시일), `fileName`, `fileUrl`, `totalCount` |
| 없는 것 | 공고번호, 사업명, 신청 시작·마감일, 예산. 상세 본문에도 신청 기간은 없고 첨부 HWP에만 있다(2건 확인) |
| 한도 | 개발계정 하루 10,000건, 자동승인, 무료 |
| 게시판 성격 | 최근 17건 중 신규 공모 5, 선정결과 7, 기타 3, 판별 불가 2. 3주에 신규 공모 5건 안팎 |

- **키 이름**: `MSIT_ANNOUNCEMENT_API_KEY`. [사용자 결정] 서비스별 키 원칙(ADR-022)에 따라 나라장터 키와 이름을 나눈다.
- **키 값**: 공공데이터포털 일반 인증키는 계정 단위라 나라장터 키와 같은 값일 가능성이 높다. 사용자가 15074634에 활용신청만 하면 된다. 포털의 **Encoding 키를 그대로** 넣는다. 나라장터 키와 같은 규칙이다: Worker가 `decodeURIComponent`로 한 번 디코딩하고, 요청을 만들 때 한 번만 인코딩한다(`docs/07-DATA-PIPELINE.md:140`).
- **넣는 곳**: 회사 서버 `sol-radar-app` checkout의 `infra/.env.worker.local`(부처 공고 전용 Worker의 `env_file`, `infra/compose.program-notices-only.company.yaml:23`)이다. 로컬 Compose는 `infra/.env`에 넣는다. Vercel에는 넣지 않는다(`docs/10-DEPLOYMENT.md:107-112`). `NEXT_PUBLIC_` 금지, 웹 번들 금지, 로그 금지.
- **응답 순서·날짜 형식·JSON 모양**(`response.body.items` 구조, `pressDt` 형식, 첨부가 여러 개일 때 모양)은 실호출로 확인하지 않았다. 첫 실호출 1회로 확인하고 녹음한다(§8, 승인 필요).

## 4. 수집

- **자리**: 부처 지원사업 경로(`infra/sources/program-notices.yaml` → `program_notices`)의 세 번째 출처로 넣는다. 출처 키는 `msit`다. [메인 판단] 입찰 경로(`registry.yaml`)에는 넣지 않는다. 입찰이 아니고, `source-registry.ts:18-23`의 키 이름 정규식이 `*_API_KEY`를 받지 않아 registry 전체 로드가 실패한다.
- **설정**: `program-notices.yaml`에 `msit` 항목(`enabled`, `baseUrl`, `keyEnv: MSIT_ANNOUNCEMENT_API_KEY`, `maxItems`)을 더한다. `config.ts`에 `msitSchema`를 더하고 허용 호스트는 `apis.data.go.kr`로 고정한다. `http.ts` `PROGRAM_NOTICE_HOSTS`에도 더한다. 리다이렉트는 지금처럼 따르지 않는다.
- **양**: 한 회차에 요청 1번, `numOfRows = maxItems`(기본 50, 최대 99)로 최신 쪽 하나만 받는다. [메인 판단, 검토 뒤 100건에서 줄임] 지금 수집 구조가 출처 하나에 요청 하나·본문 하나를 전제한다(`collect.service.ts:49-55` `SourcePlan.liveRequest`, `recording.ts`가 출처마다 녹음 하나). 여러 쪽을 부르려면 이 구조를 고쳐야 해서 동결 전 범위를 넘는다. 3주에 17건 안팎이 올라오므로 50건이면 두 달 남짓을 덮는다. 하루 호출은 8번으로, 한도 10,000의 0.1%다.
- **응답 순서**: 최신 순이라고 가정한다. 실호출(§8의 1단계)에서 오래된 순으로 확인되면 `totalCount`로 마지막 쪽을 부르는 요청 2번 구조가 필요하다. 그때는 동결 전 반영을 다시 판단한다.
- **주기**: 회사 부처 공고 전용 Worker가 기업마당과 같은 회차(KST 3시간 정각, 일정 id `bizinfo-scheduled`)에서 함께 부른다. 새 일정을 만들지 않는다. [메인 판단] `SCHEDULED_SOURCES`를 `["bizinfo", "msit"]`로 바꾼다.
- **Worker 기동 검사**: 기업마당 규칙(꺼짐·키 없음이면 기동 거부, `readProgramNoticesPlan`)은 그대로 둔다. 과기정통부는 설정이 틀리거나 키가 비면 **그 출처만 건너뛰고** 기동은 한다. `--check`·기동 로그에 "과기정통부: 키 없음, 건너뜀" 같은 한 줄을 남긴다. 값은 출력하지 않는다. [메인 판단]
- **키 가리기**: `ServiceKey`가 쿼리 문자열로 간다. 요청 URL이 로그·오류·`program_notice_runs`·녹음 파일에 남을 때 원문 키와 URL 인코딩된 키를 **둘 다** 가린다(지금의 `secrets` 배열에 두 형태를 넣는다).
- **걸러내기**: 정규화 단계에서 제목에 `선정결과`·`선정 결과`·`평가결과`·`평가 결과`·`수상작`·`결과 공고`·`결과공고` 중 하나가 있으면 저장하지 않는다. [메인 판단] 걸러 낸 건수는 `program_notice_runs.dropped_count`에 넣지 않는다. 그 열은 "필수 필드가 없어 버린 수"이고 `dropped > 0`이면 회차가 PARTIAL이 된다(`collect.service.ts:213`). 게시판의 40% 안팎이 선정결과라 매 회차가 PARTIAL이 되는 것을 막으려는 것이다. 걸러 낸 건수는 Worker 로그 한 줄로만 남기고, 회차 상태는 SUCCEEDED다. [메인 판단, 검토 반영] 단어 목록의 세부(예: "결과 안내")는 [작업자 몫]. "선정계획 공고"는 과기정통부가 공모를 이렇게 부르므로 빼지 않는다.
- **IT 필터 면제**: 과기정통부 공고는 ADR-069의 IT 단어 필터를 거치지 않고 모두 보인다. [사용자 결정: 1] 근거: 최근 공모 제목 7건을 `isItProgramNotice`에 넣으니 7건 모두 걸러졌다(2026-11-01). 면제는 목록 조회(`list.service.ts:202`의 `itKeys`)에서 `source === "msit"`이면 IT로 보는 방식이다. 기업마당·중기부 규칙은 그대로다.
- **정규화** (`normalizedProgramNoticeSchema`에 맞춘다)
  - `sourceNoticeId`: `viewUrl`의 `nttSeqNo`. 없으면 그 행은 버린다.
  - `title`: `subject`.
  - `agency`: `과학기술정보통신부 {deptName}`. `deptName`이 없으면 `과학기술정보통신부`. 소관기관 검색에 "과학기술정보통신부"가 걸리게 한다. [메인 판단]
  - `sourceUrl`: `viewUrl`. 호스트가 `www.msit.go.kr`이 아니면 버린다. `http`면 같은 주소의 `https`로 올린다. 스키마가 `https`만 받는다.
  - `publishedAt`: `pressDt`를 KST로 읽은 시각.
  - `applyStartOn`·`applyEndOn`·`summary`·`applyMethod`·`target`: `null`. `tags`: 빈 배열.
  - `dedupeKey`: `dedupeKeyOf(title, "과학기술정보통신부")`. 담당 부서를 넣지 않아야 같은 공고가 기업마당에 `jrsdInsttNm = 과학기술정보통신부`로 실렸을 때 묶인다.
  - `isDemo`: `false`.
- **기업마당과의 중복**: 지금 규칙대로 같은 `dedupeKey`면 기업마당 행을 대표로 보인다(`list.service.ts:207-212`). 기업마당 행에는 신청 기간이 있어 오히려 낫다. IT 면제는 `dedupeKey` 단위라 기업마당 대표 행도 함께 보인다.
- **실패**: 과기정통부가 실패해도 기업마당 회차는 그대로 끝난다. 실패는 `program_notice_runs`에 `source = msit`로 남는다. 응답의 `resultCode`가 정상이 아니면 기존 오류 코드(`RESPONSE_SHAPE` 등) 중 맞는 것을 쓴다. [작업자 몫]

## 5. 저장

- **표는 새로 만들지 않는다.** `program_notices`·`program_notice_runs`를 그대로 쓴다.
- **새 마이그레이션 1개**: 두 표의 `source` check 제약에 `msit`를 더한다(`20261023000800_program_notices.sql:53`, `:91`의 `('bizinfo','mss')`). 기존 파일은 고치지 않는다.
- 마이그레이션 번호는 **쓰기 직전에 main의 최대 번호를 다시 확인**하고 그보다 크게 붙인다. 2026-11-01 기준 마지막은 `20261030002000_google_calendar_links.sql`이다.
- 생성 타입(`pnpm db:types` → `web/lib/database.types.ts`)을 같은 커밋에 넣는다.
- RLS·읽기 정책은 바뀌지 않는다. `scripts/database.test.mjs`에 `msit` 행 쓰기가 check를 통과하는 시험을 하나 더한다.

## 6. 화면 (`/bids/programs`, A안) [사용자 결정: A]

시안: 이 세션의 시각 시안 "A안 자세히"(출처 필터 "과기정통부" + 상세 서랍).

- **출처 선택**: `전체 · 기업마당 · 중기부 · 과기정통부`(`program-filters.tsx:33-36`). 쿼리 값은 `source=msit`. 서버 `parseProgramNoticeListQuery`가 같은 값을 받는다.
- **출처 배지**: 글자는 "과기정통부"(`programs-copy.ts` `SOURCE_LABEL`, `program-notice.model.ts` `PROGRAM_NOTICE_SOURCE_LABELS`). 색은 부처 공고 공통 중립색이다(ADR-058). 시안의 파란색은 설명용이었다. [메인 판단]
- **설명 문구**(`PROGRAMS_DESCRIPTION`): "기업마당·중기부 지원사업은 IT 관련 공고만, 과기정통부 R&D 신규 공모는 모두 보입니다. SOL Score와 권고는 계산하지 않습니다."
- **신청 마감 칸**: 과기정통부 행은 "기간 미표기" 대신 "공고문 확인"이다. 기업마당이 대표인 행은 기업마당 기간을 보인다.
- **정렬**: 지금 규칙 그대로다. 마감 빠른 순이면 마감이 없는 과기정통부 행은 아래쪽에 모이고, 그 안에서는 등록일 최신 순이다(`COMPARATORS.deadline`). 출처를 "과기정통부"로 고르면 등록일 최신 순으로 보인다.
- **마감 지난 공고 숨기기**: 마감이 `null`이면 늘 보이는 지금 규칙 그대로다. 과기정통부 행은 쌓이기만 한다. 오래된 공모를 숨길지는 발표 뒤에 정한다(미결정 사항).
- **상세 서랍**: 신청 기간 "공고문 확인", 등록일, 소관기관(`과학기술정보통신부 {담당 부서}`), "원문 보기"(새 창, `rel="noopener noreferrer"`)를 보인다. 안내 문구는 "이 출처는 제목·등록일·담당 부서만 제공합니다. 신청 기간과 사업 내용은 원문의 첨부 공고문에서 확인하세요."다. 문의처 안내는 지금 문구 그대로 둔다.
- **화면 확인 폭**: 360·390·768·1280·1440px(ADR-072). 페이지 전체 가로 넘침이 없어야 한다. 표는 영역 안에서 스크롤한다.

## 7. 랜딩

- 출처 로고 띠(`web/components/landing/showcase-data.ts` `DATA_SOURCES`)에 `과학기술정보통신부`를 더해 9곳을 10곳으로 늘린다. 자리는 `중소벤처기업부` 다음이다. [메인 판단]
- 로고 파일은 `web/public/landing/sources/msit.svg`(또는 png)다. 과기정통부 공식 CI 안내 파일에서 로고 부분만 꺼낸다. 그림은 바꾸지 않는다. 같은 파일의 머리 주석 관례를 따르고, CI 파일을 못 구하면 누리집 머리말 로고를 쓴다. 기관 이름이 함께 있는 시그니처형을 쓴다(2026-10-28 사용자 결정과 같은 이유).
- `web/e2e/landing-showcase.spec.ts:44,47`의 9를 10으로 바꾼다. 출처 수를 적은 랜딩 문구(`work-demo.tsx:113`, `features-section.tsx:24` 주변)에 숫자가 있으면 맞춘다. [작업자 몫: 숫자가 있는지 확인]

## 8. 운영 반영 순서 (단계마다 사용자 승인)

| 순서 | 할 일 | 누가 | 비고 |
| --- | --- | --- | --- |
| 0 | 공공데이터포털에서 15074634 활용신청, 키를 회사 `infra/.env.worker.local`·로컬 `infra/.env`에 넣기 | 사용자 | **2026-11-01 완료**(사용자 보고). 값은 확인하지 않았다(`.env` 읽기 금지) |
| 1 | 실호출 1회로 응답 모양(JSON 구조·순서·`pressDt` 형식) 확인·녹음(키 가림) | 메인 세션 | **승인 필요**(실호출). **구현 시작 전(11-02 오전)에 한다.** 정규화 코드와 시험 샘플이 이 응답을 근거로 한다. 녹음 위치는 `fixtures/recorded/program-notices/msit/`. [작업자 몫: 기존 녹음 스크립트 관례] |
| 2 | 마이그레이션 적용(`pnpm db:push`) | 메인 세션 | **승인 필요**. Worker보다 먼저 한다. 안 하면 저장이 check에 걸려 `STORE_FAILED`가 난다 |
| 3 | 회사 부처 공고 Worker 재빌드(키는 0단계에서 들어가 있음) | 메인 세션 | **승인 필요**. KST 정각+15분 ~ 다음 정각−30분에만 한다. 재생성 전 `rollback-*` 태그를 남기고 `--check`를 통과시킨 뒤, 다음 정각 회차가 SUCCEEDED인지와 `program_notices`의 `msit` 행 수를 확인한다. 실행서는 `infra/company/README.md` §10 |
| 4 | main push → Vercel 배포 | 메인 세션 | **승인 필요**. 웹은 모르는 `source` 행을 버리므로(`list.service.ts` `isSource`) 2·3과 순서가 바뀌어도 화면이 깨지지 않는다 |

일정은 11-02 구현·검증, 11-03 오전 운영 반영, 11-03 동결이다.

**늦어질 때** [메인 판단, 검토 반영]
- 1단계 실호출을 구현 전에 못 하면 `program-notices.yaml`에 `msit.enabled: false`로 두고 구현한다. 3단계에서 회사 Worker `--once`로 응답을 확인한 뒤 켠다.
- 4단계(화면·랜딩 배포)는 3단계에서 운영 DB에 `msit` 행이 1건 이상 저장된 것을 확인한 뒤에만 한다. 수집하지 않는 출처를 랜딩 로고와 필터에 내보내지 않기 위해서다.
- 11-03 동결까지 3단계 확인이 안 되면 4단계를 발표 뒤로 미룬다. 이미 반영한 마이그레이션과 Worker는 `enabled: false`면 아무 일도 하지 않으므로 그대로 둔다.

## 9. 완료의 정의

1. **단위 시험**(`pnpm -C web exec vitest run <파일>`)
   - 과기정통부 응답 정규화: 문서 예시로 만든 샘플을 쓰고, 실호출 녹음이 생기면 녹음을 더한다.
   - 제목 걸러내기: 선정결과 제외, 선정계획 유지.
   - `viewUrl` 호스트·https 검사, `nttSeqNo` 없는 행 버리기.
   - 키 가리기: 원문 키와 인코딩된 키 모두.
   - `config.ts` `msit` 스키마: 허용 호스트 밖 거부.
   - Worker 계획: 과기정통부 키가 없으면 건너뛰고 기동한다.
   - `list.service`: 과기정통부 행은 IT 필터 면제, 기업마당 중복이면 기업마당 행 대표.
2. **DB 정책 시험**: `pnpm test:db` 통과(§5).
3. **화면**: `/bids/programs` 출처 "과기정통부" 선택 → 목록 → 서랍 → 원문 링크 속성을 격리 스택에서 확인한다. 360·390·768·1280·1440 스크린샷을 `docs/evidence/`에 남긴다. 랜딩 E2E(`landing-showcase.spec.ts`)가 통과한다.
4. **검증**: 개발 중 `pnpm verify:changed`, 병합 전 전체 `pnpm verify`. 무거운 검증은 슬롯 스크립트로 감싼다.
5. **운영 확인**: §8의 3·4 뒤 운영 화면에서 과기정통부 공모가 1건 이상 보인다. 증거를 `docs/evidence/`에 남긴다.
6. **정본 반영**
   - 새 ADR 1개: 과기정통부 직접 연결(2026-10-21 스펙 §2 결정 변경), 과기정통부 IT 필터 면제(ADR-069 예외), NTIS·IRIS 보류 근거. **번호는 쓰기 직전 main에서 다시 확인**한다. 2026-11-01 기준 마지막은 ADR-073이다.
   - `docs/07-DATA-PIPELINE.md` §1.3 출처 표.
   - `docs/10-DEPLOYMENT.md:109` 회사 Worker env.
   - `infra/company/README.md` §10.
   - `infra/env/company-worker.env.example`(`MSIT_ANNOUNCEMENT_API_KEY=` 한 줄과 Encoding 키 안내).
   - `docs/PROGRESS.md`.

## 10. 엣지 케이스

- **키 없음·만료·`resultCode` 오류**: 과기정통부만 건너뛰거나 실패로 남긴다. 기업마당 회차와 Worker 기동은 그대로다. 화면은 마지막으로 저장된 행을 보인다.
- **응답이 XML로 옴**(`returnType` 무시): XML도 받을지는 [작업자 몫]이다. 받는다면 기존 XXE 차단 파서를 쓴다.
- **"(수정)" 재게시**: 게시물 번호가 달라 원 공고와 수정 공고가 두 줄로 보일 수 있다. 허용한다. 묶을지는 [작업자 몫]이다.
- **R&D가 아닌 기타 공고**(예: "연구보안 전담기관 지정계획 공고"): 걸러내기 단어에 걸리지 않으면 보인다. 허용한다.
- **같은 공고가 기업마당에도 실림**: 기업마당 행이 대표가 된다(§4).
- **`pressDt` 형식을 못 읽음**: `publishedAt = null`로 저장하고 행은 버리지 않는다.

## 11. 손댈 파일 (2026-11-01 저장소에서 확인한 위치)

- 설정·수집
  - `infra/sources/program-notices.yaml`
  - `web/server/program-notices/config.ts`(스키마·허용 호스트·키 이름·`ProgramNoticesConfig`)
  - `http.ts`(`PROGRAM_NOTICE_HOSTS`)
  - `program-notice.model.ts`(`PROGRAM_NOTICE_SOURCES`·라벨)
  - `collect.service.ts`(`planOf`가 지금 `bizinfo`가 아니면 모두 중기부로 보내므로 3갈래로 일반화)
  - 새 `msit.ts`(+시험)
  - `index.ts` export
- 목록: `web/server/program-notices/list.service.ts`(IT 면제)
- Worker: `web/worker/program-notices-only-main.ts`(`SCHEDULED_SOURCES`, `readProgramNoticesPlan` 줄 남기기)
  - 로컬 전체 Worker(`web/worker/program-notices.ts`)는 `PROGRAM_NOTICE_SOURCES`를 돌므로 녹음이 없을 때 과기정통부를 건너뛰는지 확인한다. [작업자 몫]
- DB: 새 마이그레이션, `web/lib/database.types.ts`, `scripts/database.test.mjs`
- 화면: `web/app/(app)/(work)/bids/programs/program-filters.tsx`, `programs-copy.ts`, `program-table.tsx`·`program-format.ts`(마감 칸 문구), `program-notice-drawer.tsx`(안내 문구)
- 랜딩: `web/components/landing/showcase-data.ts`, `web/public/landing/sources/msit.*`, `web/e2e/landing-showcase.spec.ts`
- env·infra: `infra/env/company-worker.env.example`, `infra/compose.yaml`(로컬 Worker env 전달, 기업마당 줄 옆), `infra/company/README.md`
- 웹 금지 env 검사(`scripts/check-env.mjs`)에 새 키를 넣을지는 [작업자 몫]이다. `BIZINFO_API_KEY`도 지금 목록에 없다.

## 미결정 사항

- 마감일이 없는 과기정통부 공모가 계속 쌓이는 문제. 등록 후 N일이 지나면 숨기거나, 첨부에서 마감일을 뽑는 방법을 발표 뒤에 정한다.
- IRIS 공고 수집(약관 확인 뒤), 대시보드 R&D 칸은 발표 뒤에 정한다.
