import { cn } from "cn";
// 본문 랜드마크(main#main-content)는 여기서 그린다 — 앱 틀(app-shell)은 그리지 않는다.
export function AppPage({
  title,
  description,
  actions,
  children,
  contentClassName,
}: {
  title: string;
  description?: React.ReactNode;
  // 주요 버튼(default)은 화면에 하나만 둔다.
  actions?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  return (
    <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
      <div className={cn("mx-auto flex w-full max-w-5xl flex-col gap-6", contentClassName)}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          {/* min-w-0 이 없으면 긴 제목이 버튼을 밀어 좁은 폭에서 가로로 넘친다. */}
          <div className="min-w-0">
            <h1 className="type-title text-foreground">{title}</h1>
            {description ? (
              // break-keep 이라 띄어쓰기 없는 긴 이름(팀 이름 40자)이 꺾이지 않아 좁은 폭에서 넘친다. 그런 낱말만 꺾는다.
              <p className="mt-1 type-body wrap-anywhere text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </main>
  );
}
