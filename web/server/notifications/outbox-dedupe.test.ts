import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createSupabaseIngestionRepo,
  decideRevision,
  fixtureFileSchema,
  normalizeFixtureRecord,
  type FixtureRecord,
  type IngestionRepo,
} from "@/server/ingestion";
import { createNotificationOutboxStore, processOutboxBatch } from "@/server/notifications";
import {
  asAdminTask,
  asServiceRole,
  createMigratedDb,
  pgliteSupabase,
  type SqlDb,
} from "./outbox-db.test-support";
import {
  ASSIGNEE_ID,
  EVENT_ID,
  NOW,
  OTHER_EVENT_ID,
  REQUESTER_ID,
  analysisCompleteEvent,
  createMemoryStore,
  memoryRow,
  reviewAssignedEvent,
} from "./outbox.test-support";

// G2 — 마감일 변경 → 알림 정확히 1건, 재전송해도 1건(docs/11-TESTING.md G2, docs/13-NOTIFICATIONS.md "두 단계 멱등성").
// 1) 이벤트 단위: outbox_events.idempotency_key = source + noticeId + revision + eventType(UNIQUE). 같은 변경이 두 번 와도 이벤트는 하나다.
//    FX-06(마감 +14d → +28d)을 C3 수집 경로(변경 감지 decideRevision + 실제 Supabase 저장소 → ingest_save_revision)로
//    실제 마이그레이션을 올린 PGlite 에 넣는다. 저장소의 PostgREST 요청은 PGlite 다리(outbox-db.test-support)가 받는다.
// 2) 알림 단계: notifications.idempotency_key = outboxEventId + userId + channel(UNIQUE). 같은 이벤트를 다시 처리해도 알림은 하나다.
//    메모리 저장(UNIQUE 흉내)과, PGlite 의 실제 트리거·finish_score_run·notifications UNIQUE 둘 다로 본다.
// 3) C7 소비자는 두 종(REVIEW_ASSIGNED·ANALYSIS_COMPLETE)만 고른다. 공고 이벤트(BID_CREATED·BID_CHANGED)는 PENDING 그대로다.

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
// KST 2026-10-19 12:00(revision-diff.test 와 같은 기준)
const ANCHOR = new Date("2026-10-19T03:00:00.000Z");
const SEED_AT = new Date("2026-10-19T03:05:00.000Z");
const LIVE_AT = new Date("2026-10-19T06:00:00.000Z");
const RESEND_AT = new Date("2026-10-19T06:30:00.000Z");

// C3 revision.ts 의 이벤트 멱등키 `${source}:${noticeId}:${revision}:${eventType}`(07 §5).
const FX06_NOTICE_ID = "DEMO-2026-0006";
const FX06_CREATED_KEY = `fixture:${FX06_NOTICE_ID}:1:BID_CREATED`;
const FX06_CHANGED_KEY = `fixture:${FX06_NOTICE_ID}:2:BID_CHANGED`;

const recordOf = (batch: "SEED" | "LIVE"): FixtureRecord => {
  const file = fixtureFileSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES_DIR, "bids", "FX-06.json"), "utf8")),
  );
  const record = file.records.find((candidate) => candidate.ingestBatch === batch);
  if (!record) throw new Error(`FX-06 에 ${batch} 레코드가 없다`);
  return record;
};

/**
 * C3 수집 흐름(ingestion.service 의 ingestRecord)에서 레코드 하나를 저장하는 부분과 같다 — 정규화 → 저장된 최신 revision 읽기
 * → 변경 감지 → 중복·이전 차수면 저장하지 않고, 아니면 saveRevision(ingest_save_revision 한 트랜잭션).
 */
