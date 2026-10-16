import { Stack, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { Screen } from "@/components/screen";
import { colors, fonts, typography } from "@/theme/tokens";

export default function Home() {
  const router = useRouter();
  return (
    <Screen centered>
      {/* 헤더 제목을 정하지 않으면 경로 이름(index)이 제목으로 나온다. */}
      <Stack.Screen options={{ title: "홈" }} />
      <Card style={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          준비 완료
        </Text>
        <Text style={styles.body}>app/ 아래에 파일을 만들면 그게 곧 화면이 됩니다.</Text>
        <View style={styles.actions}>
          <Button
            label="로그인 견본 보기"
            variant="outline"
            onPress={() => router.push("/account")}
          />
        </View>
      </Card>
    </Screen>
  );
}

// 색·글꼴·글자 눈금은 theme/tokens.ts 에서만 가져온다. 색을 직접 적으면 check:colors 가 막는다.
// 글꼴은 글자마다 지정한다. 비워 두면 플랫폼 기본값이라 화면마다 달라진다.
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
