import { describe, expect, it } from "vitest";
import { workRoleLabel, workRoleOf } from "./work-role";

describe("공고 역할 문구 → 직무 코드", () => {
  it.each([
    ["PM", "PM"],
    ["pl", "PL"],
    ["개발", "DEVELOPER"],
    ["개발자", "DEVELOPER"],
    ["개발책임자", "PL"],
    ["AI 엔지니어", "DATA_AI"],
    ["빅데이터 분석가", "DATA_AI"],
    ["데이터베이스 관리자", "DBA"],
    ["정보보호 컨설턴트", "SECURITY"],
    ["UI/UX 디자이너", "DESIGNER"],
    ["테스트 엔지니어", "QA"],
    ["업무분석", "BUSINESS_ANALYST"],
    ["사업관리자", "PM"],
    ["클라우드 엔지니어", "DEVOPS"],
    ["서버 개발자", "DEVELOPER"],
    ["UI 개발자", "DEVELOPER"],
    ["시스템엔지니어", "DEVOPS"],
  ])("%s → %s", (text, code) => expect(workRoleOf(text)).toBe(code));

  it.each(["감리원", "DBMS", "", "  "])("%s 는 대응 없음", (text) =>
    expect(workRoleOf(text)).toBeNull(),
  );

  it("모르는 코드 이름은 그대로 보인다", () =>
    expect(workRoleLabel("UNKNOWN_ROLE")).toBe("UNKNOWN_ROLE"));
});
