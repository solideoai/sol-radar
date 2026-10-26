import "server-only";
import {
  MANUAL_INGEST_COOLDOWN_MS,
  MANUAL_INGEST_DAILY_LIMIT,
  MANUAL_INGEST_SHARED_MS,
  manualIngestDayKey,
  type ManualIngestEntry,
  type ManualIngestGate,
} from "./manual-ingest-gate.model";

// 시험·fixture 용 메모리 gate. Redis 구현(Lua)과 같은 규칙이고, 만료는 TTL 대신 넘겨받은 at 으로 판정한다.
// claim 은 await 없이 한 번에 검사·설정하므로 같은 프로세스 안의 동시 요청 중 하나만 CLAIMED 다.

type Stored = { entry: ManualIngestEntry; expiresAt: number };

export type MemoryManualIngestGate = ManualIngestGate & {
  /** 시험이 보는 날짜별 접수 수 */
  dailyCount(dayKey: string): number;
};

export function createMemoryManualIngestGate(): MemoryManualIngestGate {
  const users = new Map<string, Stored>();
  let shared: Stored | null = null;
  const daily = new Map<string, number>();

  const alive = (stored: Stored | null | undefined, at: Date): ManualIngestEntry | null =>
    stored !== null && stored !== undefined && stored.expiresAt > at.getTime()
      ? stored.entry
      : null;

  return {
    async claim({ userId, runId, at }) {
      const user = alive(users.get(userId), at);
      if (user !== null) return { status: "USER_COOLDOWN", entry: user };
      const current = alive(shared, at);
      if (current !== null) return { status: "SHARED_RUN", entry: current };
      const dayKey = manualIngestDayKey(at);
      const used = daily.get(dayKey) ?? 0;
      if (used >= MANUAL_INGEST_DAILY_LIMIT) return { status: "DAILY_LIMIT", used };
      const entry = { runId, requestedAt: at.toISOString(), userId };
      users.set(userId, { entry, expiresAt: at.getTime() + MANUAL_INGEST_COOLDOWN_MS });
      shared = { entry, expiresAt: at.getTime() + MANUAL_INGEST_SHARED_MS };
      daily.set(dayKey, used + 1);
      return { status: "CLAIMED", ticket: { userId, dayKey, entry } };
    },

    async release({ userId, dayKey, entry }) {
      const user = users.get(userId);
      const ownsUser = user?.entry.runId === entry.runId;
      const ownsShared = shared?.entry.runId === entry.runId;
      if (ownsUser) users.delete(userId);
      if (ownsShared) shared = null;
      if (ownsUser || ownsShared) daily.set(dayKey, Math.max(0, (daily.get(dayKey) ?? 0) - 1));
    },

    async read({ userId, at }) {
      return {
        user: alive(users.get(userId), at),
        shared: alive(shared, at),
        dailyUsed: daily.get(manualIngestDayKey(at)) ?? 0,
      };
    },

    dailyCount: (dayKey) => daily.get(dayKey) ?? 0,
  };
}
