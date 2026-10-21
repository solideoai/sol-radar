import { describe, expect, it } from "vitest";
import {
  createExternalApiConnector,
  createExternalSourceConnector,
} from "./external-api-connector";
import { normalizeExternalNotice } from "./external-normalize";
import { splitKepcoWindow } from "./external-request";
import { parseExternalPayload } from "./external-payload";

const fetchedAt = new Date("2026-10-21T03:00:00.000Z");
const secret = "fake-kepco-key-".padEnd(40, "x");
const kepcoItem = {
  CompanyID: "COM01",
  No: "00001",
  Name: "AI 데이터 분석 용역",
  NoticeDate: "2026-10-20",
  ProgressState: "AttendProgress",
  BidAttendReqCloseDatetime: "2026-10-20 18:00:00",
  BeginDatetime: "2026-10-21 09:00:00",
  EndDatetime: "2026-10-22 18:00:00",
  PresumedPrice: "9007199254740993",
  PresumedAmount: "-",
  EstimatedPriceBasicAmount: "10000000000000000",
  Filename1: "제안요청서.hwp",
  Filenlink1: "http://bid.kepco.co.kr/file/1",
};

describe("external adapters", () => {
  it("preserves company identity, amount kinds and separate application/bidding deadlines", () => {
    const result = normalizeExternalNotice("kepco-ebid-contract", kepcoItem, { fetchedAt });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toMatchObject({
      schemaVersion: "normalized-bid/v0.3",
      noticeId: "COM01:00001",
      budgetKrw: null,
      deadlineAt: "2026-10-22T09:00:00.000Z",
      status: "OPEN",
      attachments: [],
      sourceMetadata: {
        sourceFamily: "KEPCO",
        providerCompanyId: "COM01",
        providerRecordKey: "00001",
        applicationDeadlineAt: "2026-10-20T09:00:00.000Z",
        participationStatus: "UNKNOWN",
        amounts: [
          { kind: "presumedPrice", raw: "9007199254740993", amountKrw: null },
          { kind: "estimatedPriceBasicAmount", raw: "10000000000000000", amountKrw: null },
        ],
      },
    });
    expect(result.warnings.map(({ code }) => code)).toContain("ATTACHMENT_URL_BLOCKED");
    const other = normalizeExternalNotice(
      "kepco-ebid-contract",
      { ...kepcoItem, CompanyID: "COM02" },
      { fetchedAt },
    );
    expect(other.ok && other.draft.noticeId).toBe("COM02:00001");
  });

  it("quarantines conflicting aliases and missing early-stage identity", () => {
    const conflicted = normalizeExternalNotice(
      "kepco-ebid-contract",
      { ...kepcoItem, no: "00002" },
      { fetchedAt },
    );
    expect(conflicted).toMatchObject({
      ok: false,
      issue: { code: "SCHEMA_INVALID", detail: expect.stringContaining("CONFLICTED") },
    });
    expect(
      normalizeExternalNotice(
        "lh-pre-specification",
        { inadvcStddztNm: "AI 사업", assignBudgetAmt: "100" },
        { fetchedAt },
      ),
    ).toMatchObject({ ok: false, issue: { detail: expect.stringContaining("NOT_VERIFIED") } });
    expect(
      normalizeExternalNotice(
        "kwater-procurement-plan",
        { tndrPblancNm: "AI 사업", cntrwkam: "3" },
        { fetchedAt },
      ),
    ).toMatchObject({ ok: false, issue: { detail: expect.stringContaining("NOT_VERIFIED") } });
  });

  it("splits KEPCO inclusive KST days without overlap at month and 90-day boundaries", () => {
    expect(splitKepcoWindow("2026-01-01", "2026-04-01")).toEqual([
      { from: "20260101", to: "20260331" },
      { from: "20260401", to: "20260401" },
    ]);
    expect(splitKepcoWindow("2026-01-31", "2026-01-31")).toEqual([
      { from: "20260131", to: "20260131" },
    ]);
  });

  it("parses XML single items without coercing identifiers and rejects external entity/depth attacks", () => {
    const xml =
      "<response><header><resultCode>00</resultCode></header><body><item><bidNum>00017</bidNum><presmtPrc>9007199254740993</presmtPrc></item><totalCount>1</totalCount></body></response>";
    expect(
      parseExternalPayload('{"data":[{"no":"00017","presumedPrice":9007199254740993}]}'),
    ).toMatchObject({ ok: true, items: [{ no: "00017", presumedPrice: "9007199254740993" }] });
    expect(parseExternalPayload(xml)).toMatchObject({
      ok: true,
      items: [{ bidNum: "00017", presmtPrc: "9007199254740993" }],
      totalCount: 1,
    });
    expect(
      parseExternalPayload(
        '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><response>&x;</response>',
      ),
    ).toMatchObject({ ok: false });
    expect(parseExternalPayload("<a>".repeat(40) + "x" + "</a>".repeat(40))).toMatchObject({
      ok: false,
    });
  });

  it("uses only verified LH parameters and strips credentials/contact data before yielding evidence", async () => {
    const requests: URL[] = [];
    const connector = createExternalApiConnector({
      sourceKey: "lh-bid-notice",
      serviceKey: "fake+gateway/key==",
      fetch: async (url) => {
        requests.push(new URL(url));
        return new Response(
          "<response><header><resultCode>00</resultCode></header><body><item><bidNum>00017</bidNum><chpsnEmail>private@example.test</chpsnEmail><apiKey>echo</apiKey></item><totalCount>1</totalCount></body></response>",
          { headers: { "content-type": "application/xml" } },
        );
      },
    });
    const result = await connector.fetchPage({
      from: "2026-10-20T15:00:00.000Z",
      to: "2026-10-21T14:59:59.000Z",
      cursor: null,
    });
    expect(requests[0].searchParams.get("tndrbidRegDtStart")).toBe("20261021");
    expect(requests[0].searchParams.has("type")).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      page: { items: [{ bidNum: "00017" }], completeness: "COMPLETE" },
    });
    expect(JSON.stringify(result)).not.toContain("private@example.test");
    expect(JSON.stringify(result)).not.toContain("echo");
  });

  it("fails closed before requests when operation inputs are unverified", async () => {
    let calls = 0;
    const connector = createExternalApiConnector({
      sourceKey: "g2b-procurement-request",
      serviceKey: "fake-key",
      fetch: async () => {
        calls++;
        return new Response("{}");
      },
    });
    expect(
      await connector.fetchPage({
        from: "2026-10-20T00:00:00.000Z",
        to: "2026-10-21T00:00:00.000Z",
        cursor: null,
      }),
    ).toMatchObject({ ok: false, failure: { kind: "NOT_VERIFIED" } });
    expect(calls).toBe(0);
  });

  it("does not invent KEPCO pagination or complete an unverified response", async () => {
    const requests: URL[] = [];
    const connector = createExternalApiConnector({
      sourceKey: "kepco-ebid-contract",
      serviceKey: secret,
      companyId: "COM01",
      fetch: async (url) => {
        requests.push(new URL(url));
        return new Response(JSON.stringify({ data: [kepcoItem], apiKey: secret }));
      },
    });
    const result = await connector.fetchPage({
      from: "2026-10-20T15:00:00.000Z",
      to: "2026-10-21T14:59:59.000Z",
      cursor: null,
    });
    expect(requests[0].searchParams.get("noticeBeginDate")).toBe("20261021");
    expect(requests[0].searchParams.has("pageNo")).toBe(false);
    expect(result).toMatchObject({ ok: true, page: { completeness: "PARTIAL", nextCursor: null } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("keeps incomplete provider pages partial without skipping omitted rows", async () => {
    const connector = createExternalApiConnector({
      sourceKey: "lh-bid-notice",
      serviceKey: "fake-key",
      fetch: async () =>
        new Response(
          '{"response":{"header":{"resultCode":"00"},"body":{"items":[{"bidNum":"00001"}],"totalCount":200}}}',
        ),
    });
    expect(
      await connector.fetchPage({
        from: "2026-10-20T00:00:00.000Z",
        to: "2026-10-21T00:00:00.000Z",
        cursor: null,
      }),
    ).toMatchObject({ ok: true, page: { completeness: "PARTIAL", nextCursor: null } });
  });

  it("keeps failed/opened/ended notices closed without asserting cancellation or award", () => {
    const failed = normalizeExternalNotice(
      "kepco-ebid-contract",
      { ...kepcoItem, ProgressState: "Fail" },
      { fetchedAt },
    );
    const opened = normalizeExternalNotice(
      "kepco-ebid-contract",
      { ...kepcoItem, ProgressState: "OpenTimed" },
      { fetchedAt },
    );
    const final = normalizeExternalNotice(
      "kepco-ebid-contract",
      { ...kepcoItem, ProgressState: "Final" },
      { fetchedAt },
    );
    expect(failed).toMatchObject({
      ok: true,
      draft: { stage: "NOTICE", status: "CLOSED", sourceMetadata: { providerEvent: "FAILED" } },
    });
    expect(opened).toMatchObject({
      ok: true,
      draft: { stage: "NOTICE", status: "CLOSED", sourceMetadata: { providerEvent: "OPENED" } },
    });
    expect(final).toMatchObject({
      ok: true,
      draft: { stage: "NOTICE", status: "CLOSED", sourceMetadata: { providerEvent: "ENDED" } },
    });
  });

  it("uses verified operation-specific date bases without a shared guessed query", async () => {
    const requests: URL[] = [];
    const fetch = async (url: string) => {
      requests.push(new URL(url));
      return new Response(
        '{"response":{"header":{"resultCode":"00"},"body":{"items":"","totalCount":0}}}',
      );
    };
    const window = {
      from: "2026-10-20T15:00:00.000Z",
      to: "2026-10-21T14:59:59.000Z",
      cursor: null,
    };
    await createExternalApiConnector({
      sourceKey: "kwater-bid-notice",
      operation: "dmscptList",
      serviceKey: "fake-key",
      fetch,
    }).fetchPage(window);
    await createExternalApiConnector({
      sourceKey: "kwater-procurement-plan",
      operation: "gds",
      serviceKey: "fake-key",
      fetch,
    }).fetchPage(window);
    await createExternalApiConnector({
      sourceKey: "lh-pre-specification",
      serviceKey: "fake-key",
      fetch,
    }).fetchPage(window);
    await createExternalApiConnector({
      sourceKey: "g2b-procurement-request",
      operation: "getPrcrmntReqInfoListThngDetail",
      requestId: "000123",
      serviceKey: "fake-key",
      fetch,
    }).fetchPage(window);
    expect(requests.map((url) => url.pathname)).toEqual([
      "/B500001/ebid/tndr3/dmscptList",
      "/B500001/ebid/ordg2/gds",
      "/B552555/OpenAdvcinfoReqList/getOpenAdvcinfoReqList",
      "/1230000/ao/PrcrmntReqInfoService/getPrcrmntReqInfoListThngDetail",
    ]);
    expect(requests[0].searchParams.get("searchDt")).toBe("202610");
    expect(requests[1].searchParams.get("_type")).toBe("json");
    expect(requests[2].searchParams.get("opinionRegEndDtmStart")).toBe("20261021");
    expect(requests[2].searchParams.has("tndrbidRegDtStart")).toBe(false);
    expect(requests[3].searchParams.get("prcrmntReqNo")).toBe("000123");
  });
  it("keeps identical empty responses for distinct month windows as separate captures", async () => {
    const connector = createExternalSourceConnector({
      sourceKey: "kwater-procurement-plan",
      operation: "gds",
      serviceKey: "fake-key",
      fetch: async () =>
        new Response(
          '{"response":{"header":{"resultCode":"00"},"body":{"items":"","totalCount":0}}}',
        ),
    });
    const input = {
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
      cursor: null,
    };
    const first = await connector.fetchPage(input);
    expect(first).toMatchObject({ ok: true, page: { nextCursor: "1:1" } });
    const second = await connector.fetchPage({ ...input, cursor: "1:1" });
    expect(first.ok && first.page.capture?.partitionKey).not.toBe(
      second.ok && second.page.capture?.partitionKey,
    );
  });
});
