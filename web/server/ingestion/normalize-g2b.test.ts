import { describe, expect, it } from "vitest";
import { finalizeRevision } from "./checksum";
import type { G2bItem } from "./connector.model";
import { normalizedBidSchema } from "./normalized-bid.model";
import {
  G2B_NOTICE_KIND_STATUS,
  normalizeG2bBidNotice,
  sortStructuredRequirements,
} from "./normalize-g2b";

// 나라장터 입찰공고 목록 한 행 → NormalizedBidDraft (07 §3.1).
// 행 모양은 2026-10-19 실측 응답을 본떴고, 번호·이름·기관·담당자 값은 모두 가상이다.

type NormalizeOutcome = ReturnType<typeof normalizeG2bBidNotice>;
type StructuredRequirement = Parameters<typeof sortStructuredRequirements>[0][number];

const FETCHED_AT = new Date("2026-10-19T01:00:00.000Z");
const CONTEXT = { fetchedAt: FETCHED_AT };
const NOTICE_NO = "R26BK00000001";
const SOURCE_KEY = `g2b-bid-notice:${NOTICE_NO}`;
const DETAIL_URL = `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${NOTICE_NO}&bidPbancOrd=000`;
const LIST_URL = `https://www.g2b.go.kr/link/PNPE027_01/list/?bidPbancNo=${NOTICE_NO}`;
const docUrl = (seq: number): string =>
  `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?bidPbancNo=${NOTICE_NO}&bidPbancOrd=000&fileType=&fileSeq=${seq}&prcmBsneSeCd=03`;

// 담당자 필드마다 눈에 띄는 가짜 값(결과에 0회인지 찾기 쉽게).
const CONTACT: G2bItem = {
  ntceInsttOfclNm: "가짜담당자-1",
  ntceInsttOfclTelNo: "000-0000-0001",
  ntceInsttOfclEmailAdrs: "fake1@contact.invalid",
  exctvNm: "가짜집행관-1",
  crdtrNm: "가짜채권자-1",
  dminsttOfclEmailAdrs: "fake2@contact.invalid",
  ofclNm: "가짜담당자-2",
  ofclTelNo: "000-0000-0002",
  telNo: "000-0000-0003",
};

// 실측처럼 첨부 칸 10개가 모두 있고 쓰지 않는 칸은 빈 문자열이다.
const EMPTY_SPEC_DOCS: G2bItem = Object.fromEntries(
  Array.from({ length: 10 }, (_, index) => [
    [`ntceSpecDocUrl${index + 1}`, ""],
    [`ntceSpecFileNm${index + 1}`, ""],
  ]).flat(),
);

const baseItem = (overrides: G2bItem = {}): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  reNtceYn: "N",
  ntceKindNm: "등록공고",
  bidNtceDt: "2026-10-12 06:41:03",
  bidNtceNm: "가상 정보시스템 유지관리 용역",
  ntceInsttNm: "가상공고기관",
  dminsttNm: "가상수요기관",
  cntrctCnclsMthdNm: "일반경쟁",
  bidClseDt: "2026-11-23 12:00:00",
  ...EMPTY_SPEC_DOCS,
  ntceSpecDocUrl1: docUrl(1),
  ntceSpecFileNm1: "1.제안요청서.pdf",
  ntceSpecDocUrl2: docUrl(2),
  ntceSpecFileNm2: "2.과업지시서.hwp",
  stdNtceDocUrl: docUrl(99),
  asignBdgtAmt: "1264200000",
  presmptPrce: "1149272727",
  bidNtceDtlUrl: DETAIL_URL,
  bidNtceUrl: LIST_URL,
  orderPlanUntyNo: "",
  bfSpecRgstNo: "R26BD00000001",
  infoBizYn: "Y",
  sucsfbidMthdNm: "협상에의한계약-협상에 의한 낙찰자 결정(SW사업)",
  pubPrcrmntClsfcNm: "정보시스템유지관리서비스",
  chgNtceRsn: "",
  befBidBbancNo: "",
  ...CONTACT,
  ...overrides,
});

