import { describe, expect, it } from "vitest";
import type { ApiFailure } from "@/app/(app)/(work)/bids/[id]/api-envelope";
import { NETWORK_ERROR, NETWORK_MESSAGE } from "@/app/(app)/(work)/bids/[id]/api-envelope";
import { requestErrorOf } from "./request-errors";

// 수동 수집 요청 실패 → 대화상자 문구(디자인 스펙 §4.11). 서버 message 는 보이지 않는다.
// renewKey: 고쳐서 다시 보내거나 새로 시작해야 하면 새 Idempotency-Key, 같은 제출을 다시 보내도 되면(429·5xx·네트워크) 같은 키.

const RUN_ID = "d5367aa6-0000-4000-8000-000000000001";
const SERVER_MESSAGE = "internal english message";

const failure = (
  status: number,
  code: string,
  details: Record<string, unknown> = {},
  // null 이면 requestId 가 없는 실패다.
  requestId: string | null = "req-1",
): ApiFailure => ({
  status,
  code,
  message: SERVER_MESSAGE,
  details,
  ...(requestId === null ? {} : { requestId }),
});

const ctx = { retryAfterSec: null, submitted: "fixture", runMode: "mock" } as const;

describe("requestErrorOf — 400 VALIDATION_ERROR", () => {
  it("source·batch path 는 칸 아래 오류로 옮기고 문단은 기본 문구다", () => {
    const error = requestErrorOf(
      failure(400, "VALIDATION_ERROR", {
        issues: [
          { path: "batch", message: "x" },
          { path: ["source"], message: "y" },
        ],
      }),
      ctx,
    );
    expect(error.message).toBe("입력값이 올바르지 않습니다.");
    expect(error.fieldErrors).toEqual({
      batch: "배치를 다시 고르세요.",
      source: "소스를 다시 고르세요.",
    });
  });

  it("모르는 path 는 문단에 이어 쓴다(배열 path 는 점으로 잇는다)", () => {
    const error = requestErrorOf(
      failure(400, "VALIDATION_ERROR", {
        issues: [{ path: "window.from" }, { path: ["stages", 0] }, { path: "batch" }],
      }),
      ctx,
    );
    expect(error.message).toBe("입력값이 올바르지 않습니다. 확인할 항목: window.from, stages.0");
    expect(error.fieldErrors).toEqual({ batch: "배치를 다시 고르세요." });
  });

  it("칸 이름으로 시작하는 깊은 path(batch.0, ['source','kind'])도 그 칸의 오류다", () => {
    const error = requestErrorOf(
      failure(400, "VALIDATION_ERROR", {
        issues: [{ path: "batch.0" }, { path: ["source", "kind"] }],
      }),
      ctx,
    );
    expect(error.message).toBe("입력값이 올바르지 않습니다.");
    expect(error.fieldErrors).toEqual({
      batch: "배치를 다시 고르세요.",
      source: "소스를 다시 고르세요.",
    });
  });

  it("같은 path 가 여러 번 와도 한 번만 쓴다", () => {
    const error = requestErrorOf(
      failure(400, "VALIDATION_ERROR", { issues: [{ path: "window" }, { path: "window" }] }),
      ctx,
    );
    expect(error.message).toBe("입력값이 올바르지 않습니다. 확인할 항목: window");
  });

  it("issues 가 없거나 모양이 틀리면 기본 문구만이다", () => {
    for (const details of [{}, { issues: "x" }, { issues: [null, 1, { message: "no path" }] }]) {
      const error = requestErrorOf(failure(400, "VALIDATION_ERROR", details), ctx);
      expect(error.message).toBe("입력값이 올바르지 않습니다.");
      expect(error.fieldErrors).toEqual({});
    }
  });

  it("고쳐서 다시 보내므로 새 키다", () => {
    expect(requestErrorOf(failure(400, "VALIDATION_ERROR"), ctx).renewKey).toBe(true);
  });
});

