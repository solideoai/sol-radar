import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors, fonts, typography } from "@/theme/tokens";

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "filled" | "outline";
  isBusy?: boolean;
  busyLabel?: string;
  isDisabled?: boolean;
  // 글자와 다른 이름이 필요할 때만(목록 줄의 삭제 등).
  accessibilityLabel?: string;
};

// 눌림은 투명도로 보인다. Android 물결은 색을 직접 적어야 해서 쓰지 않는다.
export function Button({
  label,
  onPress,
  variant = "filled",
  isBusy = false,
  busyLabel,
  isDisabled = false,
  accessibilityLabel,
}: ButtonProps) {
  const isFilled = variant === "filled";
  const textColor = isFilled ? colors.brandForeground : colors.foreground;
  const inactive = isBusy || isDisabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: isBusy, disabled: inactive }}
      style={({ pressed }) => [
        styles.base,
        isFilled ? styles.filled : styles.outline,
        pressed && styles.pressed,
        isDisabled && !isBusy && styles.disabled,
      ]}
    >
      {isBusy ? <ActivityIndicator size="small" color={textColor} /> : null}
      <Text style={[styles.label, { color: textColor }]}>
        {isBusy && busyLabel ? busyLabel : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    // 글자를 키우면 내용만큼 자라도록 최소 높이만 준다.
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    // 채움 변형도 테두리를 가져야 두 변형의 높이가 같다.
    borderWidth: 1,
    borderRadius: 16,
    // 가로 줄에서는 글자만큼 차지하고 줄어들지 않는다. 세로로 쌓으면 폭이 꽉 찬다.
    flexShrink: 0,
  },
  filled: { borderColor: colors.brand, backgroundColor: colors.brand },
  // 흰 바탕을 깔아 회색 화면 바탕 위에서도 면으로 보인다.
  outline: { borderColor: colors.input, backgroundColor: colors.background },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  label: { ...typography.body, fontWeight: "600", textAlign: "center", fontFamily: fonts.sans },
});
