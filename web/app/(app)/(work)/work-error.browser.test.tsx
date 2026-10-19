import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { WorkError } from "./work-error";

// 업무 화면 오류 경계(error.tsx)가 그리는 공용 오류 부품. 기록은 reportBrowserError 가 맡으므로 콘솔만 막는다.
const mounted: Root[] = [];
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const render = (error: Error & { digest?: string }, retry = vi.fn()) => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  flushSync(() => root.render(<WorkError error={error} retry={retry} title="입찰 공고" />));
  mounted.push(root);
  return retry;
};

const withDigest = (message: string, digest?: string): Error & { digest?: string } =>
  Object.assign(new Error(message), digest === undefined ? {} : { digest });

describe("WorkError", () => {
  it("화면 제목·오류 제목·서버 메시지·오류 ID 를 보인다", async () => {
    render(withDigest("커서 서명 설정이 올바르지 않습니다", "abc123"));
    await expect.element(page.getByRole("heading", { level: 1, name: "입찰 공고" })).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "불러오지 못했습니다" })).toBeVisible();
    await expect.element(page.getByText("커서 서명 설정이 올바르지 않습니다")).toBeVisible();
    await expect.element(page.getByText("오류 ID abc123")).toBeVisible();
  });

  it("[다시 시도]를 누르면 retry 가 한 번 불린다", async () => {
    const retry = render(withDigest("x", "abc123"));
    await page.getByRole("button", { name: "다시 시도" }).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("digest 가 없으면 오류 ID 줄을 그리지 않는다", async () => {
    render(withDigest("목록을 읽지 못했습니다"));
    await expect.element(page.getByText("목록을 읽지 못했습니다")).toBeVisible();
    expect(page.getByText(/오류 ID/).query()).toBeNull();
  });

  it("운영 빌드가 가린 영어 메시지 대신 한국어 안내를 보인다", async () => {
    render(
      withDigest(
        "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error.",
        "9f8e7d",
      ),
    );
    await expect
      .element(page.getByText("화면 데이터를 읽는 중에 오류가 났습니다. 잠시 뒤 다시 시도하세요."))
      .toBeVisible();
    expect(page.getByText(/omitted in production/).query()).toBeNull();
    await expect.element(page.getByText("오류 ID 9f8e7d")).toBeVisible();
  });
});
