import { ProductPreview } from "@/components/landing/product-preview";

// 분석 예시 보기(/#demo)가 오는 자리. 히어로 바로 아래에서 화면의 중심을 차지한다.
// 제목은 화면 낭독기용이다 — 보이는 이름은 미리보기 머리와 아래 설명이 대신한다.
// 무대는 강조색이 아닌 중립 회색 띠(muted)이고, 판은 그림자 없이 1px 선 테두리만 둔다.
export function ProductPreviewSection() {
  return (
    <section
      id="demo"
      aria-labelledby="demo-title"
      className="scroll-mt-24 border-y border-border bg-muted/60"
    >
      <div className="mx-auto w-full max-w-300 px-10 pt-7 pb-8 motion-safe:animate-in motion-safe:delay-150 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:fade-in motion-safe:slide-in-from-bottom-4">
        <h2 id="demo-title" className="sr-only">
          공고 분석 예시
        </h2>
        {/* 분석 예시 보기(/#demo)로 오면 제품 창이 머리말 아래에 선다. */}
        {/* 회색 무대 위에 흰 판 하나. 무대 위 글자는 흰 판 안과 아래 설명뿐이고, 설명은 본문 보조색(4.5:1 이상)이다. */}
        <figure>
          <ProductPreview />
          <figcaption className="mx-auto mt-5 max-w-220 text-center type-label-lg text-muted-foreground">
            가상의 공고와 기업 정보로 만든 예시 화면입니다. 실제 공고·기관과 관계없고, 인용문과
            숫자는 화면 설명을 위한 값입니다.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
