import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cursorScope, signCursor } from "@/server/bids";
import { ingestionDeps } from "./ingestion-deps";

// 수집 관리(N8) 의존성 묶음의 실제 커서 코덱(보안 점검 후속 2026-10-20).
// 서비스·계약 시험은 가짜 코덱을 쓰므로 "다른 조직 커서 거절"(보안 L3, 계획 §1 GET 목록)이 진짜 HMAC 코덱에서도
// 성립하는지는 여기서 본다. 비밀은 env(API_CURSOR_SECRET)에서 읽고 32자 미만이면 코덱이 없다(O9 → 목록 503 cursor).
// Redis·BullMQ 는 만들기만 하고 부르지 않는다. 연결하려 하면 가짜 생성자가 기록하고 던진다(실제 Redis 에 붙지 않는다).

const connections = vi.hoisted(() => ({ redis: vi.fn(), queue: vi.fn() }));
vi.mock("ioredis", async (original) => {
  class BlockedRedis {
    constructor(...args: unknown[]) {
      connections.redis(...args);
      throw new Error("시험에서 Redis 에 연결하지 않는다");
    }
  }
  return { ...(await original<object>()), Redis: BlockedRedis, default: BlockedRedis };
});
vi.mock("bullmq", async (original) => {
  class BlockedQueue {
    constructor(...args: unknown[]) {
      connections.queue(...args);
      throw new Error("시험에서 BullMQ Queue 를 만들지 않는다");
    }
  }
  return { ...(await original<object>()), Queue: BlockedQueue };
});

const ORG_A = "0f000000-0000-4000-8000-000000000001";
const ORG_B = "0f000000-0000-4000-8000-000000000002";
const SECRET = "c".repeat(32);
const OTHER_SECRET = "d".repeat(32);
const NOW = new Date("2026-10-20T03:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const POSITION = {
  startedAt: "2026-10-20T01:00:00.000Z",
  id: "a8000000-0000-4000-8000-0000000000a1",
};

// 비밀이 있으면 코덱이 있어야 한다. 없으면 시험의 전제가 틀린 것이다.
function codecOf(orgId: string) {
  const cursor = ingestionDeps(orgId).cursor;
  if (cursor === null) throw new Error("커서 비밀을 넣었는데 코덱이 없다");
  return cursor;
}

// 같은 비밀로 ingestionRuns 가 아닌 지문(종류·조직이 다른)을 넣어 서명한 커서
const foreignCursor = (fingerprint: string, sortValue: string | number = POSITION.startedAt) =>
  signCursor(
    { sortValue, id: POSITION.id, queryFingerprint: fingerprint, issuedAt: NOW.getTime() },
    SECRET,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("API_CURSOR_SECRET", SECRET);
  vi.stubEnv("SOL_RUN_MODE", "mock");
  // 연결을 시도하면 위 가짜 생성자가 잡는다
  vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6399");
  connections.redis.mockClear();
  connections.queue.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("ingestionDeps — 커서 코덱의 조직 묶음(보안 L3)", () => {
  it("같은 조직의 코덱이 서명한 커서는 다음 요청에서 같은 위치로 되돌린다", () => {
    const token = codecOf(ORG_A).sign(POSITION);

    expect(codecOf(ORG_A).verify(token)).toStrictEqual(POSITION);
  });

  it("조직 A 가 받은 커서를 조직 B 의 코덱은 null 로 거절한다", () => {
    const token = codecOf(ORG_A).sign(POSITION);

    expect(codecOf(ORG_B).verify(token)).toBeNull();
  });

  it("조직 B 가 받은 커서도 조직 A 의 코덱은 null 로 거절한다", () => {
    const token = codecOf(ORG_B).sign(POSITION);

    expect(codecOf(ORG_A).verify(token)).toBeNull();
    expect(codecOf(ORG_B).verify(token)).toStrictEqual(POSITION);
  });

  it("조직을 넣지 않고 만든 ingestionRuns 커서는 거절한다(지문에 조직이 들어간다)", () => {
    expect(codecOf(ORG_A).verify(foreignCursor(cursorScope("ingestionRuns", [])))).toBeNull();
  });

  it.each(["notifications", "bids", "analyses"] as const)(
    "같은 조직·같은 비밀이라도 %s 커서는 거절한다(종류가 지문에 들어간다)",
    (kind) => {
      expect(codecOf(ORG_A).verify(foreignCursor(cursorScope(kind, [ORG_A])))).toBeNull();
    },
  );

  it("지금 조직의 ingestionRuns 지문으로 같은 비밀이 서명하면 받는다(위 거절 시험의 대조군)", () => {
    expect(
      codecOf(ORG_A).verify(foreignCursor(cursorScope("ingestionRuns", [ORG_A]))),
    ).toStrictEqual(POSITION);
  });

  it("다른 비밀로 서명한 커서는 거절한다(비밀을 바꾸면 이전 커서는 무효)", () => {
    const token = codecOf(ORG_A).sign(POSITION);
    vi.stubEnv("API_CURSOR_SECRET", OTHER_SECRET);

    expect(codecOf(ORG_A).verify(token)).toBeNull();
  });

  it("본문을 바꾼 커서는 서명이 맞지 않아 거절한다", () => {
    const [, signature] = codecOf(ORG_A).sign(POSITION).split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({
        sortValue: POSITION.startedAt,
        id: "a8000000-0000-4000-8000-0000000000ff",
        queryFingerprint: cursorScope("ingestionRuns", [ORG_A]),
        issuedAt: NOW.getTime(),
      }),
      "utf8",
    ).toString("base64url");

    expect(codecOf(ORG_A).verify(`${forgedBody}.${signature}`)).toBeNull();
  });

  it("발급 24시간이 되면 거절한다(1ms 전에는 받는다, 기준은 지금 시각)", () => {
    const token = codecOf(ORG_A).sign(POSITION);

    vi.setSystemTime(NOW.getTime() + DAY_MS - 1);
    expect(codecOf(ORG_A).verify(token)).toStrictEqual(POSITION);
    vi.setSystemTime(NOW.getTime() + DAY_MS);
    expect(codecOf(ORG_A).verify(token)).toBeNull();
  });

  it("위치의 정렬값이 문자열(started_at)이 아니면 null 이다", () => {
    const token = foreignCursor(cursorScope("ingestionRuns", [ORG_A]), 1_760_000_000_000);

    expect(codecOf(ORG_A).verify(token)).toBeNull();
  });
});

