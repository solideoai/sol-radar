"use client";
import { useRef, useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PeopleDirectory, TeamMemberListItem } from "@/server/people";

const matchesName = (person: TeamMemberListItem, query: string) =>
  person.name.includes(query.trim());

// 목록에서 고르면 그 사람의 팀으로 간다. Enter·[검색]은 1명이면 바로 가고, 여럿이거나 없으면 목록을 연다.
// 입력값이 선택값에 묶이지 않는 Autocomplete 를 쓴다. Combobox(value=null)는 목록이 닫힐 때 친 이름을 지웠고,
// 항목을 고르지 않은 Enter 는 목록만 닫았다.
export function OrgNameFinder({
  directory,
  onPick,
}: {
  directory: PeopleDirectory;
  onPick: (person: TeamMemberListItem) => void;
}) {
  const departments = new Map(directory.departments.map((item) => [item.id, item.name]));
  const titles = new Map(directory.jobTitles.map((item) => [item.id, item.label]));
  const members = [...new Map(directory.members.map((person) => [person.id, person])).values()];
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = (person: TeamMemberListItem) => {
    setQuery(person.name);
    setOpen(false);
    onPick(person);
  };
  const search = () => {
    if (!query.trim()) {
      inputRef.current?.focus();
      return;
    }
    const matches = members.filter((person) => matchesName(person, query));
    if (matches.length === 1) {
      pick(matches[0]);
      return;
    }
    setOpen(true);
    inputRef.current?.focus();
  };
  return (
    <form
      role="search"
      aria-label="이름 찾기"
      className="flex w-88 min-w-0 gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        search();
      }}
    >
      <Autocomplete.Root<TeamMemberListItem>
        items={members}
        limit={8}
        value={query}
        onValueChange={setQuery}
        open={open}
        onOpenChange={setOpen}
        itemToStringValue={(person) => person.name}
        filter={matchesName}
      >
        <Autocomplete.Input
          ref={inputRef}
          aria-label="이름으로 찾기"
          placeholder="이름으로 찾기"
          render={<Input />}
        />
        <Autocomplete.Portal>
          <Autocomplete.Positioner sideOffset={4} align="start" className="z-30">
            <Autocomplete.Popup
              finalFocus={false}
              className="max-h-(--available-height) w-(--anchor-width) min-w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {/* Empty 는 알림 영역이라 늘 그려진다. 결과가 있을 때(글자 없음) 여백이 빈 줄로 보이지 않게 한다. */}
              <Autocomplete.Empty className="p-3 type-body text-muted-foreground empty:p-0">
                일치하는 이름이 없습니다
              </Autocomplete.Empty>
              <Autocomplete.List>
                {(person: TeamMemberListItem) => (
                  <Autocomplete.Item
                    key={person.id}
                    value={person}
                    onClick={() => pick(person)}
                    className="cursor-default rounded px-2 py-2 type-label wrap-anywhere outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  >
                    {person.name} · {departments.get(person.departmentId) ?? "부서 정보 없음"} ·{" "}
                    {titles.get(person.jobTitleId) ?? "직급 정보 없음"}
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
      <Button type="submit" variant="outline" className="h-10">
        <SearchIcon aria-hidden className="size-4" />
        검색
      </Button>
    </form>
  );
}
