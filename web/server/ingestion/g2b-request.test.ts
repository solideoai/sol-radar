import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { G2B_BID_NOTICE_LIST_OPERATION, G2B_WINDOW_MAX_MS } from "./g2b.model";
import { buildG2bListUrl, formatG2bDateTime, splitG2bWindow } from "./g2b-request";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const at = (iso: string): Date => new Date(iso);
const shift = (base: Date, ms: number): Date => new Date(base.getTime() + ms);

const ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
// KST 2026-10-19 00:00 ~ 23:59
const SLICE = { from: at("2026-10-18T15:00:00.000Z"), to: at("2026-10-19T14:59:00.000Z") };
// 디코딩된 서비스키(가짜). URL 에 들어갈 때 정확히 한 번 인코딩돼야 한다.
const DECODED_KEY = "ab+c/d=";

const buildUrl = (overrides: Partial<Parameters<typeof buildG2bListUrl>[0]> = {}): string =>
  buildG2bListUrl({
    endpoint: ENDPOINT,
    serviceKey: DECODED_KEY,
    pageNo: 2,
    numOfRows: 100,
    slice: SLICE,
    ...overrides,
  });

// 개발 기기의 시간대가 KST 면 로컬 시각(getHours 등)을 쓰는 구현도 우연히 맞는다.
// 이 파일의 시험은 KST 가 아닌 시간대에서 돌려 그런 구현을 잡는다.
let originalTimeZone: string | undefined;
beforeEach(() => {
  originalTimeZone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
});
afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe("시험 전제", () => {
  it("이 파일의 시험은 KST 가 아닌 시간대에서 돈다", () => {
    // KST 12:00 인 순간의 로컬 시각이 12 가 아니어야 시간대 의존 구현이 드러난다.
    expect(at("2026-10-19T03:00:00.000Z").getHours()).not.toBe(12);
  });
});

describe("formatG2bDateTime", () => {
  it("UTC 순간을 KST 벽시계 YYYYMMDDHHmm 으로 쓴다", () => {
    expect(formatG2bDateTime(at("2026-10-19T03:05:00.000Z"))).toBe("202610191205");
  });

  it("UTC 15:00 은 KST 다음 날 00:00 이다", () => {
    expect(formatG2bDateTime(at("2026-10-18T15:00:00.000Z"))).toBe("202610190000");
  });

  it("UTC 14:59 는 KST 같은 날 23:59 다", () => {
    expect(formatG2bDateTime(at("2026-10-18T14:59:00.000Z"))).toBe("202610182359");
  });

  it("12월 31일 UTC 15:00 은 KST 다음 해 1월 1일 00:00 이다", () => {
    expect(formatG2bDateTime(at("2026-12-31T15:00:00.000Z"))).toBe("202701010000");
  });

  it("초와 밀리초는 버리고 반올림하지 않는다", () => {
    expect(formatG2bDateTime(at("2026-10-19T03:05:59.999Z"))).toBe("202610191205");
  });

  it("인자 Date 를 바꾸지 않는다", () => {
    const input = at("2026-10-19T03:05:00.000Z");

    formatG2bDateTime(input);

    expect(input.toISOString()).toBe("2026-10-19T03:05:00.000Z");
  });
});

