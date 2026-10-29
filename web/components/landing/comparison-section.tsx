import { cn } from "cn";
import { SectionHeading } from "@/components/landing/section-heading";

// 공고 수집 서비스 네 곳과 SOL RADAR 의 기능 비교다. 타사는 첫 글자 + XX 로만 보이고 실명은 화면 어디에도 두지 않는다.
// 칸 값의 근거는 docs/evidence/competitors/2026-10-29-competitors.md 4절이다. 칸 값을 바꾸면 증거 파일부터 고친다.
const SERVICES = ["인XX", "비XX", "모XX", "클XX"] as const;

type Mark = "yes" | "partial" | "no";

type Row = {
  label: string;
  hint?: string;
  others: readonly [Mark, Mark, Mark, Mark];
  sol: "yes" | "no";
};

// 발주계획·사전규격 연결 행은 운영 수집을 켠 뒤 다시 넣는다(polaris/specs/in-progress/2026-10-29-landing-competitor-table.md D9).
const GROUPS: { name: string; rows: Row[] }[] = [
  {
    name: "공고 찾기 · 읽기",
    rows: [
      { label: "공고 수집 · 조건 검색", others: ["yes", "yes", "yes", "yes"], sol: "yes" },
      {
        label: "AI 공고 요약",
        hint: "요구사항을 정리",
        others: ["no", "no", "no", "yes"],
        sol: "yes",
      },
      {
        label: "우리 회사 기준 참가자격 판정",
        hint: "충족 · 미충족 · 확인 필요",
        others: ["no", "partial", "no", "yes"],
        sol: "yes",
      },
      {
        label: "판단 근거 원문 인용",
        hint: "공고문의 해당 문장으로 돌아가 확인",
        others: ["no", "no", "no", "yes"],
        sol: "yes",
      },
    ],
  },
  {
    name: "참여 판단",
    rows: [
      {
        label: "보유 인력 반영",
        hint: "투입 가능한 인력을 적합도에 반영",
        others: ["no", "no", "no", "partial"],
        sol: "yes",
      },
      {
        label: "추천 · 보류 · 비추천 권고",
        hint: "SOL Score와 근거, 최종 결정은 담당자",
        others: ["no", "no", "no", "no"],
        sol: "yes",
      },
      {
        label: "검토 결정 · 사유 기록",
        hint: "참여 여부와 이유를 팀이 함께 봄",
        others: ["no", "no", "no", "partial"],
        sol: "yes",
      },
    ],
  },
  {
    name: "가격",
    rows: [
      {
        label: "투찰 가격 분석",
        hint: "사정율 · 낙찰예측가",
        others: ["yes", "yes", "yes", "partial"],
        sol: "no",
      },
    ],
  },
];

// 기호는 화면에만 그리고, 화면 낭독기는 뜻을 읽는다. 타사 칸은 "공개 페이지에서 확인했는가", SOL RADAR 칸은 "제공하는가"다.
const OTHER_MARKS: Record<Mark, { symbol: string; meaning: string; className: string }> = {
  yes: { symbol: "✓", meaning: "공개 페이지에서 확인", className: "font-semibold text-foreground" },
  partial: { symbol: "△", meaning: "일부만 확인", className: "text-muted-foreground" },
  no: {
    symbol: "—",
    meaning: "공개 페이지에서 확인되지 않음",
    className: "text-muted-foreground/50",
  },
};

const SOL_MARKS: Record<Row["sol"], { symbol: string; meaning: string; className: string }> = {
  yes: { symbol: "✓", meaning: "제공", className: "font-bold text-brand" },
  no: { symbol: "—", meaning: "제공하지 않음", className: "font-semibold text-muted-foreground" },
};

const MarkCell = ({
  mark,
  className,
}: {
  mark: { symbol: string; meaning: string; className: string };
  className?: string;
}) => (
  <td className={cn("px-3 py-5 text-center align-middle type-ui-lg", mark.className, className)}>
    <span aria-hidden="true">{mark.symbol}</span>
    <span className="sr-only">{mark.meaning}</span>
  </td>
);

// SOL RADAR 열만 옅은 brand 바탕으로 강조한다(사용자가 고른 시안 A, docs/06-UI-UX.md §3.4 의 brand 규칙 예외).
const SOL_COLUMN = "bg-brand/5";

// 머리말의 "서비스 소개"(/#about)가 오는 자리.
export function ComparisonSection() {
  return (
    <section
      id="about"
      aria-labelledby="about-title"
      className="mx-auto w-full max-w-300 scroll-mt-24 px-10 pt-28"
    >
      <SectionHeading
        id="about-title"
        title="찾아 주는 서비스는 많습니다. 판단까지 하는 곳은 드뭅니다."
        description="공공입찰 정보 서비스 네 곳의 공개된 기능을 SOL RADAR와 나란히 놓았습니다. 다른 서비스가 “어떤 공고가 있는지”와 “얼마에 쓸지”를 돕는다면, SOL RADAR는 우리 회사의 자격과 인력까지 따져 “들어갈 사업인지”를 근거와 함께 권고합니다."
      />
      {/* 표는 가는 선과 열 정렬로 비교 관계를 드러낸다. 묶음마다 tbody 하나다. */}
      <table className="mt-14 w-full border-collapse text-left">
        <thead>
          <tr className="border-t border-border">
            <th
              scope="col"
              className="py-3.5 pr-6 type-label-lg font-semibold text-muted-foreground"
            >
              기능
            </th>
            {SERVICES.map((service) => (
              <th
                key={service}
                scope="col"
                className="w-[11%] px-3 py-3.5 text-center type-label-lg font-semibold tracking-wide text-muted-foreground"
              >
                {service}
              </th>
            ))}
            <th
              scope="col"
              className={cn(
                "w-[12%] border-t-2 border-brand px-3 py-3.5 text-center type-label-lg font-bold text-brand",
                SOL_COLUMN,
              )}
            >
              SOL RADAR
            </th>
          </tr>
        </thead>
        {GROUPS.map((group) => (
          <tbody key={group.name} className="last:border-b last:border-border">
            <tr>
              <th
                scope="rowgroup"
                colSpan={SERVICES.length + 2}
                className="pt-7 pb-2 type-label-lg font-semibold text-muted-foreground"
              >
                {group.name}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.label} className="border-t border-border">
                <th
                  scope="row"
                  className="py-5 pr-6 align-middle type-body-lg font-semibold text-foreground"
                >
                  {row.label}
                  {row.hint && (
                    <span className="mt-1 block type-body font-normal text-muted-foreground">
                      {row.hint}
                    </span>
                  )}
                </th>
                {row.others.map((mark, index) => (
                  <MarkCell key={SERVICES[index]} mark={OTHER_MARKS[mark]} />
                ))}
                <MarkCell mark={SOL_MARKS[row.sol]} className={SOL_COLUMN} />
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <p className="mt-4 type-body text-muted-foreground">
        ✓ 공개 페이지에서 확인 · △ 일부만 확인(사람 검수 · 일부 업종, 등록만 가능 등) · — 공개
        페이지에서 확인되지 않음.
        <br />
        2026년 10월 29일 각 서비스 공개 웹페이지 기준이며, 로그인 뒤 화면이나 별도 상품에서는 제공될
        수 있습니다.
      </p>
    </section>
  );
}
