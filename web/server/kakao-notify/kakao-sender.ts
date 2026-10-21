import "server-only";
import type { KakaoFeedTemplate } from "./feed.model";
import type { KakaoApi, KakaoSendResult, KakaoTokenSet } from "./kakao-api";
import type {
  KakaoLinkExpectation,
  KakaoLinkStore,
  KakaoSendRecord,
  SealedKakaoTokens,
  StoredKakaoLink,
} from "./kakao-notify.model";
import { decryptKakaoToken, encryptKakaoToken, type KakaoTokenContext } from "./kakao-token.crypto";

// ── 카카오 발송 port: mock(외부 호출 없음)·memo(나에게 보내기 실발송) (설계 §5.4·§5.5·§8, 계획 Task 3) ──
// worker 가 env NOTIFY_KAKAO_PROVIDER 로 둘 중 하나를 고른다. 한 통의 결과만 돌려주고 재시도 간격·DEAD 는 알림 소비자가 정한다.
// memo 규칙:
//   1. 연결이 없거나 EXPIRED 면 보내지 않는다({kind:"EXPIRED", changed:false}).
//   2. 액세스 토큰이 5분 안에 만료되면 먼저 갱신한다. 새 토큰은 암호화해 저장하고, 새 refresh 가 없으면 기존 것을 둔다.
//   3. 카카오가 토큰 오류(TOKEN_INVALID)를 주면 한 번 갱신하고 한 번만 다시 보낸다. 한 발송에서 갱신은 한 번뿐이다 —
//      방금 받은 토큰도 무효면 다시 해도 같으므로(동의 철회 등) 연결을 EXPIRED 로 바꾼다.
//   4. 갱신이 INVALID_GRANT(리프레시 만료·연결 끊김)거나 토큰을 풀 수 없으면(변조, KAKAO_TOKEN_DECRYPT_FAILED) EXPIRED 로 바꾼다.
//      사용자가 다시 연결해야 한다. 키 불일치(KakaoTokenKeyMismatchError — 웹과 worker 의 KAKAO_TOKEN_ENC_KEY 가 다름)와
//      키 형식 오류는 설정 문제라 만료로 바꾸지 않고 그대로 던진다. 바꾸면 연결된 전원이 만료되고 전원에게 만료 인앱이 간다.
//      던지면 알림 소비자가 그 사람만 FAILED 로 두고 이벤트를 재시도한다(5번째에 DEAD).
//   5. 갱신이 던지면(네트워크·5xx 등) 다음에 다시 할 수 있으므로 RETRYABLE REFRESH_FAILED 다.
//   6. 같은 사용자에게는 앞 발송과 1000ms 이상 띄운다(커뮤니티의 어뷰징 제한 보고, 설계 §5.4). 기다릴 자리는 sender 안에 둔다.
//   7. 끝에 설정 칸의 "마지막 발송" 줄(markResult)을 적는다.
//   8. 토큰 저장(saveTokens)과 만료(markExpired)는 읽은 액세스 암호문이 그대로일 때만 바꾼다. 0행이면 그 사이 사용자가 다시
//      연결했거나(새 암호문) 해제했거나 다른 처리자가 먼저 바꾼 것이다 — 보내지 않고 RETRYABLE LINK_CHANGED 를 돌려준다.
//      다음 회차가 다시 읽어 새 연결로 보내거나 EXPIRED·연결 없음으로 닫는다. 새로 연결한 행을 만료로 바꾸지 않는다.
// 토큰 평문은 이 함수 안에서만 쓰고 결과·오류에 싣지 않는다. 암호문은 그 사용자·토큰 종류(access·refresh)에 묶여 있다(AAD).

export type KakaoExpiredResult = { kind: "EXPIRED"; changed: boolean };
export type KakaoSenderResult = KakaoSendResult | KakaoExpiredResult;

export type KakaoSender = {
  send(userId: string, template: KakaoFeedTemplate): Promise<KakaoSenderResult>;
};

export type MockKakaoSenderDeps = { links: KakaoLinkStore; now: () => Date };

