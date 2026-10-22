import "server-only";
import { createHash } from "node:crypto";
import type { ParseResult } from "./bizinfo";
import { parseKstDateTime } from "./dates";
import { toSourceLink } from "./http";
import {
  normalizedProgramNoticeSchema,
  PROGRAM_NOTICE_LIMITS,
  type NormalizedProgramNotice,
} from "./program-notice.model";
import { cleanText, decodeEntities, dedupeKeyOf } from "./text";

// ── 중소벤처기업부 사업공고 RSS(310.do) 해석 ──
// 항목에는 title·link·pubDate·id 뿐이다(신청기간·개요 없음). pubDate 는 RFC 822 가 아니라 YYYYMMDDHHMMSS(KST)다.
// XML 파서를 들이지 않고 정규식으로 <item> 만 자른다. 외부 엔티티(XXE)를 막으려고 DOCTYPE·ENTITY 가 있으면 통째로 거부한다.

const MSS_AGENCY = "중소벤처기업부";
const MSS_SITE = { origin: "https://mss.go.kr", hosts: ["mss.go.kr", "www.mss.go.kr"] };

const DTD_MARK = /<!(doctype|entity)\b/i;
const RSS_ROOT = /<rss\b[^>]*>[\s\S]*<\/rss\s*>/i;
const ITEM = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

const tagText = (block: string, name: string): string | null => {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}\\s*>`, "i").exec(block);
  return match === null ? null : match[1];
};

/** CDATA 는 벗기기만 하고, 아니면 XML 참조를 푼다(평문화는 cleanText 가 한다). */
const unwrap = (raw: string): { text: string; isCdata: boolean } => {
  const cdata = CDATA.exec(raw);
  return cdata === null ? { text: raw, isCdata: false } : { text: cdata[1], isCdata: true };
};

const noticeIdOf = (link: string): string =>
  new URL(link).searchParams.get("bcIdx")?.trim() ||
  createHash("sha256").update(link).digest("hex").slice(0, 16);

function toNotice(block: string, fetchedAt: string): NormalizedProgramNotice | null {
  const rawTitle = tagText(block, "title");
  const rawLink = tagText(block, "link");
  if (rawTitle === null || rawLink === null) return null;
  // 제목은 cleanText 가 태그를 걷고 참조를 한 번 푼다. 링크는 &amp; 를 풀어야 주소가 된다.
  const title = cleanText(unwrap(rawTitle).text, PROGRAM_NOTICE_LIMITS.title);
  const link = unwrap(rawLink);
  const sourceUrl = toSourceLink(link.isCdata ? link.text : decodeEntities(link.text), MSS_SITE);
  if (title === null || sourceUrl === null) return null;
  const rawPubDate = tagText(block, "pubDate");
  const candidate = {
    source: "mss",
    sourceNoticeId: noticeIdOf(sourceUrl),
    title,
    agency: MSS_AGENCY,
    sourceUrl,
    publishedAt: rawPubDate === null ? null : parseKstDateTime(unwrap(rawPubDate).text),
    applyStartOn: null,
    applyEndOn: null,
    summary: null,
    applyMethod: null,
    target: null,
    tags: [],
    dedupeKey: dedupeKeyOf(title, MSS_AGENCY),
    fetchedAt,
    isDemo: false,
  };
  const parsed = normalizedProgramNoticeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** RSS 본문 → 정규화 행. 제목이 없거나 링크가 중기부 사이트가 아니면 버리고 센다. 등록일이 깨지면 null 로 둔다. */
export function parseMssRss(body: string, fetchedAt: string): ParseResult {
  if (DTD_MARK.test(body)) return { ok: false, errorCode: "XML_DTD_REJECTED" };
  if (!RSS_ROOT.test(body)) return { ok: false, errorCode: "RESPONSE_SHAPE" };
  const blocks = [...body.matchAll(ITEM)].map((match) => match[1]);
  const notices = blocks
    .map((block) => toNotice(block, fetchedAt))
    .filter((notice): notice is NormalizedProgramNotice => notice !== null);
  return { ok: true, notices, dropped: blocks.length - notices.length };
}
