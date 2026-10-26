import { cn } from "cn";
// `pnpm bootstrap` 이 새 프로젝트를 만들 때 이 파일의 title 을 바꾼다.
import project from "@/project.json";

// 링크가 아니다 — 어디로 갈지는 쓰는 쪽이 Link 로 감싸 정한다.
// 감싸는 쪽에 min-w-0 이 없으면 긴 이름이 줄지 않고 옆 요소를 밀어 가로로 넘친다.
// inverted: 어두운 바탕(바닥글) 위에 둘 때 쓴다.
// wordmarkClassName: 글자에만 붙는 클래스. 앱 사이드바는 접었을 때 글자를 숨기고 마크만 남긴다.
export function Logo({
  className,
  wordmarkClassName,
  inverted = false,
}: {
  className?: string;
  wordmarkClassName?: string;
  inverted?: boolean;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.25", className)}>
      {/* 마크는 장식이다. 이름이 바로 옆에 글자로 있다. 점만 brand 이고, 어두운 바탕에서는 세 도형이 한 색이다. */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className={cn("size-6.5 shrink-0", inverted ? "text-background" : "text-foreground")}
      >
        <path d="M2 2H11.4V5.4H5.4V11.4H2Z" fill="currentColor" />
        <path d="M22 22H12.6V18.6H18.6V12.6H22Z" fill="currentColor" />
        <circle cx="12" cy="12" r="3.1" className={inverted ? "fill-current" : "fill-brand"} />
      </svg>
      <span
        className={cn(
          "truncate type-wordmark",
          inverted ? "text-background" : "text-foreground",
          wordmarkClassName,
        )}
      >
        {project.title}
      </span>
    </span>
  );
}
