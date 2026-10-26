import "server-only";
import { KST_OFFSET_MINUTES } from "./normalize-date";

// ── 정기 수집 일정(10-26 운영 전환). 매일 한국시간 00·03·06·09·12·15·18·21시 정각에 g2b 수집을 한다 ──
// worker 는 PATTERN·TIMEZONE 으로 BullMQ Job Scheduler 를 건다(기동 시각 기준 반복이 아니다).
// 화면·서버는 같은 규칙을 아래 순수 함수로 계산한다. 한국은 일광절약시간이 없어 UTC+9 고정으로 계산해도 cron 과 같다.

/** cron 형식(분 시 일 월 요일). TIMEZONE 기준 3시간마다 정각 */
export const INGEST_SCHEDULE_PATTERN = "0 */3 * * *";
export const INGEST_SCHEDULE_TIMEZONE = "Asia/Seoul";
/** 정기 수집 사이 간격(분). 창 상한·지연 판정이 쓴다 */
export const INGEST_SCHEDULE_INTERVAL_MINUTES = 180;
/** 정기 수집이 도는 한국시간 시(hour) */
export const INGEST_SCHEDULE_SLOT_HOURS_KST = [0, 3, 6, 9, 12, 15, 18, 21] as const;

const KST_OFFSET_MS = KST_OFFSET_MINUTES * 60_000;
const SLOT_MS = INGEST_SCHEDULE_INTERVAL_MINUTES * 60_000;

// 한국시간 자정은 SLOT_MS 의 배수 경계다(24시간 = 8칸). 한국시간으로 옮겨 칸을 세고 다시 UTC 로 돌린다.
const slotIndexOf = (at: Date): number => Math.floor((at.getTime() + KST_OFFSET_MS) / SLOT_MS);
const slotStartOf = (index: number): Date => new Date(index * SLOT_MS - KST_OFFSET_MS);

/** at 보다 뒤인 첫 정기 수집 시각. at 이 정각이면 그다음 정각이다 */
export const nextIngestSlotAfter = (at: Date): Date => slotStartOf(slotIndexOf(at) + 1);

/** at 과 같거나 앞선 마지막 정기 수집 시각 */
export const latestIngestSlotAtOrBefore = (at: Date): Date => slotStartOf(slotIndexOf(at));
