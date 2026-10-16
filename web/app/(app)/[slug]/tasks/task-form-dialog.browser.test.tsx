import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { AssigneeOption, TaskListFilters, TaskView, UpdateTaskResult } from "@/server/task";
import { AddTaskButton, TaskDialogsProvider, useTaskDialogs } from "./task-dialogs";

// 작업 추가·편집 대화상자를 진짜 브라우저에 그린다. 서버 함수는 가짜로 바꾸고, 입력 검증·오류 표시·제출 중 상태·닫힌 뒤 초점을 본다.
// 대화상자는 화면과 같은 길(TaskDialogsProvider → 머리의 "작업 추가"·줄의 제목 단추)로 연다.
const { createTask, saveTask, toast } = vi.hoisted(() => ({
  createTask: vi.fn(),
  saveTask: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("./actions", () => ({ createTask, saveTask }));
vi.mock("sonner", () => ({ toast }));

const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const ME_ID = "1f0e2d3c-4b5a-4968-8776-655443322110";
const KIM_ID = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
const MEMBERS: AssigneeOption[] = [
  { id: ME_ID, name: "홍길동", isMe: true },
  { id: KIM_ID, name: "김철수", isMe: false },
];
const DEFAULT_FILTERS: TaskListFilters = { status: null, assignee: null, sort: "created" };

const TASK: TaskView = {
  id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
  title: "디자인 시안 검토",
  description: "첫 화면 시안",
  status: "in_progress",
  statusLabel: "진행 중",
  dueDate: "2026-10-21",
  dueText: "10. 21.",
  dueState: "later",
  assignee: { id: KIM_ID, name: "김철수", isMe: false },
  createdAt: "2026-10-14T06:00:00.000Z",
  createdAtText: "2026. 10. 14. 오후 3:00",
  creatorName: "홍길동",
  isMine: true,
  completedAt: null,
  completedAtText: null,
  canDelete: true,
};

const mounted: Root[] = [];

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

beforeEach(() => {
  createTask.mockReset();
  saveTask.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  // 저장이 한 박자 늦게 끝나 제출 중 상태를 거치게 한다.
  const savedLater = () =>
    new Promise((resolve) => setTimeout(() => resolve({ status: "saved" }), 50));
  createTask.mockImplementation(savedLater);
  saveTask.mockImplementation(savedLater);
});

// 작업 표 자리. 표가 하듯 "작업 목록" 제목을 달고, 줄의 제목 단추처럼 편집 대화상자를 연다.
function TaskListStub({ task }: { task?: TaskView }) {
  const { openEdit, headingRef } = useTaskDialogs();
  return (
    <>
      <h2 ref={headingRef} tabIndex={-1}>
        작업 목록
      </h2>
      <AddTaskButton />
      {task ? (
        <button type="button" onClick={(event) => openEdit(task, event.currentTarget)}>
          {task.title}
        </button>
      ) : null}
    </>
  );
}

const render = ({
  task,
  filters = DEFAULT_FILTERS,
  members = MEMBERS,
}: { task?: TaskView; filters?: TaskListFilters; members?: AssigneeOption[] } = {}) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const draw = (current: AssigneeOption[]) =>
    root.render(
      <TaskDialogsProvider orgId={ORG_ID} teamName="디자인팀" members={current} filters={filters}>
        <TaskListStub task={task} />
      </TaskDialogsProvider>,
    );
  draw(members);
  mounted.push(root);
  // 서버 함수가 화면을 다시 그려 새 멤버 목록이 내려온 것처럼 같은 자리에 다시 그린다(대화상자 상태는 남는다).
  return { redrawWith: draw };
};

// 화면이 몇 프레임 흐르게 둔다. 부품이 효과(effect)에서 값을 바꾸는지 보려면, 바꿀 틈을 준 뒤 재야 한다.
const frames = async (count: number) => {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
};

const openAdd = async () => {
  await page.getByRole("button", { name: "작업 추가", exact: true }).click();
  await expect.element(page.getByRole("dialog", { name: "작업 추가" })).toBeVisible();
};

const openEdit = async (task: TaskView) => {
  await page.getByRole("button", { name: task.title, exact: true }).click();
  await expect.element(page.getByRole("dialog", { name: "작업 편집" })).toBeVisible();
};

const titleInput = () => page.getByRole("textbox", { name: "제목", exact: true });
const descriptionInput = () => page.getByRole("textbox", { name: "설명 (선택)" });
const dueInput = () => page.getByLabelText("마감일", { exact: true });
const submitButton = (name: string) => page.getByRole("button", { name, exact: true });

describe("작업 추가 대화상자", () => {
  it("열면 제목 칸에 초점이 있고, 상태 칸 없이 팀 안내와 '담당자 없음'으로 시작한다", async () => {
    render();
    await openAdd();

    await expect.element(titleInput()).toHaveFocus();
    await expect.element(page.getByText("디자인팀의 멤버 모두에게 보입니다.")).toBeVisible();
    // 새 작업은 "할 일"로 시작한다(디자인 D6-1). 상태는 편집에서 바꾼다.
    await expect.element(page.getByRole("combobox", { name: "상태" })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("combobox", { name: "담당자" }))
      .toHaveTextContent("담당자 없음");
  });

  it("공백뿐인 제목으로 추가하면 서버를 부르지 않고 제목 칸에 오류를 보이며 초점을 옮긴다", async () => {
    render();
    await openAdd();
    await titleInput().fill("   ");
    await submitButton("추가").click();

    await expect.element(page.getByText("제목을 입력하세요")).toBeVisible();
    await expect.element(titleInput()).toHaveAttribute("aria-invalid", "true");
    await expect.element(titleInput()).toHaveFocus();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("제목이 120자를 넘으면 글자 수를 오류 색으로 바꾸고 오류를 보이며 보내지 않는다", async () => {
    render();
    await openAdd();
    const count = page.getByText("120/120");
    await titleInput().fill("가".repeat(120));
    await expect.element(count).toBeVisible();
    const normalColor = getComputedStyle(count.element()).color;

    await titleInput().fill("가".repeat(121));
    await submitButton("추가").click();

    const error = page.getByText("제목은 120자 이하입니다");
    await expect.element(error).toBeVisible();
    const over = page.getByText("121/120");
    await expect.element(over).toBeVisible();
    expect(getComputedStyle(over.element()).color).toBe(getComputedStyle(error.element()).color);
    expect(getComputedStyle(over.element()).color).not.toBe(normalColor);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("설명이 2000자를 넘으면 설명 칸에 오류를 보이고 보내지 않는다", async () => {
    render();
    await openAdd();
    await titleInput().fill("설명이 긴 작업");
    await descriptionInput().fill("나".repeat(2001));
    await submitButton("추가").click();

    await expect.element(page.getByText("설명은 2000자 이하입니다")).toBeVisible();
    await expect.element(descriptionInput()).toHaveAttribute("aria-invalid", "true");
    await expect.element(descriptionInput()).toHaveFocus();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("추가하는 동안 단추가 '추가 중…'으로 꺼지고, 칸은 읽기 전용이며 Esc 로 닫히지 않는다", async () => {
    const pending = Promise.withResolvers<{ status: "saved" }>();
    createTask.mockReturnValue(pending.promise);
    render();
    await openAdd();
    await titleInput().fill("첫 작업");
    await submitButton("추가").click();

    await expect.element(submitButton("추가 중…")).toBeDisabled();
    await expect.element(submitButton("취소")).toBeDisabled();
    await expect.element(titleInput()).toHaveAttribute("readonly");
    await expect.element(descriptionInput()).toHaveAttribute("readonly");
    await expect.element(page.getByRole("combobox", { name: "담당자" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog", { name: "작업 추가" })).toBeVisible();

    pending.resolve({ status: "saved" });
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("작업을 추가했습니다");
  });

  it("고른 담당자와 마감일을 함께 보낸다", async () => {
    render();
    await openAdd();
    await titleInput().fill("  배포 준비  ");
    await page.getByRole("combobox", { name: "담당자" }).click();
    await page.getByRole("option", { name: "김철수" }).click();
    await dueInput().fill("2026-10-21");
    await submitButton("추가").click();

    await expect.poll(() => createTask.mock.calls.length).toBe(1);
    expect(createTask).toHaveBeenCalledWith(ORG_ID, {
      title: "배포 준비",
      description: "",
      assigneeId: KIM_ID,
      dueDate: "2026-10-21",
    });
  });

  it("담당자 목록은 '담당자 없음', 나('(나)'), 다른 멤버 순이다", async () => {
    render();
    await openAdd();
    await page.getByRole("combobox", { name: "담당자" }).click();

    const options = page.getByRole("option").elements();
    expect(options.map((option) => option.textContent)).toEqual([
      "담당자 없음",
      "홍길동 (나)",
      "김철수",
    ]);
  });

  it("마감일을 넣으면 지우기 단추가 생기고, 누르면 칸을 비우고 초점을 마감일 칸으로 옮긴다", async () => {
    render();
    await openAdd();
    const clear = page.getByRole("button", { name: "마감일 지우기" });
    await expect.element(clear).not.toBeInTheDocument();

    await dueInput().fill("2026-10-21");
    await clear.click();

    await expect.element(dueInput()).toHaveValue("");
    await expect.element(dueInput()).toHaveFocus();
    await expect.element(clear).not.toBeInTheDocument();
  });

  it("추가가 성공하면 대화상자가 닫히고 초점이 '작업 추가' 단추로 돌아온다", async () => {
    render();
    await openAdd();
    await titleInput().fill("첫 작업");
    await userEvent.keyboard("{Enter}");

    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "작업 추가", exact: true }))
      .toHaveFocus();
  });

  it("서버가 칸을 거절하면 그 칸에 문구를 보이고 초점을 옮기며 입력값을 남긴다", async () => {
    createTask.mockResolvedValue({
      status: "invalid",
      field: "description",
      message: "설명은 2000자 이하입니다",
    });
    render();
    await openAdd();
    await titleInput().fill("남아야 함");
    await descriptionInput().fill("서버가 거절한 설명");
    await submitButton("추가").click();

    await expect.element(page.getByText("설명은 2000자 이하입니다")).toBeVisible();
    await expect.element(descriptionInput()).toHaveFocus();
    await expect.element(titleInput()).toHaveValue("남아야 함");
    await expect.element(descriptionInput()).toHaveValue("서버가 거절한 설명");
    await expect.element(submitButton("추가")).toBeEnabled();
  });

  it("담당자가 그새 팀을 떠났으면 대화상자를 연 채 담당자 칸에서 다시 고르라고 알린다", async () => {
    createTask.mockResolvedValue({ status: "assignee-not-member" });
    render();
    await openAdd();
    await titleInput().fill("담당자가 떠난 작업");
    await page.getByRole("combobox", { name: "담당자" }).click();
    await page.getByRole("option", { name: "김철수" }).click();
    await submitButton("추가").click();

    await expect
      .element(page.getByText("이 팀의 멤버가 아닙니다. 담당자를 다시 고르세요."))
      .toBeVisible();
    await expect
      .element(page.getByRole("combobox", { name: "담당자" }))
      .toHaveAttribute("aria-invalid", "true");
    await expect.element(page.getByRole("dialog", { name: "작업 추가" })).toBeVisible();
  });

  // 서버 함수는 거절한 뒤 화면을 다시 그린다(actions.ts). 떠난 사람이 빠진 멤버 목록이 오면 Base UI Select 는 목록에 없는 값을
  // 처음 값("담당자 없음")으로 되돌린다. 그러면 칸이 말없이 바뀌고 오류가 지워져, 다시 누르면 담당자 없이 만들어진다.
  // 다른 사람을 고르는 그림에서 떠난 사람을 빼도 Select 가 옛 값을 못 찾아 같은 식으로 되돌린다 — 끝까지 이어서 본다.
  it("담당자가 떠나 거절된 뒤 멤버 목록이 새로 와도, 고른 사람과 오류가 담당자 칸에 남는다", async () => {
    createTask.mockResolvedValueOnce({ status: "assignee-not-member" });
    const { redrawWith } = render();
    await openAdd();
    await titleInput().fill("담당자가 떠난 작업");
    const assignee = page.getByRole("combobox", { name: "담당자" });
    await assignee.click();
    await page.getByRole("option", { name: "김철수" }).click();
    await submitButton("추가").click();
    const error = page.getByText("이 팀의 멤버가 아닙니다. 담당자를 다시 고르세요.");
    await expect.element(error).toBeVisible();

    redrawWith([MEMBERS[0]]);
    await frames(10);

    await expect.element(assignee).toHaveTextContent("김철수");
    await expect.element(assignee).toHaveAttribute("aria-invalid", "true");
    await expect.element(error).toBeVisible();

    // 떠난 사람은 목록 끝에 남지만 다시 고를 수 없다. 다른 사람을 고르면 오류가 지워지고, 고른 사람으로 보낸다.
    await assignee.click();
    await expect
      .element(page.getByRole("option", { name: "김철수" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(
      page
        .getByRole("option")
        .elements()
        .map((option) => option.textContent),
    ).toEqual(["담당자 없음", "홍길동 (나)", "김철수"]);
    await page.getByRole("option", { name: "홍길동 (나)" }).click();
    await frames(10);
    await expect.element(assignee).toHaveTextContent("홍길동 (나)");
    await expect.element(error).not.toBeInTheDocument();

    await submitButton("추가").click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(createTask).toHaveBeenLastCalledWith(ORG_ID, {
      title: "담당자가 떠난 작업",
      description: "",
      assigneeId: ME_ID,
      dueDate: "",
    });
  });

  // 성공하면 대화상자가 닫히는 애니메이션 동안 폼이 잠시 남는다. 그 사이 "추가"가 다시 켜지면 한 번 더 눌려 같은 작업이 둘 생긴다.
  it("추가가 끝나 대화상자가 닫히는 동안 '추가'를 다시 눌러도 한 번만 보낸다", async () => {
    render();
    await openAdd();
    await titleInput().fill("한 번만 추가");
    const dialog = page.getByRole("dialog", { name: "작업 추가" }).element();
    const submit = submitButton("추가").element();
    if (!(submit instanceof HTMLButtonElement)) throw new Error("추가 단추가 button 이 아니다");
    // 닫히기 시작한(data-closed) 뒤 단추가 켜지는 순간 곧바로 한 번 더 누른다 — 사람이 같은 자리를 다시 누르는 경우다.
    let pressedAgain = false;
    const observer = new MutationObserver(() => {
      if (!pressedAgain && dialog.hasAttribute("data-closed") && !submit.disabled) {
        pressedAgain = true;
        submit.click();
      }
    });
    observer.observe(dialog, { attributes: true, subtree: true });

    await submitButton("추가").click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    observer.disconnect();

    expect(createTask).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  // 조직에서 빠졌으면 서버 함수가 화면을 다시 그려 곧바로 404 가 된다. 대화상자 안 문구는 함께 사라지므로 토스트로 알린다.
  it("조직에서 빠졌으면 404 로 바뀐 뒤에도 남는 오류 토스트로 알린다", async () => {
    createTask.mockResolvedValue({ status: "not-in-org" });
    render();
    await openAdd();
    await titleInput().fill("남아야 함");
    await submitButton("추가").click();

    await expect
      .poll(() => toast.error.mock.calls)
      .toEqual([["이 팀의 멤버가 아니어서 저장할 수 없습니다. 화면을 새로 고칩니다."]]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each([
    {
      cause: "로그인 풀림",
      respond: () => createTask.mockResolvedValue({ status: "signed-out" }),
      message: "로그인이 풀렸습니다. 다시 로그인하세요.",
    },
    {
      cause: "네트워크·서버 오류",
      respond: () => createTask.mockRejectedValue(new Error("network")),
      message: "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    },
  ])("$cause 이면 폼 아래에 알리고 입력값을 남긴다", async ({ respond, message }) => {
    respond();
    render();
    await openAdd();
    await titleInput().fill("남아야 함");
    await submitButton("추가").click();

    await expect.element(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
    await expect.element(titleInput()).toHaveValue("남아야 함");
    await expect.element(page.getByRole("dialog", { name: "작업 추가" })).toBeVisible();
    expect(toast.success).not.toHaveBeenCalled();
  });

  // 디자인 Q12: 긴 이름은 칸·항목 안에서 말줄임된다. 칸이 글자만큼 넓어지면 대화상자 밖으로 밀려 잘린다.
  it("긴 멤버 이름은 375px 화면에서 담당자 항목과 칸 안에서 줄고 대화상자 밖으로 넘치지 않는다", async () => {
    await page.viewport(375, 667);
    const longName = "아주아주긴이름을가진멤버".repeat(4);
    const longMember = { id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a", name: longName, isMe: false };
    render({ members: [...MEMBERS, longMember] });
    await openAdd();
    await page.getByRole("combobox", { name: "담당자" }).click();
    const option = page.getByRole("option", { name: longName });
    await expect.element(option).toBeVisible();

    const optionElement = option.element();
    expect(optionElement.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    expect(optionElement.scrollWidth, "항목 글자가 항목 밖으로 넘친다").toBe(
      optionElement.clientWidth,
    );

    await option.click();
    const trigger = page.getByRole("combobox", { name: "담당자" });
    await expect.element(trigger).toHaveTextContent(longName);
    const dialog = page.getByRole("dialog", { name: "작업 추가" }).element();
    const triggerElement = trigger.element();
    expect(
      triggerElement.getBoundingClientRect().right,
      "담당자 칸이 대화상자 오른쪽 끝을 넘는다",
    ).toBeLessThanOrEqual(dialog.getBoundingClientRect().right);
    expect(triggerElement.scrollWidth, "칸 글자가 칸 밖으로 넘친다").toBe(
      triggerElement.clientWidth,
    );
    expect(dialog.scrollWidth, "대화상자가 가로로 스크롤된다").toBe(dialog.clientWidth);
  });
});

describe("작업 편집 대화상자", () => {
  it("열면 지금 값과 상태 칸, 만든 사람 줄을 보이고 팀 안내는 없다", async () => {
    render({ task: TASK });
    await openEdit(TASK);

    await expect.element(titleInput()).toHaveValue("디자인 시안 검토");
    await expect.element(descriptionInput()).toHaveValue("첫 화면 시안");
    await expect.element(page.getByRole("combobox", { name: "상태" })).toHaveTextContent("진행 중");
    await expect
      .element(page.getByRole("combobox", { name: "담당자" }))
      .toHaveTextContent("김철수");
    await expect.element(dueInput()).toHaveValue("2026-10-21");
    await expect
      .element(page.getByText("홍길동 님이 2026. 10. 14. 오후 3:00에 만들었습니다."))
      .toBeVisible();
    await expect
      .element(page.getByText("디자인팀의 멤버 모두에게 보입니다."))
      .not.toBeInTheDocument();
  });

  it("만든 사람이 떠났고 완료된 작업이면 '떠난 멤버가'와 완료 시각을 보인다", async () => {
    const task: TaskView = {
      ...TASK,
      status: "done",
      statusLabel: "완료",
      dueState: "done",
      creatorName: null,
      isMine: false,
      completedAt: "2026-10-15T01:30:00.000Z",
      completedAtText: "2026. 10. 15. 오전 10:30",
    };
    render({ task });
    await openEdit(task);

    await expect
      .element(
        page.getByText(
          "떠난 멤버가 2026. 10. 14. 오후 3:00에 만들었습니다. · 2026. 10. 15. 오전 10:30에 완료",
        ),
      )
      .toBeVisible();
  });

  it("상태를 바꿔 저장하면 상태를 함께 보내고, 저장하는 동안 '저장 중…'으로 꺼진다", async () => {
    const pending = Promise.withResolvers<{ status: "saved" }>();
    saveTask.mockReturnValue(pending.promise);
    render({ task: TASK });
    await openEdit(TASK);
    await page.getByRole("combobox", { name: "상태" }).click();
    await page.getByRole("option", { name: "완료" }).click();
    await submitButton("저장").click();

    await expect.element(submitButton("저장 중…")).toBeDisabled();
    await expect.element(page.getByRole("combobox", { name: "상태" })).toBeDisabled();
    expect(saveTask).toHaveBeenCalledWith(ORG_ID, TASK.id, {
      title: "디자인 시안 검토",
      description: "첫 화면 시안",
      assigneeId: KIM_ID,
      dueDate: "2026-10-21",
      status: "done",
    });

    pending.resolve({ status: "saved" });
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("작업을 저장했습니다");
  });

  it("그새 지워진 작업이면 폼 아래에 알리고 '저장'을 끈다", async () => {
    saveTask.mockResolvedValue({ status: "gone" } satisfies UpdateTaskResult);
    render({ task: TASK });
    await openEdit(TASK);
    await submitButton("저장").click();

    await expect
      .element(
        page
          .getByRole("alert")
          .filter({ hasText: "이 작업은 그사이 지워졌습니다. 목록을 새로 고칩니다." }),
      )
      .toBeVisible();
    await expect.element(submitButton("저장")).toBeDisabled();
    await expect.element(page.getByRole("dialog", { name: "작업 편집" })).toBeVisible();
  });

  it("저장한 작업이 지금 조건에 남으면 초점이 연 단추로 돌아온다", async () => {
    render({ task: TASK, filters: { ...DEFAULT_FILTERS, status: "in_progress" } });
    await openEdit(TASK);
    await submitButton("저장").click();

    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: TASK.title, exact: true })).toHaveFocus();
  });

  it("저장한 작업이 지금 조건에서 빠지면 초점이 '작업 목록' 제목으로 간다", async () => {
    render({ task: TASK, filters: { ...DEFAULT_FILTERS, status: "in_progress" } });
    await openEdit(TASK);
    await page.getByRole("combobox", { name: "상태" }).click();
    await page.getByRole("option", { name: "완료" }).click();
    await submitButton("저장").click();

    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(page.getByRole("heading", { name: "작업 목록" })).toHaveFocus();
  });
});
