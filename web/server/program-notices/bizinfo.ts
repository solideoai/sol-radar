import "server-only";
import { parseApplyPeriod, parseKstDateTime } from "./dates";
import { toSourceLink } from "./http";
import {
  normalizedProgramNoticeSchema,
  PROGRAM_NOTICE_LIMITS,
  type NormalizedProgramNotice,
} from "./program-notice.model";
import { cleanText, dedupeKeyOf } from "./text";

// ── 기업마당 지원사업정보 API(bizinfoApi.do, dataType=json) 응답 해석 ──
// 공식 명세(https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoApi)의 필드만 읽는다. 문의처(refrncNm)·신청 사이트(rceptEngnHmpgUrl)는 읽지 않는다.
// 명세에 봉투 모양·오류 형식이 없어서 jsonArray 의 세 모양(배열·{item:[…]}·{item:{…}})을 받고, 그 밖은 RESPONSE_SHAPE 로 남긴다.
// 실제 응답(fixtures/recorded/program-notices/bizinfo, 2026-10-28)은 jsonArray 가 바로 배열이고, 해시태그 칸 이름이 명세와 다르다(hashtags).

export type ParseResult =
  | { ok: true; notices: NormalizedProgramNotice[]; dropped: number }
  | { ok: false; errorCode: "RESPONSE_SHAPE" | "XML_DTD_REJECTED" };

const BIZINFO_SITE = {
  origin: "https://www.bizinfo.go.kr",
  hosts: ["www.bizinfo.go.kr", "bizinfo.go.kr"],
};

type BizinfoUrlInput = {
  baseUrl: string;
  key: string;
  categories: readonly string[];
  maxItems: number;
};

/** 요청 URL. 키가 실리므로 로그·오류에는 redactProgramUrl 을 거친 값만 남긴다. */
export function buildBizinfoUrl({ baseUrl, key, categories, maxItems }: BizinfoUrlInput): string {
  const url = new URL(baseUrl);
  url.searchParams.set("crtfcKey", key);
  url.searchParams.set("dataType", "json");
  url.searchParams.set("searchCnt", String(maxItems));
  if (categories.length > 0) url.searchParams.set("searchLclasId", categories.join(","));
  return url.toString();
}

type Item = Record<string, unknown>;

const isRecord = (value: unknown): value is Item =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 주 필드가 비었으면 다음 후보를 본다. 문자열·숫자만 값으로 친다. */
const pick = (item: Item, ...names: string[]): string | null => {
  for (const name of names) {
    const value = item[name];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
};

// 명세의 지역 해시태그 16개. 실제 응답(2026-10-28 녹음)은 16개를 모두 붙인 공고가 많아, 다 있으면 "전국" 하나로 줄인다.
// 줄이지 않으면 태그 상한(20개) 안을 지역이 채워 주제 태그(부처·사업 유형)가 잘린다.
const REGION_TAGS: ReadonlySet<string> = new Set([
  "서울",
  "부산",
  "대구",
  "인천",
  "전남광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "경북",
  "경남",
  "제주",
]);
const NATIONWIDE_TAG = "전국";

const collapseRegions = (tags: string[]): string[] => {
  if (![...REGION_TAGS].every((region) => tags.includes(region))) return tags;
  const firstRegion = tags.findIndex((tag) => REGION_TAGS.has(tag));
  return tags.flatMap((tag, index) => {
    if (index === firstRegion) return [NATIONWIDE_TAG];
    return REGION_TAGS.has(tag) ? [] : [tag];
  });
};

function tagsOf(item: Item): string[] {
  const field = pick(item, "pldirSportRealmLclasCodeNm", "lcategory");
  // 실제 응답의 칸 이름은 hashtags 다(2026-10-28 녹음). 명세 표의 hashTags 도 받는다.
  const hashTags = pick(item, "hashtags", "hashTags")?.split(",") ?? [];
  const tags = [field, ...hashTags]
    .map((tag) => cleanText(tag, PROGRAM_NOTICE_LIMITS.tagLength))
    .filter(
      (tag): tag is string => tag !== null && [...tag].length <= PROGRAM_NOTICE_LIMITS.tagLength,
    );
  return [...new Set(collapseRegions([...new Set(tags)]))].slice(0, PROGRAM_NOTICE_LIMITS.tagCount);
}

function toNotice(item: Item, fetchedAt: string): NormalizedProgramNotice | null {
  const title = cleanText(pick(item, "pblancNm", "title"), PROGRAM_NOTICE_LIMITS.title);
  const sourceNoticeId = pick(item, "pblancId", "seq")?.trim() ?? null;
  const rawUrl = pick(item, "pblancUrl", "link");
  const sourceUrl = rawUrl === null ? null : toSourceLink(rawUrl, BIZINFO_SITE);
  if (title === null || sourceNoticeId === null || sourceUrl === null) return null;
  const agency = cleanText(pick(item, "jrsdInsttNm", "author"), PROGRAM_NOTICE_LIMITS.agency);
  const { startOn, endOn } = parseApplyPeriod(pick(item, "reqstBeginEndDe", "reqstDt"));
  const candidate = {
    source: "bizinfo",
    sourceNoticeId,
    title,
    agency,
    sourceUrl,
    publishedAt: parseKstDateTime(pick(item, "creatPnttm", "pubDate")),
    applyStartOn: startOn,
    applyEndOn: endOn,
    summary: cleanText(pick(item, "bsnsSumryCn", "description"), PROGRAM_NOTICE_LIMITS.summary),
    applyMethod: cleanText(pick(item, "reqstMthPapersCn"), PROGRAM_NOTICE_LIMITS.applyMethod),
    target: cleanText(pick(item, "trgetNm"), PROGRAM_NOTICE_LIMITS.target),
    tags: tagsOf(item),
    dedupeKey: dedupeKeyOf(title, agency),
    fetchedAt,
    isDemo: false,
  };
  const parsed = normalizedProgramNoticeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** jsonArray 의 세 모양을 항목 배열로 편다. 모르는 모양은 null. */
function itemsOf(body: string): unknown[] | null {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(root)) return null;
  const envelope = root.jsonArray;
  if (Array.isArray(envelope)) return envelope;
  if (!isRecord(envelope)) return null;
  if (Array.isArray(envelope.item)) return envelope.item;
  return isRecord(envelope.item) ? [envelope.item] : null;
}

/** 응답 본문 → 정규화 행. 필수 값(제목·id·기업마당 https 주소)이 없거나 규칙에 어긋나는 항목은 버리고 센다. */
export function parseBizinfoBody(body: string, fetchedAt: string): ParseResult {
  const items = itemsOf(body);
  if (items === null) return { ok: false, errorCode: "RESPONSE_SHAPE" };
  const notices = items
    .map((item) => (isRecord(item) ? toNotice(item, fetchedAt) : null))
    .filter((notice): notice is NormalizedProgramNotice => notice !== null);
  return { ok: true, notices, dropped: items.length - notices.length };
}
