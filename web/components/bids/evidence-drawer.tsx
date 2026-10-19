"use client";

import { FileWarningIcon, FileXIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useEvidenceStore, type EvidenceRef } from "@/components/bids/evidence-store";
import { formatKst } from "@/components/bids/format";
import { REVIEW_FLAG_LABEL } from "@/components/bids/labels";
import { SourceLink } from "@/components/bids/source-link";
import type { BidDocument } from "@/server/bids";

// 근거 인용 목록·첨부 상태·근거 서랍(스펙 §5.4.8). 열림 상태는 evidence-store 하나를 함께 쓴다.

const CONTEXT_CHARS = 200;

const MATCH_LABEL = {
  EXACT: "원문 대조: 정확히 일치",
  NORMALIZED: "원문 대조: 정규화 후 일치",
  FUZZY: "원문 대조: 유사 일치",
  FAILED: "원문 대조: 실패",
} as const satisfies Record<NonNullable<EvidenceRef["match"]>, string>;

const rangeText = (ref: EvidenceRef): string | null =>
  typeof ref.charStart === "number" && typeof ref.charEnd === "number"
    ? `문자 ${ref.charStart}–${ref.charEnd}`
    : null;

const isApiRef = (ref: EvidenceRef) => ref.kind === "API_FIELD" || ref.apiField !== undefined;

const documentNameOf = (ref: EvidenceRef, documents: BidDocument[]): string =>
  ref.documentId === null
    ? "공고 본문"
    : (documents.find((doc) => doc.id === ref.documentId)?.name ?? "첨부");

// 목록 행의 짧은 위치 라벨(Ruling 9). API 근거 → API {필드}, 쪽이 있으면 p.N, 없으면 본문 또는 문서 이름.
function evidenceLabel(ref: EvidenceRef, documents: BidDocument[]): string {
  if (isApiRef(ref)) return `API ${ref.apiField ?? ""}`.trim();
  if (typeof ref.page === "number") return `p.${ref.page}`;
  return documentNameOf(ref, documents);
}

