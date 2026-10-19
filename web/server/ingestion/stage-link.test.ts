import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BidStage } from "./normalized-bid.model";
import {
  STAGE_LINK_CANDIDATE_MIN_SIMILARITY,
  linkStages,
  titleSimilarity,
  type StageLinkInput,
} from "./stage-link";

// 07 §4 단계 연결, 11 §3.1 FX-17·FX-18(planRef 연결)·FX-19(제목 유사도 → 후보만).
const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const FIXTURE_IDS = Array.from(
  { length: 20 },
  (_, index) => `FX-${String(index + 1).padStart(2, "0")}`,
);
// FX-01·FX-19 제목의 2-gram Dice = 18/34
const FX01_FX19_SIMILARITY = 9 / 17;

type RawRecord = { noticeId: string; planRef: string | null; stage: BidStage; title?: string };
// 정규화와 독립으로 fixture 원문에서 입력을 만든다. 제목이 없는 FX-12(격리)는 공고가 되지 않으므로 뺀다.
const fixtureInputs = (): StageLinkInput[] =>
  FIXTURE_IDS.flatMap((id) => {
    const file = JSON.parse(readFileSync(join(FIXTURES_DIR, "bids", `${id}.json`), "utf8")) as {
      records: RawRecord[];
    };
    const record = file.records[0];
    if (record.title === undefined) return [];
    return [
      {
        bidId: id,
        stage: record.stage,
        noticeId: record.noticeId,
        planRef: record.planRef,
        title: record.title,
      },
    ];
  });
const bid = (
  bidId: string,
  stage: BidStage,
  title: string,
  extra: Partial<StageLinkInput> = {},
): StageLinkInput => ({
  bidId,
  stage,
  noticeId: `N-${bidId}`,
  title,
  ...extra,
});

describe("titleSimilarity", () => {
  it("후보 기준은 0.5 다", () => {
    expect(STAGE_LINK_CANDIDATE_MIN_SIMILARITY).toBe(0.5);
  });

  it("같은 제목은 1 이다", () => {
    expect(
      titleSimilarity("세종특별자치시 행정정보 연계 플랫폼", "세종특별자치시 행정정보 연계 플랫폼"),
    ).toBe(1);
  });

  it("'(가상)'·'사전규격'·'발주계획'·공백 차이는 무시한다", () => {
    expect(titleSimilarity("AI 행정서비스 구축 사전규격 (가상)", "AI행정서비스구축 발주계획")).toBe(
      1,
    );
  });

  it("NFKC 정규화 뒤 비교한다", () => {
    expect(titleSimilarity("ＡＩ플랫폼", "AI플랫폼")).toBe(1);
  });

  it("겹치는 2-gram 이 없으면 0 이다", () => {
    expect(titleSimilarity("가나다", "라마바")).toBe(0);
  });

  it("2-gram 을 다중집합으로 센다", () => {
    // {가가×2} ∩ {가가×3} = 2 → 2·2/(2+3). 집합으로 세면 0.4 나 1 이 된다
    expect(titleSimilarity("가가가", "가가가가")).toBeCloseTo(0.8, 12);
  });

  it("2-gram 하나를 공유하는 두 2-gram 제목은 정확히 0.5 다", () => {
    expect(titleSimilarity("가나다", "가나라")).toBe(0.5);
  });

  it("한쪽이 2글자 미만이면 0 이다", () => {
    expect(titleSimilarity("가", "가")).toBe(0);
  });

  it("빈 제목은 0 이다", () => {
    expect(titleSimilarity("", "가나다")).toBe(0);
  });

  it("지울 말을 지우고 2글자 미만이 되면 0 이다", () => {
    expect(titleSimilarity("(가상)", "(가상)")).toBe(0);
  });

  it("FX-01 과 FX-19 의 제목 유사도는 9/17 이다", () => {
    expect(
      titleSimilarity(
        "세종특별자치시 차세대 행정정보시스템 고도화 (가상)",
        "세종특별자치시 행정정보 연계 플랫폼 사전규격 (가상)",
      ),
    ).toBeCloseTo(FX01_FX19_SIMILARITY, 12);
  });

  it("인자 순서를 바꿔도 같다", () => {
    expect(titleSimilarity("가나다라마", "다라마바")).toBe(
      titleSimilarity("다라마바", "가나다라마"),
    );
  });
});

