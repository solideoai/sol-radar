import { apiError, handleApiRequest, json, requireUser } from "@/app/api/v1/_lib/http";
import { requestMyKakaoNotifyTest } from "@/server/kakao-notify";

/**
 * POST /me/kakao-notify/test — 시험 메시지 한 통을 worker 에 맡긴다(202). 보내기는 worker 가 한다.
 * 같은 분에 다시 누르거나 24시간 10건을 넘으면 429 KAKAO_TEST_THROTTLED, 연결·켬이 아니면 409 KAKAO_NOT_READY.
 */
export async function POST(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireUser(request);
    if (!guarded.ok) return guarded.response;
    const requested = await requestMyKakaoNotifyTest();
    if (requested === "NOT_READY") {
      return apiError(409, "KAKAO_NOT_READY", "카카오톡 알림을 연결하고 켠 뒤 보낼 수 있습니다.");
    }
    if (requested === "THROTTLED") {
      return apiError(
        429,
        "KAKAO_TEST_THROTTLED",
        "시험 메시지를 방금 보냈습니다. 잠시 뒤 다시 시도하세요.",
        { retryAfterSeconds: 60 },
        { "Retry-After": "60" },
      );
    }
    return json({ queued: true }, 202);
  });
}
