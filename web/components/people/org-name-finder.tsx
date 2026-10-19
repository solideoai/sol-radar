"use client";
import { Combobox } from "@base-ui/react/combobox";
import { Input } from "@/components/ui/input";
import type { PeopleDirectory, TeamMemberListItem } from "@/server/people";
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
  return (
    <div className="w-72 min-w-0">
      <Combobox.Root<TeamMemberListItem>
        items={members}
        limit={8}
        value={null}
        itemToStringLabel={(person) => person.name}
        filter={(person, query) => person.name.includes(query.trim())}
        onValueChange={(person) => {
          if (person) onPick(person);
        }}
      >
        <Combobox.Input aria-label="이름으로 찾기" placeholder="이름으로 찾기" render={<Input />} />
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} align="end" className="z-30">
            <Combobox.Popup
              finalFocus={false}
              className="max-h-(--available-height) w-(--anchor-width) min-w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
            >
              <Combobox.Empty className="p-3 type-body text-muted-foreground">
                일치하는 이름이 없습니다
              </Combobox.Empty>
              <Combobox.List>
                {(person: TeamMemberListItem) => (
                  <Combobox.Item
                    key={person.id}
                    value={person}
                    className="cursor-default rounded px-2 py-2 type-label wrap-anywhere outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  >
                    {person.name} · {departments.get(person.departmentId) ?? "부서 정보 없음"} ·{" "}
                    {titles.get(person.jobTitleId) ?? "직급 정보 없음"}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
