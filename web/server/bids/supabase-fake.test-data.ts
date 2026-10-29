import "server-only";
import type { BidListItemRow } from "./bid-row.mapper";

// 저장소 시험용 가짜 Supabase 클라이언트. 질의마다 대상(표 이름 또는 `rpc:<함수>`)과 체인 호출을
// {method, args} 배열로 남기고, 시험이 정해 둔 응답을 돌려준다. SQL·RLS 는 흉내 내지 않는다
// (정책은 scripts/database.test.mjs 가 PGlite 로 본다).
//
// 쓰는 법: vi.mock("@/server/supabase", async () => ({ getSupabase: async () => (await import("./supabase-fake.test-data")).fakeDb.client }))

export type FakeCall = { method: string; args: unknown[] };
export type FakeQuery = { target: string; calls: FakeCall[] };
export type FakeResult = { data?: unknown; error?: unknown; count?: number | null };
type Responder = (query: FakeQuery) => FakeResult | undefined;
type Settled = { data: unknown; error: unknown; count: number | null };

const queries: FakeQuery[] = [];
const responders: { target: string; respond: Responder }[] = [];

function settle(query: FakeQuery): Settled {
  for (const { target, respond } of responders) {
    if (target !== query.target) continue;
    const result = respond(query);
    if (result !== undefined) {
      return {
        data: result.data ?? null,
        error: result.error ?? null,
        count: result.count ?? null,
      };
    }
  }
  return { data: null, error: null, count: null };
}

// 체인의 어느 지점에서 await 해도 같은 질의의 응답이 온다.
function builder(query: FakeQuery): object {
  const chain: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: Settled) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(settle(query)).then(resolve, reject);
        }
        if (typeof prop !== "string") return undefined;
        return (...args: unknown[]) => {
          query.calls.push({ method: prop, args });
          return chain;
        };
      },
    },
  );
  return chain;
}

const start = (target: string, calls: FakeCall[]): object => {
  const query = { target, calls };
  queries.push(query);
  return builder(query);
};

export const callsOf = (query: FakeQuery, method: string): unknown[][] =>
  query.calls.filter((call) => call.method === method).map((call) => call.args);

export const isSingle = (query: FakeQuery): boolean =>
  query.calls.some((call) => call.method === "maybeSingle" || call.method === "single");

export const fakeDb = {
  client: {
    from: (table: string) => start(table, []),
    rpc: (fn: string, args: unknown) => start(`rpc:${fn}`, [{ method: "rpc", args: [fn, args] }]),
  },
  // 이 대상의 질의에 응답한다. 함수가 undefined 를 돌려주면 다음 응답자로 넘어간다.
  on(target: string, respond: FakeResult | Responder): void {
    responders.push({
      target,
      respond: typeof respond === "function" ? respond : () => respond,
    });
  },
  // 행 목록 응답. maybeSingle·single 질의면 첫 행(없으면 null)을 준다.
  rows(rows: unknown[]): Responder {
    return (query) => ({ data: isSingle(query) ? (rows[0] ?? null) : rows });
  },
  queries(target: string): FakeQuery[] {
    return queries.filter((query) => query.target === target);
  },
  reset(): void {
    queries.length = 0;
    responders.length = 0;
  },
};

// PostgREST 논리 목록(or=(…))을 최상위 쉼표로 나눈다. 큰따옴표 안의 글자와 역슬래시 이스케이프,
// 괄호 안의 쉼표는 나누지 않는다. PostgREST 의 파서와 같은 규칙이다(QueryParams.hs pQuotedValue).
export function topLevelParts(list: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i];
    if (quoted && ch === "\\") {
      current += ch + (list[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "(") depth += 1;
    else if (!quoted && ch === ")") depth -= 1;
    else if (!quoted && depth === 0 && ch === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

// 큰따옴표로 감싼 값을 PostgREST 가 읽는 대로 푼다: `\X` 는 X 한 글자가 된다.
export function unquote(quoted: string): string {
  if (!quoted.startsWith('"') || !quoted.endsWith('"') || quoted.length < 2) {
    throw new Error(`큰따옴표 값이 아니다: ${quoted}`);
  }
  const body = quoted.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\\") {
      out += body[i + 1] ?? "";
      i += 1;
    } else if (ch === '"') {
      throw new Error(`이스케이프하지 않은 큰따옴표: ${quoted}`);
    } else {
      out += ch;
    }
  }
  return out;
}

// 뷰 bid_list_items 한 행(분석·결정 없음). 시험이 필요한 열만 덮어쓴다.
export function listRow(patch: Partial<BidListItemRow> = {}): BidListItemRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    source: "G2B",
    notice_id: "N-1",
    title: "공고",
    agency: "기관",
    stage: "NOTICE",
    status: "OPEN",
    budget_krw: 1200000000,
    budget_krw_text: "1200000000",
    published_at: "2026-10-16T00:00:00+00:00",
    deadline_at: "2026-12-01T00:00:00+00:00",
    latest_revision: 2,
    plan_ref: null,
    is_demo: true,
    source_url: "https://example.com/n1",
    last_synced_at: "2026-10-16T00:00:00+00:00",
    docs_total: 0,
    docs_pending: 0,
    docs_parsed: 0,
    docs_partial: 0,
    docs_unsupported: 0,
    docs_failed: 0,
    docs_download_failed: 0,
    latest_run_id: null,
    latest_run_status: null,
    latest_run_score: null,
    latest_run_recommendation: null,
    latest_run_basis: null,
    latest_run_flags: null,
    latest_run_created_at: null,
    scored_recommendation: null,
    scored_score: null,
    latest_decision: null,
    latest_decided_at: null,
    latest_reviewer_display_name: null,
    latest_reviewer_email: null,
    it_scope: true,
    ...patch,
  };
}
