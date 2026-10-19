"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { AppPage } from "@/components/app-page";
import { Button } from "@/components/ui/button";
import type { PeopleDirectory, TeamMemberListItem } from "@/server/people";
import type { SelectPerson } from "./people-table";
import { PersonAvatar } from "./person-avatar";
import { OrgNameFinder } from "./org-name-finder";
import { buildOrgChart, type OrgNode } from "./org-chart-model";

const flattenNodes = (nodes: OrgNode[]): OrgNode[] =>
  nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
const pathTo = (departments: PeopleDirectory["departments"], id: string): string[] => {
  const path: string[] = [];
  const visited = new Set<string>();
  let department = departments.find((item) => item.id === id);
  while (department && !visited.has(department.id)) {
    visited.add(department.id);
    path.unshift(department.id);
    department = departments.find((item) => item.id === department?.parentId);
  }
  return path;
};

type UnknownBundles = { unassigned: boolean; groups: boolean; teams: boolean };
const revealUnknownBundle = (
  departments: PeopleDirectory["departments"],
  teamId: string,
  bundles: UnknownBundles,
): UnknownBundles => {
  const rootId = pathTo(departments, teamId)[0];
  const root = departments.find((department) => department.id === rootId);
  if (!root || root.parentId !== null || root.kind === "DIVISION") return bundles;
  return { ...bundles, unassigned: true, [root.kind === "GROUP" ? "groups" : "teams"]: true };
};

