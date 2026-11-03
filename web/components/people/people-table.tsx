"use client";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PersonAvatar } from "./person-avatar";
import type { Department, JobTitle, TeamMemberListItem } from "@/server/people";
export type SelectPerson = (person: TeamMemberListItem, trigger: HTMLElement) => void;
// "점수 계산 대상" 열은 두지 않는다(명부 대부분이 같은 값이라 열이 정보를 주지 않았다, 2026-11-03 사용자 지시, ADR-081).
// 대상 여부는 거르기(people-filters)와 인물 서랍이 보인다.
export function PeopleTable({
  members,
  departments,
  jobTitles,
  onSelect,
  renderActions,
}: {
  members: TeamMemberListItem[];
  departments: Department[];
  jobTitles: JobTitle[];
  onSelect: SelectPerson;
  // ADMIN 의 줄 관리 메뉴(N4b). 없으면 열을 그리지 않는다.
  renderActions?: (person: TeamMemberListItem) => React.ReactNode;
}) {
  const departmentNames = new Map(departments.map((item) => [item.id, item.name]));
  const titleNames = new Map(jobTitles.map((item) => [item.id, item.label]));
  return (
    <Table className="min-w-140 table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="w-[30%]">
            사진+이름
          </TableHead>
          <TableHead scope="col" className="w-[45%]">
            부서
          </TableHead>
          <TableHead scope="col" className="w-1/4">
            직급·직책
          </TableHead>
          {renderActions ? (
            <TableHead scope="col" className="w-14">
              <span className="sr-only">관리</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((person) => (
          <TableRow
            key={person.id}
            className="h-14 cursor-pointer"
            onClick={(event) => {
              if (!(event.target instanceof Element) || !event.target.closest("button")) {
                const button = event.currentTarget.querySelector("button");
                if (button) onSelect(person, button);
              }
            }}
          >
            <TableCell className="whitespace-normal">
              <div className="flex min-w-0 items-center gap-2">
                <PersonAvatar
                  personId={person.personCode}
                  portraitUrl={person.portraitUrl}
                  name={person.name}
                />
                <Button
                  variant="ghost"
                  className="h-auto min-h-9 min-w-0 px-1 whitespace-normal wrap-anywhere"
                  aria-label={`${person.name} 상세 보기`}
                  onClick={(event) => onSelect(person, event.currentTarget)}
                >
                  {person.name}
                </Button>
              </div>
            </TableCell>
            <TableCell className="whitespace-normal wrap-anywhere">
              {departmentNames.get(person.departmentId) ?? "부서 정보 없음"}
            </TableCell>
            <TableCell className="whitespace-normal wrap-anywhere">
              {titleNames.get(person.jobTitleId) ?? "직급 정보 없음"}
            </TableCell>
            {renderActions ? <TableCell>{renderActions(person)}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