describe("linkStages — fixture", () => {
  it("FX-17(PLAN) → FX-18(PRE_SPEC) 을 PLAN_REF 로 잇는다", () => {
    expect(linkStages(fixtureInputs()).links).toStrictEqual([
      { fromBidId: "FX-17", toBidId: "FX-18", basis: "PLAN_REF" },
    ]);
  });

  it("확정 링크가 있는 FX-17·FX-18 은 제목이 비슷해도 후보에 넣지 않는다", () => {
    const pairs = linkStages(fixtureInputs()).candidates.map(
      ({ bidIdA, bidIdB }) => `${bidIdA}|${bidIdB}`,
    );
    expect([pairs.includes("FX-17|FX-18"), pairs.includes("FX-18|FX-17")]).toEqual([false, false]);
  });

  it("FX-19 는 어떤 공고와도 링크가 없다", () => {
    const touching = linkStages(fixtureInputs()).links.filter(
      ({ fromBidId, toBidId }) => fromBidId === "FX-19" || toBidId === "FX-19",
    );
    expect(touching).toEqual([]);
  });

  it("19건 전체에서 후보는 FX-01↔FX-19 하나뿐이다", () => {
    expect(linkStages(fixtureInputs()).candidates).toStrictEqual([
      { bidIdA: "FX-01", bidIdB: "FX-19", similarity: expect.closeTo(FX01_FX19_SIMILARITY, 12) },
    ]);
  });

  it("입력 순서를 뒤집으면 후보의 bidIdA 는 먼저 나온 FX-19 다", () => {
    const [candidate] = linkStages([...fixtureInputs()].reverse()).candidates;
    expect([candidate?.bidIdA, candidate?.bidIdB]).toEqual(["FX-19", "FX-01"]);
  });

  it("입력 순서를 뒤집어도 PLAN_REF 의 from 은 앞 단계인 FX-17 이다", () => {
    expect(linkStages([...fixtureInputs()].reverse()).links).toStrictEqual([
      { fromBidId: "FX-17", toBidId: "FX-18", basis: "PLAN_REF" },
    ]);
  });
});

describe("linkStages — 확정 링크", () => {
  it("preSpecRef 가 PRE_SPEC 공고의 noticeId 와 같으면 PRE_SPEC → 그 공고를 PRE_SPEC_REF 로 잇는다", () => {
    const preSpec = bid("P1", "PRE_SPEC", "가나다라", { noticeId: "PS-0001" });
    const notice = bid("N1", "NOTICE", "마바사아", { preSpecRef: "PS-0001" });
    expect(linkStages([notice, preSpec]).links).toStrictEqual([
      { fromBidId: "P1", toBidId: "N1", basis: "PRE_SPEC_REF" },
    ]);
  });

  it("preSpecRef 가 PRE_SPEC 이 아닌 공고의 noticeId 와 같으면 잇지 않는다", () => {
    const other = bid("N2", "NOTICE", "가나다라", { noticeId: "N-0002" });
    const plan = bid("L1", "PLAN", "마바사아", { preSpecRef: "N-0002" });
    expect(linkStages([other, plan]).links).toEqual([]);
  });

  it("planRef 와 preSpecRef 가 둘 다 같은 쌍을 가리키면 PLAN_REF 로 한 번만 잇는다", () => {
    const preSpec = bid("P1", "PRE_SPEC", "가나다라", { noticeId: "PS-1", planRef: "PL-1" });
    const notice = bid("N1", "NOTICE", "마바사아", { planRef: "PL-1", preSpecRef: "PS-1" });
    expect(linkStages([preSpec, notice]).links).toStrictEqual([
      { fromBidId: "P1", toBidId: "N1", basis: "PLAN_REF" },
    ]);
  });

  it("같은 planRef 의 세 단계는 앞 단계에서 뒤 단계로 세 쌍을 잇는다", () => {
    const links = linkStages([
      bid("N1", "NOTICE", "가나다라", { planRef: "PL-1" }),
      bid("P1", "PRE_SPEC", "마바사아", { planRef: "PL-1" }),
      bid("L1", "PLAN", "자차카타", { planRef: "PL-1" }),
    ]).links;
    expect(links).toHaveLength(3);
    expect(links).toEqual(
      expect.arrayContaining([
        { fromBidId: "L1", toBidId: "P1", basis: "PLAN_REF" },
        { fromBidId: "L1", toBidId: "N1", basis: "PLAN_REF" },
        { fromBidId: "P1", toBidId: "N1", basis: "PLAN_REF" },
      ]),
    );
  });

  it("같은 stage 끼리는 planRef 가 같아도 잇지 않는다", () => {
    const links = linkStages([
      bid("N1", "NOTICE", "가나다라", { planRef: "PL-1" }),
      bid("N2", "NOTICE", "마바사아", { planRef: "PL-1" }),
    ]).links;
    expect(links).toEqual([]);
  });

  it("빈 planRef 끼리는 잇지 않는다", () => {
    const links = linkStages([
      bid("L1", "PLAN", "가나다라", { planRef: "" }),
      bid("N1", "NOTICE", "마바사아", { planRef: "" }),
    ]).links;
    expect(links).toEqual([]);
  });

  it("null planRef 끼리는 잇지 않는다", () => {
    const links = linkStages([
      bid("L1", "PLAN", "가나다라", { planRef: null }),
      bid("N1", "NOTICE", "마바사아", { planRef: null }),
    ]).links;
    expect(links).toEqual([]);
  });
});

