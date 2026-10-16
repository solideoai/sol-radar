import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type {
  AssigneeOption,
  ChangeTaskStatusResult,
  DeleteTaskResult,
  TaskListFilters,
  TaskListPage,
  TaskView,
} from "@/server/task";
import { TaskDialogsProvider } from "./task-dialogs";
import { TaskList } from "./task-list";

// 작업 표의 상태 메뉴 단추와 관리("⋯") 메뉴를 진짜 브라우저에 그린다. 서버 함수와 화면 이동은 가짜로 바꾼다.
// 좁은 카드에서 상태 글자를 숨기는 것(@container)은 진짜 레이아웃으로 잰다.
const { changeStatus, removeTask, createTask, saveTask, router, toast } = vi.hoisted(() => ({
  changeStatus: vi.fn(),
  removeTask: vi.fn(),
  createTask: vi.fn(),
  saveTask: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("./actions", () => ({ changeStatus, removeTask, createTask, saveTask }));
// next 의 모듈은 CommonJS 라 Vite 가 기본 내보내기로 감싸 부르기도 한다. 어느 쪽으로 불려도 맞도록 __esModule 을 둔다.
// 링크는 누르지 않는다(이동은 router.push 가짜가 받는다). 주소만 그린다.
vi.mock("next/navigation", () => ({ __esModule: true, useRouter: () => router }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, className, children }: React.ComponentProps<"a">) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast }));

const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const ME_ID = "1f0e2d3c-4b5a-4968-8776-655443322110";
const KIM_ID = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
const MEMBERS: AssigneeOption[] = [
  { id: ME_ID, name: "홍길동", isMe: true },
  { id: KIM_ID, name: "김철수", isMe: false },
];
const DEFAULT_FILTERS: TaskListFilters = { status: null, assignee: null, sort: "created" };

const taskOf = (overrides: Partial<TaskView> & Pick<TaskView, "id" | "title">): TaskView => ({
  description: null,
  status: "in_progress",
  statusLabel: "진행 중",
  dueDate: null,
  dueText: null,
  dueState: "none",
  assignee: null,
  createdAt: "2026-10-14T06:00:00.000Z",
  createdAtText: "2026. 10. 14. 오후 3:00",
  creatorName: "홍길동",
  isMine: true,
  completedAt: null,
  completedAtText: null,
  canDelete: true,
  ...overrides,
});

