import { cn } from "cn";
import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { DEMO_HREF } from "@/components/landing/landing-links";
import { Reveal } from "@/components/landing/reveal";
import { buttonVariants } from "@/components/ui/button";

// 마지막 권유. 지금 이용할 수 있는 것(계정)과 개발 중인 것(공고 분석)을 나눠 밝힌다.
// 화면 폭 회색 띠는 히어로 아래 제품 화면 무대와 같은 재료다 — 처음과 끝이 맞물린다. 카드로 감싸지 않는다.
export function FinalCtaSection({ startHref }: { startHref: string }) {
  return (
    <section id="get-started" aria-labelledby="get-started-title" className="scroll-mt-24 pt-36">
      <div className="bg-muted">
        {/* 띠는 처음부터 보이고 안쪽 글과 버튼만 떠오른다. 빈 바탕이 나타나는 움직임은 뜻이 없다. */}
        <Reveal className="mx-auto w-full max-w-320 px-10 py-24">
          <h2 id="get-started-title" className="type-headline text-foreground">
            다음 사업 검토, 근거부터 확인하세요.
          </h2>
          <p className="mt-5 max-w-190 type-lead text-foreground/80">
            우리 회사의 조건에 맞춰 공고를 비교하고, 검토할 사업의 우선순위를 정리하세요.
          </p>
          {/* 주요 버튼(default)은 시작하기 하나다. 분석 예시 보기는 히어로와 같은 테두리 버튼이다. */}
          <div className="mt-9 flex items-center gap-3">
            <Link href={startHref} className={buttonVariants({ size: "xl" })}>
              시작하기
            </Link>
            <Link
              href={DEMO_HREF}
              className={cn(
                buttonVariants({ variant: "outline", size: "xl" }),
                "border-foreground hover:bg-foreground/5",
              )}
            >
              분석 예시 보기
            </Link>
          </div>
          <p role="note" className="mt-6 flex items-center gap-2 type-ui-lg text-foreground/80">
            <InfoIcon aria-hidden className="size-5 shrink-0 text-brand" />
            SOL RADAR는 MVP를 개발하고 있습니다. 지금은 계정 만들기와 로그인을 이용할 수 있고, 공고
            분석 기능은 개발 중입니다.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
