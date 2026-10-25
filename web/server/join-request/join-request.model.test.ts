import "server-only";
import { describe, expect, it } from "vitest";
import { type JoinRequestRow, toJoinRequestView } from "./join-request.model";

const row = (overrides: Partial<JoinRequestRow>): JoinRequestRow => ({
  id: "1e000000-0000-4000-8000-000000000001",
  kind: "EXISTING",
  applicant_name: "김민준",
  applicant_email: "minjun@example.test",
  applicant_photo_path: null,
  created_at: "2026-10-24T02:00:00Z",
  updated_at: "2026-10-24T02:00:00.123456+00:00",
  department: { name: "영업1팀" },
  job_title: { label: "대리" },
  member: { name: "김민준", person_code: "SOL-0001" },
  ...overrides,
});

describe("toJoinRequestView", () => {
  it("기존 직원 신청인데 연결 직원이 보이지 않으면(퇴사 처리로 RLS 가 숨김) 연결할 수 없는 신청이다", () => {
    expect(toJoinRequestView(row({ member: null }), new Map()).memberUnavailable).toBe(true);
    expect(toJoinRequestView(row({}), new Map()).memberUnavailable).toBe(false);
    expect(
      toJoinRequestView(row({ kind: "NEW_HIRE", member: null }), new Map()).memberUnavailable,
    ).toBe(false);
  });
  it("결정에 보낼 신청 버전은 DB updated_at 원문 그대로다(마이크로초 유지, 20261025000300)", () => {
    expect(toJoinRequestView(row({}), new Map()).version).toBe("2026-10-24T02:00:00.123456+00:00");
  });
});
