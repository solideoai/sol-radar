import type { Session } from "@supabase/supabase-js";
import { Stack } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Keyboard, StyleSheet, Text, View, type TextInput } from "react-native";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { Message } from "@/components/message";
import { Screen } from "@/components/screen";
import { StateView } from "@/components/state-view";
import { TextField } from "@/components/text-field";
import {
  credentialsFieldProblem,
  emailProblem,
  isDatabaseConfigured,
  loadMyProfile,
  PASSWORD_RESET_SENT,
  requestPasswordReset,
  saveDisplayName,
  SIGN_UP_MAIL_SENT,
  SIGNED_IN_ANNOUNCEMENT,
  SIGNED_OUT_ANNOUNCEMENT,
  signInMessage,
  signOutMessage,
  signUpMessage,
  DISPLAY_NAME_SAVED,
  parseDisplayName,
  type FieldProblem,
  type ProfileView,
} from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import { colors, fonts, typography } from "@/theme/tokens";

// 화면은 조립만 하고 규칙은 lib/profile.ts 에 있다. 누가 무엇을 읽는지는 RLS 가 정한다.
export default function AccountScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "계정" }} />
      {isDatabaseConfigured() ? (
        <Account />
      ) : (
        <StateView
          title="DB 가 연결되지 않았습니다"
          body="로컬은 pnpm db:start, 클라우드는 mobile/.env 를 채우면 로그인 견본이 동작합니다."
        />
      )}
    </>
  );
}

function Account() {
  // undefined 는 아직 저장된 세션을 읽는 중이다.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    // 구독하면 저장된 세션(INITIAL_SESSION)부터 알려 주고, 바뀔 때마다 다시 알려 준다.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <StateView isLoading body="불러오는 중…" />;
  return session ? <Profile userId={session.user.id} /> : <SignIn />;
}

type Notice = { tone: "error" | "info"; text: string };
type Pending = "sign-in" | "sign-up" | "reset" | null;

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldProblem, setFieldProblem] = useState<FieldProblem | null>(null);
  const [signInNotice, setSignInNotice] = useState<Notice | null>(null);
  const [resetNotice, setResetNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  // 검사를 통과하면 키보드를 닫아 결과 문구가 가려지지 않게 한다.
  const begin = (problem: FieldProblem | null): boolean => {
    setFieldProblem(problem);
    setSignInNotice(null);
    setResetNotice(null);
    if (problem) {
      (problem.field === "email" ? emailRef : passwordRef).current?.focus();
      return false;
    }
    Keyboard.dismiss();
    return true;
  };

  const signUp = async () => {
    if (!begin(credentialsFieldProblem(email, password))) return;
    setPending("sign-up");
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    setPending(null);
    if (error) setSignInNotice({ tone: "error", text: signUpMessage(error) });
    // 메일 확인을 끈 프로젝트는 세션이 바로 생겨 onAuthStateChange 가 화면을 프로필로 바꾼다.
    else if (data.session) AccessibilityInfo.announceForAccessibility(SIGNED_IN_ANNOUNCEMENT);
    else setSignInNotice({ tone: "info", text: SIGN_UP_MAIL_SENT });
  };

  const signIn = async () => {
    if (!begin(credentialsFieldProblem(email, password))) return;
    setPending("sign-in");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setPending(null);
    if (error) setSignInNotice({ tone: "error", text: signInMessage(error) });
    else AccessibilityInfo.announceForAccessibility(SIGNED_IN_ANNOUNCEMENT);
  };

  const sendReset = async () => {
    const issue = emailProblem(email);
    if (!begin(issue ? { field: "email", message: issue } : null)) return;
    setPending("reset");
    const result = await requestPasswordReset(supabase, email);
    setPending(null);
    setResetNotice(
      result.ok
        ? { tone: "info", text: PASSWORD_RESET_SENT }
        : { tone: "error", text: result.message },
    );
  };

  const isBusy = pending !== null;
  return (
    <Screen>
      <View style={styles.cards}>
        <Card style={styles.form}>
          <View style={styles.heading}>
            <Text style={styles.title} accessibilityRole="header">
              로그인
            </Text>
            <Text style={styles.body}>이메일과 비밀번호로 로그인합니다.</Text>
          </View>
          <TextField
            ref={emailRef}
            label="이메일"
            value={email}
            onChangeText={setEmail}
            error={fieldProblem?.field === "email" ? fieldProblem.message : null}
            isDisabled={isBusy}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <TextField
            ref={passwordRef}
            label="비밀번호"
            value={password}
            onChangeText={setPassword}
            error={fieldProblem?.field === "password" ? fieldProblem.message : null}
            isDisabled={isBusy}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={signIn}
          />
          <View style={styles.actions}>
            <Message text={signInNotice?.text ?? null} tone={signInNotice?.tone ?? "info"} />
            <Button
              label="로그인"
              busyLabel="로그인 중…"
              isBusy={pending === "sign-in"}
              isDisabled={isBusy}
              onPress={signIn}
            />
            <Button
              label="이 이메일로 가입"
              busyLabel="가입 중…"
              variant="outline"
              isBusy={pending === "sign-up"}
              isDisabled={isBusy}
              onPress={signUp}
            />
          </View>
        </Card>
        <Card style={styles.form}>
          <View style={styles.heading}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              비밀번호를 잊었나요?
            </Text>
            <Text style={styles.body}>
              위에 적은 이메일로 재설정 링크를 보냅니다. 링크는 웹에서 열립니다.
            </Text>
          </View>
          <View style={styles.actions}>
            <Message text={resetNotice?.text ?? null} tone={resetNotice?.tone ?? "info"} />
            <Button
              label="재설정 메일 받기"
              busyLabel="보내는 중…"
              variant="outline"
              isBusy={pending === "reset"}
              isDisabled={isBusy}
              onPress={sendReset}
            />
          </View>
        </Card>
      </View>
    </Screen>
  );
}