const without = (item: G2bItem, ...keys: string[]): G2bItem =>
  Object.fromEntries(Object.entries(item).filter(([key]) => !keys.includes(key)));

const okOf = (outcome: NormalizeOutcome) => {
  if (!outcome.ok)
    throw new Error(`정규화 성공을 기대했다: ${outcome.issue.code} ${outcome.issue.detail}`);
  return outcome;
};
const draftOf = (item: G2bItem) => okOf(normalizeG2bBidNotice(item, CONTEXT)).draft;
const warningsOf = (item: G2bItem) => okOf(normalizeG2bBidNotice(item, CONTEXT)).warnings;
const issueOf = (item: G2bItem) => {
  const outcome = normalizeG2bBidNotice(item, CONTEXT);
  if (outcome.ok) throw new Error("격리를 기대했는데 정규화가 성공했다");
  return outcome.issue;
};

describe("normalizeG2bBidNotice — 전체 매핑", () => {
  it("평범한 등록공고 한 행을 07 §3.1 대로 옮긴다", () => {
    expect(draftOf(baseItem())).toStrictEqual({
      schemaVersion: "normalized-bid/v0.2",
      source: "g2b-bid-notice",
      noticeId: NOTICE_NO,
      amendmentNo: "000",
      preSpecRef: "R26BD00000001",
      stage: "NOTICE",
      status: "OPEN",
      title: "가상 정보시스템 유지관리 용역",
      agency: "가상수요기관",
      budgetKrw: "1264200000",
      noticeDate: "2026-10-11T21:41:03.000Z",
      deadlineAt: "2026-11-23T03:00:00.000Z",
      sourceUrl: DETAIL_URL,
      content: "",
      attachments: [
        { name: "1.제안요청서.pdf", url: docUrl(1) },
        { name: "2.과업지시서.hwp", url: docUrl(2) },
      ],
      structuredQualifications: [],
      original: {
        noticeNo: NOTICE_NO,
        status: "등록공고",
        budget: "1264200000",
        noticeDate: "2026-10-12 06:41:03",
        deadline: "2026-11-23 12:00:00",
      },
      normalizationNotes: ["budgetKrw: asignBdgtAmt 사용"],
      isDemo: false,
      fetchedAt: "2026-10-19T01:00:00.000Z",
    });
  });

  it("평범한 등록공고에는 경고가 없다", () => {
    expect(warningsOf(baseItem())).toEqual([]);
  });

  it("인자 행을 바꾸지 않는다", () => {
    const item = baseItem();
    const before = structuredClone(item);

    normalizeG2bBidNotice(item, CONTEXT);

    expect(item).toEqual(before);
  });
});

