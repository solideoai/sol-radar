# fixtures/eval — 평가셋 v0.1 가상 기업 원형 (X6a, ADR-027)

`companies/*.json` 6개는 `docs/21-MODEL-TRAINING.md` §3.2 의 가상 기업 원형이다. 평가셋 빌더(`services/ai/eval/sol_eval`, X6a)가
실제 공고와 짝지어 `EvalItem.company`(21 §3.7)를 만들 때 출발점으로 읽는다. git `5261730f` 의 `docs/23-WEEKEND-FINETUNE.md` §4.2 C층·§4.4 갈래 ①의
COMPANY 블록이 여기서 나온다.

**전부 가상이다.** 회사 이름은 원형 설명형이고(`가상 … (원형 N)`), 실적·면허·재무는 실제 기업의 것이 아니다. 모든 파일 `isDemo=true`.
기관 종류·분야만 쓰고 실제 기관 이름도 쓰지 않는다. 솔리데오 가상 프로필(`fixtures/company/solideo-profile.json`)은 원형 2 의 출발점이지만
이름·수치를 복사하지 않고 "중견 공공 SI" 일반형으로 바꿨다(23 §4.2 참고 행).

## 스키마

`fixtures/company/solideo-profile.json` 과 같은 **`company-profile/v0.1`** 이다. 봉투 필드 `schemaVersion`·`orgSlug` 를 뺀 본문은
`web/server/scoring/analysis-input.model.ts` 의 `companyProfileSchema`(zod, 05 §4.4 `CompanyProfile` 스냅샷)를 그대로 통과한다.
값 집합도 코드와 같다.

| 필드 | 값 집합·출처 |
|---|---|
| `licenses[].code` / `name` | `web/server/scoring/qualification-codes.ts`(= `services/ai/dictionaries/qualification-codes.yaml`) 9개 코드. 이름은 사전의 이름·별칭 |
| `licenses[].status`, `industryCodes[].status` | `HELD` / `NOT_HELD`. 목록에 없는 코드는 "모름"(규칙 엔진이 `NEEDS_REVIEW`·`COMPANY_EVIDENCE_MISSING`) |
| `industryCodes[].code` / `name` | 나라장터 업종 마스터 녹음본 `fixtures/recorded/15129467/`(2,916행)의 `indstrytyCd`·`indstrytyNm` 그대로 |
| `technologies[].level` | `BASIC` / `INTERMEDIATE` / `EXPERT`(21 §3.2 "숙련도") |
| `pastProjects[].domain`, `preferences.domains` | 08 §1 분야 값 집합(`web/server/scoring/domain-keywords.ts` `DOMAINS`) |
| `preferences.agencyTypes` | `지자체` / `교육청` / `중앙부처` / `공공기관`(`domain-keywords.ts` `AgencyType`) |
| 금액 | KRW 정수 문자열. 완료일 `YYYY-MM-DD`(계산 기준일 2026-10-16 이전) |
| `orgSlug` | `eval-01`~`eval-06`. `revision` 1 |

스키마에 없는 필드는 넣지 않았다(아래 "제안" 참고). 데모 seed(`pnpm demo:reset`)는 이 폴더를 읽지 않는다
(`scripts/demo/bid-notices.mjs` `loadCompanyProfileFixture` 는 솔리데오 파일 하나만 읽는다).

## 원형 6개 — 차이 나는 필드

업종 코드: `1468` 소프트웨어사업자(컴퓨터관련서비스사업) · `1426` (패키지소프트웨어개발.공급사업) · `1469` (디지털콘텐츠개발서비스사업) ·
`1470` (데이터베이스제작및검색서비스사업) · `0036` 정보통신공사업 · `1542` 정보보호 전문서비스 기업. H = `HELD`, N = `NOT_HELD`, − = 미기록.

