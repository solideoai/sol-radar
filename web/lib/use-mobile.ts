import { useSyncExternalStore } from "react";

// 사이드바가 서랍으로 바뀌는 폭. Tailwind 의 md(768px) 바로 아래다 — sidebar 부품이 md: 로 데스크톱 모양을 켜므로 둘이 같아야 한다.
const MOBILE_QUERY = "(max-width: 767px)";

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const isMobileNow = () => window.matchMedia(MOBILE_QUERY).matches;

// 서버는 폭을 모른다. 첫 렌더(hydration)까지 false 이고, 그 뒤 진짜 폭으로 바뀐다.
const isMobileOnServer = () => false;

// shadcn 원본의 effect 안 setState 는 린트가 막는다. 브라우저 값을 그대로 구독한다.
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileNow, isMobileOnServer);
}
