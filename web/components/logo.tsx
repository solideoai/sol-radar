import { cn } from "cn";
import { LayersIcon } from "lucide-react";
// `pnpm bootstrap` 이 새 프로젝트를 만들 때 이 파일의 title 을 바꾼다.
import project from "@/project.json";

// 링크가 아니다 — 어디로 갈지는 쓰는 쪽이 Link 로 감싸 정한다.
// 감싸는 쪽에 min-w-0 이 없으면 긴 이름이 줄지 않고 옆 요소를 밀어 가로로 넘친다.
// inverted: 어두운 바탕(바닥글) 위에 둘 때 쓴다.
export function Logo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      {/* 마크는 장식이다. 이름이 바로 옆에 글자로 있다. */}
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg",
          inverted ? "bg-background text-foreground" : "bg-primary text-primary-foreground",
        )}
      >
        <LayersIcon className="size-4" />
      </span>
      <span
        className={cn(
          "truncate type-body font-semibold",
          inverted ? "text-background" : "text-foreground",
        )}
      >
        {project.title}
      </span>
    </span>
  );
}
