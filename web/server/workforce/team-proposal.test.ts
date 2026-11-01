import { expect, it } from "vitest";
import { proposeTeam } from "./team-proposal";
import type { WorkforceCandidate } from "./workforce.model";

const person = (
  personId: string,
  role: string,
  department: string | null,
  availableFte = 1,
  matchedSkills: string[] = [],
): WorkforceCandidate => ({
  personId,
  personCode: null,
  name: `직원 ${personId}`,
  department,
  jobTitle: "선임",
  isDemo: true,
  portraitUrl: null,
  role,
  grade: "중급",
  skills: matchedSkills,
  matchedSkills,
  availableFte,
  matchReason: "",
});
const slots = (team: ReturnType<typeof proposeTeam>) => team.members.map((m) => m.slot);
const ids = (team: ReturnType<typeof proposeTeam>) => team.members.map((m) => m.person.personId);

it("요구 기술·역할이 맞는 직원이 없어도 PM·개발자·디자이너로 팀을 짠다", () => {
  const pool = [
    person("dev", "DEVELOPER", "개발팀"),
    person("pm", "PM", "사업팀"),
    person("ux", "DESIGNER", "디자인팀"),
    person("qa", "QA", "품질팀"),
  ];
  const team = proposeTeam({ pool, staffing: null, requiredFte: 3 });
  expect(slots(team)).toEqual(["PM", "개발자", "디자이너"]);
  expect(ids(team)).toEqual(["pm", "dev", "ux"]);
  expect(team.members.map((m) => m.fit)).toEqual(["ROLE", "ROLE", "ROLE"]);
  expect(team).toMatchObject({ basis: "ESTIMATE", neededCount: 3 });
});

it("같은 직무가 한 팀에 몰려 있어도 여러 팀에서 고르고, 투입 가능한 사람을 먼저 고른다", () => {
  const pool = [
    person("a1", "DEVELOPER", "개발A팀"),
    person("a2", "DEVELOPER", "개발A팀"),
    person("a3", "DEVELOPER", "개발A팀"),
    person("b1", "DEVELOPER", "개발B팀", 0.5),
    person("c1", "DEVELOPER", "개발C팀", 0.25),
    person("busy", "DEVELOPER", "개발D팀", 0),
  ];
  const team = proposeTeam({
    pool,
    staffing: [{ role: "개발", minCount: 4, mandatory: true }],
    requiredFte: 4,
  });
  expect(ids(team)).toEqual(["a1", "b1", "c1", "a2"]);
  expect(team).toMatchObject({ basis: "STAFFING", neededCount: 4 });
});

it("같은 직무 직원이 없거나 직무 대응이 없는 역할도 다른 직무에서 대체해 채운다", () => {
  const pool = [person("dev", "DEVELOPER", "개발팀"), person("ba", "BUSINESS_ANALYST", "기획팀")];
  const team = proposeTeam({
    pool,
    staffing: [
      { role: "감리원", minCount: 1, mandatory: true },
      { role: "디자이너", minCount: 1, mandatory: false },
    ],
    requiredFte: 2,
  });
  expect(team.members).toHaveLength(2);
  expect(team.members.map((m) => [m.slot, m.slotRoleCode, m.fit])).toEqual([
    ["감리원", null, "SUBSTITUTE"],
    ["디자이너", "DESIGNER", "SUBSTITUTE"],
  ]);
});

it("요구 기술이 맞는 직무를 PM 다음에 넣고, 큰 사업은 12명까지만 제안한다", () => {
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => person(`dev-${i}`, "DEVELOPER", `개발${i}팀`)),
    person("ai", "DATA_AI", "AI팀", 1, ["Python", "PyTorch"]),
    person("pm", "PM", "사업팀"),
    person("ux", "DESIGNER", "디자인팀"),
  ];
  expect(slots(proposeTeam({ pool, staffing: null, requiredFte: null }))).toEqual([
    "PM",
    "데이터·AI",
    "개발자",
    "디자이너",
    "PL",
  ]);
  const large = proposeTeam({ pool, staffing: null, requiredFte: 20 });
  expect(large.members).toHaveLength(12);
  expect(large.neededCount).toBe(20);
  expect(large.members.find((m) => m.slot === "데이터·AI")?.fit).toBe("MATCH");
});

it("기간이 겹치는 앞 공고의 팀에 든 사람은 다른 사람이 있으면 피한다", () => {
  const pool = [person("pm-1", "PM", "사업1팀"), person("pm-2", "PM", "사업2팀", 0.5)];
  const staffing = [{ role: "PM", minCount: 1, mandatory: true }];
  const avoided = proposeTeam({
    pool,
    staffing,
    requiredFte: 1,
    avoidPersonIds: new Set(["pm-1"]),
  });
  expect(ids(avoided)[0]).toBe("pm-2");
  expect(ids(proposeTeam({ pool, staffing, requiredFte: 1 }))[0]).toBe("pm-1");
});

it("요구 기술 문구와 공고 제목이 말하는 직무를 PM 다음 자리에 넣는다", () => {
  const pool = [
    person("pm", "PM", "사업팀"),
    person("ai", "DATA_AI", "AI팀"),
    person("ops", "DEVOPS", "운영팀"),
    person("dev", "DEVELOPER", "개발팀"),
  ];
  const fromSkills = proposeTeam({
    pool,
    staffing: null,
    requiredFte: 3,
    requiredSkills: ["AI 시스템 운영 및 유지관리", "클라우드 인프라 운영", "생성형 AI RAG 관리"],
  });
  expect(slots(fromSkills)).toEqual(["PM", "데이터·AI", "DevOps"]);
  const fromTitle = proposeTeam({
    pool,
    staffing: null,
    requiredFte: 3,
    title: "실행형 AI 플랫폼 구축 용역",
  });
  expect(slots(fromTitle)).toEqual(["PM", "데이터·AI", "개발자"]);
});

it("PM·PL 자리는 등급이 높은 사람을 먼저 고른다", () => {
  const pool = [
    { ...person("pm-junior", "PM", "사업1팀"), grade: "초급" },
    { ...person("pm-senior", "PM", "사업2팀", 0.5), grade: "특급" },
  ];
  const team = proposeTeam({ pool, staffing: null, requiredFte: 3 });
  expect(team.members[0]?.person.personId).toBe("pm-senior");
});
