"use client";
import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PhotoPicker } from "@/components/photo/photo-picker";
import type { Department, JobTitle, TeamMemberDetail, TeamMemberListItem } from "@/server/people";
import type { PhotoSaveResult } from "@/server/photos";
import { PersonAvatar } from "./person-avatar";
export function PersonDrawer({
  person,
  departments,
  jobTitles,
  onClose,
  returnFocus,
  canManagePhotos = false,
  savePhoto,
}: {
  person: TeamMemberListItem | null;
  departments: Department[];
  jobTitles: JobTitle[];
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
  /** 업무 역할 ADMIN 이면 참이다. 연결 여부와 관계없이 아무나의 사진을 바꾼다(설계 U4·U6). */
  canManagePhotos?: boolean;
  savePhoto?: (memberId: string, path: string | null) => Promise<PhotoSaveResult>;
}) {
  const department = departments.find((item) => item.id === person?.departmentId);
  const title = jobTitles.find((item) => item.id === person?.jobTitleId);
  return (
    <Sheet
      open={person !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="p-6 data-[side=right]:w-120 data-[side=right]:sm:max-w-none motion-reduce:transition-none"
        finalFocus={returnFocus}
      >
        <SheetHeader className="gap-3 p-0 pr-8">
          {person ? (
            <PersonAvatar
              personId={person.personCode}
              portraitUrl={person.portraitUrl}
              name={person.name}
              className="size-20"
            />
          ) : null}
          {person && canManagePhotos && savePhoto ? (
            <PhotoPicker
              objectPrefix={`members/${person.id}`}
              hasPhoto={person.hasUploadedPhoto}
              save={(path) => savePhoto(person.id, path)}
              subject={`${person.name} 사진`}
              size="xs"
            />
          ) : null}
          <SheetTitle>{person?.name ?? "인력 상세"}</SheetTitle>
          <SheetDescription>
            {department?.name ?? "부서 정보 없음"} · {title?.label ?? "직급 정보 없음"}
          </SheetDescription>
          {/* 신규 입사자(비데모 직원)에는 꼬리표를 붙이지 않는다(계획 판단 R3). */}
          {person?.isDemo ? <p className="type-caption text-muted-foreground">가상 인물</p> : null}
          {person ? (
            <p className="type-caption">{person.scoringEligible ? "점수 계산 대상" : "비대상"}</p>
          ) : null}
        </SheetHeader>
        {person ? (
          <PersonDetail
            key={person.id}
            id={person.id}
            departments={departments}
            jobTitles={jobTitles}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
type DetailState =
  | { status: "loading" }
  | { status: "ready"; data: TeamMemberDetail }
  | { status: "missing" }
  | { status: "error" };
function PersonDetail({
  id,
  departments,
  jobTitles,
}: {
  id: string;
  departments: Department[];
  jobTitles: JobTitle[];
}) {
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;
    const load = async (): Promise<DetailState> => {
      const response = await fetch(`/api/v1/team-members/${encodeURIComponent(id)}`, {
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 404) return { status: "missing" };
      if (!response.ok) return { status: "error" };
      const data: TeamMemberDetail = await response.json();
      return data.id === id ? { status: "ready", data } : { status: "error" };
    };
    void load()
      .then((result) => {
        if (isCurrent) setState(result);
      })
      .catch(() => {
        if (isCurrent) setState({ status: "error" });
      });
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [id, attempt]);
  if (state.status === "loading")
    return (
      <div role="status" className="grid gap-3">
        <p>상세 정보를 불러오는 중입니다</p>
        <Skeleton aria-hidden className="h-24 w-full" />
        <Skeleton aria-hidden className="h-40 w-full" />
      </div>
    );
  if (state.status === "missing") return <p role="alert">인력 정보를 찾을 수 없습니다</p>;
  if (state.status === "error")
    return (
      <div>
        <p role="alert">상세 정보를 불러오지 못했습니다</p>
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((previous) => previous + 1);
          }}
        >
          다시 시도
        </Button>
      </div>
    );
  const { data } = state;
  const department = departments.find((item) => item.id === data.departmentId);
  const title = jobTitles.find((item) => item.id === data.jobTitleId);
  const byId = new Map(departments.map((item) => [item.id, item]));
  const ancestors: Department[] = [];
  const seen = new Set<string>();
  let current = department;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    ancestors.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return (
    <div className="grid min-w-0 gap-6 wrap-anywhere">
      <section className="grid gap-3">
        <h2 className="type-heading">기본 정보</h2>
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2">
          <dt className="text-muted-foreground">부서</dt>
          <dd>{department?.name ?? "부서 정보 없음"}</dd>
          <dt className="text-muted-foreground">직급/직책</dt>
          <dd>{title?.label ?? "직급 정보 없음"}</dd>
          <dt className="text-muted-foreground">이메일</dt>
          <dd className="break-all">{data.email ?? "등록된 이메일 없음"}</dd>
        </dl>
        {ancestors.length > 1 ? (
          <p className="type-caption text-muted-foreground">
            {ancestors.map((item) => item.name).join(" → ")}
          </p>
        ) : department?.kind !== "DIVISION" && department?.parentId === null ? (
          <p className="type-caption text-muted-foreground">상위 부서 미지정</p>
        ) : null}
      </section>
      {data.scoring ? (
        <ScoringInformation scoring={data.scoring} />
      ) : (
        <p>점수 계산 대상이 아닙니다</p>
      )}
    </div>
  );
}
function ScoringInformation({ scoring }: { scoring: NonNullable<TeamMemberDetail["scoring"]> }) {
  return (
    <section className="grid min-w-0 gap-3">
      <h2 className="type-heading">점수 계산 정보</h2>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2">
        <dt className="text-muted-foreground">직무</dt>
        <dd>{scoring.role}</dd>
        <dt className="text-muted-foreground">등급</dt>
        <dd>{scoring.grade ?? "미등록"}</dd>
        <dt className="text-muted-foreground">스킬</dt>
        <dd>
          {scoring.skills.length ? (
            <ul className="grid gap-1">
              {scoring.skills.map((skill, index) => (
                <li key={`${skill}-${index}`}>{skill}</li>
              ))}
            </ul>
          ) : (
            "등록된 스킬 없음"
          )}
        </dd>
      </dl>
      <h3 className="type-label font-medium">가용성</h3>
      {scoring.availability.length ? (
        <>
          <p className="type-caption text-muted-foreground">종료일 미포함</p>
          <ul className="grid gap-2">
            {scoring.availability.map((period, index) => (
              <li key={`${period.startsAt}-${index}`} className="rounded border border-border p-3">
                <p>
                  {period.startsAt} ~ {period.endsAt}
                </p>
                <p>{period.fte} FTE</p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>등록된 가용성 정보 없음</p>
      )}
    </section>
  );
}
