import Image from "next/image";
import { Marquee } from "@/components/landing/marquee";
import { DATA_SOURCES, SOLIDEO_SERVICES } from "@/components/landing/showcase-data";

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
          className="flex h-28 w-52 shrink-0 items-center justify-center rounded-lg border border-border bg-background px-4"
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

// 출처 카드도 서비스 카드처럼 로고만 가운데에 둔다(2026-10-28 사용자 요청). 이름은 그림 alt 로 읽힌다.
// 연결 상태는 문서로 관리하고 화면에는 표시하지 않는다. 로고는 회색조이고 마우스를 올리면 원래 색이다.
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
          className="group flex h-28 w-52 shrink-0 items-center justify-center rounded-lg border border-border bg-background px-4"
        >
          <Image
            src={source.logo.src}
            alt={source.name}
            width={source.logo.width}
            height={source.logo.height}
            unoptimized
            loading="eager"
            className="h-7 w-auto max-w-44 object-contain opacity-80 grayscale transition-[filter,opacity] duration-200 group-hover:opacity-100 group-hover:grayscale-0"
          />
        </li>
      ))}
    </Marquee>
  );
}
