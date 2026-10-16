import { cn } from "cn";
import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { DEMO_HREF } from "@/components/landing/landing-links";
import { Reveal } from "@/components/landing/reveal";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// 마지막 권유. 지금 이용할 수 있는 것(계정)과 개발 중인 것(공고 분석)을 나눠 밝힌다.
export function FinalCtaSection({ startHref }: { startHref: string }) {
  return (
    <section
      id="get-started"
      aria-labelledby="get-started-title"
      className="scroll-mt-20 px-8 pb-24"
    >
      <Reveal>
        <Card className="mx-auto w-full max-w-6xl gap-0 px-12 py-14">
          <div className="grid grid-cols-12 items-end gap-8">
            <div className="col-span-7">
              <h2 id="get-started-title" className="type-headline text-foreground">
                다음 사업 검토, 근거부터 확인하세요.
              </h2>
              <p className="mt-4 type-lead text-muted-foreground">
                우리 회사의 조건에 맞춰 공고를 비교하고,
                <br />
                검토할 사업의 우선순위를 정리하세요.
              </p>
            </div>
            <div className="col-span-5 flex items-center gap-3 justify-self-end">
              <Link href={startHref} className={buttonVariants({ size: "lg" })}>
                시작하기
              </Link>
              <Link
                href={DEMO_HREF}
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
              >
                분석 예시 보기
              </Link>
            </div>
          </div>
          <p
            role="note"
            className="mt-10 flex items-start gap-2 border-t border-border pt-6 type-label text-muted-foreground"
          >
            <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
            SOL RADAR는 MVP를 개발하고 있습니다. 지금은 계정 만들기와 로그인을 이용할 수 있고, 공고
            분석 기능은 개발 중입니다.
          </p>
        </Card>
      </Reveal>
    </section>
  );
}
