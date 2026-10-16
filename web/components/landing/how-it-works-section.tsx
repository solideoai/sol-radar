import { SectionHeading } from "@/components/landing/section-heading";
import { Card } from "@/components/ui/card";

// 단계마다 사용자가 하는 일과 얻는 것을 나란히 적는다. 번호는 글자로만 쓴다(색 원 번호 금지, design-system).
const STEPS = [
  {
    title: "기업 프로필 등록",
    action: "보유 기술, 자격, 사업 실적을 한 번 입력합니다.",
    result: "공고마다 회사 자료를 다시 찾지 않아도 됩니다.",
  },
  {
    title: "공고와 요구사항 비교",
    action: "관심 공고를 고르고 분석을 요청합니다.",
    result:
      "참가 자격과 수행 조건을 회사 정보와 비교한 결과를 충족·미충족·확인 필요와 적합도 점수로 받습니다.",
  },
  {
    title: "근거 확인 후 참여 결정",
    action: "판단 근거와 추가 확인 사항을 검토하고 참여 여부를 정합니다.",
    result: "결정과 사유가 기록으로 남아 팀이 같은 근거를 봅니다.",
  },
];

// 머리말의 "분석 방식"(/#analysis)이 오는 자리. 바로 뒤에 분석 원칙 구역이 이어진다.
export function HowItWorksSection() {
  return (
    <section id="analysis" aria-labelledby="analysis-title" className="scroll-mt-20 px-8 py-24">
      <div className="mx-auto w-full max-w-6xl">
        <SectionHeading
          id="analysis-title"
          eyebrow="분석 방식"
          title="기업 정보를 등록하면, 검토할 사업이 명확해집니다."
          description="SOL RADAR MVP에서 만들고 있는 검토 흐름입니다. 아직 이용할 수 없습니다."
        />
        <ol className="mt-12 grid grid-cols-3 gap-6">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex">
              <Card className="w-full gap-0 p-6">
                <p className="type-label font-medium text-brand">{index + 1}단계</p>
                <h3 className="mt-2 type-heading text-foreground">{step.title}</h3>
                <dl className="mt-4 flex flex-col gap-3">
                  <div>
                    <dt className="type-caption font-medium text-muted-foreground">하는 일</dt>
                    <dd className="mt-1 type-body text-foreground">{step.action}</dd>
                  </div>
                  <div className="border-t border-border pt-3">
                    <dt className="type-caption font-medium text-muted-foreground">얻는 것</dt>
                    <dd className="mt-1 type-body text-foreground">{step.result}</dd>
                  </div>
                </dl>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
