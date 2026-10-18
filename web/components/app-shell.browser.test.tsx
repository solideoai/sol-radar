import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { AppShell } from "./app-shell";
const { navigation } = vi.hoisted(() => ({
  navigation: { pathname: "/people", push: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  __esModule: true,
  usePathname: () => navigation.pathname,
  useRouter: () => navigation,
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
const mounted: Root[] = [];
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});
describe("people navigation", () => {
  it.each([1280, 1440])(
    "adds one absolute people link and keeps existing organization paths at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      const root = createRoot(document.body.appendChild(document.createElement("div")));
      mounted.push(root);
      root.render(
        <AppShell
          user={{ name: "사용자", email: null, avatarUrl: null, isAdmin: false }}
          workspace={{
            current: {
              id: "org",
              slug: "solideo",
              name: "솔리데오",
              isPersonal: false,
              myRole: "member",
            },
            orgs: [],
            pendingInvitationCount: 0,
          }}
          defaultSidebarOpen
        >
          <main>본문</main>
        </AppShell>,
      );
      const people = page.getByRole("link", { name: "조직·인력", exact: true });
      await expect.element(people).toBeVisible();
      await expect.element(people).toHaveAttribute("href", "/people");
      await expect.element(people).toHaveAttribute("aria-current", "page");
      await expect
        .element(page.getByRole("link", { name: "대시보드", exact: true }))
        .toHaveAttribute("href", "/solideo/dashboard");
      await expect
        .element(page.getByRole("link", { name: "작업", exact: true }))
        .toHaveAttribute("href", "/solideo/tasks");
      expect(document.querySelector("header")?.textContent).toContain("조직·인력");
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    },
  );
  it("places organization chart in a separated footer above the user menu and names its topbar", async () => {
    navigation.pathname = "/org-chart";
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    mounted.push(root);
    root.render(
      <AppShell
        user={{ name: "사용자", email: null, avatarUrl: null, isAdmin: false }}
        workspace={{
          current: {
            id: "org",
            slug: "solideo",
            name: "솔리데오",
            isPersonal: false,
            myRole: "member",
          },
          orgs: [],
          pendingInvitationCount: 0,
        }}
        defaultSidebarOpen
      >
        <main>본문</main>
      </AppShell>,
    );
    const link = page.getByRole("link", { name: "조직도", exact: true });
    await expect.element(link).toHaveAttribute("href", "/org-chart");
    await expect.element(link).toHaveAttribute("aria-current", "page");
    const footer = link.element().closest('[data-slot="sidebar-footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.querySelector('[data-slot="separator"]')).not.toBeNull();
    const user = page.getByRole("button", { name: /사용자 메뉴/ }).element();
    expect(
      link.element().compareDocumentPosition(user) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.querySelector("header")?.textContent).toContain("조직도");
    await expect
      .element(page.getByRole("link", { name: "조직·인력", exact: true }))
      .toHaveAttribute("href", "/people");
    navigation.pathname = "/people";
  });
});
