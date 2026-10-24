import { cn } from "cn";
import Link from "next/link";
import { saveMyPhotoAction } from "@/app/account/actions";
import { DisplayNameForm } from "@/app/account/display-name-form";
import { PhotoPicker } from "@/components/photo/photo-picker";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import {
  enabledSocialProviders,
  socialProviderOf,
  SUPABASE_PROVIDER_ID,
  type SocialProvider,
} from "@/lib/auth-providers";
import { initialOf } from "@/lib/utils";
import { getMyLoginMethods, type LinkOutcome, type LoginMethod } from "@/server/auth";
import { getMyProfile, type ProfileView } from "@/server/profile";
import type { MyLoginMethods } from "@/server/auth";
import { nameOf } from "@/server/shared";
import { DeleteAccount } from "@/app/(app)/[slug]/settings/delete-account";
import {
  LOGIN_METHODS_HEADING_ID,
  LoginMethods,
  type LoginMethodRow,
} from "@/app/(app)/[slug]/settings/login-methods";
import { SessionActions } from "@/app/(app)/[slug]/settings/session-actions";
import { SettingsSection } from "@/app/(app)/[slug]/settings/settings-section";
import {
  KAKAO_NOTIFY_HEADING_ID,
  KakaoNotifySection,
} from "@/app/(app)/[slug]/settings/kakao-notify-section";
import type { KakaoConnectOutcome, KakaoNotifyView } from "@/server/kakao-notify";

const LINK_OUTCOMES: readonly LinkOutcome[] = [
  "linked",
  "identity_already_exists",
  "manual_linking_disabled",
  "failed",
];

// 회사 라벨(구글·카카오·네이버)은 도메인이 정한다(LoginMethod.label). 아직 연결하지 않은 줄의 라벨만 여기서 붙인다.
const SOCIAL_LABELS: Record<SocialProvider, string> = {
  google: "구글",
  kakao: "카카오",
  naver: "네이버",
};
// 줄 순서는 고정이다 — 연결·해제해도 줄 자리가 바뀌지 않는다. 모르는 제공자는 뒤에 라벨 순으로.
const orderOf = (provider: string) => {
  const known = ["email", "google", "kakao", "custom:naver"].indexOf(provider);
  return known === -1 ? Number.MAX_SAFE_INTEGER : known;
};

// 서버의 시간대(UTC)와 상관없이 서울 날짜로 적는다.
const seoulDate = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });

const detailOf = (method: LoginMethod): string => {
  if (method.email) return method.email;
  return method.linkedAt ? `${seoulDate.format(new Date(method.linkedAt))}에 연결` : "연결됨";
};

// 연결된 것 + 켜 둔 제공자 가운데 아직 연결하지 않은 것. 켜 둔 목록에서 빠진 제공자라도 연결돼 있으면 보인다(해제할 수 있게).
function toRows(methods: readonly LoginMethod[]): LoginMethodRow[] {
  const linked: LoginMethodRow[] = methods.map((method) => ({
    key: method.identityId,
    provider: method.provider,
    label: method.label,
    detail: detailOf(method),
    email: method.email,
    identityId: method.identityId,
    linkProvider: null,
  }));
  const linkedProviders = new Set(methods.map((method) => socialProviderOf(method.provider)));
  const available: LoginMethodRow[] = enabledSocialProviders
    .filter((provider) => !linkedProviders.has(provider))
    .map((provider) => ({
      key: `link-${provider}`,
      provider: SUPABASE_PROVIDER_ID[provider],
      label: SOCIAL_LABELS[provider],
      detail: "연결되지 않음",
      email: null,
      identityId: null,
      linkProvider: provider,
    }));
  return [...linked, ...available].toSorted(
    (a, b) => orderOf(a.provider) - orderOf(b.provider) || a.label.localeCompare(b.label, "ko"),
  );
}

export async function loadAccountSettings() {
  const [me, login] = await Promise.all([getMyProfile(), getMyLoginMethods()]);
  return { me, login };
}

