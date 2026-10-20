import "server-only";
import { checkAttachmentUrl } from "./attachment-allowlist";
import { canonicalJson, finalizeRevision } from "./checksum";
import type { G2bItem } from "./connector.model";
import type { G2bAuxOutcome, G2bAuxRows } from "./g2b-aux";
import {
  G2B_AUX_OPERATIONS,
  G2B_EORDER_ATTACH_OPERATION,
  G2B_LICENSE_LIMIT_OPERATION,
  G2B_REGION_OPERATION,
  type G2bAuxRegistryKey,
} from "./g2b.model";
import { collapseSpaces, isBlank } from "./normalize-common";
import { sortStructuredRequirements } from "./normalize-g2b";
import { parseKstDateTime } from "./normalize-date";
import type {
  AuxLookup,
  BidAttachment,
  NormalizedBid,
  NormalizedBidDraft,
  StructuredRequirement,
} from "./normalized-bid.model";
import type { StoredRevision } from "./revision";

// ── 보조 조회 행 → NormalizedBid 의 structuredQualifications·attachments (07 §3.1, 15 §3, C1 증거 §5·§10-5) ──
// 순수 함수다. 같은 행이 다른 순서로 와도 같은 결과(같은 checksum)가 되게 모든 목록을 결정적으로 정렬한다.
// 담당자 필드는 fetcher 가 이미 뺐다(stripContactFields). value 에는 그 행의 원본 필드를 그대로 둔다.

/** e발주 첨부 URL 의 경로(실측: www.g2b.go.kr). 목록 첨부(downloadFile.do)와 구별해 보조 유래를 알아본다 */
export const G2B_EORDER_ATTACHMENT_PATH = "/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do";
const AUX_OPERATIONS: ReadonlySet<string> = new Set([
  G2B_LICENSE_LIMIT_OPERATION,
  G2B_REGION_OPERATION,
  G2B_EORDER_ATTACH_OPERATION,
]);

// "이름/코드"(예: 정보통신공사업/0036). 코드는 업종 마스터 indstrytyCd 와 같은 4자리다(C1 증거 §10-8).
const NAME_AND_CODE = /^(.*)\/(\d{4})$/;
const BRACKETED = /\[([^\]]*)\]/g;

const text = (raw: unknown): string | null =>
  typeof raw === "string" && !isBlank(raw) ? collapseSpaces(raw) : null;

/** "이름/코드" 를 나눈다. 코드 꼴이 아니면 전체가 이름이고 코드는 null 이다. */
export function splitNameAndCode(raw: string): { name: string | null; code: string | null } {
  const value = collapseSpaces(raw);
  if (value === "") return { name: null, code: null };
  const match = NAME_AND_CODE.exec(value);
  if (!match) return { name: value, code: null };
  const name = collapseSpaces(match[1]);
  return { name: name === "" ? null : name, code: match[2] };
}

// 정렬 키. 숫자 문자열은 숫자로 비교하고, 같으면 canonical JSON 으로 결정적 순서를 만든다.
const numberOf = (raw: unknown): number =>
  typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : Number.POSITIVE_INFINITY;

const compareBy =
  (keys: readonly string[]) =>
  (left: G2bItem, right: G2bItem): number => {
    for (const key of keys) {
      const difference = numberOf(left[key]) - numberOf(right[key]);
      if (difference !== 0 && !Number.isNaN(difference)) return difference;
    }
    return canonicalJson(left).localeCompare(canonicalJson(right));
  };

const sortedRows = (rows: readonly G2bItem[], keys: readonly string[]): G2bItem[] =>
  [...rows].sort(compareBy(keys));

/** 면허제한 행 → LICENSE_LIMIT 하나씩. permsnIndstrytyList 의 "[이름/코드],…" 는 PERMITTED_INDUSTRY 로 푼다. */
export function licenseRequirementsOf(rows: readonly G2bItem[]): StructuredRequirement[] {
  const sorted = sortedRows(rows, ["lmtGrpNo", "lmtSno"]);
  const licenses = sorted.map((row): StructuredRequirement => {
    const { name, code } =
      typeof row.lcnsLmtNm === "string"
        ? splitNameAndCode(row.lcnsLmtNm)
        : {
            name: null,
            code: null,
          };
    return {
      kind: "LICENSE_LIMIT",
      code,
      name,
      value: row,
      sourceOperation: G2B_LICENSE_LIMIT_OPERATION,
    };
  });
  const seen = new Set<string>();
  const industries = sorted.flatMap((row): StructuredRequirement[] => {
    const list = typeof row.permsnIndstrytyList === "string" ? row.permsnIndstrytyList : "";
    return [...list.matchAll(BRACKETED)].flatMap((match) => {
      const entry = collapseSpaces(match[1]);
      if (entry === "" || seen.has(entry)) return [];
      seen.add(entry);
      const { name, code } = splitNameAndCode(entry);
      return [
        {
          kind: "PERMITTED_INDUSTRY",
          code,
          name,
          value: row,
          sourceOperation: G2B_LICENSE_LIMIT_OPERATION,
        },
      ];
    });
  });
  return [...licenses, ...industries];
}

/** 참가가능지역 행 → PARTICIPATION_REGION 하나씩. */
export function regionRequirementsOf(rows: readonly G2bItem[]): StructuredRequirement[] {
  return sortedRows(rows, ["lmtSno"]).map((row) => ({
    kind: "PARTICIPATION_REGION",
    code: null,
    name: text(row.prtcptPsblRgnNm),
    value: row,
    sourceOperation: G2B_REGION_OPERATION,
  }));
}

