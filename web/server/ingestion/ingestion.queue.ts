import "server-only";
import { z } from "zod";

// ── 수집·첨부 큐의 이름과 job data 규칙(6-4). 05 IngestionRunInput 검증과 같은 규칙을 큐 입구에서 한 번 더 건다 ──
export const INGEST_QUEUE = "ingest";
export const INGEST_JOB_NAME = "run";
export const DOCUMENTS_QUEUE = "documents";
export const DOCUMENTS_JOB_NAME = "fetch";

// 05: g2b 수집 창은 최대 7일이다. worker 가 1일 조각으로 나눠 조회한다.
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const isoInstantSchema = z.iso.datetime({ offset: true });

const windowSchema = z.strictObject({ from: isoInstantSchema, to: isoInstantSchema }).refine(
  ({ from, to }) => {
    const length = Date.parse(to) - Date.parse(from);
    return length > 0 && length <= MAX_WINDOW_MS;
  },
  { error: "window 는 from < to 이고 7일 이하다" },
);

const baseJobShape = {
  trigger: z.enum(["SCHEDULED", "MANUAL", "DEMO"]),
  jobKey: z.string().min(1),
  idempotencyKey: z.string().optional(),
  requestedBy: z.uuid().optional(),
  orgId: z.uuid().optional(),
  // N8 수동 수집: Route Handler 가 만든 run id. worker 가 ingest_runs.id 로 쓴다(일정·데모 job 은 없다)
  runId: z.uuid().optional(),
};

// fixture 는 batch 필수·window 금지, g2b 는 batch 금지(05). 판별 유니온의 strict 객체라 반대쪽 키는 모르는 키로 거부된다.
const jobDataUnion = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("fixture"),
    batch: z.enum(["SEED", "LIVE"]),
    ...baseJobShape,
  }),
  z.strictObject({
    source: z.literal("g2b"),
    // 생략하면 worker 가 직전 성공 창 끝 ~ 지금으로 정한다(SCHEDULED 의 반복 job data 는 고정이라 창이 없다)
    window: windowSchema.optional(),
    ...baseJobShape,
  }),
]);

// 7-5: 수동 수집은 누가·어느 조직이 시켰는지 감사에 남아야 한다. 둘 중 하나라도 없으면 받지 않는다.
const hasManualRequester = (data: z.infer<typeof jobDataUnion>): boolean =>
  data.trigger !== "MANUAL" || (data.orgId !== undefined && data.requestedBy !== undefined);

/** 시각과 무관한 검사만 한다. 큐에 넣거나 처리할 때는 ingestJobDataSchemaAt(now) 를 쓴다. */
export const ingestJobDataSchema = jobDataUnion.refine(hasManualRequester, {
  error: "MANUAL 수집은 orgId·requestedBy 가 필요하다",
  path: ["requestedBy"],
});
export type IngestJobData = z.infer<typeof ingestJobDataSchema>;

/** window.to 가 지금보다 이만큼 넘게 미래면 받지 않는다(서버 시계 차이만 허용한다, 7-1). */
export const INGEST_WINDOW_FUTURE_TOLERANCE_MS = 5 * 60_000;

// 7-1: 미래 창을 받으면 아직 올라오지 않은 공고 구간을 "수집함"으로 남겨 다음 수집이 그 구간을 건너뛸 수 있다.
export const ingestJobDataSchemaAt = (now: Date) =>
  ingestJobDataSchema.refine(
    (data) =>
      data.source !== "g2b" ||
      data.window === undefined ||
      Date.parse(data.window.to) <= now.getTime() + INGEST_WINDOW_FUTURE_TOLERANCE_MS,
    { error: "window.to 가 지금보다 5분 넘게 미래다", path: ["window", "to"] },
  );

/** BullMQ JobsOptions 중 이 도메인이 쓰는 부분. BullMQ 의 removeOn*.age 는 초 단위다. */
export type JobQueueOptions = {
  jobId: string;
  attempts?: number;
  backoff?: { type: "exponential"; delay: number };
  removeOnComplete?: { age: number };
  removeOnFail?: { age: number };
};

