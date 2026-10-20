import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { callableSource, loadSourceRegistry, sourceRegistrySchema } from "./source-registry";

// 수집 소스 registry(C3 계약 6-3, 15 §8, 07 §2.2). 시험용 registry 는 임시 폴더에 쓴다.
// 마지막 묶음은 실제 infra/sources/registry.yaml 을 읽는다.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REGISTRY_PATH = join(REPO_ROOT, "infra", "sources", "registry.yaml");

type Entry = Record<string, unknown>;

const bidNoticeEntry = (overrides: Entry = {}): Entry => ({
  key: "g2b-bid-notice",
  displayName: "나라장터 입찰공고정보서비스",
  provider: "조달청 / data.go.kr",
  serviceId: "15129394",
  serviceKeyEnv: "G2B_BID_NOTICE_SERVICE_KEY",
  approvalStatus: "APPROVED",
  endpoint: {
    baseUrl: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService",
    operations: ["getBidPblancListInfoServc"],
  },
  method: "GET",
  quota: { daily: 1000, tps: 30 },
  fieldMapping: { bidNtceNo: "noticeId", bidNtceNm: "title" },
  changeNoticeUrl: null,
  redistributionLimit: "API 데이터: 이용허락범위 제한 없음",
  sampleResponses: ["fixtures/recorded/15129394/getBidPblancListInfoServc.20261019.masked.json"],
  lastVerifiedAt: "2026-10-19",
  ...overrides,
});

const FIXTURE_ENTRY: Entry = {
  key: "fixture",
  displayName: "fixture 20건",
  provider: "SOL RADAR",
  serviceId: null,
  serviceKeyEnv: null,
  approvalStatus: "APPROVED",
  endpoint: null,
  method: "GET",
  quota: null,
  fieldMapping: {},
  changeNoticeUrl: null,
  redistributionLimit: "가상 데이터",
  sampleResponses: [],
  lastVerifiedAt: "2026-10-19",
};

const registryDoc = (sources: Entry[]) => ({ schemaVersion: "sol-sources/v0.1", sources });
const registryOf = (entry: Entry) => sourceRegistrySchema.parse(registryDoc([entry]));

