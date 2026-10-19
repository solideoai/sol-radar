import "server-only";
import type { G2bItem } from "./connector.model";

// ── 정보화사업 필터. 교체할 수 있게 순수 함수로 두고 connector 가 주입받는다 ──
// 기본값은 broad 다(사용자 결정 C3-1, 2026-10-19: "조건을 넓힌다"). strict 는 정본 07 §2.2·§2.4 의 원래 규칙이다.

const isStringContaining = (value: unknown, needle: string): boolean =>
  typeof value === "string" && value.includes(needle);

export function isInfoBizNoticeStrict(item: G2bItem): boolean {
  return item.infoBizYn === "Y";
}

export const INFO_BIZ_SUCSFBID_MARKER = "SW사업";

// 근거: docs/evidence/phase-0/external-deps-api-20261019.md §10-4 (main 작업 폴더에만 있다).
// 2f 실측에서 infoBizYn 은 93% 가 빈값이라 'Y' 만으로는 정보화 공고 대부분을 놓친다.
// 정보화 공고의 공공조달분류명(pubPrcrmntClsfcNm) 실측값: 정보시스템유지관리서비스·정보시스템개발서비스·
// 패키지소프트웨어개발및도입서비스·소프트웨어유지및지원서비스.
export const INFO_BIZ_CLASSIFICATION_KEYWORDS = ["정보시스템", "소프트웨어"] as const;

export function isInfoBizNoticeBroad(item: G2bItem): boolean {
  return (
    isInfoBizNoticeStrict(item) ||
    isStringContaining(item.sucsfbidMthdNm, INFO_BIZ_SUCSFBID_MARKER) ||
    INFO_BIZ_CLASSIFICATION_KEYWORDS.some((keyword) =>
      isStringContaining(item.pubPrcrmntClsfcNm, keyword),
    )
  );
}

export const DEFAULT_INFO_BIZ_FILTER: (item: G2bItem) => boolean = isInfoBizNoticeBroad;
