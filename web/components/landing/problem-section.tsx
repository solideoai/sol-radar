import { FilesIcon, ListChecksIcon, UsersIcon } from "lucide-react";
import { IconChip } from "@/components/landing/icon-chip";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";
import { Card } from "@/components/ui/card";

const PAINS = [
  {
    icon: FilesIcon,
    title: "공고와 첨부문서를 반복해서 열어 봅니다",
    body: "발주계획·사전규격·입찰공고가 따로 올라오고, 요구사항은 첨부문서 곳곳에 흩어져 있습니다.",
  },
  {
    icon: ListChecksIcon,
    title: "자격과 실적을 매번 손으로 대조합니다",
    body: "참가 자격과 수행 실적 요건을 회사 자료와 하나씩 맞춰 보는 일이 공고마다 되풀이됩니다.",
  },
  {
    icon: UsersIcon,
    title: "판단 근거가 담당자마다 흩어집니다",
    body: "왜 참여하거나 포기했는지가 메일과 메모에 남아, 다음 검토에서 다시 찾기 어렵습니다.",
  },
];

// 머리말의 "서비스 소개"(/#about)가 오는 자리. 마지막 문장이 다음 구역(주요 기능)으로 잇는다.
export function ProblemSection() {
  return (
    <section id="about" aria-labelledby="about-title" className="scroll-mt-20 px-8 py-24">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-12 gap-x-8 gap-y-10">
        <Reveal className="col-span-5">
          <SectionHeading
            id="about-title"
            eyebrow="서비스 소개"
            title="공고 검색보다 오래 걸리는 건, 참여 여부를 판단하는 일입니다."
          />
        </Reveal>
        <Reveal className="col-span-7">
          <Card className="gap-0 py-0">
            <ul className="divide-y divide-border">
              {PAINS.map((pain) => (
                <li key={pain.title} className="flex gap-4 px-6 py-5">
                  <IconChip icon={pain.icon} />
                  <div>
                    <h3 className="type-heading text-foreground">{pain.title}</h3>
                    <p className="mt-1 type-body text-muted-foreground">{pain.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>
        <Reveal className="col-span-7 col-start-6">
          <p className="type-lead text-foreground">
            SOL RADAR는 이 과정을 하나의 검토 흐름으로 묶습니다. 공고를 모으고, 회사 정보와
            대조하고, 판단 근거와 함께 검토 순서를 정리합니다.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
