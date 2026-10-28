import { AnalysisDemo } from "@/components/landing/analysis-demo";
import { SectionHeading } from "@/components/landing/section-heading";

// 분석 예시 보기(/#demo)가 오는 자리. 업무 데모 아래 구역이고, 위아래를 가는 선으로 나눈다.
// 다른 구역처럼 왼쪽 구역 제목·설명을 보이게 둔다(2026-10-28 사용자 요청). 구역 이름(공고 분석 예시)은 aria-label 로 그대로 둔다.
// 구역 틀과 판(자동 재생·직접 조작)은 analysis-demo.tsx 가 그린다. 판 모양은 위 업무 데모와 같다(흰 바탕, 회색 띠 없음, 2026-10-28 사용자 결정).
export function ProductPreviewSection() {
  return (
    <AnalysisDemo>
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
    </AnalysisDemo>
  );
}
