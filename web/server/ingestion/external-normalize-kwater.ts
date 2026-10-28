import "server-only";
import { dateMetadata, exactInstant } from "./external-dates";
import {
  EXTERNAL_SERVICES,
  KWATER_AGENCY_NAME,
  type ExternalItem,
} from "./external-connector.model";
import { sanitizeExternalValue } from "./external-payload";
import {
  collapseSpaces,
  finishDraft,
  missingFieldsOutcome,
  type NormalizeOutcome,
} from "./normalize-common";
import { kstCalendarDate } from "./normalize-date";
import {
  EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION,
  type BidStatus,
  type SourceMetadata,
} from "./normalized-bid.model";
import { sourceKeyOf, type WarningIssue } from "./validation";

// ── K-water 입찰공고(15101635 servcList 등) 한 행 → NormalizedBidDraft ──
// 필드 이름·뜻은 공개 명세(data.go.kr Swagger, 2026-10-28 열람)에서 왔다. 공사·물품·용역·내자 목록의 칸이 같다.
// 2026-10-28 실응답 녹음(servcList 202610, 147건 중 100행, fixtures/recorded/15101635)으로 꼴을 확인했다.
// - 상태: tndrStat 11개 값을 확인했다. 참가신청만 OPEN, 나머지는 CLOSED 다(사용자 결정 2026-10-28). 녹음에서
//   참가신청 32행은 모두 신청마감일이 남았고 금액이 0이었다. 적격신청·PQ신청은 모두 마감이 지났고 금액이 나와 있어
//   개찰 뒤 심사 단계로 본다. 처음 보는 값은 고르지 않고 격리한다.
// - 날짜: 공고일·신청마감일 모두 YYYYMMDD(날짜만)다. 마감 시각을 모르니 deadlineAt 은 비운다.
// - 예산: tndrPlnprc(명세 "금액(원)"). 0 은 아직 공개되지 않은 값으로 보고 비운다. 부가세 포함 여부는 모른다.
// - 참가자수·투찰자수는 수집할 때마다 바뀌어 revision 만 늘리므로 저장하지 않는다. 담당자 칸도 쓰지 않는다.
// - 출처 URL: 응답에 상세 URL 이 없어 서비스 설명 페이지를 쓴다(sourceUrlKind SERVICE_DOCUMENTATION).
const SOURCE = "kwater-bid-notice";
const service = EXTERNAL_SERVICES[SOURCE];

const STATES: Readonly<Record<string, BidStatus>> = {
  참가신청: "OPEN",
  적격신청: "CLOSED",
  PQ신청: "CLOSED",
  서류제출: "CLOSED",
  공동분담: "CLOSED",
  가격입찰: "CLOSED",
  제안서평가: "CLOSED",
  예가추첨: "CLOSED",
  수의시담: "CLOSED",
  입찰완료: "CLOSED",
  결과발표: "CLOSED",
};
const DATE_FIELDS = ["tndrPblancDe", "tndrPblancEnddt"] as const;
const ATTRIBUTE_FIELDS = ["cntrctDivNm", "ctrmthdCdNm", "cntrctDeptNm"];
const FIELDS = [
  "tndrPbanno",
  "tndrPblancNm",
  "tndrStat",
  "tndrPlnprc",
  ...DATE_FIELDS,
  ...ATTRIBUTE_FIELDS,
];

const absent = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && ["", "-"].includes(value.trim()));

type Fields = Record<string, string | null>;

