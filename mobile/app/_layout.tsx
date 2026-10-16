import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors, fonts } from "@/theme/tokens";

// 헤더 글자에도 토큰 글꼴을 준다. 비워 두면 플랫폼 기본값이 된다.
// 헤더(흰 면)와 내용(회색)은 그림자 없이 면의 색으로만 나뉜다.
export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.foreground,
          headerTitleStyle: { fontFamily: fonts.sans },
          headerBackTitleStyle: { fontFamily: fonts.sans },
          contentStyle: { backgroundColor: colors.muted },
        }}
      />
    </>
  );
}
