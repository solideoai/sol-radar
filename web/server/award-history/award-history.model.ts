import "server-only";
import {
  AWARD_LOOKBACK_MONTHS,
  AWARD_RATIO_MAX,
  AWARD_RATIO_MIN,
  baseAmountOf,
  methodGroupOf,
  type BaseAmount,
  type CardMethodGroup,
} from "@/server/award-reference";
import {
  parseG2bEnvelope,
  parseKstDateTime,
  splitG2bWindow,
  type G2bEnvelope,
  type G2bWindowSlice,
} from "@/server/ingestion";

// ── 규칙: 지난 낙찰 결과와 지난 공고를 공고번호·차수로 이어 procurement_award_history 행을 만든다(순수) ──
// 스펙 polaris/specs/in-progress/2026-11-02-award-reference-price.md §4. 낙찰 결과에는 분류·기준금액·낙찰방법이 없어
// 지난 공고(입찰공고 목록)에서 가져온다. 낙찰업체 칸(bidwinnr*·fnlSucsfCorpOfcl)은 읽지도 저장하지도 않는다(ADR-007).

/** 낙찰된 목록 현황 용역조회(getScsbidListSttusServc) 한 행에서 쓰는 값. */
export type AwardApiRow = {
  bidNoticeNo: string | null;
  bidNoticeOrd: string | null;
  title: string | null;
  participantCount: number | null;
  /** 낙찰금액(sucsfbidAmt, 부가세 포함, 원). 응답의 낙찰률(sucsfbidRate)은 협상 계약에서 비어 있어 쓰지 않는다 */
  awardAmountKrw: number | null;
  /** 실개찰일시(rlOpengDt, KST)를 ISO 로 바꾼 값 */
  openedAt: string | null;
  demandAgency: string | null;
};

/** 입찰공고 목록(getBidPblancListInfoServc) 한 행에서 쓰는 값. 공고번호가 없는 행은 만들지 않는다. */
export type NoticeApiRow = {
  bidNoticeNo: string;
  bidNoticeOrd: string;
  classNo: string | null;
  className: string | null;
  midClassName: string | null;
  methodName: string | null;
  base: BaseAmount | null;
};

/** procurement_award_history 에 넣는 행. fetched_at 은 저장 쪽이 넣는다. */
export type AwardHistoryInsert = {
  bid_notice_no: string;
  bid_notice_ord: string;
  title: string;
  procurement_class_no: string;
  procurement_class_name: string;
  procurement_mid_class_name: string | null;
  award_method_name: string;
  award_method_group: CardMethodGroup;
  base_amount_krw: number;
  base_amount_kind: BaseAmount["kind"];
  award_amount_krw: number;
  award_ratio: number;
  participant_count: number | null;
  opened_at: string;
  demand_agency: string | null;
};

export const AWARD_SKIP_REASONS = [
  "NO_NOTICE",
  "OTHER_METHOD",
  "NO_CLASS",
  "NO_BASE",
  "NO_AWARD_AMOUNT",
  "NO_OPENED_AT",
  "RATIO_OUT_OF_RANGE",
] as const;
export type AwardSkipReason = (typeof AWARD_SKIP_REASONS)[number];
export type AwardSkipped = { skipped: AwardSkipReason };

// ── 응답 읽기 ──

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
};

