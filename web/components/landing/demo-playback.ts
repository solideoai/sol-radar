import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

// 첫 화면의 두 데모(업무 데모 work-demo.tsx · 공고 분석 예시 analysis-demo.tsx)가 같이 쓰는 재생 조건.
// 화면에 30% 이상 보이고 탭이 보일 때만 흐른다. 움직임 줄이기면 흐르지 않는다(멈춘 화면은 데모마다 정한다).
// 상태는 단계 번호 하나이고, 단계마다 정한 시간이 지나면 다음 단계로 간다.

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const subscribeReducedMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION_QUERY).matches;

const subscribeTabVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};
const isTabVisible = () => document.visibilityState === "visible";

// 서버는 설정을 모른다. 첫 렌더(hydration)까지 이 값이고, 그 뒤 브라우저 값으로 바뀐다.
const onServer = { reducedMotion: () => false, tabVisible: () => true };

export const useReducedMotion = (): boolean =>
  useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, onServer.reducedMotion);

/** 요소가 화면에 30% 이상 보이고 탭도 보이는가. */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);
  const tabVisible = useSyncExternalStore(
    subscribeTabVisibility,
    isTabVisible,
    onServer.tabVisible,
  );

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.3,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return inView && tabVisible;
}

/** running 인 동안 단계마다 정한 시간이 지나면 다음 단계로 간다. 마지막 단계 뒤에는 처음으로 돌아간다. */
export function useStepLoop(steps: readonly { ms: number }[], running: boolean): number {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(
      () => setStep((value) => (value + 1) % steps.length),
      steps[step].ms,
    );
    return () => window.clearTimeout(timer);
  }, [running, step, steps]);

  return step;
}
