import { describe, expect, it, vi } from "vitest";
import {
  DOCUMENTS_JOB_NAME,
  DOCUMENTS_QUEUE,
  INGEST_JOB_NAME,
  INGEST_QUEUE,
  INGEST_WINDOW_FUTURE_TOLERANCE_MS,
  documentsJobDataSchema,
  enqueueDocuments,
  enqueueIngestRun,
  ingestJobDataSchema,
  ingestJobDataSchemaAt,
  toBullJobId,
  type IngestJobData,
  type JobQueue,
} from "./ingestion.queue";

// 수집·첨부 큐(C3 계약 6-4·7-1·7-5). job data 규칙은 05 IngestionRunInput 검증과 같다:
// fixture 는 batch 필수·window 금지, g2b 는 batch 금지·window 최대 7일. SCHEDULED g2b 는 window 를 생략할 수 있다.
// 7-5: MANUAL 은 orgId·requestedBy 둘 다 필수. 7-1: window.to ≤ now + 5분 은 ingestJobDataSchemaAt(now) 가 본다.

const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const USER_ID = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const BID_ID = "00000000-0000-4000-8000-000000000001";
const REVISION_ID = "00000000-0000-4000-8000-000000000002";
const DAY_MS = 24 * 60 * 60 * 1000;
const FROM = "2026-10-18T15:00:00.000Z";
const isoAfter = (base: string, ms: number): string =>
  new Date(Date.parse(base) + ms).toISOString();
const FIVE_MINUTES_MS = 5 * 60_000;
// enqueue 시험의 기준 시각. G2B_MANUAL 창(… ~ 2026-10-19T15:00Z)보다 뒤라 시각 상한에 걸리지 않는다.
const ENQUEUE_NOW = new Date("2026-10-20T00:00:00.000Z");

const FIXTURE_SEED = {
  source: "fixture",
  batch: "SEED",
  trigger: "DEMO",
  jobKey: "fixture:SEED:demo-reset",
};
const G2B_MANUAL = {
  source: "g2b",
  trigger: "MANUAL",
  jobKey: "g2b:MANUAL:20261019",
  window: { from: FROM, to: isoAfter(FROM, DAY_MS) },
  idempotencyKey: "idem-20261019-1",
  requestedBy: USER_ID,
  orgId: ORG_ID,
};
const G2B_SCHEDULED = { source: "g2b", trigger: "SCHEDULED", jobKey: "g2b:SCHEDULED" };
// worker 가 일정 실행마다 만드는 jobKey(g2b:SCHEDULED:<to ISO>). ":" 조각이 5개다.
const ISO_JOB_KEY = "g2b:SCHEDULED:2026-10-19T03:00:00.000Z";

// BullMQ 6.3.16 의 사용자 jobId 검사(web/node_modules/bullmq/dist/cjs/classes/job.js:905-912)를 그대로 옮긴 것.
// 정수 문자열은 거부, ":" 가 있으면 split(":") 이 3조각일 때만 받는다.
const bullAcceptsJobId = (jobId: string): boolean =>
  `${parseInt(jobId, 10)}` !== jobId && (!jobId.includes(":") || jobId.split(":").length === 3);

const fakeQueue = () => {
  const add = vi.fn<JobQueue["add"]>(async () => undefined);
  const queue: JobQueue = { add };
  return { queue, add };
};

describe("큐 상수", () => {
  it("수집 큐는 ingest·run, 첨부 큐는 documents·fetch 다", () => {
    expect([INGEST_QUEUE, INGEST_JOB_NAME, DOCUMENTS_QUEUE, DOCUMENTS_JOB_NAME]).toEqual([
      "ingest",
      "run",
      "documents",
      "fetch",
    ]);
  });
});

describe("ingestJobDataSchema — 받는 data", () => {
  it.each([
    ["fixture SEED", FIXTURE_SEED],
    ["fixture LIVE", { ...FIXTURE_SEED, batch: "LIVE", jobKey: "fixture:LIVE:demo" }],
    ["g2b MANUAL(window·요청자·조직·멱등키)", G2B_MANUAL],
    ["g2b SCHEDULED, window 없음", G2B_SCHEDULED],
    ["g2b SCHEDULED, window 있음", { ...G2B_SCHEDULED, window: G2B_MANUAL.window }],
    [
      "g2b window 정확히 7일",
      { ...G2B_MANUAL, window: { from: FROM, to: isoAfter(FROM, 7 * DAY_MS) } },
    ],
    ["SCHEDULED 에 orgId·requestedBy 없음(7-5 선택)", G2B_SCHEDULED],
    ["SCHEDULED 에 orgId 만 있음(7-5 선택)", { ...G2B_SCHEDULED, orgId: ORG_ID }],
    ["DEMO fixture 에 requestedBy 만 있음(7-5 선택)", { ...FIXTURE_SEED, requestedBy: USER_ID }],
  ])("%s 는 통과한다", (_label, data) => {
    expect(ingestJobDataSchema.safeParse(data).success).toBe(true);
  });
});

