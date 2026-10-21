import "server-only";

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import type { NormalizedBid } from "./normalized-bid.model";
import { backfillProcurementRelevance, projectProcurementRevision } from "./procurement-projection";

const BID_ID = "00000000-0000-0000-0000-000000000001";
const CANDIDATE_ID = "00000000-0000-0000-0000-000000000002";
const AGENCY_ID = "00000000-0000-0000-0000-000000000003";
const REVISION_ID = "00000000-0000-0000-0000-000000000004";
const CANDIDATE_REVISION_ID = "00000000-0000-0000-0000-000000000005";

const bidOf = (changes: Partial<NormalizedBid> = {}): NormalizedBid => ({
  schemaVersion: "normalized-bid/v0.2",
  source: "g2b-bid-notice",
  noticeId: "G2B-001",
  amendmentNo: "00",
  stage: "NOTICE",
  status: "OPEN",
  title: "행정정보시스템 유지보수",
  agency: "가상 공공기관",
  budgetKrw: "100000000",
  noticeDate: "2026-10-21T00:00:00.000Z",
  deadlineAt: "2026-11-04T09:00:00.000Z",
  sourceUrl: "https://www.g2b.go.kr/notice/G2B-001",
  content: "행정정보시스템 소프트웨어 유지보수 과업을 수행한다.",
  attachments: [],
  structuredQualifications: [],
  original: {},
  isDemo: false,
  fetchedAt: "2026-10-21T00:01:00.000Z",
  revision: 1,
  checksum: "a".repeat(64),
  ...changes,
});

