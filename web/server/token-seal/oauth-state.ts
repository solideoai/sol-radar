import "server-only";
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { createTokenSealer } from "./token-seal";

// ── 외부 연결 OAuth state: "이 사용자가 10분 안에 시작한 연결"인지 콜백이 확인하는 값 ──
// 연결 시작이 만들어 쿠키(와 필요하면 인가 주소)에 싣고, 콜백이 같은 사용자·같은 키로 만든 것인지 본다.
// 모양 <발급 초>.<nonce>.<mac>. 사용자 ID 는 평문으로 싣지 않고 MAC 입력에만 넣는다.
// 별도 비밀을 늘리지 않으려고 토큰 암호화 키(KAKAO_TOKEN_ENC_KEY·GOOGLE_TOKEN_ENC_KEY)에서 HKDF 로 용도별 키를 뽑는다.
// info·label 이 서비스마다 달라 카카오 state 를 구글 콜백에 내도 맞지 않는다.

const NONCE_BYTES = 16;
const MAC_BYTES = 32;
const STATE_TTL_SECONDS = 600;
/** 웹 서버가 여럿일 때의 시계 차이. 이보다 미래에 발급된 state 는 거부한다. */
const FUTURE_SKEW_SECONDS = 60;
const ISSUED_AT_PATTERN = /^\d{1,12}$/;

type StateKeyInput = { userId: string; secret: string };

export type OAuthStateSigner = {
  /** 키 형식이 틀리면 TokenSealError(KEY_FORMAT)를 던진다. */
  create(input: StateKeyInput & { now: Date }): string;
  /**
   * 같은 사용자·같은 키로 만들었고 발급 뒤 600초 안이면 true. 모양이 틀린 state 는 던지지 않고 false 다.
   * 키 형식이 틀리면 만들기와 같이 던진다(설정 오류는 거부와 구분한다).
   */
  verify(input: StateKeyInput & { state: string; now: Date }): boolean;
};

/** 정규 base64url 이고 길이가 맞을 때만 바이트를 돌려준다. 같은 값의 다른 표기(패딩·+/)는 받지 않는다. */
function decodeExact(part: string, bytes: number): Buffer | null {
  const decoded = Buffer.from(part, "base64url");
  return decoded.length === bytes && decoded.toString("base64url") === part ? decoded : null;
}

/** keyName 은 오류 문구용 env 이름, info 는 HKDF info, label 은 MAC 입력의 접두다. 셋 다 값이 아니라 이름이다. */
export function createOAuthStateSigner(options: {
  keyName: string;
  info: string;
  label: string;
}): OAuthStateSigner {
  const sealer = createTokenSealer(options.keyName);

  function stateKeyOf(secret: string): Buffer {
    sealer.assertKey(secret);
    const tokenKey = Buffer.from(secret.trim(), "base64");
    return Buffer.from(hkdfSync("sha256", tokenKey, Buffer.alloc(0), options.info, MAC_BYTES));
  }

  const macOf = (key: Buffer, userId: string, issuedAt: string, nonce: string): Buffer =>
    createHmac("sha256", key).update(`${options.label}:${userId}:${issuedAt}:${nonce}`).digest();

  return {
    create(input) {
      const key = stateKeyOf(input.secret);
      const issuedAt = String(Math.floor(input.now.getTime() / 1000));
      const nonce = randomBytes(NONCE_BYTES).toString("base64url");
      const mac = macOf(key, input.userId, issuedAt, nonce).toString("base64url");
      return `${issuedAt}.${nonce}.${mac}`;
    },

    verify(input) {
      const key = stateKeyOf(input.secret);
      const parts = input.state.split(".");
      if (parts.length !== 3) return false;
      const [issuedAt, nonce, mac] = parts as [string, string, string];
      if (!ISSUED_AT_PATTERN.test(issuedAt)) return false;
      if (decodeExact(nonce, NONCE_BYTES) === null) return false;
      const given = decodeExact(mac, MAC_BYTES);
      if (given === null) return false;
      if (!timingSafeEqual(given, macOf(key, input.userId, issuedAt, nonce))) return false;
      const ageSeconds = Math.floor(input.now.getTime() / 1000) - Number(issuedAt);
      return ageSeconds <= STATE_TTL_SECONDS && ageSeconds >= -FUTURE_SKEW_SECONDS;
    },
  };
}
