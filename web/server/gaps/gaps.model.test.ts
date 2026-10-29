import { describe, expect, it } from "vitest";
import {
  assessQualifications,
  assessStructuredQualifications,
  type CompanyProfile,
  type NormalizedBidSummary,
  type StructuredRequirement,
} from "@/server/scoring";
import {
  assumeGapRadar,
  bucketByBid,
  buildGapRadar,
  classifyNotice,
  gapRadarHref,
  parseAssume,
  parseGapQuery,
  toGapNotice,
  toggleAssume,
  type GapNotice,
} from "./gaps.model";

// 자격 갭 레이더(스펙 2026-10-28 §5 A4). 업종 이름·코드는 운영 실측(§3)의 나라장터 표기를 쓴다.
const TODAY = "2026-10-28";
const SW = { code: "1468", name: "소프트웨어사업자(컴퓨터관련서비스사업)" };
const ICT = { code: "0036", name: "정보통신공사업" };
const RESEARCH = { code: "1169", name: "학술.연구용역" };

const profile = (licenses: CompanyProfile["licenses"] = []): CompanyProfile => ({
  revision: 5,
  isDemo: false,
  technologies: [],
  technologiesComplete: false,
  licenses: [
    { code: "ICT_CONSTRUCTION", name: "정보통신공사업 등록", status: "HELD" },
    ...licenses,
  ],
  industryCodes: [],
  pastProjects: [],
  financials: null,
  preferences: null,
});

const row = (
  kind: StructuredRequirement["kind"],
  seq: number,
  entry: { code: string | null; name: string | null },
): StructuredRequirement => ({ kind, seq, ...entry, value: {}, sourceOperation: "test" });
const license = (seq: number, entry: { code: string; name: string }) =>
  row("LICENSE_LIMIT", seq, entry);

const notice = (
  id: string,
  rows: StructuredRequirement[],
  options: { aux?: "OK" | "FAILED" | null; budget?: string | null } = {},
): GapNotice => {
  const aux = options.aux === undefined ? "OK" : options.aux;
  const bid: NormalizedBidSummary = {
    revisionId: `rev-${id}`,
    title: `공고 ${id}`,
    agency: "가상 기관",
    stage: "NOTICE",
    budgetKrw: options.budget === undefined ? "100000000" : options.budget,
    deadlineAt: "2026-11-20T09:00:00+00:00",
    noticeDate: "2026-10-20T00:00:00+00:00",
    fetchedAt: "2026-10-28T00:00:00+00:00",
    structuredQualifications: rows,
    ...(aux === null
      ? {}
      : { auxLookup: { status: aux, failed: aux === "OK" ? [] : ["g2b-bid-region"] } }),
  };
  return {
    bidId: id,
    title: bid.title,
    agency: bid.agency,
    budgetKrw: bid.budgetKrw,
    deadlineAt: bid.deadlineAt,
    bid,
  };
};

