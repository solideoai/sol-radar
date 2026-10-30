import { cn } from "cn";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// 잉크색 띠 하나로 본문을 끝맺는다. 제목은 다른 구역과 같이 왼쪽에 두고(가운데 정렬은 히어로 하나), 버튼은 오른쪽 끝에 둔다.
// 버튼은 시작하기 하나다 — 분석 예시 보기는 히어로에 있어 여기서 되풀이하지 않는다.
// 보조 글자는 흰 글자의 투명도로만 낮춘다(띠 위 대비 4.5:1 이상). 회색 토큰을 어두운 바탕에 올리지 않는다.
export function FinalCtaSection({ startHref }: { startHref: string }) {
  return (
    <section
      id="get-started"
      aria-labelledby="get-started-title"
      className="scroll-mt-24 bg-foreground text-background"
    >
      <div className="mx-auto flex w-full max-w-300 flex-col items-stretch justify-between gap-6 xl:flex-row xl:items-center xl:gap-16 px-4 sm:px-6 xl:px-10 py-12 xl:py-20">
        <div className="min-w-0">
          <h2
            id="get-started-title"
            className="max-w-180 type-subhead xl:type-headline text-balance"
          >
            다음 사업 검토, 근거부터 확인하세요.
          </h2>
          <p className="mt-5 max-w-190 type-body-lg text-background/75">
            우리 회사의 조건에 맞춰 공고를 비교하고, 검토할 사업의 우선순위를 정리하세요.
          </p>
        </div>
        {/* 어두운 바탕 위 흰 버튼. 초점 고리는 띠 색 틈을 두고 흰색으로 그려, 파랑 고리가 어두운 바탕에 묻히지 않게 한다. */}
        <Link
          href={startHref}
          className={cn(
            buttonVariants({ size: "xl" }),
            "bg-background text-foreground hover:bg-background/90 focus-visible:border-transparent focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground",
          )}
        >
          시작하기
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      </div>
    </section>
  );
}
