import { cn } from "cn";
import styles from "@/components/landing/marquee.module.css";

// 옆으로 끝없이 흐르는 줄. 움직임 패키지 없이 CSS 만 쓴다(스펙 2026-10-28-ui-refresh §4.5).
// children 은 <li> 들이다. 목록을 두 번 그려 이어 붙이고, 둘째 사본은 화면 낭독기가 두 번 읽지 않게 숨긴다(aria-hidden).
// 마우스를 올리거나 키보드 초점이 들어오면 멈춘다. 움직임 줄이기면 흐르지 않고 첫 사본만 줄을 바꿔 보인다.
// 줄은 화면 폭 전체를 쓰고 양 끝은 흐리게 지운다. 바깥 칸이 넘침을 잘라 페이지는 가로로 넘치지 않는다.
export function Marquee({
  label,
  align = "start",
  reverse = false,
  seconds,
  note,
  children,
}: {
  label: string;
  /** 제목(과 움직임 줄이기에서 줄 바꾼 목록)의 정렬. */
  align?: "start" | "center";
  reverse?: boolean;
  /** 한 바퀴(사본 하나만큼) 도는 시간. 항목이 많아도 같은 빠르기로 보이게 쓰는 쪽이 정한다. */
  seconds: number;
  /** 줄 아래 작은 글자 한 줄. */
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="py-7">
      <h2
        className={cn(
          "mx-auto w-full max-w-300 px-10 type-label-lg text-muted-foreground",
          align === "center" && "text-center",
        )}
      >
        {label}
      </h2>
      {/* 초점을 받을 수 있어야 키보드로도 멈출 수 있다. 안에는 링크·버튼이 없다. */}
      <div
        role="group"
        aria-label={`${label} 목록, 초점을 두면 멈춥니다`}
        tabIndex={0}
        data-testid="marquee-viewport"
        className={cn(
          styles.viewport,
          "mt-4 overflow-hidden outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          "[mask-image:linear-gradient(to_right,transparent,var(--foreground)_6%,var(--foreground)_94%,transparent)]",
          "motion-reduce:[mask-image:none]",
        )}
      >
        <div
          data-testid="marquee-track"
          className={cn(styles.track, reverse && styles.reverse, "flex w-max motion-reduce:w-full")}
          style={{ "--marquee-duration": `${seconds}s` } as React.CSSProperties}
        >
          <ul
            className={cn(
              "flex shrink-0 gap-4 pr-4 motion-reduce:mx-auto motion-reduce:w-full motion-reduce:max-w-300 motion-reduce:flex-wrap motion-reduce:px-10",
              align === "center" && "motion-reduce:justify-center",
            )}
          >
            {children}
          </ul>
          <ul aria-hidden className="flex shrink-0 gap-4 pr-4 motion-reduce:hidden">
            {children}
          </ul>
        </div>
      </div>
      {note && (
        <p className="mx-auto mt-3 w-full max-w-300 px-10 type-label text-muted-foreground">
          {note}
        </p>
      )}
    </section>
  );
}
