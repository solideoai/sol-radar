import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// ── 관심 공고 마감 알림(N3, 설계 D7·§2.5, docs/13-NOTIFICATIONS.md DEADLINE_APPROACHING) ──
// outbox 를 거치지 않는다(12 판단 2026-10-21, 13 의 예외). DB 함수 send_deadline_reminders(p_now) 하나가
// 대상 공고(D-3·D-1, 09:00 KST 이후 그날), 수신자(조직마다 최신 결정의 담당자 ∪ 관심 등록자, 활동 구성원만, 사용자 id 중복 제거),
// 멱등 키(<bidId>:<userId>:DEADLINE_APPROACHING:D-<n>)를 정하고 notifications 에 IN_APP 행을 바로 넣는다.
// 여기는 한 회차(시각 넘기기·넣은 수 로그)만 둔다. 주기 실행(타이머)은 worker 의 몫이다.

/** 저장 port. worker 가 service role 클라이언트로 만든 구현을 넘긴다. */
export type DeadlineReminderStore = {
  /** now 기준으로 보낼 마감 알림을 넣고 넣은 행 수를 돌려준다. 같은 날 다시 불러도 키로 막혀 0 이다. */
  sendDue(now: Date): Promise<number>;
};

/** 저장 오류. message 에는 함수 이름과 코드만 싣는다(PostgREST message 에 값이 섞일 수 있다). */
export class DeadlineReminderStoreError extends Error {
  constructor(code: string) {
    super(`deadline reminder store 오류: send_deadline_reminders ${code}`);
    this.name = "DeadlineReminderStoreError";
  }
}

export function createDeadlineReminderStore(
  admin: SupabaseClient<Database>,
): DeadlineReminderStore {
  return {
    async sendDue(now) {
      const { data, error } = await admin.rpc("send_deadline_reminders", {
        p_now: now.toISOString(),
      });
      if (error) throw new DeadlineReminderStoreError(error.code);
      return data;
    },
  };
}

export type DeadlineReminderDeps = {
  store: DeadlineReminderStore;
  now: () => Date;
  /** JSON 한 줄. */
  log: (line: string) => void;
};

/** 한 회차. 넣은 수를 돌려주고, 넣은 것이 있을 때만 로그 한 줄을 남긴다(5분마다 0 줄이 쌓이지 않게). */
export async function runDeadlineReminders(deps: DeadlineReminderDeps): Promise<number> {
  const inserted = await deps.store.sendDue(deps.now());
  if (inserted > 0) deps.log(JSON.stringify({ event: "notify.deadline.sent", inserted }));
  return inserted;
}
