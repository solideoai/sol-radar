import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES } from "@/server/bids";
import { lazyJsonBody, readJsonBody } from "./work-route";

// 보안 L5: 업무 POST 본문 상한. Content-Length 와 실제로 읽은 바이트를 둘 다 본다.
// 스트림 본문은 Node 가 duplex:"half" 를 요구한다. lib.dom 의 RequestInit 에는 그 칸이 없어 더해 적는다.
const post = (body: BodyInit | null, headers: Record<string, string> = {}) => {
  const init: RequestInit & { duplex: "half" } = { method: "POST", body, headers, duplex: "half" };
  return new Request("https://app.example/api/v1/x", init);
};

// Content-Length 없이 조각으로 오는 본문(chunked)
const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });

describe("readJsonBody", () => {
  it("비었으면 {} 이고, JSON 이 아니면 글자 그대로 넘긴다", async () => {
    expect(await readJsonBody(post(null))).toEqual({ ok: true, value: {} });
    expect(await readJsonBody(post("  "))).toEqual({ ok: true, value: {} });
    expect(await readJsonBody(post('{"force":true}'))).toEqual({
      ok: true,
      value: { force: true },
    });
    expect(await readJsonBody(post("{not json"))).toEqual({ ok: true, value: "{not json" });
  });

  it("상한(16KB)과 같은 본문은 받고, 1바이트 넘으면 거절한다", async () => {
    expect(MAX_BODY_BYTES).toBe(16 * 1024);
    const exact = `{}${" ".repeat(MAX_BODY_BYTES - 2)}`;
    expect(await readJsonBody(post(exact))).toEqual({ ok: true, value: {} });
    expect(await readJsonBody(post(`${exact} `))).toEqual({ ok: false });
  });

  it("글자 수가 아니라 바이트로 잰다", async () => {
    // "가" 는 UTF-8 로 3바이트다. 글자는 상한보다 적어도 바이트는 넘는다.
    const korean = JSON.stringify("가".repeat(Math.ceil(MAX_BODY_BYTES / 3)));
    expect(korean.length).toBeLessThan(MAX_BODY_BYTES);
    expect(await readJsonBody(post(korean))).toEqual({ ok: false });
  });

  it("Content-Length 가 상한을 넘으면 본문을 읽지 않고 거절한다", async () => {
    const request = post("{}", { "Content-Length": String(MAX_BODY_BYTES + 1) });
    expect(await readJsonBody(request)).toEqual({ ok: false });
    expect(request.bodyUsed).toBe(false);
  });

  it("Content-Length 없이 조각으로 와도 읽은 바이트가 넘으면 거절한다", async () => {
    const half = "x".repeat(MAX_BODY_BYTES / 2);
    expect(await readJsonBody(post(streamOf(`"${half}`, `${half}"`)))).toEqual({ ok: false });
    expect(await readJsonBody(post(streamOf('{"force":', "true}")))).toEqual({
      ok: true,
      value: { force: true },
    });
  });
});

describe("lazyJsonBody", () => {
  it("Content-Length 만으로 큰 본문을 알고, 읽기는 부를 때 한다", async () => {
    const big = post("{}", { "Content-Length": String(MAX_BODY_BYTES + 1) });
    const lazy = lazyJsonBody(big);
    expect(lazy.declaredTooLarge).toBe(true);
    expect(big.bodyUsed).toBe(false);

    const small = post('{"force":true}', { "Content-Length": "14" });
    const ok = lazyJsonBody(small);
    expect(ok.declaredTooLarge).toBe(false);
    expect(small.bodyUsed).toBe(false);
    expect(await ok.read()).toEqual({ ok: true, value: { force: true } });
  });

  it("숫자가 아닌 Content-Length 는 선언으로 보지 않고 실제 길이로 잰다", async () => {
    const lazy = lazyJsonBody(post("{}", { "Content-Length": "abc" }));
    expect(lazy.declaredTooLarge).toBe(false);
  });
});
