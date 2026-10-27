import "server-only";
import { dateMetadata, exactInstant, type ExternalDate } from "./external-dates";
import { EXTERNAL_SERVICES, LH_AGENCY_NAME, type ExternalItem } from "./external-connector.model";
import { sanitizeExternalValue } from "./external-payload";
import {
  collapseSpaces,
  dateOrderWarning,
  finishDraft,
  missingFieldsOutcome,
  normalizeBudgetValue,
  type NormalizeOutcome,
} from "./normalize-common";
import {
  EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION,
  type BidStatus,
  type SourceMetadata,
} from "./normalized-bid.model";
import { sourceKeyOf, type WarningIssue } from "./validation";

// ── LH 입찰공고(15159012 getOpenBidInfo) 한 행 → NormalizedBidDraft ──
// 필드 이름·뜻은 공개 명세(data.go.kr Swagger, 2026-10-27 열람)에서 왔다. 실응답으로 확인하지 않은 것:
// 날짜 자릿수, 금액 단위, bidKind·bidProgrsStatus 값 목록, 공고 상세 URL. 그래서 아래처럼 보수적으로 옮긴다.
// - 상태: "취소"·"정정/변경"·마감류 낱말만 읽는다. 모르는 값은 OPEN 으로 두고 원문과 메모를 남긴다(시간으로 상태를 바꾸지 않는다).
// - 예산: 추정가격(presmtPrc)을 원 단위로 읽는다. 부가세 별도. 다른 금액은 원문만 남긴다.
// - 출처 URL: 응답에 상세 URL 이 없어 서비스 설명 페이지를 쓴다(sourceUrlKind SERVICE_DOCUMENTATION).
const SOURCE = "lh-bid-notice";
const service = EXTERNAL_SERVICES[SOURCE];

const range = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);
// 업종 n(1~10)마다 주/부 구분·요구면허 1~10·면허조건·업종그룹·면허구분
const REQUIREMENT_FIELDS = range(10).flatMap((n) => [
  `req${n}MvgbNm`,
  ...range(10).map((m) => `req${n}Reqlic${m}Nm`),
  `req${n}LicctNm`,
  `req${n}BsncatGrpNm`,
  `req${n}LicGbNm`,
]);
const REGION_FIELDS = range(4).map((n) => `zoneRstrct${n}`);
const JOINT_REGION_FIELDS = range(4).map((n) => `vndrrstrctNm${n}`);
const DATE_FIELDS = [
  "tndrbidRegDt",
  "cooperdocAcptEndDtm",
  "tndrdocAcptBgninDtm",
  "tndrdocAcptEndDtm",
  "openDtm",
] as const;
const AMOUNT_FIELDS = ["presmtPrc", "addtTax", "designPrc", "fdmtlAmt", "prcscoreExclusAmt"];
const ATTRIBUTE_FIELDS = [
  "bidKind",
  "bidProgrsStatus",
  "cstrtnJobGbNm",
  "zoneHqCd",
  "tndrCtrctMedCd",
  "sunjungNm",
  "gongdongNm",
  "bidnmEng",
  "antbsncatRstrctFg",
  ...REGION_FIELDS,
  ...JOINT_REGION_FIELDS,
  ...REQUIREMENT_FIELDS,
];
const FIELDS = [
  "bidNum",
  "bidDegree",
  "bidnmKor",
  ...DATE_FIELDS,
  ...AMOUNT_FIELDS,
  ...ATTRIBUTE_FIELDS,
];

const absent = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && ["", "-"].includes(value.trim()));

type Fields = Record<string, string | null>;

// 이름은 대소문자를 가리지 않고 맞춘다. 같은 칸이 다른 값으로 두 번 오거나 값이 글자가 아니면 고르지 않고 격리한다.
function lhFields(item: ExternalItem): { ok: true; fields: Fields } | { ok: false; field: string } {
  const fields: Fields = {};
  for (const name of FIELDS) {
    const values = Object.entries(item)
      .filter(([key, value]) => key.toLowerCase() === name.toLowerCase() && !absent(value))
      .map(([, value]) => value);
    if (values.some((value) => typeof value !== "string")) return { ok: false, field: name };
    const texts = new Set(values.map((value) => String(value).trim()));
    if (texts.size > 1) return { ok: false, field: name };
    fields[name] = texts.size === 1 ? [...texts][0] : null;
  }
  return { ok: true, fields };
}