/** BullMQ Queue 중 쓰는 부분. 시험은 가짜를 넘긴다. */
export type JobQueue = {
  add(name: string, data: unknown, opts: JobQueueOptions): Promise<unknown>;
};

/**
 * BullMQ 6 은 사용자 jobId 에 ':' 가 있으면 세 조각일 때만 받는다(dist/cjs/classes/job.js:910-912).
 * jobKey 는 ISO 시각 등 ':' 를 담으므로 인코딩해 ':' 를 없앤다. 같은 키는 같은 id 라 중복 예약 방지는 그대로다.
 */
export function toBullJobId(key: string): string {
  return encodeURIComponent(key);
}

// 같은 jobKey 는 같은 BullMQ jobId 라 큐 쪽에서도 두 번 들어가지 않는다(ingest_runs.job_key UNIQUE 와 같은 멱등).
// data 의 jobKey 는 원래 값 그대로 둔다. ingest_runs.job_key 는 그 값이다.
export async function enqueueIngestRun(
  queue: JobQueue,
  data: IngestJobData,
  now: Date = new Date(),
): Promise<void> {
  const parsed = ingestJobDataSchemaAt(now).parse(data);
  await queue.add(INGEST_JOB_NAME, parsed, { jobId: toBullJobId(parsed.jobKey) });
}

// PostgREST 는 timestamptz 를 마이크로초 소수와 "+00:00" 으로 돌려준다(예: 2026-10-19T03:04:05.123456+00:00).
// 그 모양과 toISOString() 모양을 모두 받고, epoch ms 로 바뀌지 않는 값은 거부한다(jobId 에 NaN 이 들어가지 않게).
const revisionCreatedAtSchema = isoInstantSchema.refine(
  (value) => Number.isFinite(Date.parse(value)),
  { error: "revisionCreatedAt 은 epoch ms 로 바뀌는 시각이어야 한다" },
);

export const documentsJobDataSchema = z.strictObject({
  bidId: z.uuid(),
  revisionId: z.uuid(),
  revisionCreatedAt: revisionCreatedAtSchema,
});
export type DocumentsJobData = z.infer<typeof documentsJobDataSchema>;

/** 02 장애 원칙 "job 유실 없음(재시도·DLQ)"(C4'). 완료 job 은 1일, 실패 job 은 7일 남겨 DLQ 로 본다. age 는 초 단위다. */
export const DOCUMENTS_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
} as const satisfies Omit<JobQueueOptions, "jobId">;

/**
 * C1': documents jobId 는 revision id 와 그 revision 행의 created_at(epoch ms)이다.
 * demo:reset 이 같은 revision id 를 다시 만들면 created_at 이 바뀌어 새 jobId 가 된다(BullMQ 에 남은 이전 job 에 막히지 않는다).
 * 같은 행이 살아 있는 동안은 jobId 가 같아, 수집 job 과 복구기가 겹쳐 넣어도 BullMQ 가 하나만 받는다. ':' 는 쓰지 않는다(toBullJobId).
 */
export function toDocumentsJobId(
  data: Pick<DocumentsJobData, "revisionId" | "revisionCreatedAt">,
): string {
  const createdAtMs = Date.parse(data.revisionCreatedAt);
  if (!Number.isFinite(createdAtMs)) {
    throw new Error("documents jobId: revisionCreatedAt 이 시각이 아니다");
  }
  return `documents-${data.revisionId}-${createdAtMs}`;
}

export async function enqueueDocuments(queue: JobQueue, data: DocumentsJobData): Promise<void> {
  const parsed = documentsJobDataSchema.parse(data);
  await queue.add(DOCUMENTS_JOB_NAME, parsed, {
    ...DOCUMENTS_JOB_OPTIONS,
    jobId: toDocumentsJobId(parsed),
  });
}