describe("ingestionDeps — 커서 비밀(API_CURSOR_SECRET)", () => {
  it("비밀이 없으면 cursor 는 null 이다(목록은 503 {component:cursor})", () => {
    vi.stubEnv("API_CURSOR_SECRET", undefined);

    expect(ingestionDeps(ORG_A).cursor).toBeNull();
  });

  it.each([
    ["빈 문자열", ""],
    ["31자", "s".repeat(31)],
    ["공백뿐 40자", " ".repeat(40)],
    ["앞뒤 공백을 떼면 31자", `  ${"s".repeat(31)}  `],
  ])("비밀이 %s 이면 cursor 는 null 이다", (_label, value) => {
    vi.stubEnv("API_CURSOR_SECRET", value);

    expect(ingestionDeps(ORG_A).cursor).toBeNull();
  });

  it("비밀이 정확히 32자면 코덱이 있고 서명·검증이 된다(경계)", () => {
    vi.stubEnv("API_CURSOR_SECRET", "s".repeat(32));

    const token = codecOf(ORG_A).sign(POSITION);

    expect(codecOf(ORG_A).verify(token)).toStrictEqual(POSITION);
  });
});

describe("ingestionDeps — 만들기만 하고 연결하지 않는다", () => {
  it("묶음을 만들고 커서를 서명·검증해도 Redis 연결·BullMQ Queue 를 만들지 않는다", () => {
    const a = ingestionDeps(ORG_A);
    const b = ingestionDeps(ORG_B);
    const token = codecOf(ORG_A).sign(POSITION);
    codecOf(ORG_B).verify(token);

    expect(a.queue.enqueue).toEqual(expect.any(Function));
    expect(b.idempotency.get).toEqual(expect.any(Function));
    expect(a.limiter.hit).toEqual(expect.any(Function));
    expect(connections.redis).not.toHaveBeenCalled();
    expect(connections.queue).not.toHaveBeenCalled();
  });

  it("REDIS_URL 이 없어도 묶음을 만들고 커서는 그대로 쓴다(연결은 부를 때 한다)", () => {
    vi.stubEnv("REDIS_URL", undefined);

    const token = codecOf(ORG_A).sign(POSITION);

    expect(codecOf(ORG_A).verify(token)).toStrictEqual(POSITION);
    expect(connections.redis).not.toHaveBeenCalled();
    expect(connections.queue).not.toHaveBeenCalled();
  });
});