const nonNegativeIntOf = (value: unknown): number | null => {
  const text = textOf(value);
  if (text === null || !/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
};

const positiveWonOf = (value: unknown): number | null => {
  const won = nonNegativeIntOf(value);
  return won !== null && won > 0 ? won : null;
};

// rlOpengDt 는 "YYYY-MM-DD HH:mm:ss"(KST)다. 이 모양만 받아 날짜만 있는 값·상대 표현이 섞여 들어오지 않게 한다.
const KST_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/;
const PARSE_ANCHOR = new Date(0);

const openedAtOf = (value: unknown): string | null => {
  const text = textOf(value);
  if (text === null || !KST_DATE_TIME.test(text)) return null;
  const parsed = parseKstDateTime(text, PARSE_ANCHOR);
  return parsed.ok ? parsed.value : null;
};

// 나라장터 목록 JSON 의 items 는 보통 배열이다. 한 건이면 객체 하나, 0건이면 빈 문자열로 오기도 해서
// 배열로 맞춘 뒤 공용 봉투 해석에 넘긴다. 그 밖 모양은 공용 해석이 MALFORMED 로 돌려준다.
const itemsAsArray = (items: unknown): unknown => {
  if (Array.isArray(items)) return items;
  if (items === "" || items === null || items === undefined) return [];
  return isRecord(items) ? [items] : items;
};

/** 목록 응답 봉투. items 가 객체 한 건·빈 문자열이어도 읽는다. 결과 코드·오류 봉투는 공용 해석 그대로다. */
export function listEnvelopeOf(body: unknown): G2bEnvelope {
  if (!isRecord(body)) return parseG2bEnvelope(body);
  const response = body.response;
  if (!isRecord(response)) return parseG2bEnvelope(body);
  const inner = response.body;
  if (!isRecord(inner)) return parseG2bEnvelope(body);
  return parseG2bEnvelope({
    ...body,
    response: { ...response, body: { ...inner, items: itemsAsArray(inner.items) } },
  });
}

export function awardRowOf(item: Record<string, unknown>): AwardApiRow {
  return {
    bidNoticeNo: textOf(item.bidNtceNo),
    bidNoticeOrd: textOf(item.bidNtceOrd),
    title: textOf(item.bidNtceNm),
    participantCount: nonNegativeIntOf(item.prtcptCnum),
    awardAmountKrw: positiveWonOf(item.sucsfbidAmt),
    openedAt: openedAtOf(item.rlOpengDt),
    demandAgency: textOf(item.dminsttNm),
  };
}

export function noticeRowOf(item: Record<string, unknown>): NoticeApiRow | null {
  const bidNoticeNo = textOf(item.bidNtceNo);
  if (bidNoticeNo === null) return null;
  return {
    bidNoticeNo,
    bidNoticeOrd: textOf(item.bidNtceOrd) ?? "000",
    classNo: textOf(item.pubPrcrmntClsfcNo),
    className: textOf(item.pubPrcrmntClsfcNm),
    midClassName: textOf(item.pubPrcrmntMidClsfcNm),
    methodName: textOf(item.sucsfbidMthdNm),
    base: baseAmountOf({
      asignBdgtAmt: textOf(item.asignBdgtAmt),
      presmptPrce: textOf(item.presmptPrce),
      vat: textOf(item.VAT),
    }),
  };
}

const itemsOrThrow = (envelope: G2bEnvelope, what: string): Record<string, unknown>[] => {
  if (envelope.ok) return envelope.items;
  const code = envelope.kind === "RESULT_CODE" ? ` resultCode ${envelope.resultCode}` : "";
  throw new Error(`${what} 응답을 읽지 못했다(${envelope.kind}${code})`);
};

/** 낙찰 응답 본문 → 행. items 가 배열·객체 한 건·빈 문자열이어도 배열로 돌려준다. 봉투가 오류면 던진다. */
export function parseAwardItems(body: unknown): AwardApiRow[] {
  return itemsOrThrow(listEnvelopeOf(body), "낙찰").map(awardRowOf);
}

/** 입찰공고 응답 본문 → 행. 공고번호가 없는 행은 뺀다. 봉투가 오류면 던진다. */
export function parseNoticeItems(body: unknown): NoticeApiRow[] {
  return itemsOrThrow(listEnvelopeOf(body), "입찰공고")
    .map(noticeRowOf)
    .filter((row): row is NoticeApiRow => row !== null);
}

// ── 잇기 ──

const ordNumber = (ord: string): number => (/^\d+$/.test(ord) ? Number(ord) : -1);

/** 차수가 같은 공고, 없으면 같은 공고번호의 가장 큰 차수(정정공고가 마지막 조건이다). */
const noticeFor = (
  award: AwardApiRow,
  candidates: readonly NoticeApiRow[],
): NoticeApiRow | null => {
  const exact = candidates.find((notice) => notice.bidNoticeOrd === award.bidNoticeOrd);
  if (exact !== undefined) return exact;
  return candidates.reduce<NoticeApiRow | null>(
    (latest, notice) =>
      latest === null || ordNumber(notice.bidNoticeOrd) > ordNumber(latest.bidNoticeOrd)
        ? notice
        : latest,
    null,
  );
};

// numeric(6,4) 로 저장되므로 넷째 자리로 반올림한 값으로 범위를 본다. 반올림 전에 보면 경계 값(0.29996 등)이
// 통과한 뒤 DB 에서 범위 밖이 되거나 그 반대가 되어, 500행 묶음 upsert 전체가 검사 제약으로 실패할 수 있다.
export const roundAwardRatio = (ratio: number): number => Math.round(ratio * 10_000) / 10_000;

const skip = (reason: AwardSkipReason): AwardSkipped => ({ skipped: reason });

/** 낙찰 한 행을 공고와 이어 저장 행을 만든다. 못 쓰는 행은 이유를 돌려준다. */
export function joinAwardWithNotice(
  award: AwardApiRow,
  notices: ReadonlyMap<string, readonly NoticeApiRow[]>,
): AwardHistoryInsert | AwardSkipped {
  const notice =
    award.bidNoticeNo === null ? null : noticeFor(award, notices.get(award.bidNoticeNo) ?? []);
  if (award.bidNoticeNo === null || notice === null) return skip("NO_NOTICE");
  const methodName = notice.methodName;
  const group = methodGroupOf(methodName);
  if (methodName === null || group === "OTHER") return skip("OTHER_METHOD");
  if (notice.classNo === null) return skip("NO_CLASS");
  if (notice.base === null) return skip("NO_BASE");
  if (award.awardAmountKrw === null) return skip("NO_AWARD_AMOUNT");
  if (award.openedAt === null) return skip("NO_OPENED_AT");
  const ratio = roundAwardRatio(award.awardAmountKrw / notice.base.amountKrw);
  if (ratio < AWARD_RATIO_MIN || ratio > AWARD_RATIO_MAX) return skip("RATIO_OUT_OF_RANGE");
  return {
    bid_notice_no: award.bidNoticeNo,
    bid_notice_ord: award.bidNoticeOrd ?? notice.bidNoticeOrd,
    title: award.title ?? award.bidNoticeNo,
    procurement_class_no: notice.classNo,
    procurement_class_name: notice.className ?? notice.classNo,
    procurement_mid_class_name: notice.midClassName,
    award_method_name: methodName,
    award_method_group: group,
    base_amount_krw: notice.base.amountKrw,
    base_amount_kind: notice.base.kind,
    award_amount_krw: award.awardAmountKrw,
    award_ratio: ratio,
    participant_count: award.participantCount,
    opened_at: award.openedAt,
    demand_agency: award.demandAgency,
  };
}

/** 공고번호 → 차수별 공고. 같은 번호·차수가 여러 기간 조각에서 와도 하나만 남긴다. */
export function indexNotices(
  notices: readonly NoticeApiRow[],
): ReadonlyMap<string, readonly NoticeApiRow[]> {
  const byKey = new Map<string, NoticeApiRow>();
  for (const notice of notices) byKey.set(`${notice.bidNoticeNo}|${notice.bidNoticeOrd}`, notice);
  const index = new Map<string, NoticeApiRow[]>();
  for (const notice of byKey.values()) {
    const list = index.get(notice.bidNoticeNo) ?? [];
    list.push(notice);
    index.set(notice.bidNoticeNo, list);
  }
  return index;
}

// ── 묶기·세기 ──

export type AwardClassCount = { classNo: string; className: string; count: number };

export type AwardHistoryBuild = {
  rows: AwardHistoryInsert[];
  /** 건너뛴 이유별 수. DUPLICATE 는 같은 (공고번호, 차수)가 여러 번 와서 하나만 남긴 수다 */
  skipped: Record<AwardSkipReason | "DUPLICATE", number>;
  groups: Record<CardMethodGroup, number>;
  /** 저장할 행의 분류 상위 10개 */
  topClasses: AwardClassCount[];
};

const TOP_CLASS_LIMIT = 10;

const emptySkipped = (): AwardHistoryBuild["skipped"] => ({
  NO_NOTICE: 0,
  OTHER_METHOD: 0,
  NO_CLASS: 0,
  NO_BASE: 0,
  NO_AWARD_AMOUNT: 0,
  NO_OPENED_AT: 0,
  RATIO_OUT_OF_RANGE: 0,
  DUPLICATE: 0,
});

const topClassesOf = (rows: readonly AwardHistoryInsert[]): AwardClassCount[] => {
  const counts = new Map<string, AwardClassCount>();
  for (const row of rows) {
    const entry = counts.get(row.procurement_class_no) ?? {
      classNo: row.procurement_class_no,
      className: row.procurement_class_name,
      count: 0,
    };
    entry.count += 1;
    counts.set(row.procurement_class_no, entry);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.classNo.localeCompare(b.classNo))
    .slice(0, TOP_CLASS_LIMIT);
};

/**
 * 받은 낙찰·공고를 이어 저장 행과 집계를 만든다. 같은 (공고번호, 차수)는 하나만 남긴다 —
 * 한 upsert 묶음에 같은 키가 두 번 들어가면 Postgres 가 묶음 전체를 거부한다. 남기는 쪽은 늦게 개찰한 행(재입찰)이다.
 */
export function buildAwardHistory(
  awards: readonly AwardApiRow[],
  notices: readonly NoticeApiRow[],
): AwardHistoryBuild {
  const index = indexNotices(notices);
  const skipped = emptySkipped();
  const byKey = new Map<string, AwardHistoryInsert>();
  for (const award of awards) {
    const joined = joinAwardWithNotice(award, index);
    if ("skipped" in joined) {
      skipped[joined.skipped] += 1;
      continue;
    }
    const key = `${joined.bid_notice_no}|${joined.bid_notice_ord}`;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      skipped.DUPLICATE += 1;
      if (existing.opened_at >= joined.opened_at) continue;
    }
    byKey.set(key, joined);
  }
  const rows = [...byKey.values()];
  const groups: Record<CardMethodGroup, number> = { NEGOTIATION: 0, LOWER_LIMIT: 0 };
  for (const row of rows) groups[row.award_method_group] += 1;
  return { rows, skipped, groups, topClasses: topClassesOf(rows) };
}