describe("requestErrorOf — 409 세 종류", () => {
  it("RUN_MODE_MISMATCH 는 서버 details 의 실행 모드와 소스 글자로 쓰고 [새로 고침]을 단다", () => {
    const error = requestErrorOf(
      failure(409, "RUN_MODE_MISMATCH", { runMode: "live", source: "fixture" }),
      ctx,
    );
    expect(error).toEqual({
      message:
        "지금 실행 모드(live)에서는 데모 데이터 (fixture) 수집을 할 수 없습니다. 실행 모드가 바뀌었을 수 있으니 화면을 새로 고치세요.",
      action: { kind: "refresh" },
      requestId: "req-1",
      renewKey: true,
    });
  });

  it("RUN_MODE_MISMATCH 의 details 가 없거나 모르는 값이면 화면이 아는 모드·보낸 소스를 쓴다", () => {
    const error = requestErrorOf(
      failure(409, "RUN_MODE_MISMATCH", { runMode: "LIVE", source: "nara" }),
      { retryAfterSec: null, submitted: "g2b", runMode: "fixture" },
    );
    expect(error.message).toBe(
      "지금 실행 모드(fixture)에서는 나라장터 (g2b) 수집을 할 수 없습니다. 실행 모드가 바뀌었을 수 있으니 화면을 새로 고치세요.",
    );
  });

  it("IDEMPOTENCY_KEY_REUSED 는 새 번호로 다시 요청한다고 알리고 새 키다", () => {
    const error = requestErrorOf(failure(409, "IDEMPOTENCY_KEY_REUSED"), ctx);
    expect(error.message).toBe(
      "같은 요청 번호로 다른 내용이 이미 접수되었습니다. 다시 실행하면 새 번호로 요청합니다.",
    );
    expect(error.renewKey).toBe(true);
    expect(error.action).toBeUndefined();
  });

  it("INGESTION_IN_PROGRESS 는 details.runId 가 UUID 면 [실행 중인 수집 보기]를 단다", () => {
    const error = requestErrorOf(failure(409, "INGESTION_IN_PROGRESS", { runId: RUN_ID }), ctx);
    expect(error.message).toBe("같은 소스의 수집이 이미 실행 중입니다.");
    expect(error.action).toEqual({ kind: "show-run", runId: RUN_ID });
  });

  it("INGESTION_IN_PROGRESS 의 runId 가 없거나 UUID 가 아니면 단추를 달지 않는다", () => {
    for (const details of [{}, { runId: "../etc" }, { runId: 42 }]) {
      const error = requestErrorOf(failure(409, "INGESTION_IN_PROGRESS", details), ctx);
      expect(error.message).toBe("같은 소스의 수집이 이미 실행 중입니다.");
      expect(error).not.toHaveProperty("action");
    }
  });
});

describe("requestErrorOf — 429 RATE_LIMITED", () => {
  it("Retry-After 초를 문구와 막는 시간에 쓰고 같은 키로 다시 보낸다", () => {
    const error = requestErrorOf(failure(429, "RATE_LIMITED"), { ...ctx, retryAfterSec: 17 });
    expect(error.message).toBe(
      "수집 요청이 너무 잦습니다(조직당 1분에 5회). 17초 뒤 다시 시도하세요.",
    );
    expect(error.retryAfterSec).toBe(17);
    expect(error.renewKey).toBe(false);
  });

  it("Retry-After 가 없으면 60초다", () => {
    const error = requestErrorOf(failure(429, "RATE_LIMITED"), ctx);
    expect(error.message).toBe(
      "수집 요청이 너무 잦습니다(조직당 1분에 5회). 60초 뒤 다시 시도하세요.",
    );
    expect(error.retryAfterSec).toBe(60);
  });

  it("429 가 아니면 retryAfterSec 을 싣지 않는다", () => {
    expect(
      requestErrorOf(failure(500, "INTERNAL_ERROR"), { ...ctx, retryAfterSec: 9 }),
    ).not.toHaveProperty("retryAfterSec");
  });
});

