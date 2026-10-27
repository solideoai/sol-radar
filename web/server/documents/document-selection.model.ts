import "server-only";

// ── 첨부 처리 범위(2026-10-27 실공고 분석 완성): 어떤 첨부를 내려받아 파싱하고, 분석에 어떤 순서로 넣는가 ──
// 공고마다 첨부가 평균 3.6건(운영 553건·1,975행)이고 가격 내역서·서약서 같은 양식이 섞여 있다. 분석(/extract)은
// 본문 대신 첨부 텍스트를 읽는데 Qwen 입력 예산(gateway QWEN_CONTEXT_BUDGET_TOKENS 12,000자 근사)이 작아,
// 앞에 넣은 문서가 사실상 전부다. 그래서 공고서·제안요청서·과업지시서를 먼저 받고 먼저 넣는다.
// 네트워크·DB 를 부르지 않는 순수 규칙이다. documents worker(내려받기)와 첨부 텍스트 reader(분석 입력)가 같이 쓴다.

/**
 * 파서 형식(이름의 확장자). 내려받기 전에는 내용을 볼 수 없어 이름으로 거른다. 받은 뒤 형식은 매직 바이트로 다시 판정한다.
 * 같은 규칙이 SQL document_processing_candidates(20261027000500)에 있다. 바꾸면 둘을 함께 바꾼다.
 * xlsx·zip·docx 등 파서 범위 밖 형식(03 §10.2)은 내려받지 않고 PENDING 으로 둔다(받지 않았다는 뜻 그대로다).
 */
const PARSER_EXTENSION = /\.(pdf|hwp|hwpx)$/i;

export const hasParserExtension = (name: string): boolean => PARSER_EXTENSION.test(name.trim());

// 분석 근거가 되는 본문 문서(나라장터 첨부 이름의 관례). 공고서·공고문은 "(공고서) …"·"공고서_…" 처럼 붙는다.
const PRIMARY = /(제안요청서|과업지시서|과업내용서|공고서|공고문|입찰공고|rfp)/i;
// 참가 서류 양식. 자격 조건이 아니라 빈칸이라 맨 뒤로 보낸다.
const FORM = /(서식|양식|서약서|확약서|위임장|신청서|각서|별지|동의서|증명서|확인서)/;
// 과업 범위를 담는 보조 문서
const SECONDARY = /(규격서|사양서|요구사항|과업|사업계획|설명서)/;

/** 0 이 먼저다. 본문 문서 0, 보조 문서 1, 그 밖 2, 양식 3 */
export type DocumentPriority = 0 | 1 | 2 | 3;

export function documentPriorityOf(name: string): DocumentPriority {
  if (PRIMARY.test(name)) return 0;
  if (FORM.test(name)) return 3;
  if (SECONDARY.test(name)) return 1;
  return 2;
}

/** 문자열 사전순(코드 단위). locale 에 기대지 않아 같은 행이면 늘 같은 순서다. */
const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

type Named = { id: string; name: string };

/** 파서 형식 첨부를 우선순위 → 이름 → id 순으로 정렬한다. 파서 형식이 아닌 첨부는 뺀다. */
export function rankDocuments<T extends Named>(documents: readonly T[]): T[] {
  return documents
    .filter((document) => hasParserExtension(document.name))
    .toSorted(
      (left, right) =>
        documentPriorityOf(left.name) - documentPriorityOf(right.name) ||
        compareText(left.name, right.name) ||
        compareText(left.id, right.id),
    );
}

/**
 * 공고(최신 revision)마다 처리할 첨부. 상태와 무관하게 정렬 상위 maxPerBid 건이라 다시 돌려도 같은 문서를 고른다.
 * 이미 끝난(OK·FAILED) 문서도 몫을 차지한다. SQL 처리 대상 함수가 "끝난 파서 형식 첨부 수 < 상한"으로 같은 뜻을 본다.
 */
export function selectDocuments<T extends Named>(documents: readonly T[], maxPerBid: number): T[] {
  return rankDocuments(documents).slice(0, Math.max(0, maxPerBid));
}

/** 접수 중인 공고 상태. 정정공고(AMENDED)도 입찰을 받는다 */
const OPEN_STATUSES: ReadonlySet<string> = new Set(["OPEN", "AMENDED"]);

export type ScopeNotice = {
  isDemo: boolean;
  status: string;
  deadlineAt: string | null;
  latestRevision: number;
};

export type ScopeSkipReason = "MODE_MISMATCH" | "NOT_LATEST" | "NOT_OPEN" | "DEADLINE_PASSED";

/**
 * 처리 범위 밖이면 사유, 안이면 null. live 는 실제 공고(is_demo=false)만 다룬다(07 실행 모드 범위).
 * 최신 revision 만 받는다(분석은 최신 revision 만 본다). 마감이 지난 공고는 받지 않는다(마감 없음은 받는다).
 */
export function scopeSkipReasonOf(
  notice: ScopeNotice,
  revision: number,
  expectDemo: boolean,
  now: Date,
): ScopeSkipReason | null {
  if (notice.isDemo !== expectDemo) return "MODE_MISMATCH";
  if (notice.latestRevision !== revision) return "NOT_LATEST";
  if (!OPEN_STATUSES.has(notice.status)) return "NOT_OPEN";
  if (notice.deadlineAt !== null && Date.parse(notice.deadlineAt) <= now.getTime())
    return "DEADLINE_PASSED";
  return null;
}
