import { cn } from "cn";

// 구역 머리: 작은 이름 + 제목(h2) + 설명. 구역(section)은 aria-labelledby 로 이 h2 의 id 를 가리킨다.
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      <p className="type-label font-medium text-brand">{eyebrow}</p>
      <h2 id={id} className="mt-3 type-headline text-balance text-foreground">
        {title}
      </h2>
      {description && <p className="mt-4 type-lead text-muted-foreground">{description}</p>}
    </div>
  );
}
