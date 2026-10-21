import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  STAGE_LINK_BASIS_LABEL,
  STAGE_LINKS_COPY,
  StageLinks,
} from "@/components/bids/stage-links";
import type { StageLinkCandidateItem, StageLinkItem, StageLinksView } from "@/server/bids";

// 상세 단계 이력 아래 단계 연결 구역을 진짜 브라우저에 그린다(디자인 스펙 docs/plans/2026-10-21-p08-stage-links-ui-spec.md §10).
// 상자 폭은 상세 주 영역 폭이다: 1280px 화면 616px, 1440px 화면 776px(사이드바 펼침).

// 나머지 속성을 넘긴다. aria-describedby·id 를 버리면 접근성 단언이 늘 실패한다(스펙 §10 준비).
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const FX01_ID = "0f1e2d3c-4b5a-4968-8776-000000000001";
const FX17_ID = "0f1e2d3c-4b5a-4968-8776-000000000017";
const FX18_ID = "0f1e2d3c-4b5a-4968-8776-000000000018";
const FX01_TITLE = "세종특별자치시 차세대 행정정보시스템 고도화 (가상)";
const FX17_TITLE = "과학기술정보통신부 2027년 AI 행정서비스 구축 발주계획 (가상)";
const FX18_TITLE = "과학기술정보통신부 AI 행정서비스 구축 사전규격 (가상)";
const MSIT = "과학기술정보통신부";
const SEJONG = "세종특별자치시";

const linkedItem = (overrides: Partial<StageLinkItem> = {}): StageLinkItem => ({
  bidId: FX17_ID,
  stage: "PLAN",
  noticeId: "DEMO-2026-0017",
  title: FX17_TITLE,
  agency: MSIT,
  status: "OPEN",
  basis: "PLAN_REF",
  ...overrides,
});

const candidateItem = (
  overrides: Partial<StageLinkCandidateItem> = {},
): StageLinkCandidateItem => ({
  bidId: FX01_ID,
  stage: "NOTICE",
  noticeId: "DEMO-2026-0001",
  title: FX01_TITLE,
  agency: SEJONG,
  ...overrides,
});

// FX-18 상세: 같은 planRef 로 이어진 발주계획 FX-17
const FX18_LINKS: StageLinksView = { linked: [linkedItem()], candidates: [] };
// FX-19 상세: 제목만 비슷한 입찰공고 FX-01
const FX19_LINKS: StageLinksView = { linked: [], candidates: [candidateItem()] };

