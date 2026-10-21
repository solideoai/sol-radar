import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BidStage } from "./bid.model";
import type { StageLinkRow, StageLinksRepo } from "./stage-links.repo";
import { STAGE_LINK_POOL_LIMIT, getStageLinks } from "./stage-links.service";

// P0-8 단계 연결(07 §4). fixture FX-17(발주계획)·FX-18(사전규격)은 planRef 로 이어지고,
// FX-19(사전규격)는 FX-01(입찰공고)과 제목만 비슷해 후보로만 나온다(07 §6.2).
const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const FIXTURE_IDS = Array.from(
  { length: 20 },
  (_, index) => `FX-${String(index + 1).padStart(2, "0")}`,
);

type RawRecord = {
  noticeId: string;
  planRef: string | null;
  stage: BidStage;
  title?: string;
  agency?: string;
};

// fixture 원문의 첫 revision 으로 bid_notices 행 꼴을 만든다. id 는 fixture 번호다. 제목이 없는 FX-12(격리)는 뺀다.
const fixtureRows = (): StageLinkRow[] =>
  FIXTURE_IDS.flatMap((id) => {
    const file = JSON.parse(readFileSync(join(FIXTURES_DIR, "bids", `${id}.json`), "utf8")) as {
      records: RawRecord[];
    };
    const record = file.records[0];
    if (record.title === undefined) return [];
    return [
      {
        id,
        stage: record.stage,
        notice_id: record.noticeId,
        plan_ref: record.planRef,
        pre_spec_ref: null,
        title: record.title,
        agency: record.agency ?? null,
        status: "OPEN",
        deadline_at: null,
        is_demo: true,
      },
    ];
  });

const row = (id: string, patch: Partial<StageLinkRow> = {}): StageLinkRow => ({
  id,
  stage: "NOTICE",
  notice_id: `N-${id}`,
  plan_ref: null,
  pre_spec_ref: null,
  title: `공고 ${id}`,
  agency: null,
  status: "OPEN",
  deadline_at: null,
  is_demo: true,
  ...patch,
});

// 메모리 가짜 저장소. findRelated 는 지금 공고만 빼고 전부 준다(is_demo 거르기는 서비스도 하는지 본다).
function memoryRepo(rows: StageLinkRow[]) {
  const poolLimits: number[] = [];
  const repo: StageLinksRepo = {
    findAnchor: async (bidId) => rows.find((candidate) => candidate.id === bidId) ?? null,
    findRelated: async (anchor, poolLimit) => {
      poolLimits.push(poolLimit);
      return rows.filter((candidate) => candidate.id !== anchor.id);
    },
  };
  return { repo, poolLimits };
}

async function linksOf(rows: StageLinkRow[], bidId: string, now?: Date) {
  const result = await getStageLinks(bidId, { repo: memoryRepo(rows).repo, now });
  if (!result.ok) throw new Error(`실패: ${result.status} ${result.message}`);
  return result.data;
}

describe("getStageLinks — fixture", () => {
  it("FX-18(사전규격)은 발주계획 FX-17 과 planRef 로 이어지고 후보는 없다", async () => {
    const view = await linksOf(fixtureRows(), "FX-18");
    expect(view.linked).toEqual([
      {
        bidId: "FX-17",
        stage: "PLAN",
        noticeId: "DEMO-2026-0017",
        title: "과학기술정보통신부 2027년 AI 행정서비스 구축 발주계획 (가상)",
        agency: "과학기술정보통신부",
        status: "OPEN",
        basis: "PLAN_REF",
      },
    ]);
    expect(view.candidates).toEqual([]);
  });

  it("FX-17(발주계획)은 사전규격 FX-18 과 이어진다", async () => {
    const view = await linksOf(fixtureRows(), "FX-17");
    expect(view.linked.map(({ bidId, basis }) => [bidId, basis])).toEqual([["FX-18", "PLAN_REF"]]);
    expect(view.candidates).toEqual([]);
  });

  it("FX-19 는 이어진 공고가 없고 FX-01 이 연결 후보로만 나온다", async () => {
    const view = await linksOf(fixtureRows(), "FX-19");
    expect(view.linked).toEqual([]);
    expect(view.candidates).toEqual([
      {
        bidId: "FX-01",
        stage: "NOTICE",
        noticeId: "DEMO-2026-0001",
        title: "세종특별자치시 차세대 행정정보시스템 고도화 (가상)",
        agency: "세종특별자치시",
      },
    ]);
  });

  it("FX-01 에서는 FX-19 가 연결 후보로 나온다", async () => {
    const view = await linksOf(fixtureRows(), "FX-01");
    expect(view.linked).toEqual([]);
    expect(view.candidates.map(({ bidId }) => bidId)).toEqual(["FX-19"]);
  });

  it("연결도 후보도 없는 공고는 빈 목록이다", async () => {
    expect(await linksOf(fixtureRows(), "FX-02")).toEqual({ linked: [], candidates: [] });
  });

  it("후보 풀 상한 300 을 저장소에 넘긴다", async () => {
    const { repo, poolLimits } = memoryRepo(fixtureRows());
    await getStageLinks("FX-18", { repo });
    expect(STAGE_LINK_POOL_LIMIT).toBe(300);
    expect(poolLimits).toEqual([300]);
  });
});

