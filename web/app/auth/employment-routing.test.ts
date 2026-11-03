import { describe, expect, it } from "vitest";
import { loginPath, signInPath } from "@/app/auth/employment-routing";
import { kakaoOpenExternalUrl } from "@/app/auth/in-app-browser";

const BID_PATH = "/bids/90c955ea-4724-453f-a076-1b29adbb9ba1";
const KAKAOTALK_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("signInPath", () => {
  it("카카오톡 안 창이면 로그인 대신 기본 브라우저로 넘기는 화면으로 보낸다", () => {
    expect(signInPath(BID_PATH, KAKAOTALK_IPHONE)).toBe(
      "/auth/open-in-browser?next=%2Fbids%2F90c955ea-4724-453f-a076-1b29adbb9ba1",
    );
  });

  it("브라우저에서는 지금처럼 로그인 화면으로 보낸다", () => {
    expect(signInPath(BID_PATH, SAFARI_IPHONE)).toBe(loginPath(BID_PATH));
    expect(signInPath(BID_PATH, null)).toBe(loginPath(BID_PATH));
  });

  it("카카오톡 안 창이어도 사이트 밖 주소는 넘기지 않는다", () => {
    expect(signInPath("https://evil.example/bids/1", KAKAOTALK_IPHONE)).toBe("/auth/login");
  });

  it("넘길 주소는 카카오톡 외부 열기 스킴에 인코딩해 싣는다", () => {
    expect(kakaoOpenExternalUrl(`https://www.solideos-radar.com${BID_PATH}?origin=live`)).toBe(
      "kakaotalk://web/openExternal?url=https%3A%2F%2Fwww.solideos-radar.com%2Fbids%2F90c955ea-4724-453f-a076-1b29adbb9ba1%3Forigin%3Dlive",
    );
  });
});

describe("loginPath", () => {
  it("업무 화면 경로를 ?next= 로 실어 로그인 뒤 그 화면으로 돌아오게 한다", () => {
    expect(loginPath("/bids/90c955ea-4724-453f-a076-1b29adbb9ba1")).toBe(
      "/auth/login?next=%2Fbids%2F90c955ea-4724-453f-a076-1b29adbb9ba1",
    );
  });

  it("돌아올 화면이 없거나 기본 화면이면 로그인 주소만 준다", () => {
    expect(loginPath(null)).toBe("/auth/login");
    expect(loginPath("/dashboard")).toBe("/auth/login");
  });

  it("사이트 밖 주소와 계정 화면은 싣지 않는다", () => {
    expect(loginPath("https://evil.example/bids/1")).toBe("/auth/login");
    expect(loginPath("//evil.example")).toBe("/auth/login");
    expect(loginPath("/auth/login?next=%2Fbids")).toBe("/auth/login");
  });
});