describe("normalizeG2bBidNotice — 식별·출처", () => {
  it("source 는 g2b-bid-notice 다", () => {
    expect(draftOf(baseItem()).source).toBe("g2b-bid-notice");
  });

  it("stage 는 NOTICE 다", () => {
    expect(draftOf(baseItem()).stage).toBe("NOTICE");
  });

  it("isDemo 는 false 다", () => {
    expect(draftOf(baseItem()).isDemo).toBe(false);
  });

  it("fetchedAt 은 context.fetchedAt 의 ISO UTC 문자열이다", () => {
    const draft = okOf(
      normalizeG2bBidNotice(baseItem(), { fetchedAt: new Date("2026-10-20T09:30:00.000Z") }),
    ).draft;

    expect(draft.fetchedAt).toBe("2026-10-20T09:30:00.000Z");
  });

  it("noticeId 는 bidNtceNo 의 앞뒤 공백을 뗀 값이다", () => {
    expect(draftOf(baseItem({ bidNtceNo: `  ${NOTICE_NO} ` })).noticeId).toBe(NOTICE_NO);
  });

  it("amendmentNo 는 bidNtceOrd 다", () => {
    expect(draftOf(baseItem({ bidNtceOrd: "001" })).amendmentNo).toBe("001");
  });

  it("bidNtceOrd 가 비면 amendmentNo 키가 없다", () => {
    expect(draftOf(baseItem({ bidNtceOrd: "" }))).not.toHaveProperty("amendmentNo");
  });

  it("title 은 bidNtceNm 을 trim 하고 연속 공백을 하나로 줄인 값이다", () => {
    expect(draftOf(baseItem({ bidNtceNm: "  가상   정보시스템\t유지관리  용역 " })).title).toBe(
      "가상 정보시스템 유지관리 용역",
    );
  });

  it("agency 는 공고기관 ntceInsttNm 이 아니라 수요기관 dminsttNm 이다", () => {
    expect(
      draftOf(baseItem({ ntceInsttNm: "가상공고기관", dminsttNm: "가상수요기관" })).agency,
    ).toBe("가상수요기관");
  });

  it("dminsttNm 이 비면 agency 는 null 이다", () => {
    expect(draftOf(baseItem({ dminsttNm: "" })).agency).toBeNull();
  });

  it("sourceUrl 은 bidNtceDtlUrl 이다", () => {
    expect(draftOf(baseItem()).sourceUrl).toBe(DETAIL_URL);
  });

  it("bidNtceDtlUrl 이 비면 sourceUrl 은 bidNtceUrl 이다", () => {
    expect(draftOf(baseItem({ bidNtceDtlUrl: "" })).sourceUrl).toBe(LIST_URL);
  });

  it("planRef 는 orderPlanUntyNo 다", () => {
    expect(draftOf(baseItem({ orderPlanUntyNo: "R26DD00000001" })).planRef).toBe("R26DD00000001");
  });

  it("orderPlanUntyNo 가 비면 planRef 키가 없다", () => {
    expect(draftOf(baseItem({ orderPlanUntyNo: "" }))).not.toHaveProperty("planRef");
  });

  it("preSpecRef 는 bfSpecRgstNo 다", () => {
    expect(draftOf(baseItem()).preSpecRef).toBe("R26BD00000001");
  });

  it("bfSpecRgstNo 가 비면 preSpecRef 키가 없다", () => {
    expect(draftOf(baseItem({ bfSpecRgstNo: "" }))).not.toHaveProperty("preSpecRef");
  });

  it("content 는 빈 문자열이다(목록 응답에 본문이 없다)", () => {
    expect(draftOf(baseItem()).content).toBe("");
  });

  it("structuredQualifications 는 빈 배열이다(보조 조회는 다음 단계)", () => {
    expect(draftOf(baseItem()).structuredQualifications).toEqual([]);
  });

  it("original.noticeNo 는 bidNtceNo 원문이다", () => {
    expect(draftOf(baseItem()).original.noticeNo).toBe(NOTICE_NO);
  });

  it("original.status 는 ntceKindNm 원문이다", () => {
    expect(draftOf(baseItem({ ntceKindNm: "변경공고" })).original.status).toBe("변경공고");
  });

  it("original 에 stage 를 넣지 않는다", () => {
    expect(draftOf(baseItem()).original).not.toHaveProperty("stage");
  });
});

describe("normalizeG2bBidNotice — 상태(ntceKindNm)", () => {
  it("공고 종류 표는 등록·변경·취소·재공고 네 가지다", () => {
    expect(G2B_NOTICE_KIND_STATUS).toEqual({
      등록공고: "OPEN",
      변경공고: "AMENDED",
      취소공고: "CANCELLED",
      재공고: "OPEN",
    });
  });

  it.each([
    ["등록공고", "OPEN"],
    ["변경공고", "AMENDED"],
    ["취소공고", "CANCELLED"],
    ["재공고", "OPEN"],
  ])("%s 는 status %s 다", (kind, status) => {
    expect(draftOf(baseItem({ ntceKindNm: kind })).status).toBe(status);
  });

  it.each(["", "연기공고", "constructor"])(
    "표 밖 값(%j)은 추측하지 않고 SCHEMA_INVALID 로 격리한다",
    (kind) => {
      expect(issueOf(baseItem({ ntceKindNm: kind }))).toEqual({
        code: "SCHEMA_INVALID",
        sourceKey: SOURCE_KEY,
        detail: "invalid: ntceKindNm",
      });
    },
  );

  it("ntceKindNm 키가 없으면 SCHEMA_INVALID 로 격리한다", () => {
    expect(issueOf(without(baseItem(), "ntceKindNm"))).toEqual({
      code: "SCHEMA_INVALID",
      sourceKey: SOURCE_KEY,
      detail: "invalid: ntceKindNm",
    });
  });
});

