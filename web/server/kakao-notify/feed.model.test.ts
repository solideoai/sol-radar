import { describe, expect, it } from "vitest";
import {
  toBidFeedTemplate,
  toReasonLine,
  toTestFeedTemplate,
  type BidFeedInput,
  type KakaoFeedTemplate,
  type QualificationSummaryInput,
} from "./feed.model";

// 카카오톡 "나에게 보내기" 피드 한 통(설계 §4.2 한도·§5.3 메시지 표, 계획 Task 2·Review Focus 4).
// 날짜·요일·D-n 은 서울 기준이다. now 는 2026-10-20(화) 14:14 KST.
const NOW = new Date("2026-10-20T05:14:00Z");
const SITE_URL = "https://sol-radar.example";
const BID_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TITLE = "2026년 가상시청 통합 민원 플랫폼 고도화 사업";
const SOURCE_URL = "https://www.g2b.go.kr/notice/R26BK00000001-000";
const DETAIL_URL = `${SITE_URL}/bids/${BID_ID}`;

const input = (overrides: Partial<BidFeedInput> = {}): BidFeedInput => ({
  bidId: BID_ID,
  title: TITLE,
  agency: "가상시청",
  deadlineAt: new Date("2026-10-30T09:00:00Z"),
  budgetKrw: 1_240_000_000,
  score: 78,
  recommendation: "BID",
  status: "COMPLETED",
  reason: "필수 자격 충족",
  sourceUrl: SOURCE_URL,
  siteUrl: SITE_URL,
  now: NOW,
  ...overrides,
});

const itemOp = (template: KakaoFeedTemplate, item: string): string | undefined =>
  template.item_content.items.find((entry) => entry.item === item)?.item_op;

const charCount = (text: string): number => Array.from(text).length;

// 피드 한도: item 6자, item_op 25자(2줄), buttons 2개, content.title 필수(설계 §4.2).
const expectWithinKakaoLimits = (template: KakaoFeedTemplate): void => {
  expect(template.content.title.length).toBeGreaterThan(0);
  expect(template.item_content.items.length).toBeLessThanOrEqual(5);
  for (const entry of template.item_content.items) {
    expect(charCount(entry.item)).toBeLessThanOrEqual(6);
    expect(charCount(entry.item_op)).toBeLessThanOrEqual(25);
  }
  expect(template.buttons.length).toBeGreaterThan(0);
  expect(template.buttons.length).toBeLessThanOrEqual(2);
};

