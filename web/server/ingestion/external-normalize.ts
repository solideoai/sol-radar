import "server-only";
import { checkAttachmentUrl } from "./attachment-allowlist";
import {
  EXTERNAL_SERVICES,
  KEPCO_COMPANIES,
  type ExternalItem,
  type ExternalSourceKey,
} from "./external-connector.model";
import { dateMetadata } from "./external-dates";
import { normalizeKwaterBidNotice } from "./external-normalize-kwater";
import { normalizeLhBidNotice } from "./external-normalize-lh";
import { sanitizeExternalValue } from "./external-payload";
import { collapseSpaces, finishDraft, type NormalizeOutcome } from "./normalize-common";
import {
  EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION,
  type BidStatus,
  type SourceMetadata,
} from "./normalized-bid.model";
import { sourceKeyOf, type WarningIssue } from "./validation";

const absent = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && ["", "-"].includes(value.trim()));
const text = (value: unknown): string | null =>
  typeof value === "string" && !absent(value) ? value.trim() : null;
// Explicit aliases are case-insensitive; disagreeing representations are quarantined instead of choosing one.
const KEPCO_ALIASES = [
  "no",
  "name",
  "noticeDate",
  "progressState",
  "companyId",
  "bidAttendReqBeginDatetime",
  "bidAttendReqCloseDatetime",
  "beginDatetime",
  "endDatetime",
  "presumedPrice",
  "presumedAmount",
  "estimatedPriceBasicAmount",
  "etc",
  "bidAttendRestrict",
  "bidAttendDocument",
  "placeName",
  "competitionType",
  "bidType",
  "vendorAwardType",
  "jointSupplyDemandYn",
  "filename1",
  "filename2",
  "filename3",
  "filename4",
  "filename5",
  "filenlink1",
  "filenlink2",
  "filenlink3",
  "filenlink4",
  "filenlink5",
] as const;
// 2026-10-28 실응답 71건: 금액은 모두 원 단위 정수다. 추정가격·추정금액이 둘 다 있는 29건 중 19건이 추정금액 =
// 추정가격 × 1.1 이라 추정가격은 부가세 별도다. 나머지 10건은 배수가 1.0~3.4 로 갈려 추정금액·예비가격기초금액의
// 부가세 포함 여부는 정하지 않는다.
const AMOUNT_FIELDS = ["presumedPrice", "presumedAmount", "estimatedPriceBasicAmount"];
const AMOUNT_VAT: Record<string, "EXCLUDED"> = { presumedPrice: "EXCLUDED" };
const STATES: Readonly<
  Record<string, { status: BidStatus; event: SourceMetadata["providerEvent"] }>
