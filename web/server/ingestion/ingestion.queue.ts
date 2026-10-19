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

/** BullMQ Queue 중 쓰는 부분. 시험은 가짜를 넘긴다. */
export type JobQueue = {
  add(name: string, data: unknown, opts: { jobId: string }): Promise<unknown>;
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

export const documentsJobDataSchema = z.strictObject({ bidId: z.uuid(), revisionId: z.uuid() });
export type DocumentsJobData = z.infer<typeof documentsJobDataSchema>;

export async function enqueueDocuments(queue: JobQueue, data: DocumentsJobData): Promise<void> {
  const parsed = documentsJobDataSchema.parse(data);
  await queue.add(DOCUMENTS_JOB_NAME, parsed, { jobId: `documents-${parsed.revisionId}` });
}