export function OrgChart({
  directory,
  onSelect,
  onRetry,
}: {
  directory: PeopleDirectory;
  onSelect: SelectPerson;
  onRetry?: () => void;
}) {
  const chart = useMemo(() => buildOrgChart(directory.departments, directory.members), [directory]);
  const nodes = flattenNodes([
    ...chart.divisions,
    ...chart.unassignedGroups,
    ...chart.unassignedTeams,
  ]);
  const teams = nodes.filter((node) => node.department.kind === "TEAM");
  const defaultTeam = teams.find((node) => node.members.length > 0) ?? teams[0];
  const searchParams = useSearchParams();
  const requestedTeams = searchParams.getAll("team");
  const requestedTeam = requestedTeams.length === 1 ? requestedTeams[0] : null;
  const selectedTeam = teams.find((node) => node.department.id === requestedTeam) ?? defaultTeam;
  const teamId = selectedTeam?.department.id;
  const [disclosure, setDisclosure] = useState(() => ({
    teamId,
    expanded: new Set(teamId ? pathTo(directory.departments, teamId) : []),
    bundles: { unassigned: true, groups: true, teams: true },
  }));
  if (disclosure.teamId !== teamId) {
    setDisclosure({
      teamId,
      bundles: teamId
        ? revealUnknownBundle(directory.departments, teamId, disclosure.bundles)
        : disclosure.bundles,
      expanded: new Set([
        ...disclosure.expanded,
        ...(teamId ? pathTo(directory.departments, teamId) : []),
      ]),
    });
  }
  const [focusedPerson, setFocusedPerson] = useState<{ id: string } | null>(null);
  const query = searchParams.toString();
  useEffect(() => {
    if (teamId && requestedTeam !== teamId) {
      const params = new URLSearchParams(query);
      params.set("team", teamId);
      window.history.replaceState(null, "", `/org-chart?${params}`);
    }
  }, [teamId, query, requestedTeam]);
  useEffect(() => {
    if (!focusedPerson) return;
    const timer = window.setTimeout(() => setFocusedPerson(null), 1600);
    return () => window.clearTimeout(timer);
  }, [focusedPerson]);
  useEffect(() => {
    if (!focusedPerson) return;
    const card = document.getElementById(`org-person-${focusedPerson.id}`);
    if (!card) return;
    card.focus();
    card.scrollIntoView({ block: "nearest" });
  }, [focusedPerson, teamId]);
  const selectTeam = (id: string) => {
    const params = new URLSearchParams(query);
    params.set("team", id);
    if (params.toString() !== query) window.history.pushState(null, "", `/org-chart?${params}`);
    setDisclosure((previous) => ({
      teamId: id,
      bundles: revealUnknownBundle(directory.departments, id, previous.bundles),
      expanded: new Set([...previous.expanded, ...pathTo(directory.departments, id)]),
    }));
  };
  const findPerson = (person: TeamMemberListItem) => {
    selectTeam(person.departmentId);
    setFocusedPerson({ id: person.id });
  };
  const toggle = (id: string) =>
    setDisclosure((previous) => {
      const expanded = new Set(previous.expanded);
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      return { ...previous, expanded };
    });
  const toggleBundle = (bundle: keyof UnknownBundles) =>
    setDisclosure((previous) => ({
      ...previous,
      bundles: { ...previous.bundles, [bundle]: !previous.bundles[bundle] },
    }));
  const titleNames = new Map(directory.jobTitles.map((item) => [item.id, item.label]));
  const titleRank = new Map(directory.jobTitles.map((item, index) => [item.id, index]));
  const members = [...(selectedTeam?.members ?? [])].sort(
    (a, b) =>
      (titleRank.get(a.jobTitleId) ?? Infinity) - (titleRank.get(b.jobTitleId) ?? Infinity) ||
      a.name.localeCompare(b.name, "ko"),
  );
  const selectedPath = teamId
    ? pathTo(directory.departments, teamId).map((id) =>
        directory.departments.find((item) => item.id === id)!,
      )
    : [];
  const hasKnownRoot = selectedPath[0]?.kind === "DIVISION";
  const renderNode = (node: OrgNode) => (
    <DepartmentNode
      key={node.department.id}
      node={node}
      expanded={disclosure.expanded}
      selectedTeamId={teamId}
      onToggle={toggle}
      onSelectTeam={selectTeam}
    />
  );
  const empty = !directory.departments.length && !directory.members.length;
  return (
    <AppPage
      title="조직도"
      contentClassName="max-w-none"
      actions={!empty ? <OrgNameFinder directory={directory} onPick={findPerson} /> : undefined}
    >
      {!empty ? (
        <div className="flex flex-wrap items-center gap-3 type-body">
          <span className="text-demo">DEMO · 가상 인물</span>
          <p>
            전체 {chart.totalCount}명 · 본부{" "}
            {directory.departments.filter((item) => item.kind === "DIVISION").length} · 그룹{" "}
            {directory.departments.filter((item) => item.kind === "GROUP").length} · 팀{" "}
            {directory.departments.filter((item) => item.kind === "TEAM").length}
          </p>
        </div>
      ) : null}
      {empty ? (
        <div className="rounded-lg border border-border p-6 type-body">
          <p>등록된 조직·인력이 없습니다</p>
          {onRetry ? (
            <Button variant="outline" className="mt-3" onClick={onRetry}>
              다시 시도
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-[300px_minmax(0,1fr)] items-start gap-6">
          {/* 상단 막대·페이지 제목·요약과 아래 여백까지 확보해 긴 트리만 스크롤한다. */}
          <aside
            aria-label="부서 탐색"
            className="sticky top-18 max-h-[calc(100dvh-14rem)] min-w-0 overflow-y-auto border-r border-border pr-4"
          >
            <section aria-labelledby="org-divisions-heading" className="grid gap-3">
              <h2 id="org-divisions-heading" className="type-heading">
                본부 ·{" "}
                {
                  new Set(
                    flattenNodes(chart.divisions).flatMap((node) =>
                      node.members.map((person) => person.id),
                    ),
                  ).size
                }
                명
              </h2>
              <ul className="grid min-w-0 gap-1">{chart.divisions.map(renderNode)}</ul>
            </section>
            <section
              aria-labelledby="org-unassigned-heading"
              className="mt-5 grid gap-3 border-t border-border pt-5"
            >
              <h2
                id="org-unassigned-heading"
                aria-label={`상위 미지정 · ${chart.unassignedGroups.length + chart.unassignedTeams.length}개 부서 · ${chart.unassignedCount}명`}
                className="relative rounded-lg type-heading hover:bg-muted"
              >
                <Button
                  variant="ghost"
                  aria-label="상위 미지정"
                  aria-describedby="org-unassigned-summary"
                  aria-expanded={disclosure.bundles.unassigned}
                  aria-controls="org-unassigned-content"
                  onClick={() => toggleBundle("unassigned")}
                  className="h-auto min-h-10 min-w-0 justify-start gap-2 px-0 text-left whitespace-normal after:absolute after:inset-0 after:rounded-lg focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                >
                  {disclosure.bundles.unassigned ? (
                    <ChevronDownIcon aria-hidden />
                  ) : (
                    <ChevronRightIcon aria-hidden />
                  )}
                  <span className="min-w-0 type-heading wrap-anywhere">상위 미지정</span>
                </Button>
                {" · "}
                <span id="org-unassigned-summary">
                  {chart.unassignedGroups.length + chart.unassignedTeams.length}개 부서 ·{" "}
                  {chart.unassignedCount}명
                </span>
              </h2>
              <div
                id="org-unassigned-content"
                hidden={!disclosure.bundles.unassigned}
                className="grid min-w-0 gap-3"
              >
                <p className="type-caption text-muted-foreground">
                  자료에서 상위 부서가 확인되지 않은 부서입니다.
                </p>
                <h3 className="type-label font-medium">
                  <Button
                    variant="ghost"
                    aria-expanded={disclosure.bundles.groups}
                    aria-controls="org-unassigned-groups"
                    onClick={() => toggleBundle("groups")}
                    className="h-auto min-h-10 w-full min-w-0 justify-start gap-2 px-0 text-left whitespace-normal"
                  >
                    {disclosure.bundles.groups ? (
                      <ChevronDownIcon aria-hidden />
                    ) : (
                      <ChevronRightIcon aria-hidden />
                    )}
                    <span>그룹 {chart.unassignedGroups.length}개</span>
                  </Button>
                </h3>
                <ul
                  id="org-unassigned-groups"
                  hidden={!disclosure.bundles.groups}
                  className="grid min-w-0 gap-1"
                >
                  {chart.unassignedGroups.map(renderNode)}
                </ul>
                <h3 className="type-label font-medium">
                  <Button
                    variant="ghost"
                    aria-expanded={disclosure.bundles.teams}
                    aria-controls="org-unassigned-teams"
                    onClick={() => toggleBundle("teams")}
                    className="h-auto min-h-10 w-full min-w-0 justify-start gap-2 px-0 text-left whitespace-normal"
                  >
                    {disclosure.bundles.teams ? (
                      <ChevronDownIcon aria-hidden />
                    ) : (
                      <ChevronRightIcon aria-hidden />
                    )}
                    <span>팀 {chart.unassignedTeams.length}개</span>
                  </Button>
                </h3>
                <ul
                  id="org-unassigned-teams"
                  hidden={!disclosure.bundles.teams}
                  className="grid min-w-0 gap-1"
                >
                  {chart.unassignedTeams.map(renderNode)}
                </ul>
              </div>
            </section>
          </aside>
          <section aria-label="선택한 팀" className="grid min-w-0 gap-4">
            {selectedTeam ? (
              <>
                <nav aria-label="팀 부서 경로" className="type-caption text-muted-foreground">
                  <ol className="flex flex-wrap gap-1">
                    {!hasKnownRoot ? (
                      <li>
                        상위 부서 미지정
                        <span aria-hidden className="ml-1">
                          ›
                        </span>
                      </li>
                    ) : null}
                    {selectedPath.map((department, index) => (
                      <li key={department.id} className="min-w-0 wrap-anywhere">
                        {department.name}
                        {index < selectedPath.length - 1 ? (
                          <span aria-hidden className="ml-1">
                            ›
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </nav>
                <h2
                  id="org-team-heading"
                  tabIndex={-1}
                  className="type-heading wrap-anywhere outline-none"
                >
                  {selectedTeam.department.name} · {selectedTeam.memberCount}명
                  {selectedTeam.department.targetCount !== null
                    ? ` · 목표 ${selectedTeam.department.targetCount}명`
                    : ""}
                </h2>
              </>
            ) : (
              <h2 id="org-team-heading" tabIndex={-1} className="type-heading outline-none">
                팀
              </h2>
            )}
            {members.length ? (
              <ul
                data-slot="org-people-grid"
                className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3"
              >
                {members.map((person) => (
                  <li
                    key={person.id}
                    data-person-id={person.id}
                    data-highlighted={focusedPerson?.id === person.id ? "true" : undefined}
                    className="relative flex h-full min-w-0 flex-col items-start gap-3 rounded-lg border border-border bg-card p-3 text-left shadow-xs hover:bg-muted/40 data-highlighted:bg-brand-soft data-highlighted:ring-2 data-highlighted:ring-brand"
                  >
                    <PersonAvatar
                      className="size-11 shrink-0"
                      personId={person.personCode}
                      portraitUrl={person.portraitUrl}
                      name={person.name}
                    />
                    <span className="grid min-w-0 gap-1">
                      <button
                        id={`org-person-${person.id}`}
                        type="button"
                        data-highlighted={focusedPerson?.id === person.id ? "true" : undefined}
                        aria-label={`${person.name} 상세 보기`}
                        aria-describedby={`org-person-${person.id}-title${person.scoringEligible ? ` org-person-${person.id}-scoring` : ""}`}
                        onClick={(event) => onSelect(person, event.currentTarget)}
                        className="text-left type-body font-semibold wrap-anywhere outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                      >
                        {person.name}
                      </button>
                      <span
                        id={`org-person-${person.id}-title`}
                        className="type-caption text-muted-foreground"
                      >
                        {titleNames.get(person.jobTitleId) ?? "직급 정보 없음"}
                      </span>
                    </span>
                    {person.scoringEligible ? (
                      <span
                        id={`org-person-${person.id}-scoring`}
                        className="rounded border border-border px-1.5 py-0.5 type-caption"
                      >
                        점수 계산 대상
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-border p-6 type-body">소속 인력이 없습니다</p>
            )}
          </section>
        </div>
      )}
    </AppPage>
  );
}
function DepartmentNode({
  node,
  expanded,
  selectedTeamId,
  onToggle,
  onSelectTeam,
}: {
  node: OrgNode;
  expanded: Set<string>;
  selectedTeamId?: string;
  onToggle: (id: string) => void;
  onSelectTeam: (id: string) => void;
}) {
  const { department } = node;
  const isTeam = department.kind === "TEAM";
  const contentId = `org-department-${department.id}`;
  const isExpanded = expanded.has(department.id);
  return (
    <li className="min-w-0">
      {isTeam ? (
        <div className="relative">
          <Button
            variant="ghost"
            aria-label={department.name}
            aria-describedby={`${contentId}-count`}
            aria-current={selectedTeamId === department.id ? "true" : undefined}
            onClick={() => onSelectTeam(department.id)}
            className="peer h-auto min-h-10 w-full min-w-0 justify-start gap-2 px-2 py-2 pr-10 text-left whitespace-normal aria-current:bg-brand-soft aria-current:text-brand"
          >
            <span className="min-w-0 type-label wrap-anywhere">{department.name}</span>
          </Button>
          <span
            id={`${contentId}-count`}
            className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 type-caption peer-aria-current:text-brand"
          >
            {node.memberCount}명
          </span>
        </div>
      ) : node.children.length ? (
        <>
          <div className="relative">
            <Button
              variant="ghost"
              aria-label={department.name}
              aria-describedby={`${contentId}-count`}
              aria-expanded={isExpanded}
              aria-controls={contentId}
              onClick={() => onToggle(department.id)}
              className="h-auto min-h-10 w-full min-w-0 justify-start gap-2 px-2 py-2 pr-10 text-left whitespace-normal"
            >
              {isExpanded ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
              <span className="min-w-0 flex-1 type-label wrap-anywhere">{department.name}</span>
            </Button>
            <span
              id={`${contentId}-count`}
              className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 type-caption"
            >
              {node.memberCount}명
            </span>
          </div>
          <ul
            id={contentId}
            hidden={!isExpanded}
            className="ml-3 grid min-w-0 gap-1 border-l border-border pl-4"
          >
            {node.children.map((child) => (
              <DepartmentNode
                key={child.department.id}
                node={child}
                expanded={expanded}
                selectedTeamId={selectedTeamId}
                onToggle={onToggle}
                onSelectTeam={onSelectTeam}
              />
            ))}
          </ul>
        </>
      ) : (
        <div className="grid min-h-10 min-w-0 gap-1 px-2 py-2">
          <span className="type-label wrap-anywhere">{department.name}</span>
          <span className="type-caption text-muted-foreground">
            {node.memberCount}명 · 연결된 팀 없음
          </span>
        </div>
      )}
    </li>
  );
}