> = {
  PreAttendProgress: { status: "OPEN", event: null },
  AttendProgress: { status: "OPEN", event: null },
  Close: { status: "CLOSED", event: null },
  Fail: { status: "CLOSED", event: "FAILED" },
  OpenTimed: { status: "CLOSED", event: "OPENED" },
  Final: { status: "CLOSED", event: "ENDED" },
};
const rejected = (source: ExternalSourceKey, detail: string): NormalizeOutcome => ({
  ok: false,
  issue: { code: "SCHEMA_INVALID", sourceKey: sourceKeyOf(source, null), detail },
});
function kepcoFields(
  item: ExternalItem,
): { ok: true; fields: Record<string, string | null> } | { ok: false; field: string } {
  const fields: Record<string, string | null> = {};
  for (const alias of KEPCO_ALIASES) {
    const values = Object.entries(item)
      .filter(([key, value]) => key.toLowerCase() === alias.toLowerCase() && !absent(value))
      .map(([, value]) => value);
    if (
      values.some((value) => typeof value !== "string") ||
      new Set(values.map((value) => (typeof value === "string" ? value.trim() : value))).size > 1
    )
      return { ok: false, field: alias };
    fields[alias] = text(values[0]);
  }
  return { ok: true, fields };
}
function participation(
  fields: Record<string, string | null>,
  dates: SourceMetadata["dates"],
  at: Date,
): SourceMetadata["participationStatus"] {
  const state = fields.progressState;
  if (state !== null && Object.hasOwn(STATES, state) && STATES[state].status === "CLOSED")
    return "ENDED";
  const appStart = dates.bidAttendReqBeginDatetime;
  const appEnd = dates.bidAttendReqCloseDatetime;
  const bidStart = dates.beginDatetime;
  const bidEnd = dates.endDatetime;
  const instant = (date: typeof appStart): number | null =>
    date?.utc && date.precision !== "DATE" ? Date.parse(date.utc) : null;
  const now = at.getTime();
  const begin = instant(bidStart);
  const end = instant(bidEnd);
  const applicationBegin = instant(appStart);
  const applicationEnd = instant(appEnd);
  if (end !== null && now >= end) return "ENDED";
  // An elapsed application deadline does not prove this organization has already applied.
  if (applicationEnd !== null && now >= applicationEnd) return "UNKNOWN";
  if (begin !== null && end !== null && now >= begin && now < end && applicationEnd !== null)
    return "BIDDING_OPEN";
  if (
    applicationBegin !== null &&
    applicationEnd !== null &&
    now >= applicationBegin &&
    now < applicationEnd
  )
    return "APPLICATION_OPEN";
  if (applicationBegin !== null && now < applicationBegin) return "NOT_STARTED";
  return "UNKNOWN";
}
export function normalizeExternalNotice(
  sourceKey: ExternalSourceKey,
  item: ExternalItem,
  context: { fetchedAt: Date; companyId?: string; operation?: string },
): NormalizeOutcome {
  if (sourceKey === "kwater-procurement-plan" || sourceKey === "lh-pre-specification")
    return rejected(sourceKey, "IDENTITY_NOT_VERIFIED");
  if (sourceKey === "g2b-procurement-request")
    return rejected(sourceKey, "OPERATION_INPUTS_NOT_VERIFIED");
  if (sourceKey === "lh-bid-notice") return normalizeLhBidNotice(item, context);
  if (sourceKey === "kwater-bid-notice") return normalizeKwaterBidNotice(item, context);
  if (sourceKey !== "kepco-ebid-contract")
    return rejected(sourceKey, "PROVIDER_STATUS_NOT_VERIFIED");
  const safe = sanitizeExternalValue(item);
  if (typeof safe !== "object" || safe === null || Array.isArray(safe))
    return rejected(sourceKey, "SCHEMA_INVALID");
  const lookup = kepcoFields(safe as ExternalItem);
  if (!lookup.ok) return rejected(sourceKey, `CONFLICTED_ALIAS: ${lookup.field}`);
  const fields = lookup.fields;
  if (fields.companyId && context.companyId && fields.companyId !== context.companyId)
    return rejected(sourceKey, "CONFLICTED_COMPANY_ID");
  const companyId = fields.companyId ?? context.companyId;
  if (!companyId || !Object.hasOwn(KEPCO_COMPANIES, companyId))
    return rejected(sourceKey, "COMPANY_ID_NOT_VERIFIED");
  if (!fields.no || !fields.name) return rejected(sourceKey, "IDENTITY_NOT_VERIFIED");
  const status = fields.progressState;
  if (!status || !Object.hasOwn(STATES, status))
    return rejected(sourceKey, "PROVIDER_STATUS_NOT_VERIFIED");
  const noticeId = `${encodeURIComponent(companyId)}:${encodeURIComponent(fields.no)}`;
  const sourceKeyValue = sourceKeyOf(sourceKey, noticeId);
  const dates: SourceMetadata["dates"] = {};
  for (const name of [
    "noticeDate",
    "bidAttendReqBeginDatetime",
    "bidAttendReqCloseDatetime",
    "beginDatetime",
    "endDatetime",
  ]) {
    const parsed = dateMetadata(fields[name], context.fetchedAt);
    if (parsed) dates[name] = parsed;
  }
  const exact = (name: string): string | null =>
    dates[name]?.precision !== "DATE" ? (dates[name]?.utc ?? null) : null;
  const amounts: SourceMetadata["amounts"] = AMOUNT_FIELDS.flatMap((kind) => {
    const raw = fields[kind];
    if (raw === null) return [];
    const won = /^(?:0|[1-9]\d{0,14})$/.test(raw);
    return [
      {
        kind,
        raw,
        amountKrw: won ? raw : null,
        currency: won ? ("KRW" as const) : null,
        unit: won ? ("KRW" as const) : ("UNVERIFIED" as const),
        vat: won ? (AMOUNT_VAT[kind] ?? "UNVERIFIED") : ("UNVERIFIED" as const),
      },
    ];
  });
  // 대표 예산은 원 단위로 읽힌 추정가격만 쓴다. 읽지 못한 값은 원문(amounts)만 남기고 예산을 비운다
  const budgetKrw = amounts.find(({ kind }) => kind === "presumedPrice")?.amountKrw ?? null;
  const warnings: WarningIssue[] =
    fields.presumedPrice !== null && budgetKrw === null
      ? [{ code: "BUDGET_UNPARSED", sourceKey: sourceKeyValue, detail: "budget unparsed" }]
      : [];
  const attachments = Array.from({ length: 5 }, (_, i) => i + 1).flatMap((slot) => {
    const url = fields[`filenlink${slot}`];
    if (!url) return [];
    const checked = checkAttachmentUrl(url);
    if (!checked.ok) {
      warnings.push({
        code: "ATTACHMENT_URL_BLOCKED",
        sourceKey: sourceKeyValue,
        detail: `attachment url not allowed: filenlink${slot}`,
      });
      return [];
    }
    return [{ name: fields[`filename${slot}`] ?? `첨부 ${slot}`, url: checked.url.href }];
  });
  for (const [name, date] of Object.entries(dates)) {
    if (date.utc === null)
      warnings.push({
        code: "DATE_UNPARSED",
        sourceKey: sourceKeyValue,
        detail: `${name} unparsed`,
      });
  }
  const service = EXTERNAL_SERVICES[sourceKey];
  const sourceMetadata: SourceMetadata = {
    sourceFamily: service.family,
    serviceId: service.serviceId,
    operation: context.operation ?? service.operation,
    providerCompanyId: companyId,
    providerRecordKey: fields.no,
    providerStatus: status,
    sourceUrlKind: "SERVICE_DOCUMENTATION",
    agencyCodeNamespace: "KEPCO_COMPANY",
    agencyCode: companyId,
    applicationDeadlineAt: exact("bidAttendReqCloseDatetime"),
    biddingStartsAt: exact("beginDatetime"),
    biddingEndsAt: exact("endDatetime"),
    participationStatus: participation(fields, dates, context.fetchedAt),
    providerEvent: STATES[status].event,
    dates,
    amounts,
    attributes: Object.fromEntries(
      [
        "etc",
        "bidAttendRestrict",
        "bidAttendDocument",
        "placeName",
        "competitionType",
        "bidType",
        "vendorAwardType",
        "jointSupplyDemandYn",
        ...Array.from({ length: 5 }, (_, i) => `filename${i + 1}`),
        ...Array.from({ length: 5 }, (_, i) => `filenlink${i + 1}`),
      ].flatMap((name) => (fields[name] === null ? [] : [[name, fields[name]]])),
    ),
  };
  return finishDraft(
    {
      schemaVersion: EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION,
      source: sourceKey,
      noticeId,
      stage: "NOTICE",
      status: STATES[status].status,
      title: collapseSpaces(fields.name),
      agency: KEPCO_COMPANIES[companyId],
      budgetKrw,
      noticeDate: dates.noticeDate?.utc ?? null,
      deadlineAt: exact("endDatetime"),
      sourceUrl: `https://www.data.go.kr/data/${service.serviceId}/openapi.do`,
      content: [fields.etc, fields.bidAttendRestrict, fields.bidAttendDocument]
        .filter((value) => value !== null)
        .join("\n"),
      attachments,
      structuredQualifications: [],
      original: {
        noticeNo: fields.no,
        status,
        ...(fields.presumedPrice ? { budget: fields.presumedPrice } : {}),
        ...(fields.noticeDate ? { noticeDate: fields.noticeDate } : {}),
        ...(fields.endDatetime ? { deadline: fields.endDatetime } : {}),
      },
      sourceMetadata,
      normalizationNotes: [
        "sourceUrl은 서비스 설명 페이지다. 실제 공고 상세 URL은 미검증.",
        "budgetKrw: presumedPrice(추정가격, 부가세 별도) 사용. 원 단위는 2026-10-28 실응답으로 확인.",
      ],
      isDemo: false,
      fetchedAt: context.fetchedAt.toISOString(),
    },
    sourceKeyValue,
    warnings,
  );
}
