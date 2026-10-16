// 이 파일은 design/tokens.json 에서 생성됩니다. 손으로 고치지 마세요 (pnpm tokens).
import { Platform } from "react-native";

export const colors = {
  background: "#FFFFFF",
  foreground: "#191F28",
  card: "#FFFFFF",
  cardForeground: "#191F28",
  popover: "#FFFFFF",
  popoverForeground: "#191F28",
  primary: "#191F28",
  primaryForeground: "#FFFFFF",
  brand: "#1B64DA",
  brandForeground: "#FFFFFF",
  chart2: "#0E9F8E",
  kakao: "#FEE500",
  kakaoForeground: "#000000",
  naver: "#03A94D",
  naverForeground: "#FFFFFF",
  secondary: "#F2F4F6",
  secondaryForeground: "#333D4B",
  muted: "#F2F4F6",
  mutedForeground: "#5E6978",
  accent: "#F2F4F6",
  accentForeground: "#191F28",
  destructive: "#A51926",
  border: "#E5E8EB",
  input: "#D1D6DB",
  ring: "#1B64DA",
  sidebar: "#F9FAFB",
  sidebarForeground: "#333D4B",
  sidebarPrimary: "#191F28",
  sidebarPrimaryForeground: "#FFFFFF",
  sidebarAccent: "#EDEFF2",
  sidebarAccentForeground: "#191F28",
  sidebarBorder: "#E5E8EB",
  sidebarRing: "#1B64DA",
} as const;

// fontFamily 는 글꼴 이름 하나만 받으므로 플랫폼마다 하나를 고른다 (정본: tokens.json 의 nativeFonts).
export const fonts = {
  sans: Platform.select({ ios: "System", android: "sans-serif", default: "sans-serif" }),
  mono: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
} as const;

// 글자 눈금. letterSpacing 은 크기 × 자간이다 (정본: tokens.json 의 nativeTypography·tracking).
export const typography = {
  display: { fontSize: 36, lineHeight: 46, fontWeight: "700", letterSpacing: -0.72 },
  title: { fontSize: 26, lineHeight: 35, fontWeight: "700", letterSpacing: -0.52 },
  heading: { fontSize: 20, lineHeight: 29, fontWeight: "700", letterSpacing: -0.4 },
  body: { fontSize: 16, lineHeight: 26, letterSpacing: -0.32 },
  label: { fontSize: 15, lineHeight: 22, letterSpacing: -0.3 },
  caption: { fontSize: 13, lineHeight: 20, letterSpacing: -0.26 },
} as const;

export type ColorName = keyof typeof colors;
