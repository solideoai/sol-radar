"use client";
import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PeopleDirectory } from "@/server/people";
import type { SelectPerson } from "./people-table";
import { PersonAvatar } from "./person-avatar";
import { buildOrgChart, type OrgNode } from "./org-chart-model";
export function OrgChart({
  directory,
  onSelect,
  onRetry,
}: {
  directory: PeopleDirectory;
  onSelect: SelectPerson;
  onRetry?: () => void;
}) {
  const chart = buildOrgChart(directory.departments, directory.members);
  const [expanded, setExpanded] = useState(
    () =>
      new Set(
        directory.departments
          .filter((item) => item.kind === "DIVISION" || item.kind === "GROUP")
          .map((item) => item.id),
      ),
  );
  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const titleNames = new Map(directory.jobTitles.map((item) => [item.id, item.label]));
  const renderNode = (node: OrgNode) => (
    <DepartmentNode
      key={node.department.id}
      node={node}
      expanded={expanded}
      onToggle={toggle}
      titleNames={titleNames}
      onSelect={onSelect}
    />
  );
  if (!directory.departments.length && !directory.members.length)
    return (
      <div className="rounded-lg border border-border p-6 type-body">
        <p>등록된 조직·인력이 없습니다</p>
        {onRetry ? (
          <Button variant="outline" className="mt-3" onClick={onRetry}>
            다시 시도
          </Button>
        ) : null}
      </div>
    );
  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-body text-muted-foreground">
          전체 조직도 · 목록 검색 조건은 명부에만 적용됩니다
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setExpanded(new Set(directory.departments.map((item) => item.id)))}
          >
            모두 펼치기
          </Button>
          <Button variant="outline" onClick={() => setExpanded(new Set())}>
            모두 접기
          </Button>
        </div>
      </div>
      <section aria-labelledby="people-divisions-heading" className="grid min-w-0 gap-3">
        <h2 id="people-divisions-heading" className="type-heading">
          본부
        </h2>
        <ul className="grid min-w-0 gap-2">{chart.divisions.map(renderNode)}</ul>
      </section>
      <section aria-labelledby="people-unassigned-heading" className="grid min-w-0 gap-3">
        <h2 id="people-unassigned-heading" className="type-heading">
          상위 미지정
        </h2>
        <p className="type-body text-muted-foreground">
          자료에서 상위 부서가 확인되지 않은 부서입니다.
        </p>
        <p className="type-body">
          {chart.unassignedGroups.length + chart.unassignedTeams.length}개 부서 · 소속 인력{" "}
          {chart.unassignedCount}명
        </p>
        <h3 className="type-label font-medium">그룹 {chart.unassignedGroups.length}개</h3>
        <ul className="grid min-w-0 gap-2">{chart.unassignedGroups.map(renderNode)}</ul>
        <h3 className="type-label font-medium">팀 {chart.unassignedTeams.length}개</h3>
        <ul className="grid min-w-0 gap-2">{chart.unassignedTeams.map(renderNode)}</ul>
      </section>
    </div>
  );
}
function DepartmentNode({
  node,
  expanded,
  onToggle,
  titleNames,
  onSelect,
}: {
  node: OrgNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  titleNames: Map<string, string>;
  onSelect: SelectPerson;
}) {
  const { department } = node;
  const isTeam = department.kind === "TEAM" || department.kind === null;
  const hasContent = node.children.length > 0 || node.members.length > 0;
  const isExpanded = expanded.has(department.id);
  const contentId = `people-department-${department.id}`;
  return (
    <li className="min-w-0 rounded-lg border border-border p-3">
      <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {hasContent ? (
          <Button
            variant="ghost"
            className="h-auto min-h-10 min-w-0 justify-start px-2 text-left whitespace-normal wrap-anywhere"
            aria-expanded={isExpanded}
            aria-controls={contentId}
            onClick={() => onToggle(department.id)}
          >
            {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            <span>{department.name}</span>
          </Button>
        ) : (
          <span className="type-body font-medium wrap-anywhere">{department.name}</span>
        )}
        <span className="type-caption text-muted-foreground">
          {!isTeam && !hasContent
            ? `소속 인력 ${node.memberCount}명 · 연결된 팀 없음`
            : `${isTeam ? "인력" : "소속 인력"} ${node.memberCount}명`}
          {isTeam && department.targetCount !== null ? ` · 목표 ${department.targetCount}명` : ""}
        </span>
      </div>
      {hasContent ? (
        <div
          id={contentId}
          hidden={!isExpanded}
          className="mt-2 min-w-0 border-l border-border pl-6"
        >
          {isExpanded ? (
            <>
              {node.children.length ? (
                <ul className="grid min-w-0 gap-2">
                  {node.children.map((child) => (
                    <DepartmentNode
                      key={child.department.id}
                      node={child}
                      expanded={expanded}
                      onToggle={onToggle}
                      titleNames={titleNames}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              ) : null}
              {node.members.length ? (
                <ul className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-2">
                  {node.members.map((person) => (
                    <li
                      key={person.id}
                      data-person-id={person.id}
                      className="flex min-w-0 items-center gap-2"
                    >
                      <PersonAvatar
                        personId={person.personCode}
                        portraitUrl={person.portraitUrl}
                        name={person.name}
                      />
                      <Button
                        variant="ghost"
                        className="h-auto min-h-10 min-w-0 justify-start px-2 text-left whitespace-normal wrap-anywhere"
                        aria-label={`${person.name} 상세 보기`}
                        onClick={(event) => onSelect(person, event.currentTarget)}
                      >
                        <span>
                          {person.name}
                          <span className="ml-2 type-caption font-normal text-muted-foreground">
                            {titleNames.get(person.jobTitleId) ?? "직급 정보 없음"}
                          </span>
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
