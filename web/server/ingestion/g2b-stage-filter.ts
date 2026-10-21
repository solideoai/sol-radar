import "server-only";
import type { G2bItem } from "./connector.model";

// ── 사전규격 정보화사업 필터(P0-8 판정 D8). 교체할 수 있게 순수 함수로 둔다 ──
// 기본값은 응답의 SW사업 대상 여부(swBizObjYn='Y')다. 2026-10-19 녹음 10건은 모두 'N'·비정보화라
// 다른 규칙(제목 키워드 등)을 세울 근거가 없다. 발주계획에는 정보화 표시 칸이 없어 필터 함수를 두지 않는다
// (worker 연결 때 "입찰공고와 식별자로 이어지는 행만 저장"으로 정한다, 후속 계획).
export function isInfoBizPreSpec(item: G2bItem): boolean {
  return typeof item.swBizObjYn === "string" && item.swBizObjYn.trim() === "Y";
}