// 명세는 날짜를 integer 로만 적었다. 8자리(일)·12자리(분)·14자리(초)를 읽고, 나머지는 공용 해석기에 맡긴다.
function lhDate(raw: string | null, fetchedAt: Date): ExternalDate | null {
  if (raw === null) return null;
  const seconds = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(raw);
  const readable = seconds
    ? `${seconds[1]}-${seconds[2]}-${seconds[3]} ${seconds[4]}:${seconds[5]}:${seconds[6]}`
    : raw;
  const parsed = dateMetadata(readable, fetchedAt);
  return parsed === null ? null : { ...parsed, raw };
}

// 상태 값 목록은 미검증이다. 뜻이 분명한 낱말만 읽고 시각으로 상태를 만들지 않는다(같은 응답이면 같은 revision).
function statusOf(fields: Fields): { status: BidStatus; mapped: boolean } {
  const kind = fields.bidKind ?? "";
  const progress = fields.bidProgrsStatus ?? "";
  if (/취소/.test(`${kind} ${progress}`)) return { status: "CANCELLED", mapped: true };
  if (/정정|변경/.test(kind)) return { status: "AMENDED", mapped: true };
  if (/유찰|낙찰|개찰|마감|종료|완료/.test(progress)) return { status: "CLOSED", mapped: true };
  if (/공고|진행|접수/.test(`${kind} ${progress}`)) return { status: "OPEN", mapped: true };
  return { status: "OPEN", mapped: false };
}

function participation(
  status: BidStatus,
  dates: SourceMetadata["dates"],
  at: Date,
): SourceMetadata["participationStatus"] {
  if (status === "CANCELLED" || status === "CLOSED") return "ENDED";
  const begin = exactInstant(dates.tndrdocAcptBgninDtm);
  const end = exactInstant(dates.tndrdocAcptEndDtm);
  const now = at.getTime();
  if (end !== null && now >= Date.parse(end)) return "ENDED";
  if (begin !== null && now < Date.parse(begin)) return "NOT_STARTED";
  if (begin !== null && end !== null) return "BIDDING_OPEN";
  return "UNKNOWN";
}

// 본문이 없는 서비스라 분석에 쓸 조건 줄만 모은다(값이 있는 칸만, 응답 순서 그대로).
function contentOf(fields: Fields): string {
  const line = (label: string, values: (string | null)[]): string[] => {
    const present = values.filter((value) => value !== null);
    return present.length === 0 ? [] : [`${label}: ${present.join(", ")}`];
  };
  return [
    ...line("업무구분", [fields.cstrtnJobGbNm]),
    ...line("입찰계약방법", [fields.tndrCtrctMedCd]),
    ...line("낙찰자선정방법", [fields.sunjungNm]),
    ...line("공동수급구성방식", [fields.gongdongNm]),
    ...line(
      "참가지역",
      REGION_FIELDS.map((name) => fields[name]),
    ),
    ...line(
      "지역의무공동업체 참가지역",
      JOINT_REGION_FIELDS.map((name) => fields[name]),
    ),
    ...range(10).flatMap((n) =>
      line(
        `업종${n} 요구면허`,
        range(10).map((m) => fields[`req${n}Reqlic${m}Nm`]),
      ),
    ),
  ].join("\n");
}