// 이름은 대소문자를 가리지 않고 맞춘다. 같은 칸이 다른 값으로 두 번 오거나 값이 글자가 아니면 고르지 않고 격리한다.
function kwaterFields(
  item: ExternalItem,
): { ok: true; fields: Fields } | { ok: false; field: string } {
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

const rejected = (sourceKey: string, detail: string): NormalizeOutcome => ({
  ok: false,
  issue: { code: "SCHEMA_INVALID", sourceKey, detail },
});

// 참가신청이라도 신청마감일(KST 날짜)이 지났으면 지금 신청할 수 있는지 모른다. 시각이 없어 마감 당일은 열린 것으로 본다.
function participation(
  status: BidStatus,
  deadline: string | null,
  at: Date,
): SourceMetadata["participationStatus"] {
  if (status === "CLOSED") return "ENDED";
  if (deadline === null || !/^\d{8}$/.test(deadline)) return "UNKNOWN";
  const { year, month, day } = kstCalendarDate(at);
  const today = `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
  return today > deadline ? "UNKNOWN" : "APPLICATION_OPEN";
}

export function normalizeKwaterBidNotice(
  item: ExternalItem,
  context: { fetchedAt: Date; operation?: string },
): NormalizeOutcome {
  const safe = sanitizeExternalValue(item);
  if (typeof safe !== "object" || safe === null || Array.isArray(safe))
    return rejected(sourceKeyOf(SOURCE, null), "SCHEMA_INVALID");
  const lookup = kwaterFields(safe as ExternalItem);
  if (!lookup.ok) return rejected(sourceKeyOf(SOURCE, null), `CONFLICTED_ALIAS: ${lookup.field}`);
  const fields = lookup.fields;
  const noticeId = fields.tndrPbanno;
  const sourceKey = sourceKeyOf(SOURCE, noticeId);
  if (noticeId === null || fields.tndrPblancNm === null)
    return missingFieldsOutcome(
      [noticeId === null ? "noticeId" : null, fields.tndrPblancNm === null ? "title" : null].filter(
        (field) => field !== null,
      ),
      sourceKey,
    );
  // 공고번호는 다른 공고와 섞이면 안 되는 열쇠다. 공백이 섞이거나 너무 길면 고치지 않고 격리한다.
  if (!/^\S{1,64}$/.test(noticeId)) return rejected(sourceKey, "invalid: noticeId");
  const providerStatus = fields.tndrStat;
  if (providerStatus === null || !Object.hasOwn(STATES, providerStatus))
    return rejected(sourceKey, "PROVIDER_STATUS_NOT_VERIFIED");
  const status = STATES[providerStatus];

  const dates: SourceMetadata["dates"] = {};
  for (const name of DATE_FIELDS) {
    const parsed = dateMetadata(fields[name], context.fetchedAt);
    if (parsed) dates[name] = parsed;
  }
  const warnings: WarningIssue[] = Object.entries(dates)
    .filter(([, date]) => date.utc === null)
    .map(([name]) => ({ code: "DATE_UNPARSED", sourceKey, detail: `${name} unparsed` }));
  const raw = fields.tndrPlnprc;
  const won = raw !== null && /^(?:0|[1-9]\d{0,14})$/.test(raw);
  if (raw !== null && !won)
    warnings.push({ code: "BUDGET_UNPARSED", sourceKey, detail: "budget unparsed" });
  const budgetKrw = won && raw !== "0" ? raw : null;
  const notes = [
    "sourceUrl은 서비스 설명 페이지다. 공고 상세 URL은 응답에 없다.",
    "budgetKrw: tndrPlnprc(금액, 원 단위, 부가세 포함 여부 미확인) 사용. 0 은 공개 전 값으로 보고 비웠다.",
    ...(dates.tndrPblancEnddt
      ? ["deadlineAt: 신청마감일이 날짜만 있고 시각이 없어 비웠다(원문은 sourceMetadata.dates)."]
      : []),
  ];
  const sourceMetadata: SourceMetadata = {
    sourceFamily: service.family,
    serviceId: service.serviceId,
    operation: context.operation ?? service.operation,
    providerRecordKey: noticeId,
    providerStatus,
    sourceUrlKind: "SERVICE_DOCUMENTATION",
    agencyCodeNamespace: "KWATER_DEPT",
    ...(fields.cntrctDeptNm === null ? {} : { agencyCode: fields.cntrctDeptNm }),
    applicationDeadlineAt: exactInstant(dates.tndrPblancEnddt),
    biddingStartsAt: null,
    biddingEndsAt: null,
    participationStatus: participation(status, fields.tndrPblancEnddt, context.fetchedAt),
    providerEvent: null,
    dates,
    amounts:
      raw === null
        ? []
        : [
            {
              kind: "tndrPlnprc",
              raw,
              amountKrw: won ? raw : null,
              currency: won ? ("KRW" as const) : null,
              unit: won ? ("KRW" as const) : ("UNVERIFIED" as const),
              vat: "UNVERIFIED" as const,
            },
          ],
    attributes: Object.fromEntries(
      ATTRIBUTE_FIELDS.flatMap((name) => (fields[name] === null ? [] : [[name, fields[name]]])),
    ),
  };
  return finishDraft(
    {
      schemaVersion: EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION,
      source: SOURCE,
      noticeId,
      stage: "NOTICE",
      status,
      title: collapseSpaces(fields.tndrPblancNm),
      agency: KWATER_AGENCY_NAME,
      budgetKrw,
      noticeDate: dates.tndrPblancDe?.utc ?? null,
      deadlineAt: null,
      sourceUrl: `https://www.data.go.kr/data/${service.serviceId}/openapi.do`,
      content: [
        ["구분", fields.cntrctDivNm],
        ["계약방법", fields.ctrmthdCdNm],
        ["계약부서", fields.cntrctDeptNm],
      ]
        .flatMap(([label, value]) => (value === null ? [] : [`${label}: ${value}`]))
        .join("\n"),
      attachments: [],
      structuredQualifications: [],
      original: {
        noticeNo: noticeId,
        status: providerStatus,
        ...(budgetKrw === null ? {} : { budget: budgetKrw }),
        ...(fields.tndrPblancDe === null ? {} : { noticeDate: fields.tndrPblancDe }),
        ...(fields.tndrPblancEnddt === null ? {} : { deadline: fields.tndrPblancEnddt }),
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
