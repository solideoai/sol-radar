import "server-only";
import { expect, it } from "vitest";
import type { StageLinkRow } from "./stage-links.repo";
import { getStageLinks } from "./stage-links.service";

const anchor: StageLinkRow = {
  id: "notice",
  source: "g2b",
  procuring_agency_id: "agency-1",
  stage: "NOTICE",
  notice_id: "N-1",
  plan_ref: "PLAN-1",
  pre_spec_ref: null,
  title: "행정 클라우드 플랫폼 구축",
  agency: "기관",
  status: "OPEN",
  deadline_at: null,
  is_demo: false,
};

it("keeps cross-provider or unknown-agency identifiers as candidates and excludes demo rows", async () => {
  const result = await getStageLinks(anchor.id, {
    repo: {
      findAnchor: async () => anchor,
      findRelated: async () => [
        { ...anchor, id: "official", stage: "PLAN" },
        { ...anchor, id: "other-provider", source: "kepco", stage: "PLAN" },
        { ...anchor, id: "unknown-agency", procuring_agency_id: null, stage: "PRE_SPEC" },
        { ...anchor, id: "demo", stage: "PLAN", is_demo: true },
      ],
    },
  });
  expect(result.ok && result.data.linked.map((row) => row.bidId)).toEqual(["official"]);
  expect(result.ok && result.data.candidates.map((row) => row.bidId)).toEqual([
    "other-provider",
    "unknown-agency",
  ]);
});