async function ingestOnce(repo: IngestionRepo, batch: "SEED" | "LIVE", fetchedAt: Date) {
  const record = recordOf(batch);
  const outcome = normalizeFixtureRecord(record, { fetchedAt, anchor: ANCHOR });
  if (!outcome.ok) throw new Error(`FX-06 ${batch} 정규화 실패: ${outcome.issue.code}`);
  const { draft } = outcome;
  const previous = await repo.findLatestRevision(draft.source, draft.noticeId);
  const decision = decideRevision(previous, draft);
  if (decision.kind === "DUPLICATE" || decision.kind === "STALE") return { decision, saved: null };
  const saved = await repo.saveRevision({
    decision,
    rawPayload: { fixtureId: "FX-06", ...record },
  });
  return { decision, saved };
}

type OutboxDbRow = {
  id: string;
  org_id: string | null;
  event_type: string;
  idempotency_key: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
};

async function outboxRows(db: SqlDb, eventType?: string): Promise<OutboxDbRow[]> {
  await asAdminTask(db);
  const { rows } = await db.query<OutboxDbRow>(
    `select id, org_id, event_type, idempotency_key, status, attempts, payload
       from public.outbox_events where ($1::text is null or event_type = $1) order by created_at, id`,
    [eventType ?? null],
  );
  return rows;
}

async function countOf(db: SqlDb, table: string): Promise<number> {
  await asAdminTask(db);
  const { rows } = await db.query<{ count: number }>(
    `select count(*)::int as count from public.${table}`,
  );
  return rows[0]?.count ?? -1;
}

// ── 알림 단계 멱등(메모리 저장) ──

describe("G2 알림 단계 멱등 — 메모리 저장(notifications.idempotency_key UNIQUE 흉내)", () => {
  const runBatch = (store: ReturnType<typeof createMemoryStore>["store"]) =>
    processOutboxBatch({ store, now: () => NOW, log: () => undefined, limit: 50 });

  it.each([
    ["REVIEW_ASSIGNED", reviewAssignedEvent()],
    ["ANALYSIS_COMPLETE", analysisCompleteEvent("COMPLETED")],
  ] as const)(
    "같은 %s outbox 를 처리한 뒤 PENDING 으로 되돌려 다시 처리해도 알림은 1건이다",
    async (_label, event) => {
      const memory = createMemoryStore({ events: [memoryRow(event)] });
      await runBatch(memory.store);
      memory.resetToPending(EVENT_ID);
      await runBatch(memory.store);
      expect(memory.notifications).toHaveLength(1);
    },
  );

  it("다시 처리한 회차도 그 이벤트를 sent 로 세고 PROCESSED 로 닫는다", async () => {
    const memory = createMemoryStore({ events: [memoryRow(reviewAssignedEvent())] });
    await runBatch(memory.store);
    memory.resetToPending(EVENT_ID);
    await expect(runBatch(memory.store)).resolves.toMatchObject({ checked: 1, sent: 1 });
    expect(memory.eventOf(EVENT_ID).status).toBe("PROCESSED");
  });

  it("두 처리자가 같은 이벤트를 동시에 처리해도 알림은 1건이고 outbox 는 PROCESSED 다", async () => {
    const memory = createMemoryStore({ events: [memoryRow(reviewAssignedEvent())] });
    await Promise.all([runBatch(memory.store), runBatch(memory.store)]);
    expect(memory.notifications.map((row) => row.idempotency_key)).toEqual([
      `${EVENT_ID}:${ASSIGNEE_ID}:IN_APP`,
    ]);
    expect(memory.eventOf(EVENT_ID).status).toBe("PROCESSED");
  });

  it("서로 다른 이벤트는 같은 수신자에게도 각자 1건씩이다(키에 outboxEventId 가 들어간다)", async () => {
    const memory = createMemoryStore({
      events: [
        memoryRow(analysisCompleteEvent("COMPLETED"), { created_at: "2026-10-20T08:00:00.000Z" }),
        memoryRow(analysisCompleteEvent("COMPLETED", { id: OTHER_EVENT_ID }), {
          created_at: "2026-10-20T08:00:01.000Z",
        }),
      ],
    });
    await runBatch(memory.store);
    expect(memory.notifications.map((row) => row.idempotency_key)).toEqual([
      `${EVENT_ID}:${REQUESTER_ID}:IN_APP`,
      `${OTHER_EVENT_ID}:${REQUESTER_ID}:IN_APP`,
    ]);
  });
});

