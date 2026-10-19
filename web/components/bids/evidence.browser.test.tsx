import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  AttachmentStatus,
  EvidenceDrawer,
  EvidenceList,
  evidenceDetail,
  evidenceLabel,
} from "@/components/bids/evidence-drawer";
import { useEvidenceStore, type EvidenceRef } from "@/components/bids/evidence-store";
import { BID_DOCUMENTS } from "@/components/bids/test-data";

// 근거 목록·첨부 상태·서랍의 위치 라벨과 하이라이트를 진짜 브라우저로 본다.

const mounted: Root[] = [];

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  useEvidenceStore.setState({ open: false, context: null });
});

const render = (node: React.ReactNode) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = "616px";
  const root = createRoot(host);
  flushSync(() => root.render(node));
  mounted.push(root);
  return host;
};

const base = { revisionId: "rev-1", fetchedAt: "2026-10-16T01:00:00Z", match: "EXACT" as const };
const api: EvidenceRef = {
  ...base,
  kind: "API_FIELD",
  documentId: null,
  apiField: "bidQlfctRgstDt",
  apiSource: "나라장터",
  quotedText: "참가자격 등록 마감",
};
const paged: EvidenceRef = {
  ...base,
  kind: "TEXT",
  documentId: "doc-parsed",
  page: 4,
  charStart: 10,
  charEnd: 20,
  quotedText: "ISMS 인증 보유 업체",
};
const body: EvidenceRef = { ...base, kind: "TEXT", documentId: null, quotedText: "본문 근거" };
const attached: EvidenceRef = { ...body, documentId: "doc-partial", quotedText: "첨부 근거" };
const orphan: EvidenceRef = { ...body, documentId: "doc-unknown", quotedText: "모르는 문서" };

describe("위치 라벨 (Ruling 9)", () => {
  it("네 갈래를 가른다", () => {
    expect(evidenceLabel(api, BID_DOCUMENTS)).toBe("API bidQlfctRgstDt");
    expect(evidenceLabel(paged, BID_DOCUMENTS)).toBe("p.4");
    expect(evidenceLabel(body, BID_DOCUMENTS)).toBe("공고 본문");
    expect(evidenceLabel(attached, BID_DOCUMENTS)).toBe("평가기준.pdf");
    expect(evidenceLabel(orphan, BID_DOCUMENTS)).toBe("첨부");
  });

  it("서랍의 자세한 위치도 같은 분기를 쓴다", () => {
    expect(evidenceDetail(api, BID_DOCUMENTS)).toBe("공고 API 필드 bidQlfctRgstDt (나라장터)");
    expect(evidenceDetail(paged, BID_DOCUMENTS)).toBe("공고문.pdf · p.4 · 문자 10–20");
    expect(evidenceDetail(body, BID_DOCUMENTS)).toBe("공고 본문");
    expect(evidenceDetail(orphan, BID_DOCUMENTS)).toBe("첨부");
  });
});

describe("EvidenceList", () => {
  it("행마다 위치 라벨을 보이고 빈 API 라벨이 없다", async () => {
    const host = render(
      <EvidenceList
        title="자격"
        evidence={[api, paged, body, attached]}
        documents={BID_DOCUMENTS}
      />,
    );
    await expect.element(page.getByText("(4건 · 원문 대조 검증 통과)")).toBeVisible();
    const text = host.textContent ?? "";
    for (const label of ["API bidQlfctRgstDt", "p.4", "공고 본문", "평가기준.pdf"]) {
      expect(text).toContain(label);
    }
    expect(text).not.toMatch(/API(?!\s*\S)/);
  });

  it("[열기]는 서랍 store 를 연다", async () => {
    render(<EvidenceList title="자격" evidence={[paged]} documents={BID_DOCUMENTS} />);
    await userEvent.click(page.getByRole("button", { name: /근거 열기/ }));
    expect(useEvidenceStore.getState().open).toBe(true);
    expect(useEvidenceStore.getState().context?.evidence).toEqual([paged]);
  });
});

describe("AttachmentStatus", () => {
  const renderStatus = () =>
    render(<AttachmentStatus documents={BID_DOCUMENTS} sourceUrl="https://example.com/n" />);

  it("내려받기 실패: 09 고정 배지와 코드를 보인다", async () => {
    renderStatus();
    await expect.element(page.getByText("첨부를 내려받지 못했습니다")).toBeVisible();
    await expect.element(page.getByText("DOCUMENT_DOWNLOAD_FAILED HTTP_5XX")).toBeVisible();
  });

  it("읽기 불가: 배지·안내·parseErrorCode·원문 보기 링크", async () => {
    renderStatus();
    await expect
      .element(page.getByText("첨부를 읽지 못했습니다. 원문을 직접 확인하세요"))
      .toBeVisible();
    await expect.element(page.getByText("UNSUPPORTED_FORMAT")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "원문 보기" }))
      .toHaveAttribute("href", "https://example.com/n");
  });

  it("실패 2종은 `첨부 원문 확인`, PARTIAL 은 `일부만 읽음`, PARSED 는 배지 없음", async () => {
    const host = renderStatus();
    const rows = Array.from(host.querySelectorAll("li"));
    const rowOf = (name: string) => rows.find((row) => row.textContent?.includes(name))!;
    expect(rowOf("제안요청서.pdf").textContent).toContain("첨부 원문 확인");
    expect(rowOf("과업지시서.hwp").textContent).toContain("첨부 원문 확인");
    expect(rowOf("평가기준.pdf").textContent).toContain("일부만 읽음");
    expect(rowOf("평가기준.pdf").textContent).toContain("근거 없는 항목은 확인 필요로 남습니다");
    const parsed = rowOf("공고문.pdf").textContent ?? "";
    expect(parsed).toContain("PDF · 5쪽");
    expect(parsed).not.toContain("첨부 원문 확인");
    expect(parsed).not.toContain("일부만 읽음");
  });
});

describe("본문 하이라이트", () => {
  it("앞뒤 200자를 자르면 양쪽에 …를 붙이고 mark 는 인용 부분이다", async () => {
    await page.viewport(1280, 800);
    const quote = "신고 업체";
    const content = `${"가".repeat(300)}${quote}${"나".repeat(300)}`;
    render(<EvidenceDrawer content={content} sourceUrl="https://example.com/n" documents={[]} />);
    useEvidenceStore.getState().openWith({
      title: "소프트웨어사업자",
      evidence: [{ ...body, quotedText: quote, charStart: 300, charEnd: 305 }],
    });
    const mark = await vi.waitFor(() => {
      const found = document.querySelector("mark");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(mark.textContent).toBe(quote);
    const excerpt = mark.parentElement?.textContent ?? "";
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).toBe(`…${"가".repeat(200)}${quote}${"나".repeat(200)}…`);
  });

  it("본문이 짧으면 …가 없다", async () => {
    await page.viewport(1280, 800);
    render(
      <EvidenceDrawer
        content="짧은 신고 업체 본문"
        sourceUrl="https://example.com/n"
        documents={[]}
      />,
    );
    useEvidenceStore.getState().openWith({
      title: "x",
      evidence: [{ ...body, quotedText: "신고 업체" }],
    });
    const mark = await vi.waitFor(() => {
      const found = document.querySelector("mark");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(mark.parentElement?.textContent).toBe("짧은 신고 업체 본문");
  });
});
