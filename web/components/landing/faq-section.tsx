import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

const FAQS = [
  {
    question: "어떤 기업을 위한 서비스인가요?",
    answer: "공공 SI·AX 사업을 검토하는 기업의 영업·사업기획·입찰 담당자를 위한 서비스입니다.",
  },
  {
    question: "SOL Score가 높으면 수주 가능성이 높다는 뜻인가요?",
    answer:
      "SOL Score는 기업 정보와 공고 요구사항을 비교한 적합도 지표입니다. 실제 수주 확률을 의미하지 않습니다.",
  },
  {
    question: "AI가 입찰 참여 여부를 자동으로 결정하나요?",
    answer: "분석 결과와 권고를 제공하며, 최종 참여 여부는 담당자가 결정합니다.",
  },
  {
    question: "기업 정보가 부족해도 분석할 수 있나요?",
    answer:
      "확인 가능한 정보로 분석하고, 판단 근거가 부족한 항목은 추가 확인이 필요하다고 표시합니다.",
  },
  {
    question: "어떤 데이터를 활용하나요?",
    answer: "공식 API로 수집한 공공사업 정보와 사용자가 등록한 기업 정보를 활용합니다.",
  },
];

// 질문이 다섯 개뿐이라 접지 않는다. 핵심 고지("수주 확률 아님", "담당자가 결정")를 누르지 않고 읽게 한다.
export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24 pt-36">
      <div className="mx-auto w-full max-w-320 px-10">
        <Reveal>
          <SectionHeading id="faq-title" title="자주 묻는 질문" />
        </Reveal>
        <Reveal className="mt-12">
          <dl className="border-t-2 border-foreground">
            {FAQS.map((faq) => (
              <div
                key={faq.question}
                className="grid grid-cols-12 gap-10 border-b border-border py-7"
              >
                <dt className="col-span-5 type-lead font-bold text-foreground">{faq.question}</dt>
                <dd className="col-span-7 type-body-lg text-muted-foreground">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
