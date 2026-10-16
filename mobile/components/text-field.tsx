import { useEffect, useState, type Ref } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { colors, fonts, typography } from "@/theme/tokens";

type TextFieldProps = Omit<TextInputProps, "style" | "editable" | "accessibilityLabel"> & {
  label: string;
  error?: string | null;
  // max 를 넘어도 입력은 막지 않고 숫자 색으로 알린다.
  counter?: { count: number; max: number };
  isDisabled?: boolean;
  ref?: Ref<TextInput>;
};

// 라벨과 오류는 칸의 접근성 이름에 합치고 화면의 글자는 숨겨 두 번 읽히지 않게 한다.
export function TextField({
  label,
  error,
  counter,
  isDisabled = false,
  multiline,
  onFocus,
  onBlur,
  ref,
  ...inputProps
}: TextFieldProps) {
  const [isFocused, setIsFocused] = useState(false);

  // RN 은 새로 뜬 오류를 저절로 읽지 않으므로 한 번 직접 알린다.
  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(`${label}: ${error}`);
  }, [label, error]);

  const isOver = counter !== undefined && counter.count > counter.max;
  return (
    <View style={styles.field}>
      <Text style={styles.label} aria-hidden>
        {label}
      </Text>
      <TextInput
        {...inputProps}
        ref={ref}
        multiline={multiline}
        editable={!isDisabled}
        accessibilityLabel={error ? `${label}, ${error}` : label}
        accessibilityState={{ disabled: isDisabled }}
        placeholderTextColor={colors.mutedForeground}
        // 선택 영역 색은 Android 에서 불투명하게 칠해져 글자를 가린다 — iOS 만 준다.
        selectionColor={Platform.OS === "ios" ? colors.brand : undefined}
        cursorColor={colors.brand}
        textAlignVertical={multiline ? "top" : "center"}
        onFocus={(event) => {
          setIsFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setIsFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          multiline && styles.multiline,
          // 두께는 그대로 두고 색만 바꿔 포커스에서 레이아웃이 밀리지 않게 한다. 오류는 포커스 중에도 우선한다.
          isFocused && styles.focused,
          error ? styles.invalid : null,
          isDisabled && styles.disabled,
        ]}
      />
      {error || counter ? (
        <View style={styles.footer}>
          {error ? (
            <Text style={styles.error} aria-hidden>
              {error}
            </Text>
          ) : null}
          {counter ? (
            <Text
              style={[styles.counter, isOver && styles.counterOver]}
              accessibilityLabel={`글자 수 ${counter.count}/${counter.max}`}
            >
              {counter.count}/{counter.max}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: {
    ...typography.label,
    fontWeight: "600",
    color: colors.foreground,
    fontFamily: fonts.sans,
  },
  input: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.input,
    borderRadius: 14,
    backgroundColor: colors.background,
    // 한 줄 칸에는 lineHeight 를 주지 않는다. iOS 에서 글자가 세로 가운데에서 벗어날 수 있다.
    fontSize: typography.body.fontSize,
    letterSpacing: typography.body.letterSpacing,
    color: colors.foreground,
    fontFamily: fonts.sans,
  },
  // 줄이 넘어가는 칸이라 줄 높이도 본문 눈금에서 가져온다. 144 를 넘으면 칸 안에서 스크롤한다.
  // 세로 여백은 한 줄일 때 높이가 52 로 남게 줄인다(테두리 1 + 12 + 26 + 12 + 테두리 1).
  multiline: {
    maxHeight: 144,
    paddingVertical: 12,
    lineHeight: typography.body.lineHeight,
  },
  focused: { borderColor: colors.ring },
  invalid: { borderColor: colors.destructive },
  disabled: { opacity: 0.5 },
  // 큰 글꼴에서 오류와 글자 수가 한 줄에 안 들어가면 글자 수가 아래로 내려간다.
  footer: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 6 },
  // 폼 알림(Message)과 같은 눈금을 쓴다.
  error: {
    flexShrink: 1,
    ...typography.label,
    color: colors.destructive,
    fontFamily: fonts.sans,
  },
  counter: {
    marginLeft: "auto",
    ...typography.caption,
    color: colors.mutedForeground,
    fontFamily: fonts.sans,
  },
  counterOver: { color: colors.destructive },
});
