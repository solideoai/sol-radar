import "server-only";
import { z } from "zod";
import type { AvailabilityWindow, CapacityPeriod } from "@/server/scoring";

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
};
