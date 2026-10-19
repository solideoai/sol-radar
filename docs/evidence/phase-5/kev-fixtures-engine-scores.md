---
title: "mock Kev fixture 20건의 규칙 엔진 근거"
status: draft
tags:
  - sol-radar
  - evidence
  - ai
updated: 2026-10-19
---

# mock Kev fixture 20건의 규칙 엔진 근거

`fixtures/kev/` 를 [[07-DATA-PIPELINE|07 수집]] :350 대로 채웠다. 이 문서는 새 파일 값의 근거가 된 규칙 엔진 출력과 계산 명령을 남긴다.

- 기준: 브랜치 `fixtures/kev-complete`, 기점 main `c2b12d3`
- 규칙 엔진: `web/server/scoring`. 이번 작업에서 고치지 않았으므로 `c2b12d3` 의 코드다.
- 판정: 조정 세션 e8, 2026-10-19
  - 07 표에 점수가 없는 공고는 엔진 점수로 fit 을 채운다.
  - needsHumanReview 도 엔진의 자격 판정으로 정한다.
  - 07 표와 엔진이 다르면 엔진 값을 쓴다.

## 값을 정한 규칙

07 :350 의 고정값과 e8 판정을 따랐다.

- **recommendation**
  - 엔진 권고 선택지가 0.60 이다.
  - BID–WATCH–NO_BID 순서에서 엔진 권고와 이웃한 선택지가 0.25, 나머지가 0.15 다.
  - WATCH 권고는 양쪽이 모두 이웃이다. 이때는 앞선 BID 가 0.25 다.
  - confidence 는 0.60 이다.
- **mandatoryRisk:** 0.10 이다.
- **needsHumanReview:** 엔진 `qualificationStatus` 가 `NEEDS_REVIEW` 면 0.70, 아니면 0.20 이다.
- **fit**
  - 표시값은 엔진 `score`/20 이고, wire `score` 는 표시값 − 1 이다.
  - 분포는 floor·ceil 두 등급에 나눠 Σ i·p_i 가 wire score 와 같게 한다.
  - confidence 는 분포의 최대 확률이다.
- **특수 4건:** FX-01·02·03·16 은 07 표 값 그대로이고, 이번에 바꾸지 않았다.
- **FX-12:** 격리라 만들지 않았다. 07 이 생략을 허용한다.
- **FX-07:** r1 은 `FX-07.r01.json`, r2 는 `FX-07.json` 이다.
  - worker 는 `FX-NN.rNN` 을 보낸다. mock 은 그 파일이 없으면 `FX-NN.json` 을 쓴다.
  - 그래서 r1(WATCH 68)이 r2 파일(BID)을 받지 않도록 r1 파일을 따로 두었다.
  - `scripts/bids/check.mjs` 는 kev 에도 추출과 같은 rNN 키 규칙을 적용하게 넓혔다.

## 엔진 출력 (Kev 없이 규칙만, 기준일 2026-10-16)

공고 레코드는 개정마다 골랐다. 추출은 `FX-NN.json` 이고, 앞선 개정 추출 파일이 있으면(`FX-07.r01`) 그것을 썼다. points 순서는 skillMatch · pastPerformance · staffAvailability · scaleFit · strategicPreference 다.

FX-13 은 수집·gateway 를 거친 뒤의 입력으로 계산했다. `web/server/analysis/analysis.service.test.ts` 의 `citationFailedContext` 와 같은 방식이다.
- 공고 `budgetKrw` 는 원문 "1,500백만원" 대신 정규화 값 "1500000000"(추출 `budgetKrw` 값)이다.
- 추출 `qualifications` 는 인용 실패 모양(`UNKNOWN`, `note="CITATION_FAILED"`)이고, `warnings` 는 `CITATION_FAILED:qualifications` 다.

