import { getMyLoginMethods } from "@/server/auth";
import { json, requireUser, unauthenticated } from "@/app/api/_lib/http";

// 로그인한 사람과 연결된 로그인 수단. 역할·상태는 토큰이 아니라 DB 에서 읽은 값이다.
export async function GET() {
  const guarded = await requireUser();
  if (!guarded.ok) return guarded.response;
  const login = await getMyLoginMethods();
  // 문지기를 지난 뒤 사이에 정지·탈퇴됐다.
  if (login.status !== "ready") return unauthenticated();
  return json({
    id: guarded.user.id,
    email: guarded.user.email,
    role: guarded.user.role,
    status: "active",
    identities: login.methods.map((method) => ({
      id: method.identityId,
      provider: method.provider,
      email: method.email,
      linkedAt: method.linkedAt,
      lastSignInAt: method.lastSignInAt,
    })),
    canUnlink: login.canUnlink,
  });
}
