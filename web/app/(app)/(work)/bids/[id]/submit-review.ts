import type { ReviewInputValues, SubmitResult } from "@/components/bids/decision-panel";
import {
  failureOf,
  isRecord,
  JSON_HEADERS,
  NETWORK_ERROR,
  NETWORK_MESSAGE,
  readJson,
  type ApiFailure,
} from "./api-envelope";

// 사람 최종 결정 기록(스펙 §5.4.9 결정 기록 흐름, 05 §2 POST /bids/:id/reviews). 결과를 DecisionPanel 이 그리는 모양으로 옮긴다.
// 칸 오류(field)는 사유 검증 실패와 조직 밖 담당자 둘만 칸 아래에 둔다. 나머지는 폼 위에 코드·요청 ID 와 함께 보인다.

type SubmitField = Extract<SubmitResult, { ok: false }>["field"];

function fieldOf(failure: ApiFailure): SubmitField {
  if (failure.code === "VALIDATION_ERROR") {
    const issues = failure.details.issues;
    const first = Array.isArray(issues) ? issues[0] : undefined;
    return isRecord(first) && first.path === "reason" ? "reason" : undefined;
  }
  if (failure.status === 404 && failure.details.resource === "assignee") return "assigneeUserId";
  return undefined;
}

export async function submitReview(bidId: string, input: ReviewInputValues): Promise<SubmitResult> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/bids/${encodeURIComponent(bidId)}/reviews`, {
      method: "POST",
      cache: "no-store",
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, status: 0, code: NETWORK_ERROR, message: NETWORK_MESSAGE };
  }
  if (response.ok) return { ok: true };
  const failure = failureOf(response, await readJson(response));
  const field = fieldOf(failure);
  return {
    ok: false,
    status: failure.status,
    code: failure.code,
    message: failure.message,
    ...(failure.requestId === undefined ? {} : { requestId: failure.requestId }),
    ...(field === undefined ? {} : { field }),
  };
}

// 결정 기록 뒤 상단바(벨 수)를 지금 한 번, 5초 뒤 한 번 더 읽는다(스펙 D5). 알림은 worker outbox 를 거쳐 늦게 생긴다.
// 돌려준 함수를 부르면 두 번째 읽기를 취소한다(화면을 떠날 때).
export const TOPBAR_RECHECK_MS = 5_000;

export function recheckTopbarAfterReview(recheck: () => Promise<void>): () => void {
  void recheck();
  const timer = setTimeout(() => void recheck(), TOPBAR_RECHECK_MS);
  return () => clearTimeout(timer);
}
