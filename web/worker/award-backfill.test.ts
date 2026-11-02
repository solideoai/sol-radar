import { describe, expect, it } from "vitest";
import {
  backfillWindowsOf,
  createAwardBackfillFetcher,
  type AwardHistoryInsert,
  type AwardHistoryRepo,
} from "@/server/award-history";
import { formatG2bDateTime } from "@/server/ingestion";
import { checkReport, loadEnvFiles, parseBackfillArgs, runBackfill } from "./award-backfill";

describe("parseBackfillArgs", () => {
  it("pnpm 의 -- 를 건너뛰고 env 파일 여러 개·모드·기본값을 읽는다", () => {
    expect(parseBackfillArgs(["--", "--env-file", "a", "--env-file", "b", "--dry-run"])).toEqual({
      envFiles: ["a", "b"],
      mode: "dry-run",
      months: 12,
      maxCalls: 400,
    });
    expect(
      parseBackfillArgs(["--env-file", "a", "--apply", "--months", "6", "--max-calls", "1000"]),
    ).toEqual({ envFiles: ["a"], mode: "apply", months: 6, maxCalls: 1000 });
  });

  it.each([
    { argv: ["--dry-run"], message: "--env-file 이 필요하다" },
    { argv: ["--env-file", "a"], message: "가운데 하나가 필요하다" },
    { argv: ["--env-file", "a", "--check", "--apply"], message: "하나만 준다" },
    { argv: ["--env-file", "a", "--dry-run", "--months", "5"], message: "6개월보다 짧으면" },
    { argv: ["--env-file", "a", "--dry-run", "--months", "13"], message: "--months 는 6~12" },
    {
      argv: ["--env-file", "a", "--dry-run", "--max-calls", "1001"],
      message: "--max-calls 는 1~1000",
    },
    { argv: ["--env-file", "--dry-run"], message: "값이 없다" },
  ])("틀린 인자는 거부한다($message)", ({ argv, message }) => {
    expect(() => parseBackfillArgs(argv)).toThrow(message);
  });

  it("모르는 인자의 값은 오류에 싣지 않는다", () => {
    let message = "";
    try {
      parseBackfillArgs(["--env-file", "a", "--key", "SECRET-VALUE"]);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("모르는 인자");
    expect(message).not.toContain("SECRET-VALUE");
  });
});

describe("env", () => {
  it("env 파일은 뒤가 앞을 덮고, --check 는 이름별 있음과 DB 호스트만 낸다", async () => {
    const files = new Map([
      ["db", "NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co\nG2B_AWARD_SERVICE_KEY=old\n"],
      ["api", "G2B_AWARD_SERVICE_KEY=AWARD-SECRET\nG2B_BID_NOTICE_SERVICE_KEY=NOTICE-SECRET\n"],
    ]);
    const env = await loadEnvFiles(["db", "api"], async (path) => files.get(path) ?? "");
    expect(env.G2B_AWARD_SERVICE_KEY).toBe("AWARD-SECRET");
    const report = checkReport(env);
    expect(report).toEqual({
      mode: "check",
      keys: {
        G2B_AWARD_SERVICE_KEY: true,
        G2B_BID_NOTICE_SERVICE_KEY: true,
        NEXT_PUBLIC_SUPABASE_URL: true,
        SUPABASE_SERVICE_ROLE_KEY: false,
      },
      dbHost: "abc.supabase.co",
      ok: false,
    });
    expect(JSON.stringify(report)).not.toMatch(/SECRET/);
  });

  it("못 읽은 파일은 몇 번째인지만 알린다", async () => {
    await expect(
      loadEnvFiles(["ok", "/secret/path"], async (path) => {
        if (path !== "ok") throw new Error(`ENOENT ${path}`);
        return "";
      }),
    ).rejects.toThrow(/^award-backfill: env 파일을 읽지 못했다\(2번째 --env-file\)$/);
  });
});

// ── 가짜 조달청: 낙찰은 첫 30일 조각에만 2건(협상 1건은 첫날 공고와 이어지고, 1건은 공고가 없다) ──

const NOW = new Date("2026-11-02T00:00:00.000Z");
const MONTHS = 6;
const WINDOWS = backfillWindowsOf(NOW, MONTHS);
const AWARD_KEY = "AWARD-KEY-SECRET";
const NOTICE_KEY = "NOTICE-KEY-SECRET";
const FIRST_AWARD_DAY = formatG2bDateTime(WINDOWS.award[0]?.from ?? NOW);
const FIRST_NOTICE_DAY = formatG2bDateTime(WINDOWS.notice[0]?.from ?? NOW);
const LAST_NOTICE_DAY = formatG2bDateTime(WINDOWS.notice.at(-1)?.from ?? NOW);

const AWARD_ITEMS = [
  {
    bidNtceNo: "R26BK00000001",
    bidNtceOrd: "000",
    bidNtceNm: "가상 정보시스템 구축",
    prtcptCnum: "3",
    sucsfbidAmt: "870000000",
    sucsfbidRate: "",
    rlOpengDt: "2026-05-20 14:00:00",
    dminsttNm: "가상기관",
    bidwinnrNm: "가상업체",
  },
  {
    bidNtceNo: "R26BK09999999",
    bidNtceOrd: "000",
    sucsfbidAmt: "100000000",
    rlOpengDt: "2026-05-21 10:00:00",
  },
];
const NOTICE_ITEMS = [
  {
    bidNtceNo: "R26BK00000001",
    bidNtceOrd: "000",
    pubPrcrmntClsfcNo: "81111598",
    pubPrcrmntClsfcNm: "정보시스템개발서비스",
    pubPrcrmntMidClsfcNm: "소프트웨어개발서비스",
    sucsfbidMthdNm: "협상에의한계약-협상에 의한 낙찰자 결정",
    asignBdgtAmt: "1000000000",
    presmptPrce: "909090909",
    VAT: "90909091",
  },
  { bidNtceNo: "R26BK05555555", bidNtceOrd: "000", sucsfbidMthdNm: "수의시담" },
];

const json = (items: unknown, totalCount: number): Response =>
  new Response(
    JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "정상" },
        body: { items, totalCount, numOfRows: 999, pageNo: 1 },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

type Call = { operation: string; params: URLSearchParams };

function fakeG2b(options: { lastDayTotal?: number } = {}) {
  const calls: Call[] = [];
  const fetch = async (url: string): Promise<Response> => {
    const parsed = new URL(url);
    const operation = parsed.pathname.split("/").at(-1) ?? "";
    calls.push({ operation, params: parsed.searchParams });
    const from = parsed.searchParams.get("inqryBgnDt");
    if (operation === "getScsbidListSttusServc") {
      if (from !== FIRST_AWARD_DAY) return json([], 0);
      return parsed.searchParams.get("numOfRows") === "1"
        ? json(AWARD_ITEMS.slice(0, 1), AWARD_ITEMS.length)
        : json(AWARD_ITEMS, AWARD_ITEMS.length);
    }
    if (from === FIRST_NOTICE_DAY) return json(NOTICE_ITEMS, NOTICE_ITEMS.length);
    if (from === LAST_NOTICE_DAY && options.lastDayTotal !== undefined)
      return json([], options.lastDayTotal);
    return json([], 0);
  };
  return { calls, fetch };
}

async function run(mode: "dry-run" | "apply", maxCalls: number, g2b = fakeG2b(), months = MONTHS) {
  const lines: string[] = [];
  const upserts: { rows: readonly AwardHistoryInsert[]; fetchedAt: string }[] = [];
  const repo: AwardHistoryRepo = {
    async upsert(rows, fetchedAt) {
      upserts.push({ rows, fetchedAt });
      return rows.length;
    },
  };
  const fetcher = createAwardBackfillFetcher({
    fetch: g2b.fetch,
    awardServiceKey: AWARD_KEY,
    noticeServiceKey: NOTICE_KEY,
    maxCalls,
    retry: { sleep: async () => undefined, random: () => 0 },
  });
  const result = await runBackfill(
    {
      fetcher,
      repo: mode === "apply" ? repo : null,
      now: () => NOW,
      log: (line) => lines.push(line),
    },
    { mode, months, maxCalls },
  );
  // 마지막 줄은 돌려받은 보고와 같은 한 줄 JSON 이다.
  expect(lines.at(-1)).toBe(JSON.stringify(result.report));
  return { ...result, lines, upserts, calls: g2b.calls };
}

describe("runBackfill", () => {
  const expectedCalls = WINDOWS.award.length + 1 + WINDOWS.notice.length;

  it("dry-run: 세기 → 낙찰 → 공고 순으로 받아 잇고, 한 줄 JSON 에 묶음·건너뛴 이유·분류를 낸다", async () => {
    const { exitCode, report, lines, calls, upserts } = await run("dry-run", 1000);
    expect(exitCode).toBe(0);
    expect(lines[0]).toContain(`예상 호출 ${expectedCalls}/1000`);
    expect(report).toMatchObject({
      mode: "dry-run",
      months: MONTHS,
      calls: { max: 1000, estimated: expectedCalls, used: expectedCalls },
      stopped: null,
      fetched: { awardTotal: 2, awards: 2, notices: 1 },
      save: 1,
      groups: { NEGOTIATION: 1, LOWER_LIMIT: 0 },
      skipped: { NO_NOTICE: 1 },
      topClasses: [{ classNo: "81111598", className: "정보시스템개발서비스", count: 1 }],
      written: null,
    });
    expect(report.periods.notice?.from).toBe("2026-03-02T00:00:00.000Z");
    expect(upserts).toEqual([]);
    // 낙찰은 등록일시 기준(inqryDiv=1)·999행, 서비스마다 제 키를 쓴다. 출력에는 키가 없다.
    const award = calls.find((call) => call.params.get("numOfRows") === "999");
    expect(award?.operation).toBe("getScsbidListSttusServc");
    expect(award?.params.get("inqryDiv")).toBe("1");
    expect(award?.params.get("serviceKey")).toBe(AWARD_KEY);
    const notice = calls.find((call) => call.operation === "getBidPblancListInfoServc");
    expect(notice?.params.get("serviceKey")).toBe(NOTICE_KEY);
    expect(lines.join("\n")).not.toMatch(/KEY-SECRET|serviceKey/);
  });

  it("apply: 받은 것을 이어 지금 시각으로 쓴다", async () => {
    const { exitCode, report, upserts } = await run("apply", 1000);
    expect(exitCode).toBe(0);
    expect(report.written).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.fetchedAt).toBe(NOW.toISOString());
    expect(upserts[0]?.rows[0]).toMatchObject({
      bid_notice_no: "R26BK00000001",
      award_ratio: 0.87,
      base_amount_kind: "ASSIGNED_BUDGET",
      opened_at: "2026-05-20T05:00:00.000Z",
    });
  });

  it("하한만으로 상한을 넘으면 한 번도 부르지 않고 줄일 개월 수를 알린다", async () => {
    const { exitCode, report, lines, calls } = await run("dry-run", 400, fakeG2b(), 12);
    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(report).toMatchObject({ stopped: "OVER_LIMIT", suggestedMonths: 10, save: 0 });
    expect(lines[0]).toContain("--months 10 로 줄인다");
  });

  it("호출 상한에 닿으면 '중단: 호출 상한' 을 내고 받은 데까지 잇는다", async () => {
    const { exitCode, report, lines } = await run(
      "apply",
      expectedCalls,
      fakeG2b({ lastDayTotal: 1500 }),
    );
    expect(exitCode).toBe(1);
    expect(lines).toContain("award-backfill: 중단: 호출 상한");
    expect(report).toMatchObject({
      stopped: "CALL_LIMIT",
      calls: { used: expectedCalls },
      save: 1,
      written: 1,
    });
  });
});