const mounted: Root[] = [];
beforeEach(async () => {
  await page.viewport(1280, 900);
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

const render = (stageLinks: StageLinksView | null, width = 616) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  const root = createRoot(host);
  flushSync(() => root.render(<StageLinks stageLinks={stageLinks} />));
  mounted.push(root);
  return host;
};

const rowsOf = (host: HTMLElement, kind: "linked" | "candidate") =>
  Array.from(
    host.querySelectorAll<HTMLElement>(`[data-slot="stage-link-item"][data-kind="${kind}"]`),
  );
const metaOf = (row: HTMLElement) => row.querySelector<HTMLElement>('[id$="-meta"]');
const chipOf = (row: HTMLElement) => row.querySelector<HTMLElement>('[id$="-stage"]');
const summaryOf = (host: HTMLElement) => {
  const summary = host.querySelector<HTMLElement>('[data-slot="stage-links-candidates"] > summary');
  if (summary === null) throw new Error("후보 요약 줄이 없다");
  return summary;
};
const detailsOf = (host: HTMLElement) => {
  const details = host.querySelector<HTMLDetailsElement>(
    'details[data-slot="stage-links-candidates"]',
  );
  if (details === null) throw new Error("후보 묶음이 없다");
  return details;
};
const titleLink = (title: string) => page.getByRole("link", { name: title, exact: true });

describe("StageLinks 연결 묶음(스펙 §4.3, S1)", () => {
  it("T1 FX-18 꼴이면 발주계획 FX-17 한 줄이 보이고 제목이 그 상세로 간다", async () => {
    const host = render(FX18_LINKS);
    expect(host.querySelectorAll('[data-slot="stage-links"]')).toHaveLength(1);
    await expect
      .element(page.getByRole("heading", { level: 3 }))
      .toHaveTextContent(`${STAGE_LINKS_COPY.linkedTitle} 1건`);
    const rows = rowsOf(host, "linked");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.dataset.stage).toBe("PLAN");
    expect(row.dataset.basis).toBe("PLAN_REF");
    await expect.element(titleLink(FX17_TITLE)).toHaveAttribute("href", `/bids/${FX17_ID}`);
    const rowText = row.textContent ?? "";
    expect(chipOf(row)?.textContent).toBe("발주계획");
    for (const part of ["공고번호", "DEMO-2026-0017", MSIT, "발주계획 번호로 연결"]) {
      expect(rowText).toContain(part);
    }
    expect(host.querySelector("details")).toBeNull();
  });

  it("T2 FX-17 꼴이면 사전규격 칩이고 근거 글자는 단계가 아니라 basis 로 고른다", async () => {
    const host = render({
      linked: [
        linkedItem({
          bidId: FX18_ID,
          stage: "PRE_SPEC",
          noticeId: "DEMO-2026-0018",
          title: FX18_TITLE,
        }),
      ],
      candidates: [],
    });
    const row = rowsOf(host, "linked")[0]!;
    expect(chipOf(row)?.textContent).toBe("사전규격");
    expect(metaOf(row)?.textContent).toContain(STAGE_LINK_BASIS_LABEL.PLAN_REF);
    expect(metaOf(row)?.textContent).not.toContain(STAGE_LINK_BASIS_LABEL.PRE_SPEC_REF);
    await expect.element(titleLink(FX18_TITLE)).toHaveAttribute("href", `/bids/${FX18_ID}`);
  });

  it("T3 사전규격 번호로 이어졌으면 '사전규격 번호로 연결'이다", () => {
    const host = render({
      linked: [linkedItem({ stage: "PRE_SPEC", basis: "PRE_SPEC_REF" })],
      candidates: [],
    });
    const row = rowsOf(host, "linked")[0]!;
    expect(row.dataset.basis).toBe("PRE_SPEC_REF");
    expect(metaOf(row)?.textContent).toContain("사전규격 번호로 연결");
    expect(metaOf(row)?.textContent).not.toContain("발주계획 번호로 연결");
  });

  it("T10 취소된 연결 공고는 보조 줄 맨 앞에 아이콘 + '취소됨'을 두고 제목은 여전히 링크다", async () => {
    const host = render({ linked: [linkedItem({ status: "CANCELLED" })], candidates: [] });
    const meta = metaOf(rowsOf(host, "linked")[0]!);
    if (meta === null) throw new Error("보조 줄이 없다");
    expect(meta.textContent).toMatch(/^취소됨 · 공고번호 DEMO-2026-0017/);
    const icons = meta.querySelectorAll('svg[aria-hidden="true"]');
    expect(icons).toHaveLength(1);
    // 아이콘이 글자 앞에 있다.
    expect(meta.firstElementChild?.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    await expect.element(titleLink(FX17_TITLE)).toHaveAttribute("href", `/bids/${FX17_ID}`);
  });

  it.each([
    ["null", null],
    ["빈 글자", "   "],
  ])("T11 발주기관이 %s 이면 그 토막과 앞 가운뎃점을 뺀다", (_label, agency) => {
    const host = render({ linked: [linkedItem({ agency })], candidates: [] });
    expect(metaOf(rowsOf(host, "linked")[0]!)?.textContent).toBe(
      "공고번호 DEMO-2026-0017 · 발주계획 번호로 연결",
    );
  });
});

describe("StageLinks 후보 묶음(스펙 §4.4, S2·S2')", () => {
  it("T4 FX-19 꼴이면 접힌 요약 한 줄만 보이고 후보 링크는 숨어 있다", async () => {
    const host = render(FX19_LINKS);
    expect(host.querySelector('[data-slot="stage-links-linked"]')).toBeNull();
    expect(host.querySelector("h3")).toBeNull();
    expect(detailsOf(host).open).toBe(false);
    const summary = summaryOf(host).textContent ?? "";
    expect(summary).toContain(STAGE_LINKS_COPY.candidatesTitle);
    expect(summary).toContain("1건");
    expect(summary).toContain("이 공고와 제목이 비슷합니다. 자동으로 잇지 않았습니다.");
    await expect.element(page.getByText(STAGE_LINKS_COPY.candidatesNote)).toBeVisible();
    const link = host.querySelector("a");
    if (link === null) throw new Error("후보 링크가 없다");
    await expect.element(link).not.toBeVisible();
  });

  it("T5 펼치면 FX-01 제목 링크와 공고번호·기관이 점선 상자 안에 보이고 근거 글자는 없다", async () => {
    const host = render(FX19_LINKS);
    await userEvent.click(summaryOf(host));
    expect(detailsOf(host).open).toBe(true);
    await expect.element(titleLink(FX01_TITLE)).toBeVisible();
    await expect.element(titleLink(FX01_TITLE)).toHaveAttribute("href", `/bids/${FX01_ID}`);
    const rows = rowsOf(host, "candidate");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.hasAttribute("data-basis")).toBe(false);
    expect(chipOf(row)?.textContent).toBe("입찰공고");
    const rowText = row.textContent ?? "";
    expect(rowText).toContain("공고번호 DEMO-2026-0001");
    expect(rowText).toContain(SEJONG);
    expect(rowText).not.toContain("번호로 연결");
    const list = page.getByRole("list", { name: STAGE_LINKS_COPY.candidatesTitle }).element();
    expect(getComputedStyle(list).borderStyle).toBe("dashed");
  });

  it("T6 요약은 키보드 Enter 로 펼치고 접으며 초점은 요약에 남는다", async () => {
    const host = render(FX19_LINKS);
    const summary = summaryOf(host);
    summary.focus();
    expect(document.activeElement).toBe(summary);
    await userEvent.keyboard("{Enter}");
    expect(detailsOf(host).open).toBe(true);
    await userEvent.keyboard("{Enter}");
    expect(detailsOf(host).open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it("T12 후보는 받은 순서 그대로 그린다(다시 정렬하지 않는다)", async () => {
    const ids = [
      "0f1e2d3c-4b5a-4968-8776-00000000000c",
      "0f1e2d3c-4b5a-4968-8776-00000000000a",
      "0f1e2d3c-4b5a-4968-8776-00000000000b",
    ];
    const titles = ["하 후보 사업 (가상)", "가 후보 사업 (가상)", "마 후보 사업 (가상)"];
    const host = render({
      linked: [],
      candidates: ids.map((bidId, index) =>
        candidateItem({ bidId, title: titles[index]!, noticeId: `DEMO-2026-01${index}` }),
      ),
    });
    await userEvent.click(summaryOf(host));
    expect(summaryOf(host).textContent).toContain("3건");
    const rows = rowsOf(host, "candidate");
    expect(rows.map((row) => row.dataset.bidId)).toEqual(ids);
    expect(rows.map((row) => row.querySelector("a")?.textContent)).toEqual(titles);
  });
});

describe("StageLinks 빈 상태·읽기 실패(스펙 §4.2·§4.5, S4·S5)", () => {
  it("T8 연결도 후보도 없으면 아무 요소도 그리지 않는다", () => {
    const host = render({ linked: [], candidates: [] });
    expect(host.childElementCount).toBe(0);
  });

  it("T9 읽기 실패(null)면 한 줄 안내만 둔다", () => {
    const host = render(null);
    const error = host.querySelector('[data-slot="stage-links-error"]');
    expect(error?.textContent).toBe("다른 단계 공고를 불러오지 못했습니다");
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector("details")).toBeNull();
    expect(host.querySelector('[data-slot="stage-links"]')).toBeNull();
  });
});

describe("StageLinks 둘 다·금지 표시·접근성(스펙 §4.4·§7·§8)", () => {
  const both: StageLinksView = { linked: [linkedItem()], candidates: [candidateItem()] };

  it("T13 연결과 후보가 둘 다 있으면 연결 묶음이 위, 후보 묶음이 아래다", () => {
    const host = render(both);
    const linked = host.querySelector('[data-slot="stage-links-linked"]');
    const candidates = host.querySelector('[data-slot="stage-links-candidates"]');
    if (linked === null || candidates === null) throw new Error("묶음이 둘 다 있어야 한다");
    expect(linked.compareDocumentPosition(candidates) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it.each([
    ["연결(FX-18 꼴)", FX18_LINKS],
    ["후보(FX-19 꼴)", FX19_LINKS],
    ["둘 다", both],
  ])("T7 %s 어디에도 유사도·확률·점수 표시가 없다", async (_label, view) => {
    // 서버 계약 밖 칸(유사도 값)이 섞여 와도 그리지 않는다. 변수로 넘겨 타입의 남는 칸 검사를 피한다.
    const leaked = { ...candidateItem(), similarity: 0.529 };
    const host = render({
      linked: view.linked,
      candidates: view.candidates.length > 0 ? [leaked] : [],
    });
    if (host.querySelector("details") !== null) await userEvent.click(summaryOf(host));
    const shown = host.textContent ?? "";
    for (const word of ["%", "유사도", "확률", "승률", "수주", "점수"]) {
      expect(shown).not.toContain(word);
    }
    expect(shown).not.toMatch(/\d+\.\d+/);
    expect(host.innerHTML).not.toContain("similarity");
    expect(host.innerHTML).not.toContain("0.529");
  });

  it("T14 링크 설명 id 가 모두 있고 장식 기호는 숨기며 버튼 요소가 없다", async () => {
    const host = render(both);
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>("a"));
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^\/bids\/[0-9a-f-]{36}$/);
      const ids = (link.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
      expect(ids.length).toBeGreaterThanOrEqual(2);
      for (const id of ids) expect(document.getElementById(id), id).not.toBeNull();
    }
    const describedText = (link: HTMLAnchorElement) =>
      (link.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
    const [linkedLink, candidateLink] = links as [HTMLAnchorElement, HTMLAnchorElement];
    expect(describedText(linkedLink)).toContain("발주계획");
    expect(describedText(linkedLink)).toContain(STAGE_LINK_BASIS_LABEL.PLAN_REF);
    expect(candidateLink.getAttribute("aria-describedby")?.split(" ")).toContain(
      "stage-links-candidates-note",
    );
    expect(describedText(candidateLink)).toContain(STAGE_LINKS_COPY.candidatesNote);
    const marker = Array.from(host.querySelectorAll("span")).find(
      (span) => span.textContent === "▾",
    );
    expect(marker?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelectorAll("button")).toHaveLength(0);
    // 후보 목록 이름과 연결 목록 이름(h3)
    await expect
      .element(page.getByRole("list", { name: `${STAGE_LINKS_COPY.linkedTitle} 1건` }))
      .toBeInTheDocument();
  });

  it("T16 Tab 으로 제목 링크·후보 요약에 초점이 가면 초점 고리가 보인다", async () => {
    const host = render(both);
    await userEvent.tab();
    const link = host.querySelector("a");
    expect(document.activeElement).toBe(link);
    expect(getComputedStyle(link as Element).boxShadow).not.toBe("none");
    await userEvent.tab();
    expect(document.activeElement).toBe(summaryOf(host));
    expect(getComputedStyle(summaryOf(host)).boxShadow).not.toBe("none");
  });
});

describe("StageLinks 넘침(스펙 §4.6, S7)", () => {
  it.each([616, 776])(
    "T15 %ipx 상자에서 띄어쓰기 없는 긴 제목·기관도 칸 안에서 꺾이고 넘치지 않는다",
    async (width) => {
      const longTitle = "통합정보시스템구축사업".repeat(20).slice(0, 200);
      const longAgency = "한국지능정보사회진흥원디지털정부혁신추진단".repeat(4);
      const host = render(
        {
          linked: [
            linkedItem({ title: longTitle, agency: longAgency, status: "CANCELLED" }),
            linkedItem({ bidId: FX18_ID, stage: "PRE_SPEC", noticeId: "R26BD00067890" }),
          ],
          candidates: [candidateItem({ title: `${longTitle}후보`, agency: longAgency })],
        },
        width,
      );
      await userEvent.click(summaryOf(host));
      const root = host.querySelector<HTMLElement>('[data-slot="stage-links"]');
      if (root === null) throw new Error("구역이 없다");
      expect(root.getBoundingClientRect().width).toBe(width);
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
      const lists = Array.from(root.querySelectorAll<HTMLElement>("ul"));
      expect(lists).toHaveLength(2);
      for (const list of lists) expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
      const right = root.getBoundingClientRect().right;
      const outside = Array.from(root.querySelectorAll<HTMLElement>("*")).filter(
        (el) => el.getBoundingClientRect().right > right + 0.5,
      );
      expect(outside.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
      const wrapper = page.getByRole("link", { name: longTitle, exact: true }).element()
        .parentElement as HTMLElement;
      expect(wrapper.getBoundingClientRect().height).toBeGreaterThan(22);
    },
  );
});