| 공고 | 개정 | 추출 | 점수 | 합계 | points | 자격 | 권고 | 규칙 플래그 | missing |
|---|---|---|---:|---:|---|---|---|---|---|
| `FX-04` | 01 | `FX-04` | 62 | 61.5 | 15 · 12.5 · 14 · 15 · 5 | NEEDS_REVIEW | WATCH | — | skillMatch:NO_REQUIREMENTS_EXTRACTED, pastPerformance:BID_DOMAIN_UNKNOWN |
| `FX-05` | 01 | `FX-05` | 83 | 82.5 | 30 · 12.5 · 20 · 15 · 5 | NEEDS_REVIEW | WATCH | `PARSE_UNSUPPORTED` | pastPerformance:BID_DOMAIN_UNKNOWN |
| `FX-06` | 01 | `FX-06` | 78 | 77.6 | 22.5 · 13.1 · 20 · 15 · 7 | SATISFIED | BID | — | — |
| `FX-06` | 02 | `FX-06` | 78 | 77.6 | 22.5 · 13.1 · 20 · 15 · 7 | SATISFIED | BID | — | — |
| `FX-07` | 01 | `FX-07.r01` | 68 | 68.3 | 3 · 22.3 · 20 · 15 · 8 | SATISFIED | WATCH | — | — |
| `FX-07` | 02 | `FX-07` | 77 | 77.3 | 11 · 23.3 · 20 · 15 · 8 | SATISFIED | BID | — | — |
| `FX-08` | 01 | `FX-08` | 70 | 69.5 | 15 · 12.5 · 20 · 15 · 7 | SATISFIED | WATCH | — | pastPerformance:BID_DOMAIN_UNKNOWN |
| `FX-08` | 02 (CANCELLED, 재분석 없음) | `FX-08` | 70 | 69.5 | 15 · 12.5 · 20 · 15 · 7 | SATISFIED | WATCH | — | pastPerformance:BID_DOMAIN_UNKNOWN |
| `FX-09` | 01 (SEED) | `FX-09` | 73 | 72.9 | 7.5 · 20.4 · 20 · 15 · 10 | SATISFIED | WATCH | — | — |
| `FX-09` | 01 (LIVE 재전송) | `FX-09` | 73 | 72.9 | 7.5 · 20.4 · 20 · 15 · 10 | SATISFIED | WATCH | — | — |
| `FX-10` | 01 | `FX-10` | 65 | 64.5 | 10 · 12.5 · 20 · 15 · 7 | SATISFIED | WATCH | — | pastPerformance:BID_DOMAIN_UNKNOWN |
| `FX-10` | 02 | `FX-10` | 65 | 64.5 | 10 · 12.5 · 20 · 15 · 7 | SATISFIED | WATCH | — | pastPerformance:BID_DOMAIN_UNKNOWN |
| `FX-11` | 01 | `FX-11` | 89 | 88.8 | 30 · 21.3 · 20 · 7.5 · 10 | NEEDS_REVIEW | WATCH | — | scaleFit:BUDGET_UNKNOWN |
| `FX-13` | 01 | `FX-13` | 85 | 84.5 | 30 · 12.5 · 20 · 15 · 7 | NEEDS_REVIEW | WATCH | — | pastPerformance:BID_DOMAIN_UNKNOWN |
| `FX-14` | 01 | `FX-14` | 65 | 65 | 20 · 12 · 8 · 15 · 10 | SATISFIED | WATCH | — | — |
| `FX-15` | 01 | `FX-15` | 58 | 58.1 | 20 · 20.1 · 10 · 0 · 8 | SATISFIED | WATCH | `SCALE_LIMIT_EXCEEDED` | — |
| `FX-17` | 01 | `FX-17` | 64 | 63.7 | 15 · 11.7 · 20 · 9 · 8 | NEEDS_REVIEW | WATCH | — | skillMatch:NO_REQUIREMENTS_EXTRACTED |
| `FX-18` | 01 | `FX-18` | 82 | 81.7 | 28.8 · 21.9 · 14 · 9 · 8 | SATISFIED | BID | — | — |
| `FX-19` | 01 | `FX-19` | 93 | 92.8 | 30 · 23.8 · 14 · 15 · 10 | NEEDS_REVIEW | WATCH | — | — |
| `FX-20` | 01 | `FX-20` | 70 | 69.5 | 15 · 12.5 · 20 · 15 · 7 | NEEDS_REVIEW | WATCH | — | skillMatch:NO_REQUIREMENTS_EXTRACTED, pastPerformance:BID_DOMAIN_UNKNOWN |

