import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { DemoBadge, StatusBadge } from "@/components/bids/status-badge";

// 상태 배지를 진짜 브라우저로 잰다. 높이 20px, 아이콘은 aria-hidden, 툴팁은 초점으로 열린다.

const mounted: Root[] = [];

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

const render = (node: React.ReactNode) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  root.render(node);
  mounted.push(root);
  return host;
};

describe("StatusBadge", () => {
  it("NO_BID 권고는 NO-BID 글자, destructive 색, 숨긴 아이콘 1개를 보인다", async () => {
    const host = render(<StatusBadge kind="recommendation" value="NO_BID" />);
    await expect.element(page.getByText("NO-BID")).toBeInTheDocument();
    const badge = host.firstElementChild as HTMLElement;
    expect(badge.className).toContain("text-destructive");
    expect(badge.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
  });

  it("발주계획 단계 사유의 확인 필요는 해당 없음으로 보인다", async () => {
    render(
      <StatusBadge kind="qualification" value="NEEDS_REVIEW" reasonCode="STAGE_NOT_APPLICABLE" />,
    );
    await expect.element(page.getByText("해당 없음")).toBeInTheDocument();
  });

  it("그 밖의 확인 필요는 확인 필요로 보인다", async () => {
    render(<StatusBadge kind="qualification" value="NEEDS_REVIEW" reasonCode="AMBIGUOUS_MATCH" />);
    await expect.element(page.getByText("확인 필요")).toBeInTheDocument();
  });

  it("배지 높이는 20px, inline 은 테두리가 없다", async () => {
    const host = render(
      <>
        <StatusBadge kind="analysis" value="COMPLETED" />
        <StatusBadge kind="analysis" value="COMPLETED" variant="inline" />
      </>,
    );
    await expect.element(page.getByText("완료").first()).toBeInTheDocument();
    const [badge, inline] = Array.from(host.children) as HTMLElement[];
    expect(badge.getBoundingClientRect().height).toBe(20);
    expect(getComputedStyle(badge).borderTopWidth).toBe("1px");
    expect(getComputedStyle(inline).borderTopWidth).toBe("0px");
  });

  it("결정 없음은 미결정, 취소 공고는 취소됨, 코드는 showCode 일 때만 보인다", async () => {
    render(
      <>
        <StatusBadge kind="decision" value={null} />
        <StatusBadge kind="bidStatus" value="CANCELLED" />
        <StatusBadge kind="flag" value="CITATION_FAILED" showCode />
      </>,
    );
    await expect.element(page.getByText("미결정")).toBeInTheDocument();
    await expect.element(page.getByText("취소됨")).toBeInTheDocument();
    await expect.element(page.getByText("인용 대조 실패")).toBeInTheDocument();
    await expect.element(page.getByText("CITATION_FAILED")).toBeInTheDocument();
  });

  it("진행 중이 아닌 공고 상태는 아무것도 그리지 않는다", () => {
    const host = render(<StatusBadge kind="bidStatus" value="OPEN" />);
    expect(host.childElementCount).toBe(0);
  });
});

describe("DemoBadge", () => {
  it("툴팁 없이도 DEMO 칩은 초점을 받지 않는다", async () => {
    const host = render(<DemoBadge />);
    await expect.element(page.getByText("DEMO")).toBeInTheDocument();
    expect((host.firstElementChild as HTMLElement).tabIndex).toBe(-1);
  });

  it("withTooltip 은 초점을 받고 초점이 오면 09 고정 문구를 보인다", async () => {
    const host = render(<DemoBadge withTooltip />);
    await expect.element(page.getByText("DEMO")).toBeInTheDocument();
    const chip = host.querySelector<HTMLElement>('[data-slot="tooltip-trigger"]');
    expect(chip?.tabIndex).toBe(0);
    await userEvent.tab();
    expect(document.activeElement).toBe(chip);
    await expect
      .element(page.getByText("이 데이터는 데모용 가상 공고입니다. 실제 입찰 공고가 아닙니다."))
      .toBeInTheDocument();
  });
});
