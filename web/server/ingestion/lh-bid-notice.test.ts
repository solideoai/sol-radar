import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BidSourceConnector } from "./connector.model";
import { createExternalSourceConnector } from "./external-api-connector";
import { normalizeExternalNotice } from "./external-normalize";
import { parseExternalPayload } from "./external-payload";
import { createMemoryIngestionRepo } from "./ingestion.repo.memory";
import { runIngest } from "./ingestion.service";
import { createMemoryQuotaStore } from "./quota-store";

// LH 입찰공고(15159012). 응답은 fixtures/synthetic/15159012 의 합성(SYNTHETIC) 파일이다. 실응답 녹음이 아니다.
// 실응답 녹음(fixtures/recorded/15159012)은 아래 "LH 실응답 녹음 재생" 한 곳에서만 읽는다.
const synthetic = (name: string): string =>
  readFileSync(
    new URL(`../../../fixtures/synthetic/15159012/${name}.synthetic.xml`, import.meta.url),
    "utf8",
  );
const fetchedAt = new Date("2026-10-27T03:00:00.000Z");
const now = () => fetchedAt;
const retry = { sleep: async () => undefined, random: () => 0 };
const window = { from: "2026-10-20T15:00:00.000Z", to: "2026-10-21T14:59:00.000Z" };
const xml = (body: string, init?: ResponseInit) =>
  new Response(body, { headers: { "content-type": "application/xml" }, ...init });

/** pageNo 마다 응답을 고른다. 부른 URL 을 모두 남긴다 */
function lhConnector(pages: (page: number) => Response, numOfRows = 2) {
  const requests: URL[] = [];
  const connector = createExternalSourceConnector({
    sourceKey: "lh-bid-notice",
    serviceKey: "synthetic-lh-key",
    numOfRows,
    fetch: async (url) => {
      const request = new URL(url);
      requests.push(request);
      return pages(Number(request.searchParams.get("pageNo")));
    },
  });
  return { connector, requests };
}
const lhRun = (
  jobKey: string,
  trigger: "SCHEDULED" | "MANUAL" = "SCHEDULED",
  runWindow: { from: string; to: string } = window,
) => ({
  source: "lh" as const,
  serviceKey: "lh-bid-notice",
  operation: "getOpenBidInfo",
  partitionKey: "all",
  runMode: "LIVE" as const,
  trigger,
  batch: null,
  params: { window: runWindow },
  jobKey,
});
const itemsOf = (name: string) => {
  const parsed = parseExternalPayload(synthetic(name));
  if (!parsed.ok) throw new Error(`synthetic ${name} must parse`);
  return parsed.items;
};
// 2026-10-27 첫 실호출 응답의 모양(값은 합성): EUC-KR 선언, <items> 없이 <item>, CDATA 공고명, 값 뒤 공백,
// YYYY/MM/DD HH:mm 일시, 추정가격 + 부가세 = 설계가격(원)
const recordedShape = `<?xml version="1.0" encoding="EUC-KR"?>
<response>
  <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE</resultMsg></header>
  <body>
    <item>
      <bidNum>2026100001</bidNum>
      <bidDegree>00</bidDegree>
      <bidKind>일반공고 </bidKind>
      <bidnmKor><![CDATA[(합성)정보화 유지관리 용역]]> </bidnmKor>
      <zoneHqCd>서울지역본부 </zoneHqCd>
      <tndrbidRegDt>20261026 </tndrbidRegDt>
      <presmtPrc>607100000 </presmtPrc>
      <addtTax>60710000 </addtTax>
      <designPrc>667810000 </designPrc>
      <fdmtlAmt>667810000 </fdmtlAmt>
      <cooperdocAcptEndDtm>  </cooperdocAcptEndDtm>
      <tndrdocAcptBgninDtm>2026/10/28 10:00 </tndrdocAcptBgninDtm>
      <tndrdocAcptEndDtm>2026/11/02 16:00 </tndrdocAcptEndDtm>
      <openDtm>2026/11/02 17:00 </openDtm>
    </item>
    <numOfRows>10</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>1</totalCount>
  </body>
</response>`;
const recordedShapeItem = () => {
  const parsed = parseExternalPayload(recordedShape);
  if (!parsed.ok) throw new Error("recorded shape must parse");
  return parsed.items[0];
};
// Node 에는 EUC-KR 인코더가 없어 디코더(CP949 범위) 표를 거꾸로 찾는다
const eucKr = (text: string): Uint8Array<ArrayBuffer> => {
  const decoder = new TextDecoder("euc-kr");
  const table = new Map<string, number[]>();
  for (let lead = 0x81; lead <= 0xfe; lead++)
    for (let trail = 0x41; trail <= 0xfe; trail++)
      table.set(decoder.decode(new Uint8Array([lead, trail])), [lead, trail]);
  return new Uint8Array(
    [...text].flatMap((char) => {
      const bytes = char.charCodeAt(0) < 0x80 ? [char.charCodeAt(0)] : table.get(char);
      if (bytes === undefined) throw new Error(`no EUC-KR bytes: ${char}`);
      return bytes;
    }),
  );
};

