import type { AppStateStatus } from "react-native";
import type { Tables } from "@/lib/database.types";

const mockAuth = { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() };
const mockCreateClient = jest.fn<object, unknown[]>(() => ({ from: jest.fn(), auth: mockAuth }));
jest.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
  processLock: jest.fn(),
}));
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

type Load = () => {
  getSupabaseApp: typeof import("./supabase").getSupabaseApp;
  supabase: typeof import("./supabase").supabase;
  appStateListeners: ((state: AppStateStatus) => void)[];
};

// 모듈을 새로 불러온다. 같은 레지스트리의 AppState 를 엿봐야 등록된 리스너를 잡을 수 있다.
const load: Load = () => {
  const { AppState } = jest.requireActual<typeof import("react-native")>("react-native");
  const appStateListeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListeners.push(listener);
    return { remove: jest.fn() };
  });
  const { getSupabaseApp, supabase } =
    jest.requireActual<typeof import("./supabase")>("./supabase");
  return { getSupabaseApp, supabase, appStateListeners };
};

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
});

test("앱 import는 연결을 만들지 않고, 최초 접근 때 공개 키로 연결한다", () => {
  const { getSupabaseApp } = load();
  expect(mockCreateClient).not.toHaveBeenCalled();
  const client = getSupabaseApp();
  expect(getSupabaseApp()).toBe(client);
  expect(mockCreateClient).toHaveBeenCalledWith(
    "https://test.supabase.co",
    "public-test-key",
    expect.anything(),
  );
});

test("로그인 세션을 기기 저장소에 남겨 앱을 다시 켜도 유지한다", () => {
  const { getSupabaseApp } = load();
  getSupabaseApp();
  const AsyncStorage = jest.requireMock("@react-native-async-storage/async-storage");
  const [, , options] = mockCreateClient.mock.calls[0] as [
    string,
    string,
    { auth: Record<string, unknown> },
  ];
  expect(options.auth).toMatchObject({
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  });
});

test("앱이 백그라운드로 가면 토큰 자동 갱신을 멈추고, 돌아오면 다시 켠다", () => {
  const { getSupabaseApp, appStateListeners } = load();
  getSupabaseApp();
  expect(appStateListeners).toHaveLength(1);
  appStateListeners[0]("background");
  expect(mockAuth.stopAutoRefresh).toHaveBeenCalledTimes(1);
  appStateListeners[0]("active");
  expect(mockAuth.startAutoRefresh).toHaveBeenCalledTimes(1);
});

test("공개 환경변수가 없으면 빈 설정으로 연결하지 않는다", () => {
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const { getSupabaseApp } = load();
  expect(() => getSupabaseApp()).toThrow("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  expect(mockCreateClient).not.toHaveBeenCalled();
});

test("설정이 없어 첫 사용에 실패해도 리스너를 남기지 않고, 설정한 뒤에는 연결된다", () => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  const { getSupabaseApp, appStateListeners } = load();
  expect(() => getSupabaseApp()).toThrow("EXPO_PUBLIC_SUPABASE_URL");
  expect(appStateListeners).toHaveLength(0);
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  getSupabaseApp();
  expect(mockCreateClient).toHaveBeenCalledTimes(1);
  expect(appStateListeners).toHaveLength(1);
});

test("supabase 대리 객체는 메서드를 실제 클라이언트에 묶어 부르고, 여러 번 써도 연결·리스너는 하나다", () => {
  const seen: { self: unknown[]; tables: string[] } = { self: [], tables: [] };
  const client = {
    auth: mockAuth,
    from(this: unknown, table: string) {
      seen.self.push(this);
      seen.tables.push(table);
      return table;
    },
  };
  mockCreateClient.mockImplementationOnce(() => client);
  const { supabase, getSupabaseApp, appStateListeners } = load();
  expect(mockCreateClient).not.toHaveBeenCalled();
  const { from } = supabase;
  from("profiles");
  supabase.from("profiles");
  expect(supabase.auth).toBe(mockAuth);
  expect(getSupabaseApp()).toBe(client);
  expect(seen).toEqual({ self: [client, client], tables: ["profiles", "profiles"] });
  expect(mockCreateClient).toHaveBeenCalledTimes(1);
  expect(appStateListeners).toHaveLength(1);
});

// ── DB 타입 ──
// jest 에는 expectTypeOf 가 없어 tsc(pnpm type-check)가 보는 단언을 직접 둔다. 쿼리를 만드는 함수는 부르지 않는다.
// 클라이언트에 Database 타입이 빠지면(any) 아래 단언과 @ts-expect-error 가 함께 깨진다.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AppClient = (typeof import("./supabase"))["supabase"];
type DataOf<Query> = Query extends PromiseLike<{ data: infer Data }> ? Data : never;

// 결과 data 의 타입이 Expected 와 똑같지 않으면 toBe<Expected>() 가 인자를 요구해 컴파일 오류가 난다.
const expectData = <Query>(build: (client: AppClient) => Query) => ({
  toBe: <Expected>(...mismatch: Equal<DataOf<Query>, Expected> extends true ? [] : [never]) =>
    mismatch.length === 0,
});

test("앱 클라이언트에 생성된 DB 타입이 붙는다: profiles 의 행 타입, 없는 표는 타입 오류", () => {
  expect(
    expectData((client) => client.from("profiles").select("id, email, is_admin")).toBe<
      Pick<Tables<"profiles">, "id" | "email" | "is_admin">[] | null
    >(),
  ).toBe(true);
  const misuse = (client: AppClient) => {
    // @ts-expect-error: 마이그레이션에 없는 표는 from() 에 넣을 수 없다
    client.from("no_such_table");
  };
  expect(misuse).toEqual(expect.any(Function));
});
