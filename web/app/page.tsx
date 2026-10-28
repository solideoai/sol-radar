import type { Metadata } from "next";
import { DesktopNotice } from "@/components/landing/desktop-notice";
import { FaqSection } from "@/components/landing/faq-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { Hero } from "@/components/landing/hero";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { startHrefFor } from "@/components/landing/landing-links";
import { LandingVideo } from "@/components/landing/landing-video";
import { PrinciplesSection } from "@/components/landing/principles-section";
import { ProblemSection } from "@/components/landing/problem-section";
import { ProductPreviewSection } from "@/components/landing/product-preview-section";
import { LANDING_VIDEO } from "@/components/landing/showcase-data";
import { ServicesMarquee, SourcesMarquee } from "@/components/landing/showcase-marquees";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getMyHome } from "@/server/organization";

const TITLE = "SOL RADAR — 공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원";
const DESCRIPTION =
  "기업의 기술·자격·실적과 공고 요구사항을 비교해 참가 자격, 사업 적합도, 추가 확인 사항을 근거와 함께 정리합니다. SOL Score는 적합도 지표이며 수주 확률이 아닙니다.";

// og 이미지는 두지 않는다 — 절대 주소(metadataBase)가 아직 없다(app/layout.tsx 주석).
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    locale: "ko_KR",
    siteName: "SOL RADAR",
  },
};

// 시작하기의 목적지 때문에 로그인 상태를 읽는다. 어떻게 읽고 DB 가 없을 때 무엇을 돌려줄지는 도메인(getMyHome)이 정한다.
// 루트 layout 이 CSP nonce 때문에 모든 화면을 요청마다 그리므로, 여기서 로그인 상태를 읽어도 정적 렌더링을 잃지 않는다.
export default async function Home() {
  const startHref = startHrefFor(await getMyHome());
  return (
    <>
      <DesktopNotice />
      <SiteHeader startHref={startHref} />
      {/* 루트 layout 의 건너뛰기 링크가 여기로 온다. 머리말을 지나 본문부터 Tab 이 이어진다. */}
      {/* 본문 바탕은 흰색이다. 구역은 면 색이 아니라 여백이 나누고, 구역 안의 목록은 1px 선이 나눈다. */}
      {/* 면 색은 둘뿐이다: 분석 예시 무대(muted)와 마지막 권유 띠(foreground). */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 bg-background break-keep outline-none selection:bg-brand/15"
      >
        <Hero startHref={startHref} />
        {/* 녹화 영상 구역은 영상 파일(LANDING_VIDEO)이 있을 때만 그린다. */}
        {LANDING_VIDEO && <LandingVideo video={LANDING_VIDEO} />}
        <ServicesMarquee />
        <SourcesMarquee />
        <ProductPreviewSection />
        <ProblemSection />
        <FeaturesSection />
        <HowItWorksSection />
        <PrinciplesSection />
        <FaqSection />
        <FinalCtaSection startHref={startHref} />
      </main>
      <SiteFooter />
    </>
  );
}