describe("LH 입찰공고 정규화", () => {
  it("명세 필드를 공고번호·공고명·발주기관·공고일·마감일·예산·URL 로 옮긴다", () => {
    const [item] = itemsOf("getOpenBidInfo.page1");
    const result = normalizeExternalNotice("lh-bid-notice", item, { fetchedAt });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toMatchObject({
      schemaVersion: "normalized-bid/v0.3",
      source: "lh-bid-notice",
      noticeId: "2026100001",
      amendmentNo: "0",
      stage: "NOTICE",
      status: "OPEN",
      title: "합성 데이터 정보화 유지관리 용역",
      agency: "한국토지주택공사",
      budgetKrw: "150000000",
      // 20261021(날짜만)은 KST 18:00 으로 둔다(공용 날짜 규칙)
      noticeDate: "2026-10-21T09:00:00.000Z",
      // 202611031000 KST = 01:00Z
      deadlineAt: "2026-11-03T01:00:00.000Z",
      sourceUrl: "https://www.data.go.kr/data/15159012/openapi.do",
      attachments: [],
      isDemo: false,
      sourceMetadata: {
        sourceFamily: "LH",
        serviceId: "15159012",
        operation: "getOpenBidInfo",
        providerRecordKey: "2026100001:0",
        providerStatus: "공고중",
        sourceUrlKind: "SERVICE_DOCUMENTATION",
        agencyCodeNamespace: "LH_ZONE_HQ",
        agencyCode: "서울지역본부",
        biddingStartsAt: "2026-10-28T00:00:00.000Z",
        biddingEndsAt: "2026-11-03T01:00:00.000Z",
        participationStatus: "NOT_STARTED",
        attributes: { zoneRstrct1: "서울특별시", req1Reqlic1Nm: "소프트웨어사업자" },
      },
    });
    expect(result.draft.content).toContain("업종1 요구면허: 소프트웨어사업자");
    expect(result.draft.sourceMetadata?.amounts.map(({ kind }) => kind)).toEqual([
      "presmtPrc",
      "addtTax",
      "fdmtlAmt",
    ]);
    // 담당자 연락처는 정규화 결과에 남지 않는다
    expect(JSON.stringify(result.draft)).not.toContain("synthetic-contact@example.test");
  });

  it("실응답의 YYYY/MM/DD HH:mm 일시를 KST 로 읽어 마감·입찰 시작을 채운다", () => {
    const result = normalizeExternalNotice("lh-bid-notice", recordedShapeItem(), { fetchedAt });
    expect(result).toMatchObject({
      ok: true,
      draft: {
        noticeId: "2026100001",
        amendmentNo: "00",
        title: "(합성)정보화 유지관리 용역",
        noticeDate: "2026-10-26T09:00:00.000Z",
        // 2026/11/02 16:00 KST = 07:00Z
        deadlineAt: "2026-11-02T07:00:00.000Z",
        sourceMetadata: {
          biddingStartsAt: "2026-10-28T01:00:00.000Z",
          biddingEndsAt: "2026-11-02T07:00:00.000Z",
          dates: {
            openDtm: {
              raw: "2026/11/02 17:00",
              precision: "MINUTE",
              utc: "2026-11-02T08:00:00.000Z",
            },
          },
        },
      },
    });
    expect(result.ok && result.draft.sourceMetadata?.dates.cooperdocAcptEndDtm).toBeUndefined();
  });

  it("금액은 원 단위로 남기고 추정가격은 부가세 별도, 설계·기초금액은 부가세 포함으로 적는다", () => {
    const result = normalizeExternalNotice("lh-bid-notice", recordedShapeItem(), { fetchedAt });
    const krw = (kind: string, raw: string, vat: "INCLUDED" | "EXCLUDED" | "UNVERIFIED") => ({
      kind,
      raw,
      amountKrw: raw,
      currency: "KRW",
      unit: "KRW",
      vat,
    });
    expect(result.ok && result.draft.budgetKrw).toBe("607100000");
    expect(result.ok && result.draft.sourceMetadata?.amounts).toEqual([
      krw("presmtPrc", "607100000", "EXCLUDED"),
      krw("addtTax", "60710000", "UNVERIFIED"),
      krw("designPrc", "667810000", "INCLUDED"),
      krw("fdmtlAmt", "667810000", "INCLUDED"),
    ]);
  });

  it("14자리 일시와 정정·취소 공고를 읽고, 모르는 상태 값은 OPEN 으로 두되 메모를 남긴다", () => {
    const [page2] = itemsOf("getOpenBidInfo.page2");
    const seconds = normalizeExternalNotice("lh-bid-notice", page2, { fetchedAt });
    expect(seconds.ok && seconds.draft.deadlineAt).toBe("2026-11-05T01:00:00.000Z");
    const [amended] = itemsOf("getOpenBidInfo.amended");
    expect(normalizeExternalNotice("lh-bid-notice", amended, { fetchedAt })).toMatchObject({
      ok: true,
      draft: { status: "AMENDED", amendmentNo: "1" },
    });
    const [cancelled] = itemsOf("getOpenBidInfo.cancelled");
    expect(normalizeExternalNotice("lh-bid-notice", cancelled, { fetchedAt })).toMatchObject({
      ok: true,
      draft: { status: "CANCELLED", sourceMetadata: { participationStatus: "ENDED" } },
    });
    const unknown = normalizeExternalNotice(
      "lh-bid-notice",
      {
        bidNum: "2026100009",
        bidDegree: "0",
        bidnmKor: "합성 공고",
        bidProgrsStatus: "X99",
        tndrdocAcptEndDtm: "20261105",
      },
      { fetchedAt },
    );
    expect(unknown).toMatchObject({ ok: true, draft: { status: "OPEN", deadlineAt: null } });
    expect(unknown.ok && unknown.draft.normalizationNotes).toEqual(
      expect.arrayContaining([
        "status: 공급자 상태 값을 읽지 못해 OPEN 으로 두었다.",
        "deadlineAt: 마감이 날짜만 있고 시각이 없어 비웠다(원문은 sourceMetadata.dates).",
      ]),
    );
  });

  it("공고번호·공고명·차수가 없거나, 같은 칸이 다른 값으로 두 번 오거나, 번호에 공백이 있거나, 차수가 숫자가 아니면 격리한다", () => {
    const [missingTitle] = itemsOf("getOpenBidInfo.missing-fields");
    expect(normalizeExternalNotice("lh-bid-notice", missingTitle, { fetchedAt })).toMatchObject({
      ok: false,
      issue: {
        code: "MISSING_REQUIRED_FIELD",
        sourceKey: "lh-bid-notice:2026100004",
        detail: "missing: title",
      },
    });
    expect(
      normalizeExternalNotice("lh-bid-notice", { bidnmKor: "번호 없음" }, { fetchedAt }),
    ).toMatchObject({ ok: false, issue: { code: "MISSING_REQUIRED_FIELD" } });
    expect(
      normalizeExternalNotice(
        "lh-bid-notice",
        { bidNum: "1", BIDNUM: "2", bidnmKor: "충돌" },
        { fetchedAt },
      ),
    ).toMatchObject({ ok: false, issue: { detail: "CONFLICTED_ALIAS: bidNum" } });
    expect(
      normalizeExternalNotice("lh-bid-notice", { bidNum: "1 2", bidnmKor: "공백" }, { fetchedAt }),
    ).toMatchObject({ ok: false, issue: { code: "SCHEMA_INVALID", detail: "invalid: noticeId" } });
    // 차수가 없으면 늦게 온 옛 사본을 STALE 로 막을 수 없다
    expect(
      normalizeExternalNotice(
        "lh-bid-notice",
        { bidNum: "9", bidnmKor: "차수 없음" },
        { fetchedAt },
      ),
    ).toMatchObject({
      ok: false,
      issue: {
        code: "MISSING_REQUIRED_FIELD",
        sourceKey: "lh-bid-notice:9",
        detail: "missing: amendmentNo",
      },
    });
    expect(
      normalizeExternalNotice(
        "lh-bid-notice",
        { bidNum: "9", bidDegree: "1차", bidnmKor: "차수 글자" },
        { fetchedAt },
      ),
    ).toMatchObject({
      ok: false,
      issue: { code: "SCHEMA_INVALID", detail: "invalid: amendmentNo" },
    });
  });
});

