import { handleApiRequest, json, noContent, requireUser } from "@/app/api/v1/_lib/http";
import { disconnectMyGoogleCalendar, getMyGoogleCalendar } from "@/server/google-calendar";

// 개인 설정·캘린더 툴바의 "구글 캘린더" 연결 상태(ADR-073). 본인 것만 읽고 지운다 — 누구인지는 로그인에서 읽는다.
// 상태를 바꾸는 DELETE 는 requireUser 가 X-Requested-With: sol-radar 를 요구한다(쿠키 로그인 CSRF).

/** GET /me/google-calendar — 화면 상태(DISCONNECTED·CONNECTED·EXPIRED)·구글 이메일·마지막 반영. 토큰은 싣지 않는다. */
export async function GET(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireUser(request);
    if (!guarded.ok) return guarded.response;
    return json(await getMyGoogleCalendar(guarded.user.id));
  });
}

/** DELETE /me/google-calendar — 연결 해제(저장한 토큰·매핑을 지운다). 구글 쪽 권한 철회는 부르지 않는다. 연결이 없어도 204 다. */
export async function DELETE(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireUser(request);
    if (!guarded.ok) return guarded.response;
    await disconnectMyGoogleCalendar(guarded.user.id);
    // 감사 대신의 서버 로그(ADR-073). 토큰·구글 이메일은 싣지 않는다.
    console.info(
      JSON.stringify({
        level: "info",
        source: "server",
        event: "google_calendar.disconnect",
        action: "disconnect",
        result: "DISCONNECTED",
        userId: guarded.user.id,
        time: new Date().toISOString(),
      }),
    );
    return noContent();
  });
}
