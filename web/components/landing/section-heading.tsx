// 구역 머리: 제목(h2) + 설명. 구역(section)은 aria-labelledby 로 이 h2 의 id 를 가리킨다.
// 제목 위에 작은 머리글을 두지 않는다 — 제목이 구역 이름이고, 메뉴 이름은 머리말이 이미 보인다.
export function SectionHeading({
  id,
  title,
  description,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <h2 id={id} className="max-w-220 type-headline text-balance text-foreground">
        {title}
      </h2>
      {description && (
        <p className="mt-5 max-w-190 type-lead text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
