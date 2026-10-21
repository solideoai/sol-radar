import "server-only";

import { describe, expect, it } from "vitest";
import { matchProcurementOpportunities, type OpportunityMatchInput } from "./opportunity-match";

const notice = (changes: Partial<OpportunityMatchInput> = {}): OpportunityMatchInput => ({
  sourceFamily: "G2B",
  sourceKey: "g2b-bid",
  providerNamespace: "g2b",
  noticeId: "000123",
  amendment: "00",
  agency: { id: "agency-001", name: "가상 공공기관" },
  title: "통합정보시스템 유지보수",
  stage: "NOTICE",
  publishedAt: "2026-10-21T00:00:00.000Z",
  deadlineAt: "2026-11-04T09:00:00.000Z",
  amount: { value: "100000000", type: "ESTIMATED_PRICE", unit: "KRW", currency: "KRW" },
  sourceUrl: "https://www.g2b.go.kr/notice/000123",
  attachmentHashes: ["same-attachment"],
  isDemo: false,
  ...changes,
});

describe("사업기회 사본 판정", () => {
  it("공고번호가 같아도 다른 기관이면 별개로 보존한다", () => {
    const result = matchProcurementOpportunities(
      notice(),
      notice({ agency: { id: "agency-002", name: "다른 공공기관" } }),
    );

    expect(result.outcome).toBe("DISTINCT");
    expect(result.reasons).toContain("AGENCY_DIFFERS");
    expect(result.evidence).toContainEqual({
      field: "agencyId",
      left: "agency-001",
      right: "agency-002",
    });
  });

  it("공식 원발급 namespace·번호·차수·기관이 같은 출처 사본만 확정한다", () => {
    const result = matchProcurementOpportunities(
      notice(),
      notice({
        sourceFamily: "KWATER",
        sourceKey: "kwater-bid",
        sourceUrl: "https://example.org/42",
      }),
    );

    expect(result.outcome).toBe("CONFIRMED_DUPLICATE");
    expect(result.relationship).toBe("SOURCE_COPY");
    expect(result.reasons).toContain("OFFICIAL_IDENTITY_MATCH");
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ field: "providerNamespace", left: "g2b", right: "g2b" }),
    );
  });

  it("정정 차수 변경은 같은 출처 공고의 revision으로 연결한다", () => {
    const result = matchProcurementOpportunities(notice(), notice({ amendment: "01" }));

    expect(result.outcome).toBe("CONFIRMED_DUPLICATE");
    expect(result.relationship).toBe("SAME_SOURCE_RECORD");
    expect(result.reasons).toContain("SAME_SOURCE_NOTICE_REVISION");
  });

  it("다른 namespace의 비슷한 공고는 제목·기관·날짜·금액이 같아도 후보다", () => {
    const result = matchProcurementOpportunities(
      notice(),
      notice({
        sourceFamily: "LH",
        sourceKey: "lh-bid",
        providerNamespace: "lh",
        noticeId: "LH-42",
        title: "[정정공고]  통합정보시스템　유지보수",
      }),
    );

    expect(result.outcome).toBe("CANDIDATE");
    expect(result.relationship).toBe("POSSIBLE_DUPLICATE");
    expect(result.reasons).toContain("NORMALIZED_TITLE_MATCH");
  });

  it("공식 원번호 참조가 있어도 재입찰은 별개다", () => {
    const result = matchProcurementOpportunities(
      notice(),
      notice({
        noticeId: "000124",
        title: "[재공고] 통합정보시스템 유지보수",
        rebidOf: "000123",
      }),
    );

    expect(result.outcome).toBe("DISTINCT");
    expect(result.reasons).toContain("REBID_SEPARATE_NOTICE");
  });

  it("제목만 유사하고 식별 근거가 없으면 확정하지 않고 후보로 남긴다", () => {
    const result = matchProcurementOpportunities(
      notice({ title: "통합정보시스템 유지보수 용역" }),
      notice({
        sourceFamily: "LH",
        sourceKey: "lh-bid",
        providerNamespace: "lh",
        noticeId: "LH-43",
        title: "통합정보시스템 운영 및 유지보수 용역",
        agency: { id: null, name: null },
        publishedAt: null,
        deadlineAt: null,
        amount: null,
        sourceUrl: null,
        attachmentHashes: [],
      }),
    );

    expect(result.outcome).toBe("CANDIDATE");
    expect(result.reasons).toContain("SIMILAR_TITLE");
  });

  it("공식 단계 참조는 중복과 구분하고 demo와 live는 합치지 않는다", () => {
    const early = notice({
      stage: "PRE_SPEC",
      noticeId: "pre-42",
      officialCrossReferences: [
        {
          providerNamespace: "g2b",
          noticeId: "000123",
          agencyId: "agency-001",
          stage: "NOTICE",
          evidence: { sourceUrl: "https://www.g2b.go.kr/pre/42", quote: "연결 공고 000123" },
        },
      ],
    });

    expect(matchProcurementOpportunities(early, notice())).toMatchObject({
      outcome: "DISTINCT",
      relationship: "STAGE_LINK",
    });
    expect(matchProcurementOpportunities(notice(), notice({ isDemo: true }))).toMatchObject({
      outcome: "DISTINCT",
      reasons: ["DEMO_LIVE_BOUNDARY"],
    });
  });

  it("안정 공고번호를 확보하지 못한 행은 공식 참조가 있어도 확정하지 않는다", () => {
    const result = matchProcurementOpportunities(
      notice({
        noticeId: null,
        officialCrossReferences: [
          {
            providerNamespace: "g2b",
            noticeId: "000123",
            agencyId: "agency-001",
            evidence: { sourceUrl: "https://example.org/provisional", quote: "참조 공고 000123" },
          },
        ],
      }),
      notice(),
    );

    expect(result.outcome).toBe("CANDIDATE");
    expect(result.reasons).toContain("PROVISIONAL_IDENTITY");
  });
});
