import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  credentialsFieldProblem,
  credentialsProblem,
  loadMyProfile,
  parseDisplayName,
  requestPasswordReset,
  saveDisplayName,
  signInMessage,
  signUpMessage,
  toProfileView,
} from "@/lib/profile";

// profiles 를 읽는 사슬(from → select → eq → maybeSingle)만 흉내 낸 가짜. 받은 인자를 남긴다.
const fakeClient = (result: { data: unknown; error: unknown }) => {
  const calls: unknown[][] = [];
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return {
        select: (columns: string) => {
          calls.push(["select", columns]);
          return {
            eq: (column: string, value: string) => {
              calls.push(["eq", column, value]);
              return { maybeSingle: async () => result };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
};

test("운영자 여부를 화면의 역할 이름으로 바꾸고, 빈 이메일도 그릴 수 있게 채운다", () => {
  expect(toProfileView({ email: "a@example.com", is_admin: true, display_name: "가" })).toEqual({
    email: "a@example.com",
    displayName: "가",
    role: "운영자",
  });
  expect(toProfileView({ email: null, is_admin: false, display_name: null })).toEqual({
    email: "(이메일 없음)",
    displayName: null,
    role: "회원",
  });
});

test("입력 검사는 이메일 형식과 비밀번호 길이를 본다", () => {
  expect(credentialsProblem(" me@example.com ", "secret1")).toBeNull();
  expect(credentialsProblem("not-an-email", "secret1")).toBe("이메일 형식이 아닙니다");
  expect(credentialsProblem("me@example", "secret1")).toBe("이메일 형식이 아닙니다");
  expect(credentialsProblem("me@example.com", "12345")).toBe("비밀번호는 6자 이상입니다");
});

test("틀린 자격 증명만 친절한 문장으로, 나머지는 원인을 그대로 보인다", () => {
  expect(signInMessage({ code: "invalid_credentials", message: "Invalid login" })).toBe(
    "이메일 또는 비밀번호가 맞지 않습니다",
  );
  expect(signInMessage({ message: "Network request failed" })).toBe(
    "로그인하지 못했습니다: Network request failed",
  );
});

test("내 프로필은 로그인한 id 로 좁혀 읽는다 — 운영자에게도 한 행이다", async () => {
  const { client, calls } = fakeClient({
    data: { email: "me@example.com", is_admin: false, display_name: null },
    error: null,
  });
  await expect(loadMyProfile(client, "user-1")).resolves.toEqual({
    email: "me@example.com",
    displayName: null,
    role: "회원",
  });
  expect(calls).toEqual([
    ["from", "profiles"],
    ["select", "email, is_admin, display_name"],
    ["eq", "id", "user-1"],
  ]);
});

test("행이 없으면 null, 오류는 삼키지 않는다", async () => {
  await expect(
    loadMyProfile(fakeClient({ data: null, error: null }).client, "u"),
  ).resolves.toBeNull();
  const failure = new Error("permission denied");
  await expect(loadMyProfile(fakeClient({ data: null, error: failure }).client, "u")).rejects.toBe(
    failure,
  );
});

test("가입 오류는 이미 가입된 주소만 따로 알리고 나머지는 원문을 붙인다", () => {
  expect(signUpMessage({ code: "user_already_exists", message: "User already registered" })).toBe(
    "이미 가입된 이메일입니다",
  );
  expect(signUpMessage({ code: "weak_password", message: "Password is too weak" })).toBe(
    "가입하지 못했습니다: Password is too weak",
  );
});

test("칸별 입력 검사는 이메일 → 비밀번호 순으로 한 칸만 알린다", () => {
  expect(credentialsFieldProblem("me@example.com", "secret1")).toBeNull();
  expect(credentialsFieldProblem("nope", "123")).toEqual({
    field: "email",
    message: "이메일 형식이 아닙니다",
  });
  expect(credentialsFieldProblem("me@example.com", "123")).toEqual({
    field: "password",
    message: "비밀번호는 6자 이상입니다",
  });
});

test("표시 이름은 앞뒤 공백을 떼고 1~40자만 받는다", () => {
  expect(parseDisplayName("  가나다  ")).toEqual({ ok: true, displayName: "가나다" });
  expect(parseDisplayName("   ")).toEqual({ ok: false, message: "표시 이름을 입력하세요" });
  expect(parseDisplayName("가".repeat(40))).toEqual({ ok: true, displayName: "가".repeat(40) });
  expect(parseDisplayName(` ${"가".repeat(41)} `)).toEqual({
    ok: false,
    message: "표시 이름은 40자 이하입니다",
  });
});

// profiles 를 고치는 사슬(from → update → eq → select)만 흉내 낸 가짜.
const fakeUpdateClient = (result: { data: unknown; error: unknown }) => {
  const calls: unknown[][] = [];
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return {
        update: (values: unknown) => {
          calls.push(["update", values]);
          return {
            eq: (column: string, value: string) => {
              calls.push(["eq", column, value]);
              return {
                select: async (columns: string) => {
                  calls.push(["select", columns]);
                  return result;
                },
              };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
};

test("표시 이름 저장은 본인 id 행의 display_name 만 고친다", async () => {
  const { client, calls } = fakeUpdateClient({ data: [{ id: "user-1" }], error: null });
  await expect(saveDisplayName(client, "user-1", "  새 이름 ")).resolves.toEqual({
    ok: true,
    displayName: "새 이름",
  });
  expect(calls).toEqual([
    ["from", "profiles"],
    ["update", { display_name: "새 이름" }],
    ["eq", "id", "user-1"],
    ["select", "id"],
  ]);
});

test("표시 이름 저장은 검증에 걸리면 요청하지 않고, 실패는 던지지 않고 문구로 돌려준다", async () => {
  const unused = fakeUpdateClient({ data: [], error: null });
  await expect(saveDisplayName(unused.client, "u", "  ")).resolves.toEqual({
    ok: false,
    message: "표시 이름을 입력하세요",
  });
  expect(unused.calls).toEqual([]);

  const failed = fakeUpdateClient({ data: null, error: { message: "Network request failed" } });
  await expect(saveDisplayName(failed.client, "u", "이름")).resolves.toEqual({
    ok: false,
    message: "표시 이름을 저장하지 못했습니다: Network request failed",
  });

  // RLS 가 걸러 오류 없이 0행이 된 경우도 성공으로 보지 않는다.
  const none = fakeUpdateClient({ data: [], error: null });
  await expect(saveDisplayName(none.client, "u", "이름")).resolves.toMatchObject({ ok: false });
});

test("재설정 메일은 trim 한 이메일로 resetPasswordForEmail 만 부른다", async () => {
  const sent: string[] = [];
  const client = {
    auth: {
      resetPasswordForEmail: async (email: string) => {
        sent.push(email);
        return { data: {}, error: null };
      },
    },
  } as unknown as SupabaseClient<Database>;
  await expect(requestPasswordReset(client, " me@example.com ")).resolves.toEqual({ ok: true });
  expect(sent).toEqual(["me@example.com"]);
});

test("재설정 메일 실패는 원인을 붙인 문구로 돌려준다", async () => {
  const client = {
    auth: {
      resetPasswordForEmail: async () => ({ data: null, error: { message: "rate limit" } }),
    },
  } as unknown as SupabaseClient<Database>;
  await expect(requestPasswordReset(client, "me@example.com")).resolves.toEqual({
    ok: false,
    message: "메일을 보내지 못했습니다: rate limit",
  });
});
