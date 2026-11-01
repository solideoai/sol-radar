import "server-only";
import { WORK_ROLE_CODES, WORK_ROLE_LABELS, workRoleOf, type WorkRoleCode } from "@/server/shared";
import {
  UNASSIGNED_DEPARTMENT,
  type StaffingRequirement,
  type WorkforceCandidate,
  type WorkforceProposedTeam,
  type WorkforceTeamMember,
} from "./workforce.model";

// 공고마다 자리(역할)를 나누고 자리마다 한 사람을 고른다. 요구 기술·역할이 맞는 직원이 없어도
// 직무 기준으로 자리를 채워 팀이 비지 않게 한다. 분석 스냅샷 인력만 쓰는 순수 계산이며 저장하지 않는다(ADR-021).

/** 기본 구성 순서. 작은 팀도 PM·개발자·디자이너가 먼저 들어간다. */
const DEFAULT_TEAM: readonly WorkRoleCode[] = [
  "PM",
  "DEVELOPER",
  "DESIGNER",
  "PL",
  "DEVELOPER",
  "QA",
  "BUSINESS_ANALYST",
  "DEVELOPER",
  "DEVOPS",
  "DBA",
  "DEVELOPER",
  "SECURITY",
];
/** 필요 인력을 모르면 fallback 명, 알면 min~max 명으로 짠다. 큰 사업은 핵심 max 명만 먼저 보인다. */
const TEAM_SIZE = { min: 3, max: 12, fallback: 5 } as const;
/** 요구 기술·제목이 말하는 직무를 PM 다음에 몇 개까지 넣는다 */
const LEAD_ROLE_LIMIT = 2;

type Slot = { label: string; roleCode: WorkRoleCode | null; grade: string | null };
const codeSlot = (roleCode: WorkRoleCode): Slot => ({
  label: WORK_ROLE_LABELS[roleCode],
  roleCode,
  grade: null,
});
const departmentOf = (person: WorkforceCandidate) => person.department ?? UNASSIGNED_DEPARTMENT;
const clampSize = (value: number) => Math.min(TEAM_SIZE.max, Math.max(TEAM_SIZE.min, value));

// 기본 구성을 앞에서부터 보며 같은 직무는 기본 구성에 나온 횟수까지만 넣는다. 그래도 모자라면 개발자로 채운다.
function withDefaults(slots: Slot[], size: number): Slot[] {
  const result = [...slots];
  const seen = new Map<WorkRoleCode, number>();
  for (const role of DEFAULT_TEAM) {
    if (result.length >= size) break;
    const count = (seen.get(role) ?? 0) + 1;
    seen.set(role, count);
    if (result.filter((slot) => slot.roleCode === role).length < count) result.push(codeSlot(role));
  }
  while (result.length < size) result.push(codeSlot("DEVELOPER"));
  return result;
}

// 점수가 큰 직무부터, 같으면 직무 코드 순서로 늘어놓는다.
function rankRoles(entries: [WorkRoleCode | null, number][]): WorkRoleCode[] {
  const scores = new Map<WorkRoleCode, number>();
  for (const [code, score] of entries)
    if (code && score > 0) scores.set(code, (scores.get(code) ?? 0) + score);
  return [...scores]
    .toSorted(
      ([left, a], [right, b]) =>
        b - a || WORK_ROLE_CODES.indexOf(left) - WORK_ROLE_CODES.indexOf(right),
    )
    .map(([code]) => code);
}
// PM 다음에 넣을 직무. 요구 기술 문구가 직무를 말하면("AI 시스템 운영", "클라우드 인프라") 그 직무,
// 다음은 요구 기술을 실제로 가진 직원의 직무, 마지막은 공고 제목이 말하는 직무("AI 플랫폼")다.
function leadRolesOf(pool: WorkforceCandidate[], requiredSkills: string[], title: string) {
  const ordered = [
    ...rankRoles(requiredSkills.map((skill) => [workRoleOf(skill), 1])),
    ...rankRoles(pool.map((person) => [workRoleOf(person.role), person.matchedSkills.length])),
    ...rankRoles([[workRoleOf(title), 1]]),
  ];
  return [...new Set(ordered)].filter((code) => code !== "PM").slice(0, LEAD_ROLE_LIMIT);
}