/**
 * e발주 첨부 행 → attachments. URL 이 없거나 첨부 허용 목록(https://www.g2b.go.kr/pn/…, 09 SSRF) 밖인 행은 뺀다.
 * 응답이 바뀌거나 변조돼 다른 호스트·http·사설 주소가 와도 저장하지 않는다(documents 소비자가 믿고 받지 않게).
 * 저장하는 URL 은 원문이 아니라 URL 파서가 정규화한 href 다. 이름이 없으면 문서 구분·순번으로 만든다.
 */
export function eorderAttachmentsOf(rows: readonly G2bItem[]): BidAttachment[] {
  const attachments = sortedRows(rows, ["atchSno"]).flatMap((row): BidAttachment[] => {
    const url = text(row.eorderAtchFileUrl);
    if (url === null) return [];
    const checked = checkAttachmentUrl(url);
    if (!checked.ok) return [];
    const division = text(row.eorderDocDivNm) ?? "e발주 첨부";
    const sequence = text(row.atchSno);
    const name =
      text(row.eorderAtchFileNm) ?? (sequence === null ? division : `${division} ${sequence}`);
    return [{ name, url: checked.url.href }];
  });
  return attachments.filter(
    (attachment, index) => attachments.findIndex(({ url }) => url === attachment.url) === index,
  );
}

/** 목록에서 만든 draft 에 보조 결과를 합친다. 같은 url 첨부는 목록 쪽을 남긴다. */
export function mergeG2bAux(draft: NormalizedBidDraft, rows: G2bAuxRows): NormalizedBidDraft {
  const listUrls = new Set(draft.attachments.map(({ url }) => url));
  return {
    ...draft,
    attachments: [
      ...draft.attachments,
      ...eorderAttachmentsOf(rows.eorderAttach).filter(({ url }) => !listUrls.has(url)),
    ],
    structuredQualifications: sortStructuredRequirements([
      ...draft.structuredQualifications,
      ...licenseRequirementsOf(rows.licenseLimit),
      ...regionRequirementsOf(rows.region),
    ]),
  };
}

const isEorderAttachment = ({ url }: BidAttachment): boolean =>
  URL.canParse(url) && new URL(url).pathname === G2B_EORDER_ATTACHMENT_PATH;

/** 보조 조회 3종의 registryKey(호출 순서). auxLookup.failed 는 이 순서로 적는다 */
export const AUX_REGISTRY_KEYS: readonly G2bAuxRegistryKey[] = G2B_AUX_OPERATIONS.map(
  ({ registryKey }) => registryKey,
);

/** 보조 조회 결과 → auxLookup. 실패했거나(failures) 22 뒤 부르지 않은(skipped) 키가 하나라도 있으면 FAILED 다. */
export function auxLookupOf(outcome: Pick<G2bAuxOutcome, "failures" | "skipped">): AuxLookup {
  const missing = new Set<string>([
    ...outcome.failures.map(({ registryKey }) => registryKey),
    ...outcome.skipped,
  ]);
  const failed = AUX_REGISTRY_KEYS.filter((key) => missing.has(key));
  return failed.length === 0 ? { status: "OK", failed: [] } : { status: "FAILED", failed };
}

/** 호출 예산(한도의 90%)으로 보조 조회를 부르지 않은 공고의 auxLookup. 셋 다 받지 못했다. */
export const skippedQuotaLookup = (): AuxLookup => ({
  status: "SKIPPED_QUOTA",
  failed: [...AUX_REGISTRY_KEYS],
});

export const withAuxLookup = (
  draft: NormalizedBidDraft,
  auxLookup: AuxLookup,
): NormalizedBidDraft => ({ ...draft, auxLookup });

/** 보조 조회를 시도했지만 다 받지 못한 revision 인가. 필드가 없는 revision(보조 조회 전·취소·fixture)은 아니다. */
export const isAuxIncomplete = (bid: Pick<NormalizedBid, "auxLookup">): boolean =>
  bid.auxLookup !== undefined && bid.auxLookup.status !== "OK";

/**
 * 저장된 revision 에서 보조 조회 유래(면허제한·지역 행, e발주 첨부, auxLookup)를 뺀 "목록만" 모양. checksum 도 그 모양으로 다시 센다.
 * 목록 행만 받은 새 draft 와 이것을 비교해야 같은 공고의 재수집이 DUPLICATE 로 걸러져 보조 조회를 다시 부르지 않는다.
 */
export function listOnlyRevision(previous: StoredRevision): StoredRevision {
  const listOnly: NormalizedBid = {
    ...previous.normalized,
    attachments: previous.normalized.attachments.filter(
      (attachment) => !isEorderAttachment(attachment),
    ),
    structuredQualifications: previous.normalized.structuredQualifications.filter(
      ({ sourceOperation }) => !AUX_OPERATIONS.has(sourceOperation),
    ),
  };
  // 목록만 받은 draft 에는 auxLookup 이 없다. 키를 지워야 같은 모양이 된다(복사본이라 저장된 값은 바뀌지 않는다).
  delete listOnly.auxLookup;
  // checksum 계산은 fetchedAt·checksum 키를 빼고 revision 을 덮어쓰므로, 저장된 bid 를 그대로 draft 자리에 넣어도 같은 규칙이다.
  const finalized: NormalizedBid = finalizeRevision(listOnly, previous.revision);
  return { ...previous, checksum: finalized.checksum, normalized: finalized };
}

/** 보조 조회 기간의 기준. 목록 행의 등록일시(rgstDt) → 공고일시(bidNtceDt) → 받은 시각 순으로 쓴다. */
export function registeredAtOf(item: G2bItem, fetchedAt: Date): Date {
  for (const raw of [item.rgstDt, item.bidNtceDt]) {
    if (typeof raw !== "string" || isBlank(raw)) continue;
    const parsed = parseKstDateTime(raw, fetchedAt);
    if (parsed.ok) return new Date(parsed.value);
  }
  return fetchedAt;
}
