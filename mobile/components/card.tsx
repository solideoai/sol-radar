import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/theme/tokens";

// 줄을 이어 카드 하나로 보이는 목록도 같은 값을 쓰도록 내보낸다.
export const CARD_RADIUS = 20;
export const CARD_PADDING = 20;

type CardProps = {
  children: ReactNode;
  // 안쪽 배치(간격·정렬)만 넘긴다. 면의 색·모서리·여백은 카드가 정한다.
  style?: StyleProp<ViewStyle>;
};

// 테두리나 그림자 없이 회색 화면 바탕 위의 흰 면으로만 나뉜다.
export function Card({ children, style }: CardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { padding: CARD_PADDING, borderRadius: CARD_RADIUS, backgroundColor: colors.card },
});
