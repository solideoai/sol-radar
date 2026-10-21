import { cn } from "cn";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { DEMO_HREF } from "@/components/landing/landing-links";
import { Reveal } from "@/components/landing/reveal";
import { buttonVariants } from "@/components/ui/button";

// 히어로와 같은 중앙 정렬과 버튼으로 마무리한다.
export function FinalCtaSection({ startHref }: { startHref: string }) {
  return (
    <section
      id="get-started"
      aria-labelledby="get-started-title"
      className="scroll-mt-24 border-t border-brand/10 bg-brand/4"
    >
      <div className="mx-auto w-full max-w-300">
        <Reveal className="px-10 py-24 text-center">
          <h2
            id="get-started-title"
            className="mx-auto max-w-180 type-headline text-balance text-foreground"
          >
            다음 사업 검토, 근거부터 확인하세요.
          </h2>
          <p className="mx-auto mt-5 max-w-190 type-body-lg text-muted-foreground">
            우리 회사의 조건에 맞춰 공고를 비교하고, 검토할 사업의 우선순위를 정리하세요.
          </p>
          {/* 주요 버튼(default)은 시작하기 하나다. 분석 예시 보기는 히어로와 같은 테두리 버튼이다. */}
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href={startHref}
              className={cn(
                buttonVariants({ size: "xl" }),
                "bg-brand text-brand-foreground shadow-sm shadow-brand/20 hover:bg-brand/95",
              )}
            >
              시작하기
              <ArrowRightIcon aria-hidden className="size-4" />
            </Link>
            <Link
              href={DEMO_HREF}
              className={cn(buttonVariants({ variant: "outline", size: "xl" }))}
            >
              분석 예시 보기
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