const createProjectionTransport = (
  options: { isCurrent?: boolean; officialAgency?: boolean; failCandidateOnce?: boolean } = {},
) => {
  const rows = new Map<string, Record<string, unknown>[]>();
  const requests: Request[] = [];
  const links: Record<string, unknown>[] = [];
  const candidate = bidOf({ source: "kwater-bid-notice", noticeId: "KW-001" });
  let hasPendingFailure = options.failCandidateOnce ?? false;
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    const url = new URL(request.url);
    const table = url.pathname.split("/").at(-1) ?? "";
    const response = (value: unknown) =>
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (table === "procurement_missing_relevance_revisions")
      return response(
        rows.has("bid_relevance_assessments")
          ? []
          : [
              {
                bid_id: BID_ID,
                revision_id: REVISION_ID,
                normalized: bidOf(),
                raw_payload: {},
              },
            ],
      );
    if (table === "link_bid_opportunity") {
      links.push((await request.json()) as Record<string, unknown>);
      return response(null);
    }
    if (table === "procurement_agencies") return response({ id: AGENCY_ID });
    if (table === "opportunity_notice_links")
      return response({ opportunity_id: "existing-opportunity" });
    if (table === "bid_notices" && request.method === "PATCH") {
      return response(options.isCurrent === false ? [] : [{ id: BID_ID }]);
    }
    if (table === "bid_notices" && request.method === "GET") {
      if (url.searchParams.has("procuring_agency_id") && !options.officialAgency)
        return response([]);
      return response(
        url.searchParams.has("notice_id") && !url.searchParams.get("notice_id")?.includes("KW-001")
          ? []
          : [{ id: CANDIDATE_ID, procuring_agency_id: options.officialAgency ? AGENCY_ID : null }],
      );
    }
    if (table === "bid_revisions")
      return response({
        id: CANDIDATE_REVISION_ID,
        normalized: candidate,
        raw_payload: {},
      });
    if (table === "bid_documents") return response([]);
    if (request.method === "POST") {
      if (table === "notice_match_candidates" && hasPendingFailure) {
        hasPendingFailure = false;
        return new Response(
          JSON.stringify({ code: "P0001", message: "internal detail withheld" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      const body: unknown = await request.json();
      const inserts = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
      const conflictKeys = (url.searchParams.get("on_conflict") ?? "").split(",");
      if (!request.headers.get("prefer")?.includes("resolution=ignore-duplicates")) {
        throw new Error("append-only projection requires idempotent insert");
      }
      const existing = rows.get(table) ?? [];
      for (const row of inserts) {
        if (!existing.some((prior) => conflictKeys.every((key) => prior[key] === row[key])))
          existing.push(row);
      }
      rows.set(table, existing);
      return response(null);
    }
    throw new Error(`Unexpected projection transport: ${request.method} ${table}`);
  };
  return {
    client: createClient<Database>("https://projection.invalid", "test-only-placeholder", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetcher },
    }),
    rows,
    requests,
    links,
  };
};

describe("revision 조달 투영", () => {
  it("같은 revision 재처리는 근거와 후보를 한 번만 저장하고 유사 제목은 합치지 않는다", async () => {
    const transport = createProjectionTransport();
    const input = {
      bidId: BID_ID,
      revisionId: REVISION_ID,
      bid: bidOf(),
      rawPayload: { dminsttCd: "00123", dminsttNm: "가상 공공기관" },
    };
    await projectProcurementRevision(transport.client, input);
    await projectProcurementRevision(transport.client, input);

    expect(transport.rows.get("bid_relevance_assessments")).toMatchObject([
      {
        revision_id: REVISION_ID,
        state: "RELEVANT",
        relevance_score: 55,
        missing_channels: ["officialIndustry", "attachment"],
      },
    ]);
    expect(transport.rows.get("bid_notice_events")).toMatchObject([
      { kind: "CREATED", revision_id: REVISION_ID },
    ]);
    expect(transport.rows.get("notice_match_candidates")).toMatchObject([
      {
        left_bid_id: BID_ID,
        right_bid_id: CANDIDATE_ID,
        outcome: "CANDIDATE",
      },
    ]);
    expect(transport.links).toEqual([]);
    const shortlists = transport.requests.filter(
      (request) =>
        request.method === "GET" && new URL(request.url).pathname.endsWith("/bid_notices"),
    );
    expect(shortlists.length).toBeGreaterThan(0);
    expect(
      shortlists.every((request) => Number(new URL(request.url).searchParams.get("limit")) <= 25),
    ).toBe(true);
  });

  it("후속 revision이 있으면 이전 metadata와 후보 연결로 현재 상태를 덮지 않는다", async () => {
    const transport = createProjectionTransport({ isCurrent: false });
    await projectProcurementRevision(transport.client, {
      bidId: BID_ID,
      revisionId: REVISION_ID,
      bid: bidOf(),
      rawPayload: {},
    });

    expect(transport.rows.get("bid_relevance_assessments")).toHaveLength(1);
    expect(transport.rows.get("notice_match_candidates")).toBeUndefined();
    expect(transport.links).toEqual([]);
  });

  it("검증된 공식 참조가 있을 때만 원본 FK를 유지하는 연결 RPC를 쓴다", async () => {
    const transport = createProjectionTransport({ officialAgency: true });
    await projectProcurementRevision(transport.client, {
      bidId: BID_ID,
      revisionId: REVISION_ID,
      bid: bidOf(),
      rawPayload: { dminsttCd: "00123", dminsttNm: "가상 공공기관" },
      officialCrossReferences: [
        {
          providerNamespace: "KWATER",
          noticeId: "KW-001",
          agencyId: AGENCY_ID,
          evidence: { sourceUrl: "https://www.g2b.go.kr/notice/G2B-001", quote: "원공고 KW-001" },
        },
      ],
    });

    expect(transport.links).toMatchObject([
      {
        p_bid_id: BID_ID,
        p_opportunity_id: "existing-opportunity",
        p_relation: "DUPLICATE",
        p_evidence: { kind: "OFFICIAL_REFERENCE" },
      },
    ]);
    expect(transport.rows.get("notice_match_candidates")).toMatchObject([
      { outcome: "CONFIRMED_DUPLICATE" },
    ]);
  });

  it("후보 저장 실패는 보완 대상으로 남기고 제한된 backfill 재시도로 복구한다", async () => {
    const transport = createProjectionTransport({ failCandidateOnce: true });
    await expect(
      projectProcurementRevision(transport.client, {
        bidId: BID_ID,
        revisionId: REVISION_ID,
        bid: bidOf(),
        rawPayload: {},
      }),
    ).rejects.toThrow("notice_match_candidates");
    expect(transport.rows.get("bid_relevance_assessments")).toBeUndefined();

    expect(await backfillProcurementRelevance(transport.client, 1000)).toEqual({ processed: 1 });
    expect(transport.rows.get("bid_relevance_assessments")).toHaveLength(1);
    expect(transport.rows.get("notice_match_candidates")).toHaveLength(1);
    const request = transport.requests.find((entry) =>
      new URL(entry.url).pathname.endsWith("/procurement_missing_relevance_revisions"),
    );
    expect(await request?.json()).toEqual({ p_limit: 100 });
  });
});
