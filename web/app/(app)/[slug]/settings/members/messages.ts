import { toast } from "sonner";
import type { InviteResult, MembershipChangeResult, OrgRole } from "@/server/organization";

// 서버의 ORG_ROLE_LABELS 와 같은 글자다 — 서버 모듈은 브라우저로 가져올 수 없다.
export const ROLE_LABELS: Record<OrgRole, string> = { member: "멤버", owner: "소유자" };

// 권한 없음은 그새 member 로 바뀌었거나 내보내진 경우다.
export const membershipFailure = (
  status: Exclude<MembershipChangeResult["status"], "saved">,
): string => {
  switch (status) {
    case "last-owner":
      return "마지막 소유자라 할 수 없습니다. 다른 멤버를 소유자로 바꾼 뒤 다시 시도해 주세요.";
    case "last-admin":
      return "마지막 관리자라 할 수 없습니다. 다른 구성원에게 ADMIN 역할을 부여한 뒤 다시 시도해 주세요.";
    case "forbidden":
      return "소유자만 할 수 있습니다. 화면을 새로 고칩니다.";
    case "signed-out":
      return "로그인이 풀렸습니다. 다시 로그인하세요.";
  }
};

export const UNKNOWN_FAILURE = "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

export type InviteSuccess = Extract<InviteResult, { status: "invited" | "renewed" }>;

export type InviteToast = { tone: "success" | "warning"; message: string };

const TELL_THEM = "초대받은 사람에게 직접 알려 주세요.";

// 초대는 저장됐고 메일 결과만 다르다. 메일 실패는 오류가 아니지만 할 일이 남아 경고로 가른다.
// 마침표는 한 문장이면 붙이지 않고, 두 문장이면 붙인다(다른 토스트와 같다).
export function inviteToastOf(email: string, result: InviteSuccess): InviteToast {
  const isNew = result.status === "invited";
  switch (result.mail) {
    case "sent":
      return {
        tone: "success",
        message: isNew
          ? `${email}을 초대하고 초대 메일을 보냈습니다`
          : `${email}의 초대 기한을 7일 늘리고 메일을 다시 보냈습니다`,
      };
    case "not-configured":
      return {
        tone: "success",
        message: isNew
          ? `${email}을 초대했습니다. ${TELL_THEM}`
          : `${email}의 초대 기한을 7일 늘렸습니다. ${TELL_THEM}`,
      };
    case "failed":
      return {
        tone: "warning",
        message: isNew
          ? `${email}을 초대했지만 메일을 보내지 못했습니다. ${TELL_THEM}`
          : `${email}의 초대 기한을 7일 늘렸지만 메일을 보내지 못했습니다. ${TELL_THEM}`,
      };
  }
}

// 초대 폼과 대기 중인 초대의 "다시 초대"가 같은 글을 쓴다.
// 메일 실패는 이 토스트 말고 남는 곳이 없어 오래(10초) 둔다. 마우스를 올리거나 초점을 두면 멈춘다(sonner 기본).
export function showInviteToast(email: string, result: InviteSuccess): void {
  const { tone, message } = inviteToastOf(email, result);
  if (tone === "warning") toast.warning(message, { duration: 10_000 });
  else toast.success(message);
}
