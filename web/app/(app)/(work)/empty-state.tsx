import type { LucideIcon } from "lucide-react";

// 업무 화면의 빈 상태(스펙 §5.2·§5.3 상태표). 대시보드와 공고 목록이 같은 모양을 쓴다.
// 아이콘은 장식이라 숨기고, 제목 글자가 상태를 말한다.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-border px-6 py-10 text-center">
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <Icon className="size-5" />
      </span>
      <div>
        <p className="type-body font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mt-1 type-label text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

// 공고가 한 건도 없을 때(대시보드·목록 같은 문구, 06 §5.3·§5.4). 수집 실행 단추는 /admin/ingestion 이
// 확장 컷이라 두지 않고, ADMIN 에게만 요청 안내를 붙인다(스펙 §5.2 "(ADMIN) 관리자에게 수집을 요청하세요").
export const NO_BIDS_TITLE = "아직 수집된 공고가 없습니다";
export const NO_BIDS_HINT = "관리자에게 수집을 요청하세요";
