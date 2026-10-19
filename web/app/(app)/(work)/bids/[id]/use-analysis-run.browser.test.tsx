import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useAnalysisRun, type RunState } from "./use-analysis-run";

// 분석 실행 + polling 훅(스펙 §5.4.2 분석 실행 흐름). 가짜 타이머로 시각을 움직이고 fetch 는 가짜로 바꾼다.
// 화면 이동(router.refresh)·상단바 다시 읽기·토스트는 가짜로 바꾸고 부른 횟수만 잰다.

const spies = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    router: { refresh, push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
    refresh,
    topbar: vi.fn(() => Promise.resolve()),
    toast: vi.fn(),
  };
});
vi.mock("next/navigation", () => ({ __esModule: true, useRouter: () => spies.router }));
vi.mock("@/components/topbar-status", () => ({ refreshTopbarStatus: spies.topbar }));
vi.mock("sonner", () => ({ toast: spies.toast }));

const BID = "6b1d6d1e-6a3c-4c1f-9f5a-2b0c3d4e5f60";
const RUN = "0f1e2d3c-4b5a-4968-8776-655443322110";
const OTHER_RUN = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 응답 본문은 정해진 값으로 바로 풀리게 한다. 진짜 본문 읽기는 가짜 타이머 밖의 일이라 polling 횟수가 흔들린다.
function reply(status: number, body: unknown): Response {
  const response = new Response(null, {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": "req-head" },
  });
  Object.defineProperty(response, "json", { value: () => Promise.resolve(body) });
  return response;
}
const accepted = (status = "QUEUED", deduplicated = false, id = RUN) =>
  reply(202, { analysisId: id, status, deduplicated, pollUrl: `/api/v1/analyses/${id}` });
const analysis = (status: string, id = RUN) =>
  reply(200, { id, status, solScore: 72, recommendation: "WATCH" });
const failure = (status: number, code: string, details: Record<string, unknown> = {}) =>
  reply(status, { error: { code, message: "서버 문장", details, requestId: "req-1" } });

const fetchMock = vi.fn<typeof fetch>();
let posts: (() => Response)[] = [];
let poll: (url: string) => Response = () => analysis("RUNNING");

const postCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
const pollCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method !== "POST");

type Run = ReturnType<typeof useAnalysisRun>;
const latest: { current: Run | null } = { current: null };
const run = (): Run => {
  if (latest.current === null) throw new Error("훅이 그려지지 않았다");
  return latest.current;
};
const state = (): RunState => run().state;

// 훅의 마지막 반환값을 시험이 읽을 수 있게 그린 뒤(effect) 밖으로 내보낸다. act 가 effect 까지 끝낸 뒤 돌아온다.
function Harness({ active }: { active?: { id: string; status: "QUEUED" | "RUNNING" } | null }) {
  const value = useAnalysisRun(BID, { active });
  useEffect(() => {
    latest.current = value;
  });
  return null;
}

let root: Root | null = null;
const mount = async (active?: { id: string; status: "QUEUED" | "RUNNING" } | null) => {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Harness active={active} />));
};
const unmount = async () => {
  await act(async () => root?.unmount());
  root = null;
};
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const start = (force = false) => act(() => run().start(force));

const actFlag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
beforeAll(() => {
  actFlag.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  actFlag.IS_REACT_ACT_ENVIRONMENT = false;
});

