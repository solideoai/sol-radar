import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { PROGRAM_NOTICE_SOURCES, type ProgramNoticeSource } from "./program-notice.model";

// ── 부처 공고 녹음(fixtures/recorded/program-notices/<소스>/*.json) 읽기 ──
// mock·fixture 모드는 네트워크 대신 녹음을 재생한다(스펙 §7). 녹음 body 는 연락처를 가린 원문이다.
// 녹음에 인증키가 섞이면 저장소에 키가 커밋된다. 이름이 crtfcKey(기업마당)·ServiceKey(과기정통부)인 파라미터가 있으면 형식 오류로 건너뛴다.

export const PROGRAM_RECORDED_SCHEMA_VERSION = "sol-program-recorded/v0.1";

const KEY_PARAMS: readonly string[] = ["crtfckey", "servicekey"];

const recordingSchema = z.strictObject({
  schemaVersion: z.literal(PROGRAM_RECORDED_SCHEMA_VERSION),
  source: z.enum(PROGRAM_NOTICE_SOURCES),
  params: z
    .record(z.string(), z.string())
    .refine(
      (params) => !Object.keys(params).some((name) => KEY_PARAMS.includes(name.toLowerCase())),
      {
        error: "params 에 인증키 파라미터가 있다",
      },
    ),
  fetchedAt: z.iso.datetime(),
  httpStatus: z.number().int().min(200).max(599),
  contentType: z.string(),
  body: z.string(),
  rawSha256: z.string().regex(/^[0-9a-f]{64}$/),
  masked: z.literal(true),
  maskedFields: z.array(z.string()),
  note: z.string(),
});

export type ProgramRecording = z.infer<typeof recordingSchema>;

const parseRecording = (text: string, source: ProgramNoticeSource): ProgramRecording | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = recordingSchema.safeParse(raw);
  return parsed.success && parsed.data.source === source ? parsed.data : null;
};

/** <dir>/<source>/*.json 을 읽는다. 폴더가 없으면 빈 목록, 형식이 틀린 파일은 건너뛰고 센다. 늦게 녹음한 것이 앞이다. */
export async function loadProgramRecordings(
  dir: string,
  source: ProgramNoticeSource,
): Promise<{ recordings: ProgramRecording[]; skipped: number }> {
  const folder = join(dir, source);
  let names: string[];
  try {
    names = (await readdir(folder)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return { recordings: [], skipped: 0 };
  }
  const parsed = await Promise.all(
    names.map(async (name) => parseRecording(await readFile(join(folder, name), "utf8"), source)),
  );
  const recordings = parsed
    .filter((recording): recording is ProgramRecording => recording !== null)
    .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt));
  return { recordings, skipped: parsed.length - recordings.length };
}
