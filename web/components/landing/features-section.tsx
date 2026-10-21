import { cn } from "cn";
import { BellRingIcon, ChartNoAxesCombinedIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import {
  CollectPreview,
  HistoryPreview,
  QualifyPreview,
  ScorePreview,
} from "@/components/landing/feature-previews";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

type Feature = {
  id: string;
  title: string;
  body: string;
  icon: typeof SearchIcon;
  preview: React.ReactNode;
};

// 탐색 화면은 넓게, 나머지는 글과 화면을 좌우로 교차해 보여 준다.
const FEATURES: Feature[] = [
  {
    id: "collect",
    icon: SearchIcon,
    title: "공고 수집과 탐색",
    // Chrome 은 가운뎃점 앞을 줄바꿈 자리로 봐서 "·사업"처럼 점이 줄 맨 앞으로 떨어진다. 점 앞에 낱말 잇기(U+2060)를 둔다.
    body: "발주계획\u2060·사전규격\u2060·입찰공고를 모아, 기관\u2060·예산\u2060·마감\u2060·사업 단계 같은 조건으로 좁혀 봅니다.",
    preview: <CollectPreview />,
  },
  {
    id: "qualify",
    icon: ShieldCheckIcon,
    title: "기업 프로필 기반 자격 검토",
    body: "보유 기술·자격·실적을 공고의 필수 요건과 대조해 충족·미충족·확인 필요로 나눠 표시합니다.",
    preview: <QualifyPreview />,
  },
  {
    id: "score",
    icon: ChartNoAxesCombinedIcon,
    title: "SOL Score와 판단 근거",
    body: "적합도 점수를 요소별로 나누고 항목마다 근거를 붙여, 어떤 공고부터 검토할지 정하도록 돕습니다.",
    preview: <ScorePreview />,
  },
  {
    id: "history",
    icon: BellRingIcon,
    title: "검토 이력과 변경 알림",
    body: "담당자의 의견과 참여 결정을 기록하고, 관심 공고의 마감·예산·첨부 변경을 알려 줍니다.",
    preview: <HistoryPreview />,
  },
];

export function FeaturesSection() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="mx-auto w-full max-w-300 scroll-mt-24"
    >
      <div>
        <Reveal className="px-10 pt-24 pb-12">
          <SectionHeading
            id="features-title"
            title="검토에 필요한 정보를 한 흐름으로 모읍니다"
            description="공고 수집부터 참여 결정 기록까지, 담당자가 되풀이하던 확인 작업을 줄이는 데 집중합니다."
          />
          <p role="note" className="mt-5 max-w-190 type-label-lg text-muted-foreground">
            화면은 예시 데이터로 그렸습니다.
          </p>
        </Reveal>
        <ul>
          {FEATURES.map((feature, index) => (
            <Reveal as="li" key={feature.id} className="grid grid-cols-12 border-t border-border">
              <div
                className={cn(
                  "flex flex-col justify-center px-10 py-12",
                  index === 0 ? "col-span-12" : "col-span-5",
                  index % 2 === 1 && "order-last",
                )}
              >
                <h3 className="flex items-center gap-3 type-subhead text-foreground">
                  <feature.icon aria-hidden className="size-5 shrink-0 text-brand" />
                  {feature.title}
                </h3>
                <p className="mt-3.5 max-w-180 type-body-lg text-muted-foreground">
                  {feature.body}
                </p>
              </div>
              {/* 그림이다. 무엇을 그린 것인지는 왼쪽 제목과 설명이 말한다. */}
              <div
                aria-hidden
                inert
                className={cn(
                  "flex min-w-0 items-center overflow-hidden px-8 py-12",
                  index === 0 ? "col-span-12 border-t border-border px-14" : "col-span-7",
                  index % 2 === 0 ? "bg-brand/4" : "bg-muted/65",
                )}
              >
                <div className="w-full overflow-hidden rounded-xl border border-border bg-background shadow-lg shadow-foreground/5">
                  {feature.preview}
                </div>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
