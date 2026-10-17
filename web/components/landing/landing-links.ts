import type { MyHome } from "@/server/organization";

// 첫 화면 구역으로 가는 링크. 머리말·바닥글이 같이 쓴다. id 는 각 구역 부품(components/landing/*-section.tsx)이 갖는다.
// 메뉴 이름과 구역의 짝: 주요 기능 → 기능 소개, 분석 방식 → 작동 방식(바로 뒤에 분석 원칙), 서비스 소개 → 문제 공감.
export const SECTION_LINKS = [
  { href: "/#features", label: "주요 기능" },
  { href: "/#analysis", label: "분석 방식" },
  { href: "/#about", label: "서비스 소개" },
] as const;

export const DEMO_HREF = "/#demo";
export const LOGIN_HREF = "/auth/login";
export const SIGN_UP_HREF = "/auth/sign-up";

// 로그인했지만 개인 조직이 없는 계정(missing)도 가입 화면으로 보낸다. 가입 화면이 로그인 화면으로 넘기고, 로그인 화면이 안내한다.
export const startHrefFor = (home: MyHome): string =>
  home.status === "signed-out" || home.status === "no-database" ? SIGN_UP_HREF : "/dashboard";
