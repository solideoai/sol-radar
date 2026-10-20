import { beforeEach, describe, expect, it } from "vitest";
import { useEvidenceStore, type EvidenceContext } from "@/components/bids/evidence-store";

const context: EvidenceContext = {
  title: "소프트웨어사업자",
  evidence: [
    {
      kind: "TEXT",
      documentId: null,
      revisionId: "rev-1",
      quotedText: "소프트웨어사업자 신고 업체",
      fetchedAt: "2026-10-16T01:00:00Z",
      match: "EXACT",
    },
  ],
};

describe("useEvidenceStore", () => {
  beforeEach(() => useEvidenceStore.setState({ open: false, context: null }));

  it("처음에는 닫혀 있고 문맥이 없다", () => {
    const { open, context: current } = useEvidenceStore.getState();
    expect(open).toBe(false);
    expect(current).toBeNull();
  });

  it("openWith 는 열고 문맥을 저장한다", () => {
    useEvidenceStore.getState().openWith(context);
    const { open, context: current } = useEvidenceStore.getState();
    expect(open).toBe(true);
    expect(current).toBe(context);
  });

  it("close 는 닫는다", () => {
    useEvidenceStore.getState().openWith(context);
    useEvidenceStore.getState().close();
    expect(useEvidenceStore.getState().open).toBe(false);
  });
});
