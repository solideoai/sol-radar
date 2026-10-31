import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { decryptKakaoToken, encryptKakaoToken } from "@/server/kakao-notify";
import { TokenSealError } from "@/server/token-seal";
import { googleTokenSealer } from "./google-calendar.config";

// 구글 봉인은 AAD 에 "google:" 를 붙인다. GOOGLE_TOKEN_ENC_KEY 를 카카오 키와 같은 값으로 넣어도 두 암호문이 서로 풀리지 않는다.
const SAME_KEY = randomBytes(32).toString("base64");
const CONTEXT = { userId: "00000000-0000-0000-0000-000000000001", kind: "refresh" } as const;

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof TokenSealError ? error.code : (error as Error).message;
  }
  return "NO_THROW";
};

it("같은 키여도 카카오 암호문을 구글 봉인이 풀지 못하고, 구글 암호문도 카카오가 풀지 못한다", () => {
  const kakao = encryptKakaoToken("kakao-refresh", SAME_KEY, CONTEXT);
  expect(codeOf(() => googleTokenSealer.decrypt(kakao, SAME_KEY, CONTEXT))).toBe("DECRYPT_FAILED");

  const google = googleTokenSealer.encrypt("1//google-refresh", SAME_KEY, CONTEXT);
  expect(googleTokenSealer.decrypt(google, SAME_KEY, CONTEXT)).toBe("1//google-refresh");
  expect(codeOf(() => decryptKakaoToken(google, SAME_KEY, CONTEXT))).toBe(
    "KAKAO_TOKEN_DECRYPT_FAILED",
  );
});
