"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { RunMode } from "@/server/bids";
import { requestIngestionRun, type RunRequestBody } from "./ingestion-api";
import {
  acceptsSource,
  LOGIN_PATH,
  sourceLabel,
  type IngestBatch,
  type IngestRun,
  type IngestSource,
} from "./ingestion-copy";
import { requestErrorOf, type RequestError } from "./request-errors";

// 수동 수집 대화상자(N8 스펙 §4.6·§4.11). 소스 → (fixture 면) 배치를 고르고 한 번에 보낸다.
// - 지금 실행 모드와 안 맞는 소스는 숨기지 않고 비활성 + 이유 문장. 쓸 수 있는 소스는 하나라 미리 고른다.
// - 배치는 기본 선택이 없다(D7). LIVE 는 공고를 바꾸고 알림을 만들어, 고르기 전에는 보내지 않는다.
// - 요청과 멱등 키는 대화상자 바깥 틀(이 부품)이 쥔다. 보내는 중에 닫아도 요청은 이어지고, 202 가 오면 접수 행을 더한다.
//   폼은 열 때마다 새로 그린다(지난 선택·오류를 남기지 않는다).

const SOURCES = ["fixture", "g2b"] as const satisfies readonly IngestSource[];
const BATCHES = ["seed", "live"] as const satisfies readonly IngestBatch[];

const SOURCE_DESCRIPTION = {
  fixture: "저장소의 가상 공고 20건(FX-01~FX-20)을 읽습니다.",
  g2b: "나라장터 Open API에서 입찰공고를 읽습니다.",
} as const satisfies Record<IngestSource, string>;

const BATCH_TEXT = {
  seed: {
    title: "SEED · 처음 적재",
    description: "공고 20건의 첫 revision을 적재합니다. 이미 적재했으면 모두 중복으로 건너뜁니다.",
  },
  live: {
    title: "LIVE · 변경분 투입",
    description:
      "정정·취소·기한 변경·재전송 5건을 적재합니다. 공고가 바뀌고 알림이 생깁니다. 되돌리려면 pnpm demo:reset 을 다시 실행해야 합니다.",
  },
} as const satisfies Record<IngestBatch, { title: string; description: string }>;

const unavailableReason = (runMode: RunMode, source: IngestSource): string =>
  source === "g2b"
    ? `실행 모드 ${runMode}에서는 쓸 수 없습니다. live 모드에서만 됩니다.`
    : `실행 모드 ${runMode}에서는 쓸 수 없습니다. fixture·mock 모드에서만 됩니다.`;

// 05 IngestionRunInput(:428)의 화면 쪽 검사. 서버가 다시 검증한다.
const formSchema = z
  .object({ source: z.enum(SOURCES), batch: z.enum(BATCHES).nullable() })
  .refine((value) => value.source !== "fixture" || value.batch !== null, {
    path: ["batch"],
    message: "배치를 고르세요.",
  });
type FormValues = z.infer<typeof formSchema>;

const bodyOf = (values: FormValues): RunRequestBody | null => {
  if (values.source === "g2b") return { source: "g2b" };
  return values.batch === null ? null : { source: "fixture", batch: values.batch };
};

type SubmitResult = { ok: true } | { ok: false; error: RequestError };

