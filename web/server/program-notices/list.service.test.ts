import { describe, expect, it, vi } from "vitest";
import { kstToday } from "./dates";
import {
  LIST_FETCH_LIMIT,
  LIST_MAX_ITEMS,
  listProgramNotices,
  parseProgramNoticeListQuery,
  type ProgramNoticeListQuery,
  type ProgramNoticeRow,
  type ProgramNoticesRepo,
} from "./list.service";

const TODAY = "2026-10-21";

let seq = 0;
const row = (fields: Partial<ProgramNoticeRow> = {}): ProgramNoticeRow => {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    source: "bizinfo",
    title: `공고 ${seq}`,
    agency: "중소벤처기업부",
    source_url: `https://www.bizinfo.go.kr/view.do?pblancId=P${seq}`,
    published_at: "2026-10-20T00:00:00+00:00",
    apply_start_on: null,
    apply_end_on: null,
    summary: null,
    apply_method: null,
    target: null,
    tags: [],
    is_demo: false,
    dedupe_key: `공고${seq}|중소벤처기업부`,
    ...fields,
  };
};

const repoOf = (rows: ProgramNoticeRow[]) => {
  const listRecent = vi.fn<ProgramNoticesRepo["listRecent"]>(async () => rows);
  return { listRecent } satisfies ProgramNoticesRepo;
};

const DEFAULT_QUERY: ProgramNoticeListQuery = {
  source: null,
  q: null,
  sort: "deadline",
  includeClosed: false,
};

const list = (
  rows: ProgramNoticeRow[],
  query: Partial<ProgramNoticeListQuery> = {},
  today = TODAY,
) => listProgramNotices({ ...DEFAULT_QUERY, ...query }, { repo: repoOf(rows), today });

describe("parseProgramNoticeListQuery", () => {
  it("빈 쿼리는 두 소스·마감 빠른 순·진행 중만이다", () => {
    expect(parseProgramNoticeListQuery({})).toEqual({ ok: true, value: DEFAULT_QUERY });
  });

  it("source·q·sort·includeClosed 를 읽고 모르는 키는 무시한다", () => {
    expect(
      parseProgramNoticeListQuery({
        source: "mss",
        q: "  중기부 ",
        sort: "published",
        includeClosed: "true",
        page: "2",
      }),
    ).toEqual({
      ok: true,
      value: { source: "mss", q: "중기부", sort: "published", includeClosed: true },
    });
    expect(parseProgramNoticeListQuery({ q: "   " })).toEqual({ ok: true, value: DEFAULT_QUERY });
  });

  it("값이 틀리거나 반복되면 이슈를 돌려준다", () => {
    for (const raw of [
      { source: "g2b" },
      { sort: "score" },
      { includeClosed: "yes" },
      { q: "가".repeat(51) },
      { source: ["mss", "bizinfo"] },
    ]) {
      const result = parseProgramNoticeListQuery(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]?.path).toBe(Object.keys(raw)[0]);
    }
  });
});

