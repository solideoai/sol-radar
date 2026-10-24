"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppPage } from "@/components/app-page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PeopleDirectory, TeamMemberListItem } from "@/server/people";
import type { PhotoSaveResult } from "@/server/photos";
import type { PeopleUiResult } from "./people-directory";
import { OrgChart } from "./org-chart";
import { PersonDrawer } from "./person-drawer";
export function OrgChartDirectory({
  directory,
  savePhoto,
}: {
  directory: PeopleUiResult<PeopleDirectory>;
  savePhoto?: (memberId: string, path: string | null) => Promise<PhotoSaveResult>;
}) {
  const router = useRouter();
  const query = useSearchParams().toString();
  const [isPending, startTransition] = useTransition();
  const [selection, setSelection] = useState<{ query: string; person: TeamMemberListItem | null }>({
    query,
    person: null,
  });
  const trigger = useRef<HTMLElement | null>(null);
  if (selection.query !== query) setSelection({ query, person: null });
  const close = () => setSelection({ query, person: null });
  const retry = () => {
    close();
    startTransition(() => router.refresh());
  };
  if (isPending) return <OrgChartPending />;
  if (directory.status !== "ready")
    return (
      <AppPage title="조직도">
        <OrgChartFailure onRetry={retry} requestId={directory.requestId} />
      </AppPage>
    );
  // 사진을 바꾸면 서버가 목록을 다시 그린다. 열린 서랍도 새 목록의 같은 사람을 보여 준다.
  const selected =
    selection.query === query && selection.person
      ? (directory.data.members.find((member) => member.id === selection.person?.id) ??
        selection.person)
      : null;
  return (
    <>
      <OrgChart
        directory={directory.data}
        onRetry={retry}
        onSelect={(person, element) => {
          trigger.current = element;
          setSelection({ query, person });
        }}
      />
      <PersonDrawer
        person={selected}
        departments={directory.data.departments}
        jobTitles={directory.data.jobTitles}
        canManagePhotos={directory.data.canManagePhotos}
        savePhoto={savePhoto}
        onClose={close}
        returnFocus={() =>
          trigger.current?.isConnected
            ? trigger.current
            : document.getElementById("org-team-heading")
        }
      />
    </>
  );
}
export function OrgChartPending() {
  return (
    <AppPage title="조직도" contentClassName="max-w-none">
      <div role="status" className="grid gap-4">
        <p className="type-body text-muted-foreground">조직도를 불러오는 중입니다</p>
        <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-6">
          <Skeleton aria-hidden className="h-96" />
          <Skeleton aria-hidden className="h-96" />
        </div>
      </div>
    </AppPage>
  );
}
export function OrgChartFailure({
  onRetry,
  requestId,
}: {
  onRetry: () => void;
  requestId?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-6">
      <p role="alert" className="type-body">
        조직도를 불러오지 못했습니다
      </p>
      {requestId ? (
        <p className="mt-2 type-caption text-muted-foreground">요청 ID: {requestId}</p>
      ) : null}
      <Button variant="outline" className="mt-3" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}