beforeEach(() => {
  // React 의 일 순서(MessageChannel)는 그대로 두고, 훅이 쓰는 타이머와 시각만 가짜로 바꾼다.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  posts = [];
  poll = () => analysis("RUNNING");
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method === "POST") {
      const next = posts.shift();
      if (next === undefined) throw new Error("예상하지 못한 POST");
      return next();
    }
    return poll(String(input));
  });
  vi.stubGlobal("fetch", fetchMock);
  spies.refresh.mockReset();
  spies.topbar.mockClear();
  spies.toast.mockReset();
});
afterEach(async () => {
  if (root !== null) await unmount();
  latest.current = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useAnalysisRun 요청", () => {
  it("start(false) 는 CSRF 머리글·UUID 키·{force:false} 본문으로 POST 한다", async () => {
    await mount();
    posts.push(() => accepted());
    await start(false);
    expect(postCalls()).toHaveLength(1);
    const [url, init] = postCalls()[0]!;
    expect(url).toBe(`/api/v1/bids/${BID}/analyses`);
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Requested-With")).toBe("sol-radar");
    expect(headers.get("Idempotency-Key")).toMatch(UUID);
    expect(init?.body).toBe('{"force":false}');
    expect(state()).toEqual({ phase: "polling", status: "QUEUED", delayed: false });
  });

  it("start(true) 의 본문은 {force:true} 다", async () => {
    await mount();
    posts.push(() => accepted());
    await start(true);
    expect(postCalls()[0]?.[1]?.body).toBe('{"force":true}');
  });

  it("첫 POST 가 네트워크 오류면 같은 키로 한 번만 다시 보낸다", async () => {
    await mount();
    posts.push(
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => accepted(),
    );
    await start(false);
    const keys = postCalls().map(([, init]) => new Headers(init?.headers).get("Idempotency-Key"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(UUID);
    expect(keys[1]).toBe(keys[0]);
    expect(state()).toMatchObject({ phase: "polling" });
  });

  it("두 번 모두 네트워크 오류면 멈추고 NETWORK_ERROR 다", async () => {
    await mount();
    const offline = () => {
      throw new TypeError("Failed to fetch");
    };
    posts.push(offline, offline);
    await start(false);
    expect(postCalls()).toHaveLength(2);
    expect(state()).toMatchObject({ phase: "error", code: "NETWORK_ERROR" });
  });

  it("클릭마다 새 키를 만든다", async () => {
    await mount();
    posts.push(
      () => failure(429, "RATE_LIMITED"),
      () => accepted(),
    );
    await start(false);
    await start(false);
    const keys = postCalls().map(([, init]) => new Headers(init?.headers).get("Idempotency-Key"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("진행 중에 start 를 두 번 더 불러도 POST 는 1회다", async () => {
    await mount();
    posts.push(() => accepted());
    await act(async () => {
      void run().start(false);
      void run().start(false);
    });
    await start(true);
    expect(postCalls()).toHaveLength(1);
  });

  it("POST 가 403 이면 멈추고 오류 봉투를 옮긴다. 그 뒤에는 다시 누를 수 있다", async () => {
    await mount();
    posts.push(
      () => failure(403, "FORBIDDEN"),
      () => accepted(),
    );
    await start(false);
    expect(state()).toEqual({
      phase: "error",
      code: "FORBIDDEN",
      message: "서버 문장",
      requestId: "req-1",
    });
    await advance(10_000);
    expect(pollCalls()).toHaveLength(0);
    await start(false);
    expect(postCalls()).toHaveLength(2);
  });

  it("409 ANALYSIS_IN_PROGRESS 면 details.analysisId 를 polling 한다", async () => {
    await mount();
    posts.push(() => failure(409, "ANALYSIS_IN_PROGRESS", { analysisId: OTHER_RUN }));
    await start(true);
    expect(state()).toMatchObject({ phase: "polling", delayed: false });
    await advance(2_000);
    expect(pollCalls().map(([url]) => url)).toEqual([`/api/v1/analyses/${OTHER_RUN}`]);
  });
});

describe("useAnalysisRun polling", () => {
  it("60초 동안 2초 간격, 그 뒤 5초 간격으로 읽고 300초가 지나면 delayed 로 멈춘다", async () => {
    await mount();
    posts.push(() => accepted());
    await start(false);
    await advance(59_000);
    expect(pollCalls().length).toBeGreaterThanOrEqual(29);
    expect(pollCalls().length).toBeLessThanOrEqual(30);
    expect(pollCalls()[0]?.[0]).toBe(`/api/v1/analyses/${RUN}`);

    await advance(1_000);
    const at60 = pollCalls().length;
    await advance(4_999);
    expect(pollCalls()).toHaveLength(at60);
    await advance(1);
    expect(pollCalls()).toHaveLength(at60 + 1);

    await advance(300_000 - 65_000);
    expect(state()).toEqual({ phase: "polling", status: "RUNNING", delayed: true });
    const stopped = pollCalls().length;
    await advance(120_000);
    expect(pollCalls()).toHaveLength(stopped);
  });

  it("COMPLETED 면 router.refresh 1회, 상단바는 다시 읽지 않고 결과를 남긴다", async () => {
    await mount();
    posts.push(() => accepted());
    poll = () => analysis("COMPLETED");
    await start(false);
    await advance(2_000);
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    expect(spies.topbar).not.toHaveBeenCalled();
    expect(state()).toEqual({
      phase: "idle",
      finished: { status: "COMPLETED", solScore: 72, recommendation: "WATCH" },
    });
    await advance(30_000);
    expect(pollCalls()).toHaveLength(1);
    expect(spies.toast).not.toHaveBeenCalled();
  });

  it("PARTIAL 이면 refreshTopbarStatus 를 1회 부른다", async () => {
    await mount();
    posts.push(() => accepted());
    poll = () => analysis("PARTIAL");
    await start(false);
    await advance(2_000);
    expect(spies.topbar).toHaveBeenCalledTimes(1);
    expect(spies.refresh).toHaveBeenCalledTimes(1);
  });

  it("FAILED 여도 refreshTopbarStatus 를 1회 부른다", async () => {
    await mount();
    posts.push(() => accepted());
    poll = () => analysis("FAILED");
    await start(false);
    await advance(2_000);
    expect(spies.topbar).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ phase: "idle", finished: { status: "FAILED" } });
  });

  it("RUNNING 이 되면 상태를 바꾸고 계속 읽는다", async () => {
    await mount();
    posts.push(() => accepted());
    await start(false);
    expect(state()).toMatchObject({ status: "QUEUED" });
    await advance(2_000);
    expect(state()).toMatchObject({ phase: "polling", status: "RUNNING" });
  });

  it("deduplicated + 종료 상태면 polling 없이 다시 그리고 토스트를 띄운다", async () => {
    await mount();
    posts.push(() => accepted("COMPLETED", true));
    await start(false);
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    expect(spies.toast).toHaveBeenCalledWith("같은 입력으로 끝난 분석을 보여 줍니다");
    await advance(10_000);
    expect(pollCalls()).toHaveLength(0);
    expect(state()).toMatchObject({ phase: "idle" });
  });

  it("deduplicated 라도 진행 중이면 그 run 을 polling 하고 토스트는 없다", async () => {
    await mount();
    posts.push(() => accepted("RUNNING", true));
    await start(false);
    await advance(2_000);
    expect(pollCalls()).toHaveLength(1);
    expect(spies.toast).not.toHaveBeenCalled();
  });

  it("poll 이 401 이면 멈추고 code 가 UNAUTHENTICATED 다", async () => {
    await mount();
    posts.push(() => accepted());
    poll = () => failure(401, "UNAUTHENTICATED");
    await start(false);
    await advance(2_000);
    expect(state()).toMatchObject({ phase: "error", code: "UNAUTHENTICATED" });
    await advance(60_000);
    expect(pollCalls()).toHaveLength(1);
  });

  it("poll 이 404·403 이어도 멈춘다. 봉투가 없으면 상태 코드로 code 를 정한다", async () => {
    await mount();
    posts.push(() => accepted());
    poll = () => reply(404, null);
    await start(false);
    await advance(2_000);
    expect(state()).toMatchObject({ phase: "error", code: "NOT_FOUND" });
    await advance(30_000);
    expect(pollCalls()).toHaveLength(1);
  });

  it("poll 이 잠깐 실패(503·네트워크)하면 멈추지 않고 다음 간격에 다시 읽는다", async () => {
    await mount();
    posts.push(() => accepted());
    const replies: (() => Response)[] = [
      () => failure(503, "SERVICE_UNAVAILABLE"),
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => analysis("COMPLETED"),
    ];
    poll = () => (replies.shift() ?? (() => analysis("COMPLETED")))();
    await start(false);
    await advance(6_000);
    expect(pollCalls()).toHaveLength(3);
    expect(spies.refresh).toHaveBeenCalledTimes(1);
  });

  it("언마운트하면 타이머를 지워 더 읽지 않는다", async () => {
    await mount();
    posts.push(() => accepted());
    await start(false);
    await unmount();
    await advance(60_000);
    expect(pollCalls()).toHaveLength(0);
  });
});

describe("useAnalysisRun 이어 읽기", () => {
  it("서버가 진행 중인 run 을 주면 POST 없이 그 run 을 polling 한다", async () => {
    await mount({ id: RUN, status: "RUNNING" });
    expect(state()).toEqual({ phase: "polling", status: "RUNNING", delayed: false });
    poll = () => analysis("COMPLETED");
    await advance(2_000);
    expect(postCalls()).toHaveLength(0);
    expect(pollCalls().map(([url]) => url)).toEqual([`/api/v1/analyses/${RUN}`]);
    expect(spies.refresh).toHaveBeenCalledTimes(1);
  });

  it("이어 읽는 중에는 start 를 무시한다", async () => {
    await mount({ id: RUN, status: "QUEUED" });
    await start(true);
    expect(postCalls()).toHaveLength(0);
  });

  it("지연으로 멈춘 뒤 refresh 는 화면을 다시 그리고, 아직 진행 중이면 다시 읽기 시작한다", async () => {
    await mount({ id: RUN, status: "RUNNING" });
    await advance(300_000);
    expect(state()).toMatchObject({ phase: "polling", delayed: true });
    const before = pollCalls().length;
    await act(async () => run().refresh());
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    await advance(2_000);
    expect(pollCalls()).toHaveLength(before + 1);
  });
});
