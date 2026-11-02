import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  backfillWindowsOf,
  buildAwardHistory,
  estimatedCallsOf,
  joinAwardWithNotice,
  parseAwardItems,
  parseNoticeItems,
  suggestedMonthsOf,
  type AwardApiRow,
  type NoticeApiRow,
} from "./award-history.model";

// S1 녹음(키·낙찰업체 가림). 녹음 파일은 items 를 최상위에 두므로 API 봉투 모양으로 다시 싼다.
const recordedItems = (relative: string): unknown => {
  const raw: unknown = JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
  if (typeof raw !== "object" || raw === null || !("items" in raw)) throw new Error("녹음 형식");
  return raw.items;
};
const envelope = (items: unknown, totalCount = 0) => ({
  response: {
    header: { resultCode: "00", resultMsg: "정상" },
    body: { items, totalCount, numOfRows: 999, pageNo: 1 },
  },
});
const AWARD_ITEMS = recordedItems(
  "../../../fixtures/recorded/15129397/getScsbidListSttusServc.20261102.masked.json",
);
const NOTICE_ITEMS = recordedItems(
  "../../../fixtures/recorded/15129394/getBidPblancListInfoServc.20261019.7d-p1.masked.json",
);

const award = (overrides: Partial<AwardApiRow> = {}): AwardApiRow => ({
  bidNoticeNo: "R26BK00000001",
  bidNoticeOrd: "000",
  title: "정보시스템 구축 용역",
  participantCount: 3,
  awardAmountKrw: 900_000_000,
  openedAt: "2026-10-01T01:00:00.000Z",
  demandAgency: "가상기관",
  ...overrides,
});
const notice = (overrides: Partial<NoticeApiRow> = {}): NoticeApiRow => ({
  bidNoticeNo: "R26BK00000001",
  bidNoticeOrd: "000",
  classNo: "81111598",
  className: "정보시스템개발서비스",
  midClassName: "소프트웨어개발서비스",
  methodName: "협상에의한계약-협상에 의한 낙찰자 결정",
  base: { amountKrw: 1_000_000_000, kind: "ASSIGNED_BUDGET" },
  ...overrides,
});
const index = (...notices: NoticeApiRow[]) => {
  const map = new Map<string, NoticeApiRow[]>();
  for (const row of notices) map.set(row.bidNoticeNo, [...(map.get(row.bidNoticeNo) ?? []), row]);
  return map;
};

describe("parseAwardItems", () => {
  it("녹음 30행을 읽고, 낙찰률이 빈 협상 행도 낙찰금액·개찰일시(KST)를 갖는다", () => {
    const rows = parseAwardItems(envelope(AWARD_ITEMS, 1662));
    expect(rows).toHaveLength(30);
    expect(rows[0]).toEqual({
      bidNoticeNo: "R26BK01746947",
      bidNoticeOrd: "000",
      title: "합성환경기반 국방실증지원센터 국방무인체계 디지털 트윈 통합실증 플랫폼 구축 용역",
      participantCount: 4,
      awardAmountKrw: 857_000_000,
      openedAt: "2026-10-21T08:12:14.000Z",
      demandAgency: "건양대학교 산학협력단",
    });
    expect(rows.every((row) => row.openedAt !== null)).toBe(true);
    // 녹음에 낙찰금액 "0" 행이 한 건 있다. 금액 없음으로 읽어 잇기에서 NO_AWARD_AMOUNT 로 빠진다.
    const noAmount = rows.filter((row) => row.awardAmountKrw === null);
    expect(noAmount.map((row) => row.bidNoticeNo)).toEqual(["R26BK01696246"]);
    expect(
      joinAwardWithNotice(noAmount[0] ?? award(), index(notice({ bidNoticeNo: "R26BK01696246" }))),
    ).toEqual({ skipped: "NO_AWARD_AMOUNT" });
  });

  it("낙찰업체 칸은 행에 들어오지 않는다", () => {
    const keys = new Set(parseAwardItems(envelope(AWARD_ITEMS)).flatMap(Object.keys));
    expect([...keys].some((key) => /bidwinnr|fnlSucsfCorp/i.test(key))).toBe(false);
  });

  it("items 가 객체 한 건이면 한 행, 빈 문자열·없음이면 0행이다", () => {
    const first = parseAwardItems(envelope(AWARD_ITEMS))[0];
    const single = parseAwardItems(
      envelope({ bidNtceNo: "R26BK01746947", bidNtceOrd: "000", sucsfbidAmt: "857000000" }, 1),
    );
    expect(single).toHaveLength(1);
    expect(single[0]?.bidNoticeNo).toBe(first?.bidNoticeNo);
    expect(parseAwardItems(envelope(""))).toEqual([]);
    expect(parseAwardItems(envelope(undefined))).toEqual([]);
  });

  it("결과 코드가 정상이 아니면 던진다", () => {
    const failed = { response: { header: { resultCode: "22", resultMsg: "한도 초과" } } };
    expect(() => parseAwardItems(failed)).toThrow("resultCode 22");
  });
});

describe("parseNoticeItems", () => {
  it("녹음 공고에서 분류·낙찰방법·기준금액(배정예산 우선)을 읽는다", () => {
    const rows = parseNoticeItems(envelope(NOTICE_ITEMS, 3555));
    expect(rows).toHaveLength(100);
    expect(rows[0]).toEqual({
      bidNoticeNo: "R26BK01753034",
      bidNoticeOrd: "000",
      classNo: "80909011",
      className: "과학기술연구조사서비스",
      midClassName: "학술연구서비스",
      methodName: "협상에의한계약-협상에 의한 낙찰자 결정",
      base: { amountKrw: 1_264_200_000, kind: "ASSIGNED_BUDGET" },
    });
  });
});

