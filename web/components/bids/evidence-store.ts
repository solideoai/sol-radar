import type { ScoreFactorView } from "@/server/bids";

// 근거 서랍을 여는 요청. store 본체는 근거 서랍 부품(Task 6)이 이 파일에 더한다.
// 서버 모듈은 타입으로만 가져온다(클라이언트 번들에 server-only 가 들어가면 안 된다).
export type EvidenceRef = ScoreFactorView["evidence"][number];

export type EvidenceContext = { title: string; evidence: EvidenceRef[] };
