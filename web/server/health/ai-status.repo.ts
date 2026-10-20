import "server-only";
import { type GatewayHealthBody, gatewayHealthSchema } from "./ai-status.model";
import { PROBE_TIMEOUT_MS } from "./health.model";

/**
 * gateway GET /health 를 한 번만 부른다(재시도 없음). 200 이 아니거나, JSON·스키마가 맞지 않거나,
 * 연결이 실패하거나, 시간을 넘기면 던지지 않고 null 이다. 오류·URL 은 남기지 않는다.
 * 시간 상한은 service 가 건다. 여기의 제한은 멈춘 요청을 정리하기 위한 것이다(health.repo 와 같다).
 */
export async function fetchGatewayHealth(healthUrl: string): Promise<GatewayHealthBody | null> {
  try {
    const response = await fetch(healthUrl, {
      cache: "no-store",
      // gateway 는 리다이렉트하지 않는다. 따라가면 다른 서버의 상태를 gateway 의 것으로 보인다.
      redirect: "error",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.status !== 200) return null;
    const parsed = gatewayHealthSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