FX-06·08·09·10 은 개정이 달라도 점수·자격·권고가 같다. 그래서 `FX-NN.json` 하나로 두 개정을 모두 받는다. 엔진이 점수를 내지 않거나(입력 거절) Kev 를 부르지 않는(`injectionSuspected=true`) 공고는 없었다. 추출 20개 모두 `injectionSuspected: false` 다.

## 파일에 쓴 값

recommendation 은 BID 권고면 0.60 / 0.25 / 0.15, WATCH 권고면 0.25 / 0.60 / 0.15(BID / WATCH / NO_BID)다. mandatoryRisk 는 모두 0.10 이다.

| 파일 | 권고 | needsHumanReview | fit 표시값 | fit wire | fit 분포 | fit confidence |
|---|---|---:|---:|---:|---|---:|
| `FX-04.json` | WATCH | 0.70 | 3.10 | 2.10 | 2:0.9, 3:0.1 | 0.90 |
| `FX-05.json` | WATCH | 0.70 | 4.15 | 3.15 | 3:0.85, 4:0.15 | 0.85 |
| `FX-06.json` | BID | 0.20 | 3.90 | 2.90 | 2:0.1, 3:0.9 | 0.90 |
| `FX-07.json` (r2) | BID | 0.20 | 3.85 | 2.85 | 2:0.15, 3:0.85 | 0.85 |
| `FX-07.r01.json` (r1) | WATCH | 0.20 | 3.40 | 2.40 | 2:0.6, 3:0.4 | 0.60 |
| `FX-08.json` | WATCH | 0.20 | 3.50 | 2.50 | 2:0.5, 3:0.5 | 0.50 |
| `FX-09.json` | WATCH | 0.20 | 3.65 | 2.65 | 2:0.35, 3:0.65 | 0.65 |
| `FX-10.json` | WATCH | 0.20 | 3.25 | 2.25 | 2:0.75, 3:0.25 | 0.75 |
| `FX-11.json` | WATCH | 0.70 | 4.45 | 3.45 | 3:0.55, 4:0.45 | 0.55 |
| `FX-13.json` | WATCH | 0.70 | 4.25 | 3.25 | 3:0.75, 4:0.25 | 0.75 |
| `FX-14.json` | WATCH | 0.20 | 3.25 | 2.25 | 2:0.75, 3:0.25 | 0.75 |
| `FX-15.json` | WATCH | 0.20 | 2.90 | 1.90 | 1:0.1, 2:0.9 | 0.90 |
| `FX-17.json` | WATCH | 0.70 | 3.20 | 2.20 | 2:0.8, 3:0.2 | 0.80 |
| `FX-18.json` | BID | 0.20 | 4.10 | 3.10 | 3:0.9, 4:0.1 | 0.90 |
| `FX-19.json` | WATCH | 0.70 | 4.65 | 3.65 | 3:0.35, 4:0.65 | 0.65 |
| `FX-20.json` | WATCH | 0.70 | 3.50 | 2.50 | 2:0.5, 3:0.5 | 0.50 |

## 문서와 다른 점 (정본 반영 대상, 고치지 않음)

1. **FX-07 r2 점수**
   - 07 §6.2·19 §2·11 S5 는 76 이다. 엔진은 77(77.3)이다.
   - 파일은 엔진 값 77 을 썼다.
   - `fixtures/manifest.yaml` 의 FX-07 `designScore` 도 76 에서 77 로 바꿨다(e8 요청).
     - 이 값을 골든과 비교하는 검사는 골든이 있는 공고만 본다. FX-07 은 골든이 없다.
   - 권고는 어느 쪽이든 BID 다.
2. **FX-17 자격**
   - 07 §6.2·19 §2 는 `NOT_APPLICABLE` 로 적는다.
   - 엔진 종합은 `NEEDS_REVIEW` 다. 항목 사유는 `STAGE_NOT_APPLICABLE` 이다.
   - 그래서 needsHumanReview 는 0.70 이다.
3. **`KEV_NEEDS_REVIEW` 증가**
   - needsHumanReview 0.70 은 03 §5.5 임계값(≥ 0.7)에 걸린다.
   - FX-04·05·11·13·17·19·20 의 분석에 `KEV_NEEDS_REVIEW` 가 새로 붙는다. 07 :350 이 정한 값이다.
