import "server-only";
import { z } from "zod";
import type { AvailabilityWindow, CapacityPeriod, RequirementExtraction } from "@/server/scoring";
import type { WorkRoleCode } from "@/server/shared";

export const workforceSelectionSchema = z
  .array(z.uuid())
  .min(1)
  .max(3)
  .refine((ids) => new Set(ids).size === ids.length, "같은 공고를 중복 선택할 수 없습니다");
export function parseWorkforceQuery(value: string | string[] | undefined) {
  return workforceSelectionSchema.safeParse(typeof value === "string" ? value.split(",") : []);
}
export type WorkforceBid = { bidId: string; title: string; isDemo: boolean };
export type WorkforceAttempt = { id: string; status: string; at: string };
export type WorkforceSnapshot = {
  id: string;
  status: "COMPLETED" | "PARTIAL";
  revision: number;
  finishedAt: string | null;
  inputSnapshot: unknown;
};
export type CurrentPerson = {
  personId: string;
  name: string;
  department: string | null;
  jobTitle: string | null;
  isDemo: boolean;
  availability: AvailabilityWindow[] | null;
};
export type CurrentAssignment = CapacityPeriod & {
  id: string;
  bidId: string;
  personId: string;
  allocationPercent: number;
};
export type CurrentWorkforce = { people: CurrentPerson[]; assignments: CurrentAssignment[] };
// This read-only surface deliberately has no mutation, analysis or allocation methods.
export type WorkforceRepo = {
  readBid(orgId: string, bidId: string): Promise<WorkforceBid | null>;
  latestAttempt(orgId: string, bidId: string): Promise<WorkforceAttempt | null>;
  scoredSnapshots(orgId: string, bidId: string, offset: number): Promise<WorkforceSnapshot[]>;
  current(orgId: string, asOf: string): Promise<CurrentWorkforce>;
};
export type WorkforceCandidate = Omit<CurrentPerson, "availability"> & {
  role: string;
  grade: string | null;
  skills: string[];
  availableFte: number;
  matchReason: string;
};
export type WorkforceBidResult = WorkforceBid & {
  analysisId: string | null;
  analysisStatus: "COMPLETED" | "PARTIAL" | null;
  revision: number | null;
  analyzedAt: string | null;
  snapshotAsOf: string | null;
  calculationDate: string | null;
  latestAttempt: WorkforceAttempt | null;
  period: CapacityPeriod | null;
  periodSource: "BID" | "DEFAULT" | null;
  requiredFte: number | null;
  requiredFteSource: "STAFFING" | "BUDGET_TIER" | null;
  availableFte: number | null;
  missingReason: string | null;
  note: string | null;
  candidateBasisMissing: boolean;
  candidates: WorkforceCandidate[];
  roleNeeds: WorkforceRoleNeed[];
  teams: WorkforceTeamSupply[];
};
export type WorkforceOverload = CapacityPeriod & {
  personId: string;
  name: string;
  capacityFte: number;
  allocatedFte: number;
  assignments: CurrentAssignment[];
  selectedBidIds: string[];
};
export type WorkforceSharedCandidate = CapacityPeriod & {
  personId: string;
  name: string;
  bidIds: string[];
};
export type WorkforceResult = {
  bids: WorkforceBidResult[];
  currentAssignmentsAsOf: string;
  overloads: WorkforceOverload[];
  sharedCandidates: WorkforceSharedCandidate[];
  currentMissingPersonIds: string[];
  teamPlan: WorkforceTeamPlanRow[];
};
// 공고 추출의 역할 요구 한 줄(scoring staffing 과 같은 모양).
export type StaffingRequirement = NonNullable<RequirementExtraction["staffing"]["value"]>[number];
export const UNASSIGNED_DEPARTMENT = "부서 미지정";
export type WorkforceTeamPerson = {
  personId: string;
  name: string;
  jobTitle: string | null;
  role: string;
  grade: string | null;
  isDemo: boolean;
  /** 분석 당시 그 공고 기간의 가용 FTE */
  availableFte: number;
};
export type WorkforceTeamSupply = {
  /** 부서가 없으면 UNASSIGNED_DEPARTMENT */
  department: string;
  people: WorkforceTeamPerson[];
  /** people 합, 소수 둘째 자리 반올림 */
  availableFte: number;
};
export type WorkforceRoleNeed = {
  /** 공고 원문 역할 */
  role: string;
  roleCode: WorkRoleCode | null;
  minCount: number;
  grade: string | null;
  mandatory: boolean;
  /** 같은 직무 후보 가운데 가용 FTE 가 0 보다 큰 사람 수 */
  supplyCount: number;
  /** 후보 수와 비교한 값이며 인력 부족 확정이 아니다 */
  shortfall: number;
  teams: WorkforceTeamSupply[];
};
export type WorkforceTeamPlanCell = {
  bidId: string;
  people: WorkforceTeamPerson[];
  roles: string[];
};
export type WorkforceTeamPlanRow = {
  department: string;
  personCount: number;
  cells: WorkforceTeamPlanCell[];
};
