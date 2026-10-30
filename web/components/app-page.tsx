import { cn } from "cn";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
// 본문 랜드마크(main#main-content)는 여기서 그린다 — 앱 틀(app-shell)은 그리지 않는다.
// 머리는 경로(묶음 / 화면) → eyebrow → 제목 → 설명 → 1px 구분선이다(2026-10-28 화면 개편). 화면 이름은 위 막대가 아니라 여기 있다.
export function AppPage({
  eyebrow,
  title,
  description,
  actions,
  children,
  contentClassName,
  typeScale,
}: {
  // 제목 위 한 줄(뒤로 링크·배지 등). 공고 상세처럼 제목 앞에 맥락이 필요한 화면만 쓴다.
  eyebrow?: React.ReactNode;
  // 읽는 중(loading)에는 skeleton 을 넣을 수 있게 글자 외의 내용도 받는다.
  title: React.ReactNode;
  description?: React.ReactNode;
  // 주요 버튼(default)은 화면에 하나만 둔다.
  actions?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
  // 글자 범위 변형(design/tokens.json typographyScales). /dashboard 본문만 "dashboard" 로 키운다(ADR-030 B25).
  typeScale?: "dashboard";
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-type-scale={typeScale}
      className="min-w-0 flex-1 px-4 pt-4 pb-6 outline-none sm:px-6 lg:px-8"
    >
      <div className={cn("mx-auto flex w-full max-w-5xl flex-col gap-6", contentClassName)}>
        {/* 구분선 위아래 여백은 위 여백(pt-4)과 함께 줄여 잡았다. 발표 동선(/gaps 1440×900 첫 화면에 순위 1~3행)이
            구분선 때문에 첫 화면 밖으로 밀리지 않게 한다(gaps-view 브라우저 시험). */}
        <div data-slot="app-page-header" className="border-b border-border pb-4">
          {/* 경로는 버튼 줄 밖(위)에 둔다. 버튼(actions)이 경로가 아니라 eyebrow·제목 줄 높이에서 시작한다. */}
          <AppBreadcrumb />
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            {/* min-w-0 이 없으면 긴 제목이 버튼을 밀어 좁은 폭에서 가로로 넘친다. */}
            <div className="min-w-0">
              {eyebrow}
              {/* 띄어쓰기 없는 긴 제목(공고명 등)도 꺾여 단 폭을 넘지 않게 한다. */}
              <h1 className="type-title wrap-anywhere text-foreground">{title}</h1>
              {description ? (
                // break-keep 이라 띄어쓰기 없는 긴 이름(팀 이름 40자)이 꺾이지 않아 좁은 폭에서 넘친다. 그런 낱말만 꺾는다.
                <p className="mt-1 type-body wrap-anywhere text-muted-foreground">{description}</p>
              ) : null}
            </div>
            {actions}
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
