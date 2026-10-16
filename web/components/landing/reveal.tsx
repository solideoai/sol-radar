"use client";

import { cn } from "cn";

// 스크롤 등장 효과. 값은 레퍼런스(edgelink.me)를 잰 그대로다 — 블록 높이의 20% 가 화면에 들어오면
// 아래 24px 에서 500ms 동안 떠오르며 나타나고(easeOutExpo 근사), 한 번 나타나면 다시 숨지 않는다. 형제 사이 시차는 없다.
//
// - 상태·effect 를 쓰지 않고 모듈 수준 ref 콜백이 DOM 의 data-reveal 만 바꾼다. 다시 그리지 않고,
//   함수 정체성이 고정이라 렌더마다 관찰을 다시 걸지 않는다.
// - 연결될 때 이미 화면 안이거나 위에 있는 블록(새로고침한 중간 위치, /#faq 직접 진입)은 숨기지 않는다.
//   보이던 것을 숨겼다가 다시 띄우면 깜빡임이 된다.
// - 숨김과 전환은 모두 motion-safe 변형에만 건다. JS 가 없거나 늦으면 내용이 그대로 보이고,
//   움직임 줄이기 설정이면 data-reveal 값과 관계없이 아무것도 숨거나 움직이지 않는다. 판단의 정본은 CSS 하나다.
// - 전환은 shown 에만 둔다. hidden 으로 바뀔 때 사라지는 전환이 돌지 않게 하기 위해서다.
//   Tailwind v4 의 translate-y-* 는 transform 이 아니라 translate 속성을 쓰므로 전환 대상은 opacity·translate 다.
const REVEAL_THRESHOLD = 0.2;

const REVEAL_CLASSES = [
  "motion-safe:data-[reveal=hidden]:opacity-0",
  "motion-safe:data-[reveal=hidden]:translate-y-6",
  "motion-safe:data-[reveal=shown]:transition-[opacity,translate]",
  "motion-safe:data-[reveal=shown]:duration-500",
  "motion-safe:data-[reveal=shown]:ease-[cubic-bezier(0.16,1,0.3,1)]",
];

// 정리 함수를 돌려주지 않은 경우(화면 안에서 시작한 블록) React 는 떼어낼 때 null 로 다시 부른다.
function observeReveal(element: HTMLElement | null) {
  if (!element || element.getBoundingClientRect().top < window.innerHeight) return;

  element.dataset.reveal = "hidden";
  // isIntersecting 은 1px 만 걸쳐도 참이 되므로 비율로 20% 를 확인한다.
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.intersectionRatio >= REVEAL_THRESHOLD)) return;
      element.dataset.reveal = "shown";
      observer.disconnect();
    },
    { threshold: REVEAL_THRESHOLD },
  );
  observer.observe(element);
  return () => observer.disconnect();
}

export function Reveal({
  as: Tag = "div",
  className,
  children,
}: {
  as?: "div" | "li";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag ref={observeReveal} className={cn(REVEAL_CLASSES, className)}>
      {children}
    </Tag>
  );
}