function slotsOf(
  staffing: StaffingRequirement[] | null,
  neededCount: number | null,
  leadRoles: () => WorkRoleCode[],
): Slot[] {
  if (staffing?.length) {
    const required = staffing.flatMap((requirement) =>
      Array.from(
        { length: Math.min(TEAM_SIZE.max, Math.max(0, requirement.minCount ?? 1)) },
        (): Slot => ({
          label: requirement.role,
          roleCode: workRoleOf(requirement.role),
          grade: requirement.grade ?? null,
        }),
      ),
    );
    return withDefaults(required.slice(0, TEAM_SIZE.max), TEAM_SIZE.min);
  }
  const size = clampSize(neededCount ?? TEAM_SIZE.fallback);
  const lead: WorkRoleCode[] = ["PM", ...leadRoles()];
  return withDefaults(lead.slice(0, size).map(codeSlot), size);
}

const sameRole = (slot: Slot, person: WorkforceCandidate) =>
  slot.roleCode
    ? workRoleOf(person.role) === slot.roleCode
    : person.role.trim().toLowerCase() === slot.label.trim().toLowerCase();
// true 가 앞으로 온다.
const first = (left: boolean, right: boolean) => Number(right) - Number(left);
/** PM·PL 자리는 높은 등급을 먼저 고른다. 모르는 등급은 맨 뒤다 */
const LEAD_GRADES = ["특급", "고급", "중급", "초급"];
const seniority = (slot: Slot, person: WorkforceCandidate) => {
  if (slot.roleCode !== "PM" && slot.roleCode !== "PL") return 0;
  const rank = LEAD_GRADES.indexOf(person.grade ?? "");
  return rank === -1 ? LEAD_GRADES.length : rank;
};

// 투입 가능 → 요구 기술 일치 → 앞 공고(기간 겹침)에 안 낸 사람 → 아직 없는 팀 → 요구 등급
// → PM·PL 은 높은 등급 → 투입 가능 많은 순 → 이름.
const comparePeople =
  (slot: Slot, departments: Set<string>, avoid: ReadonlySet<string>) =>
  (a: WorkforceCandidate, b: WorkforceCandidate) =>
    first(a.availableFte > 0, b.availableFte > 0) ||
    first(a.matchedSkills.length > 0, b.matchedSkills.length > 0) ||
    first(!avoid.has(a.personId), !avoid.has(b.personId)) ||
    first(!departments.has(departmentOf(a)), !departments.has(departmentOf(b))) ||
    first(
      slot.grade !== null && a.grade === slot.grade,
      slot.grade !== null && b.grade === slot.grade,
    ) ||
    seniority(slot, a) - seniority(slot, b) ||
    b.availableFte - a.availableFte ||
    a.name.localeCompare(b.name, "ko") ||
    a.personId.localeCompare(b.personId);

export function proposeTeam({
  pool,
  staffing,
  requiredFte,
  requiredSkills = [],
  title = "",
  avoidPersonIds = new Set(),
}: {
  /** 분석 스냅샷의 점수 계산 대상 전원 */
  pool: WorkforceCandidate[];
  staffing: StaffingRequirement[] | null;
  requiredFte: number | null;
  /** 공고 추출의 요구 기술 원문 */
  requiredSkills?: string[];
  title?: string;
  /** 기간이 겹치는 앞 공고의 추천 팀에 이미 든 사람. 다른 사람이 없을 때만 다시 고른다 */
  avoidPersonIds?: ReadonlySet<string>;
}): WorkforceProposedTeam {
  const neededCount = requiredFte === null ? null : Math.ceil(requiredFte);
  const slots = slotsOf(staffing, neededCount, () => leadRolesOf(pool, requiredSkills, title));
  const picked: (WorkforceTeamMember | null)[] = slots.map(() => null);
  const chosen = new Set<string>();
  const departments = new Set<string>();
  // 같은 직무로 모든 자리를 먼저 채우고, 빈 자리만 다른 직무에서 대체한다.
  // 한 번에 채우면 앞자리(PM) 대체가 뒷자리(개발)에 맞는 사람을 먼저 가져간다.
  for (const substitute of [false, true])
    slots.forEach((slot, index) => {
      const free = pool.filter((person) => !chosen.has(person.personId));
      const group = substitute ? free : free.filter((person) => sameRole(slot, person));
      if (picked[index] || group.length === 0) return;
      const [person] = group.toSorted(comparePeople(slot, departments, avoidPersonIds));
      chosen.add(person.personId);
      departments.add(departmentOf(person));
      picked[index] = {
        slot: slot.label,
        slotRoleCode: slot.roleCode,
        fit: substitute ? "SUBSTITUTE" : person.matchedSkills.length ? "MATCH" : "ROLE",
        person,
      };
    });
  const members = picked.filter((member): member is WorkforceTeamMember => member !== null);
  return {
    basis: staffing?.length ? "STAFFING" : "ESTIMATE",
    neededCount,
    slotCount: slots.length,
    members,
  };
}
