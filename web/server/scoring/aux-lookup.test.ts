import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { normalizedBidSummarySchema, type AuxLookup } from "./analysis-input.model";
import { assessQualifications } from "./qualification";
import { buildInput, loadBid, loadExtraction, loadProfile } from "./test-support";

// C8 M2(07 §2.2 "그 공고는 확인 필요(NEEDS_REVIEW, 정보 부족)"): live 수집이 보조 조회(면허제한·참가가능지역)를
// 받지 못한 공고는 구조화 자격이 비어 있어도 "제한 없음"이 아니다. 규칙 엔진은 NEEDS_REVIEW(NOTICE_INFO_MISSING) 한 건을 둔다.
// 필드가 없는 공고(fixture·보조 조회 전 revision)에는 검사를 만들지 않아 골든·FX 시험이 흔들리지 않는다.

const FAILED: AuxLookup = { status: "FAILED", failed: ["g2b-bid-license-limit"] };
const SKIPPED: AuxLookup = {
  status: "SKIPPED_QUOTA",
  failed: ["g2b-bid-license-limit", "g2b-bid-region", "g2b-bid-eorder-attach"],
};

const contextWith = (auxLookup?: AuxLookup) => ({
  bid: { ...loadBid("FX-01"), ...(auxLookup === undefined ? {} : { auxLookup }) },
  extraction: loadExtraction("FX-01"),
  profile: loadProfile(),
  today: "2026-10-19",
});

const auxCheckOf = (auxLookup?: AuxLookup) =>
  assessQualifications(contextWith(auxLookup)).checks.find(
    (check) => check.id === "structured:AUX_LOOKUP",
  );

describe("assessQualifications · auxLookup", () => {
  it("auxLookup 이 없으면 structured:AUX_LOOKUP 검사를 만들지 않는다(FX-01 골든 그대로)", () => {
    const baseline = assessQualifications(contextWith());
    expect([auxCheckOf(), baseline.status]).toEqual([undefined, "SATISFIED"]);
  });

  it("auxLookup OK 면 검사를 만들지 않는다", () => {
    expect(auxCheckOf({ status: "OK", failed: [] })).toBeUndefined();
  });

  it("FAILED 면 NEEDS_REVIEW·NOTICE_INFO_MISSING·basis API_FIELD·mandatory·근거 0건이다", () => {
    expect(auxCheckOf(FAILED)).toEqual({
      id: "structured:AUX_LOOKUP",
      requirementCode: null,
      requirementName: "면허·지역 제한 조회 실패",
      mandatory: true,
      basis: "API_FIELD",
      evidence: [],
      outcome: "NEEDS_REVIEW",
      reasonCode: "NOTICE_INFO_MISSING",
      reason: expect.stringContaining("g2b-bid-license-limit"),
      profileEvidence: [],
      companyEvidence: [],
    });
  });

  it("SKIPPED_QUOTA 면 이름에 '(호출 예산)' 이 붙고 사유에 예산을 밝힌다", () => {
    expect(auxCheckOf(SKIPPED)).toMatchObject({
      requirementName: "면허·지역 제한 조회 실패(호출 예산)",
      outcome: "NEEDS_REVIEW",
      reasonCode: "NOTICE_INFO_MISSING",
      reason: expect.stringContaining("호출 예산"),
    });
  });

  it("FAILED 검사는 필수라 자격 종합이 NEEDS_REVIEW 로 내려간다(FX-01 은 원래 SATISFIED)", () => {
    expect(assessQualifications(contextWith(FAILED)).status).toBe("NEEDS_REVIEW");
  });

  it("구조화 자격 행이 있어도 검사가 함께 남는다(받은 행은 판정하고 못 받은 쪽은 확인 필요)", () => {
    const context = contextWith(FAILED);
    const withRow = {
      ...context,
      bid: {
        ...context.bid,
        structuredQualifications: [
          {
            kind: "PARTICIPATION_REGION" as const,
            seq: 0,
            code: null,
            name: "대구광역시",
            value: { prtcptPsblRgnNm: "대구광역시" },
            sourceOperation: "getBidPblancListInfoPrtcptPsblRgn",
          },
        ],
      },
    };
    const ids = assessQualifications(withRow).checks.map((check) => check.id);
    // 구조화 행 → 보조 조회 검사 → 추출 항목(FX-01 은 3건) 순서
    expect([ids.slice(0, 2), ids.slice(2).every((id) => id.startsWith("qualifications["))]).toEqual(
      [["structured:PARTICIPATION_REGION[0]", "structured:AUX_LOOKUP"], true],
    );
  });

  it("발주계획(PLAN) 단계면 다른 검사처럼 STAGE_NOT_APPLICABLE 로 바뀐다", () => {
    const context = contextWith(FAILED);
    const plan = { ...context, bid: { ...context.bid, stage: "PLAN" as const } };
    expect(
      assessQualifications(plan).checks.find((check) => check.id === "structured:AUX_LOOKUP")
        ?.reasonCode,
    ).toBe("STAGE_NOT_APPLICABLE");
  });
});

describe("analyze · auxLookup", () => {
  it("FX-01 에 auxLookup FAILED 를 주면 자격 NEEDS_REVIEW 라 권고가 WATCH 가 된다", () => {
    const input = buildInput("FX-01");
    const baseline = analyze(input);
    const result = analyze({ ...input, bid: { ...input.bid, auxLookup: FAILED } });
    expect([
      baseline.qualificationStatus,
      result.qualificationStatus,
      result.recommendation,
    ]).toEqual(["SATISFIED", "NEEDS_REVIEW", "WATCH"]);
  });

  it("auxLookup 은 입력 스냅샷에 들어가 해시가 달라진다(재현성: 같은 입력이면 같은 해시)", () => {
    const input = buildInput("FX-01");
    const withLookup = { ...input, bid: { ...input.bid, auxLookup: FAILED } };
    expect(analyze(withLookup).inputSnapshotHash).not.toBe(analyze(input).inputSnapshotHash);
    expect(analyze(withLookup).inputSnapshotHash).toBe(analyze(withLookup).inputSnapshotHash);
  });
});

describe("normalizedBidSummarySchema · auxLookup", () => {
  it("auxLookup 없이도, OK·FAILED·SKIPPED_QUOTA 로도 통과한다", () => {
    const bid = loadBid("FX-01");
    for (const auxLookup of [undefined, { status: "OK", failed: [] }, FAILED, SKIPPED]) {
      expect(
        normalizedBidSummarySchema.safeParse({ ...bid, auxLookup }).success,
        JSON.stringify(auxLookup),
      ).toBe(true);
    }
  });

  it("모르는 status 는 거부한다", () => {
    expect(
      normalizedBidSummarySchema.safeParse({
        ...loadBid("FX-01"),
        auxLookup: { status: "PARTIAL", failed: [] },
      }).success,
    ).toBe(false);
  });
});