// 2026-10-27 15:47 KST 실호출 녹음(가린 실응답, 등록일 2026-10-26·1쪽·10행). 값을 고치거나 지어 넣지 않는다.
const recording = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/recorded/15159012/getOpenBidInfo.20261026.p1.masked.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { contentType: string; fetchedAt: string; maskedBody: string };

describe("LH 실응답 녹음 재생", () => {
  it("10건 모두 격리·경고 없이 정규화하고 공고번호·차수·공고명·공고일·마감·추정가격을 원문대로 옮긴다", () => {
    // 한글이 깨진 녹음(U+FFFD)은 fixture 로 쓰지 않는다
    expect(recording.contentType).toBe("text/xml;charset=EUC-KR");
    expect(recording.maskedBody).not.toContain("�");
    const parsed = parseExternalPayload(recording.maskedBody);
    if (!parsed.ok) throw new Error("recorded LH page must parse");
    expect(parsed.totalCount).toBe(12);
    const results = parsed.items.map((item) =>
      normalizeExternalNotice("lh-bid-notice", item, { fetchedAt: new Date(recording.fetchedAt) }),
    );
    const drafts = results.flatMap((result) => (result.ok ? [result] : []));
    expect(drafts).toHaveLength(10);
    expect(drafts.flatMap(({ warnings }) => warnings)).toEqual([]);
    // 상태를 못 읽었거나 마감 시각이 없다는 메모가 한 건도 없다
    expect(
      drafts
        .flatMap(({ draft }) => draft.normalizationNotes ?? [])
        .filter((note) => /^(status|deadlineAt):/.test(note)),
    ).toEqual([]);
    expect(
      drafts.map(({ draft }) => `${draft.noticeId}:${draft.amendmentNo}:${draft.status}`),
    ).toEqual([
      "2603833:00:OPEN",
      "2603815:00:OPEN",
      "2603802:00:OPEN",
      "2603800:00:OPEN",
      "2603792:00:OPEN",
      "2603789:00:OPEN",
      "2603787:01:AMENDED",
      "2603774:00:OPEN",
      "2603750:00:OPEN",
      "2603734:00:OPEN",
    ]);
    expect(drafts.every(({ draft }) => draft.deadlineAt !== null && draft.budgetKrw !== null)).toBe(
      true,
    );
    expect(drafts[0].draft).toMatchObject({
      title: "(자활용사촌)양주회천 택지개발사업 조성공사(2단계) 디자인형울타리 제작 및 설치",
      agency: "한국토지주택공사",
      // 20261026(날짜만)은 KST 18:00, 2026/11/02 16:00 KST = 07:00Z
      noticeDate: "2026-10-26T09:00:00.000Z",
      deadlineAt: "2026-11-02T07:00:00.000Z",
      budgetKrw: "607100000",
      sourceMetadata: {
        providerRecordKey: "2603833:00",
        providerStatus: "입찰진행중",
        agencyCode: "경기북부지역본부",
        biddingStartsAt: "2026-10-28T01:00:00.000Z",
      },
    });
  });
});

