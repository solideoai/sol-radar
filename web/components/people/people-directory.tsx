"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppPage } from "@/components/app-page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PeopleDirectory as Directory, PeoplePage, TeamMemberListItem } from "@/server/people";
import { OrgChart } from "./org-chart";
import { PeopleFilters } from "./people-filters";
import { PersonDrawer } from "./person-drawer";
import { PeopleTable } from "./people-table";
import { peopleHref } from "./people-query";
export type PeopleUiResult<T> = { status: "ready"; data: T } | { status: "error"; code: string };
export type PeopleDirectoryProps = {
  query: string;
  view: "list" | "tree";
  directory: PeopleUiResult<Directory>;
  list: PeopleUiResult<PeoplePage>;
};
export function PeopleDirectory({ query, view, directory, list }: PeopleDirectoryProps) {
  const router = useRouter();
  const triggerRef = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<{ query: string; person: TeamMemberListItem | null }>({
    query,
    person: null,
  });
  if (selection.query !== query) setSelection({ query, person: null });
  const selectPerson = (person: TeamMemberListItem, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setSelection({ query, person });
  };
  const closePerson = () => setSelection({ query, person: null });
  const person = selection.query === query ? selection.person : null;

  const [isPending, startTransition] = useTransition();
  const navigate = (href: string) => {
    closePerson();
    startTransition(() => router.push(href, { scroll: false }));
  };
  const retry = () => startTransition(() => router.refresh());
  const isReady = directory.status === "ready" && (view === "tree" || list.status === "ready");
  const summary =
    view === "tree" && directory.status === "ready"
      ? directory.data.summary
      : list.status === "ready"
        ? list.data.summary
        : null;
  return (
    <AppPage
      title="조직·인력"
      description="솔리데오 가상 인물 명부입니다. 점수 계산 대상 인력만 분석에 사용됩니다."
    >
      <div className="flex flex-wrap items-center gap-3 type-body">
        <span className="text-demo">DEMO · 가상 인물</span>
        {isReady && summary && !isPending ? (
          <p>
            전체 {summary.totalCount}명 · 점수 계산 대상 {summary.scoringCount}명
          </p>
        ) : null}
      </div>
      <PeopleViewNav query={query} view={view} onNavigate={navigate} />
      {directory.status === "ready" && view === "list" ? (
        <PeopleFilters
          key={query}
          query={query}
          departments={directory.data.departments}
          jobTitles={directory.data.jobTitles}
          onNavigate={navigate}
        />
      ) : null}
      <section
        aria-labelledby="people-panel-heading"
        aria-busy={isPending}
        className="grid min-w-0 gap-4"
      >
        <h2 id="people-panel-heading" tabIndex={-1} className="type-heading outline-none">
          {view === "tree" ? "전체 조직도" : "명부"}
        </h2>
        {isPending ? (
          <PeoplePending />
        ) : view === "tree" ? (
          directory.status === "ready" ? (
            <OrgChart directory={directory.data} onSelect={selectPerson} onRetry={retry} />
          ) : (
            <PeopleFailure onRetry={retry} tree />
          )
        ) : directory.status !== "ready" || list.status !== "ready" ? (
          <PeopleFailure onRetry={retry} />
        ) : (
          <>
            <p aria-live="polite" className="type-body">
              검색 결과 {list.data.totalCount}명
            </p>
            {list.data.items.length ? (
              <PeopleTable
                members={list.data.items}
                departments={directory.data.departments}
                jobTitles={directory.data.jobTitles}
                onSelect={selectPerson}
              />
            ) : (
              <div className="rounded-lg border border-border p-6 type-body">
                <p>
                  {list.data.summary.totalCount
                    ? "조건에 맞는 인력이 없습니다"
                    : "등록된 인력이 없습니다"}
                </p>
                {!list.data.summary.totalCount ? (
                  <Button variant="outline" onClick={retry} className="mt-3">
                    다시 시도
                  </Button>
                ) : null}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 type-body">
              <p>
                {list.data.totalCount
                  ? `전체 ${list.data.totalCount}명 중 ${list.data.pageInfo.startIndex + 1}–${list.data.pageInfo.startIndex + list.data.items.length}명`
                  : `전체 0명`}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={list.data.pageInfo.startIndex === 0}
                  onClick={() =>
                    navigate(peopleHref(query, { cursor: list.data.pageInfo.previousCursor }))
                  }
                >
                  이전
                </Button>
                <Button
                  variant="outline"
                  disabled={!list.data.pageInfo.hasNext}
                  onClick={() =>
                    navigate(peopleHref(query, { cursor: list.data.pageInfo.nextCursor }))
                  }
                >
                  다음
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
      <PersonDrawer
        person={isPending ? null : person}
        departments={directory.status === "ready" ? directory.data.departments : []}
        jobTitles={directory.status === "ready" ? directory.data.jobTitles : []}
        onClose={closePerson}
        returnFocus={() =>
          triggerRef.current?.isConnected
            ? triggerRef.current
            : document.getElementById("people-panel-heading")
        }
      />
    </AppPage>
  );
}
export function PeopleViewNav({
  query,
  view,
  onNavigate,
}: {
  query: string;
  view: "list" | "tree";
  onNavigate?: (href: string) => void;
}) {
  return (
    <nav aria-label="인력 보기" className="flex gap-6 border-b border-border">
      {(
        [
          { value: "list", label: "명부" },
          { value: "tree", label: "조직도" },
        ] as const
      ).map((item) => {
        const href = peopleHref(query, { view: item.value });
        return (
          <Link
            key={item.value}
            href={href}
            aria-current={view === item.value ? "page" : undefined}
            onClick={
              onNavigate
                ? (event) => {
                    event.preventDefault();
                    onNavigate(href);
                  }
                : undefined
            }
            className={`flex h-10 items-center border-b-2 type-body outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${view === item.value ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
export function PeoplePending() {
  return (
    <div role="status" className="grid gap-3">
      <p className="type-body text-muted-foreground">인력 정보를 불러오는 중입니다</p>
      <Skeleton aria-hidden className="h-10 w-full" />
      <Skeleton aria-hidden className="h-56 w-full" />
    </div>
  );
}
export function PeopleFailure({ onRetry, tree = false }: { onRetry: () => void; tree?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-6">
      <p role="alert" className="type-body">
        {tree ? "조직도를 불러오지 못했습니다" : "인력 명부를 불러오지 못했습니다"}
      </p>
      <Button variant="outline" onClick={onRetry} className="mt-3">
        다시 시도
      </Button>
    </div>
  );
}
