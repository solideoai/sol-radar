import { cn } from "cn";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

// 공공 SI 의 제안서·평가표가 쓰는 비교표 형식이다. 문제(지금은)와 해법(SOL RADAR)을 한 줄에 짝지어 읽게 한다.
const ROWS = [
  {
    stage: "요구사항 파악",
    now: "발주계획·사전규격·입찰공고가 따로 올라오고, 요구사항은 첨부문서 곳곳에 흩어져 있습니다.",
    planned:
      "단계별 공고를 한 사업으로 이어 보고, 요구사항을 공고문의 해당 위치와 함께 정리합니다.",
  },
  {
    stage: "자격·실적 대조",
    now: "참가 자격과 수행 실적 요건을 회사 자료와 하나씩 맞춰 보는 일이 공고마다 되풀이됩니다.",
    planned: "한 번 등록한 기업 프로필과 대조해 충족·미충족·확인 필요로 나눠 보여 줍니다.",
  },
  {
    stage: "판단 기록",
    now: "왜 참여하거나 포기했는지가 메일과 메모에 남아, 다음 검토에서 다시 찾기 어렵습니다.",
    planned: "권고와 담당자의 결정, 결정 사유를 공고마다 남겨 팀이 같은 근거를 봅니다.",
  },
];

const HEAD_CELL = "py-3.5 pr-6 type-label-lg font-semibold text-muted-foreground";
const BODY_CELL = "w-[39%] py-6 pr-6 align-top type-body-lg";

// 머리말의 "서비스 소개"(/#about)가 오는 자리.
export function ProblemSection() {
  return (
    <section id="about" aria-labelledby="about-title" className="scroll-mt-24 pt-36">
      <div className="mx-auto w-full max-w-320 px-10">
        <Reveal>
          <SectionHeading
            id="about-title"
            title="공고 검색보다 오래 걸리는 건, 참여 여부를 판단하는 일입니다."
            description="SOL RADAR는 이 과정을 하나의 검토 흐름으로 묶습니다. 공고를 모으고, 회사 정보와 대조하고, 판단 근거와 함께 검토 순서를 정리합니다."
          />
        </Reveal>
        <Reveal className="mt-12">
          {/* 표의 시작은 2px 검정 선, 줄 사이는 가는 선이다. 상자로 감싸지 않는다. */}
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-t-2 border-foreground">
                <th scope="col" className={HEAD_CELL}>
                  검토 단계
                </th>
                <th scope="col" className={HEAD_CELL}>
                  지금은
                </th>
                <th scope="col" className={HEAD_CELL}>
                  SOL RADAR에서는
                </th>
              </tr>
            </thead>
            <tbody className="border-b border-border">
              {ROWS.map((row) => (
                <tr key={row.stage} className="border-t border-border">
                  <th
                    scope="row"
                    className="w-[22%] py-6 pr-6 align-top type-lead font-bold text-foreground"
                  >
                    {row.stage}
                  </th>
                  <td className={cn(BODY_CELL, "text-muted-foreground")}>{row.now}</td>
                  <td className={cn(BODY_CELL, "text-foreground")}>{row.planned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
      </div>
    </section>
  );
}