describe("splitG2bWindow", () => {
  const FROM = at("2026-10-18T15:00:00.000Z");

  it("1일보다 짧은 창은 한 조각이다", () => {
    const to = shift(FROM, 6 * HOUR_MS);

    expect(splitG2bWindow(FROM, to)).toEqual([{ from: FROM, to }]);
  });

  it("정확히 1일인 창도 한 조각이다", () => {
    const to = shift(FROM, DAY_MS);

    expect(splitG2bWindow(FROM, to)).toEqual([{ from: FROM, to }]);
  });

  it("1일보다 1ms 긴 창은 두 조각이다", () => {
    const to = shift(FROM, DAY_MS + 1);

    expect(splitG2bWindow(FROM, to)).toEqual([
      { from: FROM, to: shift(FROM, DAY_MS) },
      { from: shift(FROM, DAY_MS), to },
    ]);
  });

  it("2.5일 창은 1일·1일·0.5일 세 조각이다", () => {
    const to = shift(FROM, 2.5 * DAY_MS);

    expect(splitG2bWindow(FROM, to)).toEqual([
      { from: FROM, to: shift(FROM, DAY_MS) },
      { from: shift(FROM, DAY_MS), to: shift(FROM, 2 * DAY_MS) },
      { from: shift(FROM, 2 * DAY_MS), to },
    ]);
  });

  it("조각은 틈 없이 이어진다(다음 조각 from = 앞 조각 to, 처음 from·끝 to 는 창과 같다)", () => {
    const to = shift(FROM, 7 * DAY_MS + 60_000);

    const slices = splitG2bWindow(FROM, to);

    expect(slices[0].from.getTime()).toBe(FROM.getTime());
    expect(slices[slices.length - 1].to.getTime()).toBe(to.getTime());
    for (let index = 1; index < slices.length; index += 1) {
      expect(slices[index].from.getTime()).toBe(slices[index - 1].to.getTime());
    }
  });

  it("어느 조각도 비어 있지 않고 1일을 넘지 않는다", () => {
    const slices = splitG2bWindow(FROM, shift(FROM, 7 * DAY_MS + 60_000));

    expect(slices).toHaveLength(8);
    for (const slice of slices) {
      const length = slice.to.getTime() - slice.from.getTime();
      expect(length).toBeGreaterThan(0);
      expect(length).toBeLessThanOrEqual(G2B_WINDOW_MAX_MS);
    }
  });

  it("from 과 to 가 같으면 빈 목록이다", () => {
    expect(splitG2bWindow(FROM, shift(FROM, 0))).toEqual([]);
  });

  it("from 이 to 보다 늦으면 빈 목록이다", () => {
    expect(splitG2bWindow(FROM, shift(FROM, -HOUR_MS))).toEqual([]);
  });

  it("인자 Date 를 바꾸지 않는다", () => {
    const from = at("2026-10-18T15:00:00.000Z");
    const to = at("2026-10-21T03:00:00.000Z");

    splitG2bWindow(from, to);

    expect([from.toISOString(), to.toISOString()]).toEqual([
      "2026-10-18T15:00:00.000Z",
      "2026-10-21T03:00:00.000Z",
    ]);
  });
});

describe("buildG2bListUrl", () => {
  it("endpoint 뒤에 목록 오퍼레이션 경로를 붙이고 바로 쿼리를 단다", () => {
    expect(buildUrl().startsWith(`${ENDPOINT}/${G2B_BID_NOTICE_LIST_OPERATION}?`)).toBe(true);
  });

  it("쿼리 파라미터는 serviceKey·type·pageNo·numOfRows·inqryDiv·inqryBgnDt·inqryEndDt 순서다", () => {
    expect([...new URL(buildUrl()).searchParams.keys()]).toEqual([
      "serviceKey",
      "type",
      "pageNo",
      "numOfRows",
      "inqryDiv",
      "inqryBgnDt",
      "inqryEndDt",
    ]);
  });

  it("type 은 json, pageNo·numOfRows 는 받은 값이다", () => {
    const params = new URL(buildUrl({ pageNo: 3, numOfRows: 50 })).searchParams;

    expect([params.get("type"), params.get("pageNo"), params.get("numOfRows")]).toEqual([
      "json",
      "3",
      "50",
    ]);
  });

  it("inqryDiv 를 주지 않으면 1(등록일시)이다", () => {
    expect(new URL(buildUrl()).searchParams.get("inqryDiv")).toBe("1");
  });

  it("조회 기간은 조각의 from·to 를 KST YYYYMMDDHHmm 으로 쓴다", () => {
    const params = new URL(buildUrl()).searchParams;

    expect([params.get("inqryBgnDt"), params.get("inqryEndDt")]).toEqual([
      "202610190000",
      "202610192359",
    ]);
  });

  it("디코딩 키는 URL 안에서 정확히 한 번 인코딩된다", () => {
    expect(buildUrl()).toContain("?serviceKey=ab%2Bc%2Fd%3D&type=json");
  });

  it("키를 두 번 인코딩하지 않는다", () => {
    expect(buildUrl()).not.toContain("%25");
  });

  it("URL 을 다시 풀면 디코딩 키 원문이 나온다", () => {
    expect(new URL(buildUrl()).searchParams.get("serviceKey")).toBe(DECODED_KEY);
  });
});
