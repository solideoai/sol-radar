import "server-only";

// ── 카카오톡 "나에게 보내기" 피드 한 통(설계 §4.2 한도·§5.3 메시지 표) ──
// 순수 규칙: 공고 요약 → 카카오 기본 템플릿(object_type feed). 저장·시계·네트워크를 모른다(now 는 인자로 받는다).
// AI 서술(score_runs.explanation, Qwen 출력)은 싣지 않는다. 사유 줄은 필수 자격 판정 요약(toReasonLine)으로만 만든다.
// 값이 없거나 이상해도 던지지 않고 미공개·미정으로 채운다 — 한 통이 깨져 발송이 멈추지 않게 한다(계획 Review Focus 4).

export type QualificationSummaryInput = {
  mandatory: boolean;
  outcome: "SATISFIED" | "NOT_SATISFIED" | "NEEDS_REVIEW" | "NOT_APPLICABLE";
}[];

export type KakaoLink = { web_url: string; mobile_web_url: string };

export type KakaoFeedTemplate = {
  object_type: "feed";
  content: { title: string; description: string; link: KakaoLink };
  item_content: { items: { item: string; item_op: string }[] };
  buttons: { title: string; link: KakaoLink }[];
};

export type BidFeedInput = {
  bidId: string;
  title: string;
  agency: string | null;
  deadlineAt: Date | null;
  budgetKrw: number | null;
  score: number | null;
  recommendation: "BID" | "WATCH";
  status: "COMPLETED" | "PARTIAL";
  reason: string;
  sourceUrl: string | null;
  siteUrl: string;
  now: Date;
};

// 카카오 피드 한도는 제목+설명 4줄, item_op 2줄 25자다. 제목은 40자 + … 로 잘라 설명과 함께 4줄 안에 둔다.
const TITLE_KEEP = 40;
const ITEM_OP_MAX = 25;
const UNDISCLOSED = "미공개";
const NO_DEADLINE = "미정";
const PARTIAL_SUFFIX = " · AI 없이 규칙만으로 분석";
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

const TEST_TITLE = "SOL RADAR 카카오톡 알림 시험";
const TEST_DESCRIPTION = "추천 공고가 나오면 이렇게 받습니다.";

// ── 사유 한 줄 ──

// 필수 항목만 본다. 확인 필요가 미충족보다 먼저다 — 사람이 열어 봐야 할 일이 먼저 보이게 한다.
export function toReasonLine(checks: QualificationSummaryInput): string {
  const mandatory = checks.filter((check) => check.mandatory);
  if (mandatory.length === 0) return "필수 자격 없음";
  const countOf = (outcome: QualificationSummaryInput[number]["outcome"]): number =>
    mandatory.filter((check) => check.outcome === outcome).length;
  const needsReview = countOf("NEEDS_REVIEW");
  if (needsReview > 0) return `확인 필요 ${needsReview}건`;
  const notSatisfied = countOf("NOT_SATISFIED");
  if (notSatisfied > 0) return `필수 자격 미충족 ${notSatisfied}건`;
  return "필수 자격 충족";
}

// ── 글자 ──

const squashSpaces = (text: string): string => text.replace(/\s+/g, " ").trim();

// 글자 수는 코드 포인트로 센다(이모지 하나를 두 글자로 세지 않는다). 넘치면 끝을 … 로 바꿔 maxChars 안에 둔다.
function fitText(text: string, maxChars: number): string {
  const chars = Array.from(text);
  return chars.length <= maxChars ? text : `${chars.slice(0, maxChars - 1).join("")}…`;
}

// ── 날짜: 서버 시간대(UTC)와 상관없이 서울로 가른다 ──

const seoulFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type SeoulDateTime = { dayNumber: number; month: string; day: string; time: string };

function toSeoulDateTime(instant: Date): SeoulDateTime {
  const parts = seoulFormat.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const dayNumber =
    Date.UTC(Number(read("year")), Number(read("month")) - 1, Number(read("day"))) / DAY_MS;
  return {
    dayNumber,
    month: read("month"),
    day: read("day"),
    time: `${read("hour")}:${read("minute")}`,
  };
}

