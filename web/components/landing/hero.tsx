import { cn } from "cn";
import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { DEMO_HREF } from "@/components/landing/landing-links";
import { buttonVariants } from "@/components/ui/button";

// 첫 화면의 머리 구역. 미리보기(ProductPreviewSection)가 바로 아래에 붙어 화면의 중심이 된다.
// 위아래 여백은 13인치 노트북(1280×800) 첫 화면에도 판의 점수 고지까지 들어오게 잡았다.
// 제목은 한 줄에 다 들어가지 않아 줄을 직접 나눈다 — 자동 줄바꿈은 "사업부터." 만 다음 줄로 떨어뜨린다.
export function Hero({ startHref }: { startHref: string }) {
  return (
    <section aria-labelledby="hero-title" className="pt-10 pb-10">
      <div className="mx-auto w-full max-w-320 px-10 motion-safe:animate-in motion-safe:duration-500 motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
        <h1 id="hero-title" className="type-display text-foreground">
          수많은 공고 속,
          <br />
          우리 회사가 검토할 사업부터.
        </h1>
        <p className="mt-5 max-w-190 type-lead text-pretty text-muted-foreground">
          공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원 플랫폼입니다. 기업의 기술·자격·실적과 공고
          요구사항을 비교해 참가 자격, 사업 적합도, 추가 확인 사항을 한눈에 확인하세요.
        </p>
        {/* 주요 버튼(default)은 시작하기 하나다. 분석 예시 보기는 테두리 버튼으로 낮춘다. */}
        <div className="mt-8 flex items-center gap-3">
          <Link href={startHref} className={buttonVariants({ size: "xl" })}>
            시작하기
          </Link>
          {/* buttonVariants 는 클래스를 이어 붙이기만 한다. cn 으로 합쳐야 outline 의 테두리가 바탕의 투명 테두리를 이긴다. */}
          {/* 흰 바탕에서 기본 테두리(border)는 흐려 foreground 로 진하게 한다. */}
          <Link
            href={DEMO_HREF}
            className={cn(buttonVariants({ variant: "outline", size: "xl" }), "border-foreground")}
          >
            분석 예시 보기
          </Link>
        </div>
        {/* 시작하기 바로 곁에서 지금 쓸 수 있는 범위를 밝힌다. 맨 아래 CTA 의 안내만으로는 첫 화면에서 보이지 않는다. */}
        <p role="note" className="mt-4 flex items-center gap-2 type-ui-lg text-muted-foreground">
          <InfoIcon aria-hidden className="size-5 shrink-0 text-brand" />
          MVP 개발 중 · 지금은 계정 만들기와 로그인만 이용할 수 있습니다.
        </p>
      </div>
    </section>
  );
}
