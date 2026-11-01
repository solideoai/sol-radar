import { describe, expect, it } from "vitest";
import { PROGRAM_NOTICE_SOURCE_LABELS } from "@/server/program-notices";
import { periodText } from "./program-format";
import { SOURCE_LABEL } from "./programs-copy";

describe("부처 공고 표기", () => {
  it("마감이 없는 과기정통부 공고는 공고문 확인으로 보인다", () => {
    expect(periodText(null, null, "2026-11-02", "msit")).toBe("공고문 확인");
    expect(periodText(null, null, "2026-11-02", "bizinfo")).toBe("기간 미표기");
  });

  it("화면 출처 이름은 서버 출처 이름과 같다", () => {
    expect(SOURCE_LABEL).toEqual(PROGRAM_NOTICE_SOURCE_LABELS);
  });
});
