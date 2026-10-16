import "server-only";

export type CapacityPeriod = { startsAt: string; endsAt: string };
export type AvailabilityWindow = CapacityPeriod & { fte: number };
export type ScoringAssignment = CapacityPeriod & { personId: string; allocationPercent: number };
export type ScoringPerson = {
  personId: string;
  scoringEligible: boolean;
  role: string;
  grade: string | null;
  skills: string[];
  availability: AvailabilityWindow[];
};
export type ScoringMember = Omit<ScoringPerson, "scoringEligible">;
export type ScoringTeam = {
  members: ScoringMember[];
  assignments: ScoringAssignment[];
  asOf: string;
};

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError("Invalid capacity date");
  return parsed;
}
function interval(period: CapacityPeriod): { start: number; end: number } {
  const start = instant(period.startsAt);
  const end = instant(period.endsAt);
  if (start >= end) throw new RangeError("Capacity interval must be nonempty");
  return { start, end };
}
function bounded(value: number, maximum: number): number {
  if (!Number.isFinite(value) || value < 0 || value > maximum)
    throw new RangeError("Invalid capacity amount");
  return value;
}

export function toScoringTeam(
  people: readonly ScoringPerson[],
  assignments: readonly ScoringAssignment[],
  asOf: string,
): ScoringTeam {
  instant(asOf);
  const members = people
    .filter((person) => person.scoringEligible)
    .map((person) => ({
      personId: person.personId,
      role: person.role,
      grade: person.grade,
      skills: [...person.skills],
      availability: person.availability.map(({ startsAt, endsAt, fte }) => ({
        startsAt,
        endsAt,
        fte,
      })),
    }));
  const ids = new Set(members.map((member) => member.personId));
  return {
    members,
    assignments: assignments
      .filter((assignment) => ids.has(assignment.personId))
      .map(({ personId, startsAt, endsAt, allocationPercent }) => ({
        personId,
        startsAt,
        endsAt,
        allocationPercent,
      })),
    asOf,
  };
}

export function toPeopleProfile(
  people: readonly ScoringPerson[],
  assignments: readonly ScoringAssignment[],
  asOf: string,
) {
  return {
    financials: { employeeCount: people.length },
    team: toScoringTeam(people, assignments, asOf),
  };
}

// Guaranteed capacity throughout the half-open window, not a duration average.
// Per-person minima deliberately exclude staff rotation/assignment optimization.
export function availableFte(team: ScoringTeam, period: CapacityPeriod): number {
  const requested = interval(period);
  return team.members.reduce((total, member) => {
    const windows = member.availability.map((window) => ({
      ...interval(window),
      amount: bounded(window.fte, 1),
    }));
    const assigned = team.assignments
      .filter((assignment) => assignment.personId === member.personId)
      .map((assignment) => ({
        ...interval(assignment),
        amount: bounded(assignment.allocationPercent, 100) / 100,
      }));
    const boundaries = [
      ...new Set([
        requested.start,
        requested.end,
        ...[...windows, ...assigned]
          .flatMap((window) => [window.start, window.end])
          .filter((boundary) => boundary > requested.start && boundary < requested.end),
      ]),
    ].toSorted((left, right) => left - right);
    const residuals = boundaries.slice(0, -1).map((at) => {
      const available = Math.max(
        0,
        ...windows
          .filter((window) => window.start <= at && at < window.end)
          .map((window) => window.amount),
      );
      const allocated = assigned
        .filter((window) => window.start <= at && at < window.end)
        .reduce((sum, window) => sum + window.amount, 0);
      return Math.max(0, available - allocated);
    });
    return total + Math.min(...residuals);
  }, 0);
}