export type MemoKakaoSenderDeps = {
  api: KakaoApi;
  links: KakaoLinkStore;
  /** KAKAO_TOKEN_ENC_KEY(base64 32바이트). */
  encKey: string;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

const REFRESH_BEFORE_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 1000;
const DECRYPT_FAILED_MESSAGE = "KAKAO_TOKEN_DECRYPT_FAILED";

const NOT_CONNECTED: KakaoExpiredResult = { kind: "EXPIRED", changed: false };
const REFRESH_FAILED: KakaoSendResult = { kind: "RETRYABLE", code: "REFRESH_FAILED" };
/** 읽은 뒤 연결 행이 바뀌었다(다시 연결·해제·다른 처리자). 다음 회차가 다시 읽는다. */
const LINK_CHANGED: KakaoSendResult = { kind: "RETRYABLE", code: "LINK_CHANGED" };

const toSendRecord = (result: KakaoSenderResult): KakaoSendRecord => {
  if (result.kind === "SENT") return "SENT";
  if (result.kind === "EXPIRED") return "EXPIRED";
  return "FAILED";
};

/**
 * 마지막 발송 줄을 적고 결과를 그대로 돌려준다.
 * 그 줄은 설정 칸의 표시용이다. 적다가 실패해도 결과를 바꾸지 않는다 — 이미 간 메시지를 실패로 보이게 해 다시 보내게 하지 않는다.
 * LINK_CHANGED 는 적지 않는다. 그 사이 다시 연결한 새 행(또는 해제로 없는 행)이라, 보내지도 않은 FAILED 를 새 연결에 남기게 된다.
 */
async function finish(
  links: KakaoLinkStore,
  userId: string,
  result: KakaoSenderResult,
  now: () => Date,
): Promise<KakaoSenderResult> {
  if (result.kind === "RETRYABLE" && result.code === "LINK_CHANGED") return result;
  try {
    await links.markResult(userId, toSendRecord(result), now());
  } catch {
    // 위 주석의 까닭으로 버린다. 다음 발송이 다시 적는다.
  }
  return result;
}

/** 만료 시각을 모르면 곧 만료로 본다 — 먼저 갱신하면 다시 쓸 수 있다. */
const isExpiringSoon = (expiresAt: Date | null, now: Date): boolean =>
  expiresAt === null || expiresAt.getTime() - now.getTime() <= REFRESH_BEFORE_MS;

const accessOf = (userId: string): KakaoTokenContext => ({ userId, kind: "access" });
const refreshOf = (userId: string): KakaoTokenContext => ({ userId, kind: "refresh" });

/**
 * 변조(KAKAO_TOKEN_DECRYPT_FAILED)로 풀 수 없으면 null(다시 해도 같다). 그 밖의 오류 — 키 불일치(KakaoTokenKeyMismatchError)·
 * 키 형식 오류 — 는 설정 문제라 그대로 던진다. 모든 연결을 만료로 바꾸지 않게 한다.
 */
function openToken(sealed: string, encKey: string, context: KakaoTokenContext): string | null {
  try {
    return decryptKakaoToken(sealed, encKey, context);
  } catch (error) {
    if (error instanceof Error && error.message === DECRYPT_FAILED_MESSAGE) return null;
    throw error;
  }
}

function sealTokens(
  tokens: KakaoTokenSet,
  link: StoredKakaoLink,
  encKey: string,
): SealedKakaoTokens {
  const access = {
    accessTokenEnc: encryptKakaoToken(tokens.accessToken, encKey, accessOf(link.userId)),
    accessExpiresAt: tokens.accessExpiresAt,
  };
  if (tokens.refreshToken === null) {
    return {
      ...access,
      refreshTokenEnc: link.refreshTokenEnc,
      refreshExpiresAt: link.refreshExpiresAt,
    };
  }
  return {
    ...access,
    refreshTokenEnc: encryptKakaoToken(tokens.refreshToken, encKey, refreshOf(link.userId)),
    refreshExpiresAt: tokens.refreshExpiresAt,
  };
}

export function createMockKakaoSender(deps: MockKakaoSenderDeps): KakaoSender {
  return {
    async send(userId) {
      const link = await deps.links.read(userId);
      if (link === null) return NOT_CONNECTED;
      const result: KakaoSenderResult =
        link.status === "EXPIRED" ? NOT_CONNECTED : { kind: "SENT" };
      return finish(deps.links, userId, result, deps.now);
    },
  };
}

/** 갱신 성공이면 새 평문 액세스 토큰과, 저장한 새 암호문(그 뒤 조건부 만료의 기대값)을 돌려준다. */
type RefreshStep =
  | { ok: true; accessToken: string; saved: KakaoLinkExpectation }
  | { ok: false; result: KakaoSenderResult };

export function createMemoKakaoSender(deps: MemoKakaoSenderDeps): KakaoSender {
  // 사용자별로 다음 발송을 시작해도 되는 시각(ms). 기다리기 전에 자리를 잡아 둔다 —
  // 같은 사용자에게 동시에 여러 통을 보내도 1초씩 벌어진다. 사용자 수만큼만 자란다.
  // worker 프로세스 1개 전제(해커톤 Compose). 여럿이면 BullMQ limiter 등으로 옮긴다 —
  // 이 Map 은 프로세스 안에만 있어 프로세스끼리는 간격을 지키지 못한다.
  const nextSlotAt = new Map<string, number>();

  async function waitForSlot(userId: string): Promise<void> {
    const nowMs = deps.now().getTime();
    const slotAt = Math.max(nowMs, nextSlotAt.get(userId) ?? nowMs);
    nextSlotAt.set(userId, slotAt + MIN_INTERVAL_MS);
    if (slotAt > nowMs) await deps.sleep(slotAt - nowMs);
  }

  async function sendSpaced(
    userId: string,
    accessToken: string,
    template: KakaoFeedTemplate,
  ): Promise<KakaoSendResult> {
    await waitForSlot(userId);
    return deps.api.sendMemo(accessToken, template);
  }

  /** 읽은(또는 방금 저장한) 액세스 암호문인 행만 만료로 바꾼다. 0행이면 그 사이 행이 바뀌었으므로 LINK_CHANGED 다. */
  async function expire(
    userId: string,
    expected: KakaoLinkExpectation,
  ): Promise<KakaoSenderResult> {
    const changed = await deps.links.markExpired(userId, expected);
    return changed ? { kind: "EXPIRED", changed: true } : LINK_CHANGED;
  }

  async function callRefresh(
    refreshToken: string,
  ): Promise<KakaoTokenSet | "INVALID_GRANT" | null> {
    try {
      return await deps.api.refresh(refreshToken);
    } catch {
      // 갱신 실패의 까닭(네트워크·5xx·설정)은 결과 코드 REFRESH_FAILED 하나로 알린다. 오류 값은 싣지 않는다.
      return null;
    }
  }

  /**
   * 갱신해 새 토큰을 저장한다. 저장이 실패하면 던진다 — 아직 아무것도 보내지 않았으므로 다시 해도 된다.
   * 저장이 0행이면(읽은 뒤 다시 연결·해제) 새 토큰을 버리고 LINK_CHANGED 다. 옛 연결의 토큰으로 새 연결을 덮어쓰지 않는다.
   */
  async function refreshLink(link: StoredKakaoLink): Promise<RefreshStep> {
    const read: KakaoLinkExpectation = { accessTokenEnc: link.accessTokenEnc };
    const refreshToken =
      link.refreshTokenEnc === null
        ? null
        : openToken(link.refreshTokenEnc, deps.encKey, refreshOf(link.userId));
    if (refreshToken === null) return { ok: false, result: await expire(link.userId, read) };
    const refreshed = await callRefresh(refreshToken);
    if (refreshed === null) return { ok: false, result: REFRESH_FAILED };
    if (refreshed === "INVALID_GRANT") {
      return { ok: false, result: await expire(link.userId, read) };
    }
    const sealed = sealTokens(refreshed, link, deps.encKey);
    if (!(await deps.links.saveTokens(link.userId, sealed, read))) {
      return { ok: false, result: LINK_CHANGED };
    }
    return {
      ok: true,
      accessToken: refreshed.accessToken,
      saved: { accessTokenEnc: sealed.accessTokenEnc },
    };
  }

  /** 갱신하고 새 토큰으로 한 번 보낸다. 새 토큰도 무효면 연결을 만료로 바꾼다. */
  async function refreshAndSend(
    link: StoredKakaoLink,
    template: KakaoFeedTemplate,
  ): Promise<KakaoSenderResult> {
    const refreshed = await refreshLink(link);
    if (!refreshed.ok) return refreshed.result;
    const result = await sendSpaced(link.userId, refreshed.accessToken, template);
    // 행은 이제 방금 저장한 새 암호문이다. 그것을 기대값으로 만료로 바꾼다.
    return result.kind === "TOKEN_INVALID" ? expire(link.userId, refreshed.saved) : result;
  }

  async function deliver(
    link: StoredKakaoLink,
    template: KakaoFeedTemplate,
  ): Promise<KakaoSenderResult> {
    const accessToken =
      link.accessTokenEnc === null
        ? null
        : openToken(link.accessTokenEnc, deps.encKey, accessOf(link.userId));
    if (accessToken === null) return expire(link.userId, { accessTokenEnc: link.accessTokenEnc });
    if (isExpiringSoon(link.accessExpiresAt, deps.now())) return refreshAndSend(link, template);
    const first = await sendSpaced(link.userId, accessToken, template);
    return first.kind === "TOKEN_INVALID" ? refreshAndSend(link, template) : first;
  }

  return {
    async send(userId, template) {
      const link = await deps.links.read(userId);
      if (link === null) return NOT_CONNECTED;
      if (link.status === "EXPIRED") return finish(deps.links, userId, NOT_CONNECTED, deps.now);
      return finish(deps.links, userId, await deliver(link, template), deps.now);
    },
  };
}