describe("ingestJobDataSchema — 거부하는 data", () => {
  const { batch: _batch, ...fixtureWithoutBatch } = FIXTURE_SEED;
  void _batch;
  const { jobKey: _jobKey, ...withoutJobKey } = FIXTURE_SEED;
  void _jobKey;
  const { orgId: _orgId, ...manualWithoutOrg } = G2B_MANUAL;
  void _orgId;
  const { requestedBy: _requestedBy, ...manualWithoutRequester } = G2B_MANUAL;
  void _requestedBy;
  const { orgId: _o, requestedBy: _r, ...manualWithoutBoth } = G2B_MANUAL;
  void _o;
  void _r;

  it.each([
    ["fixture 에 batch 없음", fixtureWithoutBatch],
    ["fixture 에 window 있음", { ...FIXTURE_SEED, window: G2B_MANUAL.window }],
    ["g2b 에 batch 있음", { ...G2B_MANUAL, batch: "SEED" }],
    ["batch 가 SEED·LIVE 밖(소문자 seed)", { ...FIXTURE_SEED, batch: "seed" }],
    [
      "window.from 이 ISO 가 아님",
      { ...G2B_MANUAL, window: { from: "어제", to: G2B_MANUAL.window.to } },
    ],
    ["window.to 가 ISO 가 아님", { ...G2B_MANUAL, window: { from: FROM, to: "지금" } }],
    [
      "window 가 7일을 넘음",
      { ...G2B_MANUAL, window: { from: FROM, to: isoAfter(FROM, 7 * DAY_MS + 60_000) } },
    ],
    ["requestedBy 가 uuid 아님", { ...G2B_MANUAL, requestedBy: "user-1" }],
    ["orgId 가 uuid 아님", { ...G2B_MANUAL, orgId: "org-1" }],
    ["jobKey 가 빈 문자열", { ...FIXTURE_SEED, jobKey: "" }],
    ["jobKey 없음", withoutJobKey],
    ["source 가 둘 밖", { ...G2B_SCHEDULED, source: "nara" }],
    ["trigger 가 셋 밖", { ...G2B_SCHEDULED, trigger: "CRON" }],
    ["idempotencyKey 가 문자열 아님", { ...G2B_MANUAL, idempotencyKey: 1 }],
    ["모르는 키", { ...FIXTURE_SEED, stages: ["NOTICE"] }],
    ["MANUAL 에 orgId 없음(7-5)", manualWithoutOrg],
    ["MANUAL 에 requestedBy 없음(7-5)", manualWithoutRequester],
    ["MANUAL 에 orgId·requestedBy 둘 다 없음(7-5)", manualWithoutBoth],
  ])("%s 면 거부한다", (_label, data) => {
    expect(ingestJobDataSchema.safeParse(data).success).toBe(false);
  });
});

describe("ingestJobDataSchema — 시각과 무관한 검사만 한다(7-1)", () => {
  it("window.to 가 먼 미래여도 시각 없는 스키마는 통과한다", () => {
    const window = { from: "2099-01-01T00:00:00.000Z", to: "2099-01-02T00:00:00.000Z" };

    expect(ingestJobDataSchema.safeParse({ ...G2B_MANUAL, window }).success).toBe(true);
  });
});

