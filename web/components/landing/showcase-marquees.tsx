import { cn } from "cn";
import Image from "next/image";
import { Marquee } from "@/components/landing/marquee";
import { DATA_SOURCES, SOLIDEO_SERVICES } from "@/components/landing/showcase-data";
import { Chip } from "@/components/ui/chip";

// 히어로 아래 흐르는 줄 둘.
// unoptimized: Vercel services 배포에서는 /_next/image 가 404 라 public 원본을 바로 쓴다(679dc3c8).
// eager: 흐르는 줄은 그림이 옆에서 들어와 늦게 받으면 빈 칸이 지나간다. 그림은 모두 합쳐 100KB 남짓이다.

// 서비스 카드는 글자 없이 로고만 가운데에 둔다(2026-10-28 사용자 요청). 이름은 그림 alt 로 읽힌다.
export function ServicesMarquee() {
  return (
    <Marquee label="솔리데오가 수행한 공공 서비스" align="center" seconds={64}>
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

// 운영에서 수집하지 않는 기관은 지금 데이터를 가져오는 곳처럼 보이면 안 된다(스펙 §3 실패로 보는 것).
// 그래서 점선 테두리·흐린 글자·"연결 예정" 꼬리표를 함께 둔다. 로고는 회색조이고 마우스를 올리면 원래 색이다.
// 출처 칸의 로고는 옆 이름 글자와 같은 뜻이라 alt 를 비운다(이름을 두 번 읽지 않게).
export function SourcesMarquee() {
  return (
    <Marquee
      label="SOL RADAR 가 공고를 가져오는 곳"
      reverse
      seconds={44}
      note="기관 로고는 공고 데이터 출처 표시이며 제휴·인증을 뜻하지 않습니다."
    >
      {DATA_SOURCES.map((source) => {
        const planned = source.status === "planned";
        return (
          <li
            key={source.name}
            className={cn(
              "group flex h-16 shrink-0 items-center gap-3 rounded-lg border border-border bg-background px-5",
              planned && "border-dashed",
            )}
          >
            {source.logo && (
              <Image
                src={source.logo.src}
                alt=""
                width={source.logo.width}
                height={source.logo.height}
                unoptimized
                loading="eager"
                className={cn(
                  "h-7 w-auto max-w-32 object-contain grayscale transition-[filter,opacity] duration-200 group-hover:opacity-100 group-hover:grayscale-0",
                  planned ? "opacity-45" : "opacity-80",
                )}
              />
            )}
            <span
              className={cn(
                "type-label-lg whitespace-nowrap",
                planned ? "text-muted-foreground" : "font-semibold text-foreground",
              )}
            >
              {source.name}
            </span>
            {planned && <Chip className="whitespace-nowrap">연결 예정</Chip>}
          </li>
        );
      })}
    </Marquee>
  );
}