| 파일 | 원형 | 기술(`technologiesComplete`) | 면허 H / N / − | 업종 1468·1426·1469·1470·0036·1542 | 실적(최대 금액·증빙) | 수행 상한 / 직원 | 선호 |
|---|---|---|---|---|---|---|---|
| `01-large-public-si.json` | 대형 공공 SI | 12개, Java·전자정부·K8s EXPERT(true) | H 7: SW사업자·직접생산·ISO27001·CMMI L3·정보통신공사업·ISMS-P·CSAP / N 2: 중소기업확인서·방산 / − 0 | H·H·H·H·H·H | 5건, 최대 180억, 증빙 전부 | 300억 / 1,200 | 중앙부처·지자체·공공기관·교육청, 제외 없음 |
| `02-mid-public-si.json` | 중견 공공 SI | 8개, Java·Spring·전자정부 EXPERT(true) | H 4: SW사업자·직접생산·중소기업(중기업)·ISO27001 / N 3: CMMI L3·정보통신공사업·ISMS-P / − 2: CSAP·방산 | H·H·N·H·N·− | 4건, 최대 22억, 증빙 전부 | 60억 / 150 | 지자체·교육청·공공기관, 국방 제외 |
| `03-ai-rag-startup.json` | AI·RAG 스타트업 | 9개, Python·RAG/LLM EXPERT, Java 없음(true) | H 2: SW사업자·중소기업(소기업) / N 4: 직접생산·ISO27001·CMMI L3·정보통신공사업 / − 3: ISMS-P·CSAP·방산 | N·−·H·−·−·N | 3건, 최대 4억, P3 증빙 없음(`evidenceRef: null`) | 15억 / 24 | 공공기관·지자체·교육청, 국방·영상감시 제외 |
| `04-maintenance-specialist.json` | 유지보수 전문 | 7개, 전자정부·Oracle·Linux 운영 EXPERT(**false**) | H 4: SW사업자·직접생산·중소기업(중기업)·정보통신공사업 / N 2: CSAP·방산 / − 3: ISO27001·CMMI L3·ISMS-P | H·N·−·N·H·− | 4건, 최대 8억, P4 는 2022-02 완료(3년 초과) | 20억 / 60 | 지자체·교육청·공공기관, 국방 제외 |
| `05-data-platform-specialist.json` | 데이터 플랫폼 전문 | 10개, PostgreSQL·Hadoop·Spark·Kafka·ES EXPERT(true) | H 5: SW사업자·직접생산·중소기업(중기업)·ISO27001·ISMS-P / N 2: CSAP·정보통신공사업 / − 2: CMMI L3·방산 | H·H·−·H·N·− | 4건, 최대 32억, 증빙 전부 | 40억 / 95 | 공공기관·지자체·중앙부처, 국방 제외 |
| `06-newborn-no-track-record.json` | 실적 없는 신생 | 5개, 전부 BASIC·INTERMEDIATE(true) | H 1: 중소기업(소기업) / N 0 / − 8 | 빈 목록(전부 −) | 0건, 증빙 없음 | 5억 / 8, 매출 없음 | 지자체·공공기관 |

갈래 ① 라벨이 원형 구성만으로 갈리도록 짰다.

- 면허제한(업종 코드) ↔ `industryCodes`: 6개 코드마다 H·N·− 가 모두 나온다 → `SATISFIED` / `NOT_SATISFIED` / `NEEDS_REVIEW`(`COMPANY_EVIDENCE_MISSING`).
- 자격 코드 ↔ `licenses`: 중소기업 제한경쟁은 01 만 `NOT_SATISFIED`, 06 은 거의 전부 미기록이라 `NEEDS_REVIEW`.
- `risk.scale`: 예산 vs `financials.maxContractKrw`(5억 ~ 300억)와 최대 실적(0 ~ 180억). 06 은 실적 0 → `scaleFit` MISSING.
- 기술: 04 만 `technologiesComplete=false` → 목록에 없는 기술이 `NEEDS_REVIEW`. 나머지는 없는 기술이 `NOT_SATISFIED`.
- 실적: 03 P3 증빙 없음, 04 P4 최근성 3년 초과, 06 실적 0.

