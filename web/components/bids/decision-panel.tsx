"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon } from "lucide-react";
import { Controller, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatKst } from "@/components/bids/format";
import {
  EXTRA_STATUS_LABEL,
  RECOMMENDATION_LABEL,
  REVIEW_RECOMMENDED_FLAGS,
  SOL_ROLE_LABEL,
  STATUS_ICON,
} from "@/components/bids/labels";
import { ScoreGauge } from "@/components/bids/score-gauge";
import { StatusBadge } from "@/components/bids/status-badge";
import { reviewInputSchema, type ReviewInput } from "@/server/shared";
import type { AnalysisView, BidStatus, Recommendation, Review, ReviewFlag } from "@/server/bids";

// 오른쪽 레일 결정 패널(스펙 §5.4.9·§5.4.10). 전송은 화면이 넘기는 onSubmit 이 하고, 이 부품은 결과를 그린다.
// 입력 규칙은 서버와 같은 공유 스키마(@/server/shared)를 그대로 쓴다.

export type ReviewInputValues = ReviewInput;

export type SubmitResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      requestId?: string;
      field?: "reason" | "assigneeUserId";
    };

type DecisionPanelProps = {
  analysis: AnalysisView | null;
  reviews: Review[];
  members: { id: string; name: string }[];
  currentUserId: string;
  canRecordReview: boolean;
  bidStatus: BidStatus;
  onSubmit: (input: ReviewInputValues) => Promise<SubmitResult>;
  // 새 분석을 기다리는 중(polling)이면 권고·점수 자리를 skeleton 으로 바꾼다. 폼과 이력은 지난 분석 기준 그대로다(§5.4.10).
  pending?: boolean;
};

const REASON_TOO_SHORT = "사유를 10자 이상 적어 주세요";
const REASON_MAX = 2000;
const OPTIONS = ["BID", "WATCH", "NO_BID"] as const satisfies readonly Recommendation[];
const isReviewRecommended = (flag: ReviewFlag) =>
  (REVIEW_RECOMMENDED_FLAGS as readonly ReviewFlag[]).includes(flag);

function RecommendationLine({ analysis }: { analysis: AnalysisView | null }) {
  const key = analysis?.recommendation ?? null;
  const { icon: Icon, className } = STATUS_ICON[key ?? "NOT_ANALYZED"];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="type-label text-muted-foreground">권고</span>
        {/* 목록·대시보드의 권고 배지(StatusBadge emphasis)와 같은 모양을 한 단계 크게 쓴다. 미분석은 테두리 없이 회색 글자다. */}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 font-heading type-heading",
            key !== null && "h-8 rounded-md border border-current bg-background px-2.5",
            className,
          )}
        >
          {Icon !== null && <Icon aria-hidden="true" className="size-4 shrink-0" />}
          <span>{key === null ? EXTRA_STATUS_LABEL.NOT_ANALYZED : RECOMMENDATION_LABEL[key]}</span>
        </span>
      </div>
    </div>
  );
}

// 플래그 배지(스펙 §5.4.9). 영문 코드(CITATION_FAILED 등)는 두지 않는다(2026-11-03 사용자 지시).
function FlagItem({ flag }: { flag: ReviewFlag }) {
  return (
    <li className="flex max-w-full min-w-0">
      <StatusBadge kind="flag" value={flag} />
    </li>
  );
}

// 권고 줄과 점수 게이지 자리. 읽는 동안 높이가 튀지 않게 같은 크기로 둔다. 상태 안내는 화면의 live 영역 한 곳이 맡는다.
function RailTopSkeleton() {
  const pulse = "motion-reduce:animate-none";
  return (
    <div data-slot="decision-pending" aria-hidden="true" className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Skeleton className={cn("h-5 w-8", pulse)} />
        <Skeleton className={cn("h-6 w-20", pulse)} />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className={cn("h-9 w-20", pulse)} />
        <Skeleton className={cn("h-2 flex-1", pulse)} />
      </div>
    </div>
  );
}

// 이유 배지·플래그 코드는 두지 않고 제목만 보인다(2026-11-03 사용자 결정). 규칙 우선은 결정 모델 패널이 따로 보인다.
function ReviewNeeded({ analysis }: { analysis: AnalysisView }) {
  const flagged = analysis.reviewFlags.some(isReviewRecommended);
  const qualificationReview = analysis.qualification.status === "NEEDS_REVIEW";
  if (!flagged && !qualificationReview) return null;
  return (
    <div className="rounded-lg border border-warning p-3">
      <p className="flex items-center gap-1.5 font-heading type-label text-warning">
        <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
        사람 검토 권장
      </p>
    </div>
  );
}

