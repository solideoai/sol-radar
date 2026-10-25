// 공고의 출처를 화면에 말하는 규칙(10-25 실수집 계획 B2). 서버 모듈을 부르지 않는다(클라이언트 부품에서도 쓴다).
// 근거는 저장된 is_demo 와 source 뿐이다. 모르는 것은 모른다고 적고 값을 만들지 않는다.

/** 데모 수집기(FixtureConnector)가 쓰는 source. 실제 수집 출처가 아니다 */
export const DEMO_SOURCE = "fixture";

export type SourceUrlKind = "NOTICE" | "SERVICE_DOCUMENTATION";
export type ViewOrigin = "live" | "demo" | "all";
const VIEW_ORIGINS: readonly ViewOrigin[] = ["live", "demo", "all"];

/** 지금 보고 있는 데이터 출처. 주소의 ?origin= 이 맞는 값이면 그 값, 아니면 서버가 정한 기본 출처다 */
export const viewedOriginOf = (param: string | null, fallback: ViewOrigin): ViewOrigin =>
  VIEW_ORIGINS.find((origin) => origin === param) ?? fallback;

/**
 * 실제 공고로 표시하면 안 되는 행. is_demo=false 인데 저장된 source 가 데모 수집기다.
 * 수집 경로는 isDemo === (source === "fixture") 를 지키지만(normalized-bid.model) DB 는 이를 강제하지 않는다.
 */
export const isUnverifiedOrigin = (bid: { isDemo: boolean; source: string }): boolean =>
  !bid.isDemo && bid.source === DEMO_SOURCE;

/**
 * 공고 agency 칸의 라벨. 출처마다 정규화가 agency 에 넣는 원본 필드가 다르다.
 * - G2B 입찰공고(normalize-g2b): dminsttNm 수요기관. 공고기관 ntceInsttNm 은 원본에만 있다.
 * - fixture(normalize): 같은 NormalizedBid 계약(07 §3.1, agency = 수요기관)을 따른다.
 * - KEPCO(external-normalize): 회사 코드(companyId)로 찾은 회사 이름.
 * - 그 밖의 출처(G2B 사전규격·발주계획, K-water, LH 등)는 정규화가 없어(registry 미검증) 뜻을 단정하지 않는다.
 */
export function agencyLabelOf(source: string): string {
  if (source === DEMO_SOURCE || source === "g2b-bid-notice") return "수요기관";
  if (source === "kepco-ebid-contract") return "발주 회사";
  return "기관";
}

/** 저장된 source_url 의 종류에 맞춘 링크 글자. 서비스 안내 페이지를 원본 공고라고 부르지 않는다 */
export const sourceLinkLabelOf = (kind: SourceUrlKind): string =>
  kind === "SERVICE_DOCUMENTATION" ? "서비스 안내 (원본 공고 아님)" : "원문 보기";