// 내가 만든 작업(지울 수 있다)과 남이 만든 작업(member 라 지울 수 없다).
const MINE = taskOf({ id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f", title: "디자인 시안 검토" });
const OTHERS = taskOf({
  id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a",
  title: "배포 일정 정리",
  status: "todo",
  statusLabel: "할 일",
  creatorName: "김철수",
  isMine: false,
  canDelete: false,
});

const listOf = (rows: TaskView[], filters: TaskListFilters = DEFAULT_FILTERS): TaskListPage => ({
  rows,
  total: rows.length,
  page: 1,
  pageCount: 1,
  pageSize: 20,
  filters,
  isDefaultQuery:
    filters.status === null && filters.assignee === null && filters.sort === "created",
  members: MEMBERS,
  today: "2026-10-14",
});

const mounted: Root[] = [];

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

beforeEach(() => {
  [changeStatus, removeTask, createTask, saveTask, router.push, router.refresh].forEach((fn) =>
    fn.mockReset(),
  );
  toast.success.mockReset();
  toast.error.mockReset();
  changeStatus.mockResolvedValue({ status: "saved" } satisfies ChangeTaskStatusResult);
});

const render = (list: TaskListPage) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  root.render(
    <TaskDialogsProvider
      orgId={ORG_ID}
      teamName="디자인팀"
      members={list.members}
      filters={list.filters}
    >
      <TaskList slug="acme" orgId={ORG_ID} isPersonal={false} list={list} />
    </TaskDialogsProvider>,
  );
  mounted.push(root);
};

const statusButton = (task: TaskView) =>
  page.getByRole("button", { name: `${task.title} 상태: ${task.statusLabel}`, exact: true });

describe("상태 메뉴 단추", () => {
  it.each([
    { width: 375, showsLabel: false, shows: "아이콘만" },
    { width: 1280, showsLabel: true, shows: "아이콘과 글자" },
  ])(
    "$width px 화면에서 상태 단추는 $shows 보이고, 이름에는 늘 제목과 상태가 있다",
    async ({ width, showsLabel }) => {
      await page.viewport(width, 800);
      render(listOf([MINE]));
      const button = statusButton(MINE);
      await expect.element(button).toBeVisible();

      const label = button.getByText("진행 중", { exact: true });
      if (showsLabel) await expect.element(label).toBeVisible();
      else await expect.element(label).not.toBeVisible();
      // 좁은 단에서도 단추가 표 밖으로 밀리지 않는다.
      const table = page.getByRole("table").element().getBoundingClientRect();
      expect(button.element().getBoundingClientRect().right).toBeLessThanOrEqual(table.right);
      expect(document.documentElement.scrollWidth).toBe(document.documentElement.clientWidth);
    },
  );

  it("메뉴에 '상태' 묶음의 세 항목이 있고 지금 상태가 선택돼 있다", async () => {
    render(listOf([MINE]));
    await statusButton(MINE).click();

    const group = page.getByRole("menu").getByRole("group", { name: "상태" });
    await expect.element(group).toBeVisible();
    const items = group.getByRole("menuitemradio");
    expect(items.elements().map((item) => item.textContent)).toEqual(["할 일", "진행 중", "완료"]);
    await expect
      .element(page.getByRole("menuitemradio", { name: "진행 중" }))
      .toHaveAttribute("aria-checked", "true");
  });

  it("다른 상태를 고르면 바로 저장하고, 끝날 때까지 그 줄의 상태 단추만 끄며 초점을 지킨다", async () => {
    const pending = Promise.withResolvers<ChangeTaskStatusResult>();
    changeStatus.mockReturnValue(pending.promise);
    render(listOf([MINE, OTHERS]));
    await statusButton(MINE).click();
    await page.getByRole("menuitemradio", { name: "완료" }).click();

    expect(changeStatus).toHaveBeenCalledWith(ORG_ID, MINE.id, "done");
    await expect.element(statusButton(MINE)).toHaveAttribute("aria-disabled", "true");
    await expect.element(statusButton(MINE)).toHaveFocus();
    await expect.element(statusButton(OTHERS)).not.toHaveAttribute("aria-disabled", "true");

    pending.resolve({ status: "saved" });
    await expect.element(statusButton(MINE)).not.toHaveAttribute("aria-disabled", "true");
    expect(toast.success).toHaveBeenCalledWith("상태를 완료로 바꿨습니다");
  });

  it("지금 상태를 다시 고르면 아무것도 보내지 않는다", async () => {
    render(listOf([MINE]));
    await statusButton(MINE).click();
    await page.getByRole("menuitemradio", { name: "진행 중" }).click();

    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    expect(changeStatus).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each([
    {
      cause: "그새 지워짐",
      respond: () => changeStatus.mockResolvedValue({ status: "gone" }),
      message: "이 작업은 그사이 지워졌습니다. 목록을 새로 고칩니다.",
    },
    {
      cause: "조직에서 빠짐",
      respond: () => changeStatus.mockResolvedValue({ status: "not-in-org" }),
      message: "이 팀의 멤버가 아니어서 저장할 수 없습니다. 화면을 새로 고칩니다.",
    },
    {
      cause: "네트워크·서버 오류",
      respond: () => changeStatus.mockRejectedValue(new Error("network")),
      message: "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    },
  ])("$cause 이면 오류 토스트로 알리고 단추를 다시 켠다", async ({ respond, message }) => {
    respond();
    render(listOf([MINE]));
    await statusButton(MINE).click();
    await page.getByRole("menuitemradio", { name: "완료" }).click();

    await expect.poll(() => toast.error.mock.calls).toEqual([[message]]);
    await expect.element(statusButton(MINE)).not.toHaveAttribute("aria-disabled", "true");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("상태로 거르는 중에 그 조건에서 빠지는 상태로 바꾸면 초점이 '작업 목록' 제목으로 간다", async () => {
    render(listOf([MINE], { ...DEFAULT_FILTERS, status: "in_progress" }));
    await statusButton(MINE).click();
    await page.getByRole("menuitemradio", { name: "완료" }).click();

    await expect.poll(() => toast.success.mock.calls.length).toBe(1);
    await expect.element(page.getByRole("heading", { name: "작업 목록" })).toHaveFocus();
  });
});

describe("관리 메뉴", () => {
  it.each([
    { task: MINE, items: ["편집", "삭제"] },
    { task: OTHERS, items: ["편집"] },
  ])("$task.title 의 관리 메뉴 항목은 $items 이다", async ({ task, items }) => {
    render(listOf([MINE, OTHERS]));
    await page.getByRole("button", { name: `${task.title} 관리`, exact: true }).click();

    await expect.element(page.getByRole("menuitem", { name: "편집" })).toBeVisible();
    const shown = page.getByRole("menuitem").elements();
    expect(shown.map((item) => item.textContent)).toEqual(items);
  });

  // 조직에서 빠졌으면 서버 함수가 화면을 다시 그려 곧바로 404 가 된다. 대화상자 안 문구는 함께 사라지므로 토스트로 알린다.
  it("삭제하려는데 조직에서 빠졌으면 404 로 바뀐 뒤에도 남는 오류 토스트로 알린다", async () => {
    removeTask.mockResolvedValue({ status: "not-in-org" } satisfies DeleteTaskResult);
    render(listOf([MINE]));
    await page.getByRole("button", { name: `${MINE.title} 관리`, exact: true }).click();
    await page.getByRole("menuitem", { name: "삭제" }).click();
    await page
      .getByRole("dialog", { name: "작업을 삭제할까요?" })
      .getByRole("button", { name: "삭제", exact: true })
      .click();

    await expect
      .poll(() => toast.error.mock.calls)
      .toEqual([["이 팀의 멤버가 아니어서 삭제할 수 없습니다. 화면을 새로 고칩니다."]]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("'편집'으로 연 대화상자를 취소로 닫으면 초점이 관리 단추로 돌아온다", async () => {
    render(listOf([MINE]));
    const manage = page.getByRole("button", { name: `${MINE.title} 관리`, exact: true });
    await manage.click();
    await page.getByRole("menuitem", { name: "편집" }).click();
    await expect.element(page.getByRole("dialog", { name: "작업 편집" })).toBeVisible();

    await page.getByRole("button", { name: "취소", exact: true }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(manage).toHaveFocus();
  });
});
