import "server-only";
import type { BidListOrigin, BidStatus, PendingSourceRow } from "@/server/bids";
import type {
  ChecklistStatusRow,
  DecisionRecord,
  ProjectDetailRecord,
  ProjectRecord,
  ProjectResult,
  ProjectStatus,
} from "./project.model";

// 저장 포트: 서비스가 기대하는 모양만 적는다. 구현은 project.supabase.ts(사용자 세션 + RLS)다.
// 조직 격리는 RLS 가 하고, 다른 조직 자원은 null·빈 목록으로 돌려준다. 읽기는 org_id 로 그 조직 하나에 좁힌다.

// DB 함수 거절 코드(마이그레이션 20261022000300, raise exception '<코드>' using errcode = 'P0001').
export const PROJECT_DB_CODES = [
  "NOT_FOUND",
  "FORBIDDEN",
  "PROJECT_REQUIRES_BID_DECISION",
  "PROJECT_ALREADY_OPEN",
  "LATEST_DECISION_NOT_BID",
  "INVALID_PROJECT_TRANSITION",
] as const;
export type ProjectDbCode = (typeof PROJECT_DB_CODES)[number];

// detail: PROJECT_ALREADY_OPEN 은 프로젝트 id, LATEST_DECISION_NOT_BID 는 최신 결정 값(없으면 ""),
// INVALID_PROJECT_TRANSITION 은 "전>후". 그 밖은 null 이다.
export type RpcOutcome<T> =
  { ok: true; value: T } | { ok: false; code: ProjectDbCode; detail: string | null };

export type ProjectBoardSource = {
  projects: ProjectRecord[];
  // 그 프로젝트들의 공고에 이 조직이 남긴 결정 전부
  decisions: DecisionRecord[];
  // 이 조직의 체크리스트 항목(프로젝트 id·상태)
  checklist: ChecklistStatusRow[];
};

export type ProjectEntrySource = {
  bidStatus: BidStatus;
  project: {
    id: string;
    status: ProjectStatus;
    closedAt: string | null;
    result: ProjectResult | null;
  } | null;
  decisions: DecisionRecord[];
};

export type ProjectRef = { id: string; bidId: string; status: ProjectStatus };

// 화면 역할이 직접 바꿀 수 있는 두 열(열 권한 + RLS). 빠진 키는 바꾸지 않는다.
export type ProjectFieldChanges = {
  ownerId?: string | null;
  submissionDueOverride?: string | null;
};

export interface ProjectRepo {
  listBoard(orgId: string): Promise<ProjectBoardSource>;
  // 검토 대기 칸의 원본. 대시보드(createDashboardRepo.load)와 같은 질의에 기관·데모 여부를 더한다.
  loadPendingSource(orgId: string, origin: BidListOrigin): Promise<PendingSourceRow[]>;
  // 없거나 다른 조직이면 null
  getDetail(orgId: string, id: string): Promise<ProjectDetailRecord | null>;
  findRef(orgId: string, id: string): Promise<ProjectRef | null>;
  // 공고가 없으면 null
  getEntrySource(orgId: string, bidId: string): Promise<ProjectEntrySource | null>;
  // status <> 'CLOSED' 수
  countActive(orgId: string): Promise<number>;
  isOrgMember(orgId: string, userId: string): Promise<boolean>;
  openProject(reviewId: string): Promise<RpcOutcome<{ projectId: string; reopened: boolean }>>;
  changeStatus(
    projectId: string,
    toStatus: ProjectStatus,
    note: string | null,
  ): Promise<RpcOutcome<null>>;
  recordResult(
    projectId: string,
    result: ProjectResult,
    note: string | null,
  ): Promise<RpcOutcome<null>>;
  // 바뀐 행이 없으면 missing(없음·다른 조직·정책이 걸렀다), 담당자 외래 키 거절은 owner-not-member
  updateFields(
    orgId: string,
    id: string,
    changes: ProjectFieldChanges,
  ): Promise<"saved" | "missing" | "owner-not-member">;
}
