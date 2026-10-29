import { FX01_VIEW } from "@/components/bids/test-data";
import type { InsightPayload, InsightView } from "@/server/insight";

// 추천 분석 패널 시험(부품·공고 상세 두 파일)이 같이 쓰는 가상 데이터. 공고·실적·인용은 지어낸 것이다.
// 점수 run 은 FX-01(test-data.ts 의 FX01_VIEW)이다.

export const INSIGHT_BID_ID = "6b1d6d1e-6a3c-4c1f-9f5a-2b0c3d4e5f60";
// INSIGHT_POLL_LIMIT_MS(3분)와 같은 값. 그 상수는 서버 전용 모듈(@/server/insight)이라 브라우저 시험에서 부르지 않는다.
export const INSIGHT_POLL_LIMIT_FOR_TEST = 3 * 60 * 1000;

export const INSIGHT_PAYLOAD: InsightPayload = {
  summary:
    "필수 자격 3건을 모두 충족했고 유사 사업 수행 실적이 있어 규칙 엔진이 추천으로 판정했습니다.",
  strengths: [
    {
      text: "최근 3년 민원 포털 구축 실적이 공고의 수행 실적 요건과 맞습니다.",
      refIds: ["B1", "C1"],
    },
  ],
  improvements: [
    {
      text: "정보보안 담당 인력의 자격 증빙을 제안서 제출 전에 준비해 두세요.",
      refIds: ["B2"],
    },
  ],
  refs: [
    {
      id: "B1",
      kind: "BID",
      label: "공고문 p.3 참가 자격",
      quotedText: "최근 3년 이내 유사 사업 수행 실적 1건 이상",
    },
    {
      id: "B2",
      kind: "BID",
      label: "공고문 p.5 투입 인력",
      quotedText: "정보보안 담당자 1인 이상 투입",
    },
    {
      id: "C1",
      kind: "COMPANY",
      label: "회사 실적 · 민원 포털 구축",
      quotedText: "가상 문화정보원 통합 민원 포털 구축(2025)",
    },
  ],
};

export const INSIGHT_PENDING: InsightView = {
  id: "insight-1",
  scoreRunId: FX01_VIEW.id,
  status: "PENDING",
  source: null,
  payload: null,
  fallbackReason: null,
  modelName: null,
  errorCode: null,
  createdAt: "2026-10-29T05:00:00Z",
  finishedAt: null,
};
export const INSIGHT_DONE_MODEL: InsightView = {
  ...INSIGHT_PENDING,
  status: "DONE",
  source: "MODEL",
  payload: INSIGHT_PAYLOAD,
  modelName: "Qwen3.8-Flash-Next-AWQ-INT4",
  finishedAt: "2026-10-29T05:00:20Z",
};
export const INSIGHT_DONE_TEMPLATE: InsightView = {
  ...INSIGHT_DONE_MODEL,
  source: "TEMPLATE",
  fallbackReason: "FORBIDDEN_WORD",
};
export const INSIGHT_FAILED: InsightView = {
  ...INSIGHT_PENDING,
  status: "FAILED",
  errorCode: "GATEWAY_UNAVAILABLE",
  finishedAt: "2026-10-29T05:00:30Z",
};
