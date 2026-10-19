// 시험 전용 도우미(사전 분석 C5-B, `pnpm demo:preanalyze`). 제품 코드가 import 하지 않는다.
// 1. 데모 seed 의 행 계획 함수(scripts/demo/plan.mjs)로 seed 가 넣는 bid_notices·bid_revisions 행을 만들고
//    store.listDemoBids 가 돌려줄 모양(DemoBidRow)으로 잇는다. 대상 목록을 시험에 박지 않고 seed 계획에서 얻는다.
// 2. 가짜 PostgREST(store.test-support) 위에서 bid_notices·bid_revisions 읽기에 답하는 라우트.
//    질의 모양(두 표를 따로 읽기·임베드)을 시험이 정하지 않도록 eq·neq·in·is 필터와 임베드(!inner 포함)를 흉내 낸다.
//    모르는 연산자면 FAKE_UNSUPPORTED_FILTER 오류로 답해 시험이 조용히 통과하지 않게 한다.
import { fileURLToPath } from "node:url";
import { loadDemoBidFixtures } from "@test-harness/demo-bid-notices.mjs";
import { bidUuid, planSeedBatch, revisionUuid, toBidRows } from "@test-harness/demo-plan.mjs";
import type { DemoBidRow, PreanalyzeTarget } from "./preanalyze.model";
import {
  SEED_ANCHOR,
  postgrestError,
  type PostgrestCall,
  type PostgrestReply,
  type PostgrestRoute,
} from "./store.test-support";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const seedPlan = planSeedBatch(await loadDemoBidFixtures(REPO_ROOT), { anchor: SEED_ANCHOR });
const seedRows = toBidRows(seedPlan);

type SeedCreated = { fixtureId: string; bidId: string; revisionId: string };
const seeded: SeedCreated[] = seedPlan.created.map(
  ({ fixtureId, bidId, revisionId }: SeedCreated) => ({ fixtureId, bidId, revisionId }),
);

/** seed 가 적재한 공고의 fixtureId(manifest SEED 순서, FX-12 는 격리라 없다). */
export const SEEDED_FIXTURE_IDS: readonly string[] = seeded.map((bid) => bid.fixtureId);

export type NoticeRow = Record<string, unknown> & {
  id: string;
  source: string;
  is_demo: boolean;
  latest_revision: number;
  title: string;
};
export type RevisionRow = Record<string, unknown> & {
  id: string;
  bid_id: string;
  revision: number;
  raw_payload: unknown;
};
export type BidTables = { notices: NoticeRow[]; revisions: RevisionRow[] };

const cloneJson = <T>(value: T): T => structuredClone(value);

/** seed 가 넣는 bid_notices·bid_revisions 행(부를 때마다 새 객체). */
export function seedBidTables(): BidTables {
  const notices: NoticeRow[] = seedRows.notices.map((row: NoticeRow) => cloneJson(row));
  const revisions: RevisionRow[] = seedRows.revisions.map((row: RevisionRow) => cloneJson(row));
  return { notices, revisions };
}

/** 두 표의 행을 listDemoBids 가 돌려줄 DemoBidRow 로 잇는다(revision 행마다 한 행). */
export function toDemoBidRows(tables: BidTables): DemoBidRow[] {
  return tables.revisions.flatMap((revision) => {
    const notice = tables.notices.find((row) => row.id === revision.bid_id);
    if (notice === undefined) return [];
    return [
      {
        bidId: revision.bid_id,
        revisionId: revision.id,
        revision: revision.revision,
        rawPayload: cloneJson(revision.raw_payload),
        latestRevision: notice.latest_revision,
      },
    ];
  });
}

/** seed 와 같은 데모 공고 행(19건, 모두 r1·latestRevision 1). */
export function seedDemoBidRows(): DemoBidRow[] {
  return toDemoBidRows(seedBidTables());
}

/** seed 가 그 fixture 로 넣은 DemoBidRow. */
export function seedDemoBidRow(fixtureId: string): DemoBidRow {
  const bid = seeded.find((entry) => entry.fixtureId === fixtureId);
  const row = seedDemoBidRows().find((entry) => entry.revisionId === bid?.revisionId);
  if (row === undefined) throw new Error(`seed 에 적재되지 않은 fixture: ${fixtureId}`);
  return row;
}