describe("classifyNotice · 공고 한 건의 판정 묶음", () => {
  it.each([
    ["면허제한 1행 HELD", notice("a", [license(1, ICT)]), "ELIGIBLE", []],
    ["면허제한 없음 + 보조 조회 OK", notice("b", []), "ELIGIBLE", []],
    ["면허제한 1행 회사 기록 없음", notice("c", [license(1, SW)]), "MISSING_RECORD", []],
    [
      "면허제한 2행",
      notice("d", [license(1, SW), license(2, ICT)]),
      "NEEDS_REVIEW",
      ["LICENSE_MULTI_ROW"],
    ],
    ["보조 조회 결과 없음", notice("e", [], { aux: null }), "NEEDS_REVIEW", ["AUX_LOOKUP_ABSENT"]],
    [
      "보조 조회 결과가 없으면 기록 없음 1행도 확인 필요",
      notice("x", [license(1, SW)], { aux: null }),
      "NEEDS_REVIEW",
      ["LICENSE_RECORD_MISSING", "AUX_LOOKUP_ABSENT"],
    ],
    [
      "보조 조회 FAILED 면 기록 없음 1행도 확인 필요",
      notice("f", [license(1, SW)], { aux: "FAILED" }),
      "NEEDS_REVIEW",
      ["LICENSE_RECORD_MISSING", "AUX_LOOKUP_INCOMPLETE"],
    ],
    [
      "프로토타입 이름(constructor) 코드는 사전 밖",
      notice("p", [license(1, { code: "constructor", name: "constructor" })]),
      "NEEDS_REVIEW",
      ["LICENSE_OUT_OF_DICTIONARY"],
    ],
    [
      "사전 밖 업종 1행",
      notice("g", [license(1, RESEARCH)]),
      "NEEDS_REVIEW",
      ["LICENSE_OUT_OF_DICTIONARY"],
    ],
    [
      "기록 없음 1행 + 참가가능지역",
      notice("h", [license(1, SW), row("PARTICIPATION_REGION", 1, { code: "11", name: "서울" })]),
      "NEEDS_REVIEW",
      ["LICENSE_RECORD_MISSING", "REGION_UNVERIFIED"],
    ],
  ] as const)("%s → %s", (_label, target, bucket, reasons) => {
    const verdict = classifyNotice(target, profile(), TODAY);
    expect(verdict.bucket).toBe(bucket);
    expect(verdict.reasons).toEqual(reasons);
  });

  it("NOT_HELD 기록이 있으면 미보유, 유효기간 지난 HELD 는 확인 필요(만료)다", () => {
    const notHeld = profile([
      { code: "SW_BUSINESS_REG", name: "소프트웨어사업자 신고확인서", status: "NOT_HELD" },
    ]);
    expect(classifyNotice(notice("a", [license(1, SW)]), notHeld, TODAY)).toMatchObject({
      bucket: "NOT_HELD",
      blocker: { kind: "NOT_HELD", industry: { key: "1468", code: "SW_BUSINESS_REG" } },
    });
    const expired: CompanyProfile = {
      ...profile(),
      licenses: [
        {
          code: "ICT_CONSTRUCTION",
          name: "정보통신공사업 등록",
          status: "HELD",
          validUntil: "2026-01-01",
        },
      ],
    };
    expect(classifyNotice(notice("b", [license(1, ICT)]), expired, TODAY).reasons).toEqual([
      "LICENSE_RECORD_EXPIRED",
    ]);
  });

  it("데이터 모양이 틀린 공고는 확인 필요(DATA_INVALID)로 센다", () => {
    expect(classifyNotice({ ...notice("a", []), bid: null }, profile(), TODAY)).toMatchObject({
      bucket: "NEEDS_REVIEW",
      reasons: ["DATA_INVALID"],
    });
  });

  // §5 A2: 같은 공고를 공고 상세에서 분석했을 때(추출 없음)의 구조화 필드 판정과 같아야 한다.
  it("판정은 assessQualifications(추출 없음)의 structured:* 항목과 같다", () => {
    const target = notice(
      "a",
      [
        license(1, SW),
        row("PERMITTED_INDUSTRY", 1, { code: "1468", name: "소프트웨어사업자" }),
        row("PARTICIPATION_REGION", 1, { code: "11", name: "서울" }),
      ],
      { aux: "FAILED" },
    );
    const bid = target.bid as NormalizedBidSummary;
    const full = assessQualifications({ bid, extraction: null, profile: profile(), today: TODAY });
    expect(assessStructuredQualifications({ bid, profile: profile(), today: TODAY })).toEqual(
      full.checks.filter((check) => check.id.startsWith("structured:")),
    );
  });
});