describe("normalizeG2bBidNotice — 금액", () => {
  it("asignBdgtAmt 가 있으면 budgetKrw 는 presmptPrce 가 아니라 asignBdgtAmt 다", () => {
    expect(draftOf(baseItem()).budgetKrw).toBe("1264200000");
  });

  it("asignBdgtAmt 를 쓰면 메모 'budgetKrw: asignBdgtAmt 사용' 을 남긴다", () => {
    expect(draftOf(baseItem()).normalizationNotes).toContain("budgetKrw: asignBdgtAmt 사용");
  });

  it("asignBdgtAmt 가 비면 budgetKrw 는 presmptPrce 다", () => {
    expect(draftOf(baseItem({ asignBdgtAmt: "" })).budgetKrw).toBe("1149272727");
  });

  it("presmptPrce 를 쓰면 메모 'budgetKrw: presmptPrce 사용(asignBdgtAmt 없음)' 만 남긴다", () => {
    const notes = draftOf(baseItem({ asignBdgtAmt: "" })).normalizationNotes;

    expect(notes).toEqual(["budgetKrw: presmptPrce 사용(asignBdgtAmt 없음)"]);
  });

  it("presmptPrce 를 쓰면 original.budget 은 presmptPrce 원문이다", () => {
    expect(draftOf(baseItem({ asignBdgtAmt: "" })).original.budget).toBe("1149272727");
  });

  it("두 금액이 모두 비면 budgetKrw 는 null 이다", () => {
    expect(draftOf(baseItem({ asignBdgtAmt: "", presmptPrce: "" })).budgetKrw).toBeNull();
  });

  it("두 금액이 모두 비면 메모가 없어 normalizationNotes 키가 없다", () => {
    expect(draftOf(baseItem({ asignBdgtAmt: "", presmptPrce: "" }))).not.toHaveProperty(
      "normalizationNotes",
    );
  });

  it("두 금액이 모두 비면 original.budget 이 없다", () => {
    expect(draftOf(baseItem({ asignBdgtAmt: "", presmptPrce: "" })).original).not.toHaveProperty(
      "budget",
    );
  });

  it("두 금액이 모두 비어도 경고는 없다", () => {
    expect(warningsOf(baseItem({ asignBdgtAmt: "", presmptPrce: "" }))).toEqual([]);
  });

  it("asignBdgtAmt 를 읽지 못하면 presmptPrce 로 바꾸지 않고 null 이다", () => {
    expect(draftOf(baseItem({ asignBdgtAmt: "미정" })).budgetKrw).toBeNull();
  });

  it("금액을 읽지 못하면 BUDGET_UNPARSED 경고를 낸다", () => {
    expect(warningsOf(baseItem({ asignBdgtAmt: "미정" }))).toEqual([
      { code: "BUDGET_UNPARSED", sourceKey: SOURCE_KEY, detail: "budget unparsed" },
    ]);
  });

  it("금액을 읽지 못해도 original.budget 에 쓴 원문을 남긴다", () => {
    expect(draftOf(baseItem({ asignBdgtAmt: "미정" })).original.budget).toBe("미정");
  });
});

