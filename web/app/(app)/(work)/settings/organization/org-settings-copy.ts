import { formatKst } from "@/components/bids/format";
import type {
  OrgInvitationCancelResult,
  OrgInvitationMailStatus,
  OrgInviteResult,
  OrgRoleChangeResult,
  SolRole,
} from "@/server/organization";

// N2 설정 조직 탭 문구(디자인 스펙 docs/plans/2026-10-21-n2-org-settings-design.md §6, 초안 — 확정은 사용자).
// 서버 모듈은 브라우저로 가져올 수 없어 타입만 가져온다.

export const ORG_SETTINGS_PATH = "/settings/organization";
export const ORG_SETTINGS_TITLE = "설정";
export const ORG_SETTINGS_META_TITLE = "조직 설정";
export const ORG_SETTINGS_DESCRIPTION = "구성원의 업무 역할과 초대를 관리합니다.";

// 화면이 보이는 업무 역할 순서(권한이 큰 순서, §3.3). 역할은 코드 글자 그대로 보인다(D1).
export const SOL_ROLE_ORDER = [
  "ADMIN",
  "SALES",
  "ANALYST",
  "VIEWER",
] as const satisfies readonly SolRole[];
export const SOL_ROLE_ITEMS: Record<SolRole, string> = {
  ADMIN: "ADMIN",
  SALES: "SALES",
  ANALYST: "ANALYST",
  VIEWER: "VIEWER",
};

// 09 RBAC 표를 줄였다(§6 역할 안내).
export const SOL_ROLE_GUIDE: readonly { role: SolRole; text: string }[] = [
  {
    role: "ADMIN",
    text: "SALES가 하는 일 + 구성원·초대·업무 역할, 회사 프로필 개정, 데이터 수집 관리",
  },
  { role: "SALES", text: "분석 요청, 참여 결정(BID·WATCH·NO-BID) 기록" },
  { role: "ANALYST", text: "분석 요청" },
  { role: "VIEWER", text: "읽기만. 모든 역할이 공고·분석 결과·조직·인력을 읽습니다." },
];

export const MEMBERS_COPY = {
  title: "구성원",
  description:
    "업무 역할을 바꾸면 그 사람의 다음 요청부터 바로 적용됩니다. 구성원 내보내기는 멤버 탭에서 합니다.",
  lastAdmin:
    "ADMIN이 나 한 명이라 내 업무 역할은 바꿀 수 없습니다. 다른 구성원을 먼저 ADMIN으로 바꾸세요.",
  caption: (count: number) => `구성원 ${count}명. 업무 역할은 행마다 선택 상자에서 바로 바뀝니다.`,
  suspended: "정지됨",
  me: "(나)",
} as const;

export const INVITE_COPY = {
  title: "초대",
  email: "이메일",
  role: "업무 역할",
  submit: "초대",
  submitting: "초대 중…",
  help: "초대받은 사람은 이 이메일로 로그인(계정이 없으면 가입)한 뒤 ‘받은 초대’에서 수락합니다. 수락하면 고른 업무 역할로 구성원이 됩니다. 초대는 7일 동안 유효합니다.",
  emailRequired: "이메일을 입력하세요",
  emailFormat: "이메일 형식이 아닙니다",
  alreadyMember: "이미 이 조직의 구성원입니다. 업무 역할은 위 구성원 표에서 바꾸세요.",
} as const;

export const INVITATIONS_COPY = {
  title: "대기 중인 초대",
  description:
    "수락하기 전의 초대입니다. 같은 이메일을 다시 초대하면 기한이 7일 늘고 업무 역할이 새로 고른 값으로 바뀝니다.",
  empty: "대기 중인 초대가 없습니다.",
  caption: (count: number) => `대기 중인 초대 ${count}건. 만료가 늦은 순입니다.`,
  cancel: "초대 취소",
  cancelling: "취소 중…",
  expired: "만료됨",
} as const;

// 26-5(역할 변경 감사) 미룸을 유지하면 description 을 "새 초대를 최근 20건까지 보입니다. 업무 역할 변경 기록은
// 아직 남기지 않습니다."로 바꾼다(디자인 스펙 §4.6 끝 문단, D12).
export const AUDIT_COPY = {
  title: "최근 변경 기록",
  description:
    "업무 역할 변경과 새 초대를 최근 20건까지 보입니다. 초대 기한 연장·취소는 남지 않습니다.",
  empty: "아직 변경 기록이 없습니다. 업무 역할을 바꾸거나 새로 초대하면 여기에 남습니다.",
  caption: (count: number) => `최근 변경 기록 ${count}건. 최근 것이 위에 있습니다.`,
  roleChange: "역할 변경",
  invite: "초대",
  deleted: "탈퇴한 사용자",
  left: "조직을 떠난 사용자",
} as const;

export const SIGNED_OUT = "로그인이 풀렸습니다. 다시 로그인하세요.";
export const UNKNOWN_FAILURE = "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

