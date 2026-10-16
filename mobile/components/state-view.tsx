import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/card";
import { Screen } from "@/components/screen";
import { colors, fonts, typography } from "@/theme/tokens";

type StateViewProps = {
  title?: string;
  body: string;
  isLoading?: boolean;
  children?: ReactNode;
};

// 읽는 중에도 글이 함께 있어야 스크린 리더가 읽는다.
export function StateView({ title, body, isLoading = false, children }: StateViewProps) {
  return (
    <Screen centered>
      <Card style={styles.content}>
        {isLoading ? <ActivityIndicator size="large" color={colors.brand} /> : null}
        {title ? (
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        <Text style={styles.body}>{body}</Text>
        {children ? <View style={styles.actions}>{children}</View> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: "center", gap: 8 },
  title: {
    ...typography.title,
    textAlign: "center",
    color: colors.foreground,
    fontFamily: fonts.sans,
  },
  body: {
    ...typography.body,
    textAlign: "center",
    color: colors.mutedForeground,
    fontFamily: fonts.sans,
  },
  actions: { alignSelf: "stretch", gap: 12, marginTop: 16 },
});
