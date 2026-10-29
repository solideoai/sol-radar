import { describe, expect, it } from "vitest";
import { visibleMessage } from "./work-error";

// 2026-10-29 운영 /bids 에서 서버 컴포넌트 오류가 영어 원문 "Minified React error #441; …" 로 보였다.
describe("visibleMessage", () => {
  it("운영 빌드가 가린 서버 오류는 한국어 대체 문구로 바꾼다", () => {
    const minified =
      "Minified React error #441; visit https://react.dev/errors/441 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
    expect(visibleMessage(minified)).toBe(
      "화면 데이터를 읽는 중에 오류가 났습니다. 잠시 뒤 다시 시도하세요.",
    );
  });

  it("가리지 않은 메시지는 그대로 보인다", () => {
    expect(visibleMessage("업무 데이터베이스에 연결할 수 없습니다")).toBe(
      "업무 데이터베이스에 연결할 수 없습니다",
    );
  });
});
