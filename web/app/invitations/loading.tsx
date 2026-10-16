import { AuthFrame, AuthHeader } from "@/components/auth-frame";
import { Skeleton } from "@/components/ui/skeleton";

// 제목은 진짜 글자로 둔다(page.tsx 와 같다).
export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AuthFrame>
      <AuthHeader title="받은 초대" />
      <div role="status">
        <span className="sr-only">받은 초대를 불러오는 중…</span>
        <ul aria-hidden className="divide-y divide-border border-y border-border">
          {[0, 1].map((key) => (
            <li key={key} className="flex flex-col gap-1 py-4">
              <Skeleton className={`h-6 w-32 max-w-full ${pulse}`} />
              <Skeleton className={`h-5 w-40 max-w-full ${pulse}`} />
              <Skeleton className={`h-4 w-24 ${pulse}`} />
              <div className="mt-3 flex gap-2">
                <Skeleton className={`h-8 w-14 ${pulse}`} />
                <Skeleton className={`h-8 w-14 ${pulse}`} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </AuthFrame>
  );
}
