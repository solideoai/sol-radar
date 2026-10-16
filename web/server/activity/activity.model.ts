import "server-only";
import type { Tables } from "@/lib/database.types";
import { nameOf } from "@/server/shared";

// ── 모델: 순수 타입과 규칙. 저장·화면을 모른다 ──

export const ACTIVITY_KINDS = [
  "task_created",
  "task_completed",
  "task_reopened",
  "task_assigned",
  "task_unassigned",
  "task_deleted",
  "member_joined",
  "member_role_changed",
  "member_left",
  "member_removed",
  "invitation_sent",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const RECENT_ACTIVITY_COUNT = 10;

// task_title·target_name 은 기록 시점의 사본이다.
export type ActivityRow = Pick<
  Tables<"activities">,
  | "id"
  | "kind"
  | "actor_id"
  | "task_title"
  | "target_user_id"
  | "target_name"
  | "old_role"
  | "new_role"
  | "created_at"
>;

export type ActivityMemberRow = {
  userId: string;
  displayName: string | null;
  email: string | null;
};

export type ActivityScope = { orgId: string };

// 이름이 null 이면 그 사람은 떠났다(팀을 떠남·계정 삭제·관리 작업) — "떠난 멤버".
export type ActivityView = {
  id: string;
  kind: ActivityKind;
  text: string;
  actorName: string | null;
  // 멤버 기록의 대상, 담당자 바꿈의 새 담당자. 대상이 없는 기록이거나 떠났으면 null.
  targetName: string | null;
  // 문장의 주어(아바타 머리글자). 들어옴·나감은 대상이, 그 밖은 행위자가 주어다.
  subjectName: string | null;
  createdAt: string;
  createdAtText: string;
};

// 서버의 시간대와 상관없이 같은 글자가 나오도록 시간대를 고정한다.
const createdAtFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

export const formatCreatedAt = (iso: string): string => createdAtFormat.format(new Date(iso));

// 조직 도메인의 ORG_ROLE_LABELS 와 같은 글자다(도메인끼리는 부르지 않아 따로 둔다).
const ROLE_LABELS: Record<string, string | undefined> = { owner: "소유자", member: "멤버" };

const LEFT_MEMBER = "떠난 멤버";

// 이름 뒤에는 "님"을 붙여 조사를 고정한다(받침에 따라 바뀌지 않는다). 떠난 멤버는 "멤버"의 받침에 맞춘다.
type Person = string | null;
const asSubject = (person: Person): string =>
  person === null ? `${LEFT_MEMBER}가` : `${person} 님이`;
const asObject = (person: Person): string =>
  person === null ? `${LEFT_MEMBER}를` : `${person} 님을`;
const asPossessive = (person: Person): string =>
  person === null ? `${LEFT_MEMBER}의` : `${person} 님의`;
const asToward = (person: Person): string =>
  person === null ? `${LEFT_MEMBER}로` : `${person} 님으로`;

const isKind = (value: string): value is ActivityKind =>
  (ACTIVITY_KINDS as readonly string[]).includes(value);

export const memberNames = (members: readonly ActivityMemberRow[]): ReadonlyMap<string, string> =>
  new Map(members.map((member) => [member.userId, nameOf(member.displayName, member.email)]));

type Sentence = { text: string; subjectName: Person };

// 알 수 없는 종류(나중에 더한 종류)나 값이 빠진 기록은 null — 화면은 그 줄을 빼고 그린다.
function sentenceOf(
  kind: ActivityKind,
  row: ActivityRow,
  actor: Person,
  target: Person,
): Sentence | null {
  const title = `‘${row.task_title}’ 작업`;
  // 둘 다 지워졌으면(null) 같은 사람으로 보지 않는다.
  const isSelf = row.actor_id !== null && row.actor_id === row.target_user_id;
  const byActor = (text: string): Sentence => ({
    text: `${asSubject(actor)} ${text}`,
    subjectName: actor,
  });
  const newRole = ROLE_LABELS[row.new_role ?? ""];
  // 작업 기록에는 제목이 늘 있다(DB 제약 activities_task_title_check). 없으면 그리지 않는다.
  if (kind.startsWith("task_") && row.task_title === null) return null;

  switch (kind) {
    case "task_created":
      return byActor(`${title}을 만들었습니다.`);
    case "task_completed":
      return byActor(`${title}을 완료했습니다.`);
    case "task_reopened":
      return byActor(`${title}을 다시 열었습니다.`);
    case "task_assigned":
      return isSelf
        ? byActor(`${title}을 맡았습니다.`)
        : byActor(`${title}의 담당자를 ${asToward(target)} 바꿨습니다.`);
    case "task_unassigned":
      return byActor(`${title}의 담당자를 비웠습니다.`);
    case "task_deleted":
      return byActor(`${title}을 지웠습니다.`);
    case "member_joined":
      return { text: `${asSubject(target)} 팀에 들어왔습니다.`, subjectName: target };
    case "member_role_changed":
      if (!newRole) return null;
      return isSelf
        ? byActor(`자신의 역할을 ${newRole}로 바꿨습니다.`)
        : byActor(`${asPossessive(target)} 역할을 ${newRole}로 바꿨습니다.`);
    case "member_left":
      return { text: `${asSubject(target)} 팀에서 나갔습니다.`, subjectName: target };
    case "member_removed":
      return byActor(`${asObject(target)} 내보냈습니다.`);
    case "invitation_sent":
      return newRole ? byActor(`한 명을 ${newRole}로 초대했습니다.`) : null;
  }
}

// 행위자 이름은 사본이 아니라 지금 멤버에서 찾고(떠났으면 null), 대상 이름은 기록 시점의 사본을 쓴다.
export function toActivityView(
  row: ActivityRow,
  names: ReadonlyMap<string, string>,
): ActivityView | null {
  if (!isKind(row.kind)) return null;
  const actorName = row.actor_id === null ? null : (names.get(row.actor_id) ?? null);
  const targetName = row.target_name;
  const sentence = sentenceOf(row.kind, row, actorName, targetName);
  if (sentence === null) return null;
  return {
    id: row.id,
    kind: row.kind,
    text: sentence.text,
    actorName,
    targetName,
    subjectName: sentence.subjectName,
    createdAt: row.created_at,
    createdAtText: formatCreatedAt(row.created_at),
  };
}

export const toActivityViews = (
  rows: readonly ActivityRow[],
  members: readonly ActivityMemberRow[],
): ActivityView[] => {
  const names = memberNames(members);
  return rows.flatMap((row) => {
    const view = toActivityView(row, names);
    return view === null ? [] : [view];
  });
};
