import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { RevisionComparison } from "@/server/bids";
import { RevisionsView } from "./revisions-view";

// /bids/[id]/revisions 본문을 진짜 브라우저에 그린다. 화면(page.tsx)은 비교 결과를 읽어 이 부품에 넘기기만 한다.
// 시험 상자 폭 = 화면 폭 - 사이드바 256px. 1440 → 1184, 1280 → 1024 (AppPage 가 좌우 32px 여백을 둔다).

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

const BID_ID = "6b1d6d1e-6a3c-4c1f-9f5a-2b0c3d4e5f60";
const TITLE = "한국도로공사 교통정보 데이터플랫폼 고도화 (가상)";

const summary = (revision: number, amendmentNo: string, changedFields: string[]) => ({
  id: `rev-${revision}`,
  revision,
  amendmentNo,
  fetchedAt: `2026-10-24T0${revision}:12:00Z`,
  checksum: `sum-${revision}`,
  changedFields,
});

const FX07: RevisionComparison = {
  bidId: BID_ID,
  title: TITLE,
  revisions: [
    summary(2, "02", ["amendmentNo", "status", "budgetKrw", "content"]),
    summary(1, "01", []),
  ],
  current: { revision: 2, amendmentNo: "02", fetchedAt: "2026-10-24T02:12:00Z" },
  previous: { revision: 1, amendmentNo: "01", fetchedAt: "2026-10-24T01:12:00Z" },
  cancelled: false,
  changes: [
    { field: "budgetKrw", kind: "scalar", before: "1800000000", after: "2160000000" },
    { field: "status", kind: "scalar", before: "OPEN", after: "AMENDED" },
    {
      field: "content",
      kind: "text",
      segments: [
        {
          op: "same",
          text: "한국도로공사가 교통정보 데이터플랫폼 고도화 사업의 제안사를 모집한다. 사업 분야는 데이터 플랫폼이며 사업예산은 ",
        },
        { op: "removed", text: "18억원이다." },
        { op: "added", text: "21.6억원이다." },
        { op: "same", text: " 필수 기술은 Hadoop, " },
        { op: "removed", text: "Spark" },
        { op: "added", text: "Spark," },
        { op: "same", text: " " },
        { op: "added", text: "Kubernetes " },
        { op: "same", text: "이다. 우대 기술은 PostgreSQL, Airflow 이다." },
        {
          op: "added",
          text: " 정정공고: 사업예산을 21.6억원으로 증액하고 필수 기술에 Kubernetes 를 추가한다.",
        },
      ],
    },
  ],
};

const SINGLE: RevisionComparison = {
  bidId: BID_ID,
  title: TITLE,
  revisions: [summary(1, "01", [])],
  current: { revision: 1, amendmentNo: "01", fetchedAt: "2026-10-24T01:12:00Z" },
  previous: null,
  cancelled: false,
  changes: [],
};

const CANCELLED: RevisionComparison = {
  ...FX07,
  cancelled: true,
  revisions: [summary(2, "02", ["amendmentNo", "status", "content"]), summary(1, "01", [])],
  changes: [
    { field: "status", kind: "scalar", before: "OPEN", after: "CANCELLED" },
    {
      field: "content",
      kind: "text",
      segments: [
        { op: "same", text: "충청북도가 보유한 업체이다." },
        { op: "added", text: " 취소공고: 본 공고는 취소한다." },
      ],
    },
  ],
};

const LISTS: RevisionComparison = {
  ...FX07,
  changes: [
    {
      field: "attachments",
      kind: "list",
      added: ["추가 제안요청서.pdf"],
      removed: [],
      kept: [],
    },
  ],
};

const LONG: RevisionComparison = {
  ...FX07,
  changes: [
    {
      field: "content",
      kind: "text",
      segments: [
        { op: "same", text: "시작".repeat(300) },
        { op: "added", text: "바뀐곳" },
        { op: "same", text: "끝".repeat(900) },
      ],
    },
  ],
};