// ── 실제 마이그레이션(PGlite) ──

describe("G2 — 실제 마이그레이션 위(PGlite)", () => {
  // 조직 둘: ORG1 에 ADMIN(owner)·VIEWER, ORG2 에 OUTSIDER. 공고 하나·revision 하나·ORG1 회사 프로필.
  const ORG1 = "0f000000-0000-4000-8000-000000000701";
  const ORG2 = "0f000000-0000-4000-8000-000000000702";
  const ADMIN = "00000000-0000-4000-8000-000000000711";
  const VIEWER = "00000000-0000-4000-8000-000000000712";
  const OUTSIDER = "00000000-0000-4000-8000-000000000713";
  const BID = "b1d00000-0000-4000-8000-000000000701";
  const REV = "be500000-0000-4000-8000-000000000701";
  const PROFILE = "c0000000-0000-4000-8000-000000000701";
  const RUN = "a0000000-0000-4000-8000-000000000701";
  const REVIEW = "f0000000-0000-4000-8000-000000000701";
  const BID_TITLE = "G2 알림 시험 공고 (가상)";
  const ATTEMPT = "2026-10-20T08:00:00.000Z";

  let db: SqlDb;

  beforeAll(async () => {
    db = await createMigratedDb();
    await asAdminTask(db);
    for (const [id, email] of [
      [ADMIN, "admin@g2.invalid"],
      [VIEWER, "viewer@g2.invalid"],
      [OUTSIDER, "outsider@g2.invalid"],
    ]) {
      await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    }
    await db.query(
      "insert into public.organizations (id, slug, name, is_demo) values ($1, 'org-g2-1', 'G2 조직', true), ($2, 'org-g2-2', 'G2 격리 조직', true)",
      [ORG1, ORG2],
    );
    await db.query(
      "insert into public.memberships (org_id, user_id, org_role, sol_role) values ($1, $2, 'owner', 'ADMIN'), ($1, $3, 'member', 'VIEWER'), ($4, $5, 'owner', 'ADMIN')",
      [ORG1, ADMIN, VIEWER, ORG2, OUTSIDER],
    );
    await db.query(
      "insert into public.bid_notices (id, source, notice_id, title, agency, stage, status, budget_krw, source_url, content_hash, is_demo) values ($1, 'fixture', 'DEMO-2026-0701', $2, '시험기관', 'NOTICE', 'OPEN', 500000000, 'https://fixture.invalid/0701', 'hash-0701', true)",
      [BID, BID_TITLE],
    );
    await db.query(
      "insert into public.bid_revisions (id, bid_id, revision, raw_payload, normalized, checksum) values ($1, $2, 1, '{}', '{}', 'sum-0701')",
      [REV, BID],
    );
    await db.query(
      "insert into public.company_profiles (id, org_id, revision, name) values ($1, $2, 1, 'G2 조직')",
      [PROFILE, ORG1],
    );
  }, 120_000);

  afterEach(async () => {
    await asAdminTask(db);
    await db.exec(`
      delete from public.notifications;
      delete from public.outbox_events;
      delete from public.bid_reviews;
      delete from public.score_runs;
      delete from public.bid_notices where notice_id = '${FX06_NOTICE_ID}';
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  const ingestionRepo = () => createSupabaseIngestionRepo(pgliteSupabase(db).client);
  const notificationStore = () => createNotificationOutboxStore(pgliteSupabase(db).client);
  const runBatch = (now = NOW) =>
    processOutboxBatch({
      store: notificationStore(),
      now: () => now,
      log: () => undefined,
      limit: 50,
    });

  /** FX-06 SEED(revision 1) 뒤 LIVE(revision 2, 마감 변경)를 C3 경로로 넣는다. */
  async function ingestFx06(repo = ingestionRepo()) {
    const created = await ingestOnce(repo, "SEED", SEED_AT);
    const changed = await ingestOnce(repo, "LIVE", LIVE_AT);
    return { repo, created, changed };
  }

  describe("이벤트 단위 — FX-06 마감 변경", () => {
    it("SEED·LIVE 를 넣으면 C3 판정은 CREATED·CHANGED 다", async () => {
      const { created, changed } = await ingestFx06();
      expect([created.decision.kind, changed.decision.kind]).toEqual(["CREATED", "CHANGED"]);
    });

    it(`BID_CHANGED outbox 는 ${FX06_CHANGED_KEY} 키로 정확히 1건이다`, async () => {
      await ingestFx06();
      expect((await outboxRows(db, "BID_CHANGED")).map((row) => row.idempotency_key)).toEqual([
        FX06_CHANGED_KEY,
      ]);
    });

    it("BID_CHANGED payload 의 changedFields 에 deadlineAt 이 있다(revision diff)", async () => {
      await ingestFx06();
      const [changed] = await outboxRows(db, "BID_CHANGED");
      expect(changed?.payload.changedFields).toContain("deadlineAt");
    });

    it("공고 이벤트는 org_id null·PENDING·attempts 0 이다(조직 팬아웃 전)", async () => {
      await ingestFx06();
      expect(
        (await outboxRows(db)).map((row) => [
          row.idempotency_key,
          row.org_id,
          row.status,
          row.attempts,
        ]),
      ).toEqual([
        [FX06_CREATED_KEY, null, "PENDING", 0],
        [FX06_CHANGED_KEY, null, "PENDING", 0],
      ]);
    });

    it("같은 LIVE 레코드를 다시 받으면(재전송) C3 가 DUPLICATE 로 판정해 저장하지 않고 BID_CHANGED 는 1건 그대로다", async () => {
      const { repo } = await ingestFx06();
      const resent = await ingestOnce(repo, "LIVE", RESEND_AT);
      expect(resent.decision.kind).toBe("DUPLICATE");
      expect((await outboxRows(db, "BID_CHANGED")).map((row) => row.idempotency_key)).toEqual([
        FX06_CHANGED_KEY,
      ]);
    });

    it("같은 revision 2 를 같은 키로 ingest_save_revision 에 다시 보내도 BID_CHANGED 는 1건 그대로다(INGEST_REVISION_CONFLICT 로 거절)", async () => {
      const { repo, changed } = await ingestFx06();
      if (changed.decision.kind !== "CHANGED") throw new Error("CHANGED 가 아니다");
      await expect(
        repo.saveRevision({
          decision: changed.decision,
          rawPayload: { fixtureId: "FX-06", ...recordOf("LIVE") },
        }),
      ).rejects.toThrow();
      expect((await outboxRows(db, "BID_CHANGED")).map((row) => row.idempotency_key)).toEqual([
        FX06_CHANGED_KEY,
      ]);
      expect(await countOf(db, "outbox_events")).toBe(2);
    });

    it("C3 의 재전송·재저장 뒤에도 공고 이벤트 때문에 생긴 알림은 0건이다", async () => {
      const { repo } = await ingestFx06();
      await ingestOnce(repo, "LIVE", RESEND_AT);
      expect(await countOf(db, "notifications")).toBe(0);
    });
  });

  describe("공고 이벤트(BID_CREATED·BID_CHANGED)는 C7 소비자가 고르지 않는다", () => {
    it("C3 가 쓴 공고 이벤트에 알림 저장소의 findDue 를 적용하면 0건이다", async () => {
      await ingestFx06();
      await expect(
        notificationStore().findDue({ now: NOW.toISOString(), limit: 50 }),
      ).resolves.toEqual([]);
    });

    it("processOutboxBatch 를 돌려도 공고 이벤트는 PENDING·attempts 0 그대로이고 알림은 0건이다", async () => {
      await ingestFx06();
      const summary = await runBatch();
      expect(summary).toEqual({ checked: 0, sent: 0, skipped: 0, retried: 0, dead: 0 });
      expect((await outboxRows(db)).map((row) => [row.status, row.attempts])).toEqual([
        ["PENDING", 0],
        ["PENDING", 0],
      ]);
      expect(await countOf(db, "notifications")).toBe(0);
    });
  });

  describe("알림 단계 멱등 — 실제 트리거·finish_score_run·notifications UNIQUE", () => {
    /** ADMIN 이 아닌 관리 작업으로 결정을 넣는다. 담당자가 있으면 log_bid_review_audit 가 REVIEW_ASSIGNED outbox 를 쓴다. */
    async function assignReview(assignee: string) {
      await asAdminTask(db);
      await db.query(
        "insert into public.bid_reviews (id, org_id, bid_id, revision_id, assignee_id, decision, reason) values ($1, $2, $3, $4, $5, 'BID', '담당자를 정해 제안 준비를 시작한다')",
        [REVIEW, ORG1, BID, REV, assignee],
      );
    }

    /** ADMIN 이 요청한 RUNNING run 을 worker 처럼 finish_score_run 으로 마감한다(같은 트랜잭션에 ANALYSIS_COMPLETE outbox). */
    async function finishRun(status: "COMPLETED" | "PARTIAL") {
      await asAdminTask(db);
      await db.query(
        `insert into public.score_runs (id, org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version,
           run_mode, ai_provider, status, started_at, idempotency_key, requested_by)
         values ($1, $2, $3, $4, $5, 1, 'sol-v0.1.0-g2', 'MOCK', 'MOCK', 'RUNNING', $6, $7, $8)`,
        [RUN, ORG1, BID, REV, PROFILE, ATTEMPT, `${ORG1}:req-g2`, ADMIN],
      );
      await asServiceRole(db);
      await db.query("select public.finish_score_run($1::jsonb)", [
        JSON.stringify({
          score_run_id: RUN,
          org_id: ORG1,
          attempt_started_at: ATTEMPT,
          run: {
            status,
            score: 82,
            recommendation: "BID",
            recommendation_basis: "RULES_ONLY",
            error_code: status === "PARTIAL" ? "AI_UNAVAILABLE" : null,
            review_flags: status === "PARTIAL" ? ["AI_UNAVAILABLE"] : [],
            missing_factors: [],
            input_snapshot: { schemaVersion: "analysis-input/v0.1" },
            input_snapshot_hash: "snap-g2",
            finished_at: "2026-10-20T08:00:05.000Z",
          },
          factors: [],
          assessments: [],
          checks: [],
        }),
      ]);
    }

    type NotificationDbRow = {
      user_id: string;
      org_id: string;
      type: string;
      channel: string;
      status: string;
      idempotency_key: string;
      payload: Record<string, unknown>;
    };
    async function notificationRows(): Promise<NotificationDbRow[]> {
      await asAdminTask(db);
      const { rows } = await db.query<NotificationDbRow>(
        "select user_id, org_id, type, channel, status, idempotency_key, payload from public.notifications order by created_at, id",
      );
      return rows;
    }

    async function resetOutboxToPending(): Promise<void> {
      await asAdminTask(db);
      await db.query(
        "update public.outbox_events set status = 'PENDING', processed_at = null where event_type in ('REVIEW_ASSIGNED', 'ANALYSIS_COMPLETE')",
      );
    }

    it("트리거가 쓴 REVIEW_ASSIGNED 를 처리하면 배정 대상에게 알림 1건이 SENT·IN_APP 으로 들어가고 outbox 는 PROCESSED 다", async () => {
      await assignReview(VIEWER);
      const [event] = await outboxRows(db, "REVIEW_ASSIGNED");
      await runBatch();
      expect(await notificationRows()).toEqual([
        {
          user_id: VIEWER,
          org_id: ORG1,
          type: "REVIEW_ASSIGNED",
          channel: "IN_APP",
          status: "SENT",
          idempotency_key: `${event?.id}:${VIEWER}:IN_APP`,
          payload: {
            bidId: BID,
            title: BID_TITLE,
            message: "결정 담당으로 지정되었습니다.",
            link: `/bids/${BID}`,
          },
        },
      ]);
      expect((await outboxRows(db, "REVIEW_ASSIGNED")).map((row) => row.status)).toEqual([
        "PROCESSED",
      ]);
    });

    it("REVIEW_ASSIGNED 를 PENDING 으로 되돌려 다시 처리해도 알림은 1건이다(on conflict do nothing)", async () => {
      await assignReview(VIEWER);
      await runBatch();
      await resetOutboxToPending();
      await runBatch();
      expect(await countOf(db, "notifications")).toBe(1);
      expect((await outboxRows(db, "REVIEW_ASSIGNED")).map((row) => row.status)).toEqual([
        "PROCESSED",
      ]);
    });

    it("다시 처리해도 처음 넣은 알림 행을 덮지 않는다(sent_at 이 첫 처리 시각 그대로 — 병합 upsert 가 아니다)", async () => {
      await assignReview(VIEWER);
      await runBatch(NOW);
      await resetOutboxToPending();
      await runBatch(new Date("2026-10-20T10:00:00.000Z"));
      await asAdminTask(db);
      const { rows } = await db.query<{ sent_at: Date }>(
        "select sent_at from public.notifications",
      );
      expect(rows.map((row) => row.sent_at.toISOString())).toEqual([NOW.toISOString()]);
    });

    it("finish_score_run 이 쓴 ANALYSIS_COMPLETE 를 처리하면 분석 요청자에게 '분석이 끝났습니다.' 알림 1건이다", async () => {
      await finishRun("COMPLETED");
      await runBatch();
      expect(
        (await notificationRows()).map((row) => [row.user_id, row.type, row.payload.message]),
      ).toEqual([[ADMIN, "ANALYSIS_COMPLETE", "분석이 끝났습니다."]]);
    });

    it("PARTIAL 마감의 알림은 규칙만으로 분석했다는 문구다", async () => {
      await finishRun("PARTIAL");
      await runBatch();
      expect((await notificationRows()).map((row) => row.payload.message)).toEqual([
        "AI 없이 규칙만으로 분석했습니다. 결과를 확인해 주세요.",
      ]);
    });

    it("ANALYSIS_COMPLETE 를 PENDING 으로 되돌려 다시 처리해도 알림은 1건이다", async () => {
      await finishRun("COMPLETED");
      await runBatch();
      await resetOutboxToPending();
      await runBatch();
      expect(await countOf(db, "notifications")).toBe(1);
    });

    it("수신자가 이벤트 조직의 멤버가 아니면(다른 조직 사용자) 알림 0건으로 PROCESSED 다", async () => {
      await asAdminTask(db);
      await db.query(
        `insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
         values ($1, 'bid_review', $2, 'REVIEW_ASSIGNED', $3, $4)`,
        [
          ORG1,
          REVIEW,
          JSON.stringify({ reviewId: REVIEW, bidId: BID, orgId: ORG1, assigneeUserId: OUTSIDER }),
          `${REVIEW}:${OUTSIDER}:REVIEW_ASSIGNED`,
        ],
      );
      const summary = await runBatch();
      expect(summary).toMatchObject({ checked: 1, sent: 0, skipped: 1 });
      expect(await countOf(db, "notifications")).toBe(0);
      expect((await outboxRows(db, "REVIEW_ASSIGNED")).map((row) => row.status)).toEqual([
        "PROCESSED",
      ]);
    });
  });
});
