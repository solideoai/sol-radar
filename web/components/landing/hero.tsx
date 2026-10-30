import { cn } from "cn";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { DEMO_HREF } from "@/components/landing/landing-links";
import { buttonVariants } from "@/components/ui/button";

// 흰 여백과 브랜드 색 버튼으로 메시지와 제품 화면을 잇는다. 첫 화면에서 가운데 정렬은 여기 하나다(나머지 구역 제목은 왼쪽).
// 등장 움직임은 히어로와 바로 아래 분석 예시에만 둔다 — 구역마다 같은 떠오르기를 되풀이하지 않는다.
export function Hero({ startHref }: { startHref: string }) {
  return (
    <section
      aria-labelledby="hero-title"
      className="mx-auto w-full max-w-300 px-4 sm:px-6 xl:px-10 pt-8 pb-6 text-center"
    >
      <div className="relative motion-safe:animate-in motion-safe:duration-500 motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
        <h1 id="hero-title" className="type-title sm:type-headline xl:type-display text-foreground">
          수많은 공고 속,
          <br />
          솔리데오가 검토할 사업부터
        </h1>
        <p className="mx-auto mt-4 max-w-190 type-body-lg xl:type-lead text-pretty text-muted-foreground">
          공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원 플랫폼입니다. 기업의 기술·자격·실적과 공고
          요구사항을 비교해 참가 자격, 사업 적합도, 추가 확인 사항을 한눈에 확인하세요.
        </p>
        {/* 주요 버튼(default)은 시작하기 하나다. 분석 예시 보기는 테두리 버튼으로 낮춘다. */}
        <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Link
            href={startHref}
            className={cn(
              buttonVariants({ size: "xl" }),
              "bg-brand text-brand-foreground hover:bg-brand/95",
            )}
          >
            시작하기
            <ArrowRightIcon aria-hidden className="size-4" />
          </Link>
          {/* buttonVariants 는 클래스를 이어 붙이기만 한다. cn 으로 합쳐야 outline 의 테두리가 바탕의 투명 테두리를 이긴다. */}
          <Link href={DEMO_HREF} className={cn(buttonVariants({ variant: "outline", size: "xl" }))}>
            분석 예시 보기
          </Link>
        </div>
      </div>
    </section>
  );
}