// 서랍의 자세한 위치. 같은 분기를 쓰되 문서 이름·쪽·문자 범위, API 출처를 모두 보인다.
function evidenceDetail(ref: EvidenceRef, documents: BidDocument[]): string {
  if (isApiRef(ref)) {
    const source = ref.apiSource === undefined ? "" : ` (${ref.apiSource})`;
    return `공고 API 필드 ${ref.apiField ?? ""}${source}`;
  }
  return [
    documentNameOf(ref, documents),
    typeof ref.page === "number" ? `p.${ref.page}` : null,
    rangeText(ref),
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

// 본문 근거의 앞뒤 200자. 범위가 없거나 본문 길이를 넘으면 인용문을 본문에서 찾는다. 찾지 못하면 null.
function excerptOf(content: string, ref: EvidenceRef) {
  const { charStart: from, charEnd: to } = ref;
  let start: number;
  let end: number;
  if (typeof from === "number" && typeof to === "number" && from < to && to <= content.length) {
    start = from;
    end = to;
  } else {
    start = content.indexOf(ref.quotedText);
    if (start < 0) return null;
    end = start + ref.quotedText.length;
  }
  const head = Math.max(0, start - CONTEXT_CHARS);
  const tail = Math.min(content.length, end + CONTEXT_CHARS);
  return {
    before: `${head > 0 ? "…" : ""}${content.slice(head, start)}`,
    quote: content.slice(start, end),
    after: `${content.slice(end, tail)}${tail < content.length ? "…" : ""}`,
  };
}

type DrawerProps = { content: string | null; sourceUrl: string; documents: BidDocument[] };

function EvidenceItem({
  evidenceRef,
  content,
  documents,
}: {
  evidenceRef: EvidenceRef;
  content: string | null;
  documents: BidDocument[];
}) {
  const excerpt =
    evidenceRef.documentId === null && content !== null ? excerptOf(content, evidenceRef) : null;
  return (
    <li className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0">
      <blockquote className="border-l-2 border-border pl-3 type-body text-foreground [overflow-wrap:anywhere]">
        {evidenceRef.quotedText}
      </blockquote>
      <p className="type-caption text-muted-foreground [overflow-wrap:anywhere]">
        {evidenceDetail(evidenceRef, documents)}
      </p>
      {evidenceRef.match !== undefined && (
        <p className="type-caption text-muted-foreground">{MATCH_LABEL[evidenceRef.match]}</p>
      )}
      {excerpt !== null && (
        <p className="type-body text-muted-foreground [overflow-wrap:anywhere]">
          {excerpt.before}
          <mark className="bg-muted text-foreground underline decoration-brand decoration-2">
            {excerpt.quote}
          </mark>
          {excerpt.after}
        </p>
      )}
      <p className="type-caption text-muted-foreground">
        수집 {formatKst(evidenceRef.fetchedAt)} KST
      </p>
    </li>
  );
}

function EvidenceDrawer({ content, sourceUrl, documents }: DrawerProps) {
  const open = useEvidenceStore((state) => state.open);
  const context = useEvidenceStore((state) => state.context);
  const close = useEvidenceStore((state) => state.close);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-[480px] data-[side=right]:max-w-full data-[side=right]:sm:max-w-[480px]"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>근거</SheetTitle>
          <SheetDescription>{context?.title}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <ul className="flex flex-col gap-4">
            {context?.evidence.map((ref, index) => (
              <EvidenceItem
                key={`${ref.documentId ?? "body"}-${ref.charStart ?? index}-${index}`}
                evidenceRef={ref}
                content={content}
                documents={documents}
              />
            ))}
          </ul>
          <SourceLink
            href={sourceUrl}
            className={cn(buttonVariants({ variant: "link", size: "sm" }), "self-start")}
          >
            원문 보기
          </SourceLink>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const quoteHead = (text: string) => `"${text}"`;

// 근거 인용 구역. 행마다 [열기]가 서랍을 연다(스펙 §5.4.8).
function EvidenceList({
  title,
  evidence,
  documents = [],
}: {
  title: string;
  evidence: EvidenceRef[];
  documents?: BidDocument[];
}) {
  const openWith = useEvidenceStore((state) => state.openWith);
  return (
    <section aria-labelledby="evidence-list-title" className="flex flex-col gap-2">
      <h2 id="evidence-list-title" className="font-heading type-heading text-foreground">
        근거 인용
        <span className="ml-2 type-label font-normal text-muted-foreground">
          ({evidence.length}건 · 원문 대조 검증 통과)
        </span>
      </h2>
      <ul className="divide-y divide-border">
        {evidence.map((ref, index) => (
          <li key={index} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1 truncate type-body text-foreground">
              {quoteHead(ref.quotedText)}
            </span>
            <span className="shrink-0 type-caption text-muted-foreground">
              {evidenceLabel(ref, documents)}
            </span>
            <Button
              variant="link"
              size="sm"
              onClick={() => openWith({ title, evidence: [ref] })}
              aria-label={`근거 열기: ${ref.quotedText}`}
            >
              열기
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// 첨부 상태 소구역. 실패 배지는 09 고정 글자이고, 덧붙이는 글자와 코드는 보이는 글자로 둔다.
function AttachmentBadge({
  tone,
  icon: Icon,
  children,
}: {
  tone: "destructive" | "warning";
  icon: typeof FileXIcon;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        // self-start: 세로 flex 안에서 배지가 줄 폭으로 늘어나지 않게 한다.
        "inline-flex h-5 shrink-0 items-center gap-1 self-start whitespace-nowrap rounded-sm border border-border bg-background px-1.5 type-caption",
        tone === "destructive" ? "text-destructive" : "text-warning",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

function AttachmentRow({ doc, sourceUrl }: { doc: BidDocument; sourceUrl: string }) {
  const meta = [doc.format, doc.pageCount === null ? null : `${doc.pageCount}쪽`]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
  const failedDownload = doc.downloadStatus === "FAILED";
  const failedParse = doc.parseStatus === "UNSUPPORTED" || doc.parseStatus === "FAILED";
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate type-body text-foreground">{doc.name}</span>
        {meta !== "" && <span className="shrink-0 type-caption text-muted-foreground">{meta}</span>}
      </div>
      {failedDownload && (
        <div className="flex flex-col gap-1">
          <AttachmentBadge tone="destructive" icon={FileXIcon}>
            {REVIEW_FLAG_LABEL.PARSE_UNSUPPORTED}
          </AttachmentBadge>
          <p className="type-body text-foreground">첨부를 내려받지 못했습니다</p>
          <p className="font-mono type-caption text-muted-foreground [overflow-wrap:anywhere]">
            DOCUMENT_DOWNLOAD_FAILED{doc.downloadErrorCode !== null && ` ${doc.downloadErrorCode}`}
          </p>
        </div>
      )}
      {!failedDownload && failedParse && (
        <div className="flex flex-col gap-1">
          <AttachmentBadge tone="destructive" icon={FileWarningIcon}>
            {REVIEW_FLAG_LABEL.PARSE_UNSUPPORTED}
          </AttachmentBadge>
          <p className="type-body text-foreground">
            첨부를 읽지 못했습니다. 원문을 직접 확인하세요
          </p>
          {doc.parseErrorCode !== null && (
            <p className="font-mono type-caption text-muted-foreground">{doc.parseErrorCode}</p>
          )}
          <SourceLink
            href={sourceUrl}
            className={cn(buttonVariants({ variant: "link", size: "sm" }), "self-start")}
          >
            원문 보기
          </SourceLink>
        </div>
      )}
      {!failedDownload && doc.parseStatus === "PARTIAL" && (
        <div className="flex flex-col gap-1">
          <AttachmentBadge tone="warning" icon={TriangleAlertIcon}>
            일부만 읽음
          </AttachmentBadge>
          <p className="type-body text-foreground">근거 없는 항목은 확인 필요로 남습니다</p>
        </div>
      )}
    </li>
  );
}

function AttachmentStatus({
  documents,
  sourceUrl,
}: {
  documents: BidDocument[];
  sourceUrl: string;
}) {
  return (
    <section aria-labelledby="attachment-status-title" className="flex flex-col gap-1">
      <h3 id="attachment-status-title" className="font-heading type-label text-foreground">
        첨부 상태
      </h3>
      <ul className="divide-y divide-border">
        {documents.map((doc) => (
          <AttachmentRow key={doc.id} doc={doc} sourceUrl={sourceUrl} />
        ))}
      </ul>
    </section>
  );
}

export { AttachmentStatus, EvidenceDrawer, EvidenceList, evidenceDetail, evidenceLabel };
