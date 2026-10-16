import { useHeaderHeight } from "expo-router/react-navigation";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/theme/tokens";

type ScreenProps = {
  children: ReactNode;
  // false 면 자식이 스스로 스크롤한다(FlatList). 이때 여백과 키보드 속성은 자식이 가진다.
  scroll?: boolean;
  // 내용이 화면보다 길면 위에서부터 스크롤한다.
  centered?: boolean;
};

// 상단 안전 영역은 헤더가 맡는다. 키보드는 iOS 에서 스크롤 뷰가 스스로 피하고, Android 는 엣지투엣지라
// 창이 줄지 않아 KeyboardAvoidingView 가 띄운다. iOS 에서 둘 다 켜면 두 번 밀리므로 iOS 에서는 끈다.
export function Screen({ children, scroll = true, centered = false }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
        enabled={Platform.OS === "android"}
      >
        <View style={[styles.fill, { paddingBottom: insets.bottom }]}>
          {scroll ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={[styles.content, centered && styles.centered]}
            >
              <View style={styles.column}>{children}</View>
            </ScrollView>
          ) : (
            children
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.muted },
  fill: { flex: 1 },
  content: { paddingHorizontal: 24, paddingVertical: 24 },
  centered: { flexGrow: 1, justifyContent: "center" },
  // 태블릿에서 폼이 화면 폭 전체로 늘어지지 않게 한다.
  column: { width: "100%", maxWidth: 560, alignSelf: "center" },
});
