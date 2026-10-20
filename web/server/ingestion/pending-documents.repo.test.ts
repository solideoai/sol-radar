import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createPendingDocumentFinder } from "./pending-documents.repo";

// 문서 등록 복구가 읽는 미처리 첨부 조회(C2'·C6'). 진짜 supabase-js 에 가짜 fetch 를 넣어 PostgREST 요청 URL 을 잡는다.
// 실제 Supabase 에 붙지 않는다. 필터가 DB 에서 무엇을 고르는지는 PostgREST 의 몫이라, 여기서는 보낸 조건을 본다.

const BID = "00000000-0000-4000-8000-000000000001";
const REV = "00000000-0000-4000-8000-000000000002";
const DOC = "00000000-0000-4000-8000-000000000003";
// PostgREST 가 timestamptz 를 돌려주는 모양
const REV_CREATED_AT = "2026-10-19T03:04:05.123456+00:00";
// C2': 다운로드 대기(PENDING)와 다운로드 뒤 파싱 대기(OK·PENDING)
const C2_PENDING_FILTER =
  "(download_status.eq.PENDING,and(download_status.eq.OK,parse_status.eq.PENDING))";
const SELECT = "id,bid_id,revision_id,bid_notices!inner(is_demo),bid_revisions!inner(created_at)";

const row = (id = DOC, revisionId = REV, createdAt = REV_CREATED_AT) => ({
  id,
  bid_id: BID,
  revision_id: revisionId,
  bid_notices: { is_demo: true },
  bid_revisions: { created_at: createdAt },
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** 요청 URL 을 기록하고 정한 응답을 돌려주는 supabase-js 클라이언트 */
const recordingFinder = (respond: () => Response = () => jsonResponse([row()])) => {
  const requests: URL[] = [];
  const client = createClient<Database>("https://supabase.example.invalid", "fake-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        requests.push(new URL(String(input)));
        return respond();
      },
    },
  });
  return { finder: createPendingDocumentFinder(client), requests };
};

const queryOf = (url: URL | undefined) => Object.fromEntries(url?.searchParams ?? []);

describe("createPendingDocumentFinder — 요청", () => {
  it("bid_documents 를 공고·revision 과 inner embed 해 읽는다", async () => {
    const { finder, requests } = recordingFinder();

    await finder.findPendingDocuments({ after: null, limit: 100, isDemo: true });

    expect(requests.map((url) => url.pathname)).toEqual(["/rest/v1/bid_documents"]);
    expect(requests[0]?.searchParams.get("select")).toBe(SELECT);
  });

  it.each([
    [true, "eq.true"],
    [false, "eq.false"],
  ])("isDemo %s 는 bid_notices.is_demo=%s 로 보낸다(C6')", async (isDemo, expected) => {
    const { finder, requests } = recordingFinder();

    await finder.findPendingDocuments({ after: null, limit: 100, isDemo });

    expect(requests[0]?.searchParams.getAll("bid_notices.is_demo")).toEqual([expected]);
  });

  it("다운로드 대기와 파싱 대기(OK·PENDING)를 or 로 함께 고른다(C2')", async () => {
    const { finder, requests } = recordingFinder();

    await finder.findPendingDocuments({ after: null, limit: 100, isDemo: true });

    expect(requests[0]?.searchParams.getAll("or")).toEqual([C2_PENDING_FILTER]);
  });

  it("download_status 단독 조건을 두지 않는다(OK·PENDING 행이 빠지지 않는다)", async () => {
    const { finder, requests } = recordingFinder();

    await finder.findPendingDocuments({ after: null, limit: 100, isDemo: true });

    expect(requests[0]?.searchParams.has("download_status")).toBe(false);
  });

  it("after 가 있으면 id=gt.<after> 로 그 뒤부터 읽는다", async () => {
    const { finder, requests } = recordingFinder();

    await finder.findPendingDocuments({ after: DOC, limit: 100, isDemo: true });

    expect(requests[0]?.searchParams.getAll("id")).toEqual([`gt.${DOC}`]);
  });

  it("after 가 null 이면 id 조건이 없다", async () => {
    const { finder, requests } = recordingFinder();

    await finder.findPendingDocuments({ after: null, limit: 100, isDemo: true });

    expect(requests[0]?.searchParams.has("id")).toBe(false);
  });

  it("id 오름차순으로 limit 건만 읽는다", async () => {
    const { finder, requests } = recordingFinder();

    await finder.findPendingDocuments({ after: null, limit: 37, isDemo: true });

    expect([
      requests[0]?.searchParams.get("order"),
      requests[0]?.searchParams.get("limit"),
    ]).toEqual(["id.asc", "37"]);
  });

  it("조회 조건은 select·is_demo·or·order·limit·커서뿐이다", async () => {
    const { finder, requests } = recordingFinder();

    await finder.findPendingDocuments({ after: DOC, limit: 100, isDemo: false });

    expect(queryOf(requests[0])).toEqual({
      select: SELECT,
      "bid_notices.is_demo": "eq.false",
      or: C2_PENDING_FILTER,
      order: "id.asc",
      limit: "100",
      id: `gt.${DOC}`,
    });
  });
});

describe("createPendingDocumentFinder — 응답", () => {
  it("bid_revisions.created_at 을 revisionCreatedAt 으로 싣고 embed 는 싣지 않는다", async () => {
    const otherRev = "00000000-0000-4000-8000-000000000004";
    const otherCreatedAt = "2026-10-19T03:10:00.000001+00:00";
    const { finder } = recordingFinder(() =>
      jsonResponse([row(), row("doc-2", otherRev, otherCreatedAt)]),
    );

    const found = await finder.findPendingDocuments({ after: null, limit: 100, isDemo: true });

    expect(found).toStrictEqual([
      { id: DOC, bidId: BID, revisionId: REV, revisionCreatedAt: REV_CREATED_AT },
      { id: "doc-2", bidId: BID, revisionId: otherRev, revisionCreatedAt: otherCreatedAt },
    ]);
  });

  it("빈 목록이면 빈 배열이다", async () => {
    const { finder } = recordingFinder(() => jsonResponse([]));

    await expect(
      finder.findPendingDocuments({ after: null, limit: 100, isDemo: true }),
    ).resolves.toEqual([]);
  });

  it("오류 응답이면 고정 문장으로 던지고 응답 본문을 싣지 않는다", async () => {
    const { finder } = recordingFinder(() =>
      jsonResponse(
        { code: "XX000", message: "SECRET-BODY row value", details: "SECRET-DETAILS", hint: null },
        500,
      ),
    );

    const error = await finder.findPendingDocuments({ after: null, limit: 100, isDemo: true }).then(
      () => null,
      (rejected: unknown) => rejected,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : "").toBe("문서 복구 조회 실패");
    expect(error instanceof Error ? error.cause : "Error 아님").toBeUndefined();
  });
});