/** seed 적재 공고 전부(제외 없이)를 사전 분석 대상 모양으로. 기대값은 여기서 뺄 것을 뺀다. */
export function seedTargets(): PreanalyzeTarget[] {
  return seeded.map((bid) => ({
    bidId: bid.bidId,
    revisionId: bid.revisionId,
    fixtureId: bid.fixtureId,
    revision: 1,
  }));
}

/** seed 공고의 원문(제목·본문). 로그에 새면 안 된다. */
export function seedBidTexts(): string[] {
  return seedRows.revisions.flatMap((row: RevisionRow) => {
    const payload = row.raw_payload;
    if (typeof payload !== "object" || payload === null) return [];
    return ["title", "content"].flatMap((key) => {
      const value: unknown = Reflect.get(payload, key);
      return typeof value === "string" && value.trim() !== "" ? [value] : [];
    });
  });
}

/** 그 fixture 공고에 revision 2 를 더하고 latest_revision 을 2 로 올린다(S5 정정 뒤 모양). */
export function withRevision2(tables: BidTables, fixtureId: string): BidTables {
  const bid = seeded.find((entry) => entry.fixtureId === fixtureId);
  const notice = tables.notices.find((row) => row.id === bid?.bidId);
  const r1 = tables.revisions.find((row) => row.id === bid?.revisionId);
  if (notice === undefined || r1 === undefined) throw new Error(`seed 공고가 없다: ${fixtureId}`);
  const r2: RevisionRow = {
    ...cloneJson(r1),
    id: revisionUuid("fixture", String(notice.notice_id), 2),
    revision: 2,
  };
  return {
    notices: tables.notices.map((row) =>
      row.id === notice.id ? { ...row, latest_revision: 2 } : row,
    ),
    revisions: [...tables.revisions, r2],
  };
}

/** g2b 공고(raw_payload 에 fixtureId 가 없다) */
export const G2B_BID_ID: string = bidUuid("g2b", "R26BK90000001");
/** 데모가 아닌 fixture 공고 */
export const NON_DEMO_BID_ID: string = bidUuid("fixture", "NOT-DEMO-0001");

/**
 * 사전 분석 대상이 아닌 공고 두 건을 더한다. 각 필터를 따로 보려고 g2b 공고는 is_demo=true,
 * 데모가 아닌 공고는 source=fixture 이고 fixtureId 모양의 값을 갖는다.
 */
export function withForeignBids(tables: BidTables): BidTables {
  const base = tables.notices[0];
  const notices: NoticeRow[] = [
    { ...base, id: G2B_BID_ID, source: "g2b", notice_id: "R26BK90000001", is_demo: true },
    { ...base, id: NON_DEMO_BID_ID, source: "fixture", notice_id: "NOT-DEMO-0001", is_demo: false },
  ];
  const revisions: RevisionRow[] = [
    {
      ...tables.revisions[0],
      id: revisionUuid("g2b", "R26BK90000001", 1),
      bid_id: G2B_BID_ID,
      revision: 1,
      raw_payload: { bidNtceNo: "R26BK90000001", bidNtceOrd: "000", bidNtceNm: "가상 g2b 공고" },
    },
    {
      ...tables.revisions[0],
      id: revisionUuid("fixture", "NOT-DEMO-0001", 1),
      bid_id: NON_DEMO_BID_ID,
      revision: 1,
      raw_payload: { fixtureId: "FX-21", title: "데모가 아닌 공고" },
    },
  ];
  return {
    notices: [...tables.notices, ...notices],
    revisions: [...tables.revisions, ...revisions],
  };
}

// ── 가짜 PostgREST: bid_notices·bid_revisions 읽기 ──

const NON_FILTER_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

type Embed = { key: string; table: "bid_notices" | "bid_revisions"; inner: boolean };