describe("listProgramNotices", () => {
  it("마감 지난 공고는 기본으로 빼고(마감 null 은 남김) includeClosed 면 보인다", async () => {
    const closed = row({ apply_end_on: "2026-10-20" });
    const today = row({ apply_end_on: TODAY });
    const open = row({ apply_end_on: "2026-10-31" });
    const unknown = row({ apply_end_on: null });
    const rows = [closed, today, open, unknown];
    expect((await list(rows)).items.map((item) => item.id)).toEqual([
      today.id,
      open.id,
      unknown.id,
    ]);
    expect((await list(rows, { includeClosed: true })).items.map((item) => item.id)).toEqual([
      closed.id,
      today.id,
      open.id,
      unknown.id,
    ]);
  });

  it("오늘은 KST 날짜다 — UTC 15:30 은 KST 다음 날이라 그날 마감 공고가 빠진다", async () => {
    const endsOn21 = row({ apply_end_on: "2026-10-21" });
    const before = kstToday(new Date("2026-10-21T14:59:59Z"));
    const after = kstToday(new Date("2026-10-21T15:30:00Z"));
    expect((await list([endsOn21], {}, before)).items).toHaveLength(1);
    expect((await list([endsOn21], {}, after)).items).toHaveLength(0);
  });

  it("deadline 정렬: 마감 오름차순, null 은 뒤, 같으면 등록일 최신 순", async () => {
    const lateEnd = row({ apply_end_on: "2026-11-30" });
    const soonOld = row({ apply_end_on: "2026-10-25", published_at: "2026-10-01T00:00:00+00:00" });
    const soonNew = row({ apply_end_on: "2026-10-25", published_at: "2026-10-19T00:00:00+00:00" });
    const noEnd = row({ apply_end_on: null });
    const { items } = await list([noEnd, lateEnd, soonOld, soonNew]);
    expect(items.map((item) => item.id)).toEqual([soonNew.id, soonOld.id, lateEnd.id, noEnd.id]);
  });

  it("published 정렬: 등록일 최신 순, null 은 뒤", async () => {
    const old = row({ published_at: "2026-10-01T00:00:00+00:00" });
    const recent = row({ published_at: "2026-10-20T00:00:00+00:00" });
    const none = row({ published_at: null });
    const { items } = await list([none, old, recent], { sort: "published" });
    expect(items.map((item) => item.id)).toEqual([recent.id, old.id, none.id]);
  });

  it("두 소스가 다 보일 때 같은 dedupe_key 면 기업마당 행만 남고, source=mss 면 중기부 행이 남는다", async () => {
    const bizinfo = row({ dedupe_key: "같은공고|중소벤처기업부" });
    const mss = row({
      source: "mss",
      dedupe_key: "같은공고|중소벤처기업부",
      source_url: "https://mss.go.kr/site/smba/ex/bbs/View.do?bcIdx=1",
    });
    const other = row({ source: "mss", source_url: "https://mss.go.kr/x?bcIdx=2" });
    expect((await list([bizinfo, mss, other])).items.map((item) => item.id)).toEqual([
      bizinfo.id,
      other.id,
    ]);
    expect(
      (await list([bizinfo, mss, other], { source: "mss" })).items.map((item) => item.id),
    ).toEqual([mss.id, other.id]);
  });

  it("마감 지난 기업마당 공고의 중기부 쌍둥이도 함께 빠진다", async () => {
    const closedBizinfo = row({ apply_end_on: "2026-10-01", dedupe_key: "쌍둥이|중소벤처기업부" });
    const twin = row({ source: "mss", dedupe_key: "쌍둥이|중소벤처기업부" });
    expect((await list([closedBizinfo, twin])).items).toEqual([]);
  });

  it("q 는 소관기관 부분 일치이고 대소문자·공백·전각 차이를 무시한다", async () => {
    const mss = row({ agency: "중소벤처기업부" });
    const motie = row({ agency: "산업통상자원부" });
    const kotra = row({ agency: "KOTRA 무역관" });
    const noAgency = row({ agency: null });
    const rows = [mss, motie, kotra, noAgency];
    expect((await list(rows, { q: "벤처 기업" })).items.map((item) => item.id)).toEqual([mss.id]);
    expect((await list(rows, { q: "ｋｏｔｒａ" })).items.map((item) => item.id)).toEqual([
      kotra.id,
    ]);
  });

  it("목록 항목은 화면에 필요한 값만 camelCase 로 준다(정규화 키는 내보내지 않는다)", async () => {
    const item = row({ apply_end_on: "2026-10-31", tags: ["기술"], summary: "개요" });
    const { items } = await list([item]);
    expect(items[0]).toEqual({
      id: item.id,
      source: "bizinfo",
      title: item.title,
      agency: "중소벤처기업부",
      sourceUrl: item.source_url,
      publishedAt: item.published_at,
      applyStartOn: null,
      applyEndOn: "2026-10-31",
      summary: "개요",
      applyMethod: null,
      target: null,
      tags: ["기술"],
      isDemo: false,
    });
  });

  it("거르기 전 저장 행이 있는지(hasAnyNotice)와 상한에 걸렸는지(isCapped)를 함께 준다", async () => {
    expect(await list([])).toEqual({ items: [], total: 0, hasAnyNotice: false, isCapped: false });
    const onlyClosed = await list([row({ apply_end_on: "2026-01-01" })]);
    expect(onlyClosed).toMatchObject({ total: 0, hasAnyNotice: true, isCapped: false });
    const many = Array.from({ length: LIST_MAX_ITEMS + 5 }, () => row());
    const capped = await list(many);
    expect(capped.items).toHaveLength(LIST_MAX_ITEMS);
    expect(capped).toMatchObject({ total: LIST_MAX_ITEMS, isCapped: true });
    const exact = await list(Array.from({ length: LIST_MAX_ITEMS }, () => row()));
    expect(exact).toMatchObject({ total: LIST_MAX_ITEMS, isCapped: false });
  });

  it("repo 에는 읽을 최대 행 수만 넘기고, 출처 필터로 0건이어도 저장 행이 있으면 hasAnyNotice 다", async () => {
    const repo = repoOf([row({ source: "bizinfo" })]);
    const result = await listProgramNotices(
      { ...DEFAULT_QUERY, source: "mss" },
      { repo, today: TODAY },
    );
    expect(repo.listRecent).toHaveBeenCalledWith({ limit: LIST_FETCH_LIMIT });
    expect(result).toEqual({ items: [], total: 0, hasAnyNotice: true, isCapped: false });
  });
});