// 사유 3줄 말줄임. 넘칠 때만 [펼치기]를 보인다.
function ReasonText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null || expanded) return;
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, expanded]);
  return (
    <div className="flex flex-col items-start gap-1">
      <p
        ref={ref}
        className={cn(
          "type-body text-foreground [overflow-wrap:anywhere]",
          !expanded && "line-clamp-3",
        )}
      >
        {text}
      </p>
      {(overflowing || expanded) && (
        <Button
          type="button"
          variant="link"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "접기" : "펼치기"}
        </Button>
      )}
    </div>
  );
}

function ReviewHistory({ reviews }: { reviews: Review[] }) {
  const sorted = [...reviews].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  const last = sorted[0];
  return (
    <section aria-labelledby="review-history-title" className="flex flex-col gap-3">
      <h3 id="review-history-title" className="font-heading type-label text-foreground">
        결정 이력
      </h3>
      {last === undefined ? (
        <p className="type-body text-muted-foreground">아직 기록된 결정이 없습니다</p>
      ) : (
        <>
          <p className="type-caption text-muted-foreground">
            마지막 결정: {RECOMMENDATION_LABEL[last.decision]} · {last.reviewer.name} ·{" "}
            {formatKst(last.decidedAt)}
          </p>
          <ul className="flex flex-col gap-3">
            {sorted.map((review) => (
              <li key={review.id} className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 type-caption text-muted-foreground">
                  <StatusBadge kind="decision" value={review.decision} variant="inline" />
                  <span>
                    · {review.reviewer.name}
                    {/* 조직을 떠난 사람(탈퇴한 사용자)은 역할을 알 수 없어 괄호를 그리지 않는다. */}
                    {review.reviewer.role !== null && `(${SOL_ROLE_LABEL[review.reviewer.role]})`} ·{" "}
                    {formatKst(review.decidedAt)}
                  </span>
                </div>
                <ReasonText text={review.reason} />
                <div className="flex flex-wrap items-center gap-1.5 type-caption text-muted-foreground">
                  {review.assignee !== null && <span>담당 {review.assignee.name}</span>}
                  {review.disagreementFlag && (
                    <span className="inline-flex h-5 items-center rounded-sm border border-border px-1.5">
                      권고와 다름
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function DecisionPanel({
  analysis,
  reviews,
  members,
  currentUserId,
  canRecordReview,
  bidStatus,
  onSubmit,
  pending = false,
}: DecisionPanelProps) {
  const cancelled = bidStatus === "CANCELLED";
  const locked = !canRecordReview || cancelled;
  const [formError, setFormError] = useState<{
    title: string;
    code?: string;
    requestId?: string;
  } | null>(null);
  const {
    control,
    register,
    handleSubmit,
    setError,
    setFocus,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ReviewInputValues>({
    resolver: zodResolver(reviewInputSchema),
    // 초점은 아래 onInvalid 가 옮긴다. 라디오는 RHF 가 초점을 줄 수 없어 직접 처리한다.
    shouldFocusError: false,
    defaultValues: {
      decision: analysis?.recommendation ?? undefined,
      reason: "",
      assigneeUserId: currentUserId,
    },
  });
  const reasonLength = (useWatch({ control, name: "reason" }) ?? "").length;
  const reasonError = errors.reason;
  const reasonMessage =
    reasonError === undefined
      ? null
      : reasonError.type === "too_small" || reasonError.type === "invalid_type"
        ? REASON_TOO_SHORT
        : (reasonError.message ?? REASON_TOO_SHORT);

  // 검증 실패 때 첫 오류 칸으로 초점을 옮긴다. 결정이 사유보다 앞이다.
  const onInvalid = (invalid: FieldErrors<ReviewInputValues>) => {
    if (invalid.decision !== undefined) {
      document.querySelector<HTMLElement>('[data-slot="radio-group"] [role="radio"]')?.focus();
    } else if (invalid.reason !== undefined) {
      setFocus("reason");
    }
  };

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    const input: ReviewInputValues = {
      decision: values.decision,
      reason: values.reason,
      ...(values.assigneeUserId ? { assigneeUserId: values.assigneeUserId } : {}),
      ...(analysis !== null ? { scoreRunId: analysis.id } : {}),
    };
    let result: SubmitResult;
    try {
      result = await onSubmit(input);
    } catch {
      result = { ok: false, status: 0, code: "NETWORK_ERROR", message: "" };
    }
    if (result.ok) {
      reset({ ...values, reason: "" });
      return;
    }
    if (result.field === "reason") {
      setError("reason", { type: "server", message: REASON_TOO_SHORT });
      setFocus("reason");
    } else if (result.field === "assigneeUserId") {
      setError("assigneeUserId", { type: "server", message: "이 조직 구성원이 아닙니다" });
      setFocus("assigneeUserId");
    } else if (result.status === 403) {
      setFormError({ title: "이 역할로는 결정을 기록할 수 없습니다" });
    } else {
      setFormError({
        title: "결정을 저장하지 못했습니다",
        code: result.code,
        requestId: result.requestId,
      });
    }
  }, onInvalid);

  const lockedReason = !canRecordReview
    ? `결정은 ${SOL_ROLE_LABEL.ADMIN}·${SOL_ROLE_LABEL.SALES} 역할만 기록할 수 있습니다`
    : cancelled
      ? "취소된 공고에는 결정을 기록할 수 없습니다"
      : null;

  return (
    <aside aria-labelledby="decision-title" className="min-w-0">
      <Card className="min-w-0 gap-4">
        <div className="flex min-w-0 flex-col gap-4 px-(--card-spacing)">
          <h2 id="decision-title" className="font-heading type-heading text-foreground">
            참여 판단
          </h2>
          {pending ? (
            <RailTopSkeleton />
          ) : (
            <>
              <RecommendationLine analysis={analysis} />
              <ScoreGauge
                score={analysis?.solScore ?? null}
                reference={analysis?.qualification.status === "NOT_SATISFIED"}
              />
            </>
          )}
          {!pending && analysis !== null && (
            <p className="type-caption text-muted-foreground">{analysis.disclaimer}</p>
          )}
          {!pending && analysis !== null && <ReviewNeeded analysis={analysis} />}
          {!pending &&
            analysis !== null &&
            analysis.reviewFlags.some((flag) => !isReviewRecommended(flag)) && (
              <ul className="flex flex-wrap gap-1.5">
                {analysis.reviewFlags
                  .filter((flag) => !isReviewRecommended(flag))
                  .map((flag) => (
                    <FlagItem key={flag} flag={flag} />
                  ))}
              </ul>
            )}
        </div>
        <Separator />
        <form
          noValidate
          onSubmit={submit}
          className="flex min-w-0 flex-col gap-4 px-(--card-spacing)"
        >
          <FieldSet disabled={locked} className="min-w-0">
            <FieldLegend>최종 결정</FieldLegend>
            {lockedReason !== null && (
              <p className="type-label text-muted-foreground">{lockedReason}</p>
            )}
            {formError !== null && (
              <div
                role="alert"
                className="flex flex-col gap-0.5 rounded-lg border border-destructive p-3 type-label text-destructive"
              >
                <p>{formError.title}</p>
                {formError.code !== undefined && (
                  <p className="font-mono type-caption [overflow-wrap:anywhere]">
                    {formError.code}
                    {formError.requestId !== undefined && ` · ${formError.requestId}`}
                  </p>
                )}
              </div>
            )}
            <Controller
              control={control}
              name="decision"
              render={({ field, fieldState }) => (
                <div className="flex flex-col gap-1.5">
                  <RadioGroup
                    value={field.value ?? null}
                    onValueChange={field.onChange}
                    disabled={locked}
                    aria-label="최종 결정"
                    aria-invalid={fieldState.invalid || undefined}
                  >
                    {OPTIONS.map((option) => (
                      <Label key={option} className="flex items-center gap-2 type-body">
                        <RadioGroupItem value={option} />
                        {RECOMMENDATION_LABEL[option]}
                      </Label>
                    ))}
                  </RadioGroup>
                  {fieldState.invalid && <FieldError>결정을 선택하세요</FieldError>}
                </div>
              )}
            />
            <Field data-invalid={reasonError !== undefined || undefined}>
              <Label htmlFor="review-reason" className="type-label">
                사유
              </Label>
              <Textarea
                id="review-reason"
                {...register("reason")}
                disabled={locked}
                aria-invalid={reasonError !== undefined || undefined}
                aria-describedby="review-reason-count review-reason-error"
                className="min-h-20"
              />
              <div className="flex items-start justify-between gap-2">
                <div id="review-reason-error" className="min-w-0">
                  {reasonMessage !== null && <FieldError>{reasonMessage}</FieldError>}
                </div>
                <span
                  id="review-reason-count"
                  className="shrink-0 type-caption tabular-nums text-muted-foreground"
                >
                  {reasonLength} / {REASON_MAX}
                </span>
              </div>
            </Field>
            <Field data-invalid={errors.assigneeUserId !== undefined || undefined}>
              <Label htmlFor="review-assignee" className="type-label">
                담당자
              </Label>
              <Controller
                control={control}
                name="assigneeUserId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? null}
                    onValueChange={field.onChange}
                    items={members.map((member) => ({ value: member.id, label: member.name }))}
                    disabled={locked}
                  >
                    <SelectTrigger
                      id="review-assignee"
                      ref={field.ref}
                      className="w-full"
                      aria-invalid={errors.assigneeUserId !== undefined || undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.assigneeUserId !== undefined && (
                <FieldError>{errors.assigneeUserId.message}</FieldError>
              )}
            </Field>
            <Button
              type="submit"
              variant={analysis === null ? "outline" : "default"}
              className="w-full"
              disabled={locked || isSubmitting}
            >
              결정 기록
            </Button>
          </FieldSet>
        </form>
        <Separator />
        <div className="min-w-0 px-(--card-spacing)">
          <ReviewHistory reviews={reviews} />
        </div>
      </Card>
    </aside>
  );
}

export { DecisionPanel };