// 역할 변경 실패 문단(§4.8). 마지막 ADMIN 문장만 DB 문구와 같다.
export function roleChangeFailure(
  name: string,
  status: Exclude<OrgRoleChangeResult["status"], "saved">,
): string {
  switch (status) {
    case "last-admin":
      return `${name} 님의 업무 역할을 바꾸지 못했습니다. 조직에는 업무 ADMIN이 한 명 이상 있어야 합니다.`;
    case "forbidden":
      return "업무 역할이 ADMIN이 아니어서 바꾸지 못했습니다. 화면을 새로 고칩니다.";
    case "not-member":
      return `${name} 님은 이제 이 조직의 구성원이 아닙니다. 목록을 새로 고칩니다.`;
    case "signed-out":
      return SIGNED_OUT;
    case "invalid":
      return UNKNOWN_FAILURE;
  }
}

// 자기 강등 대화상자 안의 실패 문단(§4.8). 대상이 나라서 이름 대신 "내"로 쓴다.
export function selfDemoteFailure(status: Exclude<OrgRoleChangeResult["status"], "saved">): string {
  switch (status) {
    case "last-admin":
      return "내 업무 역할을 바꾸지 못했습니다. 조직에는 업무 ADMIN이 한 명 이상 있어야 합니다.";
    case "forbidden":
      return "업무 역할이 ADMIN이 아니어서 바꾸지 못했습니다. 화면을 새로 고칩니다.";
    case "signed-out":
      return SIGNED_OUT;
    case "not-member":
    case "invalid":
      return UNKNOWN_FAILURE;
  }
}

export const roleChangedToast = (name: string, from: SolRole, to: SolRole) =>
  `${name} 님의 업무 역할을 ${from}에서 ${to}로 바꿨습니다`;
export const selfDemotedToast = (to: SolRole) => `내 업무 역할을 ${to}로 바꿨습니다`;

export const SELF_DEMOTE_COPY = {
  title: (to: SolRole) => `내 업무 역할을 ${to}로 바꿀까요?`,
  description:
    "바꾸면 설정의 조직 탭과 데이터 수집 관리를 더 볼 수 없습니다. 다시 ADMIN이 되려면 다른 ADMIN이 바꿔 줘야 합니다.",
  cancel: "취소",
  confirm: (to: SolRole) => `${to}로 바꾸기`,
  pending: "바꾸는 중…",
} as const;

const TELL_THEM = "초대받은 사람에게 직접 알려 주세요.";

export type InviteToast = { tone: "success" | "warning"; message: string };

// 초대는 저장됐고 메일 결과만 다르다(§4.10). 메일 실패는 오류가 아니지만 할 일이 남아 경고로 가른다.
export function inviteToastOf(
  email: string,
  role: SolRole,
  result: { status: "invited" | "renewed"; mail: OrgInvitationMailStatus },
): InviteToast {
  const head =
    result.status === "invited"
      ? `${email}을 ${role}로 초대`
      : `이미 초대한 이메일이라 기한을 7일 늘리고 업무 역할을 ${role}로 맞췄습니다`;
  if (result.status === "renewed") {
    switch (result.mail) {
      case "sent":
        return { tone: "success", message: `${head}. 초대 메일을 다시 보냈습니다.` };
      case "not-configured":
        return { tone: "success", message: `${head}. ${TELL_THEM}` };
      case "failed":
        return { tone: "warning", message: `${head}. 메일을 보내지 못했습니다. ${TELL_THEM}` };
    }
  }
  switch (result.mail) {
    case "sent":
      return { tone: "success", message: `${head}하고 초대 메일을 보냈습니다` };
    case "not-configured":
      return { tone: "success", message: `${head}했습니다. ${TELL_THEM}` };
    case "failed":
      return { tone: "warning", message: `${head}했지만 메일을 보내지 못했습니다. ${TELL_THEM}` };
  }
}

// 초대 폼 오류(§4.10). 칸 오류(field: email)와 폼 오류(field: root)로 가른다.
export function inviteFailure(
  result: Exclude<OrgInviteResult, { status: "invited" | "renewed" }>,
): { field: "email" | "root"; message: string } {
  switch (result.status) {
    case "invalid":
      return { field: "email", message: result.message };
    case "already-member":
      return { field: "email", message: INVITE_COPY.alreadyMember };
    case "forbidden":
      return { field: "root", message: "ADMIN만 초대할 수 있습니다. 화면을 새로 고칩니다." };
    case "signed-out":
      return { field: "root", message: SIGNED_OUT };
  }
}

export const INVITE_FAILURE = "초대하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

export function cancelFailure(
  status: Exclude<OrgInvitationCancelResult["status"], "done">,
): string {
  switch (status) {
    case "forbidden":
      return "ADMIN만 초대를 취소할 수 있습니다. 화면을 새로 고칩니다.";
    case "signed-out":
      return SIGNED_OUT;
    case "invalid":
      return CANCEL_FAILURE;
  }
}

export const CANCEL_FAILURE = "초대를 취소하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
export const cancelledToast = (email: string) => `${email} 초대를 취소했습니다`;

export const FORBIDDEN_COPY = {
  title: "이 화면을 볼 권한이 없습니다",
  body: (role: SolRole) =>
    `설정의 조직 탭은 업무 역할이 ADMIN인 구성원만 볼 수 있습니다. 지금 역할: ${role}`,
  back: "대시보드로",
} as const;

export const LOADING_LABEL = "조직 설정을 불러오는 중…";

export const formatOrgDate = (iso: string): string => formatKst(iso).slice(0, 10);
