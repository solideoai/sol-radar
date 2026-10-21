import { describe, expect, it } from "vitest";
import { normalizedProgramNoticeSchema, PROGRAM_NOTICE_LIMITS } from "./program-notice.model";

const valid = {
  source: "bizinfo",
  sourceNoticeId: "PBLN_000000000000001",
  title: "2026년 스마트공장 지원사업 공고",
  agency: "중소벤처기업부",
  sourceUrl:
    "https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=PBLN_000000000000001",
  publishedAt: "2026-10-21T00:30:00.000Z",
  applyStartOn: "2026-10-01",
  applyEndOn: "2026-10-31",
  summary: "사업 개요",
  applyMethod: null,
  target: null,
  tags: ["기술", "서울"],
  dedupeKey: "2026년스마트공장지원사업공고|중소벤처기업부",
  fetchedAt: "2026-10-21T01:00:00.000Z",
  isDemo: false,
} as const;

describe("normalizedProgramNoticeSchema", () => {
  it("정규화 행을 받는다", () => {
    expect(normalizedProgramNoticeSchema.safeParse(valid).success).toBe(true);
  });

  it("https 가 아닌 원문 URL·달력 형식이 아닌 날짜·모르는 소스는 거부한다", () => {
    for (const bad of [
      { ...valid, sourceUrl: "http://www.bizinfo.go.kr/x" },
      { ...valid, sourceUrl: "javascript:alert(1)" },
      { ...valid, applyEndOn: "20261031" },
      { ...valid, publishedAt: "2026-10-21" },
      { ...valid, source: "g2b" },
      { ...valid, title: "" },
    ]) {
      expect(normalizedProgramNoticeSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("글자 상한은 코드포인트로 재고 말줄임표 한 자까지 허용한다", () => {
    const atLimit = `${"😀".repeat(PROGRAM_NOTICE_LIMITS.title)}…`;
    expect(normalizedProgramNoticeSchema.safeParse({ ...valid, title: atLimit }).success).toBe(
      true,
    );
    const over = "가".repeat(PROGRAM_NOTICE_LIMITS.title + 2);
    expect(normalizedProgramNoticeSchema.safeParse({ ...valid, title: over }).success).toBe(false);
  });

  it("태그는 20개까지다", () => {
    const tags = Array.from(
      { length: PROGRAM_NOTICE_LIMITS.tagCount + 1 },
      (_, index) => `태그${index}`,
    );
    expect(normalizedProgramNoticeSchema.safeParse({ ...valid, tags }).success).toBe(false);
  });
});