describe("buildGapRadar · assumeGapRadar · 집계와 보유 가정", () => {
  const notices = [
    notice("open", [license(1, ICT)], { budget: "300000000" }),
    notice("sw-1", [license(1, SW)], { budget: "500000000" }),
    notice("sw-2", [license(1, SW)], { budget: "200000000" }),
    notice("bundle", [license(1, SW), license(2, ICT)], { budget: "900000000" }),
    notice("research", [license(1, RESEARCH)], { budget: "50000000" }),
    notice("no-aux", [], { aux: null, budget: null }),
  ];

  it("묶음별 건수·예산 합, 막는 자격 순위, 확인 필요 사유를 센다", () => {
    const radar = buildGapRadar(notices, profile(), TODAY);
    expect(radar.summary.total).toEqual({ count: 6, budgetKrw: "1950000000" });
    expect(radar.summary.buckets).toEqual({
      ELIGIBLE: { count: 1, budgetKrw: "300000000" },
      MISSING_RECORD: { count: 2, budgetKrw: "700000000" },
      NOT_HELD: { count: 0, budgetKrw: "0" },
      NEEDS_REVIEW: { count: 3, budgetKrw: "950000000" },
    });
    expect(radar.blockers).toEqual([
      {
        key: "SW_BUSINESS_REG",
        name: SW.name,
        apiCode: "1468",
        code: "SW_BUSINESS_REG",
        kind: "MISSING_RECORD",
        count: 2,
        budgetKrw: "700000000",
        bundledReviewCount: 1,
      },
      {
        key: "1169",
        name: RESEARCH.name,
        apiCode: "1169",
        code: null,
        kind: "OUT_OF_DICTIONARY",
        count: 1,
        budgetKrw: "50000000",
        bundledReviewCount: 0,
      },
    ]);
    expect(radar.reviewReasons).toEqual([
      { reason: "LICENSE_MULTI_ROW", count: 1 },
      { reason: "LICENSE_OUT_OF_DICTIONARY", count: 1 },
      { reason: "AUX_LOOKUP_ABSENT", count: 1 },
    ]);
  });

  it("소프트웨어사업자 보유 가정 → 기록 없음 2건이 참가 가능으로 옮겨 가고, 2행 공고는 그대로 확인 필요다", () => {
    const assumed = assumeGapRadar(notices, profile(), TODAY, ["SW_BUSINESS_REG"]);
    expect(assumed.summary.buckets.ELIGIBLE).toEqual({ count: 3, budgetKrw: "1000000000" });
    expect(assumed.summary.buckets.MISSING_RECORD).toEqual({ count: 0, budgetKrw: "0" });
    expect(assumed.summary.buckets.NEEDS_REVIEW.count).toBe(3);
    expect(assumed.opened.map((entry) => entry.bidId)).toEqual(["sw-1", "sw-2"]);
    // 원본 프로필로 다시 계산하면 그대로다(가정은 사본에만 반영).
    expect(buildGapRadar(notices, profile(), TODAY).summary.buckets.ELIGIBLE.count).toBe(1);
  });

  it("NOT_HELD 로 적힌 자격도 보유 가정하면 참가 가능이 되고, 다른 확인 필요가 남은 공고는 순위에 세지 않는다", () => {
    const notHeld = profile([
      { code: "SW_BUSINESS_REG", name: "소프트웨어사업자 신고확인서", status: "NOT_HELD" },
    ]);
    const withRegion = [
      ...notices,
      notice("sw-region", [
        license(1, SW),
        row("PARTICIPATION_REGION", 1, { code: "11", name: "서울" }),
      ]),
    ];
    const radar = buildGapRadar(withRegion, notHeld, TODAY);
    expect(radar.summary.buckets.NOT_HELD.count).toBe(3);
    const [sw] = radar.blockers;
    expect(sw).toMatchObject({ code: "SW_BUSINESS_REG", kind: "NOT_HELD", count: 2 });
    // 순위 표 건수 = 그 코드를 가정했을 때 실제로 열리는 건수
    expect(assumeGapRadar(withRegion, notHeld, TODAY, ["SW_BUSINESS_REG"]).opened).toHaveLength(
      sw.count,
    );
  });

  it("같은 사전 코드로 풀리는 API 업종은 한 줄로 합친다", () => {
    const sw1469 = { code: "1469", name: "소프트웨어사업자(패키지소프트웨어개발)" };
    const radar = buildGapRadar(
      [...notices, notice("sw-3", [license(1, sw1469)], { budget: "10000000" })],
      profile(),
      TODAY,
    );
    expect(radar.blockers[0]).toEqual({
      key: "SW_BUSINESS_REG",
      name: SW.name,
      apiCode: "1468·1469",
      code: "SW_BUSINESS_REG",
      kind: "MISSING_RECORD",
      count: 3,
      budgetKrw: "710000000",
      bundledReviewCount: 1,
    });
  });
});

