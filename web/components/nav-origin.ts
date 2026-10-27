import { create } from "zustand";
import { parseViewOrigin, type ViewOrigin } from "@/components/bids/notice-origin";

// 사이드바 링크가 이어 가는 데이터 출처(?origin=). 발표는 /dashboard?origin=demo 북마크로 시작하는데, 사이드바 링크에
// 출처가 없으면 운영 기본 출처(실공고)로 바뀐다(2026-10-27 문서 정리의 문서 밖 발견 2). 공고 상세 같은 다른 화면 주소에는
// 출처가 없으므로, 출처를 읽는 목록 화면에서 마지막으로 본 출처를 이 창의 메모리에 기억한다. 새로 고치면 잊는다(주소가 정본이다).

/** 주소의 ?origin= 을 읽는 화면. 사이드바에서 이 화면으로 가는 링크에만 출처를 붙인다 */
const ORIGIN_AWARE_PATHS: readonly string[] = ["/dashboard", "/bids", "/watchlist"];

/** 다음에 기억할 출처. 출처를 읽는 화면이면 그 주소의 출처(없거나 틀리면 null = 기본 출처), 다른 화면이면 그대로 둔다 */
export const nextNavOrigin = (
  pathname: string,
  param: string | null,
  current: ViewOrigin | null,
): ViewOrigin | null => (ORIGIN_AWARE_PATHS.includes(pathname) ? parseViewOrigin(param) : current);

/** 사이드바 링크 주소. 출처를 읽는 화면이고, 기억한 출처가 기본 출처와 다를 때만 ?origin= 을 붙인다 */
export const navHrefOf = (
  href: string,
  origin: ViewOrigin | null,
  defaultOrigin: ViewOrigin | null,
): string =>
  origin !== null && origin !== defaultOrigin && ORIGIN_AWARE_PATHS.includes(href)
    ? `${href}?origin=${origin}`
    : href;

type NavOriginState = {
  origin: ViewOrigin | null;
  see: (pathname: string, param: string | null) => void;
};

// 레이아웃이 바뀌어도(업무 화면 ↔ 조직·인력 화면) 이어지도록 모듈 하나에 둔다.
export const useNavOriginStore = create<NavOriginState>()((set, get) => ({
  origin: null,
  see: (pathname, param) => {
    const next = nextNavOrigin(pathname, param, get().origin);
    if (next !== get().origin) set({ origin: next });
  },
}));
