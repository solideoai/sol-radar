import { cn } from "cn";

// date 는 기계가 읽는 날짜(YYYY-MM-DD), label 은 칸 아래에 쓰는 짧은 글자다.
export type BarChartDay = { date: string; label: string; count: number };

export type BarChartDate = { date: string; label: string };

// 토큰 이름이다 — 첫째 계열은 brand, 둘째 계열은 chart-2.
export type BarChartTone = "brand" | "chart-2";

// counts 는 dates 와 같은 순서·같은 길이다.
export type BarChartSeries = { name: string; tone: BarChartTone; counts: number[] };

// Tailwind 가 클래스를 찾도록 글자 그대로 적는다(이어 붙여 만든 클래스는 빌드에 들어가지 않는다).
const TONE_CLASS: Record<BarChartTone, string> = { brand: "bg-brand", "chart-2": "bg-chart-2" };

// 세로 눈금의 맨 위 값. 가운데 눈금이 정수가 되도록 짝수로 올리고, 값이 작아도 4 까지는 그린다(값이 없을 때 빈 눈금이 보인다).
function barAxisMax(maxCount: number): number {
  if (maxCount <= 10) return Math.max(4, Math.ceil(maxCount / 2) * 2);
  const step = 2 * 10 ** Math.floor(Math.log10(maxCount - 1));
  return Math.ceil(maxCount / step) * step;
}

// 막대 줄과 날짜 줄이 같은 값을 써야 날짜가 막대 아래에 온다. pr-4 는 좁을 때 칸 밖으로 반쯤 나가는
// 마지막 날짜 글자의 자리다(없으면 눈금선 끝을 넘는다). 칸이 글자만큼 넓어지면(@xl) 왼쪽과 같은 여백이다.
const COLUMNS = "flex gap-1 pr-4 pl-1 @md:gap-2 @xl:pr-1";

// 날짜 글자("10. 13.")는 칸보다 넓어 좁을수록 끝에서부터 띄엄띄엄 보인다. 13rem 미만(320px 화면의 견본 화면)에서는
// 4칸 사이에 글자 둘이 들어가지 못해 12칸마다로 줄인다.
function labelVisibility(stepsFromEnd: number): string {
  if (stepsFromEnd % 12 === 0) return "";
  if (stepsFromEnd % 4 === 0) return "hidden @[13rem]:inline";
  if (stepsFromEnd % 2 === 0) return "hidden @md:inline";
  return "hidden @3xl:inline";
}

type BarChartProps = {
  // 화면 낭독기가 읽는 표의 제목과 값 뒤에 붙는 단위.
  caption: string;
  unit?: string;
  className?: string;
} & (
  | {
      // 오래된 날부터. valueHeader 는 표의 값 열 이름이다.
      days: BarChartDay[];
      valueHeader: string;
    }
  | {
      // 오래된 날부터. 계열 이름이 범례와 표의 열 이름이 된다.
      dates: BarChartDate[];
      series: BarChartSeries[];
    }
);

function normalize(props: BarChartProps): { dates: BarChartDate[]; series: BarChartSeries[] } {
  if ("days" in props) {
    return {
      dates: props.days.map(({ date, label }) => ({ date, label })),
      series: [
        { name: props.valueHeader, tone: "brand", counts: props.days.map((day) => day.count) },
      ],
    };
  }
  return { dates: props.dates, series: props.series };
}

const sum = (counts: number[]) => counts.reduce((total, count) => total + count, 0);

// CSS 로만 그리고 데이터를 읽지 않는다(props 만 받는다). 막대는 누르는 대상이 아니다.
export function BarChart(props: BarChartProps) {
  const { caption, unit = "", className } = props;
  const { dates, series } = normalize(props);
  const isMulti = series.length > 1;
  const top = barAxisMax(Math.max(0, ...series.flatMap((item) => item.counts)));
  const ticks = [top, top / 2, 0];
  const lastIndex = dates.length - 1;
  const countAt = (item: BarChartSeries, index: number) => item.counts[index] ?? 0;
  const columnTitle = (day: BarChartDate, index: number) =>
    `${day.label} ${series
      .map((item) => `${isMulti ? `${item.name} ` : ""}${countAt(item, index)}${unit}`)
      .join(" · ")}`;

  return (
    <div className={cn("@container", className)}>
      {/* 범례 글자는 계열 색을 쓰지 않는다. */}
      {isMulti ? (
        <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1 type-label">
          {series.map((item) => (
            <li key={item.name} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn("size-2.5 shrink-0 rounded-xs", TONE_CLASS[item.tone])}
              />
              <span className="text-muted-foreground">{item.name}</span>
              <span className="font-medium text-foreground tabular-nums">
                {sum(item.counts)}
                <span className="sr-only">{unit}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {/* 그림은 화면 낭독기에서 숨기고, 같은 값을 아래 표로 읽어 준다. */}
      {/* 왼쪽 여백(ml-8)은 눈금 숫자 자리다. 숫자 칸(w-6)은 세 자리까지 들어간다. */}
      <div aria-hidden>
        <div className="relative ml-8 h-40">
          {ticks.map((tick, index) => (
            <div
              key={tick}
              className="absolute inset-x-0 border-t border-border"
              style={{ top: `${index * 50}%` }}
            >
              <span className="absolute right-full mr-2 w-6 -translate-y-1/2 text-right type-caption text-muted-foreground tabular-nums">
                {tick}
              </span>
            </div>
          ))}
          <div className={cn("absolute inset-0 items-end", COLUMNS)}>
            {dates.map((day, index) => (
              <div
                key={day.date}
                title={columnTitle(day, index)}
                className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5"
              >
                {series.map((item) => {
                  const count = countAt(item, index);
                  return (
                    // 값이 있으면 눈금에 비해 아주 작아도 보이게 최소 높이를 준다.
                    <div
                      key={item.name}
                      className={cn(
                        "w-full rounded-t-sm",
                        isMulti ? "max-w-4 min-w-0 flex-1" : "max-w-8",
                        TONE_CLASS[item.tone],
                        count > 0 && "min-h-1",
                      )}
                      style={{ height: `${(count / top) * 100}%` }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className={cn("mt-2 ml-8", COLUMNS)}>
          {dates.map((day, index) => (
            // min-w-0 이 없으면 글자가 칸을 넓혀 막대와 어긋난다. 넘친 글자는 양쪽으로 같은 만큼 나가 막대 가운데에 온다.
            <div key={day.date} className="flex min-w-0 flex-1 justify-center">
              <span
                className={cn(
                  "type-caption whitespace-nowrap text-muted-foreground tabular-nums",
                  labelVisibility(lastIndex - index),
                )}
              >
                {day.label}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* 표에 sr-only 를 바로 걸면 표가 1px 로 줄지 않는다. 감싼 상자가 숨긴다. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">날짜</th>
              {series.map((item) => (
                <th key={item.name} scope="col">
                  {item.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((day, index) => (
              <tr key={day.date}>
                <th scope="row">
                  <time dateTime={day.date}>{day.label}</time>
                </th>
                {series.map((item) => (
                  <td key={item.name}>
                    {countAt(item, index)}
                    {unit}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
