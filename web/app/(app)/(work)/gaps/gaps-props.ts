import type {
  BlockerKind,
  BlockerRow,
  GapBucket,
  GapRadarView,
  GapReviewReason,
  GapScope,
} from "@/server/gaps";

// 화면 부품이 page 에서 받는 값의 모양. 배럴 @/server/gaps 는 server-only 라 화면 부품은 타입만 가져온다.
// 고정 문구·라벨 상수와 다음 주소는 page(서버)가 배럴에서 읽고 계산해 넘긴다(계약 "화면 계약(/gaps)").

export type ReadyGapView = Extract<GapRadarView, { kind: "READY" }>;
/** 자격 코드 사전 코드(SW_BUSINESS_REG 등). */
export type AssumeCode = NonNullable<BlockerRow["code"]>;

/** 계약 파일(gaps.model.ts)의 고정 문구·라벨 그대로. page 가 배럴 상수로 채운다. */
export type GapsCopy = {
  bucketLabels: Record<GapBucket, string>;
  reasonLabels: Record<GapReviewReason, string>;
  blockerKindLabels: Record<BlockerKind, string>;
  scopeNotice: string;
  budgetNotice: string;
  assumptionNotice: string;
  sourceNotice: string;
  /** 사전 코드 → 사전 이름. 막는 자격 표의 "사전: {이름}" 줄에 쓴다. */
  dictionaryNames: Partial<Record<AssumeCode, string>>;
};

/** page 가 gapRadarHref·toggleAssume 로 미리 만든 다음 주소. */
export type GapsLinks = {
  /** 관련성 거르기를 바꾼 주소. 켠 가정은 그대로 둔다. */
  scope: Record<GapScope, string>;
  /** 가정을 모두 지운 주소. */
  clearAssume: string;
  /** 표의 사전 코드마다 스위치를 켠·끈 주소. */
  assume: Partial<Record<AssumeCode, { on: string; off: string }>>;
};

/** 역할에 따라 빈 상태에서 보이는 동작. */
export type GapsAccess = { canOpenCompany: boolean; canRunIngestion: boolean };
