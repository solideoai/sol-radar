import { createRoot, type Root } from "react-dom/client";
import { AccountLink } from "@/app/auth/account-card";
import type { ComponentProps } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ onNavigate, ...props }: ComponentProps<"a"> & { onNavigate?: () => void }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.();
      }}
    />
  ),
}));
import { StateRetry } from "./state-retry";

let root: Root;
let host: HTMLDivElement;
let completeRefresh: () => void;
let response: Promise<void>;
beforeEach(async () => {
  await page.viewport(1280, 900);
  response = new Promise<void>((resolve) => {
    completeRefresh = resolve;
  });
  refresh.mockReset().mockReturnValue(response);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  completeRefresh();
  root.unmount();
  host.remove();
});

for (const failed of [false, true]) {
  it(`keyboard retry preserves focus after asynchronous same-state completion (failed=${failed})`, async () => {
    root.render(<StateRetry failed={failed} />);
    const label = failed ? "다시 시도" : "다시 확인";
    const retry = page.getByRole("button", { name: label });
    await expect.element(retry).toBeVisible();
    const button = retry.element();
    if (!(button instanceof HTMLButtonElement)) throw new Error("Retry must be a button");
    button.focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(button).toHaveTextContent("확인 중…");
    await expect.element(button).toHaveAttribute("aria-disabled", "true");
    await expect.element(button).toHaveFocus();
    expect(refresh).toHaveBeenCalledOnce();

    // The server response stays unresolved while repeated activations arrive.
    await userEvent.keyboard("{Enter}{Space}");
    button.click();
    expect(refresh).toHaveBeenCalledOnce();
    completeRefresh();
    await expect.element(retry).toBeEnabled();
    await expect.element(retry).toHaveAttribute("aria-disabled", "false");
    await expect.element(retry).toHaveFocus();
    expect(refresh).toHaveBeenCalledOnce();
  });
}

it("an account exit remains keyboard accessible and late retry completion cannot reclaim focus", async () => {
  root.render(
    <>
      <StateRetry />
      <AccountLink href="/auth/account" onNavigate={() => root.render(<button>계정 저장</button>)}>
        계정 관리
      </AccountLink>
    </>,
  );
  const retry = page.getByRole("button", { name: "다시 확인" });
  await expect.element(retry).toBeVisible();
  const button = retry.element();
  if (!(button instanceof HTMLButtonElement)) throw new Error("Retry must be a button");
  button.focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(button).toHaveTextContent("확인 중…");
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("link", { name: "계정 관리" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  const account = page.getByRole("button", { name: "계정 저장" });
  await expect.element(account).toBeVisible();
  const destination = account.element();
  if (!(destination instanceof HTMLButtonElement)) throw new Error("Destination must be a button");
  destination.focus();
  completeRefresh();
  await response;
  await expect.element(account).toHaveFocus();
  await expect.element(page.getByRole("button", { name: "다시 확인" })).not.toBeInTheDocument();
  expect(refresh).toHaveBeenCalledOnce();
});
