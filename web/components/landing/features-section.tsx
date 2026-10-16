import { InfoIcon } from "lucide-react";
import {
  CollectPreview,
  HistoryPreview,
  QualifyPreview,
  ScorePreview,
} from "@/components/landing/feature-previews";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";
import { PlannedBadge } from "@/components/landing/status-badges";

type Feature = {
  id: string;
  title: string;
  body: string;
  preview: React.ReactNode;
};

// 한 줄에 기능 하나다. 같은 크기 상자를 격자로 늘어놓지 않고, 왼쪽 글과 오른쪽 큰 조각을 짝짓는다.
// 지금은 어느 기능도 구현되지 않았다(Phase 0 전). 줄마다 "개발 예정"을 붙이고, 구현되면 그 줄에서 뗀다.
const FEATURES: Feature[] = [
  {
    id: "collect",
    title: "공고 수집과 탐색",
    // Chrome 은 가운뎃점 앞을 줄바꿈 자리로 봐서 "·사업"처럼 점이 줄 맨 앞으로 떨어진다. 점 앞에 낱말 잇기(U+2060)를 둔다.
    body: "발주계획\u2060·사전규격\u2060·입찰공고를 모아, 기관\u2060·예산\u2060·마감\u2060·사업 단계 같은 조건으로 좁혀 봅니다.",
    preview: <CollectPreview />,
  },
  {
    id: "qualify",
    title: "기업 프로필 기반 자격 검토",
    body: "보유 기술·자격·실적을 공고의 필수 요건과 대조해 충족·미충족·확인 필요로 나눠 표시합니다.",
    preview: <QualifyPreview />,
  },
  {
    id: "score",
    title: "SOL Score와 판단 근거",
    body: "적합도 점수를 요소별로 나누고 항목마다 근거를 붙여, 어떤 공고부터 검토할지 정하도록 돕습니다.",
    preview: <ScorePreview />,
  },
  {
    id: "history",
    title: "검토 이력과 변경 알림",
    body: "담당자의 의견과 참여 결정을 기록하고, 관심 공고의 마감·예산·첨부 변경을 알려 줍니다.",
    preview: <HistoryPreview />,
  },
];

export function FeaturesSection() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-24 pt-36">
      <div className="mx-auto w-full max-w-320 px-10">
        <Reveal>
          <SectionHeading
            id="features-title"
            title="검토에 필요한 정보를 한 흐름으로 모읍니다"
            description="공고 수집부터 참여 결정 기록까지, 담당자가 되풀이하던 확인 작업을 줄이는 데 집중합니다."
          />
          <p role="note" className="mt-5 flex items-center gap-2 type-ui-lg text-muted-foreground">
            <InfoIcon aria-hidden className="size-5 shrink-0 text-brand" />
            SOL RADAR는 MVP를 개발하고 있습니다. 아래 기능은 모두 개발 예정이며 아직 이용할 수
            없습니다. 화면은 예시 데이터로 그렸습니다.
          </p>
        </Reveal>
        <ul className="mt-16 flex flex-col gap-24">
          {FEATURES.map((feature) => (
            <Reveal as="li" key={feature.id} className="grid grid-cols-12 items-start gap-14">
              <div className="col-span-4 pt-2">
                <h3 className="type-subhead text-foreground">{feature.title}</h3>
                <p className="mt-3.5 type-body-lg text-muted-foreground">{feature.body}</p>
                <p className="mt-5">
                  <PlannedBadge />
                </p>
              </div>
              {/* 그림이다. 무엇을 그린 것인지는 왼쪽 제목과 설명이 말한다. */}
              <div
                aria-hidden
                inert
                className="col-span-8 min-w-0 overflow-hidden rounded-[14px] border border-border bg-background shadow-xs"
              >
                {feature.preview}
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