export function AccountSettings({
  profile,
  login,
  link,
  settingsPath,
  kakao,
}: {
  profile: ProfileView;
  login: Extract<MyLoginMethods, { status: "ready" }>;
  link?: string;
  settingsPath: string;
  // 개인 설정(/<slug>/settings)만 넘긴다. 업무 조직 없는 계정 화면(/auth/account)에는 칸이 없다 — 추천 공고를 받을 조직이 없다.
  kakao?: { view: KakaoNotifyView; outcome: KakaoConnectOutcome | null };
}) {
  const outcome = LINK_OUTCOMES.find((known) => known === link) ?? null;
  const name = nameOf(profile.displayName, profile.email);
  const hasEmailLogin = login.methods.some((method) => method.provider === "email");
  const socialLabels = login.methods
    .filter((method) => method.provider !== "email")
    .map((method) => method.label);

  return (
    <div className="@container">
      <div className="divide-y divide-border">
        <SettingsSection
          id="settings-profile"
          title="프로필"
          description="사진과 표시 이름을 바꾸고 이메일·계정 유형을 확인합니다."
        >
          <div className="flex items-center gap-3">
            <Avatar size="lg" aria-hidden>
              {profile.avatarUrl ? (
                // 올린 사진(signed URL)이나 제공자 사진이다. 다른 사이트로 이 화면 주소를 보내지 않는다.
                <AvatarImage src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" />
              ) : null}
              <AvatarFallback>{initialOf(name)}</AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 gap-1.5">
              <span className="truncate type-body font-medium text-foreground" title={name}>
                {name}
              </span>
              <PhotoPicker
                objectPrefix={`users/${profile.userId}`}
                hasPhoto={profile.hasOwnPhoto}
                save={saveMyPhotoAction}
                subject="내 사진"
              />
              <span className="type-caption text-muted-foreground">
                {profile.orgChartLinked
                  ? "올린 사진은 조직도에도 함께 보입니다."
                  : "올린 사진이 없으면 로그인 수단의 사진을 씁니다. JPG·PNG·WEBP, 10MB 이하."}
              </span>
            </div>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 type-body">
            <dt className="text-muted-foreground">이메일</dt>
            {profile.email ? (
              // 잘린 주소는 title 과 사이드바의 사용자 메뉴에서 끝까지 볼 수 있다.
              <dd className="truncate text-foreground" title={profile.email}>
                {profile.email}
              </dd>
            ) : (
              <dd>
                <span className="text-muted-foreground">없음</span>
                <span className="block type-caption text-muted-foreground">
                  가입한 로그인 수단이 이메일을 알려 주지 않았습니다.
                </span>
              </dd>
            )}
            {/* 조직 안 역할(소유자·멤버)과 헷갈리지 않게 "역할"이라 부르지 않는다. */}
            <dt className="text-muted-foreground">계정 유형</dt>
            <dd className="text-foreground">{profile.role}</dd>
          </dl>
          <DisplayNameForm displayName={profile.displayName} />
        </SettingsSection>
        <SettingsSection
          id={LOGIN_METHODS_HEADING_ID}
          title="로그인 수단"
          description="로그인에 쓰는 계정을 연결하거나 해제합니다. 연결한 어느 수단으로든 이 계정에 로그인합니다."
          focusable
        >
          <LoginMethods
            rows={toRows(login.methods)}
            canUnlink={login.canUnlink}
            settingsPath={settingsPath}
            outcome={outcome}
          />
        </SettingsSection>
        {kakao ? (
          <SettingsSection
            id={KAKAO_NOTIFY_HEADING_ID}
            title="카카오톡 알림"
            description="추천 공고(BID·WATCH 권고)가 나오면 내 카톡 '나와의 채팅'으로 받습니다."
          >
            <KakaoNotifySection view={kakao.view} outcome={kakao.outcome} />
          </SettingsSection>
        ) : null}
        <SettingsSection
          id="settings-password"
          title="비밀번호"
          description={
            hasEmailLogin
              ? "가입한 이메일로 재설정 링크를 받아 새 비밀번호를 정합니다."
              : "이메일로 로그인하지 않는 계정이라 비밀번호가 없습니다."
          }
        >
          {hasEmailLogin ? (
            // buttonVariants 는 클래스를 이어 붙이기만 한다. cn 으로 합쳐야 덧붙인 클래스가 바탕의 것을 이긴다.
            <Link
              href="/auth/reset"
              className={cn(buttonVariants({ variant: "outline" }), "self-start")}
            >
              재설정 메일 받으러 가기
            </Link>
          ) : (
            <p className="type-body text-muted-foreground">
              연결한 {socialLabels.join(" · ")} 계정으로 로그인합니다.
            </p>
          )}
        </SettingsSection>
        <SettingsSection
          id="settings-session"
          title="세션"
          description="이 브라우저에서만 로그아웃하거나, 로그인한 모든 기기에서 한 번에 로그아웃합니다."
        >
          <SessionActions />
        </SettingsSection>
        <SettingsSection
          id="settings-delete"
          title="회원 탈퇴"
          description="계정과 개인 공간을 바로 지웁니다. 되돌릴 수 없습니다."
        >
          <DeleteAccount />
        </SettingsSection>
      </div>
    </div>
  );
}