// ── 기간·호출 수 ──

/** S1: 낙찰 조회는 31일 창이 되고 40일은 봉투 없는 응답이었다. 여유를 두고 30일로 자른다. */
export const AWARD_WINDOW_MAX_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 지난 공고는 낙찰 기간 시작보다 이만큼 앞부터 받는다(공고 → 개찰 → 낙찰 등록까지 걸리는 시간). */
export const NOTICE_LEAD_MONTHS = 2;
/** 기간을 이보다 줄이면 표본이 너무 적어 거부한다(스펙 §4.2 최소 6개월). */
export const BACKFILL_MIN_MONTHS = 6;
export const BACKFILL_MAX_MONTHS = AWARD_LOOKBACK_MONTHS;

const monthsBefore = (at: Date, months: number): Date => {
  const start = new Date(at);
  start.setUTCMonth(start.getUTCMonth() - months);
  return start;
};

const splitWindow = (from: Date, to: Date, maxMs: number): G2bWindowSlice[] => {
  const start = from.getTime();
  const end = to.getTime();
  if (!(start < end)) return [];
  return Array.from({ length: Math.ceil((end - start) / maxMs) }, (_, index) => ({
    from: new Date(start + index * maxMs),
    to: new Date(Math.min(start + (index + 1) * maxMs, end)),
  }));
};

