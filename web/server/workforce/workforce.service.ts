import "server-only";
import { fail, type ServiceResult } from "@/server/bids";
import {
  analysisInputSchema,
  availableFte,
  defaultProjectPeriod,
  kstDate,
  staffAvailability,
  companySkillSet,
  matchSkill,
  type AnalysisInput,
  type CapacityPeriod,
} from "@/server/scoring";
import { workRoleOf } from "@/server/shared";
import { roleNeedsOf, teamPlanOf, teamsOf } from "./team-plan";
import type {
  CurrentWorkforce,
  WorkforceBidResult,
  WorkforceCandidate,
  WorkforceOverload,
  WorkforceRepo,
  WorkforceResult,
  WorkforceSharedCandidate,
} from "./workforce.model";
import { workforceRepo } from "./workforce.repo";

const ms = (value: string) => Date.parse(value);
const iso = (value: number) => new Date(value).toISOString();
const overlaps = (a: CapacityPeriod, b: CapacityPeriod) =>
  ms(a.startsAt) < ms(b.endsAt) && ms(b.startsAt) < ms(a.endsAt);
const periodOf = (input: AnalysisInput) =>
  input.bid.projectPeriod ??
  defaultProjectPeriod(kstDate(input.bid.deadlineAt ?? `${input.config.today}T00:00:00Z`));

function candidatesOf(input: AnalysisInput, period: CapacityPeriod, current: CurrentWorkforce) {
  const skills = input.extraction?.requiredSkills;
  const staffing = input.extraction?.staffing;
  const requiredSkills = skills?.state === "KNOWN" ? (skills.value ?? []) : [];
  const roles = staffing?.state === "KNOWN" ? (staffing.value?.map((r) => r.role) ?? []) : [];
  const missing = requiredSkills.length === 0 && roles.length === 0;
  const candidates = input.team.members.flatMap((member): WorkforceCandidate[] => {
    const matchedSkills = requiredSkills.filter(
      (skill) => matchSkill(skill, companySkillSet(member.skills)) !== null,
    );
    // 공고 원문 역할을 직무 코드로 바꿔 비교하고, 대응이 없으면 원문끼리 비교한다.
    const matchedRoles = roles.filter((role) => {
      const code = workRoleOf(role);
      return code
        ? code === member.role
        : role.trim().toLowerCase() === member.role.trim().toLowerCase();
    });
    if (!missing && matchedSkills.length === 0 && matchedRoles.length === 0) return [];
    const person = current.people.find((p) => p.personId === member.personId);
    return [
      {
        personId: member.personId,
        personCode: person?.personCode ?? null,
        name: person?.name ?? `스냅샷 인력 ${member.personId.slice(0, 8)}`,
        department: person?.department ?? null,
        jobTitle: person?.jobTitle ?? null,
        isDemo: person?.isDemo ?? false,
        portraitUrl: person?.portraitUrl ?? null,
        role: member.role,
        grade: member.grade,
        skills: member.skills,
        availableFte: availableFte({ ...input.team, members: [member] }, period),
        matchReason: missing
          ? "후보 적합성 확인 필요"
          : [
              ...(matchedSkills.length ? [`요구 기술 일치: ${matchedSkills.join(", ")}`] : []),
              ...(matchedRoles.length ? [`요구 역할 일치: ${matchedRoles.join(", ")}`] : []),
            ].join(" · "),
      },
    ];
  });
  return { candidates, missing };
}

function currentConflicts(bids: WorkforceBidResult[], current: CurrentWorkforce) {
  const overloads: WorkforceOverload[] = [];
  const sharedCandidates: WorkforceSharedCandidate[] = [];
  const missing = new Set<string>();
  const people = new Map(
    bids.flatMap((bid) => bid.candidates.map((p) => [p.personId, p] as const)),
  );
  for (const [id, person] of people) {
    const selected = bids.filter(
      (bid) => bid.period && bid.candidates.some((p) => p.personId === id),
    );
    const periods = selected.flatMap((bid) => (bid.period ? [bid.period] : []));
    const capacity = current.people.find((p) => p.personId === id)?.availability;
    if (!capacity?.length) {
      missing.add(id);
      continue;
    }
    const assigned = current.assignments.filter(
      (a) => a.personId === id && periods.some((p) => overlaps(a, p)),
    );
    const boundaries = [
      ...new Set(
        [...periods, ...capacity, ...assigned].flatMap((p) => [ms(p.startsAt), ms(p.endsAt)]),
      ),
    ].toSorted((a, b) => a - b);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const at = boundaries[index],
        end = boundaries[index + 1];
      const activeBids = selected.filter(
        (b) => b.period && ms(b.period.startsAt) <= at && at < ms(b.period.endsAt),
      );
      if (!activeBids.length) continue;
      const active = assigned.filter((a) => ms(a.startsAt) <= at && at < ms(a.endsAt));
      const allocatedFte = active.reduce((sum, a) => sum + a.allocationPercent, 0) / 100;
      const capacityFte = Math.max(
        0,
        ...capacity.filter((w) => ms(w.startsAt) <= at && at < ms(w.endsAt)).map((w) => w.fte),
      );
      if (allocatedFte > capacityFte + Number.EPSILON)
        overloads.push({
          personId: id,
          name: person.name,
          startsAt: iso(at),
          endsAt: iso(end),
          capacityFte,
          allocatedFte,
          assignments: active,
          selectedBidIds: activeBids.map((b) => b.bidId),
        });
    }
  }
  // Shared candidates are a separate observation and do not create imaginary allocations.
  for (let left = 0; left < bids.length; left += 1)
    for (let right = left + 1; right < bids.length; right += 1) {
      const a = bids[left],
        b = bids[right];
      if (!a.period || !b.period || !overlaps(a.period, b.period)) continue;
      for (const candidate of a.candidates.filter((p) =>
        b.candidates.some((other) => other.personId === p.personId),
      ))
        sharedCandidates.push({
          personId: candidate.personId,
          name: candidate.name,
          bidIds: [a.bidId, b.bidId],
          startsAt: iso(Math.max(ms(a.period.startsAt), ms(b.period.startsAt))),
          endsAt: iso(Math.min(ms(a.period.endsAt), ms(b.period.endsAt))),
        });
    }
  return { overloads, sharedCandidates, currentMissingPersonIds: [...missing] };
}

