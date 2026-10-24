import "server-only";

// ── 배럴: join-request 도메인의 공개 API. 바깥은 @/server/join-request 만 부른다 ──
export {
  decideOrgJoinRequest,
  findUnlinkedMember,
  getMyJoinRequest,
  listPendingJoinRequests,
  submitMyJoinRequest,
} from "./join-request.service";
export type {
  DecideJoinResult,
  FindMemberResult,
  FoundMember,
  JoinKind,
  JoinRequestView,
  MyJoinRequest,
  SubmitJoinResult,
} from "./join-request.model";
