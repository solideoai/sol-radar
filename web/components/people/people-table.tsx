"use client";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
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
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="w-1/4">
            사진+이름
          </TableHead>
          <TableHead scope="col" className="w-[35%]">
            부서
          </TableHead>
          <TableHead scope="col" className="w-1/5">
            직급·직책
          </TableHead>
          <TableHead scope="col" className="w-1/5 whitespace-normal">
            점수 계산 대상
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
            <TableCell className="whitespace-normal">
              <Chip size="sm">{person.scoringEligible ? "점수 계산 대상" : "비대상"}</Chip>
            </TableCell>
            {renderActions ? <TableCell>{renderActions(person)}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