describe("ingestJobDataSchemaAt(now) — window.to 시각 상한(7-1)", () => {
  const NOW = new Date("2026-10-19T09:37:45.123Z");
  const nowIso = NOW.toISOString();
  const manualEndingAt = (to: string) => ({
    ...G2B_MANUAL,
    window: { from: isoAfter(to, -DAY_MS), to },
  });

  it("허용 오차는 5분이다", () => {
    expect(INGEST_WINDOW_FUTURE_TOLERANCE_MS).toBe(FIVE_MINUTES_MS);
  });

  it.each([
    ["now 보다 앞", isoAfter(nowIso, -60_000)],
    ["now 와 같음", nowIso],
    ["now + 5분 정확히", isoAfter(nowIso, FIVE_MINUTES_MS)],
  ])("window.to 가 %s 이면 통과한다", (_label, to) => {
    expect(ingestJobDataSchemaAt(NOW).safeParse(manualEndingAt(to)).success).toBe(true);
  });

  it.each([
    ["now + 5분 + 1ms", isoAfter(nowIso, FIVE_MINUTES_MS + 1)],
    ["now + 1일", isoAfter(nowIso, DAY_MS)],
  ])("window.to 가 %s 이면 거부한다", (_label, to) => {
    expect(ingestJobDataSchemaAt(NOW).safeParse(manualEndingAt(to)).success).toBe(false);
  });

  it("window 없는 SCHEDULED 는 시각과 상관없이 통과한다", () => {
    expect(ingestJobDataSchemaAt(NOW).safeParse(G2B_SCHEDULED).success).toBe(true);
  });

  it("시각 상한 말고 기존 규칙(fixture 에 window 금지)도 그대로 본다", () => {
    const fixtureWithWindow = {
      ...FIXTURE_SEED,
      window: { from: isoAfter(nowIso, -DAY_MS), to: nowIso },
    };

    expect(ingestJobDataSchemaAt(NOW).safeParse(fixtureWithWindow).success).toBe(false);
  });

  it("시각 상한 말고 7-5 규칙(MANUAL 에 orgId 필수)도 그대로 본다", () => {
    const { orgId: _orgId, ...withoutOrg } = manualEndingAt(nowIso);
    void _orgId;

    expect(ingestJobDataSchemaAt(NOW).safeParse(withoutOrg).success).toBe(false);
  });
});

describe("toBullJobId", () => {
  const KEYS = [ISO_JOB_KEY, "fixture:SEED:demo-reset", "g2b:MANUAL:20261019"];

  it("jobKey 를 encodeURIComponent 한 값이다", () => {
    expect(toBullJobId(ISO_JOB_KEY)).toBe("g2b%3ASCHEDULED%3A2026-10-19T03%3A00%3A00.000Z");
  });

  it.each(KEYS)("%s 의 jobId 에는 ':' 가 없다", (key) => {
    expect(toBullJobId(key)).not.toContain(":");
  });

  it.each(KEYS)("%s 의 jobId 는 BullMQ 6.3.16 jobId 검사를 통과한다", (key) => {
    expect(bullAcceptsJobId(toBullJobId(key))).toBe(true);
  });

  it("같은 jobKey 는 같은 jobId 다(중복 예약 방지)", () => {
    expect(toBullJobId(ISO_JOB_KEY)).toBe(
      toBullJobId(`g2b:SCHEDULED:${"2026-10-19T03:00:00.000Z"}`),
    );
  });

  it("다른 jobKey 는 다른 jobId 다", () => {
    const keys = [
      ISO_JOB_KEY,
      "g2b:SCHEDULED:2026-10-19T03:30:00.000Z",
      "fixture:SEED:demo-reset",
      "fixture:SEED:demo",
      "a:b",
      "a%3Ab",
    ];

    expect(new Set(keys.map(toBullJobId)).size).toBe(keys.length);
  });
});