export function RunIngestDialog({
  open,
  onOpenChange,
  runMode,
  finalFocus,
  onAccepted,
  onShowRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runMode: RunMode;
  /** 닫힌 뒤 초점이 갈 곳(머리 [수동 수집 실행]). 빈 상태의 단추로 열어도 같은 곳으로 돌아간다. */
  finalFocus: React.RefObject<HTMLElement | null>;
  onAccepted: (run: IngestRun) => void;
  /** 409 INGESTION_IN_PROGRESS 의 [실행 중인 수집 보기]. */
  onShowRun: (runId: string) => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  // 429 뒤 기다리는 동안의 안내. 시간이 지나면 지우고 [수집 실행]을 연다. 다시 열어도 남는다.
  const [rateLimit, setRateLimit] = useState<RequestError | null>(null);
  // 열 때마다 폼을 새로 그리는 열쇠. 보내는 중에 다시 열면 그 폼(요청 중 표시)을 그대로 둔다.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open && !submitting) setSession((value) => value + 1);
  }

  // 같은 내용을 다시 보내면 같은 키, 내용이 바뀌거나 새로 시작해야 하면 새 키(05 §1 멱등).
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const rateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (rateTimer.current !== null) clearTimeout(rateTimer.current);
    },
    [],
  );

  const submit = async (body: RunRequestBody): Promise<SubmitResult> => {
    const serialized = JSON.stringify(body);
    const key =
      keyRef.current !== null && keyRef.current.body === serialized
        ? keyRef.current.key
        : crypto.randomUUID();
    keyRef.current = { key, body: serialized };
    setSubmitting(true);
    const outcome = await requestIngestionRun(body, key);
    setSubmitting(false);
    if (outcome.ok) {
      keyRef.current = null;
      onAccepted(outcome.run);
      onOpenChange(false);
      return { ok: true };
    }
    const error = requestErrorOf(outcome.failure, {
      retryAfterSec: outcome.retryAfterSec,
      submitted: body.source,
      runMode,
    });
    if (error.renewKey) keyRef.current = null;
    if (error.retryAfterSec !== undefined) {
      if (rateTimer.current !== null) clearTimeout(rateTimer.current);
      setRateLimit(error);
      rateTimer.current = setTimeout(() => {
        rateTimer.current = null;
        setRateLimit(null);
      }, error.retryAfterSec * 1000);
    }
    return { ok: false, error };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]" finalFocus={finalFocus}>
        <RunIngestForm
          key={session}
          runMode={runMode}
          submitting={submitting}
          rateLimit={rateLimit}
          onSubmit={submit}
          onCancel={() => onOpenChange(false)}
          onRefresh={() => {
            onOpenChange(false);
            router.refresh();
          }}
          onShowRun={(runId) => {
            onOpenChange(false);
            onShowRun(runId);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function RunIngestForm({
  runMode,
  submitting,
  rateLimit,
  onSubmit,
  onCancel,
  onRefresh,
  onShowRun,
}: {
  runMode: RunMode;
  submitting: boolean;
  rateLimit: RequestError | null;
  onSubmit: (body: RunRequestBody) => Promise<SubmitResult>;
  onCancel: () => void;
  onRefresh: () => void;
  onShowRun: (runId: string) => void;
}) {
  const id = useId();
  const [formError, setFormError] = useState<RequestError | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    shouldFocusError: false,
    defaultValues: { source: acceptsSource(runMode, "fixture") ? "fixture" : "g2b", batch: null },
  });
  const source = useWatch({ control, name: "source" });
  const batch = useWatch({ control, name: "batch" });
  const ready = acceptsSource(runMode, source) && (source === "g2b" || batch !== null);
  // 429 문구는 바깥 틀이 쥔다(기다리는 동안만 있다). 폼의 다른 오류가 있으면 그것을 보인다.
  const visibleError =
    formError !== null && formError.retryAfterSec === undefined ? formError : rateLimit;
  const blocked = submitting || rateLimit !== null || !ready;

  const send = handleSubmit(async (values) => {
    const body = bodyOf(values);
    if (body === null) return;
    setFormError(null);
    const result = await onSubmit(body);
    if (result.ok) return;
    setFormError(result.error);
    for (const [field, message] of Object.entries(result.error.fieldErrors ?? {})) {
      if (field === "source" || field === "batch") setError(field, { type: "server", message });
    }
  });

  const errorId = `${id}-error`;
  const sourceHintId = (value: IngestSource) => `${id}-source-${value}`;
  const batchHintId = (value: IngestBatch) => `${id}-batch-${value}`;

  return (
    <form noValidate onSubmit={send} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>수동 수집 실행</DialogTitle>
        <DialogDescription>
          공고를 지금 수집합니다. 수집은 분석을 자동으로 시작하지 않습니다.
        </DialogDescription>
      </DialogHeader>

      <FieldSet className="min-w-0 gap-3" disabled={submitting}>
        <FieldLegend variant="label">소스</FieldLegend>
        <Controller
          control={control}
          name="source"
          render={({ field, fieldState }) => (
            <RadioGroup
              value={field.value}
              onValueChange={(value) => field.onChange(value)}
              disabled={submitting}
              aria-invalid={fieldState.invalid || undefined}
              className="gap-3"
            >
              {SOURCES.map((value) => {
                const usable = acceptsSource(runMode, value);
                return (
                  <label key={value} className="flex items-start gap-3">
                    <RadioGroupItem
                      value={value}
                      disabled={!usable || submitting}
                      aria-describedby={sourceHintId(value)}
                      className="mt-[3px]"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className={cn(
                          "type-body",
                          usable ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {sourceLabel(value)}
                      </span>
                      <span id={sourceHintId(value)} className="type-label text-muted-foreground">
                        {usable ? SOURCE_DESCRIPTION[value] : unavailableReason(runMode, value)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          )}
        />
        {errors.source?.message !== undefined && <FieldError>{errors.source.message}</FieldError>}
      </FieldSet>

      {source === "fixture" ? (
        <FieldSet className="min-w-0 gap-3" disabled={submitting}>
          <FieldLegend variant="label">배치</FieldLegend>
          <Controller
            control={control}
            name="batch"
            render={({ field, fieldState }) => (
              <RadioGroup
                value={field.value}
                onValueChange={(value) => field.onChange(value)}
                disabled={submitting}
                aria-invalid={fieldState.invalid || undefined}
                className="gap-3"
              >
                {BATCHES.map((value) => (
                  <label key={value} className="flex items-start gap-3">
                    <RadioGroupItem
                      value={value}
                      disabled={submitting}
                      aria-describedby={batchHintId(value)}
                      className="mt-[3px]"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="type-body text-foreground">{BATCH_TEXT[value].title}</span>
                      <span id={batchHintId(value)} className="type-label text-muted-foreground">
                        {BATCH_TEXT[value].description}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            )}
          />
          <p className="type-caption text-muted-foreground">
            배치 LIVE는 실행 모드 live와 다릅니다.
          </p>
          {errors.batch?.message !== undefined && <FieldError>{errors.batch.message}</FieldError>}
        </FieldSet>
      ) : (
        // g2b 는 입력 칸 없이 기본값만 알린다(D8). 본문은 {source:"g2b"} 하나다.
        <ul className="flex flex-col gap-1 type-label text-muted-foreground">
          <li>수집 구간: 직전 성공 지점부터 지금까지</li>
          <li>단계: 입찰공고</li>
        </ul>
      )}

      {visibleError !== null && (
        <div role="alert" id={errorId} className="flex flex-col items-start gap-2">
          <p className="type-body text-destructive">{visibleError.message}</p>
          {visibleError.requestId !== undefined && (
            <p className="font-mono type-caption wrap-anywhere text-muted-foreground">
              요청 ID {visibleError.requestId}
            </p>
          )}
          <ErrorAction error={visibleError} onRefresh={onRefresh} onShowRun={onShowRun} />
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          취소
        </Button>
        {/* 보내는 동안·기다리는 동안에도 초점을 잃지 않게 focusableWhenDisabled 로 막는다. */}
        <Button
          type="submit"
          disabled={blocked}
          focusableWhenDisabled
          aria-describedby={visibleError !== null ? errorId : undefined}
        >
          {submitting ? "요청 중…" : "수집 실행"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ErrorAction({
  error,
  onRefresh,
  onShowRun,
}: {
  error: RequestError;
  onRefresh: () => void;
  onShowRun: (runId: string) => void;
}) {
  const { action } = error;
  if (action === undefined) return null;
  switch (action.kind) {
    case "refresh":
      return (
        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
          새로 고침
        </Button>
      );
    case "login":
      return (
        <Link href={LOGIN_PATH} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          로그인
        </Link>
      );
    case "show-run":
      return (
        <Button type="button" variant="outline" size="sm" onClick={() => onShowRun(action.runId)}>
          실행 중인 수집 보기
        </Button>
      );
  }
}