## 홀드아웃 원형 (21 §3.6 "처음 보는 기업")

기본 제안: **`06-newborn-no-track-record.json` 을 test 전용**으로 두고 train·dev 에서 뺀다.

- 이유: 06 은 정보가 가장 적은 원형이다(면허 1·업종 0·실적 0). 학습에서 보지 못한 "정보 부족 → `NEEDS_REVIEW`" 패턴을 시험할 수 있고,
  train 의 `NEEDS_REVIEW` 비율이 06 한 원형에 끌려가지 않는다(23 §4.4 "세 값이 1/3 에 가깝게").
- 대안: 03(기술 스택이 공공 SI 와 가장 다름). 어느 쪽이든 `manifest.json` 과 E4 리포트에 홀드아웃 원형 id 를 적는다. 결정은 사람이 한다.

## 변형 (충족 · 명시적 미충족 · 정보 부족)

변형은 이 폴더에 두지 않는다. 빌더(`sol_eval`)가 21 §3.3 표의 규칙대로 원형을 고쳐 기계적으로 만들고 `labelSource=CONSTRUCTED` 라벨을 붙인다.
사람이 손으로 변형 파일을 만들지 않는다.

## 평가 통계에서 빼는 것

- 솔리데오 가상 프로필(`fixtures/company/solideo-profile.json`, `org-01`)은 데모·골든(94/72/68) 전용이다. 평가 통계의 기업 원형에 넣지 않는다.
- fixture 공고 `FX-01`~`FX-20` 은 회귀 확인용이라 평가 통계에서 뺀다(21 §3.1, 23 §4.1 5번).

## 제안 (스키마에 없어서 넣지 않은 것)

21 §3.2·23 §4.4 가 원형 속성으로 적은 것 가운데 `company-profile/v0.1` 에 자리가 없는 두 가지다. 어느 것도 이 폴더의 JSON 에 넣지 않았다.
스키마를 바꾸는 결정은 `docs-keeper`·ADR 몫이다.

| 속성 | 지금 | 제안 |
|---|---|---|
| 인력(역할·등급·가용 FTE) → `risk.staffing` | 회사 프로필이 아니라 인력 fixture(`fixtures/people/solideo.people.json`, `toScoringTeam`)에서 `ScoringTeam` 을 만든다(08 §9). 프로필에는 `financials.employeeCount` 만 있다 | 원형별 `ScoringTeam` 입력 파일(`analysis-input.model.ts` `scoringTeamSchema` 모양: `members[].role·grade·skills·availability[].fte`, `assignments`, `asOf`)을 빌더가 받도록 한다. 파일 자리는 `fixtures/eval/companies/<nn>.team.json` 을 제안한다. 명부 200명·사진은 평가셋에 필요 없다 |
| 지역(참가가능지역·지역의무공동도급) | 프로필에 소재지 필드가 없다. 규칙 엔진 v0.1 은 지역 조건을 전부 `NEEDS_REVIEW`(`COMPANY_EVIDENCE_MISSING`)로 낸다(`web/server/scoring/qualification.ts`) | 05 §4.4 `CompanyProfile` 에 소재지 필드(예: `headquartersRegion`, 나라장터 `prtcptPsblRgnNm` 과 같은 표기)를 더하는 ADR 뒤에 채운다. 그 전까지 갈래 ① 의 지역 라벨은 구성으로 `NEEDS_REVIEW` 하나만 나온다 |

## 검증

`web/server/scoring` 의 zod 스키마(`companyProfileSchema.strict()`)로 6개를 parse 하고, 면허 코드 사전·업종 코드 녹음본·분야 값 집합을 대조한
출력은 `docs/evidence/eval/companies-check-20261020.txt` 에 있다(일회성 스크립트, 저장소에 두지 않음). 이 폴더 전용 검증 스크립트는 아직 없다.
