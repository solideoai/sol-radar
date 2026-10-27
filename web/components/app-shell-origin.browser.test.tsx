import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { AppShell } from "./app-shell";

// 발표 북마크(/dashboard?origin=demo)에서 공고 상세를 거쳐도 사이드바 링크가 DEMO 출처를 이어 가는지(nav-origin).
// 주소 읽기 → 기억 → 링크 주소까지 실제 사이드바를 그려 본다. 규칙의 경우 나누기는 nav-origin.test.ts 가 맡는다.

const nav = vi.hoisted(() => ({ pathname: "/dashboard", search: "" }));

vi.mock("next/navigation", () => ({
  __esModule: true,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@/lib/supabase-browser", () => ({ getSupabaseBrowser: vi.fn() }));

const user = { name: "이영업", email: null, avatarUrl: null, isAdmin: false };
const workspace = {
  current: {
    id: "org-1",
    slug: "solideo",
    name: "솔리데오",
    isPersonal: false,
    myRole: "member" as const,
  },
  orgs: [],
  pendingInvitationCount: 0,
};

const mounted: Root[] = [];
const host = () => {
  const existing = mounted[0];
  if (existing !== undefined) return existing;
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push(root);
  return root;
};

function show(pathname: string, search: string) {
  nav.pathname = pathname;
  nav.search = search;
  flushSync(() =>
    host().render(
      <AppShell user={user} workspace={workspace} solRole="SALES" defaultSidebarOpen>
        <main />
      </AppShell>,
    ),
  );
}

const menuLink = (name: string) =>
  page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link", { name, exact: true });

// 1280 미만은 사이드바가 서랍으로 들어가 링크가 그려지지 않는다(지원 폭은 1280 이상, D25).
beforeEach(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  for (const root of mounted.splice(0)) root.unmount();
  document.body.replaceChildren();
});

describe("사이드바 출처 이어 가기", () => {
  it("DEMO 대시보드에서 공고 상세로 가도 출처 목록 화면 링크가 DEMO 를 이어 가고, 출처 없는 목록에서 풀린다", async () => {
    show("/dashboard", "origin=demo");
    await expect.element(menuLink("입찰 공고")).toHaveAttribute("href", "/bids?origin=demo");
    await expect.element(menuLink("관심 공고")).toHaveAttribute("href", "/watchlist?origin=demo");
    await expect.element(menuLink("입찰 프로젝트")).toHaveAttribute("href", "/projects");

    show("/bids/6b1d6d1e", "");
    await expect.element(menuLink("대시보드")).toHaveAttribute("href", "/dashboard?origin=demo");

    show("/bids", "");
    await expect.element(menuLink("대시보드")).toHaveAttribute("href", "/dashboard");
  });
});
