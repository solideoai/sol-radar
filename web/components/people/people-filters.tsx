"use client";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Department, JobTitle } from "@/server/people";
import { peopleHref } from "./people-query";

export function PeopleFilters({
  query,
  departments,
  jobTitles,
  onNavigate,
}: {
  query: string;
  departments: Department[];
  jobTitles: JobTitle[];
  onNavigate: (href: string) => void;
}) {
  const params = new URLSearchParams(query);
  const [name, setName] = useState(params.get("q") ?? "");
  const [department, setDepartment] = useState(params.get("departmentId") ?? "");
  const [jobTitle, setJobTitle] = useState(params.get("jobTitleId") ?? "");
  const [scoring, setScoring] = useState(params.get("scoring") ?? "");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onNavigate(
      peopleHref("", {
        view: "list",
        q: name.trim(),
        departmentId: department,
        jobTitleId: jobTitle,
        scoring,
      }),
    );
  };
  return (
    <form
      onSubmit={submit}
      className="flex min-w-0 flex-wrap items-end gap-3"
      aria-label="인력 검색"
    >
      <div className="grid min-w-0 flex-1 basis-40 gap-2">
        <Label htmlFor="people-name">이름</Label>
        <Input
          id="people-name"
          placeholder="이름 검색"
          maxLength={40}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <FilterSelect
        id="people-department"
        label="부서"
        value={department}
        onChange={setDepartment}
        options={[
          { value: "", label: "전체 부서" },
          ...departments
            .filter((item) => item.kind === "TEAM" || item.kind === null)
            .map((item) => ({ value: item.id, label: item.name })),
        ]}
      />
      <FilterSelect
        id="people-job-title"
        label="직급/직책"
        value={jobTitle}
        onChange={setJobTitle}
        options={[
          { value: "", label: "전체 직급/직책" },
          ...jobTitles.map((item) => ({ value: item.id, label: item.label })),
        ]}
      />
      <FilterSelect
        id="people-scoring"
        label="점수 계산 대상"
        value={scoring}
        onChange={setScoring}
        options={[
          { value: "", label: "전체" },
          { value: "1", label: "대상" },
          { value: "0", label: "비대상" },
        ]}
      />
      <Button type="submit" className="h-10">
        검색
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-10"
        onClick={() => onNavigate("/people")}
      >
        초기화
      </Button>
    </form>
  );
}
function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="grid min-w-0 flex-1 basis-36 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(value) => onChange(value ?? "")} items={options}>
        <SelectTrigger id={id} className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="truncate">{option.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
