import { describe, expect, it } from "vitest";
import { DEMO_BIDS } from "@/components/landing/demo-bids";

// 랜딩 미리보기가 보여 주는 숫자·상태·권고가 서로 맞는지 고정한다. 요청이 정한 대표 예시는 0번이다.
describe("DEMO_BIDS", () => {
  it("예시 공고는 3건이고 id 가 겹치지 않는다", () => {
    expect(DEMO_BIDS).toHaveLength(3);
    expect(new Set(DEMO_BIDS.map((bid) => bid.id)).size).toBe(3);
  });

  it("대표 예시는 82점, 확인 필요 1건, WATCH 다", () => {
    const [first] = DEMO_BIDS;
    expect(first.title).toBe("공공기관 업무지원 시스템 고도화");
    expect(first.score).toBe(82);
    expect(first.counts).toEqual({ SATISFIED: 2, NEEDS_REVIEW: 1, NOT_SATISFIED: 0 });
    expect(first.recommendation).toBe("WATCH");
    expect(first.reasons.join(" ")).toContain("유사 사업 실적 보유");
    expect(first.reasons.join(" ")).toContain("주요 기술 요구사항 부합");
    expect(first.followUps).toContain("필수 증빙의 유효기간 확인 필요");
  });

  it("세 권고(BID·WATCH·NO_BID)를 한 번씩 보여 준다", () => {
    expect(DEMO_BIDS.map((bid) => bid.recommendation).toSorted()).toEqual([
      "BID",
      "NO_BID",
      "WATCH",
    ]);
  });

  it("확인 필요나 미충족이 있는 공고는 BID 가 아니다", () => {
    DEMO_BIDS.filter((bid) => bid.counts.NEEDS_REVIEW + bid.counts.NOT_SATISFIED > 0).forEach(
      (bid) => expect(bid.recommendation).not.toBe("BID"),
    );
  });

  it("확인 필요가 있는 공고는 추가 확인 사항을 적어 둔다", () => {
    DEMO_BIDS.filter((bid) => bid.counts.NEEDS_REVIEW > 0).forEach((bid) =>
      expect(bid.followUps.length).toBeGreaterThan(0),
    );
  });

  it("요소 점수는 0 이상 만점 이하이고, 만점의 합은 100 이다", () => {
    DEMO_BIDS.forEach((bid) => {
      bid.factors.forEach((factor) => {
        expect(factor.points).toBeGreaterThanOrEqual(0);
        expect(factor.points).toBeLessThanOrEqual(factor.max);
      });
      expect(bid.factors.reduce((total, factor) => total + factor.max, 0)).toBe(100);
    });
  });

  it("기관 이름은 가상임을 밝힌다", () => {
    DEMO_BIDS.forEach((bid) => expect(bid.agency).toMatch(/^가상 /));
  });

  it("자격 항목마다 공고문 쪽수와 인용이 있고, 인용에는 낫표·조항 번호가 없다", () => {
    DEMO_BIDS.flatMap((bid) => bid.checks).forEach((check) => {
      expect(check.evidence.page).toBeGreaterThan(0);
      expect(check.evidence.quote).not.toMatch(/[「」]|제\s*\d+\s*조/);
    });
  });

  it("대표 예시의 인용은 디자인 문서의 값이다", () => {
    const [first] = DEMO_BIDS;
    expect(first.checks.map((check) => check.evidence)).toEqual([
      { page: 2, quote: "소프트웨어사업자로 신고한 자" },
      { page: 2, quote: "중소기업자 간 제한경쟁입찰" },
      { page: 4, quote: "입찰 마감일 기준 유효한 인증서 사본" },
    ]);
  });
});
