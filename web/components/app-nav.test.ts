import { describe, expect, it } from "vitest";
import { breadcrumbOf } from "./app-nav";

// 화면 머리의 경로(묶음 / 화면)는 사이드바 메뉴 정의에서 찾는다. 상세 화면도 그 메뉴의 경로다.
describe("화면 경로", () => {
  it("출시된 메뉴 주소와 그 아래 주소는 묶음 이름과 메뉴 이름이다", () => {
    expect(breadcrumbOf("/bids")).toEqual({ group: "업무", screen: "입찰 공고" });
    expect(breadcrumbOf("/bids/abc/revisions")).toEqual({ group: "업무", screen: "입찰 공고" });
    expect(breadcrumbOf("/gaps")).toEqual({ group: "분석", screen: "자격 갭 레이더" });
    expect(breadcrumbOf("/company")).toEqual({ group: "회사", screen: "회사 역량" });
  });

  it("아래 고정 칸·조직 주소 템플릿 화면·첫 화면은 경로가 없다", () => {
    expect(breadcrumbOf("/settings")).toBeNull();
    expect(breadcrumbOf("/acme/tasks")).toBeNull();
    expect(breadcrumbOf("/")).toBeNull();
    // 메뉴 주소로 시작하기만 하는 다른 화면은 그 메뉴가 아니다.
    expect(breadcrumbOf("/bidsx")).toBeNull();
  });
});
