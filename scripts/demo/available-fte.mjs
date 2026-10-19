// demo/available-fte.mjs — 시험 전용 다리. 루트 node 시험이 C4 규칙 엔진(web/server/scoring, TypeScript)의 `availableFte` 를
// 그대로 부르기 위해 자식 프로세스로 돈다. 제품 코드가 import 하지 않는다.
//
//   node --conditions=react-server --import <web/node_modules/tsx/dist/loader.mjs> scripts/demo/available-fte.mjs < 입력.json
//
// `--conditions=react-server` 는 web/server/** 의 `import "server-only"` 를 빈 모듈로 풀고, tsx 는 확장자 없는 .ts import 를
// 해석한다(Node 의 타입 제거만으로는 `./analysis-input.model` 같은 import 를 못 찾는다).
//
// 입력(stdin JSON): { deadlines: { [fixtureId]: "+21d" | ISO }, teams: { [key]: { people, assignments, asOf } } }
//   people·assignments 는 fixtures/people/solideo.people.json 과 같은 모양(ScoringPerson·ScoringAssignment).
// 출력(stdout JSON): { periods: { [fixtureId]: { startsAt, endsAt } },
//                     totals: { [key]: { [fixtureId]: number } },
//                     members: { [key]: { [fixtureId]: { [personId]: number } } } }
//   기간은 C4 가 쓰는 것과 같은 규칙(bid.projectPeriod 없음 → 마감일 기준 defaultProjectPeriod, 기준일은 골든 계산일)이다.
import { fileURLToPath } from "node:url";

const scoringDir = fileURLToPath(new URL("../../web/server/scoring/", import.meta.url));
const [{ availableFte, toScoringTeam }, { defaultProjectPeriod, kstDate }, { relativeDate }] =
  await Promise.all(
    ["scoring.model.ts", "calendar.ts", "test-support.ts"].map(
      (file) => import(new URL(file, `file://${scoringDir}`).href),
    ),
  );

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const { deadlines, teams } = JSON.parse(await readStdin());
const periods = Object.fromEntries(
  Object.entries(deadlines).map(([fixtureId, spec]) => [
    fixtureId,
    defaultProjectPeriod(kstDate(relativeDate(spec))),
  ]),
);
const totals = {};
const members = {};
for (const [key, { people, assignments, asOf }] of Object.entries(teams)) {
  const team = toScoringTeam(people, assignments, asOf);
  totals[key] = {};
  members[key] = {};
  for (const [fixtureId, period] of Object.entries(periods)) {
    totals[key][fixtureId] = availableFte(team, period);
    members[key][fixtureId] = Object.fromEntries(
      team.members.map((member) => [
        member.personId,
        availableFte({ ...team, members: [member] }, period),
      ]),
    );
  }
}
process.stdout.write(`${JSON.stringify({ periods, totals, members })}\n`);