export async function simulateWorkforce(
  orgId: string,
  bidIds: string[],
  { repo = workforceRepo }: { repo?: WorkforceRepo } = {},
  now = new Date(),
): Promise<ServiceResult<WorkforceResult>> {
  const notices = await Promise.all(bidIds.map((id) => repo.readBid(orgId, id)));
  if (notices.some((bid) => bid === null))
    return fail(404, "NOT_FOUND", "공고를 찾을 수 없거나 접근할 수 없습니다", { resource: "bid" });
  const currentAssignmentsAsOf = now.toISOString();
  const current = await repo.current(orgId, currentAssignmentsAsOf);
  const bids = await Promise.all(
    notices.map(async (notice, index): Promise<WorkforceBidResult> => {
      if (!notice) throw new Error("공고를 읽지 못했습니다");
      const latestAttempt = await repo.latestAttempt(orgId, bidIds[index]);
      for (let offset = 0; ; offset += 20) {
        const rows = await repo.scoredSnapshots(orgId, notice.bidId, offset);
        for (const row of rows) {
          const parsed = analysisInputSchema.safeParse(row.inputSnapshot);
          if (!parsed.success) continue;
          try {
            const input = parsed.data,
              period = periodOf(input);
            const factor = staffAvailability(
              input.bid,
              input.extraction,
              input.team,
              input.config.today,
            );
            const available = input.team.members.length ? availableFte(input.team, period) : null;
            const { candidates, missing } = candidatesOf(input, period, current);
            const staffing = input.extraction?.staffing;
            return {
              ...notice,
              analysisId: row.id,
              analysisStatus: row.status,
              revision: row.revision,
              analyzedAt: row.finishedAt,
              snapshotAsOf: input.team.asOf,
              calculationDate: input.config.today,
              latestAttempt,
              period,
              periodSource: input.bid.projectPeriod ? "BID" : "DEFAULT",
              requiredFte:
                typeof factor.rawValue.requiredFte === "number"
                  ? factor.rawValue.requiredFte
                  : null,
              requiredFteSource:
                factor.rawValue.requiredFteSource === "STAFFING" ||
                factor.rawValue.requiredFteSource === "BUDGET_TIER"
                  ? factor.rawValue.requiredFteSource
                  : null,
              availableFte: available,
              missingReason: factor.missingReason,
              note: factor.note,
              candidateBasisMissing: missing,
              candidates,
              roleNeeds: roleNeedsOf(
                staffing?.state === "KNOWN" ? staffing.value : null,
                candidates,
              ),
              teams: teamsOf(candidates),
            };
          } catch (error) {
            if (!(error instanceof RangeError)) throw error;
          }
        }
        if (rows.length < 20) break;
      }
      return {
        ...notice,
        analysisId: null,
        analysisStatus: null,
        revision: null,
        analyzedAt: null,
        snapshotAsOf: null,
        calculationDate: null,
        latestAttempt,
        period: null,
        periodSource: null,
        requiredFte: null,
        requiredFteSource: null,
        availableFte: null,
        missingReason: "VALID_SNAPSHOT_REQUIRED",
        note: null,
        candidateBasisMissing: true,
        candidates: [],
        roleNeeds: [],
        teams: [],
      };
    }),
  );
  return {
    ok: true,
    status: 200,
    data: {
      bids,
      currentAssignmentsAsOf,
      ...currentConflicts(bids, current),
      teamPlan: teamPlanOf(bids),
    },
  };
}