export type BackfillWindows = {
  /** 낙찰 등록일시(inqryDiv=1) 기준 30일 조각 */
  award: G2bWindowSlice[];
  /** 공고 게시일시(inqryDiv=1) 기준 하루 조각. 낙찰 기간보다 NOTICE_LEAD_MONTHS 앞부터 */
  notice: G2bWindowSlice[];
};

export function backfillWindowsOf(now: Date, months: number): BackfillWindows {
  return {
    award: splitWindow(monthsBefore(now, months), now, AWARD_WINDOW_MAX_DAYS * DAY_MS),
    notice: splitG2bWindow(monthsBefore(now, months + NOTICE_LEAD_MONTHS), now),
  };
}

/**
 * 예상 호출 수. 낙찰은 조각마다 건수 세기 1회 + 쪽 수, 공고는 하루마다 최소 1쪽이다(999행을 넘는 날은 더 든다).
 * awardPages 를 모르면(건수를 세기 전) 0 으로 두어 하한을 낸다.
 */
export const estimatedCallsOf = (windows: BackfillWindows, awardPages: number): number =>
  windows.award.length + awardPages + windows.notice.length;

/**
 * 상한 안에 드는 가장 긴 기간(BACKFILL_MIN_MONTHS 이상, 지금보다 짧게). 낙찰 쪽 수는 지금 기간의 쪽 수를 개월 비율로 줄여 본다.
 * 6개월로도 넘으면 null.
 */
export function suggestedMonthsOf(input: {
  now: Date;
  months: number;
  maxCalls: number;
  awardPages: number;
}): number | null {
  for (let months = input.months - 1; months >= BACKFILL_MIN_MONTHS; months -= 1) {
    const pages = Math.ceil((input.awardPages * months) / input.months);
    if (estimatedCallsOf(backfillWindowsOf(input.now, months), pages) <= input.maxCalls)
      return months;
  }
  return null;
}