describe("LH 입찰공고 수집", () => {
  it("여러 쪽을 cursor 로 이어 받고, 같은 공고번호는 다시 저장하지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const { connector, requests } = lhConnector((page) =>
      xml(synthetic(page === 1 ? "getOpenBidInfo.page1" : "getOpenBidInfo.page2")),
    );
    const first = await runIngest({ repo, connector, run: lhRun("lh-pages"), now, retry });
    expect(first).toMatchObject({ status: "SUCCEEDED", summary: { created: 3 } });
    expect(requests.map((url) => url.searchParams.get("pageNo"))).toEqual(["1", "2"]);
    expect(requests[0].searchParams.get("tndrbidRegDtStart")).toBe("20261021");
    expect(requests[0].searchParams.get("tndrbidRegDtEnd")).toBe("20261021");
    expect(repo.state.runs.get("lh-pages")).toMatchObject({ completeness: "COMPLETE" });

    const again = await runIngest({ repo, connector, run: lhRun("lh-pages-2"), now, retry });
    expect(again).toMatchObject({
      status: "SUCCEEDED",
      summary: { created: 0, changed: 0, skippedDuplicate: 3 },
    });
    expect(repo.state.revisions).toHaveLength(3);
  });

  it("EUC-KR 응답(Content-Type charset)을 한글 그대로 읽어 저장한다", async () => {
    const repo = createMemoryIngestionRepo();
    const { connector } = lhConnector(
      () =>
        new Response(eucKr(recordedShape), {
          headers: { "content-type": "text/xml;charset=EUC-KR" },
        }),
      10,
    );
    const result = await runIngest({ repo, connector, run: lhRun("lh-euc-kr"), now, retry });
    expect(result).toMatchObject({ status: "SUCCEEDED", summary: { created: 1 } });
    expect(repo.state.bids.get("lh-bid-notice:2026100001")?.normalized).toMatchObject({
      title: "(합성)정보화 유지관리 용역",
      sourceMetadata: { agencyCode: "서울지역본부", attributes: { bidKind: "일반공고" } },
    });
  });

  it("정정 차수는 변경으로, 취소는 취소로 세고, 늦게 온 낮은 차수는 덮어쓰지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    // 1쪽 합성 응답(2건)을 한 쪽짜리로 쓴다. 정정·취소 응답은 2026100001 한 건이다.
    const firstPage = synthetic("getOpenBidInfo.page1").replace("<totalCount>3", "<totalCount>2");
    let name = "getOpenBidInfo.amended";
    const base = lhConnector(() => xml(firstPage), 10).connector;
    const { connector } = lhConnector(() => xml(synthetic(name)), 10);
    expect(
      (await runIngest({ repo, connector: base, run: lhRun("lh-v0"), now, retry })).summary,
    ).toMatchObject({ created: 2 });
    expect(
      (await runIngest({ repo, connector, run: lhRun("lh-v1"), now, retry })).summary,
    ).toMatchObject({ changed: 1 });
    name = "getOpenBidInfo.cancelled";
    expect(
      (await runIngest({ repo, connector, run: lhRun("lh-v2"), now, retry })).summary,
    ).toMatchObject({ cancelled: 1 });
    // 차수 0 응답이 다시 와도 취소(차수 2)를 되돌리지 않는다
    const stale = await runIngest({ repo, connector: base, run: lhRun("lh-v0-late"), now, retry });
    expect(stale.summary).toMatchObject({ created: 0, changed: 0, cancelled: 0 });
    expect(repo.state.bids.get("lh-bid-notice:2026100001")?.normalized).toMatchObject({
      status: "CANCELLED",
      amendmentNo: "2",
    });
  });

  it("데이터 없음(03)과 totalCount 0 은 빈 COMPLETE 쪽이라 실패로 세지 않는다", async () => {
    for (const body of [
      synthetic("getOpenBidInfo.no-data"),
      "<response><header><resultCode>00</resultCode></header><body><items></items><totalCount>0</totalCount></body></response>",
    ]) {
      const repo = createMemoryIngestionRepo();
      const { connector, requests } = lhConnector(() => xml(body));
      const result = await runIngest({ repo, connector, run: lhRun("lh-empty"), now, retry });
      expect(result).toMatchObject({ status: "SUCCEEDED", summary: { created: 0 } });
      expect(repo.state.runs.get("lh-empty")).toMatchObject({ completeness: "COMPLETE" });
      expect(requests).toHaveLength(1);
    }
  });

  it("필수 칸이 빠진 행만 격리하고 나머지는 저장한다(run 은 PARTIAL)", async () => {
    const repo = createMemoryIngestionRepo();
    const { connector } = lhConnector(() => xml(synthetic("getOpenBidInfo.missing-fields")), 10);
    const result = await runIngest({ repo, connector, run: lhRun("lh-missing"), now, retry });
    expect(result).toMatchObject({ status: "PARTIAL", summary: { created: 1, quarantined: 1 } });
    expect(repo.state.runItems.map(({ outcome }) => outcome)).toEqual(["QUARANTINED", "CREATED"]);
  });

  it.each([
    ["미등록 키(30)", () => xml(synthetic("gateway-auth"))],
    ["접근 거부·활용 미승인(20)", () => xml(synthetic("gateway-denied"))],
    ["결과 코드 없는 401", () => new Response("Unauthorized", { status: 401 })],
  ])("%s 는 인증 실패로 끝내고 다시 부르지 않는다", async (_name, respond) => {
    const repo = createMemoryIngestionRepo();
    const { connector, requests } = lhConnector(respond);
    const outcome = await connector.fetchPage({ ...window, cursor: null });
    expect(outcome).toMatchObject({ ok: false, failure: { kind: "SERVICE_KEY_INVALID" } });
    const result = await runIngest({ repo, connector, run: lhRun("lh-auth"), now, retry });
    expect(result.status).toBe("FAILED");
    // 재시도하지 않는다: fetchPage 직접 1회 + run 1회
    expect(requests).toHaveLength(2);
  });

  it("한도 초과(22)는 LH 예산만 막고 나라장터(15129394) 예산은 건드리지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const store = createMemoryQuotaStore({ dailyLimit: 1000 });
    const { connector, requests } = lhConnector(() => xml(synthetic("gateway-quota")));
    const quota = { store, serviceId: "15159012", dailyLimit: 1000 };
    const result = await runIngest({ repo, connector, run: lhRun("lh-22"), now, retry, quota });
    expect(result.status).toBe("FAILED");
    expect(await store.get("15159012", fetchedAt)).toBe(1000);
    expect(await store.get("15129394", fetchedAt)).toBe(0);
    await runIngest({ repo, connector, run: lhRun("lh-22-next"), now, retry, quota });
    expect(requests).toHaveLength(1);
  });

  it("2쪽에서 끊긴 run 은 cursor 를 남기고, 같은 run 을 다시 돌리면 2쪽부터 받는다", async () => {
    const repo = createMemoryIngestionRepo();
    let broken = true;
    const { connector, requests } = lhConnector((page) =>
      page === 1
        ? xml(synthetic("getOpenBidInfo.page1"))
        : broken
          ? new Response("bad gateway", { status: 502 })
          : xml(synthetic("getOpenBidInfo.page2")),
    );
    const first = await runIngest({ repo, connector, run: lhRun("lh-resume"), now, retry });
    expect(first).toMatchObject({ status: "FAILED", summary: { created: 2 } });
    expect(repo.state.runs.get("lh-resume")).toMatchObject({ cursor: "0:2" });
    broken = false;
    const pagesBefore = requests.length;
    const resumed = await runIngest({ repo, connector, run: lhRun("lh-resume"), now, retry });
    expect(resumed).toMatchObject({ status: "SUCCEEDED", resumedFromCursor: "0:2" });
    expect(resumed.summary.created).toBe(3);
    expect(requests.slice(pagesBefore).map((url) => url.searchParams.get("pageNo"))).toEqual(["2"]);
  });

  it("행 수가 모자란 쪽은 PARTIAL 로 멈추고 다음 쪽으로 넘어가지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const short = synthetic("getOpenBidInfo.page1").replace("<totalCount>3", "<totalCount>5");
    const { connector, requests } = lhConnector(() => xml(short), 3);
    const result = await runIngest({ repo, connector, run: lhRun("lh-short"), now, retry });
    expect(result.status).toBe("PARTIAL");
    expect(repo.state.runs.get("lh-short")).toMatchObject({
      completeness: "PARTIAL",
      cursor: null,
    });
    expect(requests).toHaveLength(1);
  });

  it("수동 백필 창은 정기 수집 위치를 옮기지 않고, 뒤이은 증분은 겹친 공고를 다시 저장하지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const { connector, requests } = lhConnector((page) =>
      xml(synthetic(page === 1 ? "getOpenBidInfo.page1" : "getOpenBidInfo.page2")),
    );
    // 백필: KST 10-01 ~ 10-21 (21일). LH 는 한 요청에 등록일 범위를 그대로 보낸다
    const backfill = { from: "2026-09-30T15:00:00.000Z", to: "2026-10-21T14:59:00.000Z" };
    const filled = await runIngest({
      repo,
      connector,
      run: lhRun("lh-backfill", "MANUAL", backfill),
      now,
      retry,
    });
    expect(filled).toMatchObject({ status: "SUCCEEDED", summary: { created: 3 } });
    expect(requests[0].searchParams.get("tndrbidRegDtStart")).toBe("20261001");
    expect(requests[0].searchParams.get("tndrbidRegDtEnd")).toBe("20261021");
    const scope = { serviceKey: "lh-bid-notice", operation: "getOpenBidInfo", partitionKey: "all" };
    expect(await repo.findLatestRunWindowEnd("lh", "SCHEDULED", scope)).toBeNull();

    const incremental = await runIngest({ repo, connector, run: lhRun("lh-inc"), now, retry });
    expect(incremental.summary).toMatchObject({ created: 0, skippedDuplicate: 3 });
    expect((await repo.findLatestRunWindowEnd("lh", "SCHEDULED", scope))?.toISOString()).toBe(
      window.to,
    );
  });

  it("형식이 틀린 행(글자가 아닌 공고번호)은 던지지 않고 격리한다", async () => {
    const repo = createMemoryIngestionRepo();
    const garbage: BidSourceConnector = {
      source: "lh",
      fetchPage: async () => ({
        ok: true,
        page: {
          records: [{ kind: "external", sourceKey: "lh-bid-notice", item: { bidNum: { x: 1 } } }],
          nextCursor: null,
          rateLimitInfo: null,
          completeness: "COMPLETE",
          capture: {
            serviceKey: "lh-bid-notice",
            operation: "getOpenBidInfo",
            partitionKey: "all",
            contentType: "application/xml",
            sanitizedPayload: "<response/>",
          },
        },
      }),
    };
    const result = await runIngest({ repo, connector: garbage, run: lhRun("lh-bad"), now, retry });
    expect(result).toMatchObject({ status: "PARTIAL", summary: { quarantined: 1 } });
    expect(repo.state.bids.size).toBe(0);
  });
});