describe("normalizeG2bBidNotice — 날짜", () => {
  it("bidClseDt '2026-11-23 12:00:00'(KST)은 deadlineAt '2026-11-23T03:00:00.000Z' 다", () => {
    expect(draftOf(baseItem({ bidClseDt: "2026-11-23 12:00:00" })).deadlineAt).toBe(
      "2026-11-23T03:00:00.000Z",
    );
  });

  it("bidNtceDt 는 KST 로 읽어 noticeDate UTC 로 바꾼다", () => {
    expect(draftOf(baseItem({ bidNtceDt: "2026-10-12 06:41:03" })).noticeDate).toBe(
      "2026-10-11T21:41:03.000Z",
    );
  });

  it("bidClseDt 가 빈 문자열이면 deadlineAt 은 null 이다", () => {
    expect(draftOf(baseItem({ bidClseDt: "" })).deadlineAt).toBeNull();
  });

  it("bidClseDt 가 빈 문자열이어도 경고는 없다", () => {
    expect(warningsOf(baseItem({ bidClseDt: "" }))).toEqual([]);
  });

  it("bidClseDt 가 빈 문자열이면 original.deadline 이 없다", () => {
    expect(draftOf(baseItem({ bidClseDt: "" })).original).not.toHaveProperty("deadline");
  });

  it("bidNtceDt 가 빈 문자열이면 noticeDate 는 null 이고 경고가 없다", () => {
    const outcome = okOf(normalizeG2bBidNotice(baseItem({ bidNtceDt: "" }), CONTEXT));

    expect([outcome.draft.noticeDate, outcome.warnings]).toEqual([null, []]);
  });

  it("읽을 수 없는 마감은 deadlineAt null 이다", () => {
    expect(draftOf(baseItem({ bidClseDt: "추후 공지" })).deadlineAt).toBeNull();
  });

  it("읽을 수 없는 마감은 DATE_UNPARSED 경고를 낸다", () => {
    expect(warningsOf(baseItem({ bidClseDt: "추후 공지" }))).toEqual([
      { code: "DATE_UNPARSED", sourceKey: SOURCE_KEY, detail: "deadlineAt unparsed" },
    ]);
  });

  it("읽을 수 없는 마감도 original.deadline 에 원문을 남긴다", () => {
    expect(draftOf(baseItem({ bidClseDt: "추후 공지" })).original.deadline).toBe("추후 공지");
  });

  it("시각 없는 마감은 KST 18:00 으로 본다", () => {
    expect(draftOf(baseItem({ bidClseDt: "2026-11-23" })).deadlineAt).toBe(
      "2026-11-23T09:00:00.000Z",
    );
  });

  it("시각 없는 마감은 fixture 와 같은 형식의 메모를 남긴다", () => {
    expect(draftOf(baseItem({ bidClseDt: "2026-11-23" })).normalizationNotes).toContain(
      "deadlineAt: 시각 없는 값(2026-11-23)을 KST 18:00으로 간주",
    );
  });

  it("마감이 공고일보다 이르면 적재하되 DATE_ORDER 경고를 낸다", () => {
    const item = baseItem({ bidNtceDt: "2026-10-12 06:41:03", bidClseDt: "2026-10-01 10:00:00" });

    expect(warningsOf(item)).toEqual([
      { code: "DATE_ORDER", sourceKey: SOURCE_KEY, detail: "deadlineAt before noticeDate" },
    ]);
  });
});

