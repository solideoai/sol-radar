import { DEMO_BIDS } from "@/components/landing/demo-bids";
import { SectionHeading } from "@/components/landing/section-heading";
import {
  EvidenceQuote,
  QualificationLabel,
  RecommendationBadge,
} from "@/components/landing/status-badges";

// "화면에서" 줄의 값은 분석 예시 판의 대표 공고에서 가져온다. 판과 원칙이 서로 다른 숫자를 보이지 않게 손으로 적지 않는다.
const EXAMPLE = DEMO_BIDS[0];

// 설계 원칙이다. 검증하지 않은 정확도·성능·보안 인증·수주 실적은 적지 않는다(docs/09-SECURITY.md 책임 있는 AI).
// 원칙마다 말로만 하지 않고 화면의 실제 표시를 곁들인다. 그림이 아니라 글자라서 화면 낭독기도 읽는다.
const PRINCIPLES: { title: string; body: string; onScreen: React.ReactNode }[] = [
  {
    title: "원문과 근거를 연결합니다",
    body: "판단마다 공고 원문의 해당 부분을 함께 보여 주어, 결과를 원문에서 다시 확인할 수 있게 합니다.",
    onScreen: <EvidenceQuote evidence={EXAMPLE.checks[0].evidence} />,
  },
  {
    title: "확인된 정보와 확인이 필요한 정보를 나눕니다",
    body: "근거가 부족한 항목은 추측해 채우지 않고 '확인 필요'로 표시합니다.",
    onScreen: (
      <>
        <QualificationLabel status="SATISFIED" />
        <QualificationLabel status="NEEDS_REVIEW" />
        <QualificationLabel status="NOT_SATISFIED" />
      </>
    ),
  },
  {
    title: "적합도와 수주 확률을 구분합니다",
    body: "SOL Score는 회사와 사업의 적합도입니다. 수주 확률로 표현하지 않습니다.",
    onScreen: (
      <span className="type-ui-lg text-foreground">
        SOL Score <b className="font-bold tabular-nums">{EXAMPLE.score}</b> / 100 · 수주 확률이
        아닙니다
      </span>
    ),
  },
  {
    title: "AI 권고와 최종 결정을 구분합니다",
    body: "추천·보류·비추천은 권고입니다. 참여 여부는 담당자가 정하고, 결정과 사유를 따로 기록합니다.",
    onScreen: (
      <>
        <RecommendationBadge value={EXAMPLE.recommendation} />
        <span className="type-ui-lg text-foreground">
          권고 · <span className="font-semibold">담당자 결정 대기</span>
        </span>
      </>
    ),
  },
];

// 원칙 네 가지는 순서가 없어 번호를 붙이지 않는다. 구분선 행 네 줄로, 왼쪽에 원칙과 설명, 오른쪽에 화면의 실제 표시를 둔다.
export function PrinciplesSection() {
  return (
    <section
      id="principles"
      aria-labelledby="principles-title"
      className="mx-auto w-full max-w-300 scroll-mt-24 px-4 sm:px-6 xl:px-10 pt-14 xl:pt-28"
    >
      <SectionHeading
        id="principles-title"
        // 줄 바꿈 없는 공백(\u00a0)으로 "판단의 근거를"이 한 덩어리로 남게 한다. 접근 이름은 공백으로 정규화된다.
        title={"점수만 보여주지 않고, 판단의\u00a0근거를 함께 제공합니다."}
        description="SOL RADAR의 분석 화면은 다음 네 가지 원칙으로 설계하고 있습니다."
      />
      <ul className="mt-8 xl:mt-14 divide-y divide-border border-y border-border">
        {PRINCIPLES.map((principle) => (
          <li
            key={principle.title}
            className="grid grid-cols-1 items-start gap-5 py-7 xl:grid-cols-12 xl:gap-x-12 xl:py-9"
          >
            <div className="min-w-0 xl:col-span-7">
              <h3 className="type-heading-lg text-foreground">{principle.title}</h3>
              <p className="mt-3 type-body-lg text-pretty text-muted-foreground">
                {principle.body}
              </p>
            </div>
            <div className="min-w-0 xl:col-span-5">
              <p className="type-label-lg font-semibold text-muted-foreground">화면에서</p>
              <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2">
                {principle.onScreen}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