export function normalizeLhBidNotice(
  item: ExternalItem,
  context: { fetchedAt: Date; operation?: string },
): NormalizeOutcome {
  const safe = sanitizeExternalValue(item);
  if (typeof safe !== "object" || safe === null || Array.isArray(safe))
    return {
      ok: false,
      issue: {
        code: "SCHEMA_INVALID",
        sourceKey: sourceKeyOf(SOURCE, null),
        detail: "SCHEMA_INVALID",
      },
    };
  const lookup = lhFields(safe as ExternalItem);
  if (!lookup.ok)
    return {
      ok: false,
      issue: {
        code: "SCHEMA_INVALID",
        sourceKey: sourceKeyOf(SOURCE, null),
        detail: `CONFLICTED_ALIAS: ${lookup.field}`,
      },
    };
  const fields = lookup.fields;
  const noticeId = fields.bidNum;
  const sourceKey = sourceKeyOf(SOURCE, noticeId);
  if (noticeId === null || fields.bidnmKor === null)
    return missingFieldsOutcome(
      [noticeId === null ? "noticeId" : null, fields.bidnmKor === null ? "title" : null].filter(
        (field) => field !== null,
      ),
      sourceKey,
    );
  // 공고번호는 다른 공고와 섞이면 안 되는 열쇠다. 공백이 섞이거나 너무 길면 고치지 않고 격리한다.
  if (!/^\S{1,64}$/.test(noticeId))
    return {
      ok: false,
      issue: { code: "SCHEMA_INVALID", sourceKey, detail: "invalid: noticeId" },
    };
  // 차수는 정정 순서(amendmentNo)다. 없거나 숫자가 아니면 늦게 온 옛 사본을 STALE 로 막을 수 없어
  // (revision.ts) 취소·정정 뒤 내용을 되돌릴 수 있다. 고치지 않고 그 행만 격리한다.
  if (fields.bidDegree === null) return missingFieldsOutcome(["amendmentNo"], sourceKey);
  if (!/^\d{1,4}$/.test(fields.bidDegree))
    return {
      ok: false,
      issue: { code: "SCHEMA_INVALID", sourceKey, detail: "invalid: amendmentNo" },
    };
  const degree = fields.bidDegree;

  const dates: SourceMetadata["dates"] = {};
  for (const name of DATE_FIELDS) {
    const parsed = lhDate(fields[name], context.fetchedAt);
    if (parsed) dates[name] = parsed;
  }
  const warnings: (WarningIssue | undefined)[] = Object.entries(dates)
    .filter(([, date]) => date.utc === null)
    .map(([name]) => ({ code: "DATE_UNPARSED", sourceKey, detail: `${name} unparsed` }));
  const budget = normalizeBudgetValue(fields.presmtPrc ?? undefined, sourceKey);
  const noticeDate = dates.tndrbidRegDt?.utc ?? null;
  const deadlineAt = exactInstant(dates.tndrdocAcptEndDtm);
  warnings.push(budget.warning, dateOrderWarning(noticeDate, deadlineAt, sourceKey));

  const { status, mapped } = statusOf(fields);
  const providerStatus = fields.bidProgrsStatus ?? fields.bidKind;
  const notes = [
    "sourceUrl은 서비스 설명 페이지다. 공고 상세 URL은 응답에 없다.",
    "budgetKrw: presmtPrc(추정가격, 부가세 별도) 사용. 원 단위는 공개 명세 기준이며 실응답 미검증.",
    ...(mapped ? [] : ["status: 공급자 상태 값을 읽지 못해 OPEN 으로 두었다."]),
    ...(dates.tndrdocAcptEndDtm?.precision === "DATE"
      ? ["deadlineAt: 마감이 날짜만 있고 시각이 없어 비웠다(원문은 sourceMetadata.dates)."]
      : []),
  ];
  const sourceMetadata: SourceMetadata = {
    sourceFamily: service.family,
    serviceId: service.serviceId,
    operation: context.operation ?? service.operation,
    providerRecordKey: `${noticeId}:${degree}`,
    providerStatus: fields.bidProgrsStatus,
    sourceUrlKind: "SERVICE_DOCUMENTATION",
    agencyCodeNamespace: "LH_ZONE_HQ",
    ...(fields.zoneHqCd === null ? {} : { agencyCode: fields.zoneHqCd }),
    applicationDeadlineAt: null,
    biddingStartsAt: exactInstant(dates.tndrdocAcptBgninDtm),
    biddingEndsAt: deadlineAt,
    participationStatus: participation(status, dates, context.fetchedAt),
    providerEvent: null,
    dates,
    amounts: AMOUNT_FIELDS.flatMap((kind) => {
      const raw = fields[kind];
      return raw === null
        ? []
        : [
            {
              kind,
              raw,
              amountKrw: null,
              currency: null,
              unit: "UNVERIFIED" as const,
              vat: "UNVERIFIED" as const,
            },
          ];
    }),
    attributes: Object.fromEntries(
      ATTRIBUTE_FIELDS.flatMap((name) => (fields[name] === null ? [] : [[name, fields[name]]])),
    ),
  };
  return finishDraft(
    {
      schemaVersion: EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION,
      source: SOURCE,
      noticeId,
      amendmentNo: degree,
      stage: "NOTICE",
      status,
      title: collapseSpaces(fields.bidnmKor),
      agency: LH_AGENCY_NAME,
      budgetKrw: budget.value,
      noticeDate,
      deadlineAt,
      sourceUrl: `https://www.data.go.kr/data/${service.serviceId}/openapi.do`,
      content: contentOf(fields),
      attachments: [],
      structuredQualifications: [],
      original: {
        noticeNo: noticeId,
        ...(providerStatus === null ? {} : { status: providerStatus }),
        ...(budget.original === undefined ? {} : { budget: budget.original }),
        ...(fields.tndrbidRegDt === null ? {} : { noticeDate: fields.tndrbidRegDt }),
        ...(fields.tndrdocAcptEndDtm === null ? {} : { deadline: fields.tndrdocAcptEndDtm }),
      },
      sourceMetadata,
      normalizationNotes: notes,
      isDemo: false,
      fetchedAt: context.fetchedAt.toISOString(),
    },
    sourceKey,
    warnings,
  );
}
