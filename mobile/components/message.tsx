import { useEffect } from "react";
import { AccessibilityInfo, StyleSheet, Text } from "react-native";
import { colors, fonts, typography } from "@/theme/tokens";

type MessageProps = {
  text: string | null;
  tone: "error" | "info";
};

// RN 은 새로 뜬 문구를 스크린 리더가 읽지 않는다(iOS 는 alert 역할도 알리지 않는다).
// 그래서 글자가 바뀔 때 한 번 직접 알린다. 화면마다 빠뜨리지 않게 여기 둔다.
export function Message({ text, tone }: MessageProps) {
  useEffect(() => {
    if (text) AccessibilityInfo.announceForAccessibility(text);
  }, [text]);

  if (!text) return null;
  return (
    <Text
      style={[styles.text, tone === "error" ? styles.error : styles.info]}
      accessibilityRole={tone === "error" ? "alert" : undefined}
    >
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { ...typography.label, fontFamily: fonts.sans },
  error: { color: colors.destructive },
  info: { color: colors.foreground },
});
