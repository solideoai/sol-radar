"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "sonner";
import type { ProjectEntryState } from "@/server/projects";
import { projectRequest } from "./project-request";

export function BidProjectEntry({ entry }: { entry: ProjectEntryState }) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  if (entry.state === "hidden") return null;
  const open = async () => {
    if (entry.latestReviewId === null) return;
    setIsSaving(true);
    try {
      const result = await projectRequest("/api/v1/projects", "POST", {
        reviewId: entry.latestReviewId,
      });
      if (
        typeof result === "object" &&
        result !== null &&
        "id" in result &&
        typeof result.id === "string"
      )
        router.push(`/projects/${result.id}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "프로젝트를 열지 못했습니다");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <section
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4"
      aria-label="입찰 프로젝트"
    >
      <h2 className="type-heading">입찰 프로젝트</h2>
      {entry.state === "create" ? (
        <Button onClick={open} disabled={isSaving} variant="outline">
          {isSaving ? "여는 중…" : "입찰 프로젝트 만들기"}
        </Button>
      ) : (
        <Link
          className={buttonVariants({ variant: "outline" })}
          href={`/projects/${entry.project.id}`}
        >
          입찰 프로젝트 보기
        </Link>
      )}
      {entry.state === "reopen" && (
        <Button variant="outline" onClick={open} disabled={isSaving}>
          {isSaving ? "여는 중…" : "프로젝트 다시 열기"}
        </Button>
      )}
      {entry.state === "closed" && (
        <p className="type-label text-muted-foreground">
          종료된 프로젝트입니다. 종료 이후 새 BID 결정으로 다시 열 수 있습니다.
        </p>
      )}
      {entry.state === "open" && entry.latestDecisionNotBid && (
        <p className="type-label text-destructive">
          최신 결정 {entry.latestDecisionNotBid} · 다음 단계 진행을 확인하세요.
        </p>
      )}
    </section>
  );
}