describe("parseAssume · 주소 · 행 변환", () => {
  it("사전 코드만 남기고 중복을 없애 사전 순서로 정렬한다", () => {
    expect(parseAssume("ISMS_P,SW_BUSINESS_REG,ISMS_P,UNKNOWN, CSAP")).toEqual([
      "SW_BUSINESS_REG",
      "ISMS_P",
      "CSAP",
    ]);
    expect(parseAssume(["CSAP", "SW_BUSINESS_REG"])).toEqual(["SW_BUSINESS_REG", "CSAP"]);
    expect(parseAssume(undefined)).toEqual([]);
  });

  it("주소 쿼리를 읽고 스위치를 켜고 끈 다음 주소를 만든다", () => {
    const query = parseGapQuery({ assume: "ISMS_P" });
    expect(query).toEqual({ assume: ["ISMS_P"] });
    expect(gapRadarHref(toggleAssume(query, "SW_BUSINESS_REG", true))).toBe(
      "/gaps?assume=SW_BUSINESS_REG,ISMS_P",
    );
    expect(gapRadarHref(toggleAssume(parseGapQuery({ assume: "ISMS_P" }), "ISMS_P", false))).toBe(
      "/gaps",
    );
  });

  it("행 → 대상 공고: latest_revision 의 요건·보조 조회를 쓴다", () => {
    const requirement = {
      kind: "LICENSE_LIMIT",
      seq: 1,
      code: SW.code,
      name: SW.name,
      value: {},
      source_operation: "getBidPblancListInfoLicenseLimit",
    };
    const rowBase = {
      id: "bid-1",
      title: "실공고",
      agency: "기관",
      stage: "NOTICE",
      budget_krw: "392900000",
      deadline_at: "2026-11-20T09:00:00+00:00",
      latest_revision: 2,
      last_synced_at: "2026-10-28T00:00:00+00:00",
      it_scope: true,
    };
    const target = toGapNotice({
      ...rowBase,
      revisions: [
        {
          id: "r1",
          revision: 1,
          fetched_at: "2026-10-20T00:00:00+00:00",
          aux: null,
          requirements: [],
        },
        {
          id: "r2",
          revision: 2,
          fetched_at: "2026-10-27T00:00:00+00:00",
          aux: { status: "OK", failed: [] },
          requirements: [requirement],
        },
      ],
    });
    expect(target).toMatchObject({ budgetKrw: "392900000" });
    expect(target.bid?.revisionId).toBe("r2");
    expect(classifyNotice(target, profile(), TODAY).bucket).toBe("MISSING_RECORD");
    // latest_revision 이 없으면 규칙 엔진 입력을 만들지 않는다(DATA_INVALID 로 센다).
    expect(
      toGapNotice({ ...rowBase, id: "bid-2", latest_revision: 3, revisions: [] }).bid,
    ).toBeNull();
  });
});

describe("bucketByBid · /market 겹쳐 보기(§6 B2)", () => {
  it("받은 공고마다 classifyNotice 와 같은 묶음을 bidId 로 돌려준다", () => {
    const notHeld = profile([
      { code: "SW_BUSINESS_REG", name: "소프트웨어사업자 신고확인서", status: "NOT_HELD" },
    ]);
    const list = [
      notice("eligible", []),
      notice("not-held", [license(1, SW)]),
      notice("review", [], { aux: "FAILED" }),
      notice("bundle", [license(1, RESEARCH), license(2, ICT)]),
    ];
    const buckets = bucketByBid(list, notHeld, TODAY);
    expect([...buckets]).toEqual([
      ["eligible", "ELIGIBLE"],
      ["not-held", "NOT_HELD"],
      ["review", "NEEDS_REVIEW"],
      ["bundle", "NEEDS_REVIEW"],
    ]);
    for (const entry of list)
      expect(buckets.get(entry.bidId)).toBe(classifyNotice(entry, notHeld, TODAY).bucket);
    expect(bucketByBid([notice("sw", [license(1, SW)])], profile(), TODAY).get("sw")).toBe(
      "MISSING_RECORD",
    );
  });
});
