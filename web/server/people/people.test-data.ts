import "server-only";
import { readFileSync } from "node:fs";
import type { PeopleRows } from "./people.model";
const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`../../../fixtures/people/solideo.${name}.json`, import.meta.url), "utf8"),
  );
const uuid = (code: string) =>
  `00000000-0000-4000-8000-${code.replace(/\D/g, "").padStart(12, "0")}`;
const departments = fixture<{
  departments: {
    id: string;
    name: string;
    kind: string;
    parentId: string | null;
    targetCount: number | null;
  }[];
}>("departments").departments;
const people = fixture<{
  people: {
    personId: string;
    name: string;
    departmentId: string;
    jobTitleId: string;
    portraitPath: string;
    isDemo: boolean;
    scoringEligible: boolean;
    role: string;
    grade: string | null;
    skills: string[];
    availability: { startsAt: string; endsAt: string; fte: number }[];
  }[];
}>("people").people;
const titles = fixture<{ jobTitles: { id: string; label: string }[] }>("job-titles").jobTitles;
export const rows: PeopleRows = {
  departments: departments.map((d) => ({
    id: uuid(d.id),
    code: d.id,
    name: d.name,
    kind: d.kind,
    parent_id: d.parentId ? uuid(d.parentId) : null,
    target_count: d.targetCount,
  })),
  jobTitles: titles.map((t) => ({ id: uuid(t.id), code: t.id, label: t.label })),
  members: people.map((p) => ({
    id: uuid(p.personId),
    person_code: p.personId,
    name: p.name,
    department_id: uuid(p.departmentId),
    job_title_id: uuid(p.jobTitleId),
    portrait_path: p.portraitPath,
    is_demo: p.isDemo,
  })),
  scoring: people
    .filter((p) => p.scoringEligible)
    .map((p) => ({
      member_id: uuid(p.personId),
      role: p.role,
      grade: p.grade,
      skills: p.skills,
      availability: p.availability,
    })),
};
