"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AppPage } from "@/components/app-page";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { projectRequest } from "@/components/projects/project-request";
import type { ProjectDetail, ProjectStatus } from "@/server/projects";
import type { AssigneeOption } from "@/server/task";
import {
  projectDate,
  resultLabels,
  statusLabels,
} from "@/app/(app)/(work)/projects/project-labels";
import { addChecklistItem, removeChecklistItem, toggleChecklistItem } from "./checklist-actions";

const selectClass =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 type-body focus-visible:outline-ring";
const settingsSchema = z.object({
  status: z.enum(["PREPARING", "SUBMITTED", "AWAITING_RESULT", "CLOSED"]),
  ownerId: z.string(),
  due: z.string(),
  note: z.string().trim().max(500, "메모는 500자 이하입니다"),
});
const resultSchema = z.object({
  result: z.enum(["WON", "LOST", "CANCELLED", "NOT_SUBMITTED"]),
  note: z.string().trim().max(2000, "메모는 2000자 이하입니다"),
});
const checklistSchema = z.object({
  title: z.string().trim().min(1, "항목을 입력하세요").max(120),
  assigneeId: z.string(),
  dueDate: z.string(),
});
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "저장하지 못했습니다. 다시 시도하세요.";
function localDate(value: string | null): string {
  if (value === null) return "";
  return new Date(Date.parse(value) + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
function transitions(status: ProjectStatus): ProjectStatus[] {
  switch (status) {
    case "PREPARING":
      return ["PREPARING", "SUBMITTED", "CLOSED"];
    case "SUBMITTED":
      return ["SUBMITTED", "PREPARING", "AWAITING_RESULT", "CLOSED"];
    case "AWAITING_RESULT":
      return ["AWAITING_RESULT", "SUBMITTED", "CLOSED"];
    case "CLOSED":
      return ["CLOSED"];
  }
}
function SettingsForm({ project, members }: { project: ProjectDetail; members: AssigneeOption[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      status: project.status,
      ownerId: project.owner?.id ?? "",
      due: localDate(project.submissionDueOverride),
      note: "",
    },
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        try {
          await projectRequest(`/api/v1/projects/${project.id}`, "PATCH", {
            ...(values.status === project.status
              ? {}
              : { status: values.status, ...(values.note ? { note: values.note } : {}) }),
            ownerId: values.ownerId || null,
            submissionDueOverride: values.due ? `${values.due}:00+09:00` : null,
          });
          toast.success("프로젝트를 저장했습니다");
          router.refresh();
        } catch (caught) {
          setError(messageOf(caught));
          router.refresh();
        }
      })}
    >
      <h2 className="type-heading">상태·담당자·마감</h2>
      <Field>
        <FieldLabel htmlFor="project-status">상태</FieldLabel>
        <select id="project-status" className={selectClass} {...form.register("status")}>
          {transitions(project.status).map((status) => (
            <option
              key={status}
              value={status}
              disabled={
                project.warnings.latestDecision !== null &&
                ((project.status === "PREPARING" && status === "SUBMITTED") ||
                  (project.status === "SUBMITTED" && status === "AWAITING_RESULT"))
              }
            >
              {statusLabels[status]}
            </option>
          ))}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="project-owner">담당자</FieldLabel>
        <select id="project-owner" className={selectClass} {...form.register("ownerId")}>
          <option value="">담당자 없음</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="project-due">제출 마감 덮어쓰기 (한국 시각)</FieldLabel>
        <Input id="project-due" type="datetime-local" {...form.register("due")} />
        <p className="type-caption text-muted-foreground">
          비우면 공고 마감 {projectDate(project.bid.deadlineAt)}을 따릅니다.
        </p>
      </Field>
      <Field>
        <FieldLabel htmlFor="project-note">상태 변경 메모</FieldLabel>
        <Textarea id="project-note" maxLength={500} {...form.register("note")} />
        <FieldError errors={[form.formState.errors.note]} />
      </Field>
      {error && (
        <p role="alert" className="type-label text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "저장 중…" : "프로젝트 저장"}
      </Button>
    </form>
  );
}
function ResultForm({ project }: { project: ProjectDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(resultSchema),
    defaultValues: { result: project.result ?? "WON", note: project.resultNote ?? "" },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        try {
          await projectRequest(`/api/v1/projects/${project.id}/result`, "POST", {
            result: values.result,
            ...(values.note ? { note: values.note } : {}),
          });
          toast.success("결과를 기록했습니다");
          router.refresh();
        } catch (caught) {
          setError(messageOf(caught));
        }
      })}
    >
      <Field>
        <FieldLabel htmlFor="project-result">결과</FieldLabel>
        <select id="project-result" className={selectClass} {...form.register("result")}>
          {Object.entries(resultLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="result-note">결과 메모</FieldLabel>
        <Textarea id="result-note" maxLength={2000} {...form.register("note")} />
        <FieldError errors={[form.formState.errors.note]} />
      </Field>
      {error && (
        <p role="alert" className="type-label text-destructive">
          {error}
        </p>
      )}
      <Button variant="outline" disabled={form.formState.isSubmitting} type="submit">
        {form.formState.isSubmitting ? "기록 중…" : "결과 기록"}
      </Button>
    </form>
  );
}
function Checklist({ project, members }: { project: ProjectDetail; members: AssigneeOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(checklistSchema),
    defaultValues: { title: "", assigneeId: "", dueDate: "" },
  });
  async function save(
    work: () => Promise<{ status: string; message?: string }>,
    resetForm = false,
  ) {
    setError(null);
    try {
      const result = await work();
      if (result.status !== "saved" && result.status !== "deleted") {
        setError(result.message ?? "항목을 저장하지 못했습니다. 담당자와 권한을 확인하세요.");
        return;
      }
      if (resetForm) form.reset();
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    }
  }
  return (
    <section className="rounded-lg border border-border bg-background p-5">
      <h2 className="type-heading">
        제출 체크리스트{" "}
        <span className="type-label text-muted-foreground">
          {project.checklistProgress.done}/{project.checklistProgress.total}
        </span>
      </h2>
      {project.checklist.length === 0 && (
        <p className="my-4 type-body text-muted-foreground">등록된 항목이 없습니다.</p>
      )}
      <ul className="mt-3 divide-y divide-border">
        {project.checklist.map((item) => (
          <li key={item.id} className="flex min-w-0 items-start gap-3 py-3">
            <input
              className="mt-1 size-4 accent-primary"
              type="checkbox"
              checked={item.status === "done"}
              disabled={!project.canManage || isPending}
              aria-label={`${item.title} 완료`}
              onChange={(event) => {
                const done = event.target.checked;
                startTransition(() => save(() => toggleChecklistItem(project.id, item.id, done)));
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="type-body wrap-anywhere">{item.title}</p>
              <p className="type-caption text-muted-foreground">
                {item.assignee?.name ?? "담당자 없음"} · 마감 {item.dueText ?? "미정"}
              </p>
            </div>
            {project.canManage && (
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  startTransition(() => save(() => removeChecklistItem(project.id, item.id)))
                }
              >
                삭제
              </Button>
            )}
          </li>
        ))}
      </ul>
      {project.canManage && (
        <form
          className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
          onSubmit={form.handleSubmit((values) =>
            save(() => addChecklistItem(project.id, { ...values, description: "" }), true),
          )}
        >
          <Field>
            <FieldLabel htmlFor="checklist-title">새 체크리스트 항목</FieldLabel>
            <Input id="checklist-title" maxLength={120} {...form.register("title")} />
            <FieldError errors={[form.formState.errors.title]} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="checklist-assignee">담당자</FieldLabel>
              <select
                id="checklist-assignee"
                className={selectClass}
                {...form.register("assigneeId")}
              >
                <option value="">담당자 없음</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="checklist-due">마감일</FieldLabel>
              <Input id="checklist-due" type="date" {...form.register("dueDate")} />
            </Field>
          </div>
          <Button
            variant="outline"
            type="submit"
            disabled={form.formState.isSubmitting || isPending}
          >
            항목 추가
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 type-label text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
export function ProjectDetailView({
  project,
  members,
}: {
  project: ProjectDetail;
  members: AssigneeOption[];
}) {
  return (
    <AppPage
      title={project.title}
      contentClassName="max-w-360"
      eyebrow={
        <Link
          href="/projects"
          className="mb-3 inline-block type-label text-muted-foreground underline"
        >
          입찰 프로젝트로 돌아가기
        </Link>
      }
      description={`${statusLabels[project.status]} · ${project.agency ?? "기관 미정"}${project.isDemo ? " · DEMO" : ""}`}
      actions={
        <Link href={`/bids/${project.bidId}`} className="type-body underline">
          최신 공고 보기
        </Link>
      }
    >
      {!project.canManage && (
        <p className="type-label text-muted-foreground">
          읽기 전용입니다. ADMIN·SALES 역할이 프로젝트와 체크리스트를 수정할 수 있습니다.
        </p>
      )}
      {project.warnings.latestDecision && (
        <p
          role="status"
          className="rounded-lg border border-destructive p-4 type-body text-destructive"
        >
          최신 사람 결정이 {project.warnings.latestDecision}입니다. 다음 단계로 전진할 수 없습니다.
          검토 후 수동 종료할 수 있습니다.
        </p>
      )}
      {project.warnings.bidAmended && (
        <p className="rounded-lg border border-border p-4 type-body">
          공고가 정정되었습니다. 시작 revision {project.openedBy.revision} · 최신 revision{" "}
          {project.bid.latestRevision}.{" "}
          <Link className="underline" href={`/bids/${project.bidId}`}>
            최신 공고 확인
          </Link>
        </p>
      )}
      {project.warnings.bidCancelled && (
        <p className="type-body text-destructive">
          공고가 취소되었습니다. 프로젝트 종료는 직접 기록하세요.
        </p>
      )}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_320px] items-start gap-6">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="rounded-lg border border-border p-5">
            <h2 className="type-heading">프로젝트 개요</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 type-body">
              <div>
                <dt className="type-label text-muted-foreground">실효 마감</dt>
                <dd>
                  {projectDate(project.effectiveDueAt)}
                  {project.dueOverridden ? " (덮어쓰기)" : ""}
                </dd>
              </div>
              <div>
                <dt className="type-label text-muted-foreground">담당자</dt>
                <dd>{project.owner?.name ?? "담당자 없음"}</dd>
              </div>
              <div>
                <dt className="type-label text-muted-foreground">최신 사람 결정</dt>
                <dd>
                  {project.latestDecision.decision} · {project.latestDecision.reviewer}
                </dd>
              </div>
              <div>
                <dt className="type-label text-muted-foreground">프로젝트 시작 결정</dt>
                <dd>
                  {project.openedBy.reviewer} · {projectDate(project.openedBy.decidedAt)} · revision{" "}
                  {project.openedBy.revision}
                </dd>
              </div>
            </dl>
            <p className="mt-4 type-caption text-muted-foreground">
              시작 시 분석 SOL Score {project.openedBy.analysis?.solScore ?? "—"} · 권고{" "}
              {project.openedBy.analysis?.recommendation ?? "—"} · 알고리즘{" "}
              {project.openedBy.analysis?.algorithmVersion ?? "—"}
            </p>
            <Link
              href={`/bids/${project.bidId}#review-history-title`}
              className="mt-3 inline-block type-label underline"
            >
              공고·분석·결정 이력 보기
            </Link>
          </section>
          <Checklist project={project} members={members} />
          <section className="rounded-lg border border-border p-5">
            <h2 className="type-heading">상태 이력</h2>
            <ol className="mt-3 divide-y divide-border">
              {project.events.map((event) => (
                <li key={event.id} className="py-3 type-body">
                  <p>
                    {event.from ? statusLabels[event.from] : "시작"} → {statusLabels[event.to]}
                  </p>
                  <p className="type-caption text-muted-foreground">
                    {event.actor ?? "조직을 떠난 사용자"} · {projectDate(event.createdAt)}
                  </p>
                  {event.note && (
                    <p className="mt-2 whitespace-pre-wrap wrap-anywhere">{event.note}</p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
          {project.canManage && (
            <section className="rounded-lg border border-border p-5">
              <SettingsForm project={project} members={members} />
            </section>
          )}
          <section className="rounded-lg border border-border p-5">
            <h2 className="type-heading">수동 결과 기록</h2>
            <p className="mt-2 type-caption text-muted-foreground">
              결과는 업무 기록이며 점수·모델·학습 입력에 사용하지 않습니다. 상태는 별도로
              변경합니다.
            </p>
            <p className="my-4 type-body">
              현재 결과: {project.result ? resultLabels[project.result] : "미기록"}
            </p>
            {project.resultRecordedAt && (
              <p className="mb-3 type-caption text-muted-foreground">
                기록 {projectDate(project.resultRecordedAt)}
              </p>
            )}
            {project.canManage ? (
              <ResultForm project={project} />
            ) : (
              project.resultNote && (
                <p className="type-body whitespace-pre-wrap wrap-anywhere">{project.resultNote}</p>
              )
            )}
            {project.reopenAvailable && (
              <p className="mt-3 type-label">
                종료 이후 새 BID 결정이 있습니다.{" "}
                <Link className="underline" href={`/bids/${project.bidId}`}>
                  공고에서 다시 열기
                </Link>
              </p>
            )}
          </section>
        </aside>
      </div>
    </AppPage>
  );
}