describe("toBidFeedTemplate", () => {
  it("BID·COMPLETED 공고를 제목·설명·항목 넷·버튼 둘의 피드로 만든다", () => {
    expect(toBidFeedTemplate(input())).toEqual({
      object_type: "feed",
      content: {
        title: TITLE,
        description: "BID 권고 · 필수 자격 충족",
        link: { web_url: DETAIL_URL, mobile_web_url: DETAIL_URL },
      },
      item_content: {
        items: [
          { item: "발주처", item_op: "가상시청" },
          { item: "마감", item_op: "10-30(금) 18:00 · D-10" },
          { item: "추정금액", item_op: "12.4억" },
          { item: "점수", item_op: "78" },
        ],
      },
      buttons: [
        { title: "분석 보기", link: { web_url: DETAIL_URL, mobile_web_url: DETAIL_URL } },
        { title: "공고 원문", link: { web_url: SOURCE_URL, mobile_web_url: SOURCE_URL } },
      ],
    });
  });

  it("WATCH 권고는 설명 줄 앞머리가 WATCH 권고다", () => {
    const template = toBidFeedTemplate(input({ recommendation: "WATCH", reason: "확인 필요 2건" }));
    expect(template.content.description).toBe("WATCH 권고 · 확인 필요 2건");
  });

  it("PARTIAL 이면 설명 끝에 ' · AI 없이 규칙만으로 분석' 을 붙인다", () => {
    const template = toBidFeedTemplate(input({ status: "PARTIAL" }));
    expect(template.content.description).toBe(
      "BID 권고 · 필수 자격 충족 · AI 없이 규칙만으로 분석",
    );
  });

  it("발주처·추정금액·점수가 없으면 미공개, 마감이 없으면 미정으로 채운다", () => {
    const template = toBidFeedTemplate(
      input({ agency: null, budgetKrw: null, score: null, deadlineAt: null }),
    );
    expect(template.item_content.items).toEqual([
      { item: "발주처", item_op: "미공개" },
      { item: "마감", item_op: "미정" },
      { item: "추정금액", item_op: "미공개" },
      { item: "점수", item_op: "미공개" },
    ]);
  });

  it("발주처가 빈 글자면 미공개로 채운다", () => {
    expect(itemOp(toBidFeedTemplate(input({ agency: "  " })), "발주처")).toBe("미공개");
  });

  it("마감이 이미 지났으면 <날짜> · 마감 지남 으로 쓴다", () => {
    const template = toBidFeedTemplate(input({ deadlineAt: new Date("2026-10-19T09:00:00Z") }));
    expect(itemOp(template, "마감")).toBe("10-19(월) 18:00 · 마감 지남");
  });

  it("서울 날짜로 오늘 마감이면 D-Day 다", () => {
    const template = toBidFeedTemplate(input({ deadlineAt: new Date("2026-10-20T09:00:00Z") }));
    expect(itemOp(template, "마감")).toBe("10-20(화) 18:00 · D-Day");
  });

  it("D-n 은 UTC 날짜가 아니라 서울 날짜 차이다", () => {
    // UTC 로는 같은 10-20 이지만 서울로는 10-20 23:30 → 10-21 00:30 이라 하루 차이다.
    const template = toBidFeedTemplate(
      input({
        now: new Date("2026-10-20T14:30:00Z"),
        deadlineAt: new Date("2026-10-20T15:30:00Z"),
      }),
    );
    expect(itemOp(template, "마감")).toBe("10-21(수) 00:30 · D-1");
  });

  it("공고명이 40자를 넘으면 40자 + … 로 자른다", () => {
    const longTitle = "가".repeat(120);
    const template = toBidFeedTemplate(input({ title: longTitle }));
    expect(template.content.title).toBe(`${"가".repeat(40)}…`);
  });

  it("공고명이 40자 이하면 자르지 않는다", () => {
    const title = "나".repeat(40);
    expect(toBidFeedTemplate(input({ title })).content.title).toBe(title);
  });

  it("공고명의 줄바꿈·연속 공백은 한 칸으로 줄인다", () => {
    const template = toBidFeedTemplate(input({ title: "  통합 민원\n플랫폼   고도화  " }));
    expect(template.content.title).toBe("통합 민원 플랫폼 고도화");
  });

  it("원문 주소가 없으면 둘째 버튼을 상세 화면의 원문 자리로 보낸다", () => {
    const template = toBidFeedTemplate(input({ sourceUrl: null }));
    const fallback = `${DETAIL_URL}#source`;
    expect(template.buttons[1]).toEqual({
      title: "공고 원문",
      link: { web_url: fallback, mobile_web_url: fallback },
    });
  });

  it("원문 주소가 http·https 가 아니면 상세 화면의 원문 자리로 보낸다", () => {
    const template = toBidFeedTemplate(input({ sourceUrl: "javascript:alert(1)" }));
    expect(template.buttons[1].link.web_url).toBe(`${DETAIL_URL}#source`);
  });

  it("앱 주소 끝의 / 는 겹치지 않게 뗀다", () => {
    const template = toBidFeedTemplate(input({ siteUrl: `${SITE_URL}/` }));
    expect(template.content.link.web_url).toBe(DETAIL_URL);
  });

  it("추정금액 1억 이상은 소수 한 자리 반올림 x.x억이다", () => {
    const budgetOf = (budgetKrw: number): string | undefined =>
      itemOp(toBidFeedTemplate(input({ budgetKrw })), "추정금액");
    expect(budgetOf(100_000_000)).toBe("1.0억");
    expect(budgetOf(1_245_000_000)).toBe("12.5억");
    expect(budgetOf(1_244_999_999)).toBe("12.4억");
    expect(budgetOf(123_456_789_012)).toBe("1,234.6억");
  });

  it("추정금액 1억 미만은 n,nnn만 원이다", () => {
    const budgetOf = (budgetKrw: number): string | undefined =>
      itemOp(toBidFeedTemplate(input({ budgetKrw })), "추정금액");
    expect(budgetOf(98_765_432)).toBe("9,877만 원");
    expect(budgetOf(50_000_000)).toBe("5,000만 원");
    // 만 원 단위로 반올림해 1억이 되면 억 단위로 쓴다(10,000만 원으로 쓰지 않는다).
    expect(budgetOf(99_999_999)).toBe("1.0억");
  });

  it("추정금액이 음수거나 수가 아니면 미공개다", () => {
    expect(itemOp(toBidFeedTemplate(input({ budgetKrw: -1 })), "추정금액")).toBe("미공개");
    expect(itemOp(toBidFeedTemplate(input({ budgetKrw: Number.NaN })), "추정금액")).toBe("미공개");
  });

  it("점수는 정수로 반올림한다", () => {
    expect(itemOp(toBidFeedTemplate(input({ score: 77.6 })), "점수")).toBe("78");
  });

  it("발주처가 25자를 넘으면 25자 안에서 … 로 자른다", () => {
    const agency = "다".repeat(40);
    expect(itemOp(toBidFeedTemplate(input({ agency })), "발주처")).toBe(`${"다".repeat(24)}…`);
  });

  it("어떤 입력이든 item 6자·item_op 25자·버튼 2개 한도를 지키고 던지지 않는다", () => {
    const cases: Partial<BidFeedInput>[] = [
      {},
      { status: "PARTIAL", recommendation: "WATCH" },
      { agency: null, budgetKrw: null, score: null, deadlineAt: null, sourceUrl: null },
      { title: "라".repeat(120), agency: "마".repeat(60) },
      { deadlineAt: new Date("2025-01-01T00:00:00Z") },
      { deadlineAt: new Date("2027-12-31T14:59:00Z"), budgetKrw: 987_654_321_987_654 },
      { deadlineAt: new Date(Number.NaN) },
    ];
    for (const overrides of cases) expectWithinKakaoLimits(toBidFeedTemplate(input(overrides)));
  });
});

