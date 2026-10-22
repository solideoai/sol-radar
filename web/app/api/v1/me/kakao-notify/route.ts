import { apiError, handleApiRequest, json, noContent, requireUser } from "@/app/api/v1/_lib/http";
import {
  disconnectMyKakaoNotify,
  getMyKakaoNotify,
  setMyKakaoNotifyEnabled,
} from "@/server/kakao-notify";

// 개인 설정 "카카오톡 알림"(계획 Task 6). 본인 것만 읽고 바꾼다 — 누구인지는 로그인에서 읽는다.
// 상태를 바꾸는 PATCH·DELETE 는 requireUser 가 X-Requested-With: sol-radar 를 요구한다(쿠키 로그인 CSRF).

/** GET /me/kakao-notify — 화면 상태(DISCONNECTED·OFF·ON·EXPIRED)와 마지막 발송. 토큰은 싣지 않는다. */
export async function GET(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireUser(request);
    if (!guarded.ok) return guarded.response;
    return json(await getMyKakaoNotify(guarded.user.id));
  });
}

/** PATCH /me/kakao-notify { enabled } — 켬·끔. 연결 전이면 409 KAKAO_NOT_CONNECTED. */
export async function PATCH(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireUser(request);
    if (!guarded.ok) return guarded.response;
    const body: unknown = await request.json().catch(() => null);
    const saved = await setMyKakaoNotifyEnabled(body);
    if (saved === "INVALID") {
      return apiError(400, "VALIDATION_ERROR", "켬·끔 값을 확인하세요.", {
        issues: [{ path: "enabled", message: "true 또는 false 여야 합니다." }],
      });
    }
    if (saved === "NOT_CONNECTED") {
      return apiError(409, "KAKAO_NOT_CONNECTED", "카카오 계정을 먼저 연결해야 켤 수 있습니다.");
    }
    return noContent();
  });
}

/** DELETE /me/kakao-notify — 연결 해제(저장한 토큰을 지운다). 연결이 없어도 204 다. */
export async function DELETE(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireUser(request);
    if (!guarded.ok) return guarded.response;
    await disconnectMyKakaoNotify();
    return noContent();
  });
}
