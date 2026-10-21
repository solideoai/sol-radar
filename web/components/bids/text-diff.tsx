"use client";

import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { Added, Removed } from "@/components/bids/diff-marks";
import { Button } from "@/components/ui/button";
import type { TextSegment } from "@/server/bids";

// 본문 diff(스펙 §4.4). 긴 본문은 처음에 접어 두고, 바뀐 곳(추가·삭제)은 접지 않는다.
const FOLD_MIN = 400;
const FOLD_CONTEXT = 120;
const WHOLE_HEAD = 240;

export type FoldedPart = { op: TextSegment["op"] | "fold"; text: string };

const chars = (text: string): string[] => Array.from(text);
const count = (n: number): string => n.toLocaleString("ko-KR");

export function foldSegments(segments: readonly TextSegment[]): {
  parts: FoldedPart[];
  foldable: boolean;
} {
  const hasSame = segments.some((segment) => segment.op === "same");
  const parts: FoldedPart[] = [];
  let foldable = false;
  segments.forEach((segment, index) => {
    const letters = chars(segment.text);
    const long = letters.length > FOLD_MIN;
    if (hasSame) {
      if (segment.op !== "same" || !long) {
        parts.push(segment);
        return;
      }
      foldable = true;
      const first = index === 0;
      const last = index === segments.length - 1;
      const hidden = letters.length - (first || last ? FOLD_CONTEXT : 2 * FOLD_CONTEXT);
      // 첫 조각은 뒤쪽만, 마지막 조각은 앞쪽만, 가운데는 양쪽을 남긴다. 하나뿐이면 앞쪽만.
      if (first && !last) {
        parts.push({ op: "fold", text: `… 바뀌지 않은 ${count(hidden)}자 생략 …` });
        parts.push({ op: "same", text: letters.slice(-FOLD_CONTEXT).join("") });
      } else if (last) {
        parts.push({ op: "same", text: letters.slice(0, FOLD_CONTEXT).join("") });
        parts.push({ op: "fold", text: `… 바뀌지 않은 ${count(hidden)}자 생략 …` });
      } else {
        parts.push({ op: "same", text: letters.slice(0, FOLD_CONTEXT).join("") });
        parts.push({ op: "fold", text: `… 바뀌지 않은 ${count(hidden)}자 생략 …` });
        parts.push({ op: "same", text: letters.slice(-FOLD_CONTEXT).join("") });
      }
      return;
    }
    if (!long) {
      parts.push(segment);
      return;
    }
    foldable = true;
    parts.push({ op: segment.op, text: letters.slice(0, WHOLE_HEAD).join("") });
    parts.push({ op: "fold", text: `… ${count(letters.length - WHOLE_HEAD)}자 더 있음` });
  });
  return { parts, foldable };
}

const DIFF_ID = "revision-content-diff";

function renderPart(part: FoldedPart, key: number) {
  switch (part.op) {
    case "added":
      return <Added key={key} text={part.text} />;
    case "removed":
      return <Removed key={key} text={part.text} />;
    case "fold":
      return (
        <span key={key} data-slot="diff-fold" className="text-muted-foreground">
          {part.text}
        </span>
      );
    default:
      return <span key={key}>{part.text}</span>;
  }
}

function TextDiff({ segments }: { segments: readonly TextSegment[] }) {
  const [expanded, setExpanded] = useState(false);
  const { parts, foldable } = foldSegments(segments);
  const shown: readonly FoldedPart[] = expanded ? segments : parts;
  const whole =
    !segments.some((segment) => segment.op === "same") &&
    segments.some((segment) => segment.op === "removed") &&
    segments.some((segment) => segment.op === "added");
  return (
    <div data-slot="revision-content" className="flex flex-col gap-2 pt-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="type-label font-semibold text-foreground">본문</h3>
        {foldable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={expanded}
            aria-controls={DIFF_ID}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "본문 접기" : "본문 전체 펼치기"}
            <ChevronDownIcon
              aria-hidden="true"
              data-icon="inline-end"
              className={cn(expanded && "rotate-180")}
            />
          </Button>
        )}
      </div>
      {whole && (
        <p className="type-caption text-muted-foreground">
          바뀐 곳을 나누지 못해 이전 본문과 이후 본문을 통째로 보입니다.
        </p>
      )}
      <div
        id={DIFF_ID}
        data-slot="revision-content-diff"
        className="rounded-lg border border-border p-4 type-body whitespace-pre-wrap text-foreground wrap-anywhere"
      >
        {segments.length === 0 ? (
          <>
            <span className="text-muted-foreground">—</span>
            <span className="sr-only">없음</span>
          </>
        ) : (
          shown.map(renderPart)
        )}
      </div>
    </div>
  );
}

export { TextDiff };
