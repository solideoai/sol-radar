import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readKevWire } from "./analysis.model";
import type { KevResponse } from "./gateway.model";

// 결정 모델 서버(services/decision)의 원본 응답 본문은 gateway 를 그대로 지나 wire 로 오고, worker 는 그것을
// kevMockResponseSchema 로 다시 검사한다. 사본은 그 서버의 시험(tests/test_worker_compat.py)이 FakeBackend·seed 0 으로
// 만든 v0.2 responses 다. 두 쪽 시험이 같은 파일을 읽으므로, 서버 출력 모양이 바뀌면 여기서 함께 깨진다.
// 2026-10-20: fit.legend 를 배열로 내던 결함(모든 /kev 응답이 WIRE_INVALID)이 이 경로에서만 보였다.
const SAMPLE_URL = new URL(
  "../../../services/decision/tests/fixtures/worker-wire-sample.json",
  import.meta.url,
);

type Sample = { responses: Record<string, unknown> };

function loadSample(): Sample {
  return JSON.parse(readFileSync(fileURLToPath(SAMPLE_URL), "utf8")) as Sample;
}

function kevResponseWith(wireBody: Record<string, unknown>): KevResponse {
  return {
    kev: {
      enabled: true,
      provider: "local",
      model: "Hanno-Labs/bosun-v3.1-0.6b@5e78a37c",
      questionSetVersion: "kev-qs/v0.2",
      requestId: "req-decision-sample",
    },
    stateHash: "0".repeat(64),
    requirements: null,
    wire: [wireBody],
    timings: { kevMs: 3 },
    errorCode: null,
  };
}

describe("결정 모델 서버 원본 wire ↔ worker kevMockResponseSchema", () => {
  it("서버 사본(v0.2, 질문 13개)을 readKevWire 가 그대로 읽는다", () => {
    const sample = loadSample();
    const reading = readKevWire(kevResponseWith({ responses: sample.responses }));
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    const { fit, recommendation } = reading.kevWire.responses;
    expect(Object.keys(fit.legend)).toEqual(["0", "1", "2", "3", "4"]);
    expect(Object.keys(fit.probabilities)).toEqual(["0", "1", "2", "3", "4"]);
    expect(fit.score).toBeGreaterThanOrEqual(0);
    expect(fit.score).toBeLessThanOrEqual(4);
    expect(["BID", "WATCH", "NO_BID"]).toContain(recommendation.choice);
    expect(reading.kevWire.provider).toBe("local");
    expect(reading.kevWire.model).toBe("Hanno-Labs/bosun-v3.1-0.6b@5e78a37c");
  });

  it("fit.legend 가 배열이면 거부한다(회귀: WIRE_INVALID 원인)", () => {
    const sample = loadSample();
    const fit = sample.responses.fit as Record<string, unknown>;
    const legendAsArray = Object.values(fit.legend as Record<string, string>);
    const reading = readKevWire(
      kevResponseWith({
        responses: { ...sample.responses, fit: { ...fit, legend: legendAsArray } },
      }),
    );
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.issues).toContain("responses.fit.legend: invalid_type");
  });

  it("사본에는 worker 가 요구하는 네 답과 v0.2 항목 질문이 함께 있다", () => {
    const sample = loadSample();
    const qids = Object.keys(sample.responses);
    expect(qids).toEqual(
      expect.arrayContaining(["recommendation", "mandatoryRisk", "needsHumanReview", "fit"]),
    );
    expect(qids.some((qid) => qid.startsWith("req.") && qid.endsWith(".status"))).toBe(true);
  });
});