describe("LH 전용 판정은 다른 외부 서비스로 번지지 않는다", () => {
  const kwater = (respond: () => Response) =>
    createExternalSourceConnector({
      sourceKey: "kwater-bid-notice",
      operation: "dmscptList",
      serviceKey: "fake-key",
      fetch: async () => respond(),
    });
  const denied = synthetic("gateway-denied");
  it.each([
    ["HTTP 401", () => new Response("Unauthorized", { status: 401 }), "HTTP_ERROR"],
    ["HTTP 403", () => new Response("Forbidden", { status: 403 }), "HTTP_ERROR"],
    ["접근 거부 20", () => xml(denied), "RESULT_CODE"],
    ["미등록 IP 32", () => xml(denied.replace(">20<", ">32<")), "RESULT_CODE"],
    ["데이터 없음 03", () => xml(synthetic("getOpenBidInfo.no-data")), "RESULT_CODE"],
    ["미등록 키 30", () => xml(synthetic("gateway-auth")), "SERVICE_KEY_INVALID"],
  ])("K-water 의 %s 는 예전 판정 %s 그대로다", async (_name, respond, kind) => {
    const outcome = await kwater(respond).fetchPage({ ...window, cursor: null });
    expect(outcome).toMatchObject({ ok: false, failure: { kind } });
  });

  it("LH 도 명세에 없는 결과 코드(3)는 빈 쪽으로 받지 않고 멈춘다", async () => {
    const { connector } = lhConnector(() =>
      xml(synthetic("getOpenBidInfo.no-data").replace(">03<", ">3<")),
    );
    const outcome = await connector.fetchPage({ ...window, cursor: null });
    expect(outcome).toMatchObject({ ok: false, failure: { kind: "RESULT_CODE" } });
  });
});