describe("toReasonLine", () => {
  const check = (
    mandatory: boolean,
    outcome: QualificationSummaryInput[number]["outcome"],
  ): QualificationSummaryInput[number] => ({ mandatory, outcome });

  it("필수 항목이 모두 충족·해당 없음이면 '필수 자격 충족' 이다(선택 항목은 보지 않는다)", () => {
    expect(
      toReasonLine([
        check(true, "SATISFIED"),
        check(true, "NOT_APPLICABLE"),
        check(false, "NOT_SATISFIED"),
        check(false, "NEEDS_REVIEW"),
      ]),
    ).toBe("필수 자격 충족");
  });

  it("필수 항목에 확인 필요가 있으면 미충족보다 먼저 '확인 필요 n건' 이다", () => {
    expect(
      toReasonLine([
        check(true, "NEEDS_REVIEW"),
        check(true, "NEEDS_REVIEW"),
        check(true, "NOT_SATISFIED"),
        check(true, "SATISFIED"),
      ]),
    ).toBe("확인 필요 2건");
  });

  it("필수 항목에 확인 필요가 없고 미충족이 있으면 '필수 자격 미충족 m건' 이다", () => {
    expect(
      toReasonLine([
        check(true, "NOT_SATISFIED"),
        check(true, "SATISFIED"),
        check(false, "NEEDS_REVIEW"),
      ]),
    ).toBe("필수 자격 미충족 1건");
  });

  it("필수 항목이 없으면 '필수 자격 없음' 이다", () => {
    expect(toReasonLine([])).toBe("필수 자격 없음");
    expect(toReasonLine([check(false, "NOT_SATISFIED")])).toBe("필수 자격 없음");
  });
});

describe("toTestFeedTemplate", () => {
  it("공고 없이 고정 문구의 시험 피드를 만들고 버튼은 설정 화면으로 보낸다", () => {
    const settingsUrl = `${SITE_URL}/settings`;
    expect(toTestFeedTemplate(SITE_URL)).toEqual({
      object_type: "feed",
      content: {
        title: "SOL RADAR 카카오톡 알림 시험",
        description: "추천 공고가 나오면 이렇게 받습니다.",
        link: { web_url: settingsUrl, mobile_web_url: settingsUrl },
      },
      item_content: { items: [{ item: "상태", item_op: "연결됨" }] },
      buttons: [
        { title: "설정 보기", link: { web_url: settingsUrl, mobile_web_url: settingsUrl } },
      ],
    });
  });

  it("앱 주소 끝의 / 를 떼고 한도를 지킨다", () => {
    const template = toTestFeedTemplate(`${SITE_URL}/`);
    expect(template.content.link.web_url).toBe(`${SITE_URL}/settings`);
    expectWithinKakaoLimits(template);
  });
});