describe("getStageLinks — 규칙", () => {
  // live 꼴: 입찰공고 bfSpecRgstNo(pre_spec_ref) = 사전규격 등록번호(notice_id).
  const preSpec = row("ps", { stage: "PRE_SPEC", notice_id: "R26BD00286413", is_demo: false });
  const notice = row("nt", { pre_spec_ref: "R26BD00286413", is_demo: false });

  it("입찰공고의 사전규격 번호로 사전규격과 이어진다(PRE_SPEC_REF)", async () => {
    const view = await linksOf([preSpec, notice], "nt");
    expect(view.linked.map(({ bidId, basis }) => [bidId, basis])).toEqual([["ps", "PRE_SPEC_REF"]]);
  });

  it("사전규격 쪽에서도 같은 연결이 보인다", async () => {
    const view = await linksOf([preSpec, notice], "ps");
    expect(view.linked.map(({ bidId, basis }) => [bidId, basis])).toEqual([["nt", "PRE_SPEC_REF"]]);
  });

  it("가상 공고와 실공고는 같은 planRef 라도 잇지 않는다", async () => {
    const live = row("live-plan", { stage: "PLAN", plan_ref: "DEMO-PLAN-0042", is_demo: false });
    const view = await linksOf([...fixtureRows(), live], "FX-18");
    expect(view.linked.map(({ bidId }) => bidId)).toEqual(["FX-17"]);
  });

  it("같은 단계끼리는 제목이 같아도 후보가 아니다", async () => {
    const a = row("a", { title: "세종특별자치시 행정정보 연계 플랫폼 구축" });
    const b = row("b", { title: "세종특별자치시 행정정보 연계 플랫폼 구축" });
    expect(await linksOf([a, b], "a")).toEqual({ linked: [], candidates: [] });
  });

  it("마감이 지난 연결 공고는 CLOSED 로 보인다", async () => {
    const plan = row("plan", { stage: "PLAN", plan_ref: "P-1" });
    const closed = row("closed", { plan_ref: "P-1", deadline_at: "2026-10-01T09:00:00Z" });
    const view = await linksOf([plan, closed], "plan", new Date("2026-10-21T00:00:00Z"));
    expect(view.linked.map(({ status }) => status)).toEqual(["CLOSED"]);
  });

  it("연결은 단계 순서(발주계획 → 사전규격 → 입찰공고), 같은 단계는 공고번호 순이다", async () => {
    const anchor = row("anchor", { stage: "PRE_SPEC", notice_id: "PS-1", plan_ref: "P-1" });
    const rows = [
      anchor,
      row("n2", { notice_id: "N-2", plan_ref: "P-1" }),
      row("n1", { notice_id: "N-1", pre_spec_ref: "PS-1" }),
      row("plan", { stage: "PLAN", notice_id: "P-1", plan_ref: "P-1" }),
    ];
    const view = await linksOf(rows, "anchor");
    expect(view.linked.map(({ bidId, basis }) => [bidId, basis])).toEqual([
      ["plan", "PLAN_REF"],
      ["n1", "PRE_SPEC_REF"],
      ["n2", "PLAN_REF"],
    ]);
  });

  // 2-gram Dice: len10 1, len9 16/17, len8 14/16, len7 12/15, far 0
  it("후보는 유사도 내림차순 최대 3건이다", async () => {
    const anchor = row("anchor", { stage: "PRE_SPEC", title: "가나다라마바사아자차" });
    const rows = [
      anchor,
      row("len7", { title: "가나다라마바사" }),
      row("len10", { title: "가나다라마바사아자차" }),
      row("len9", { title: "가나다라마바사아자" }),
      row("len8", { title: "가나다라마바사아" }),
      row("far", { title: "전혀 다른 사업" }),
    ];
    const view = await linksOf(rows, "anchor");
    expect(view.candidates.map(({ bidId }) => bidId)).toEqual(["len10", "len9", "len8"]);
  });

  it("취소된 공고는 후보로 내지 않지만, 식별자로 이어진 취소 공고는 연결에 남는다", async () => {
    const fixtures = fixtureRows().map((fixture) =>
      fixture.id === "FX-01" || fixture.id === "FX-17"
        ? { ...fixture, status: "CANCELLED" as const }
        : fixture,
    );
    expect((await linksOf(fixtures, "FX-19")).candidates).toEqual([]);
    expect((await linksOf(fixtures, "FX-18")).linked).toMatchObject([
      { bidId: "FX-17", status: "CANCELLED" },
    ]);
  });

  it("없는 공고는 404 다", async () => {
    const result = await getStageLinks("missing", { repo: memoryRepo(fixtureRows()).repo });
    expect(result).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
  });
});