describe("normalizeG2bBidNotice — 첨부", () => {
  it("ntceSpecDocUrl{i}·ntceSpecFileNm{i} 로 { name, url } 첨부를 만든다", () => {
    expect(draftOf(baseItem()).attachments).toEqual([
      { name: "1.제안요청서.pdf", url: docUrl(1) },
      { name: "2.과업지시서.hwp", url: docUrl(2) },
    ]);
  });

  it("첨부에 mimeType·sizeBytes 를 지어내지 않는다", () => {
    for (const attachment of draftOf(baseItem()).attachments) {
      expect(Object.keys(attachment).sort()).toEqual(["name", "url"]);
    }
  });

  it("파일 이름이 비면 '첨부 {i}' 로 부른다", () => {
    const attachments = draftOf(baseItem({ ntceSpecFileNm2: "" })).attachments;

    expect(attachments[1]).toEqual({ name: "첨부 2", url: docUrl(2) });
  });

  it("URL 칸이 비면 파일 이름이 있어도 건너뛴다", () => {
    const attachments = draftOf(baseItem({ ntceSpecFileNm3: "3.남은이름.pdf" })).attachments;

    expect(attachments.map((attachment) => attachment.name)).toEqual([
      "1.제안요청서.pdf",
      "2.과업지시서.hwp",
    ]);
  });

  it("1번부터 10번까지 번호 순서대로 담는다", () => {
    const item = baseItem({ ntceSpecDocUrl10: docUrl(10), ntceSpecFileNm10: "10.별첨.zip" });

    expect(draftOf(item).attachments.map((attachment) => attachment.url)).toEqual([
      docUrl(1),
      docUrl(2),
      docUrl(10),
    ]);
  });

  it("11번 이후 칸은 보지 않는다", () => {
    const item = baseItem({ ntceSpecDocUrl11: docUrl(11), ntceSpecFileNm11: "11.범위밖.pdf" });

    expect(draftOf(item).attachments.map((attachment) => attachment.url)).not.toContain(docUrl(11));
  });

  it("같은 URL 은 한 번만 담는다", () => {
    const item = baseItem({
      ntceSpecDocUrl3: docUrl(1),
      ntceSpecFileNm3: "1.제안요청서(사본).pdf",
    });

    expect(draftOf(item).attachments.map((attachment) => attachment.url)).toEqual([
      docUrl(1),
      docUrl(2),
    ]);
  });

  it("stdNtceDocUrl 은 첨부에 넣지 않는다", () => {
    const urls = draftOf(baseItem({ stdNtceDocUrl: docUrl(99) })).attachments.map(
      (attachment) => attachment.url,
    );

    expect(urls).not.toContain(docUrl(99));
  });

  it("첨부 칸이 모두 비면 빈 배열이다", () => {
    expect(draftOf({ ...baseItem(), ...EMPTY_SPEC_DOCS }).attachments).toEqual([]);
  });
});

describe("normalizeG2bBidNotice — 필수 누락·격리", () => {
  it("bidNtceNo 가 없으면 MISSING_REQUIRED_FIELD 로 격리하고 sourceKey 는 unknown 이다", () => {
    expect(issueOf(without(baseItem(), "bidNtceNo"))).toEqual({
      code: "MISSING_REQUIRED_FIELD",
      sourceKey: "g2b-bid-notice:unknown",
      detail: "missing: noticeId",
    });
  });

  it("bidNtceNm 이 빈 문자열이면 MISSING_REQUIRED_FIELD(title)로 격리한다", () => {
    expect(issueOf(baseItem({ bidNtceNm: "" }))).toEqual({
      code: "MISSING_REQUIRED_FIELD",
      sourceKey: SOURCE_KEY,
      detail: "missing: title",
    });
  });

  it("bidNtceDtlUrl·bidNtceUrl 이 모두 비면 MISSING_REQUIRED_FIELD(sourceUrl)로 격리한다", () => {
    expect(issueOf(baseItem({ bidNtceDtlUrl: "", bidNtceUrl: "" }))).toEqual({
      code: "MISSING_REQUIRED_FIELD",
      sourceKey: SOURCE_KEY,
      detail: "missing: sourceUrl",
    });
  });

  it("여럿이 빠지면 REQUIRED_FIELDS 순서로 모두 적는다", () => {
    expect(issueOf(baseItem({ bidNtceNm: "", bidNtceDtlUrl: "", bidNtceUrl: "" })).detail).toBe(
      "missing: title, sourceUrl",
    );
  });

  it("sourceUrl 이 http(s) 절대 URL 이 아니면 SCHEMA_INVALID 로 격리한다", () => {
    const issue = issueOf(
      baseItem({ bidNtceDtlUrl: "/link/relative", bidNtceUrl: "/link/relative" }),
    );

    expect([issue.code, issue.sourceKey]).toEqual(["SCHEMA_INVALID", SOURCE_KEY]);
  });

  it("격리 detail 에 원문 값을 넣지 않는다", () => {
    const issue = issueOf(
      baseItem({ bidNtceDtlUrl: "/link/relative", bidNtceUrl: "/link/relative" }),
    );

    expect(issue.detail).not.toContain("/link/relative");
  });
});

