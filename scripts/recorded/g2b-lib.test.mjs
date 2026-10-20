import assert from "node:assert/strict";
import test from "node:test";
import {
  auxParams,
  budgetBucketOf,
  buildG2bUrl,
  deadlineBucketOf,
  formatG2bDateTime,
  isInfoBizNoticeBroad,
  kstInstant,
  latestByNotice,
  listParams,
  parseG2bEnvelope,
  parseG2bGatewayError,
  parseG2bLocalDateTime,
  retryDelayMs,
  sampleStratified,
  splitG2bWindow,
} from "./g2b-lib.mjs";

test("splitG2bWindow: 2026-08-20 00:00 ~ 10-19 23:59 KST 는 1일 창 61개, 틈 없이 이어진다", () => {
  const slices = splitG2bWindow(kstInstant("2026-08-20"), kstInstant("2026-10-19", 23, 59));
  assert.equal(slices.length, 61);
  assert.equal(formatG2bDateTime(slices[0].from), "202608200000");
  assert.equal(formatG2bDateTime(slices[0].to), "202608210000");
  assert.equal(formatG2bDateTime(slices.at(-1).from), "202610190000");
  assert.equal(formatG2bDateTime(slices.at(-1).to), "202610192359");
  for (let index = 1; index < slices.length; index += 1) {
    assert.equal(slices[index].from.getTime(), slices[index - 1].to.getTime());
  }
});

test("listParams·buildG2bUrl: 키는 한 번만 인코딩되고 params 에는 없다", () => {
  const slice = splitG2bWindow(kstInstant("2026-10-19"), kstInstant("2026-10-19", 23, 59))[0];
  const params = listParams({ pageNo: 2, numOfRows: 999, slice });
  assert.deepEqual(params, {
    type: "json",
    pageNo: "2",
    numOfRows: "999",
    inqryDiv: "1",
    inqryBgnDt: "202610190000",
    inqryEndDt: "202610192359",
  });
  const url = buildG2bUrl({
    operation: "getBidPblancListInfoServc",
    serviceKey: "a+b/c==",
    params,
  });
  assert.ok(
    url.startsWith(
      "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc?",
    ),
  );
  assert.ok(url.includes("serviceKey=a%2Bb%2Fc%3D%3D"));
  assert.ok(!url.includes("%252B"));
  assert.throws(
    () => buildG2bUrl({ operation: "x", serviceKey: "k", params: { serviceKey: "k" } }),
    /serviceKey/,
  );
});

test("auxParams: inqryDiv=2 + 공고번호·차수, 기간은 등록일 -1일 00:00 ~ +6일 23:59 KST(8일)", () => {
  const params = auxParams({
    numOfRows: 999,
    bidNtceNo: "R26BK01756112",
    bidNtceOrd: "000",
    rgstAt: parseG2bLocalDateTime("2026-10-12 09:00:22"),
  });
  assert.deepEqual(params, {
    type: "json",
    pageNo: "1",
    numOfRows: "999",
    inqryDiv: "2",
    inqryBgnDt: "202610110000",
    inqryEndDt: "202610182359",
    bidNtceNo: "R26BK01756112",
    bidNtceOrd: "000",
  });
});

test("parseG2bEnvelope: 정상·조달청 오류·비정상 코드·깨진 모양", () => {
  const ok = parseG2bEnvelope({
    response: {
      header: { resultCode: "00", resultMsg: "정상" },
      body: { items: [{ a: "1" }], totalCount: "5" },
    },
  });
  assert.deepEqual(ok, {
    envelope: "response",
    resultCode: "00",
    resultMsg: "정상",
    totalCount: 5,
    items: [{ a: "1" }],
  });
  const error = parseG2bEnvelope({
    "nkoneps.com.response.ResponseError": {
      header: { resultCode: "07", resultMsg: "입력범위값 초과 에러" },
    },
  });
  assert.equal(error.envelope, "nkoneps.com.response.ResponseError");
  assert.equal(error.resultCode, "07");
  assert.equal(error.totalCount, null);
  const bad = parseG2bEnvelope({
    response: { header: { resultCode: "99", resultMsg: "x" }, body: { items: [] } },
  });
  assert.equal(bad.resultCode, "99");
  assert.equal(bad.totalCount, null);
  // 2026-10-20 실측: inqryDiv=2 0건은 items 키가 없다. totalCount 0 일 때만 빈 배열, 그 외 누락은 깨진 모양이다.
  const noItems = parseG2bEnvelope({
    response: {
      header: { resultCode: "00", resultMsg: "정상" },
      body: { numOfRows: 999, pageNo: 1, totalCount: 0 },
    },
  });
  assert.deepEqual(noItems.items, []);
  assert.equal(noItems.totalCount, 0);
  assert.deepEqual(
    parseG2bEnvelope({
      response: {
        header: { resultCode: "00", resultMsg: "정상" },
        body: { numOfRows: 999, pageNo: 1, totalCount: 3 },
      },
    }),
    { malformed: true },
  );
  assert.deepEqual(parseG2bEnvelope({ hello: 1 }), { malformed: true });
  assert.deepEqual(parseG2bEnvelope("text"), { malformed: true });
});