const mounted: Root[] = [];
const render = (data: RevisionComparison, width: number) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width - 256}px`;
  const root = createRoot(host);
  flushSync(() => root.render(<RevisionsView comparison={data} />));
  mounted.push(root);
  return host;
};

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

describe.each([1440, 1280])("RevisionsView %ipx", (width) => {
  beforeEach(async () => {
    await page.viewport(width, 900);
  });

  it("FX-07: 예산 18억 → 21.6억 줄과 본문의 Kubernetes 추가를 보인다", async () => {
    const host = render(FX07, width);
    await expect.element(page.getByRole("heading", { level: 1 })).toHaveTextContent("변경 이력");
    expect(host.querySelector('[data-slot="revision-bid-title"]')?.textContent).toBe(TITLE);
    const budget = host.querySelector('[data-field="budgetKrw"]');
    expect(budget?.textContent).toContain("18억");
    expect(budget?.textContent).toContain("21.6억");
    expect(budget?.textContent).toContain("1,800,000,000원");
    expect(budget?.textContent).toContain("2,160,000,000원");
    // 단일 값은 span 에 취소선·밑줄을 입힌다(스펙 §3.2, 낭독 글자 없음)
    const cells = budget?.querySelectorAll("td");
    expect(cells?.[0]?.querySelector(".line-through")?.textContent).toBe("18억");
    expect(cells?.[1]?.querySelector(".underline")?.textContent).toBe("21.6억");
    const status = host.querySelector('[data-field="status"]');
    expect(status?.textContent).toContain("정정 공고");

    const diff = host.querySelector('[data-slot="revision-content-diff"]');
    const added = Array.from(diff?.querySelectorAll("ins") ?? []).map((el) => el.textContent ?? "");
    expect(added.some((t) => t.includes("Kubernetes"))).toBe(true);
    expect(added.some((t) => t.includes("추가됨"))).toBe(true);
    expect(diff?.textContent).toContain("추가 끝");
    expect(diff?.querySelector("del")?.textContent).toContain("삭제됨");
    await expect
      .element(
        page.getByText("밑줄은 추가, 취소선은 삭제, 표시 없음은 유지입니다.", { exact: false }),
      )
      .toBeVisible();
    // 표에서 본문은 빠지고 한 줄씩이다
    expect(host.querySelectorAll('[data-slot="revision-change-row"]')).toHaveLength(2);
    // 머리말
    expect(host.textContent).toContain("r1");
    expect(host.textContent).toContain("차수 01");
    expect(host.textContent).toContain("차수 02");
    // 접을 곳이 없으니 펼치기 버튼이 없다
    expect(page.getByRole("button", { name: "본문 전체 펼치기" }).elements()).toHaveLength(0);
  });

  it("FX-07 첫 화면(스크롤 없이)에 예산 줄과 Kubernetes 가 들어온다", async () => {
    const host = render(FX07, width);
    const height = window.innerHeight;
    const budget = host.querySelector('[data-field="budgetKrw"]');
    const ins = Array.from(host.querySelectorAll('[data-slot="revision-content-diff"] ins')).find(
      (el) => el.textContent?.includes("Kubernetes"),
    );
    expect(budget?.getBoundingClientRect().bottom).toBeLessThanOrEqual(height);
    expect(ins?.getBoundingClientRect().bottom).toBeLessThanOrEqual(height);
  });

  it("revision 목록: 각 항목이 ?rev=N 링크이고 고른 하나만 aria-current", async () => {
    const host = render(FX07, width);
    const items = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('[data-slot="revision-item"]'),
    );
    expect(items.map((a) => a.getAttribute("href"))).toEqual([
      `/bids/${BID_ID}/revisions?rev=2`,
      `/bids/${BID_ID}/revisions?rev=1`,
    ]);
    expect(items.map((a) => a.getAttribute("aria-current"))).toEqual(["page", null]);
    expect(items[0]?.textContent).toContain("바뀐 항목 3개");
    expect(items[1]?.textContent).toContain("처음 수집");
    expect(host.querySelector("nav")?.getAttribute("aria-labelledby")).toBe("revision-list-title");
  });

  it("revision 하나뿐이면 안내 문구만 보이고 표가 없다", async () => {
    const host = render(SINGLE, width);
    await expect
      .element(page.getByText("처음 수집한 공고입니다. 아직 바뀐 내용이 없습니다."))
      .toBeVisible();
    expect(host.querySelector("table")).toBeNull();
    expect(host.querySelector('[data-slot="revision-empty"]')?.getAttribute("data-reason")).toBe(
      "single",
    );
    expect(host.querySelectorAll('[data-slot="revision-item"]')).toHaveLength(1);
    expect(host.querySelector('a[href="/bids/' + BID_ID + '"]')).not.toBeNull();
  });

  it("?rev=1 처럼 이전이 없는 첫 revision 은 최신 변경 보기를 권한다", async () => {
    const host = render(
      {
        ...FX07,
        current: { revision: 1, amendmentNo: "01", fetchedAt: "2026-10-24T01:12:00Z" },
        previous: null,
        changes: [],
      },
      width,
    );
    await expect.element(page.getByText("처음 수집한 revision 입니다")).toBeVisible();
    expect(host.querySelector('[data-reason="first"]')).not.toBeNull();
    expect(host.querySelector(`a[href="/bids/${BID_ID}/revisions"]`)).not.toBeNull();
  });

  it("바뀐 항목이 없으면 안내를 보인다", async () => {
    const host = render({ ...FX07, changes: [] }, width);
    await expect.element(page.getByText("표시할 바뀐 항목이 없습니다")).toBeVisible();
    expect(host.querySelector("table")).toBeNull();
  });

  it("취소 revision 은 취소 띠와 취소됨 줄을 보인다", async () => {
    const host = render(CANCELLED, width);
    await expect
      .element(page.getByText("이 공고는 취소되었습니다. 기존 분석·결정 기록은 보존됩니다"))
      .toBeVisible();
    expect(host.querySelector('[data-slot="revision-cancelled"]')).not.toBeNull();
    const status = host.querySelector('[data-field="status"]');
    expect(status?.textContent).toContain("취소됨");
    expect(status?.textContent).toContain("공고");
  });

  it("목록 항목은 추가·유지를 나눠 보이고 없음은 — 로 둔다", async () => {
    const host = render(LISTS, width);
    const row = host.querySelector('[data-field="attachments"]');
    expect(row?.querySelector("ins")?.textContent).toContain("추가 제안요청서.pdf");
    expect(row?.textContent).toContain("없음");
  });

  it("긴 본문은 접히고 펼치기 버튼이 바뀐 곳은 늘 보인다", async () => {
    const host = render(LONG, width);
    const toggle = page.getByRole("button", { name: "본문 전체 펼치기" });
    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
    const diff = host.querySelector('[data-slot="revision-content-diff"]');
    expect(diff?.querySelectorAll('[data-slot="diff-fold"]').length).toBeGreaterThan(0);
    expect(diff?.querySelector("ins")?.textContent).toContain("바뀐곳");
    const folded = diff?.textContent?.length ?? 0;
    await toggle.click();
    await expect
      .element(page.getByRole("button", { name: "본문 접기" }))
      .toHaveAttribute("aria-expanded", "true");
    expect(diff?.textContent?.length ?? 0).toBeGreaterThan(folded);
    expect(diff?.querySelectorAll('[data-slot="diff-fold"]')).toHaveLength(0);
  });

  it("가로로 넘치지 않는다", async () => {
    const host = render(LONG, width);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  });
});