describe("requestErrorOf — 401·403", () => {
  it("401 은 세션 만료 문구와 [로그인]이다", () => {
    const error = requestErrorOf(failure(401, "UNAUTHENTICATED"), ctx);
    expect(error.message).toBe("로그인이 만료되었습니다. 다시 로그인하세요.");
    expect(error.action).toEqual({ kind: "login" });
  });

  it("403 FORBIDDEN 은 ADMIN 역할 문구이고 단추가 없다", () => {
    const error = requestErrorOf(failure(403, "FORBIDDEN"), ctx);
    expect(error.message).toBe("이 작업을 할 권한이 없습니다. 업무 역할이 ADMIN이어야 합니다.");
    expect(error).not.toHaveProperty("action");
  });

  it("403 CSRF_REJECTED 는 새로 고침 문구와 [새로 고침]이다", () => {
    const error = requestErrorOf(failure(403, "CSRF_REJECTED"), ctx);
    expect(error.message).toBe("요청을 확인하지 못했습니다. 화면을 새로 고친 뒤 다시 시도하세요.");
    expect(error.action).toEqual({ kind: "refresh" });
  });
});

describe("requestErrorOf — 500·503·네트워크(같은 키로 다시 시도)", () => {
  it("500 은 잠시 뒤 다시 시도 문구이고 같은 키다", () => {
    const error = requestErrorOf(failure(500, "INTERNAL_ERROR"), ctx);
    expect(error.message).toBe("요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.");
    expect(error.renewKey).toBe(false);
  });

  it.each([
    ["queue", "수집 작업을 대기열에 넣지 못했습니다. Redis·worker 상태를 확인하세요."],
    ["redis", "요청 수를 확인하지 못했습니다. Redis 상태를 확인하세요."],
    ["db", "데이터베이스에 연결하지 못했습니다."],
    ["cursor", "잠시 뒤 다시 시도하세요."],
  ])("503 component=%s 문구", (component, message) => {
    const error = requestErrorOf(failure(503, "SERVICE_UNAVAILABLE", { component }), ctx);
    expect(error.message).toBe(message);
    expect(error.renewKey).toBe(false);
  });

  it("503 의 component 가 없으면 '잠시 뒤 다시 시도하세요.' 다", () => {
    expect(requestErrorOf(failure(503, "SERVICE_UNAVAILABLE"), ctx).message).toBe(
      "잠시 뒤 다시 시도하세요.",
    );
  });

  it("네트워크 오류(상태 0)는 NETWORK_MESSAGE 이고 같은 키, 요청 ID 가 없다", () => {
    const error = requestErrorOf(
      { status: 0, code: NETWORK_ERROR, message: NETWORK_MESSAGE, details: {} },
      ctx,
    );
    expect(error).toEqual({
      message: "서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도하세요.",
      renewKey: false,
    });
  });
});

describe("requestErrorOf — 공통", () => {
  it.each([
    [400, "VALIDATION_ERROR"],
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [409, "IDEMPOTENCY_KEY_REUSED"],
    [429, "RATE_LIMITED"],
    [500, "INTERNAL_ERROR"],
    [503, "SERVICE_UNAVAILABLE"],
  ])("%i %s 는 서버 message 를 보이지 않고 requestId 를 옮긴다", (status, code) => {
    const error = requestErrorOf(failure(status, code, {}, "req-42"), ctx);
    expect(error.message).not.toContain(SERVER_MESSAGE);
    expect(error.requestId).toBe("req-42");
  });

  it("requestId 가 없으면 requestId 키를 싣지 않는다", () => {
    expect(requestErrorOf(failure(500, "INTERNAL_ERROR", {}, null), ctx)).not.toHaveProperty(
      "requestId",
    );
  });

  it("표에 없는 4xx 는 다시 시도 문구이고 새 키다", () => {
    const error = requestErrorOf(failure(404, "NOT_FOUND"), ctx);
    expect(error.message).toBe("요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.");
    expect(error.renewKey).toBe(true);
  });
});
