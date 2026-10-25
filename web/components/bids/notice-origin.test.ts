import { describe, expect, it } from "vitest";
import {
  agencyLabelOf,
  isUnverifiedOrigin,
  sourceLinkLabelOf,
  viewedOriginOf,
} from "./notice-origin";

// 화면이 공고의 출처를 말하는 규칙. 저장된 is_demo 와 source 만 근거로 쓰고 값을 만들지 않는다.
describe("공고 출처 표시", () => {
  it("상단 DEMO 배지가 따르는 출처는 주소의 origin, 없거나 틀리면 기본 출처다", () => {
    expect(viewedOriginOf("demo", "live")).toBe("demo");
    expect(viewedOriginOf("all", "demo")).toBe("all");
    expect(viewedOriginOf(null, "demo")).toBe("demo");
    expect(viewedOriginOf("DEMO", "live")).toBe("live");
  });

  it("is_demo=false 인데 저장된 source 가 데모(fixture)면 출처 미확인이다", () => {
    expect(isUnverifiedOrigin({ isDemo: false, source: "fixture" })).toBe(true);
    expect(isUnverifiedOrigin({ isDemo: false, source: "g2b-bid-notice" })).toBe(false);
    expect(isUnverifiedOrigin({ isDemo: true, source: "fixture" })).toBe(false);
  });

  it("기관 라벨은 그 출처의 정규화가 agency 에 넣는 원본 필드를 따른다", () => {
    // G2B·fixture: NormalizedBid.agency = 수요기관(dminsttNm, 07 §3.1)
    expect(agencyLabelOf("g2b-bid-notice")).toBe("수요기관");
    expect(agencyLabelOf("fixture")).toBe("수요기관");
    // KEPCO: 회사 코드(companyId)로 찾은 회사 이름
    expect(agencyLabelOf("kepco-ebid-contract")).toBe("발주 회사");
    // 정규화가 없는 출처는 뜻을 단정하지 않는다
    expect(agencyLabelOf("lh-bid-notice")).toBe("기관");
    expect(agencyLabelOf("g2b-pre-spec")).toBe("기관");
  });

  it("서비스 안내 주소는 원본 공고로 부르지 않는다", () => {
    expect(sourceLinkLabelOf("NOTICE")).toBe("원문 보기");
    expect(sourceLinkLabelOf("SERVICE_DOCUMENTATION")).toBe("서비스 안내 (원본 공고 아님)");
  });
});
