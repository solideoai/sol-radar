import { isHttpUrl } from "@/components/bids/external-url";

// 공고 원문 링크(새 탭). 주소가 http·https 가 아니면 링크를 만들지 않고 주소를 글자로만 보인다(누를 수 없는 버튼 모양도 두지 않는다).
function SourceLink({
  href,
  className,
  ariaLabel,
  children,
}: {
  href: string;
  className?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  if (!isHttpUrl(href)) {
    return (
      <span className="type-caption text-muted-foreground wrap-anywhere">원문 주소 {href}</span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className={className}
    >
      {children}
    </a>
  );
}

export { SourceLink };
