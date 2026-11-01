import { describe, expect, it } from "vitest";
import {
  listProgramNotices,
  parseProgramNoticeListQuery,
  type ProgramNoticeRow,
} from "./list.service";
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
  it("제목 본문에 IT 분야 단어가 있는 공고만 IT 관련이다", () => {
    expect(isItProgramNotice({ title: "2026 AI 바우처 지원사업 공고" })).toBe(true);
    expect(isItProgramNotice({ title: "[전남] 2026년 드론기업 역량강화 지원사업 공고(R&D)" })).toBe(
      false,
    );
  });

  it("사업개요나 제목 괄호 안에만 IT 단어가 있으면 IT 관련이 아니다", () => {
    // 운영 실측(2026-10-29): 요약에 "빅데이터ㆍAI"가 지나가는 물류장비 공고, 괄호 안 센터 이름에만 AI 가 있는 인증시험 공고.
    expect(
      isItProgramNotice(
        row(
          "logistics",
          "[경남] 2026년 스마트 물류장비산업 육성 기업지원사업 모집 공고",
          "스마트 물류기술(AIㆍIT 포함)을 접목한 중소기업",
        ),
      ),
    ).toBe(false);
    expect(
      isItProgramNotice({
        title: "의료기기 인증시험 기술지원 참여기업 모집 공고(AIㆍ빅데이터 기반 연구제조센터 구축)",
      }),
    ).toBe(false);
    // 닫히지 않은 괄호는 끝까지 괄호 안으로 본다. 괄호 밖 본문의 단어는 그대로 센다.
    expect(isItProgramNotice({ title: "기업 모집 공고(AI 실증센터 구축" })).toBe(false);
    expect(isItProgramNotice({ title: "피지컬 AI 실증 공고(혼합현실(MR) 기반구축" })).toBe(true);
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

  it("쌍둥이 공고는 한쪽만 IT 여도 묶음으로 남고 기업마당 사본이 보인다", async () => {
    // 묶기 키는 앞머리 [..] 를 무시하므로, 중기부 쌍둥이 제목 앞머리에만 "클라우드"가 있을 수 있다.
    const bizinfo = { ...row("biz", "소상공인 경영 지원사업 공고"), dedupe_key: "twin" };
    const mss = {
      ...row("mss", "[클라우드] 소상공인 경영 지원사업 공고"),
      source: "mss",
      dedupe_key: "twin",
    };
    expect(isItProgramNotice(bizinfo)).toBe(false);
    expect(isItProgramNotice(mss)).toBe(true);

    const shown = await list([bizinfo, mss]);
    expect(shown.items.map((item) => item.id)).toEqual(["biz"]);
    expect(shown.hasAnyNotice).toBe(true);
  });

  it("과기정통부 공고는 IT 단어가 없어도 보인다", async () => {
    const msit = {
      ...row("msit", "2026년도 국제공동연구 신속지원사업 신규과제 공모"),
      source: "msit",
    };
    expect(isItProgramNotice(msit)).toBe(false);
    const shown = await list([msit]);
    expect(shown.items.map((item) => item.id)).toEqual(["msit"]);
    expect(shown.hasAnyNotice).toBe(true);
  });

  it("과기정통부 쌍둥이가 기업마당에도 있으면 기업마당 행이 보인다", async () => {
    const biz = { ...row("biz", "국제공동연구 신속지원사업 공모"), dedupe_key: "twin" };
    const msit = {
      ...row("msit", "국제공동연구 신속지원사업 공모"),
      source: "msit",
      dedupe_key: "twin",
    };
    expect((await list([biz, msit])).items.map((item) => item.id)).toEqual(["biz"]);
  });

  it("출처 조건 msit 를 받는다", () => {
    expect(parseProgramNoticeListQuery({ source: "msit" })).toMatchObject({
      ok: true,
      value: { source: "msit" },
    });
  });
});
