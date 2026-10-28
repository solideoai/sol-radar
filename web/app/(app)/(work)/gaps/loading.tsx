import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";
import { GAPS_CONTENT_CLASS, GAPS_DESCRIPTION, GAPS_TITLE } from "./gaps-copy";

const PULSE = "motion-reduce:animate-none";

// 정상 화면과 같은 자리(메타 → 요약 띠 → 고정 문구 → 가정 띠 → 표)를 잡아 둔다(디자인 스펙 §5 로딩).
export default function Loading() {
  return (
    <AppPage
      title={GAPS_TITLE}
      description={GAPS_DESCRIPTION}
      contentClassName={GAPS_CONTENT_CLASS}
    >
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">자격 갭을 계산하는 중…</span>
        <div aria-hidden className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Skeleton className={`h-4 w-96 ${PULSE}`} />
            <Skeleton className={`h-4 w-2/3 ${PULSE}`} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-5 gap-4">
              {[1, 2, 3, 4, 5].map((id) => (
                <Skeleton key={id} className={`h-24 w-full ${PULSE}`} />
              ))}
            </div>
            <Skeleton className={`h-4 w-3/4 ${PULSE}`} />
            <Skeleton className={`h-4 w-2/3 ${PULSE}`} />
          </div>
          <Skeleton className={`h-48 w-full ${PULSE}`} />
          <div className="mt-4 flex flex-col gap-1">
            <Skeleton className={`h-10 w-full ${PULSE}`} />
            {[1, 2, 3, 4, 5, 6].map((id) => (
              <Skeleton key={id} className={`h-11 w-full ${PULSE}`} />
            ))}
          </div>
        </div>
      </div>
    </AppPage>
  );
}
