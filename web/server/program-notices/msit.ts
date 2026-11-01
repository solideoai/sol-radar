import "server-only";
import type { ParseResult } from "./bizinfo";
import { parseKstDateTime } from "./dates";
import { toSourceLink } from "./http";
import {
  normalizedProgramNoticeSchema,
  PROGRAM_NOTICE_LIMITS,
  type NormalizedProgramNotice,
} from "./program-notice.model";
import { cleanText, dedupeKeyOf } from "./text";

// ── 과학기술정보통신부 사업공고(공공데이터포털 15074634, businessAnnouncMentList) 응답 해석 ──
// 실제 응답(fixtures/recorded/program-notices/msit, 2026-11-01)은 봉투가 배열이다:
// {"response":[{"header":{…}},{"body":{"items":[{"item":{…}}]}}]}. 문서 모양(response.body.items.item 배열·객체)도 받는다.
// 응답에는 신청 기간·요약이 없다. 담당자 이름·전화(managerName·managerTel)는 읽지 않는다.

export const MSIT_AGENCY = "과학기술정보통신부";

const MSIT_SITE = { origin: "https://www.msit.go.kr", hosts: ["www.msit.go.kr"] };

// 제목에 있으면 저장하지 않는 단어. 결과 발표 공고다. "선정계획"은 과기정통부가 공모를 이렇게 부르므로 남긴다.
export const MSIT_EXCLUDED_TITLE_WORDS = [
  "선정결과",
  "선정 결과",
  "평가결과",
  "평가 결과",
  "수상작",
  "결과 공고",
  "결과공고",
] as const;

/** 포털 Encoding 키를 한 번 푼다. 빈 값·깨진 퍼센트 열이면 null. 풀린 값을 다시 넣어도 그대로다. */
export function decodeServiceKey(raw: string | undefined): string | null {
  const text = raw?.trim() ?? "";
  if (text === "") return null;
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

type MsitUrlInput = { baseUrl: string; key: string; maxItems: number };

/** 요청 URL. key 는 decodeServiceKey 로 푼 값이고 URLSearchParams 가 한 번만 인코딩한다. 로그에는 redactProgramUrl 을 거친 값만 남긴다. */
export function buildMsitUrl({ baseUrl, key, maxItems }: MsitUrlInput): string {
  const url = new URL(baseUrl);
  url.searchParams.set("ServiceKey", key);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", String(maxItems));
  url.searchParams.set("returnType", "json");
  return url.toString();
}

type Item = Record<string, unknown>;

const isRecord = (value: unknown): value is Item =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

// pressDt 는 YYYY-MM-DD 로 온다(2026-11-01 녹음). 점·붙인 날짜도 같은 날짜로 읽는다. 시각이 붙은 형식은 그대로 넘긴다.
const DOTTED_OR_COMPACT_DATE = /^(\d{4})[.]?(\d{2})[.]?(\d{2})$/;

const publishedAtOf = (raw: unknown): string | null => {
  const value = text(raw)?.trim() ?? null;
  if (value === null) return null;
  const match = DOTTED_OR_COMPACT_DATE.exec(value);
  return parseKstDateTime(match === null ? value : `${match[1]}-${match[2]}-${match[3]}`);
};

const isExcludedTitle = (title: string): boolean =>
  MSIT_EXCLUDED_TITLE_WORDS.some((word) => title.includes(word));

type Row = { notice: NormalizedProgramNotice } | { excluded: true } | null;

function toRow(item: Item, fetchedAt: string): Row {
  const title = cleanText(text(item.subject), PROGRAM_NOTICE_LIMITS.title);
  const rawUrl = text(item.viewUrl);
  const sourceUrl = rawUrl === null ? null : toSourceLink(rawUrl, MSIT_SITE);
  const sourceNoticeId =
    sourceUrl === null ? null : (new URL(sourceUrl).searchParams.get("nttSeqNo")?.trim() ?? "");
  if (title === null || sourceUrl === null || !sourceNoticeId) return null;
  if (isExcludedTitle(title)) return { excluded: true };
  const candidate = {
    source: "msit",
    sourceNoticeId,
    title,
    // 담당 부서가 없으면 끝 공백을 cleanText 가 걷어 "과학기술정보통신부"만 남는다.
    agency: cleanText(`${MSIT_AGENCY} ${text(item.deptName) ?? ""}`, PROGRAM_NOTICE_LIMITS.agency),
    sourceUrl,
    publishedAt: publishedAtOf(item.pressDt),
    applyStartOn: null,
    applyEndOn: null,
    summary: null,
    applyMethod: null,
    target: null,
    tags: [],
    dedupeKey: dedupeKeyOf(title, MSIT_AGENCY),
    fetchedAt,
    isDemo: false,
  };
  const parsed = normalizedProgramNoticeSchema.safeParse(candidate);
  return parsed.success ? { notice: parsed.data } : null;
}

/** response 가 배열이면 header·body 를 가진 원소를 하나로 모은다. */
const partsOf = (response: unknown): { header?: unknown; body?: unknown } | null => {
  if (isRecord(response)) return response;
  if (!Array.isArray(response)) return null;
  return Object.assign({}, ...response.filter(isRecord)) as { header?: unknown; body?: unknown };
};

/** items 의 세 모양([{item:{…}}]·{item:[…]}·{item:{…}})을 항목 배열로 편다. 모르는 모양·비정상 resultCode 는 null. */
function itemsOf(body: string): unknown[] | null {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(root)) return null;
  const parts = partsOf(root.response);
  if (parts === null) return null;
  if (isRecord(parts.header) && "resultCode" in parts.header && parts.header.resultCode !== "00")
    return null;
  if (!isRecord(parts.body)) return null;
  const items = parts.body.items;
  if (Array.isArray(items)) return items.map((entry) => (isRecord(entry) ? entry.item : entry));
  if (!isRecord(items)) return null;
  if (Array.isArray(items.item)) return items.item;
  return isRecord(items.item) ? [items.item] : null;
}

/**
 * 응답 본문 → 정규화 행. 결과 발표 공고는 excluded 로 세고(회차 상태에 안 들어간다),
 * 필수 값(제목·nttSeqNo·과기정통부 https 주소)이 없거나 규칙에 어긋나는 항목은 dropped 로 센다.
 */
export function parseMsitBody(body: string, fetchedAt: string): ParseResult {
  const items = itemsOf(body);
  if (items === null) return { ok: false, errorCode: "RESPONSE_SHAPE" };
  const rows = items.map((item) => (isRecord(item) ? toRow(item, fetchedAt) : null));
  const notices = rows.flatMap((row) => (row !== null && "notice" in row ? [row.notice] : []));
  const excluded = rows.filter((row) => row !== null && "excluded" in row).length;
  return { ok: true, notices, dropped: items.length - notices.length - excluded, excluded };
}