4. **"kev fixture 는 엔진 점수에 묶여 있다"**
   - Phase 4 골든이 점수를 바꾸면 fit 을 다시 맞춰야 한다.
5. **WATCH·NO_BID 권고의 0.25 자리**
   - 07 :350 의 "나머지 0.25·0.15" 를 "이웃한 선택지 0.25" 로 명확히 했다(e8).

## 재현 명령

아래 시험 파일을 `web/server/scoring/kev-engine-scores.tmp.test.ts` 로 잠시 두고 돌린 뒤 지웠다. 저장소에는 커밋하지 않는다.

```sh
KEV_ENGINE_OUT=<출력 JSON 경로> pnpm -C web exec vitest run server/scoring/kev-engine-scores.tmp.test.ts
```

```ts
// 임시 계산 스크립트(커밋하지 않는다). fixtures/kev 의 fit·권고·needsHumanReview 근거가 되는 규칙 엔진 출력을 찍는다.
// Kev 는 빼고(kev: null) 규칙만 계산한다. 공고 레코드는 revision 별로 고른다.
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { analyze } from "./analyze";
import { buildInput, loadBid, loadExtraction, withPatch } from "./test-support";

const fixtureUrl = (path: string) => new URL(`../../../fixtures/${path}`, import.meta.url);
const recordsOf = (id: string): { amendmentNo: string; status?: string }[] =>
  JSON.parse(readFileSync(fixtureUrl(`bids/${id}.json`), "utf8")).records;

const IDS = [4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 17, 18, 19, 20].map(
  (n) => `FX-${String(n).padStart(2, "0")}`,
);

it("규칙 엔진 점수", () => {
  const rows: unknown[] = [];
  for (const id of IDS) {
    const records = recordsOf(id);
    records.forEach((record, index) => {
      const extractionId =
        index < records.length - 1 && id === "FX-07" ? `${id}.r${record.amendmentNo}` : id;
      let bid = loadBid(id, index);
      let extraction = loadExtraction(extractionId);
      // FX-13: 수집 정규화 금액(추출의 budgetKrw 환산값)과 gateway 인용 검증 실패(K1) 모양을 넣는다.
      // web/server/analysis/analysis.service.test.ts citationFailedContext 와 같은 방식이다.
      if (id === "FX-13") {
        bid = { ...bid, budgetKrw: extraction.budgetKrw.value };
        extraction = withPatch(extraction, (draft) => {
          draft.warnings = ["CITATION_FAILED:qualifications"];
          draft.qualifications = { value: null, state: "UNKNOWN", evidence: [], note: "CITATION_FAILED" };
        });
      }
      let result: ReturnType<typeof analyze>;
      try {
        result = analyze(buildInput(id, { bid, extraction, kev: null }));
      } catch (error) {
        const issues = (error as { issues?: { path: unknown[]; message: string }[] }).issues;
        rows.push({ id, recordIndex: index, amendmentNo: record.amendmentNo, error: issues ?? String(error) });
        return;
      }
      rows.push({
        id,
        recordIndex: index,
        amendmentNo: record.amendmentNo,
        recordStatus: record.status ?? null,
        extraction: extractionId,
        status: result.status,
        score: result.score,
        total: Math.round(result.factors.reduce((sum, f) => sum + f.points, 0) * 10) / 10,
        points: result.factors.map((f) => f.points),
        qualificationStatus: result.qualificationStatus,
        recommendation: result.recommendation,
        reviewFlags: result.reviewFlags,
        missingFactors: result.missingFactors,
      });
    });
  }
  writeFileSync(process.env.KEV_ENGINE_OUT ?? "/dev/null", JSON.stringify(rows));
});
```

## 관련 문서

- [[07-DATA-PIPELINE|07 수집]] — §6.3 mock Kev fixture 고정값(:350)
- [[03-AI-PIPELINE|03 AI 파이프라인]] — §5.4 wire 형식, §5.5 질문 세트 `kev-qs/v0.1`, §5.7 mock adapter
- [[08-SCORING|08 SOL Score]] — 규칙 점수와 자격 판정