test("parseG2bGatewayError: XML 키 오류의 코드와 고정 메시지만 읽는다", () => {
  const xml =
    "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>";
  assert.deepEqual(parseG2bGatewayError(xml), {
    returnReasonCode: "30",
    returnAuthMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
  });
  assert.equal(parseG2bGatewayError('{"response":{}}'), null);
});

test("retryDelayMs: 1·2·4초 + jitter(<250ms)", () => {
  assert.equal(
    retryDelayMs(0, () => 0),
    1000,
  );
  assert.equal(
    retryDelayMs(1, () => 0),
    2000,
  );
  assert.equal(
    retryDelayMs(2, () => 0.5),
    4125,
  );
});

test("isInfoBizNoticeBroad: infoBizYn=Y, SW사업 표기, 정보시스템·소프트웨어 분류 중 하나면 참", () => {
  assert.equal(isInfoBizNoticeBroad({ infoBizYn: "Y" }), true);
  assert.equal(
    isInfoBizNoticeBroad({ sucsfbidMthdNm: "협상에의한계약-협상에 의한 낙찰자 결정(SW사업)" }),
    true,
  );
  assert.equal(isInfoBizNoticeBroad({ pubPrcrmntClsfcNm: "정보시스템유지관리서비스" }), true);
  assert.equal(isInfoBizNoticeBroad({ pubPrcrmntClsfcNm: "소프트웨어유지및지원서비스" }), true);
  assert.equal(isInfoBizNoticeBroad({ infoBizYn: "", pubPrcrmntClsfcNm: "구내식당서비스" }), false);
});

test("latestByNotice: 공고번호마다 가장 큰 차수만 남긴다", () => {
  const rows = latestByNotice([
    { bidNtceNo: "A", bidNtceOrd: "000", v: 1 },
    { bidNtceNo: "A", bidNtceOrd: "002", v: 3 },
    { bidNtceNo: "A", bidNtceOrd: "001", v: 2 },
    { bidNtceNo: "B", bidNtceOrd: "000", v: 4 },
    { bidNtceNo: "B", bidNtceOrd: "000", v: 4 },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.bidNtceNo, row.v]),
    [
      ["A", 3],
      ["B", 4],
    ],
  );
});

test("예산·마감 구간", () => {
  const anchor = kstInstant("2026-10-20");
  assert.equal(budgetBucketOf({ asignBdgtAmt: "99999999" }), "lt-1e8");
  assert.equal(budgetBucketOf({ asignBdgtAmt: "", presmptPrce: "490909091" }), "1e8-5e8");
  assert.equal(budgetBucketOf({ asignBdgtAmt: "1264200000" }), "5e8-2e9");
  assert.equal(budgetBucketOf({ asignBdgtAmt: "2000000000" }), "ge-2e9");
  assert.equal(budgetBucketOf({}), "unknown");
  assert.equal(deadlineBucketOf({ bidClseDt: "" }, anchor), "none");
  assert.equal(deadlineBucketOf({ bidClseDt: "2026-10-28 10:00:00" }, anchor), "open");
  assert.equal(deadlineBucketOf({ bidClseDt: "2026-10-01 10:00:00" }, anchor), "closed-30d");
  assert.equal(deadlineBucketOf({ bidClseDt: "2026-09-01 10:00:00" }, anchor), "closed-earlier");
});

test("sampleStratified: 같은 seed 면 같은 순서, 층을 돌며 뽑는다", () => {
  const anchor = kstInstant("2026-10-20");
  const items = Array.from({ length: 40 }, (_, index) => ({
    bidNtceNo: `N${String(index).padStart(3, "0")}`,
    dminsttCd: index % 2 === 0 ? "1234567" : "Z000001",
    asignBdgtAmt: index % 3 === 0 ? "50000000" : "300000000",
    bidClseDt: "",
  }));
  const first = sampleStratified({ items, size: 10, seed: "s", anchor });
  const second = sampleStratified({ items, size: 10, seed: "s", anchor });
  assert.deepEqual(first, second);
  assert.equal(first.picked.length, 10);
  assert.equal(first.strataCount, 4);
  // 첫 바퀴에서 층 4개가 하나씩 나온다.
  assert.deepEqual([...new Set(first.picked.slice(0, 4).map(({ stratum }) => stratum))].length, 4);
  const other = sampleStratified({ items, size: 10, seed: "t", anchor });
  assert.notDeepEqual(
    first.picked.map(({ item }) => item.bidNtceNo),
    other.picked.map(({ item }) => item.bidNtceNo),
  );
});
