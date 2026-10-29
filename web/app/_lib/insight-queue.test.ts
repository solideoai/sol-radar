import { describe, expect, it, vi } from "vitest";
import { createInsightQueue } from "./insight-queue";

const INSIGHT = "d1000000-0000-4000-8000-000000000001";
const ORG = "0f000000-0000-4000-8000-000000000001";

describe("createInsightQueue", () => {
  it("행 id 로 만든 jobId 와 한 번만 시도하는 옵션으로 넣고, 계약과 다른 데이터는 넣지 않는다", async () => {
    const addJob = vi.fn(async () => undefined);
    const enqueue = createInsightQueue({ redisUrl: undefined, addJob });
    await enqueue({ insightId: INSIGHT, orgId: ORG });
    expect(addJob).toHaveBeenCalledWith(
      "explain",
      { insightId: INSIGHT, orgId: ORG },
      { attempts: 1, removeOnComplete: true, removeOnFail: 100, jobId: `insight-${INSIGHT}` },
    );
    await expect(enqueue({ insightId: "not-a-uuid", orgId: ORG })).rejects.toThrow();
    expect(addJob).toHaveBeenCalledTimes(1);
  });
});
