---
title: "클립 7 자격 갭 레이더 rev 6 계산 기록 (2026-11-01)"
status: final
tags: [sol-radar, evidence, gaps, ops]
updated: 2026-11-01
---

# 클립 7 자격 갭 레이더 rev 6 계산 기록 (2026-11-01)

> [!warning] 화면에 없는 계산값이다
> 아래 숫자는 운영 DB를 읽어 `/gaps` 판정 코드로 계산한 값이다. 운영 화면을 찍은 값이 아니다. 대상 공고는 3시간마다 도는 수집으로 바뀌므로 촬영 때 화면 값과 다를 수 있다. 클립 7 캡션·대사는 촬영 화면 값을 쓴다([[19-DEMO-SCENARIO|19]] S-GAPS). "같은 공고 × rev 5" 칸은 지금 공고에 revision 5 자격을 넣어 다시 계산한 가정값이고, 10-30 전에 화면에 보였던 값이 아니다.

## 왜 계산했나

운영 회사 프로필 revision 6은 공개 자료에 회사가 확인한 자격 3건(소프트웨어사업자·직접생산·중소기업)을 더했다([[16-DECISIONS|ADR-059]] 2차 개정, [기록](../../company-public-profile/20261030/prod-rollout.md)). 클립 7 대본은 "막는 자격 1위를 보유했다고 가정하면 새로 열리는 공고"를 보이는 장면이었다([[18-HACKATHON|18]] 클립 7 행, [[slides-spec|덱 제작 명세]] 클립 7). revision 6에서도 이 장면이 성립하는지 확인했다. 결론은 성립하지 않는다. 막는 자격 표가 모두 자격 코드 사전 밖 업종이라 "보유 가정" 스위치가 없다. 사용자는 클립 7을 가정 없는 30초로 바꾸기로 했다(2026-11-01, "1").

## 읽은 것

- 시각: 2026-11-01 16:29 KST(07:29:50Z).
- 도구: Supabase MCP `execute_sql`, 운영 프로젝트 `brtysdocxemrqhdezzqg`(`get_project_url`로 확인). 읽기 SELECT만 썼고 쓰기는 없다.
- 대상 조건은 `/gaps` 저장소(`web/server/gaps/gaps.repo.ts`)와 같다.
  - `bid_notices.is_demo = false`
  - `source <> 'fixture'`
  - `stage = 'NOTICE'`
  - `status in ('OPEN', 'AMENDED')`
  - `deadline_at > now()`
  - 대표 공고: `bid_opportunities.canonical_notice_id = bid_notices.id` 이고 `superseded_by is null`
  - IT 범위: `it_scope = true`([[16-DECISIONS|ADR-069]])
  - 판정 입력은 `latest_revision`과 같은 `bid_revisions` 행의 `normalized->auxLookup`과 그 revision의 `bid_structured_requirements`다(`toGapNotice`와 같다).
- 회사 프로필: org-01 최신 revision 6, id `7878c9eb-5ec3-4e72-8ba6-7a723e065607`, `is_demo=false`. 자격 4건 모두 `HELD`(`ICT_CONSTRUCTION`·`SW_BUSINESS_REG`·`DIRECT_PRODUCTION`·`SME_CONFIRMATION`), 업종 코드 0개. 운영 값과 [revision 6 프로필 파일](../../company-public-profile/20261030/profile.json)의 자격·업종 코드가 같은 것을 확인했다.

### 운영 총합 대조

계산에 넣으려고 옮겨 적은 자료(아래 "계산 방법" 1번의 모양 58개)를 계산 전에 운영 총합과 맞췄다. 모두 같았다.

| 항목 | 운영 SELECT | 옮겨 적은 자료 |
|---|---|---|
| 대상 공고 | 539건 | 539건 |
| 예산 합(정수 예산만, 화면과 같음) | 437,282,785,728원 | 437,282,785,728원 |
| 보조 조회 `OK` | 393건 · 346,135,906,534원 | 393건 · 346,135,906,534원 |
| 면허제한 행 | 545행 | 545행 |
| 보조 조회 상태 | `OK` 393 · `SKIPPED_QUOTA` 134 · 없음 11 · `FAILED` 1 | 같음 |

## 결과

### 요약 띠

| 항목 | 지금(rev 6) | 같은 공고 × rev 5(가정값) |
|---|---|---|
| 대상 공고 | 539건 · 4,372.8억 | 539건 · 4,372.8억 |
| 참가 가능(API 기준) | **328건 · 3,284.0억** | 26건 · 157.1억 |
| 회사 기록 없음 | **0건** | 183건 · 1,157.5억 |
| 미보유 | 0건 | 0건 |
| 사람 확인 필요 | **211건 · 1,088.8억** | 330건 · 3,058.3억 |

rev 5 칸은 revision 6 프로필에서 자격을 `ICT_CONSTRUCTION` 하나만 남긴 사본으로 계산했다. revision 5의 자격과 같다([기록](../../company-public-profile/20261030/prod-rollout.md) "바꾼 것").

### 사람 확인 필요 사유

공고 하나에 사유가 여러 개일 수 있어 합이 묶음 건수와 다르다.