/** select 의 임베드 하나("alias:bid_notices!inner(…)" 등). 없으면 null. */
function embedOf(select: string): Embed | null {
  const match = /(?:([A-Za-z_]\w*):)?(bid_notices|bid_revisions)((?:!\w+)*)\(/.exec(select);
  if (match === null) return null;
  const table = match[2] === "bid_notices" ? "bid_notices" : "bid_revisions";
  return { key: match[1] ?? table, table, inner: match[3].split("!").includes("inner") };
}

/** PostgREST 필터 하나. 모르는 연산자면 null. */
function matchesFilter(
  row: Record<string, unknown>,
  column: string,
  filter: string,
): boolean | null {
  const cell = row[column];
  const text = cell === null || cell === undefined ? null : String(cell);
  if (filter.startsWith("eq.")) return text === filter.slice("eq.".length);
  if (filter.startsWith("neq.")) return text !== filter.slice("neq.".length);
  if (filter.startsWith("is.")) {
    const value = filter.slice("is.".length);
    return value === "null" ? text === null : text === value;
  }
  if (filter.startsWith("in.(") && filter.endsWith(")")) {
    const values = filter
      .slice("in.(".length, -1)
      .split(",")
      .map((item) => item.replace(/^"|"$/g, ""));
    return text !== null && values.includes(text);
  }
  return null;
}

/** 필터를 모두 만족하는가. 모르는 연산자가 있으면 null. */
function matchesAll(row: Record<string, unknown>, filters: [string, string][]): boolean | null {
  let all = true;
  for (const [column, filter] of filters) {
    const result = matchesFilter(row, column, filter);
    if (result === null) return null;
    all = all && result;
  }
  return all;
}

function replyRows(call: PostgrestCall, rows: unknown[]): PostgrestReply {
  if (!call.accept.includes("vnd.pgrst.object+json")) return { status: 200, body: rows };
  return rows.length === 1 ? { status: 200, body: rows[0] } : postgrestError("PGRST116", 406);
}

/** bid_notices·bid_revisions GET 에 그 표의 행으로 답한다. 다른 요청은 다음 라우트로 넘긴다. */
export function bidTablesRoute(tables: BidTables): PostgrestRoute {
  return (call) => {
    if (call.method !== "GET") return undefined;
    if (call.table !== "bid_notices" && call.table !== "bid_revisions") return undefined;
    const embed = embedOf(call.params.get("select") ?? "");
    const filters = [...call.params.entries()].filter(([key]) => !NON_FILTER_PARAMS.has(key));
    const own = filters.filter(([key]) => !key.includes("."));
    const nested = filters.filter(([key]) => key.includes("."));
    const prefix = embed === null ? null : `${embed.key}.`;
    if (nested.some(([key]) => prefix === null || !key.startsWith(prefix))) {
      return postgrestError("FAKE_UNSUPPORTED_FILTER");
    }
    const nestedOwn = nested.map(([key, value]): [string, string] => [
      key.slice(prefix?.length ?? 0),
      value,
    ]);
    const base: Record<string, unknown>[] =
      call.table === "bid_notices" ? tables.notices : tables.revisions;
    const rows: unknown[] = [];
    for (const row of base) {
      const kept = matchesAll(row, own);
      if (kept === null) return postgrestError("FAKE_UNSUPPORTED_FILTER");
      if (!kept) continue;
      if (embed === null) {
        rows.push(cloneJson(row));
        continue;
      }
      const related: Record<string, unknown>[] =
        embed.table === "bid_notices"
          ? tables.notices.filter((notice) => notice.id === row.bid_id)
          : tables.revisions.filter((revision) => revision.bid_id === row.id);
      const matched: Record<string, unknown>[] = [];
      for (const candidate of related) {
        const ok = matchesAll(candidate, nestedOwn);
        if (ok === null) return postgrestError("FAKE_UNSUPPORTED_FILTER");
        if (ok) matched.push(cloneJson(candidate));
      }
      if (embed.table === "bid_notices") {
        // 다대일 임베드는 객체 하나(없으면 null)다.
        const one = matched[0] ?? null;
        if (embed.inner && one === null) continue;
        rows.push({ ...cloneJson(row), [embed.key]: one });
      } else {
        if (embed.inner && matched.length === 0) continue;
        rows.push({ ...cloneJson(row), [embed.key]: matched });
      }
    }
    return replyRows(call, rows);
  };
}
