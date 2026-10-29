import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { canonicalJson, sha256Hex, snapshotHash } from "./snapshot-hash";
import { buildInput, withPatch } from "./test-support";

// 08 §8 재현성: 같은 input_snapshot_hash + algorithm_version → 같은 score·같은 요소별 points. 두 번 계산해 byte-동일.
// 11 §3.1 "중복 분석 결정 일관성".

describe("재현성 · 같은 입력 → 같은 해시 → byte-동일 결과", () => {
  for (const id of ["FX-01", "FX-02", "FX-03", "FX-04", "FX-11", "FX-15", "FX-16"]) {
    it(`${id}: 두 번 계산한 결과 JSON 과 입력 해시가 byte-동일하다`, () => {
      const first = analyze(buildInput(id));
      const second = analyze(buildInput(id));
      expect(canonicalJson(second)).toBe(canonicalJson(first));
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(second.inputSnapshotHash).toBe(first.inputSnapshotHash);
      expect(first.inputSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
      expect(first.algorithmVersion).toBe("sol-v0.2.0");
    });
  }

  it("입력을 한 글자만 바꿔도 해시가 달라진다", () => {
    const base = buildInput("FX-01");
    const changed = withPatch(base, (draft) => void (draft.bid.title = `${draft.bid.title}.`));
    expect(snapshotHash(changed)).not.toBe(snapshotHash(base));
    expect(analyze(changed).inputSnapshotHash).not.toBe(analyze(base).inputSnapshotHash);
  });

  it("키 순서가 달라도 canonical JSON 과 해시는 같다", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}',
    );
    expect(snapshotHash({ b: 1, a: 2 })).toBe(snapshotHash({ a: 2, b: 1 }));
    expect(snapshotHash({ a: 1, b: undefined })).toBe(snapshotHash({ a: 1 }));
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("분석 함수는 입력 객체를 변형하지 않는다", () => {
    const input = buildInput("FX-02");
    const before = canonicalJson(input);
    analyze(input);
    expect(canonicalJson(input)).toBe(before);
  });

  it("같은 입력의 분석 결과는 요소별 points 와 점수가 모두 같다(중복 분석 결정 일관성)", () => {
    const runs = Array.from({ length: 3 }, () => analyze(buildInput("FX-02")));
    const signatures = runs.map((run) =>
      canonicalJson({
        score: run.score,
        points: run.factors.map((factor) => factor.points),
        recommendation: run.recommendation,
      }),
    );
    expect(new Set(signatures).size).toBe(1);
  });
});
