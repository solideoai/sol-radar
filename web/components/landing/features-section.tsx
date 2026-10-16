import { cn } from "cn";
import {
  ClipboardCheckIcon,
  GaugeIcon,
  HistoryIcon,
  InfoIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react";
import {
  CollectPreview,
  HistoryPreview,
  QualifyPreview,
  ScorePreview,
} from "@/components/landing/feature-previews";
import { IconChip } from "@/components/landing/icon-chip";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";
import { PlannedBadge } from "@/components/landing/status-badges";
import { Card } from "@/components/ui/card";

type Feature = {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  preview: React.ReactNode;
  span: string;
};

// 칸 너비를 엇갈려(7·5 / 5·7) 같은 카드가 줄지어 반복되지 않게 한다.
// 지금은 어느 기능도 구현되지 않았다(Phase 0 전). 카드마다 "개발 예정"을 붙이고, 구현되면 그 카드에서 뗀다.
const FEATURES: Feature[] = [
  {
    id: "collect",
    icon: SearchIcon,
    title: "공고 수집과 탐색",
    body: "발주계획·사전규격·입찰공고를 모아, 기관·예산·마감·사업 단계 같은 조건으로 좁혀 봅니다.",
    preview: <CollectPreview />,
    span: "col-span-7",
  },
  {
    id: "qualify",
    icon: ClipboardCheckIcon,
    title: "기업 프로필 기반 자격 검토",
    body: "보유 기술·자격·실적을 공고의 필수 요건과 대조해 충족·미충족·확인 필요로 나눠 표시합니다.",
    preview: <QualifyPreview />,
    span: "col-span-5",
  },
  {
    id: "score",
    icon: GaugeIcon,
    title: "SOL Score와 판단 근거",
    body: "적합도 점수를 요소별로 나누고 항목마다 근거를 붙여, 어떤 공고부터 검토할지 정하도록 돕습니다.",
    preview: <ScorePreview />,
    span: "col-span-5",
  },
  {
    id: "history",
    icon: HistoryIcon,
    title: "검토 이력과 변경 알림",
    body: "담당자의 의견과 참여 결정을 기록하고, 관심 공고의 마감·예산·첨부 변경을 알려 줍니다.",
    preview: <HistoryPreview />,
    span: "col-span-7",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-20 px-8 py-24">
      <div className="mx-auto w-full max-w-6xl">
        <Reveal>
          <SectionHeading
            id="features-title"
            eyebrow="주요 기능"
            title="검토에 필요한 정보를 한 흐름으로 모읍니다"
            description="공고 수집부터 참여 결정 기록까지, 담당자가 되풀이하던 확인 작업을 줄이는 데 집중합니다."
          />
          <p
            role="note"
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 type-label text-muted-foreground"
          >
            <InfoIcon aria-hidden className="size-4 shrink-0 text-brand" />
            SOL RADAR는 MVP를 개발하고 있습니다. 아래 기능은 모두 개발 예정이며 아직 이용할 수
            없습니다. 카드 아래 화면은 예시 데이터로 그린 그림입니다.
          </p>
        </Reveal>
        <ul className="mt-10 grid grid-cols-12 gap-6">
          {FEATURES.map((feature) => (
            <Reveal as="li" key={feature.id} className={cn("flex", feature.span)}>
              <Card className="w-full gap-0 py-0 hover:shadow-sm motion-safe:transition-shadow">
                <div className="flex flex-col gap-3 p-6">
                  <div className="flex items-center justify-between gap-3">
                    <IconChip icon={feature.icon} />
                    <PlannedBadge />
                  </div>
                  <h3 className="type-heading text-foreground">{feature.title}</h3>
                  <p className="type-body text-muted-foreground">{feature.body}</p>
                </div>
                {/* 그림이다. 무엇을 그린 것인지는 위 제목과 설명이 말한다. */}
                <div aria-hidden inert className="mt-auto border-t border-border bg-muted/40 p-5">
                  {feature.preview}
                </div>
              </Card>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