| 사유 | 화면 라벨 | rev 6 | rev 5(가정값) |
|---|---|---|---|
| `AUX_LOOKUP_INCOMPLETE` | 면허·지역 보조 조회 미완료 | 135 | 135 |
| `REGION_UNVERIFIED` | 참가가능지역·지역 공동도급 확인 필요 | 33 | 33 |
| `LICENSE_MULTI_ROW` | 면허제한 여러 행(AND/OR 미확인) | 21 | 152 |
| `LICENSE_OUT_OF_DICTIONARY` | 면허제한 업종이 자격 코드 사전 밖 | 16 | 16 |
| `AUX_LOOKUP_ABSENT` | 면허·지역 보조 조회 결과 없음 | 11 | 11 |
| `INDUSTRY_UNVERIFIED` | 허용 업종 확인 필요 | 2 | 2 |
| `LICENSE_RECORD_MISSING` | 면허 기록 없음(다른 조건도 확인 필요) | 0 | 14 |

`AUX_LOOKUP_INCOMPLETE` 135건은 보조 조회 `SKIPPED_QUOTA` 134건과 `FAILED` 1건이다. 보조 조회가 채워지면 이 수가 줄고 다른 묶음이 늘어난다.

### 막는 자격 표 (rev 6)

6행 모두 자격 코드 사전 밖(`OUT_OF_DICTIONARY`)이라 화면에서 "보유 가정" 스위치 대신 "가정 불가"가 나온다(`web/app/(app)/(work)/gaps/gaps-sections.tsx`의 스위치 조건: 사전 코드가 있고 사전 밖 행이 아닐 때).

| 순위 | API 업종 | 막힌 공고 | 예산 합 | 조건 묶음 포함 |
|---|---|---|---|---|
| 1 | 1169 학술.연구용역 | 6건 | 11.9억 | 4건 |
| 2 | 6146 정보시스템 감리법인 | 5건 | 3.4억 | 8건 |
| 3 | 1458 기간통신사업 | 1건 | 3.8억 | 0건 |
| 4 | 9999 기타자유업종 | 1건 | 1.5억 | 0건 |
| 5 | 1542 정보보호 전문서비스 기업 | 1건 | 0.6억 | 0건 |
| 6 | 7530 기업신용조회업 | 1건 | 0.3억 | 0건 |

rev 5(가정값)에서는 1행이 소프트웨어사업자(API 1468·1470·1469, 사전 코드 `SW_BUSINESS_REG`) 183건 · 1,157.5억이고 스위치가 있다.

### 보유 가정

- rev 6: 자격 코드 사전의 9개 코드를 하나씩 가정해도, 9개를 한꺼번에 가정해도 새로 열리는 공고가 0건이다. 화면에서 가정 장면을 만들 수 없다.
- rev 5(가정값): `SW_BUSINESS_REG`를 가정하면 참가 가능 26 → 328건, 배정 예산 합 157.1 → 3,284.0억, 새로 열리는 공고 302건이다. 이 값이 rev 6의 참가 가능 값과 같은 것은 revision 6이 바로 그 자격을 더했기 때문이다.

## 계산 방법

1. 대상 539건을 "보조 조회 상태 + 구조화 요건 목록(종류·순번·코드·이름)"이 같은 것끼리 묶어 모양 58개로 읽었다. 모양마다 건수와 예산 합을 함께 읽었다. 옮겨 적은 모양 자료는 저장소에 남기지 않았다. 같은 조건으로 다시 읽으면 그때 공고 기준으로 다시 만들 수 있다.
2. 요건의 `value`와 `source_operation`, 공고 제목·발주기관·마감은 판정에 쓰이지 않아 읽지 않았다. 규칙 엔진(`web/server/scoring/qualification.ts`)은 `value`를 근거 인용 글자에만 쓰고, `today`는 면허 유효기간 비교에만 쓴다. 참가가능지역 22행짜리 모양 두 개는 1행으로 줄였다. 지역 행은 몇 행이든 사람 확인 필요 한 사유라 결과가 같다.
3. 모양마다 건수만큼 `GapNoticeRow`를 만들고, 첫 행에 예산 합을 두고 나머지는 0으로 두었다. 묶음별·순위별 건수와 예산 합은 그대로이고, 새로 열리는 공고 표의 순서만 실제와 다르다.
4. 실제 서버 코드 `toGapNotice` → `buildGapRadar`(요약 띠·막는 자격·사유)와 `assumeGapRadar`(보유 가정)에 넣었다(`web/server/gaps/gaps.model.ts`). 프로필은 `companyProfileSchema`로 검증했다. 판정 기준일은 2026-11-01(KST)이다.
5. 이 계산에 쓴 임시 Vitest 파일은 지웠다. 계산 출력 파일도 저장소에 남기지 않았고, 이 문서의 표가 그 출력을 옮긴 것이다. 보유 가정은 사전 9개 코드마다 따로, 그리고 9개를 한꺼번에 `assumeGapRadar`로 돌려 새로 열리는 공고 수를 셌다(모두 0).

비밀값·개인 정보는 이 폴더에 없다. 공고별 식별자·제목도 넣지 않았다.

## 관련 문서

- [[19-DEMO-SCENARIO|19 데모 시나리오]] S-GAPS
- [[18-HACKATHON|18 해커톤]] 클립 7
- [[slides-spec|덱 제작 명세]] 클립 7
- [자격 갭 레이더 운영 읽기 확인(10-28)](../../gaps/20261028/prod-readonly-check.md)
- [[16-DECISIONS|16 ADR]] — ADR-059·060·069·071
