import {
  CollectPreview,
  HistoryPreview,
  QualifyPreview,
  ScorePreview,
} from "@/components/landing/feature-previews";
import { SectionHeading } from "@/components/landing/section-heading";

type Feature = {
  id: string;
  title: string;
  body: string;
  preview: React.ReactNode;
};

// 네 기능은 순서가 아니라 나란한 목록이라 번호를 붙이지 않는다.
// 줄마다 같은 배치(왼쪽 제목·설명, 오른쪽 화면 조각)를 되풀이하고 줄 사이는 1px 선 하나로 나눈다.
// 제목 앞 아이콘·좌우 교차·줄마다 바뀌는 색 무대는 두지 않는다 — 같은 정보에 장식을 겹치지 않는다.
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
    body: "보유 기술\u2060·자격\u2060·실적을 공고의 필수 요건과 대조해 충족\u2060·미충족\u2060·확인 필요로 나눠 표시합니다.",
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
    body: "담당자의 의견과 참여 결정을 기록하고, 관심 공고의 마감\u2060·예산\u2060·첨부 변경을 알려 줍니다.",
    preview: <HistoryPreview />,
  },
];

export function FeaturesSection() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="mx-auto w-full max-w-300 scroll-mt-24 px-10 pt-28"
    >
      <SectionHeading
        id="features-title"
        title="검토에 필요한 정보를 한 흐름으로 모읍니다"
        description="공고 수집부터 참여 결정 기록까지, 담당자가 되풀이하던 확인 작업을 줄이는 데 집중합니다."
      />
      <p role="note" className="mt-5 max-w-190 type-label-lg text-muted-foreground">
        화면은 예시 데이터로 그렸습니다.
      </p>
      <ul className="mt-14 divide-y divide-border border-y border-border">
        {FEATURES.map((feature) => (
          <li key={feature.id} className="grid grid-cols-12 items-start gap-x-12 py-14">
            <div className="col-span-4">
              <h3 className="type-subhead text-balance text-foreground">{feature.title}</h3>
              <p className="mt-3.5 type-body-lg text-muted-foreground">{feature.body}</p>
            </div>
            {/* 그림이다. 무엇을 그린 것인지는 왼쪽 제목과 설명이 말한다. 틀은 1px 선 하나, 그림자 없음. */}
            <div
              aria-hidden
              inert
              className="col-span-8 min-w-0 overflow-hidden rounded-lg border border-border bg-background"
            >
              {feature.preview}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
