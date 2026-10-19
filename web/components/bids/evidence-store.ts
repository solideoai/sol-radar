import { create } from "zustand";
import type { ScoreFactorView } from "@/server/bids";

// 근거 서랍을 여는 요청과 열림 상태. 서랍·근거 목록·자격 행이 함께 쓰므로 store 하나로 둔다(06 §11).
// 서버 모듈은 타입으로만 가져온다(클라이언트 번들에 server-only 가 들어가면 안 된다).
export type EvidenceRef = ScoreFactorView["evidence"][number];

export type EvidenceContext = { title: string; evidence: EvidenceRef[] };

type EvidenceState = {
  open: boolean;
  context: EvidenceContext | null;
  openWith: (context: EvidenceContext) => void;
  close: () => void;
};

// 닫아도 문맥은 남긴다. 닫힘 애니메이션 동안 내용이 사라지지 않게 하려는 것이다.
export const useEvidenceStore = create<EvidenceState>((set) => ({
  open: false,
  context: null,
  openWith: (context) => set({ open: true, context }),
  close: () => set({ open: false }),
}));
