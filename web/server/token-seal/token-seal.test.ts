import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TokenSealError, createTokenSealer } from "./token-seal";

// token-seal: 카카오·구글 refresh token 봉인의 규칙. 키 형식, 사용자·종류 묶음(AAD), 변조, 키 불일치를 가른다.
const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");
const CONTEXT = { userId: "00000000-0000-0000-0000-000000000001", kind: "refresh" } as const;
const sealer = createTokenSealer("GOOGLE_TOKEN_ENC_KEY");

const codeOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof TokenSealError ? error.code : null;
  }
  return "NO_THROW";
};

describe("createTokenSealer", () => {
  it("봉인한 값을 같은 키·사용자·종류로만 푼다", () => {
    const sealed = sealer.encrypt("1//refresh-token", KEY, CONTEXT);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("refresh-token");
    expect(sealer.decrypt(sealed, KEY, CONTEXT)).toBe("1//refresh-token");
    expect(codeOf(() => sealer.decrypt(sealed, KEY, { ...CONTEXT, kind: "access" }))).toBe(
      "DECRYPT_FAILED",
    );
    expect(
      codeOf(() =>
        sealer.decrypt(sealed, KEY, { ...CONTEXT, userId: "00000000-0000-0000-0000-000000000002" }),
      ),
    ).toBe("DECRYPT_FAILED");
  });

  it("다른 키로 풀면 변조가 아니라 키 불일치다", () => {
    const sealed = sealer.encrypt("token", KEY, CONTEXT);
    expect(codeOf(() => sealer.decrypt(sealed, OTHER_KEY, CONTEXT))).toBe("KEY_MISMATCH");
  });

  it("암호문의 글자 하나만 바꿔도 풀리지 않는다", () => {
    const sealed = sealer.encrypt("token", KEY, CONTEXT);
    const parts = sealed.split(".");
    const tail = parts[4] ?? "";
    const flipped = `${tail.slice(0, -1)}${tail.endsWith("A") ? "B" : "A"}`;
    parts[4] = flipped;
    expect(codeOf(() => sealer.decrypt(parts.join("."), KEY, CONTEXT))).toBe("DECRYPT_FAILED");
    expect(codeOf(() => sealer.decrypt("v1.only.two", KEY, CONTEXT))).toBe("DECRYPT_FAILED");
  });

  it("키는 정규 base64 32바이트만 받고 오류 문구에 값을 싣지 않는다", () => {
    expect(codeOf(() => sealer.assertKey(KEY))).toBe("NO_THROW");
    expect(codeOf(() => sealer.assertKey("short"))).toBe("KEY_FORMAT");
    expect(codeOf(() => sealer.assertKey(Buffer.alloc(32).toString("base64")))).toBe("KEY_FORMAT");
    try {
      sealer.assertKey("not-a-key");
    } catch (error) {
      expect(error).toBeInstanceOf(TokenSealError);
      expect((error as Error).message).toBe("GOOGLE_TOKEN_ENC_KEY KEY_FORMAT");
      expect((error as Error).message).not.toContain("not-a-key");
    }
  });
});