describe("enqueueIngestRun", () => {
  it("검증한 data 를 jobId = toBullJobId(jobKey) 로 run 이름에 넣는다", async () => {
    const { queue, add } = fakeQueue();

    await enqueueIngestRun(queue, G2B_MANUAL as IngestJobData, ENQUEUE_NOW);

    expect(add.mock.calls).toEqual([["run", G2B_MANUAL, { jobId: "g2b%3AMANUAL%3A20261019" }]]);
  });

  it("fixture:SEED:demo-reset 도 jobId = toBullJobId(jobKey) 로 넣는다", async () => {
    const { queue, add } = fakeQueue();

    await enqueueIngestRun(queue, FIXTURE_SEED as IngestJobData, ENQUEUE_NOW);

    expect(add.mock.calls).toEqual([
      ["run", FIXTURE_SEED, { jobId: "fixture%3ASEED%3Ademo-reset" }],
    ]);
  });

  it("ISO 시각이 든 jobKey 는 ':' 없는 jobId 로 넣고 data 의 jobKey 는 바꾸지 않는다", async () => {
    const { queue, add } = fakeQueue();
    const scheduled = { ...G2B_SCHEDULED, jobKey: ISO_JOB_KEY };

    await enqueueIngestRun(queue, scheduled as IngestJobData, ENQUEUE_NOW);

    expect(add.mock.calls).toEqual([["run", scheduled, { jobId: toBullJobId(ISO_JOB_KEY) }]]);
  });

  it("넣은 jobId 는 BullMQ 6.3.16 jobId 검사를 통과한다", async () => {
    const { queue, add } = fakeQueue();

    await enqueueIngestRun(
      queue,
      { ...G2B_SCHEDULED, jobKey: ISO_JOB_KEY } as IngestJobData,
      ENQUEUE_NOW,
    );

    expect(add.mock.calls.map(([, , opts]) => bullAcceptsJobId(opts.jobId))).toEqual([true]);
  });

  it("잘못된 data 는 reject 한다", async () => {
    const { queue } = fakeQueue();
    const invalid: unknown = { ...FIXTURE_SEED, window: G2B_MANUAL.window };

    await expect(enqueueIngestRun(queue, invalid as IngestJobData, ENQUEUE_NOW)).rejects.toThrow();
  });

  it("잘못된 data 는 queue.add 를 부르지 않는다", async () => {
    const { queue, add } = fakeQueue();
    const invalid: unknown = { ...G2B_MANUAL, batch: "SEED" };

    await enqueueIngestRun(queue, invalid as IngestJobData, ENQUEUE_NOW).catch(() => undefined);

    expect(add).not.toHaveBeenCalled();
  });

  it("now 기준 window.to 가 5분을 넘게 미래면 reject 한다(7-1)", async () => {
    const { queue } = fakeQueue();
    const early = new Date(Date.parse(G2B_MANUAL.window.to) - FIVE_MINUTES_MS - 1);

    await expect(enqueueIngestRun(queue, G2B_MANUAL as IngestJobData, early)).rejects.toThrow();
  });

  it("now 기준 시각 상한에 걸리면 queue.add 를 부르지 않는다(7-1)", async () => {
    const { queue, add } = fakeQueue();
    const early = new Date(Date.parse(G2B_MANUAL.window.to) - FIVE_MINUTES_MS - 1);

    await enqueueIngestRun(queue, G2B_MANUAL as IngestJobData, early).catch(() => undefined);

    expect(add).not.toHaveBeenCalled();
  });

  it("now 기준 window.to 가 5분 안쪽 미래면 넣는다(7-1)", async () => {
    const { queue, add } = fakeQueue();
    const justInside = new Date(Date.parse(G2B_MANUAL.window.to) - FIVE_MINUTES_MS);

    await enqueueIngestRun(queue, G2B_MANUAL as IngestJobData, justInside);

    expect(add).toHaveBeenCalledTimes(1);
  });
});

describe("documentsJobDataSchema", () => {
  it("bidId·revisionId 가 uuid 면 통과한다", () => {
    expect(
      documentsJobDataSchema.safeParse({ bidId: BID_ID, revisionId: REVISION_ID }).success,
    ).toBe(true);
  });

  it.each([
    ["bidId 가 uuid 아님", { bidId: "bid-1", revisionId: REVISION_ID }],
    ["revisionId 가 uuid 아님", { bidId: BID_ID, revisionId: "rev-1" }],
    ["revisionId 없음", { bidId: BID_ID }],
  ])("%s 면 거부한다", (_label, data) => {
    expect(documentsJobDataSchema.safeParse(data).success).toBe(false);
  });
});

describe("enqueueDocuments", () => {
  it("fetch 이름에 jobId documents-<revisionId> 로 넣는다", async () => {
    const { queue, add } = fakeQueue();

    await enqueueDocuments(queue, { bidId: BID_ID, revisionId: REVISION_ID });

    expect(add.mock.calls).toEqual([
      ["fetch", { bidId: BID_ID, revisionId: REVISION_ID }, { jobId: `documents-${REVISION_ID}` }],
    ]);
  });

  it("documents jobId 는 BullMQ 6.3.16 jobId 검사를 통과한다", async () => {
    const { queue, add } = fakeQueue();

    await enqueueDocuments(queue, { bidId: BID_ID, revisionId: REVISION_ID });

    expect(add.mock.calls.map(([, , opts]) => bullAcceptsJobId(opts.jobId))).toEqual([true]);
  });

  it("uuid 가 아니면 reject 하고 queue.add 를 부르지 않는다", async () => {
    const { queue, add } = fakeQueue();

    await expect(
      enqueueDocuments(queue, { bidId: "bid-1", revisionId: "rev-1" }),
    ).rejects.toThrow();
    expect(add).not.toHaveBeenCalled();
  });
});
