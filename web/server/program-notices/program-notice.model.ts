import "server-only";
import { z } from "zod";
import { classifyProcurementRelevance } from "@/server/ingestion";

// ── 모델: 부처 지원사업 공고의 정규화 행과 수집 회차 값. 저장·화면을 모른다 ──
// 세 소스(기업마당 API·중기부 RSS·과기정통부 API)를 같은 모양으로 맞춘다. 표·정책은 마이그레이션 20261023000800 이 정한다.
// 실제 공고(실호출·녹음 재생)는 isDemo=false 다. 가상 샘플은 시험에만 쓰고 표에 넣지 않는다.

export const PROGRAM_NOTICE_SOURCES = ["bizinfo", "mss", "msit"] as const;
export type ProgramNoticeSource = (typeof PROGRAM_NOTICE_SOURCES)[number];

export const PROGRAM_NOTICE_SOURCE_LABELS: Record<ProgramNoticeSource, string> = {
  bizinfo: "기업마당",
  mss: "중기부",
  msit: "과기정통부",
};

// 화면에 보이는 글자의 상한(넘으면 잘라 말줄임표를 붙인다). 원문 전체는 "원문 보기" 링크로 본다.
export const PROGRAM_NOTICE_LIMITS = {
  title: 300,
  agency: 100,
  summary: 2000,
  applyMethod: 1000,
  target: 500,
  tagCount: 20,
  tagLength: 40,
} as const;

export const RUN_STATUSES = ["SUCCEEDED", "PARTIAL", "FAILED", "SKIPPED"] as const;
export type ProgramNoticeRunStatus = (typeof RUN_STATUSES)[number];

export const RUN_MODES = ["LIVE", "FIXTURE", "MOCK"] as const;
export type ProgramNoticeRunMode = (typeof RUN_MODES)[number];

export const RUN_ERROR_CODES = [
  "KEY_MISSING",
  "NO_RECORDING",
  "HOST_NOT_ALLOWED",
  "REDIRECT_BLOCKED",
  "HTTP_ERROR",
  "TIMEOUT",
  "TOO_LARGE",
  "RESPONSE_SHAPE",
  "XML_DTD_REJECTED",
  "STORE_FAILED",
  "CONFIG_INVALID",
] as const;
export type ProgramRunErrorCode = (typeof RUN_ERROR_CODES)[number];

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();

// cleanText 는 코드포인트로 자르고 말줄임표 한 자를 붙인다. 같은 기준(코드포인트 수 ≤ 상한 + 1)으로 잰다.
const boundedText = (max: number) =>
  z.string().refine((text) => [...text].length <= max + 1, { message: `${max}자를 넘는다` });

export const normalizedProgramNoticeSchema = z.object({
  source: z.enum(PROGRAM_NOTICE_SOURCES),
  sourceNoticeId: z.string().min(1).max(200),
  title: boundedText(PROGRAM_NOTICE_LIMITS.title).pipe(z.string().min(1)),
  agency: boundedText(PROGRAM_NOTICE_LIMITS.agency).pipe(z.string().min(1)).nullable(),
  sourceUrl: z.url({ protocol: /^https$/ }),
  publishedAt: isoDateTime.nullable(),
  applyStartOn: isoDate.nullable(),
  applyEndOn: isoDate.nullable(),
  summary: boundedText(PROGRAM_NOTICE_LIMITS.summary).nullable(),
  applyMethod: boundedText(PROGRAM_NOTICE_LIMITS.applyMethod).nullable(),
  target: boundedText(PROGRAM_NOTICE_LIMITS.target).nullable(),
  tags: z
    .array(z.string().min(1).max(PROGRAM_NOTICE_LIMITS.tagLength))
    .max(PROGRAM_NOTICE_LIMITS.tagCount),
  dedupeKey: z.string().min(1),
  fetchedAt: isoDateTime,
  isDemo: z.boolean(),
});

export type NormalizedProgramNotice = z.infer<typeof normalizedProgramNoticeSchema>;

const PARENTHESIZED = /\([^()]*\)|（[^（）]*）/gu;
const UNCLOSED_TO_END = /[(（].*$/u;

/** 제목에서 괄호 안(연계 사업명·센터 이름 등)을 뺀 본문. 안쪽 괄호부터 지우고, 닫히지 않은 괄호는 끝까지 뺀다. */
const titleBody = (title: string): string => {
  const stripped = title.replace(PARENTHESIZED, " ");
  return stripped === title ? title.replace(UNCLOSED_TO_END, " ") : titleBody(stripped);
};

/**
 * IT 관련 지원사업인가(ADR-069, 스펙 2026-10-29-it-bid-scope §4). 지원사업에는 공식 IT 분류가 없어
 * 입찰공고 관련성 규칙(relevance-v0.1)의 분야 단어를 제목 본문(괄호 밖)에서만 찾는다(ADR-069 7번).
 * 사업개요는 보지 않는다. 요약에 "빅데이터ㆍAI"가 지나가듯 나오는 물류장비·특허·투자 공고가 섞였기 때문이다.
 * 단어 규칙이라 잘못 빠지거나 남는 공고가 있다.
 * 분야 단어가 하나도 없으면 규칙이 OTHER 하나를 돌려주므로 OTHER 는 IT 분야로 세지 않는다.
 */
export const isItProgramNotice = (row: { title: string }): boolean =>
  classifyProcurementRelevance({ title: titleBody(row.title) }).categories.some(
    (category) => category !== "OTHER",
  );