let workDir = "";
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "sol-registry-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const writeRegistry = (doc: unknown): string => {
  const path = join(workDir, "registry.yaml");
  writeFileSync(path, stringify(doc), "utf8");
  return path;
};
const rejectionMessage = async (path: string): Promise<string> => {
  try {
    await loadSourceRegistry(path);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("거부를 기대했는데 읽혔다");
};

describe("loadSourceRegistry", () => {
  it("정상 registry 의 소스 키를 순서대로 읽는다", async () => {
    const registry = await loadSourceRegistry(
      writeRegistry(registryDoc([bidNoticeEntry(), FIXTURE_ENTRY])),
    );

    expect(registry.sources.map((source) => source.key)).toEqual(["g2b-bid-notice", "fixture"]);
  });

  it("endpoint 와 fieldMapping 을 그대로 읽는다", async () => {
    const registry = await loadSourceRegistry(writeRegistry(registryDoc([bidNoticeEntry()])));

    expect([registry.sources[0]?.endpoint, registry.sources[0]?.fieldMapping]).toEqual([
      {
        baseUrl: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService",
        operations: ["getBidPblancListInfoServc"],
      },
      { bidNtceNo: "noticeId", bidNtceNm: "title" },
    ]);
  });

  it.each([
    [
      "schemaVersion 이 다름",
      { ...registryDoc([bidNoticeEntry()]), schemaVersion: "sol-sources/v9" },
    ],
    ["sources 가 배열이 아님", { schemaVersion: "sol-sources/v0.1", sources: "g2b-bid-notice" }],
    ["approvalStatus 가 세 값 밖", registryDoc([bidNoticeEntry({ approvalStatus: "MAYBE" })])],
    ["key 없음", registryDoc([{ ...bidNoticeEntry(), key: undefined }])],
    [
      "endpoint 에 baseUrl 없음",
      registryDoc([bidNoticeEntry({ endpoint: { operations: ["x"] } })]),
    ],
    [
      "fieldMapping 값이 문자열 아님",
      registryDoc([bidNoticeEntry({ fieldMapping: { bidNtceNo: 1 } })]),
    ],
    ["serviceKeyEnv 가 문자열·null 아님", registryDoc([bidNoticeEntry({ serviceKeyEnv: 42 })])],
    ["sampleResponses 가 배열 아님", registryDoc([bidNoticeEntry({ sampleResponses: "a.json" })])],
  ])("스키마를 어기면(%s) reject 한다", async (_label, doc) => {
    await expect(loadSourceRegistry(writeRegistry(doc))).rejects.toThrow();
  });

  it("YAML 문법이 깨지면 reject 한다", async () => {
    const path = join(workDir, "broken.yaml");
    writeFileSync(path, "schemaVersion: sol-sources/v0.1\nsources: [unclosed\n", "utf8");

    await expect(loadSourceRegistry(path)).rejects.toThrow();
  });

  it("파일이 없으면 reject 한다", async () => {
    await expect(loadSourceRegistry(join(workDir, "missing.yaml"))).rejects.toThrow();
  });

  it("거부 메시지에 잘못된 값을 넣지 않는다", async () => {
    const path = writeRegistry(
      registryDoc([bidNoticeEntry({ approvalStatus: "LEAKED-VALUE-7788" })]),
    );

    expect(await rejectionMessage(path)).not.toContain("LEAKED-VALUE-7788");
  });
});

// 계약 7-4: serviceKeyEnv 는 ^G2B_[A-Z0-9_]+_SERVICE_KEY$ 또는 null. 다른 비밀(service role 키 등)의 env 이름을 받지 않는다
describe("loadSourceRegistry — serviceKeyEnv 이름 제한(7-4)", () => {
  it.each([
    ["service role 키", "SUPABASE_SERVICE_ROLE_KEY"],
    ["_SERVICE_KEY 로 끝나지 않음", "G2B_FOO"],
    ["소문자", "g2b_bid_notice_service_key"],
    ["G2B_ 로 시작하지 않음", "OTHER_BID_NOTICE_SERVICE_KEY"],
  ])("serviceKeyEnv 가 %s(%s)면 reject 한다", async (_label, env) => {
    const path = writeRegistry(registryDoc([bidNoticeEntry({ serviceKeyEnv: env })]));

    await expect(loadSourceRegistry(path)).rejects.toThrow();
  });

  it.each([
    "G2B_BID_NOTICE_SERVICE_KEY",
    "G2B_PRE_SPEC_SERVICE_KEY",
    "G2B_INDUSTRY_MASTER_SERVICE_KEY",
  ])("serviceKeyEnv %s 는 읽는다", async (env) => {
    const path = writeRegistry(registryDoc([bidNoticeEntry({ serviceKeyEnv: env })]));

    expect((await loadSourceRegistry(path)).sources[0]?.serviceKeyEnv).toBe(env);
  });

  it("serviceKeyEnv 가 null 이면 읽는다", async () => {
    const path = writeRegistry(registryDoc([FIXTURE_ENTRY]));

    expect((await loadSourceRegistry(path)).sources[0]?.serviceKeyEnv).toBeNull();
  });

  it("거부 메시지에 받은 env 이름을 넣지 않는다", async () => {
    const path = writeRegistry(
      registryDoc([bidNoticeEntry({ serviceKeyEnv: "SUPABASE_SERVICE_ROLE_KEY" })]),
    );

    expect(await rejectionMessage(path)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});

// 계약 8-3: endpoint.baseUrl 은 https URL 만(서비스키가 쿼리로 나가므로 평문 http 금지). endpoint 가 null 인 소스는 그대로 둔다
describe("loadSourceRegistry — endpoint.baseUrl 은 https 만(8-3)", () => {
  const HTTP_BASE_URL = "http://apis.data.go.kr/1230000/ad/BidPublicInfoService";
  const withBaseUrl = (baseUrl: string) =>
    registryDoc([
      bidNoticeEntry({ endpoint: { baseUrl, operations: ["getBidPblancListInfoServc"] } }),
    ]);

  it.each([
    ["http", HTTP_BASE_URL],
    ["ftp", "ftp://apis.data.go.kr/1230000/ad/BidPublicInfoService"],
    ["URL 이 아님", "apis.data.go.kr/1230000/ad/BidPublicInfoService"],
  ])("baseUrl 이 %s 면 reject 한다", async (_label, baseUrl) => {
    await expect(loadSourceRegistry(writeRegistry(withBaseUrl(baseUrl)))).rejects.toThrow();
  });

  it("http baseUrl 거부 메시지에 그 URL 을 넣지 않는다", async () => {
    const message = await rejectionMessage(writeRegistry(withBaseUrl(HTTP_BASE_URL)));

    expect(message).not.toContain("apis.data.go.kr");
  });

  it("https baseUrl 은 읽는다", async () => {
    const baseUrl = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
    const registry = await loadSourceRegistry(writeRegistry(withBaseUrl(baseUrl)));

    expect(registry.sources[0]?.endpoint?.baseUrl).toBe(baseUrl);
  });

  it("endpoint 가 null 인 fixture 소스는 읽는다", async () => {
    const registry = await loadSourceRegistry(writeRegistry(registryDoc([FIXTURE_ENTRY])));

    expect(registry.sources[0]?.endpoint).toBeNull();
  });
});

describe("callableSource", () => {
  it("승인·endpoint·fieldMapping·serviceKeyEnv 가 모두 있으면 부를 수 있는 소스를 돌려준다", () => {
    expect(callableSource(registryOf(bidNoticeEntry()), "g2b-bid-notice")).toEqual({
      ok: true,
      source: {
        key: "g2b-bid-notice",
        baseUrl: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService",
        serviceKeyEnv: "G2B_BID_NOTICE_SERVICE_KEY",
        operations: ["getBidPblancListInfoServc"],
      },
    });
  });

  it("registry 에 없는 키는 NOT_REGISTERED 다", () => {
    expect(callableSource(registryOf(bidNoticeEntry()), "g2b-unknown")).toEqual({
      ok: false,
      reason: "NOT_REGISTERED",
    });
  });

  it.each(["NOT_REQUESTED", "PENDING"])("approvalStatus 가 %s 면 NOT_APPROVED 다", (status) => {
    expect(
      callableSource(registryOf(bidNoticeEntry({ approvalStatus: status })), "g2b-bid-notice"),
    ).toEqual({ ok: false, reason: "NOT_APPROVED" });
  });

  it("endpoint 가 null 이면 NO_ENDPOINT 다", () => {
    expect(
      callableSource(registryOf(bidNoticeEntry({ endpoint: null })), "g2b-bid-notice"),
    ).toEqual({ ok: false, reason: "NO_ENDPOINT" });
  });

  it("fieldMapping 이 비어 있으면 NO_FIELD_MAPPING 이다(15 §8: 비어 있으면 부르지 않는다)", () => {
    expect(
      callableSource(registryOf(bidNoticeEntry({ fieldMapping: {} })), "g2b-bid-notice"),
    ).toEqual({ ok: false, reason: "NO_FIELD_MAPPING" });
  });

  it("serviceKeyEnv 가 null 이면 NO_SERVICE_KEY_ENV 다", () => {
    expect(
      callableSource(registryOf(bidNoticeEntry({ serviceKeyEnv: null })), "g2b-bid-notice"),
    ).toEqual({ ok: false, reason: "NO_SERVICE_KEY_ENV" });
  });
});

// 실제 registry(15 §8 의 9개 키, 07 §2.2 의 서비스키 env 4개, 2f 실측으로 g2b 4서비스 APPROVED)
describe("infra/sources/registry.yaml", () => {
  const ALL_KEYS = [
    "fixture",
    "g2b-attachment",
    "g2b-bid-eorder-attach",
    "g2b-bid-license-limit",
    "g2b-bid-notice",
    "g2b-bid-region",
    "g2b-industry-master",
    "g2b-order-plan",
    "g2b-pre-spec",
  ];
  // data.go.kr 4서비스(15129394·15129437·15129462·15129467)를 쓰는 키와 env(07 §2.2 표)
  const SERVICE_KEY_ENV_BY_KEY: Record<string, string | null> = {
    "g2b-bid-notice": "G2B_BID_NOTICE_SERVICE_KEY",
    "g2b-bid-license-limit": "G2B_BID_NOTICE_SERVICE_KEY",
    "g2b-bid-region": "G2B_BID_NOTICE_SERVICE_KEY",
    "g2b-bid-eorder-attach": "G2B_BID_NOTICE_SERVICE_KEY",
    "g2b-pre-spec": "G2B_PRE_SPEC_SERVICE_KEY",
    "g2b-order-plan": "G2B_ORDER_PLAN_SERVICE_KEY",
    "g2b-industry-master": "G2B_INDUSTRY_MASTER_SERVICE_KEY",
    "g2b-attachment": null,
    fixture: null,
  };
  const DATA_GO_KR_KEYS = Object.entries(SERVICE_KEY_ENV_BY_KEY)
    .filter(([, env]) => env !== null)
    .map(([key]) => key);

  const realRegistry = () => loadSourceRegistry(REGISTRY_PATH);
  const entriesOf = async (keys: readonly string[]) =>
    (await realRegistry()).sources.filter((source) => keys.includes(source.key));

  it("15 §8 의 9개 키를 담는다", async () => {
    expect((await realRegistry()).sources.map((source) => source.key).sort()).toEqual(ALL_KEYS);
  });

  it("data.go.kr 4서비스의 7개 키는 모두 APPROVED 다", async () => {
    expect((await entriesOf(DATA_GO_KR_KEYS)).map((source) => source.approvalStatus)).toEqual(
      DATA_GO_KR_KEYS.map(() => "APPROVED"),
    );
  });

  it("data.go.kr 4서비스 endpoint 는 https://apis.data.go.kr/ 이다", async () => {
    for (const source of await entriesOf(DATA_GO_KR_KEYS)) {
      expect(source.endpoint?.baseUrl.startsWith("https://apis.data.go.kr/")).toBe(true);
    }
  });

  it("data.go.kr 4서비스의 lastVerifiedAt 은 2026-10-19 다", async () => {
    expect([
      ...new Set((await entriesOf(DATA_GO_KR_KEYS)).map((source) => source.lastVerifiedAt)),
    ]).toEqual(["2026-10-19"]);
  });

  it("serviceKeyEnv 는 07 §2.2 표대로다(g2b-attachment·fixture 는 비움)", async () => {
    const registry = await realRegistry();

    expect(
      Object.fromEntries(registry.sources.map((source) => [source.key, source.serviceKeyEnv])),
    ).toEqual(SERVICE_KEY_ENV_BY_KEY);
  });

  // 입찰공고정보서비스의 목록 + 보조 조회 3종(07 §2.2)만 구현했다. 사전규격·발주계획·업종 마스터는 아직이다.
  const IMPLEMENTED_KEYS = [
    "g2b-bid-eorder-attach",
    "g2b-bid-license-limit",
    "g2b-bid-notice",
    "g2b-bid-region",
  ];

  it("fieldMapping 은 입찰공고정보서비스 4개 키(목록 + 보조 조회 3종)만 비어 있지 않다", async () => {
    const registry = await realRegistry();

    expect(
      registry.sources
        .filter((source) => Object.keys(source.fieldMapping).length > 0)
        .map((source) => source.key)
        .sort(),
    ).toEqual(IMPLEMENTED_KEYS);
  });

  it("callableSource 로 부를 수 있는 소스는 입찰공고정보서비스 4개 키다", async () => {
    const registry = await realRegistry();

    expect(ALL_KEYS.filter((key) => callableSource(registry, key).ok)).toEqual(IMPLEMENTED_KEYS);
  });

  it.each([
    ["g2b-bid-license-limit", "getBidPblancListInfoLicenseLimit"],
    ["g2b-bid-region", "getBidPblancListInfoPrtcptPsblRgn"],
    ["g2b-bid-eorder-attach", "getBidPblancListInfoEorderAtchFileInfo"],
  ])(
    "보조 조회 %s 는 목록과 같은 기본 URL·서비스키 env 이고 operations 에 %s 가 있다",
    async (key, operation) => {
      const registry = await realRegistry();
      const list = callableSource(registry, "g2b-bid-notice");
      const aux = callableSource(registry, key);

      expect(list.ok && aux.ok).toBe(true);
      if (!list.ok || !aux.ok) return;
      expect([aux.source.baseUrl, aux.source.serviceKeyEnv, aux.source.operations]).toEqual([
        list.source.baseUrl,
        list.source.serviceKeyEnv,
        [operation],
      ]);
    },
  );

  it.each(["g2b-pre-spec", "g2b-order-plan"])("%s 는 NO_FIELD_MAPPING 이다", async (key) => {
    expect(callableSource(await realRegistry(), key)).toEqual({
      ok: false,
      reason: "NO_FIELD_MAPPING",
    });
  });

  it("g2b-bid-notice 의 operations 에 목록 오퍼레이션이 있다", async () => {
    const [bidNotice] = await entriesOf(["g2b-bid-notice"]);

    expect(bidNotice?.endpoint?.operations).toContain("getBidPblancListInfoServc");
  });

  it("sampleResponses 는 모두 fixtures/recorded/ 아래 실제로 있는 파일이다", async () => {
    const paths = (await realRegistry()).sources.flatMap((source) => source.sampleResponses);

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith("fixtures/recorded/")).toBe(true);
      expect(existsSync(join(REPO_ROOT, path))).toBe(true);
    }
  });

  it("fixture 는 APPROVED 이고 endpoint 가 null 이다", async () => {
    const [fixture] = await entriesOf(["fixture"]);

    expect([fixture?.approvalStatus, fixture?.endpoint]).toEqual(["APPROVED", null]);
  });

  it("g2b-attachment 는 APPROVED 다", async () => {
    const [attachment] = await entriesOf(["g2b-attachment"]);

    expect(attachment?.approvalStatus).toBe("APPROVED");
  });

  it("모든 endpoint.baseUrl 은 https 다(8-3)", async () => {
    const baseUrls = (await realRegistry()).sources.flatMap((source) =>
      source.endpoint ? [source.endpoint.baseUrl] : [],
    );

    expect(baseUrls.length).toBeGreaterThan(0);
    expect(baseUrls.filter((baseUrl) => new URL(baseUrl).protocol !== "https:")).toEqual([]);
  });

  it("registry 파일에 서비스키 값이 없다(env 이름만 둔다)", () => {
    expect(readFileSync(REGISTRY_PATH, "utf8")).not.toMatch(/servicekey\s*=/i);
  });
});
