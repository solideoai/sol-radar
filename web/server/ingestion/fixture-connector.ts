import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  BidSourceConnector,
  ConnectorFailure,
  FetchPageOutcome,
  SourceRecord,
} from "./connector.model";
import {
  fixtureFileSchema,
  fixtureManifestSchema,
  type FixtureBatch,
  type FixtureFile,
  type FixtureManifest,
} from "./fixture.model";

// ── FixtureConnector: 저장소의 fixtures/ 를 페이지로 읽는다. 네트워크를 부르지 않는다(07 §2.1, §6) ──
export const FIXTURE_RATE_LIMIT_FAILURES = 2;
export const FIXTURE_RETRY_AFTER_SEC = 2;

const CURSOR_PATTERN = /^\d+$/;

/** 07 §7: 잘못된 manifest 는 조용히 건너뛰지 않고 기동을 멈춘다. */
export async function loadFixtureManifest(fixturesDir: string): Promise<FixtureManifest> {
  const path = join(fixturesDir, "manifest.yaml");
  try {
    return fixtureManifestSchema.parse(parseYaml(await readFile(path, "utf8")));
  } catch (error) {
    throw new Error(`fixture manifest 를 읽을 수 없다: ${path}`, { cause: error });
  }
}

const fixtureInvalid = (detail: string): FetchPageOutcome => ({
  ok: false,
  failure: { kind: "FIXTURE_INVALID", detail },
});

const RATE_LIMITED: ConnectorFailure = {
  kind: "RATE_LIMITED",
  status: 429,
  retryAfterSec: FIXTURE_RETRY_AFTER_SEC,
  detail: "fixture rate limit",
};

// 읽기·JSON·스키마·id 불일치는 모두 "그 fixture 가 잘못됐다" 한 가지 실패다. 원인은 파일을 열어 보면 안다.
async function readFixtureFile(fixturesDir: string, id: string): Promise<FixtureFile | null> {
  try {
    const parsed = fixtureFileSchema.safeParse(
      JSON.parse(await readFile(join(fixturesDir, "bids", `${id}.json`), "utf8")),
    );
    return parsed.success && parsed.data.fixtureId === id ? parsed.data : null;
  } catch {
    return null;
  }
}

function cursorIndex(cursor: string | null, size: number): number | null {
  if (cursor === null) return 0;
  if (!CURSOR_PATTERN.test(cursor)) return null;
  const index = Number(cursor);
  return index < size ? index : null;
}

export function createFixtureConnector(options: {
  fixturesDir: string;
  batch: FixtureBatch;
  manifest: FixtureManifest;
}): BidSourceConnector {
  const { fixturesDir, batch } = options;
  const ids = [...options.manifest.batches[batch]];
  // 429 흉내(FX-20)는 connector 인스턴스마다 처음부터 센다. 재시도 시험이 인스턴스를 새로 만들면 다시 2번 실패한다.
  const rateLimitedCalls = new Map<string, number>();

  return {
    source: "fixture",
    async fetchPage({ cursor }) {
      if (ids.length === 0 && cursor === null) {
        return { ok: true, page: { records: [], nextCursor: null, rateLimitInfo: null } };
      }
      const index = cursorIndex(cursor, ids.length);
      if (index === null) return fixtureInvalid("fixture cursor: invalid");
      const id = ids[index];

      const file = await readFixtureFile(fixturesDir, id);
      if (!file) return fixtureInvalid(`fixture ${id}: invalid`);

      if (file.connectorBehavior === "rate-limit-then-ok") {
        const calls = rateLimitedCalls.get(id) ?? 0;
        if (calls < FIXTURE_RATE_LIMIT_FAILURES) {
          rateLimitedCalls.set(id, calls + 1);
          return { ok: false, failure: { ...RATE_LIMITED } };
        }
      }

      const records: SourceRecord[] = file.records
        .filter((record) => record.ingestBatch === batch)
        .map((record): SourceRecord => ({ kind: "fixture", fixtureId: id, record }));
      const nextCursor = index + 1 < ids.length ? String(index + 1) : null;
      return { ok: true, page: { records, nextCursor, rateLimitInfo: null } };
    },
  };
}
