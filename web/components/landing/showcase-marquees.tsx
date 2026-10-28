import Image from "next/image";
import { Marquee } from "@/components/landing/marquee";
import {
  DATA_SOURCES,
  SOLIDEO_SERVICES,
  type DataSource,
} from "@/components/landing/showcase-data";

// 히어로 아래 흐르는 줄 둘.
// unoptimized: Vercel services 배포에서는 /_next/image 가 404 라 public 원본을 바로 쓴다(679dc3c8).
// eager: 흐르는 줄은 그림이 옆에서 들어와 늦게 받으면 빈 칸이 지나간다. 그림은 모두 합쳐 100KB 남짓이다.

// 서비스 카드는 글자 없이 로고만 가운데에 둔다(2026-10-28 사용자 요청). 이름은 그림 alt 로 읽힌다.
export function ServicesMarquee() {
  return (
    <Marquee label="솔리데오가 수행한 공공 서비스" seconds={64}>
      {SOLIDEO_SERVICES.map((service) => (
        <li
          key={service.name}
          className="flex h-24 w-52 shrink-0 items-center justify-center rounded-lg border border-border bg-background px-4"
        >
          <Image
            src={service.image}
            alt={service.name}
            width={service.width}
            height={service.height}
            unoptimized
            loading="eager"
            className="h-10 w-auto max-w-44 object-contain"
          />
        </li>
      ))}
    </Marquee>
  );
}

// 출처 로고는 가로세로 비율이 제각각이라(LH 2.6:1 ~ 한국전력공사 8.4:1) 높이 하나로 맞추면 좁은 로고가 작아 보인다.
// 넓이(가로×세로)를 같게 맞춰 눈으로 비슷한 크기로 보이게 하고, 카드 안 폭(176px)은 넘지 않게 한다.
const LOGO_AREA = 4200;
const LOGO_MAX_WIDTH = 176;
const logoHeight = ({ width, height }: DataSource["logo"]) => {
  const ratio = width / height;
  return Math.round(Math.min(Math.sqrt(LOGO_AREA / ratio), LOGO_MAX_WIDTH / ratio));
};

// 출처 카드도 서비스 카드처럼 로고만 가운데에 둔다(2026-10-28 사용자 요청). 이름은 그림 alt 로 읽힌다.
// 연결 상태는 문서로 관리하고 화면에는 표시하지 않는다. 로고는 서비스 줄처럼 늘 원래 색이다(2026-10-28 사용자 요청).
export function SourcesMarquee() {
  return (
    <Marquee
      label="SOL RADAR 가 공고를 가져오는 곳"
      reverse
      seconds={44}
      note="기관 로고는 공고 데이터 출처 표시이며 제휴·인증을 뜻하지 않습니다."
    >
      {DATA_SOURCES.map((source) => (
        <li
          key={source.name}
          className="flex h-24 w-52 shrink-0 items-center justify-center rounded-lg border border-border bg-background px-4"
        >
          <Image
            src={source.logo.src}
            alt={source.name}
            width={source.logo.width}
            height={source.logo.height}
            unoptimized
            loading="eager"
            style={{ height: logoHeight(source.logo) }}
            className="w-auto object-contain"
          />
        </li>
      ))}
    </Marquee>
  );
}
