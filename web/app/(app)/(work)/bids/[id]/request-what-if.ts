import type { WhatIfData } from "@/server/bids";
import {
  failureOf,
  isRecord,
  JSON_HEADERS,
  NETWORK_ERROR,
  NETWORK_MESSAGE,
  readJson,
  type ApiFailure,
} from "./api-envelope";

// 가정 재계산(BOOST-2, POST /api/v1/analyses/:id/what-if). 저장하지 않는 읽기 계산이라 결과는 화면 상태에만 둔다.
// 빈 가정은 진입 호출(가정 가능 목록 + 다시 계산한 원래 값)이다. signal 로 취소하면 네트워크 실패로 돌아온다
// — 늦은 응답을 버리는 판정은 부르는 쪽의 요청 번호가 한다(디자인 스펙 §4.4).

export type WhatIfResponse = WhatIfData;
export type WhatIfResult = { ok: true; data: WhatIfResponse } | ({ ok: false } & ApiFailure);

// 200 인데 본문 모양이 다르면(프록시 등) 실패로 본다. 글자는 api-envelope 의 기본 실패 문구와 같다.
const INVALID_RESPONSE = "INVALID_RESPONSE";
const INVALID_MESSAGE = "요청을 처리하지 못했습니다.";

// 화면이 쓰는 칸만 본다. 나머지 모양은 서버(what-if.service)가 정한다.
const isSummary = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.score === "number" &&
  typeof value.recommendation === "string" &&
  typeof value.qualificationStatus === "string" &&
  Array.isArray(value.factors) &&
  Array.isArray(value.checks);

const isWhatIfResponse = (body: unknown): body is WhatIfResponse =>
  isRecord(body) &&
  Array.isArray(body.assumable) &&
  body.assumable.every((code) => typeof code === "string") &&
  isSummary(body.before) &&
  isSummary(body.after);

export async function requestWhatIf(
  analysisId: string,
  codes: string[],
  signal?: AbortSignal,
): Promise<WhatIfResult> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/analyses/${encodeURIComponent(analysisId)}/what-if`, {
      method: "POST",
      cache: "no-store",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        assumptions: codes.map((code) => ({ kind: "QUALIFICATION", code })),
      }),
      signal,
    });
  } catch {
    return { ok: false, status: 0, code: NETWORK_ERROR, message: NETWORK_MESSAGE, details: {} };
  }
  const body = await readJson(response);
  if (!response.ok) return { ok: false, ...failureOf(response, body) };
  if (isWhatIfResponse(body)) return { ok: true, data: body };
  const requestId = response.headers.get("X-Request-Id") ?? undefined;
  return {
    ok: false,
    status: response.status,
    code: INVALID_RESPONSE,
    message: INVALID_MESSAGE,
    ...(requestId === undefined ? {} : { requestId }),
    details: {},
  };
}