describe("normalizeG2bBidNotice — 담당자 필드", () => {
  it.each([
    ["평범한 행", baseItem()],
    ["경고가 있는 행", baseItem({ asignBdgtAmt: "미정", bidClseDt: "추후 공지" })],
    ["격리되는 행", baseItem({ bidNtceNm: "" })],
  ])("결과 어디에도 담당자 필드 값이 없다: %s", (_label, item) => {
    const json = JSON.stringify(normalizeG2bBidNotice(item, CONTEXT));

    for (const value of Object.values(CONTACT)) {
      expect(json).not.toContain(String(value));
    }
  });

  it("결과 어디에도 담당자 필드 이름이 없다", () => {
    const json = JSON.stringify(normalizeG2bBidNotice(baseItem(), CONTEXT));

    for (const key of Object.keys(CONTACT)) {
      expect(json).not.toContain(`"${key}"`);
    }
  });
});

describe("normalizeG2bBidNotice — 스키마", () => {
  it("finalizeRevision(draft, 1) 은 normalizedBidSchema 를 통과한다", () => {
    const bid = finalizeRevision(draftOf(baseItem()), 1);

    expect(normalizedBidSchema.safeParse(bid).error).toBeUndefined();
  });

  it("선택 값이 모두 빈 행도 finalizeRevision 뒤 normalizedBidSchema 를 통과한다", () => {
    const item = baseItem({
      ...EMPTY_SPEC_DOCS,
      bidNtceOrd: "",
      dminsttNm: "",
      asignBdgtAmt: "",
      presmptPrce: "",
      bidNtceDt: "",
      bidClseDt: "",
      orderPlanUntyNo: "",
      bfSpecRgstNo: "",
    });

    expect(normalizedBidSchema.safeParse(finalizeRevision(draftOf(item), 1)).error).toBeUndefined();
  });

  it("취소공고도 finalizeRevision 뒤 normalizedBidSchema 를 통과한다", () => {
    const bid = finalizeRevision(draftOf(baseItem({ ntceKindNm: "취소공고" })), 2);

    expect(normalizedBidSchema.safeParse(bid).error).toBeUndefined();
  });
});

describe("sortStructuredRequirements", () => {
  const requirement = (
    kind: StructuredRequirement["kind"],
    code: string,
  ): StructuredRequirement => ({
    kind,
    code,
    name: null,
    value: { code },
    sourceOperation: "getBidPblancListInfoLicenseLimit",
  });

  it("kind 를 LICENSE_LIMIT → PERMITTED_INDUSTRY → PARTICIPATION_REGION → REGIONAL_JOINT_CONTRACT 순서로 놓는다", () => {
    const sorted = sortStructuredRequirements([
      requirement("REGIONAL_JOINT_CONTRACT", "j1"),
      requirement("PARTICIPATION_REGION", "r1"),
      requirement("PERMITTED_INDUSTRY", "i1"),
      requirement("LICENSE_LIMIT", "l1"),
    ]);

    expect(sorted.map((item) => item.kind)).toEqual([
      "LICENSE_LIMIT",
      "PERMITTED_INDUSTRY",
      "PARTICIPATION_REGION",
      "REGIONAL_JOINT_CONTRACT",
    ]);
  });

  it("같은 kind 는 원래 순서를 지킨다", () => {
    const sorted = sortStructuredRequirements([
      requirement("PARTICIPATION_REGION", "r1"),
      requirement("LICENSE_LIMIT", "l3"),
      requirement("LICENSE_LIMIT", "l1"),
      requirement("PARTICIPATION_REGION", "r0"),
      requirement("LICENSE_LIMIT", "l2"),
    ]);

    expect(sorted.map((item) => item.code)).toEqual(["l3", "l1", "l2", "r1", "r0"]);
  });

  it("인자 배열을 바꾸지 않는다", () => {
    const input = [requirement("PARTICIPATION_REGION", "r1"), requirement("LICENSE_LIMIT", "l1")];
    const before = structuredClone(input);

    sortStructuredRequirements(input);

    expect(input).toEqual(before);
  });

  it("인자와 다른 새 배열을 돌려준다", () => {
    const input = [requirement("LICENSE_LIMIT", "l1")];

    expect(sortStructuredRequirements(input)).not.toBe(input);
  });

  it("빈 목록은 빈 목록이다", () => {
    expect(sortStructuredRequirements([])).toEqual([]);
  });
});
