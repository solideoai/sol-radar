import { create } from "zustand";

// 사이드바 묶음 접힘 상태. 보는 사람 브라우저(localStorage)에만 두는 편의 상태다(06 §4.1, 설계 M9).
// 저장소를 읽거나 쓰지 못해도(사생활 보호 창·차단) 지금 창에서는 접고 펴기가 그대로 된다.
const STORAGE_KEY = "sol-radar.sidebar.collapsed-groups";

export const parseCollapsedGroups = (raw: string | null): string[] => {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((id: unknown): id is string => typeof id === "string")
      : [];
  } catch {
    // 손상된 값은 처음 상태(모두 펼침)로 본다.
    return [];
  }
};

export const toggleGroup = (collapsed: readonly string[], id: string): readonly string[] =>
  collapsed.includes(id) ? collapsed.filter((groupId) => groupId !== id) : [...collapsed, id];

// 바뀔 것이 없으면 같은 배열을 돌려준다 — 부르는 쪽이 저장·다시 그리기를 건너뛴다.
export const revealGroup = (collapsed: readonly string[], id: string | null): readonly string[] =>
  id !== null && collapsed.includes(id) ? collapsed.filter((groupId) => groupId !== id) : collapsed;

const readStored = (): readonly string[] => {
  try {
    return parseCollapsedGroups(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // 저장소 접근 자체가 막혔다. 모두 펼친 상태로 시작한다.
    return [];
  }
};

const writeStored = (collapsed: readonly string[]) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
  } catch {
    // 저장하지 못해도 지금 창의 상태는 store 가 들고 있다. 다음 방문 때 모두 펼친 상태로 돌아갈 뿐이다.
  }
};

type SidebarGroupsState = {
  collapsed: readonly string[];
  isLoaded: boolean;
};

type SidebarGroupsActions = {
  // 저장값을 처음 한 번 읽고, 지금 화면의 묶음을 펼친다. 서버 렌더와 첫 그림은 모두 펼친 상태라 하이드레이션이 어긋나지 않는다.
  enter: (currentGroupId: string | null) => void;
  toggle: (id: string) => void;
};

export const useSidebarGroupsStore = create<SidebarGroupsState & SidebarGroupsActions>()(
  (set, get) => ({
    collapsed: [],
    isLoaded: false,
    enter: (currentGroupId) => {
      const { collapsed, isLoaded } = get();
      const loaded = isLoaded ? collapsed : readStored();
      const next = revealGroup(loaded, currentGroupId);
      if (next !== loaded) writeStored(next);
      if (!isLoaded || next !== collapsed) set({ collapsed: next, isLoaded: true });
    },
    toggle: (id) => {
      const next = toggleGroup(get().collapsed, id);
      writeStored(next);
      set({ collapsed: next });
    },
  }),
);
