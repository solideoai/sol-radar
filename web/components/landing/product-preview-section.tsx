import { ProductPreview } from "@/components/landing/product-preview";

// 분석 예시 보기(/#demo)가 오는 자리. 히어로 바로 아래에서 화면의 중심을 차지한다.
// 제목은 화면 낭독기용이다 — 보이는 이름은 미리보기 머리와 아래 설명이 대신한다.
export function ProductPreviewSection() {
  return (
    <section id="demo" aria-labelledby="demo-title" className="scroll-mt-20 px-8 pb-24">
      <div className="mx-auto w-full max-w-6xl motion-safe:animate-in motion-safe:delay-150 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:fade-in motion-safe:slide-in-from-bottom-4">
        <h2 id="demo-title" className="sr-only">
          공고 분석 예시
        </h2>
        <figure>
          <ProductPreview />
          <figcaption className="mt-3 type-caption text-muted-foreground">
            가상의 공고와 기업 정보로 만든 예시 화면입니다. 실제 공고·기관과 관계없고, 숫자는 화면
            설명을 위한 값입니다.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