describe("linkStages — 후보", () => {
  it("유사도가 정확히 0.5 면 후보에 넣는다", () => {
    expect(
      linkStages([bid("N1", "NOTICE", "가나다"), bid("P1", "PRE_SPEC", "가나라")]).candidates,
    ).toStrictEqual([{ bidIdA: "N1", bidIdB: "P1", similarity: 0.5 }]);
  });

  it("유사도가 0.5 미만이면 후보에 넣지 않는다", () => {
    expect(
      linkStages([bid("N1", "NOTICE", "가나다"), bid("P1", "PRE_SPEC", "가나라마")]).candidates,
    ).toEqual([]);
  });

  it("같은 stage 끼리는 제목이 같아도 후보가 아니다", () => {
    expect(
      linkStages([bid("N1", "NOTICE", "가나다라"), bid("N2", "NOTICE", "가나다라")]).candidates,
    ).toEqual([]);
  });

  it("후보는 링크로 만들지 않는다", () => {
    expect(
      linkStages([bid("N1", "NOTICE", "가나다라"), bid("P1", "PRE_SPEC", "가나다라")]).links,
    ).toEqual([]);
  });

  it("확정 링크가 있는 쌍은 제목이 같아도 후보가 아니다", () => {
    const result = linkStages([
      bid("L1", "PLAN", "가나다라", { planRef: "PL-1" }),
      bid("N1", "NOTICE", "가나다라", { planRef: "PL-1" }),
    ]);
    expect(result.candidates).toEqual([]);
  });

  it("후보를 유사도 내림차순으로 낸다", () => {
    const pairs = linkStages([
      bid("N1", "NOTICE", "가나다라"),
      bid("P1", "PRE_SPEC", "가나다마"),
      bid("P2", "PRE_SPEC", "가나다라"),
    ]).candidates.map(({ bidIdA, bidIdB }) => [bidIdA, bidIdB]);
    expect(pairs).toEqual([
      ["N1", "P2"],
      ["N1", "P1"],
    ]);
  });

  it("유사도가 같으면 입력 순서대로 낸다", () => {
    const pairs = linkStages([
      bid("N1", "NOTICE", "가나다라"),
      bid("P1", "PRE_SPEC", "가나다라"),
      bid("P2", "PRE_SPEC", "가나다라"),
    ]).candidates.map(({ bidIdA, bidIdB }) => [bidIdA, bidIdB]);
    expect(pairs).toEqual([
      ["N1", "P1"],
      ["N1", "P2"],
    ]);
  });
});

describe("linkStages — 경계", () => {
  it("빈 입력이면 링크도 후보도 없다", () => {
    expect(linkStages([])).toStrictEqual({ links: [], candidates: [] });
  });

  it("입력 배열과 원소를 바꾸지 않는다", () => {
    const inputs = fixtureInputs();
    const before = structuredClone(inputs);
    linkStages(inputs);
    expect(inputs).toStrictEqual(before);
  });
});
