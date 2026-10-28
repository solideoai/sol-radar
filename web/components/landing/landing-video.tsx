"use client";

import { PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LandingVideoFiles } from "@/components/landing/showcase-data";
import { Button } from "@/components/ui/button";

// 히어로와 흐르는 줄 사이의 녹화 영상(06-UI-UX §3.4). 소리가 없고 끝나면 처음부터 되풀이한다.
// autoPlay 속성은 두지 않는다. 화면이 열리면 움직임 줄이기가 아닐 때만 스스로 튼다.
// 움직임 줄이기면 멈춘 포스터에 재생 조작 막대를 보여, 보고 싶은 사람만 튼다. 브라우저가 자동 재생을 막아도 같은 모양이 된다.
// 스스로 도는 동안에는 오른쪽 아래 멈춤·재생 버튼을 늘 보인다(WCAG 2.2.2). 조작 막대가 보일 때는 겹치지 않게 숨긴다.

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION_QUERY).matches;

// 서버는 설정을 모른다. 첫 렌더(hydration)까지 false 이고, 그 뒤 진짜 값으로 바뀐다.
const prefersReducedMotionOnServer = () => false;

export function LandingVideo({ video }: { video: LandingVideoFiles }) {
  const ref = useRef<HTMLVideoElement>(null);
  // 사용자가 버튼으로 멈췄는지. 멈췄으면 다시 누를 때까지 스스로 틀지 않는다.
  const pausedByUser = useRef(false);
  const reducedMotion = useSyncExternalStore(
    subscribe,
    prefersReducedMotion,
    prefersReducedMotionOnServer,
  );
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [playing, setPlaying] = useState(false);
  const showControls = reducedMotion || autoplayBlocked;

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    // hydration 첫 렌더는 서버 값(false)이라, 틀기 전에 브라우저 설정을 직접 한 번 더 본다.
    if (reducedMotion || prefersReducedMotion()) {
      element.pause();
      return;
    }
    if (pausedByUser.current) return;
    // 소리 없는 영상만 사용자 동작 없이 틀 수 있다. 그래도 막히면(저전력 모드 등) 조작 막대를 보인다.
    element.muted = true;
    element.play().catch(() => setAutoplayBlocked(true));
  }, [reducedMotion]);

  const togglePlayback = () => {
    const element = ref.current;
    if (element === null) return;
    if (element.paused) {
      pausedByUser.current = false;
      element.play().catch(() => setAutoplayBlocked(true));
    } else {
      pausedByUser.current = true;
      element.pause();
    }
  };

  return (
    <section aria-label="SOL RADAR 화면 녹화" className="mx-auto w-full max-w-300 px-10 pb-6">
      <div className="relative">
        <video
          ref={ref}
          aria-label="SOL RADAR 업무 화면을 차례로 보여 주는 녹화 영상(소리 없음)"
          width={1440}
          height={900}
          muted
          loop
          playsInline
          preload="metadata"
          poster={video.poster}
          controls={showControls}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="block h-auto w-full rounded-lg border border-border bg-muted"
        >
          <source src={video.webm} type="video/webm" />
          <source src={video.mp4} type="video/mp4" />
        </video>
        {!showControls && (
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={playing ? "영상 멈춤" : "영상 재생"}
            onClick={togglePlayback}
            className="absolute right-3 bottom-3 bg-background/90"
          >
            {playing ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
          </Button>
        )}
      </div>
    </section>
  );
}
