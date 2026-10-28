import { ProductPreview } from "@/components/landing/product-preview";
import { SectionHeading } from "@/components/landing/section-heading";

// 분석 예시 보기(/#demo)가 오는 자리. 업무 데모 아래 회색 띠 구역이다.
// 다른 구역처럼 왼쪽 구역 제목·설명을 보이게 둔다(2026-10-28 사용자 요청). 구역 이름(공고 분석 예시)은 aria-label 로 그대로 둔다.
// 분석 예시 보기는 제목이 아니라 미리보기 틀(figure)로 바로 온다 — 점수와 고지가 13인치 화면 안에 함께 들어와야 한다.
// 무대는 강조색이 아닌 중립 회색 띠(muted)이고, 판은 그림자 없이 1px 선 테두리만 둔다.
export function ProductPreviewSection() {
  return (
    <section aria-label="공고 분석 예시" className="border-y border-border bg-muted/60">
      <div className="mx-auto w-full max-w-300 px-10 pt-28 pb-8 motion-safe:animate-in motion-safe:delay-150 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:fade-in motion-safe:slide-in-from-bottom-4">
        <SectionHeading
          id="demo-title"
          title="예시 공고로 분석 화면을 직접 살펴보세요"
          description={
            <>
              참가 자격은 공고문 인용으로 판정하고, SOL Score와 시스템 권고는 그 이유와 함께 보여
              줍니다.
              <br />
              왼쪽 목록에서 다른 공고를 고르면 분석이 바뀝니다.
            </>
          }
        />
        {/* 회색 무대 위에 흰 판 하나. 무대 위 글자는 구역 제목·설명과 흰 판 안이다. */}
        {/* 판 아래 캡션 문장은 2026-10-28 사용자 요청으로 뺐다. 예시임은 판 머리의 "예시 데이터" 표시가 알린다. */}
        <figure id="demo" className="mt-14 scroll-mt-24">
          <ProductPreview />
        </figure>
      </div>
    </section>
  );
}
