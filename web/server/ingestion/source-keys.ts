import "server-only";

export const EXTERNAL_SOURCE_KEYS = [
  "kwater-bid-notice",
  "lh-bid-notice",
  "kwater-procurement-plan",
  "lh-pre-specification",
  "g2b-procurement-request",
  "kepco-ebid-contract",
] as const;
export type ExternalSourceKey = (typeof EXTERNAL_SOURCE_KEYS)[number];
