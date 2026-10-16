import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// 대화상자가 휴대폰 높이에서 잘리지 않는지 진짜 브라우저 레이아웃으로 잰다.
// 클래스 이름이 아니라 그려진 위치를 보므로, 높이 제한·내부 스크롤·초점 처리가 빠지면 여기서 실패한다.

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 667 },
  { width: 667, height: 375 },
  { width: 1280, height: 800 },
];

const mounted: Root[] = [];

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

const render = (node: React.ReactNode) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  root.render(node);
  mounted.push(root);
};

function TestDialog({ paragraphs }: { paragraphs: number }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>열기</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>대화상자 제목</DialogTitle>
          <DialogDescription>내용 길이를 바꿔 가며 잰다.</DialogDescription>
        </DialogHeader>
        {Array.from({ length: paragraphs }, (_, index) => (
          <p key={index}>문단 {index + 1}: 화면 높이를 넘길 만큼 긴 내용을 채우는 문장입니다.</p>
        ))}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <DialogClose render={<Button />}>마지막 버튼</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const openDialog = async () => {
  await page.getByRole("button", { name: "열기" }).click();
  await expect.element(page.getByRole("dialog")).toBeVisible();
  // 여는 애니메이션(zoom-in)이 끝난 뒤 잰다
  await Promise.all(document.getAnimations().map((animation) => animation.finished));
  return page.getByRole("dialog").element();
};

const boxOf = (element: Element) => {
  const { top, bottom, left, right } = element.getBoundingClientRect();
  return { top, bottom, left, right, viewport: [window.innerWidth, window.innerHeight] };
};

const insideViewport = (element: Element) => {
  const box = element.getBoundingClientRect();
  return (
    box.top >= 0 &&
    box.left >= 0 &&
    box.bottom <= window.innerHeight &&
    box.right <= window.innerWidth
  );
};

// 화면 안에 있고, 그 가운데를 누르면 다른 것에 가리지 않고 이 요소가 눌린다
const reachable = (element: Element) => {
  const box = element.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return insideViewport(element) && hit !== null && element.contains(hit);
};

describe("DialogContent", () => {
  it.each(VIEWPORTS)(
    "긴 내용도 $width×$height 화면 안에 들어오고 제목·닫기·마지막 버튼에 닿는다",
    async ({ width, height }) => {
      await page.viewport(width, height);
      render(<TestDialog paragraphs={30} />);
      const popup = await openDialog();

      expect(insideViewport(popup), JSON.stringify(boxOf(popup))).toBe(true);
      expect(popup.scrollHeight).toBeGreaterThan(popup.clientHeight);

      // 열자마자 위쪽(제목·닫기 버튼)이 보인다. 하단 버튼으로 초점이 가며 끝까지 스크롤되지 않는다
      const title = page.getByRole("heading", { name: "대화상자 제목" }).element();
      expect(reachable(title), JSON.stringify(boxOf(title))).toBe(true);
      const close = page.getByRole("button", { name: "Close" }).element();
      expect(reachable(close), JSON.stringify(boxOf(close))).toBe(true);

      // 바깥 스크롤은 잠겨 있다. 팝업 위에서 휠을 굴려 마지막 버튼까지 닿는다
      await userEvent.wheel(popup, { delta: { y: 400 }, times: 10 });
      const last = page.getByRole("button", { name: "마지막 버튼" }).element();
      await expect.poll(() => reachable(last), { timeout: 2000 }).toBe(true);

      await userEvent.click(last);
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it("짧은 내용은 스크롤 없이 가운데 뜨고 첫 버튼에 초점이 간다", async () => {
    await page.viewport(1280, 800);
    render(<TestDialog paragraphs={2} />);
    const popup = await openDialog();
    const box = popup.getBoundingClientRect();

    expect(popup.scrollHeight).toBe(popup.clientHeight);
    expect(Math.abs(box.top + box.height / 2 - window.innerHeight / 2)).toBeLessThanOrEqual(1);
    expect(document.activeElement?.textContent).toBe("취소");
  });
});
