import { CircleHelpIcon, GaugeIcon, LinkIcon, UserCheckIcon } from "lucide-react";
import { IconChip } from "@/components/landing/icon-chip";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

// 설계 원칙이다. 검증하지 않은 정확도·성능·보안 인증·수주 실적은 적지 않는다(docs/09-SECURITY.md 책임 있는 AI).
const PRINCIPLES = [
  {
    icon: LinkIcon,
    title: "원문과 근거를 연결합니다",
    body: "판단마다 공고 원문의 해당 부분을 함께 보여 주어, 결과를 원문에서 다시 확인할 수 있게 합니다.",
  },
  {
    icon: CircleHelpIcon,
    title: "확인된 정보와 확인이 필요한 정보를 나눕니다",
    body: "근거가 부족한 항목은 추측해 채우지 않고 '확인 필요'로 표시합니다.",
  },
  {
    icon: GaugeIcon,
    title: "적합도와 수주 확률을 구분합니다",
    body: "SOL Score는 회사와 사업의 적합도입니다. 수주 확률로 표현하지 않습니다.",
  },
  {
    icon: UserCheckIcon,
    title: "AI 권고와 최종 결정을 구분합니다",
    body: "BID·WATCH·NO-BID는 권고입니다. 참여 여부는 담당자가 정하고, 결정과 사유를 따로 기록합니다.",
  },
];

export function PrinciplesSection() {
  return (
    <section id="principles" aria-labelledby="principles-title" className="scroll-mt-20 px-8 py-24">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-12 gap-8">
        <Reveal className="col-span-5">
          <SectionHeading
            id="principles-title"
            title="점수만 보여주지 않고, 판단의 근거를 함께 제공합니다."
            description="SOL RADAR의 분석 화면은 다음 네 가지 원칙으로 설계하고 있습니다."
          />
        </Reveal>
        {/* 칸 사이 1px 틈으로 바탕(border 색)이 비쳐 가는 선이 된다. 선을 따로 긋지 않는다. */}
        {/* 칸마다 따로 떠오르면 틈이 벌어져 보이므로 네 칸을 한 덩어리로 띄운다. */}
        <Reveal className="col-span-7">
          <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-xs">
            {PRINCIPLES.map((principle) => (
              <li key={principle.title} className="flex flex-col gap-3 bg-card p-6">
                <IconChip icon={principle.icon} />
                <h3 className="type-heading text-foreground">{principle.title}</h3>
                <p className="type-body text-muted-foreground">{principle.body}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