// dayNumber 는 서울 달력 날짜를 UTC 자정으로 옮긴 일 번호라 요일과 날짜 차이를 그대로 셀 수 있다.
function formatDeadline(deadlineAt: Date | null, now: Date): string {
  if (deadlineAt === null || Number.isNaN(deadlineAt.getTime())) return NO_DEADLINE;
  const deadline = toSeoulDateTime(deadlineAt);
  const weekday = WEEKDAYS[new Date(deadline.dayNumber * DAY_MS).getUTCDay()];
  const date = `${deadline.month}-${deadline.day}(${weekday}) ${deadline.time}`;
  if (deadlineAt.getTime() < now.getTime()) return `${date} · 마감 지남`;
  const days = deadline.dayNumber - toSeoulDateTime(now).dayNumber;
  return `${date} · ${days === 0 ? "D-Day" : `D-${days}`}`;
}

// ── 금액·점수 ──

const groupedInteger = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

// 만 원 단위로 반올림해 1억(10,000만)에 닿으면 억 단위로 쓴다. 억은 0.1억(천만 원) 단위로 반올림한다.
// 소수점 계산(toFixed)의 이진 반올림 오차를 피하려고 정수로 센 뒤 자리를 나눈다.
function formatBudget(budgetKrw: number | null): string {
  if (budgetKrw === null || !Number.isFinite(budgetKrw) || budgetKrw < 0) return UNDISCLOSED;
  const man = Math.round(budgetKrw / 10_000);
  if (man < 10_000) return `${groupedInteger.format(man)}만 원`;
  const tenthsOfEok = Math.round(budgetKrw / 10_000_000);
  return `${groupedInteger.format(Math.floor(tenthsOfEok / 10))}.${tenthsOfEok % 10}억`;
}

const formatScore = (score: number | null): string =>
  score === null || !Number.isFinite(score) ? UNDISCLOSED : String(Math.round(score));

const formatAgency = (agency: string | null): string => {
  const name = agency === null ? "" : squashSpaces(agency);
  return name === "" ? UNDISCLOSED : fitText(name, ITEM_OP_MAX);
};

// ── 링크 ──

const linkTo = (url: string): KakaoLink => ({ web_url: url, mobile_web_url: url });
const withoutTrailingSlash = (siteUrl: string): string => siteUrl.replace(/\/+$/, "");
const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url);

// 원문 주소가 없거나 웹 주소가 아니면 SOL RADAR 상세의 원문 자리로 보낸다(설계 §5.3 공고 원문 버튼).
const sourceLinkOf = (sourceUrl: string | null, detailUrl: string): KakaoLink =>
  linkTo(sourceUrl !== null && isWebUrl(sourceUrl) ? sourceUrl : `${detailUrl}#source`);

// ── 피드 ──

export function toBidFeedTemplate(input: BidFeedInput): KakaoFeedTemplate {
  const detailUrl = `${withoutTrailingSlash(input.siteUrl)}/bids/${encodeURIComponent(input.bidId)}`;
  const partial = input.status === "PARTIAL" ? PARTIAL_SUFFIX : "";
  return {
    object_type: "feed",
    content: {
      title: fitText(squashSpaces(input.title), TITLE_KEEP + 1),
      description: `${input.recommendation} 권고 · ${input.reason}${partial}`,
      link: linkTo(detailUrl),
    },
    item_content: {
      items: [
        { item: "발주처", item_op: formatAgency(input.agency) },
        { item: "마감", item_op: formatDeadline(input.deadlineAt, input.now) },
        { item: "추정금액", item_op: formatBudget(input.budgetKrw) },
        { item: "점수", item_op: formatScore(input.score) },
      ],
    },
    buttons: [
      { title: "분석 보기", link: linkTo(detailUrl) },
      { title: "공고 원문", link: sourceLinkOf(input.sourceUrl, detailUrl) },
    ],
  };
}

// 설정 화면의 "시험 메시지 보내기"가 보내는 고정 피드. 공고·사용자 정보를 싣지 않는다.
export function toTestFeedTemplate(siteUrl: string): KakaoFeedTemplate {
  const settingsLink = linkTo(`${withoutTrailingSlash(siteUrl)}/settings`);
  return {
    object_type: "feed",
    content: { title: TEST_TITLE, description: TEST_DESCRIPTION, link: settingsLink },
    item_content: { items: [{ item: "상태", item_op: "연결됨" }] },
    buttons: [{ title: "설정 보기", link: settingsLink }],
  };
}
