import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProgramNoticesConfig } from "./config";
import { redactProgramUrl } from "./http";
import { buildMsitUrl, decodeServiceKey, parseMsitBody } from "./msit";
import { loadProgramRecordings, PROGRAM_RECORDED_SCHEMA_VERSION } from "./recording";
import { dedupeKeyOf } from "./text";

// 과기정통부 사업공고(공공데이터포털 15074634). 샘플은 2026-11-01 첫 녹음과 같은 봉투의 가상 4건이다.

const root = path.resolve(process.cwd(), "..");
const FETCHED_AT = "2026-11-02T01:00:00.000Z";
const MSIT_URL = "https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList";
const SAMPLE_PATH = path.join(process.cwd(), "server/program-notices/test-data/msit-sample.json");
const RECORDING_PATH = path.join(
  root,
  "fixtures/recorded/program-notices/msit/api.20261101.masked.json",
);

type Item = Record<string, unknown>;
const envelope = (items: unknown, resultCode = "00"): string =>
  JSON.stringify({
    response: [{ header: { resultCode, resultMsg: "x" } }, { body: { totalCount: 1, items } }],
  });
const item = (overrides: Item = {}): Item => ({
  deptName: "가상과",
  pressDt: "2026-10-28",
  subject: "2026년도 가상사업 신규과제 공모",
  viewUrl: "https://www.msit.go.kr/bbs/view.do?sCode=user&bbsSeqNo=100&nttSeqNo=1",
  ...overrides,
});
const parseOk = (body: string) => {
  const parsed = parseMsitBody(body, FETCHED_AT);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.errorCode}`);
  return parsed;
};

describe("과기정통부 응답 정규화", () => {
  it("normalizes MSIT items, excludes result notices and keeps selection plans", async () => {
    const parsed = parseOk(await readFile(SAMPLE_PATH, "utf8"));
    expect(parsed.excluded).toBe(1);
    expect(parsed.dropped).toBe(0);
    expect(parsed.notices).toHaveLength(3);
    const first = parsed.notices.find((n) => n.sourceNoticeId === "3186001");
    expect(first).toMatchObject({
      source: "msit",
      title: "2026년도 미래개척융합과학기술개발사업(한계돌파 R&D) 신규과제 공모",
      agency: "과학기술정보통신부 원천기술과",
      sourceUrl: "https://www.msit.go.kr/bbs/view.do?sCode=user&bbsSeqNo=100&nttSeqNo=3186001",
      publishedAt: "2026-10-27T15:00:00.000Z",
      applyStartOn: null,
      applyEndOn: null,
      summary: null,
      applyMethod: null,
      target: null,
      tags: [],
      isDemo: false,
      fetchedAt: FETCHED_AT,
    });
    expect(first?.dedupeKey).toBe(dedupeKeyOf(first?.title ?? "", "과학기술정보통신부"));
    expect(parsed.notices.some((n) => n.title.includes("선정계획"))).toBe(true);
    expect(parsed.notices.find((n) => n.sourceNoticeId === "3186002")?.title).toBe(
      "2026년도 가상 공동연구사업 신규과제 공모",
    );
  });

  it("reads a single item object and an item array", () => {
    expect(parseOk(envelope({ item: item() })).notices).toHaveLength(1);
    expect(parseOk(envelope({ item: [item(), item()] })).notices).toHaveLength(2);
    const nested = JSON.stringify({
      response: { header: { resultCode: "00" }, body: { items: { item: item() } } },
    });
    expect(parseOk(nested).notices).toHaveLength(1);
  });

  it("normalizes viewUrl and drops foreign hosts or missing nttSeqNo", () => {
    const parsed = parseOk(
      envelope([
        { item: item({ viewUrl: "/bbs/view.do?sCode=user&bbsSeqNo=100&nttSeqNo=7" }) },
        { item: item({ viewUrl: "https://evil.example/bbs/view.do?nttSeqNo=8" }) },
        { item: item({ viewUrl: "https://www.msit.go.kr/bbs/view.do?sCode=user&bbsSeqNo=100" }) },
        { item: item({ deptName: "" }) },
      ]),
    );
    expect(parsed.notices.map((n) => n.sourceUrl)).toEqual([
      "https://www.msit.go.kr/bbs/view.do?sCode=user&bbsSeqNo=100&nttSeqNo=7",
      "https://www.msit.go.kr/bbs/view.do?sCode=user&bbsSeqNo=100&nttSeqNo=1",
    ]);
    expect(parsed.notices[1]?.agency).toBe("과학기술정보통신부");
    expect(parsed.dropped).toBe(2);
    expect(parsed.excluded).toBe(0);
  });

  it("rejects a gateway XML error and a non-00 resultCode", () => {
    const xml =
      "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>";
    expect(parseMsitBody(xml, FETCHED_AT)).toEqual({ ok: false, errorCode: "RESPONSE_SHAPE" });
    expect(parseMsitBody(envelope([{ item: item() }], "30"), FETCHED_AT)).toEqual({
      ok: false,
      errorCode: "RESPONSE_SHAPE",
    });
    expect(parseMsitBody(JSON.stringify({ response: [] }), FETCHED_AT)).toEqual({
      ok: false,
      errorCode: "RESPONSE_SHAPE",
    });
  });

  it("keeps a row whose pressDt is unreadable", () => {
    const parsed = parseOk(
      envelope([{ item: item({ pressDt: "미정" }) }, { item: item({ pressDt: "2026.10.28" }) }]),
    );
    expect(parsed.notices.map((n) => n.publishedAt)).toEqual([null, "2026-10-27T15:00:00.000Z"]);
  });

  it("parses the first live recording", async () => {
    const recording = JSON.parse(await readFile(RECORDING_PATH, "utf8")) as { body: string };
    const parsed = parseOk(recording.body);
    expect(parsed.dropped).toBe(0);
    expect(parsed.excluded).toBe(5);
    expect(parsed.notices).toHaveLength(5);
    for (const notice of parsed.notices) {
      expect(notice.source).toBe("msit");
      expect(notice.sourceUrl.startsWith("https://www.msit.go.kr/")).toBe(true);
    }
  });
});

describe("과기정통부 요청·설정", () => {
  it("decodeServiceKey and buildMsitUrl send the key once-encoded", () => {
    expect(decodeServiceKey("a%2Bb%3D")).toBe("a+b=");
    expect(decodeServiceKey("a+b=")).toBe("a+b=");
    expect(decodeServiceKey("%E0%A4%A")).toBeNull();
    expect(decodeServiceKey("  ")).toBeNull();
    expect(decodeServiceKey(undefined)).toBeNull();
    const url = buildMsitUrl({ baseUrl: MSIT_URL, key: "a+b=", maxItems: 50 });
    expect(url).toContain("ServiceKey=a%2Bb%3D&");
    expect(new URL(url).searchParams.get("numOfRows")).toBe("50");
    expect(new URL(url).searchParams.get("returnType")).toBe("json");
    expect(redactProgramUrl(url, [])).not.toContain("a%2Bb%3D");
  });

  it("loads msit from the committed YAML and rejects another host", async () => {
    const committed = await loadProgramNoticesConfig(
      path.join(root, "infra/sources/program-notices.yaml"),
    );
    if (!committed.ok) throw new Error(committed.reason);
    expect(committed.config.msit).toMatchObject({
      ok: true,
      value: { enabled: true, keyEnv: "MSIT_ANNOUNCEMENT_API_KEY", maxItems: 10 },
    });

    const dir = await mkdtemp(path.join(tmpdir(), "msit-config-"));
    const file = path.join(dir, "program-notices.yaml");
    const text = await readFile(path.join(root, "infra/sources/program-notices.yaml"), "utf8");
    await writeFile(file, text.replace(`baseUrl: ${MSIT_URL}`, "baseUrl: https://evil.example/x"));
    const tampered = await loadProgramNoticesConfig(file);
    if (!tampered.ok) throw new Error(tampered.reason);
    expect(tampered.config.msit.ok).toBe(false);
    expect(tampered.config.bizinfo.ok).toBe(true);
  });

  it("skips a recording that carries a ServiceKey param", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "msit-recordings-"));
    await mkdir(path.join(dir, "msit"));
    const recording = {
      schemaVersion: PROGRAM_RECORDED_SCHEMA_VERSION,
      source: "msit",
      params: { ServiceKey: "x" },
      fetchedAt: FETCHED_AT,
      httpStatus: 200,
      contentType: "application/json",
      body: "{}",
      rawSha256: "0".repeat(64),
      masked: true,
      maskedFields: [],
      note: "시험",
    };
    await writeFile(path.join(dir, "msit", "api.json"), JSON.stringify(recording));
    expect(await loadProgramRecordings(dir, "msit")).toEqual({ recordings: [], skipped: 1 });
  });
});
