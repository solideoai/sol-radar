import "server-only";
import { z } from "zod";
import type { BidRevisionSummary } from "./bid.model";

// 공고 revision 비교의 스냅샷·뷰 타입. 스냅샷은 bid_revisions.normalized 에서 비교에 쓰는 키만 본다.
// 모든 키가 선택이고 null 을 허용한다(저장된 정규화 값이 비어 있을 수 있다).

export type RevisionSnapshot = {
  title?: string;
  agency?: string;
  stage?: string;
  status?: string;
  amendmentNo?: string | null;
  budgetKrw?: string | null;
  noticeDate?: string | null;
  deadlineAt?: string | null;
  sourceUrl?: string | null;
  planRef?: string | null;
  preSpecRef?: string | null;
  content?: string;
  attachments?: { name: string }[];
  structuredQualifications?: { name: string; value?: string | null }[];
};

const nullableText = z.string().nullish();

export const revisionSnapshotSchema: z.ZodType<RevisionSnapshot> = z.looseObject({
  title: z.string().optional(),
  agency: z.string().optional(),
  stage: z.string().optional(),
  status: z.string().optional(),
  amendmentNo: nullableText,
  budgetKrw: nullableText,
  noticeDate: nullableText,
  deadlineAt: nullableText,
  sourceUrl: nullableText,
  planRef: nullableText,
  preSpecRef: nullableText,
  content: z.string().optional(),
  attachments: z.array(z.looseObject({ name: z.string() })).optional(),
  structuredQualifications: z
    .array(z.looseObject({ name: z.string(), value: z.string().nullish() }))
    .optional(),
});

export const SCALAR_FIELDS = [
  "budgetKrw",
  "deadlineAt",
  "status",
  "title",
  "agency",
  "noticeDate",
  "stage",
  "sourceUrl",
  "planRef",
  "preSpecRef",
] as const;
export const LIST_FIELDS = ["structuredQualifications", "attachments"] as const;

export type TextSegment = { op: "same" | "added" | "removed"; text: string };

export type RevisionFieldChange =
  | {
      field: (typeof SCALAR_FIELDS)[number];
      kind: "scalar";
      before: string | null;
      after: string | null;
    }
  | {
      field: (typeof LIST_FIELDS)[number];
      kind: "list";
      added: string[];
      removed: string[];
      kept: string[];
    }
  | { field: "content"; kind: "text"; segments: TextSegment[] };

export type RevisionRef = { revision: number; amendmentNo: string | null; fetchedAt: string };

export type RevisionComparison = {
  bidId: string;
  title: string;
  // revision 내림차순
  revisions: BidRevisionSummary[];
  current: RevisionRef;
  // current.revision - 1 이 이력에 있을 때만. 없으면 null
  previous: RevisionRef | null;
  // current 스냅샷의 status 가 CANCELLED
  cancelled: boolean;
  // DISPLAY_ORDER 순
  changes: RevisionFieldChange[];
};