function Profile({ userId }: { userId: string }) {
  // undefined 는 읽는 중, null 은 행이 없음.
  const [profile, setProfile] = useState<ProfileView | null | undefined>(undefined);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  // 다시 시도하면 값이 바뀌어 읽기를 다시 한다.
  const [attempt, setAttempt] = useState(0);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutProblem, setSignOutProblem] = useState<string | null>(null);

  useEffect(() => {
    const state = { isCancelled: false };
    loadMyProfile(supabase, userId).then(
      (next) => {
        if (!state.isCancelled) setProfile(next);
      },
      (error: Error) => {
        if (!state.isCancelled) setLoadProblem(error.message);
      },
    );
    return () => {
      state.isCancelled = true;
    };
  }, [userId, attempt]);

  const retry = () => {
    setLoadProblem(null);
    setProfile(undefined);
    setAttempt((count) => count + 1);
  };

  const signOut = async () => {
    setSignOutProblem(null);
    setIsSigningOut(true);
    const { error } = await supabase.auth.signOut();
    setIsSigningOut(false);
    // 성공하면 onAuthStateChange 가 화면을 로그인으로 바꾼다. 오프라인이어도 기기의 세션은 지워진다.
    if (error) setSignOutProblem(signOutMessage(error.message));
    else AccessibilityInfo.announceForAccessibility(SIGNED_OUT_ANNOUNCEMENT);
  };

  const renderSignOut = (isDisabled: boolean) => (
    <>
      <Message text={signOutProblem} tone="error" />
      <Button
        label="로그아웃"
        busyLabel="로그아웃 중…"
        variant="outline"
        isBusy={isSigningOut}
        isDisabled={isDisabled}
        onPress={signOut}
      />
    </>
  );

  if (loadProblem !== null) {
    return (
      <StateView title="프로필을 불러오지 못했습니다" body={loadProblem}>
        <Button label="다시 시도" onPress={retry} />
        {renderSignOut(false)}
      </StateView>
    );
  }
  if (profile === undefined) return <StateView isLoading body="불러오는 중…" />;
  if (profile === null) {
    return (
      <StateView
        title="프로필이 없습니다"
        body="로그인은 됐지만 profiles 행이 없습니다. 가입 트리거보다 먼저 만든 계정일 수 있습니다."
      >
        {renderSignOut(false)}
      </StateView>
    );
  }
  return (
    <ProfileForm
      userId={userId}
      profile={profile}
      isSigningOut={isSigningOut}
      signOutSlot={renderSignOut}
    />
  );
}

