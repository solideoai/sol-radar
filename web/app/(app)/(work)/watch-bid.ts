import { CSRF_HEADERS, isRecord, readJson } from "@/app/(app)/(work)/bids/[id]/api-envelope";

// ★ 토글 요청(N3 디자인 §3.3). 켜기 PUT·끄기 DELETE /api/v1/bids/:id/watch, 본문 없음, 쓰기 머리글(CSRF_HEADERS).
// 브라우저 번들이라 서버 모듈을 부르지 않는다. 실패는 원인과 상관없이 한 갈래다 — 토글은 되돌리고 토스트 한 줄만 낸다(D12).

export type WatchOutcome = { ok: true; watched: boolean; watcherCount: number } | { ok: false };

const FAILED: WatchOutcome = { ok: false };

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

// 200 이어도 본문 모양이 다르면(프록시 오류 화면·다른 공고의 응답) 확정할 값이 없으니 실패로 본다.
function outcomeOf(bidId: string, body: unknown): WatchOutcome {
  if (!isRecord(body) || body.bidId !== bidId) return FAILED;
  const { watched, watcherCount } = body;
  if (typeof watched !== "boolean" || !isCount(watcherCount)) return FAILED;
  return { ok: true, watched, watcherCount };
}

/** 던지지 않는다. 네트워크 오류·4xx·5xx·JSON 아님·모양 틀림은 모두 { ok: false } 다. */
export async function requestWatch(
  bidId: string,
  watched: boolean,
  fetcher: typeof fetch = fetch,
): Promise<WatchOutcome> {
  try {
    const response = await fetcher(`/api/v1/bids/${encodeURIComponent(bidId)}/watch`, {
      method: watched ? "PUT" : "DELETE",
      headers: CSRF_HEADERS,
      cache: "no-store",
    });
    if (response.status !== 200) return FAILED;
    return outcomeOf(bidId, await readJson(response));
  } catch {
    return FAILED;
  }
}
