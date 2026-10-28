import { cn } from "cn";
import Image from "next/image";
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
      {/* 이름은 옆 글자와 링크가 제공한다. 접힌 사이드바에서도 심볼의 세부가 보이게 한다. */}
      <Image
        src="/logo/sol-radar.webp"
        alt=""
        width={32}
        height={32}
        className="size-8 shrink-0 object-contain"
      />
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