function ProfileForm({
  userId,
  profile,
  isSigningOut,
  signOutSlot,
}: {
  userId: string;
  profile: ProfileView;
  isSigningOut: boolean;
  signOutSlot: (isDisabled: boolean) => ReactNode;
}) {
  const [name, setName] = useState(profile.displayName ?? "");
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const nameRef = useRef<TextInput>(null);

  const save = async () => {
    setNotice(null);
    const parsed = parseDisplayName(name);
    setNameProblem(parsed.ok ? null : parsed.message);
    if (!parsed.ok) {
      nameRef.current?.focus();
      return;
    }
    Keyboard.dismiss();
    setIsSaving(true);
    const result = await saveDisplayName(supabase, userId, name);
    setIsSaving(false);
    if (result.ok) {
      // 앞뒤 공백을 뗀 저장값으로 칸을 맞춘다.
      setName(result.displayName);
      setNotice({ tone: "info", text: DISPLAY_NAME_SAVED });
    } else {
      setNotice({ tone: "error", text: result.message });
    }
  };

  return (
    <Screen>
      <View style={styles.cards}>
        <Card style={styles.form}>
          <View style={styles.heading}>
            <Text style={styles.title} accessibilityRole="header">
              내 프로필
            </Text>
            <Text style={styles.body}>가입한 이메일과 역할을 확인하고, 표시 이름을 바꿉니다.</Text>
          </View>
          <View style={styles.facts}>
            <View>
              <Text style={styles.factLabel}>이메일</Text>
              <Text style={styles.factValue}>{profile.email}</Text>
            </View>
            <View>
              <Text style={styles.factLabel}>역할</Text>
              <Text style={styles.factValue}>{profile.role}</Text>
            </View>
          </View>
          <TextField
            ref={nameRef}
            label="표시 이름"
            value={name}
            onChangeText={(next) => {
              setName(next);
              setNotice(null);
              setNameProblem(null);
            }}
            error={nameProblem}
            isDisabled={isSaving || isSigningOut}
            autoCapitalize="none"
            autoComplete="nickname"
            textContentType="nickname"
            returnKeyType="done"
            onSubmitEditing={save}
          />
          <View style={styles.actions}>
            <Message text={notice?.text ?? null} tone={notice?.tone ?? "info"} />
            <Button
              label="저장"
              busyLabel="저장 중…"
              isBusy={isSaving}
              isDisabled={isSigningOut}
              onPress={save}
            />
          </View>
        </Card>
        {/* 로그아웃은 카드 밖에 둔다. 테두리 버튼은 흰 바탕이라 회색 위에서도 면이 된다. */}
        <View style={styles.actions}>{signOutSlot(isSaving)}</View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // 구역은 구분선이 아니라 카드로 나눈다.
  cards: { gap: 12 },
  form: { gap: 16 },
  heading: { gap: 8 },
  actions: { gap: 12 },
  title: { ...typography.title, color: colors.foreground, fontFamily: fonts.sans },
  sectionTitle: { ...typography.heading, color: colors.foreground, fontFamily: fonts.sans },
  body: { ...typography.body, color: colors.mutedForeground, fontFamily: fonts.sans },
  // 이메일·역할은 가로로 나란히 두지 않는다 — 긴 이메일과 큰 글꼴에서 줄이 깨지지 않게.
  facts: { gap: 12 },
  factLabel: { ...typography.label, color: colors.mutedForeground, fontFamily: fonts.sans },
  factValue: { ...typography.body, color: colors.foreground, fontFamily: fonts.sans },
});
