import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// 질문과 답은 요청 문구 그대로다. 실제 연동 범위처럼 개발 상태에 따라 바뀌는 답은 상태가 바뀌면 같이 고친다.
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
    answer:
      "공식 API로 수집하는 공공사업 정보와 사용자가 등록한 기업 정보를 활용하도록 설계하고 있습니다. 실제 연동 범위는 개발 상태에 맞춰 안내합니다.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 px-8 py-24">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-12 gap-8">
        <Reveal className="col-span-4">
          <SectionHeading id="faq-title" eyebrow="FAQ" title="자주 묻는 질문" />
        </Reveal>
        <Reveal className="col-span-8">
          <Accordion className="rounded-xl border border-border bg-card px-6 shadow-xs">
            {FAQS.map((faq) => (
              <AccordionItem key={faq.question} value={faq.question}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}
