import { describe, expect, it } from "vitest";
import { normText } from "./text-normalize";

// 15 §5.1 norm(s): NFKC → 제로폭 제거 → 공백 합치기·trim → 전각 괄호·따옴표·쉼표를 반각으로.
describe("normText", () => {
  it("NFKC 로 전각 영숫자를 반각으로 바꾼다", () => {
    expect(normText("ＡＩ행정１２３")).toBe("AI행정123");
  });

  it("NFKC 로 호환 문자를 풀어 쓴다", () => {
    expect(normText("㈜솔리데오")).toBe("(주)솔리데오");
  });

  it("제로폭 문자 U+200B·U+200C·U+200D·U+FEFF 를 지운다", () => {
    expect(normText("가​나‌다‍라﻿마")).toBe("가나다라마");
  });

  it("제로폭 문자를 지운 뒤 공백을 합치므로 제로폭 문자 양옆의 공백도 1개가 된다", () => {
    expect(normText("가 ​ 나")).toBe("가 나");
  });

  it("연속 공백·줄바꿈·탭을 공백 1개로 바꾸고 앞뒤 공백을 지운다", () => {
    expect(normText("  가\n\n나\t\t다 \r\n 라  ")).toBe("가 나 다 라");
  });

  it("전각 공백과 줄바꿈 없는 공백도 공백 1개가 된다", () => {
    expect(normText("가　 나")).toBe("가 나");
  });

  it("전각 괄호·따옴표·쉼표를 반각으로 바꾼다", () => {
    expect(normText("（가상）［１］｛ａ｝＂ｂ＂＇ｃ＇，")).toBe("(가상)[1]{a}\"b\"'c',");
  });

  it("숫자 사이 전각 쉼표는 반각 쉼표로 남기고 지우지 않는다", () => {
    expect(normText("사업예산 450，000，000원")).toBe("사업예산 450,000,000원");
  });

  it("숫자 사이 반각 쉼표는 그대로 둔다", () => {
    expect(normText("사업예산 450,000,000원")).toBe("사업예산 450,000,000원");
  });

  it("빈 문자열은 빈 문자열이다", () => {
    expect(normText("")).toBe("");
  });

  it("공백과 제로폭 문자뿐이면 빈 문자열이 된다", () => {
    expect(normText(" ​\t﻿\n ")).toBe("");
  });

  it("두 번 적용해도 한 번 적용한 결과와 같다", () => {
    const once = normText("  （가상）​ 사업예산\t１,５００백만원  ");
    expect(normText(once)).toBe(once);
  });
});