describe("joinAwardWithNotice", () => {
  it("차수가 같은 공고를 잇고, 낙찰률은 금액 ÷ 기준금액을 소수 넷째 자리로 둔다", () => {
    const row = joinAwardWithNotice(
      award({ bidNoticeOrd: "001", awardAmountKrw: 876_543_210 }),
      index(notice({ bidNoticeOrd: "000", classNo: "1" }), notice({ bidNoticeOrd: "001" })),
    );
    expect(row).toMatchObject({
      bid_notice_ord: "001",
      procurement_class_no: "81111598",
      award_method_group: "NEGOTIATION",
      base_amount_krw: 1_000_000_000,
      award_ratio: 0.8765,
    });
  });

  it("차수가 맞는 공고가 없으면 같은 번호의 가장 큰 차수를 쓴다", () => {
    const row = joinAwardWithNotice(
      award({ bidNoticeOrd: "003" }),
      index(notice({ bidNoticeOrd: "001", classNo: "1" }), notice({ bidNoticeOrd: "002" })),
    );
    expect(row).toMatchObject({ bid_notice_ord: "003", procurement_class_no: "81111598" });
  });

  it("못 쓰는 행은 이유를 돌려준다", () => {
    expect(joinAwardWithNotice(award(), index())).toEqual({ skipped: "NO_NOTICE" });
    expect(
      joinAwardWithNotice(award(), index(notice({ methodName: "수의시담-수의시담" }))),
    ).toEqual({ skipped: "OTHER_METHOD" });
    expect(joinAwardWithNotice(award(), index(notice({ classNo: null })))).toEqual({
      skipped: "NO_CLASS",
    });
    expect(joinAwardWithNotice(award(), index(notice({ base: null })))).toEqual({
      skipped: "NO_BASE",
    });
    expect(joinAwardWithNotice(award({ awardAmountKrw: 1_500_000_000 }), index(notice()))).toEqual({
      skipped: "RATIO_OUT_OF_RANGE",
    });
  });

  it("범위는 반올림한 낙찰률로 본다(0.29996 은 0.3 이 되어 남는다)", () => {
    const base: NoticeApiRow["base"] = { amountKrw: 100_000, kind: "ESTIMATED_PLUS_VAT" };
    expect(
      joinAwardWithNotice(award({ awardAmountKrw: 29_996 }), index(notice({ base }))),
    ).toMatchObject({ award_ratio: 0.3, award_method_group: "NEGOTIATION" });
    expect(joinAwardWithNotice(award({ awardAmountKrw: 29_994 }), index(notice({ base })))).toEqual(
      { skipped: "RATIO_OUT_OF_RANGE" },
    );
  });
});

describe("buildAwardHistory", () => {
  it("같은 (공고번호, 차수)는 늦게 개찰한 행 하나만 남기고 묶음·분류를 센다", () => {
    const lower = notice({
      bidNoticeNo: "R26BK00000002",
      methodName: "적격심사제-용역 적격심사",
      classNo: "81112002",
      className: "데이터처리서비스",
    });
    const build = buildAwardHistory(
      [
        award({ openedAt: "2026-09-01T01:00:00.000Z", awardAmountKrw: 800_000_000 }),
        award({ openedAt: "2026-09-20T01:00:00.000Z", awardAmountKrw: 850_000_000 }),
        award({ bidNoticeNo: "R26BK00000002" }),
        award({ bidNoticeNo: "R26BK09999999" }),
      ],
      [notice(), notice(), lower],
    );
    expect(build.rows).toHaveLength(2);
    expect(build.rows[0]?.award_ratio).toBe(0.85);
    expect(build.groups).toEqual({ NEGOTIATION: 1, LOWER_LIMIT: 1 });
    expect(build.skipped).toMatchObject({ DUPLICATE: 1, NO_NOTICE: 1 });
    expect(build.topClasses.map((entry) => entry.classNo)).toEqual(["81111598", "81112002"]);
  });
});

describe("기간·호출 수", () => {
  const now = new Date("2026-11-02T00:00:00.000Z");

  it("낙찰은 30일 조각, 공고는 낙찰 기간보다 2개월 앞부터 하루 조각이다", () => {
    const windows = backfillWindowsOf(now, 12);
    expect(windows.award[0]?.from.toISOString()).toBe("2025-11-02T00:00:00.000Z");
    expect(windows.award.at(-1)?.to.toISOString()).toBe(now.toISOString());
    expect(windows.award).toHaveLength(13);
    expect(windows.notice[0]?.from.toISOString()).toBe("2025-09-02T00:00:00.000Z");
    expect(windows.notice).toHaveLength(426);
    expect(estimatedCallsOf(windows, 30)).toBe(13 + 30 + 426);
  });

  it("상한 안에 드는 가장 긴 기간을 고르고, 6개월로도 넘으면 null 이다", () => {
    expect(suggestedMonthsOf({ now, months: 12, maxCalls: 400, awardPages: 26 })).toBe(10);
    expect(suggestedMonthsOf({ now, months: 12, maxCalls: 100, awardPages: 26 })).toBeNull();
  });
});
