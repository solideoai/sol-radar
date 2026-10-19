import "server-only";
import type { AnalysisContext, QueryIssue, RawQuery } from "@/server/bids";
import { apiError, handleApiRequest, requireBusinessUser } from "./http";

// 업무 Route Handler(공고·분석·결정·알림)의 공통 입구.
// 순서: 예상 밖 예외 → 500 봉투(handleApiRequest) → 로그인·CSRF·가입 완료·업무 조직(requireBusinessUser) → 본 처리.
export function businessRoute(
  request: Request,
  work: (ctx: AnalysisContext) => Promise<Response>,
): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireBusinessUser(request);
    return guarded.ok ? work(guarded.ctx) : guarded.response;
  });
}

type PathResource = "bid" | "analysis" | "notification";
const NOT_FOUND_MESSAGES: Record<PathResource, string> = {
  bid: "공고를 찾을 수 없습니다",
  analysis: "분석을 찾을 수 없습니다",
  notification: "알림을 찾을 수 없습니다",
};

// 경로 id 가 UUID 가 아닐 때의 응답. 없는 자원과 같은 404 이고 DB 는 부르지 않는다(Review Focus 2).
export const pathNotFound = (resource: PathResource): Response =>
  apiError(404, "NOT_FOUND", NOT_FOUND_MESSAGES[resource], { resource });

export const invalidQuery = (issues: QueryIssue[]): Response =>
  apiError(400, "VALIDATION_ERROR", "쿼리가 올바르지 않습니다", { issues });

// 쿼리 문자열 → 파서 입력. 한 번 온 값은 문자열, 반복된 값은 배열이다(파서가 반복을 가린다).
export function rawQueryOf(request: Request): RawQuery {
  const params = new URL(request.url).searchParams;
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      return [key, values.length === 1 ? values[0] : values];
    }),
  );
}

// 요청 본문. 비었으면 {} 다. JSON 이 아니면 글자 그대로 넘겨 서비스의 본문 검증이 400 으로 거절하게 한다
// (여기서 먼저 거절하면 서비스가 정한 권한 → 속도 제한 → 본문 순서가 깨진다).
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
