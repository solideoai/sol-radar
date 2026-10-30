import { cn } from "cn";
import { SectionHeading } from "@/components/landing/section-heading";

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

const TERM = "type-label-lg font-semibold text-muted-foreground";
const VALUE = "mt-1 type-body-lg text-foreground";

// 머리말의 "분석 방식"(/#analysis)이 오는 자리. 바로 뒤에 분석 원칙 구역이 이어진다.
export function HowItWorksSection() {
  return (
    <section
      id="analysis"
      aria-labelledby="analysis-title"
      className="mx-auto w-full max-w-300 scroll-mt-24 px-4 sm:px-6 xl:px-10 pt-14 xl:pt-28"
    >
      <SectionHeading
        id="analysis-title"
        title="기업 정보를 등록하면, 검토할 사업이 명확해집니다."
      />
      {/* 세 단계를 가는 선으로 나눈다. 번호는 순서라는 정보라서 쓰되, 강조색 없이 본문 색으로 둔다. */}
      <ol className="mt-8 xl:mt-14 grid grid-cols-1 xl:grid-cols-3 border-y border-border">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className={cn(
              "py-6 xl:py-8 xl:pr-8",
              index > 0 && "border-t border-border xl:border-t-0 xl:border-l xl:pl-8",
            )}
          >
            <p className="type-label-lg font-semibold text-foreground tabular-nums">0{index + 1}</p>
            <h3 className="mt-3 type-heading-lg text-foreground">{step.title}</h3>
            <dl className="mt-5 flex flex-col gap-4">
              <div>
                <dt className={TERM}>하는 일</dt>
                <dd className={VALUE}>{step.action}</dd>
              </div>
              <div>
                <dt className={TERM}>얻는 것</dt>
                <dd className={VALUE}>{step.result}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}
