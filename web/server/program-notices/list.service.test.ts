import { describe, expect, it } from "vitest";
import { listProgramNotices, type ProgramNoticeRow } from "./list.service";
import { isItProgramNotice } from "./program-notice.model";

// 가상 공고. 제목·사업개요만 바꿔 IT 판정(ADR-069)을 본다.
const row = (id: string, title: string, summary: string | null = null): ProgramNoticeRow => ({
  id,
  source: "bizinfo",
  title,
  agency: "가상 기관",
  source_url: `https://www.bizinfo.go.kr/${id}`,
  published_at: "2026-10-20T00:00:00Z",
  apply_start_on: null,
  apply_end_on: null,
  summary,
  apply_method: null,
  target: null,
  tags: [],
  is_demo: false,
  dedupe_key: id,
});

const QUERY = { source: null, q: null, sort: "published", includeClosed: false } as const;
const list = (rows: ProgramNoticeRow[]) =>
  listProgramNotices(QUERY, { repo: { listRecent: async () => rows }, today: "2026-10-29" });

describe("지원사업 IT 판정(ADR-069)", () => {
  it("제목·사업개요에 IT 분야 단어가 있는 공고만 IT 관련이다", () => {
    expect(isItProgramNotice({ title: "2026 AI 바우처 지원사업 공고", summary: null })).toBe(true);
    expect(
      isItProgramNotice({
        title: "[전남] 2026년 드론기업 역량강화 지원사업 공고(R&D)",
        summary: null,
      }),
    ).toBe(false);
    expect(isItProgramNotice({ title: "소상공인 지원", summary: "클라우드 전환 비용 지원" })).toBe(
      true,
    );
  });

  it("목록은 IT 관련 공고만 보이고 저장된 공고 여부도 IT 관련 공고로 센다", async () => {
    const shown = await list([row("ai", "생성형 AI 도입 지원"), row("drone", "드론 실증 지원")]);
    expect(shown.items.map((item) => item.id)).toEqual(["ai"]);
    expect(shown.total).toBe(1);
    expect(shown.hasAnyNotice).toBe(true);

    const none = await list([row("drone", "드론 실증 지원")]);
    expect(none.items).toEqual([]);
    expect(none.hasAnyNotice).toBe(false);
  });
});
