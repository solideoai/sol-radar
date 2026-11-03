import Link from "next/link";
import { useState } from "react";
import { formatKst } from "@/components/bids/format";
import { ANALYSIS_STATUS_LABEL } from "@/components/bids/labels";
import { StatusBadge } from "@/components/bids/status-badge";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { workRoleLabel } from "@/server/shared";
import type {
  WorkforceBidResult,
  WorkforceCandidate,
  WorkforceProposedTeam,
  WorkforceResult,
  WorkforceTeamMember,
  WorkforceTeamPerson,
  WorkforceTeamSupply,
} from "@/server/workforce";
// 한국 시각. 시간대 표기(KST)는 붙이지 않는다(2026-11-03 사용자 지시).
const date = (value: string) => (value.length === 10 ? value : formatKst(value));
// 최근 시도 상태는 문자열로 온다. 아는 분석 상태면 화면 이름으로 바꾼다.
const attemptStatus = (status: string) =>
  Object.hasOwn(ANALYSIS_STATUS_LABEL, status)
    ? ANALYSIS_STATUS_LABEL[status as keyof typeof ANALYSIS_STATUS_LABEL].short
    : status;
// 인력 양은 "명분"(한 사람이 그 기간 업무 시간을 전부 쓰면 1명분), 한 사람의 몫은 %로 적는다. FTE 라는 말은 쓰지 않는다.
const headcount = (value: number | null) => (value === null ? "—" : `${value}명분`);
const percent = (value: number) => `${Math.round(value * 100)}%`;
const reason = (value: string | null) =>
  value === "REQUIRED_FTE_UNKNOWN"
    ? "필요 인력 정보가 부족합니다."
    : value === "TEAM_EMPTY"
      ? "분석 당시 점수 대상 인력 정보가 없습니다."
      : value === "VALID_SNAPSHOT_REQUIRED"
        ? "유효한 완료 분석 스냅샷이 필요합니다."
        : value;
// 이름(직무·등급). 팀 표와 역할별 목록에서 한 줄로 보인다. 분석 당시 투입할 시간이 없으면 그렇게 적는다.
const personLabel = (person: WorkforceTeamPerson) =>
  `${person.name}(${[workRoleLabel(person.role), person.grade, person.availableFte > 0 ? null : "투입 가능 0%"].filter(Boolean).join("·")})`;
const teamSummary = (department: string, count: number, availableFte: number) =>
  `${department} ${count}명 · 투입 가능 ${headcount(availableFte)}`;
// 역할마다 팀은 앞의 몇 개만 펼친다. 후보가 많은 공고에서 카드가 끝없이 길어지지 않게 한다.
const VISIBLE_TEAMS = 3;
function TeamSupplyItems({ teams }: { teams: WorkforceTeamSupply[] }) {
  return (
    <ul className="space-y-1">
      {teams.map((team) => (
        <li key={team.department} className="type-caption wrap-anywhere">
          <p className="tabular-nums text-muted-foreground">
            {teamSummary(team.department, team.people.length, team.availableFte)}
          </p>
          <p>{team.people.map(personLabel).join(", ")}</p>
        </li>
      ))}
    </ul>
  );
}
function TeamSupplyList({ teams }: { teams: WorkforceTeamSupply[] }) {
  return (
    <>
      <TeamSupplyItems teams={teams.slice(0, VISIBLE_TEAMS)} />
      {teams.length > VISIBLE_TEAMS && (
        <details>
          <summary className="cursor-pointer type-caption">
            나머지 {teams.length - VISIBLE_TEAMS}개 팀 보기
          </summary>
          <TeamSupplyItems teams={teams.slice(VISIBLE_TEAMS)} />
        </details>
      )}
    </>
  );
}
function TeamCandidates({
  teams,
  candidates,
}: {
  teams: WorkforceTeamSupply[];
  candidates: Map<string, WorkforceCandidate>;
}) {
  return teams.map((team) => (
    <div key={team.department} className="mt-3">
      <p className="type-label font-medium tabular-nums">
        {teamSummary(team.department, team.people.length, team.availableFte)}
      </p>
      <ul>
        {team.people.map((p) => {
          const candidate = candidates.get(p.personId);
          return candidate ? <Candidate key={p.personId} person={candidate} /> : null;
        })}
      </ul>
    </div>
  ));
}
function RoleNeeds({ item }: { item: WorkforceBidResult }) {
  return (
    <>
      <h4 className="mt-5 mb-2 type-label font-medium">역할별 필요 인력</h4>
      {item.roleNeeds.length === 0 ? (
        <p className="type-caption text-muted-foreground">역할 정보 없음</p>
      ) : (
        <>
          <p className="mb-2 type-caption text-muted-foreground">
            부족은 분석 당시 가용 후보 수와 비교한 값이며 인력 부족 확정을 뜻하지 않습니다.
          </p>
          <ul className="space-y-3">
            {item.roleNeeds.map((need, index) => (
              <li
                key={`${need.role}:${index}`}
                className="space-y-1 border-t border-border pt-2 wrap-anywhere"
              >
                <p className="type-label tabular-nums">
                  {`${need.role} · ${need.minCount}명 필요 · 가용 후보 ${need.supplyCount}명${need.shortfall ? ` · 부족 ${need.shortfall}명` : ""}`}
                </p>
                {need.grade && (
                  <p className="type-caption text-muted-foreground">요구 등급 {need.grade}</p>
                )}
                {need.roleCode === null ? (
                  <p className="type-caption text-warning">직무 대응 없음 · 사람이 확인</p>
                ) : need.teams.length === 0 ? (
                  <p className="type-caption text-muted-foreground">같은 직무 후보가 없습니다.</p>
                ) : (
                  <TeamSupplyList teams={need.teams} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
function Candidate({ person }: { person: WorkforceCandidate }) {
  return (
    <li className="flex min-w-0 items-start gap-3 border-t border-border py-3 wrap-anywhere">
      <PersonAvatar
        size="lg"
        personId={person.personCode}
        portraitUrl={person.portraitUrl}
        name={person.name}
      />
      <div className="min-w-0 space-y-1">
        <p className="type-label font-medium">{person.name}</p>
        <p className="type-caption text-muted-foreground">
          {[person.jobTitle, workRoleLabel(person.role), person.grade].filter(Boolean).join(" · ")}
        </p>
        <p className="type-caption">기술: {person.skills.join(", ") || "정보 없음"}</p>
        <p className="type-caption tabular-nums">
          분석 당시 투입 가능 {percent(person.availableFte)}
        </p>
        <p className="type-caption text-muted-foreground">{person.matchReason}</p>
      </div>
    </li>
  );
}
// 추천 팀은 앞의 몇 명만 펼친다. 큰 사업(12명)에서 카드가 끝없이 길어지지 않게 한다.
const VISIBLE_MEMBERS = 6;
const fitText = (member: WorkforceTeamMember) =>
  member.fit === "MATCH"
    ? `같은 직무 · 요구 기술 일치: ${member.person.matchedSkills.join(", ")}`
    : member.fit === "ROLE"
      ? "같은 직무"
      : member.slotRoleCode === null
        ? "직무 대응 없음 · 다른 직무에서 대체"
        : "같은 직무 직원이 없어 다른 직무에서 대체";
const basisText = (team: WorkforceProposedTeam) => {
  const { neededCount, slotCount, members } = team;
  const notes = [
    team.basis === "STAFFING"
      ? "공고의 인력 요구조건대로 자리를 나눴습니다."
      : neededCount === null
        ? "필요 인력 정보가 없어 기본 구성(PM·개발자·디자이너 등)으로 짰습니다."
        : `필요 인력 ${neededCount}명분에 맞춰 PM·개발자·디자이너 등으로 자리를 나눴습니다.`,
    neededCount !== null && neededCount > slotCount
      ? `필요 인력이 ${neededCount}명분이라 핵심 ${slotCount}자리를 먼저 짰습니다.`
      : null,
    members.length < slotCount
      ? `분석 당시 인력이 모자라 ${slotCount}자리 가운데 ${members.length}자리만 채웠습니다.`
      : null,
  ];
  return notes.filter(Boolean).join(" ");
};
function TeamMemberRow({ member }: { member: WorkforceTeamMember }) {
  const { person } = member;
  return (
    <li className="flex min-w-0 items-start gap-3 border-t border-border py-3 wrap-anywhere">
      <PersonAvatar
        size="lg"
        personId={person.personCode}
        portraitUrl={person.portraitUrl}
        name={person.name}
      />
      <div className="min-w-0 space-y-1">
        <p className="type-label font-medium">{person.name}</p>
        <p className="type-caption font-medium">
          {member.slot} 담당 · {person.department ?? "부서 미지정"}
        </p>
        <p className="type-caption text-muted-foreground">
          {[person.jobTitle, workRoleLabel(person.role), person.grade].filter(Boolean).join(" · ")}
        </p>
        <p className={cn("type-caption tabular-nums", person.availableFte <= 0 && "text-warning")}>
          {person.availableFte > 0
            ? `분석 당시 투입 가능 ${percent(person.availableFte)}`
            : "분석 당시 투입 가능 0% · 일정 조정 필요"}
        </p>
        <p className="type-caption text-muted-foreground">{fitText(member)}</p>
      </div>
    </li>
  );
}
function ProposedTeam({ item, team }: { item: WorkforceBidResult; team: WorkforceProposedTeam }) {
  const { members } = team;
  const teamCount = new Set(members.map((member) => member.person.department)).size;
  return (
    <>
      <h4 className="mt-5 mb-2 type-label font-medium">추천 팀 구성 {members.length}명</h4>
      {members.length === 0 ? (
        <p className="type-caption text-warning">
          분석 당시 인력 정보가 없어 팀을 짤 수 없습니다. 공고를 다시 분석하세요.
        </p>
      ) : (
        <>
          <p className="type-caption text-muted-foreground">
            {basisText(team)} {teamCount}개 팀에서 골랐으며 확정 배정이 아닌 후보입니다.
          </p>
          {(item.candidateBasisMissing || item.candidates.length === 0) && (
            <p className="mt-1 type-caption text-warning">
              {item.candidateBasisMissing
                ? "공고에 역할·기술 요구조건이 없어 직무 기준으로 짰습니다. 적합성은 사람이 확인하세요."
                : "요구 기술·역할이 맞는 직원이 없어 직무 기준으로 짰습니다."}
            </p>
          )}
          <ul className="mt-2">
            {members.slice(0, VISIBLE_MEMBERS).map((member) => (
              <TeamMemberRow key={member.person.personId} member={member} />
            ))}
          </ul>
          {members.length > VISIBLE_MEMBERS && (
            <details>
              <summary className="cursor-pointer type-label">
                나머지 {members.length - VISIBLE_MEMBERS}명 보기
              </summary>
              <ul>
                {members.slice(VISIBLE_MEMBERS).map((member) => (
                  <TeamMemberRow key={member.person.personId} member={member} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </>
  );
}
function BidCard({ item }: { item: WorkforceBidResult }) {
  const candidates = new Map(item.candidates.map((p) => [p.personId, p]));
  return (
    <article className="min-w-0 rounded-lg border border-border p-4 wrap-anywhere">
      <div className="mb-4 space-y-2">
        <h3 className="type-heading">{item.title}</h3>
        <Link
          href={`/bids/${item.bidId}`}
          className="block type-label underline underline-offset-4"
        >
          공고 상세 보기
        </Link>
      </div>
      {item.analysisId === null ? (
        <>
          <p className="type-label text-warning">분석 필요</p>
          <p className="mt-2 type-body">필요 인력 — · 투입 가능 인력 —</p>
          <p className="mt-2 type-caption text-muted-foreground">{reason(item.missingReason)}</p>
        </>
      ) : (
        <>
          {item.latestAttempt && item.latestAttempt.id !== item.analysisId && (
            <p className="mb-3 type-caption text-warning">
              최근 시도 {attemptStatus(item.latestAttempt.status)} ·{" "}
              {formatKst(item.latestAttempt.at)}. 최근 유효 완료 분석을 표시합니다.
            </p>
          )}
          <div className="space-y-2 type-caption text-muted-foreground">
            {item.analysisStatus && (
              <StatusBadge kind="analysis" value={item.analysisStatus} short />
            )}
            <p>분석 당시 스냅샷 기준</p>
            <details>
              <summary className="min-h-8 cursor-pointer rounded-sm py-1.5 type-label outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                계산 기준
              </summary>
              <p>분석 시각 {item.analyzedAt ? formatKst(item.analyzedAt) : "정보 없음"}</p>
              <p>
                인력 스냅샷 기준 {item.snapshotAsOf ? formatKst(item.snapshotAsOf) : "정보 없음"}
              </p>
              <p>계산 기준일 {item.calculationDate}</p>
            </details>
            {item.period && (
              <p className="tabular-nums">
                수행 기간 {date(item.period.startsAt)} ~ {date(item.period.endsAt)}
                <br />
                {item.periodSource === "DEFAULT"
                  ? "기본 기간: 마감·기준일의 1개월 뒤 월초부터 6개월"
                  : "공고에 명시된 수행 기간"}
              </p>
            )}
          </div>
          <dl className="my-4 grid grid-cols-2 gap-3">
            <div>
              <dt className="type-caption text-muted-foreground">필요 인력</dt>
              <dd className="type-heading tabular-nums">{headcount(item.requiredFte)}</dd>
            </div>
            <div>
              <dt className="type-caption text-muted-foreground">분석 당시 투입 가능</dt>
              <dd className="type-heading tabular-nums">{headcount(item.availableFte)}</dd>
            </div>
          </dl>
          <p className="type-caption text-muted-foreground">
            1명분은 한 사람이 그 기간 업무 시간을 전부 쓰는 양입니다. 두 사람이 절반씩이면 1명분이라
            실제 인원 수와 다를 수 있습니다.
          </p>
          <p className="mt-2 type-caption">
            {item.requiredFteSource === "BUDGET_TIER"
              ? "필요 인력은 예산 구간 추정입니다."
              : item.requiredFteSource === "STAFFING"
                ? "필요 인력은 공고의 인력 요구조건을 합산했습니다."
                : "필요 인력 정보 부족"}
          </p>
          {item.missingReason && (
            <p className="mt-2 type-caption text-warning">{reason(item.missingReason)}</p>
          )}
          {item.note && <p className="mt-2 type-caption text-muted-foreground">{item.note}</p>}
          {item.proposedTeam && <ProposedTeam item={item} team={item.proposedTeam} />}
          <RoleNeeds item={item} />
          {!item.candidateBasisMissing && item.candidates.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer type-label font-medium">
                조건에 맞는 전체 후보 {item.candidates.length}명 보기
              </summary>
              <TeamCandidates teams={item.teams} candidates={candidates} />
            </details>
          )}
        </>
      )}
    </article>
  );
}
// 팀별 지원 요청 표는 앞의 몇 팀만 그리고, 나머지는 같은 표 안에 펼친다(열 폭을 유지하려고 표를 나누지 않는다).
const VISIBLE_TEAM_ROWS = 10;
function TeamPlanTable({ result }: { result: WorkforceResult }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = result.teamPlan.length - VISIBLE_TEAM_ROWS;
  const rows = expanded ? result.teamPlan : result.teamPlan.slice(0, VISIBLE_TEAM_ROWS);
  return (
    <>
      <Table id="team-plan-table" className="w-full min-w-160 table-fixed">
        <caption className="sr-only">팀별 지원 요청: 팀마다 공고별 후보와 맡을 역할</caption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">팀</TableHead>
            {result.bids.map((item) => (
              <TableHead key={item.bidId} className="whitespace-normal wrap-anywhere">
                <Link className="underline underline-offset-4" href={`/bids/${item.bidId}`}>
                  {item.title}
                </Link>
                {item.candidateBasisMissing && (
                  <p className="type-caption text-warning">요구조건 없음 · 사람이 확인</p>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.department}>
              <TableCell className="align-top whitespace-normal wrap-anywhere">
                <p className="font-medium">{row.department}</p>
                <p className="type-caption text-muted-foreground tabular-nums">
                  {row.personCount}명
                </p>
              </TableCell>
              {row.cells.map((cell) => (
                <TableCell key={cell.bidId} className="align-top whitespace-normal wrap-anywhere">
                  {cell.people.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <>
                      <p>{cell.people.map(personLabel).join(", ")}</p>
                      {cell.roles.length > 0 && (
                        <p className="type-caption text-muted-foreground">
                          {cell.roles.join(" · ")}
                        </p>
                      )}
                    </>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {hidden > 0 && (
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          aria-controls="team-plan-table"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "접기" : `나머지 ${hidden}개 팀 보기`}
        </Button>
      )}
    </>
  );
}
export function WorkforceResults({ result }: { result: WorkforceResult }) {
  const titleOf = (id: string) =>
    result.bids.find((b) => b.bidId === id)?.title ?? `배정 공고 ${id.slice(0, 8)}`;
  return (
    <>
      <section aria-labelledby="snapshot-heading" className="space-y-4">
        <h2 id="snapshot-heading" className="type-heading">
          분석 당시 인력 가용성
        </h2>
        <div
          className={`grid min-w-0 gap-4 ${result.bids.length === 3 ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3" : result.bids.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}
        >
          {result.bids.map((item) => (
            <BidCard key={item.bidId} item={item} />
          ))}
        </div>
      </section>
      <section
        aria-labelledby="team-plan-heading"
        className="min-w-0 space-y-4 border-t border-border pt-6"
      >
        <h2 id="team-plan-heading" className="type-heading">
          팀별 지원 요청
        </h2>
        <p className="type-caption text-muted-foreground">
          팀마다 어느 공고의 추천 팀에 누구를 낼지 보여 줍니다. 저장되거나 실제 배정에 반영되지
          않습니다.
        </p>
        {result.teamPlan.length === 0 ? (
          <p className="type-body text-muted-foreground">팀별로 묶을 후보가 없습니다.</p>
        ) : (
          <TeamPlanTable result={result} />
        )}
      </section>
      <section
        aria-labelledby="current-heading"
        className="min-w-0 space-y-4 border-t border-border pt-6"
      >
        <h2 id="current-heading" className="type-heading">
          현재 배정과 기간 충돌
        </h2>
        <p className="type-caption text-muted-foreground">
          현재 배정 기준 {formatKst(result.currentAssignmentsAsOf)} · 분석 당시 투입 가능 인력과
          별도 기준입니다.
        </p>
        <p className="type-caption text-muted-foreground">
          모든 기간은 시작 포함·종료 제외입니다. 종료와 다음 시작이 같으면 겹치지 않습니다.
        </p>
        {result.currentMissingPersonIds.length > 0 && (
          <p role="status" className="type-label text-warning">
            현재 가용량 정보가 없는 후보 {result.currentMissingPersonIds.length}명은 과부하를 확인할
            수 없습니다.
          </p>
        )}
        <h3 className="type-label font-medium">기존 배정 과부하</h3>
        {result.overloads.length === 0 ? (
          <p className="type-body text-muted-foreground">
            현재 조회 범위에서 확인된 기존 배정 과부하가 없습니다.
          </p>
        ) : (
          <Table className="w-full min-w-160 table-fixed">
            <caption className="sr-only">기존 배정이 현재 가용량을 초과한 실제 구간</caption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">이름</TableHead>
                <TableHead>관련 배정</TableHead>
                <TableHead>겹치는 기간</TableHead>
                <TableHead className="w-36">근거</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.overloads.map((row, i) => (
                <TableRow key={`${row.personId}:${i}`}>
                  <TableCell className="whitespace-normal wrap-anywhere">{row.name}</TableCell>
                  <TableCell className="whitespace-normal wrap-anywhere">
                    {row.assignments.map((a) => (
                      <p key={a.id}>
                        <Link className="underline" href={`/bids/${a.bidId}`}>
                          {titleOf(a.bidId)}
                        </Link>{" "}
                        · {a.allocationPercent}%
                      </p>
                    ))}
                  </TableCell>
                  <TableCell className="whitespace-normal wrap-anywhere">
                    {date(row.startsAt)} ~ {date(row.endsAt)}
                  </TableCell>
                  <TableCell className="whitespace-normal tabular-nums">
                    기존 배정 {percent(row.allocatedFte)}
                    <br />
                    가용 {percent(row.capacityFte)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <h3 className="type-label font-medium">공고 간 공유 후보</h3>
        <p className="type-caption text-muted-foreground">
          기간이 겹치는 공고에 같은 후보가 있습니다. 확정 배정이나 인력 부족 확정을 뜻하지 않습니다.
        </p>
        {result.sharedCandidates.length === 0 ? (
          <p className="type-body text-muted-foreground">
            현재 조회 범위에서 확인된 공유 후보가 없습니다.
          </p>
        ) : (
          <Table className="w-full min-w-160 table-fixed">
            <caption className="sr-only">겹치는 수행 기간의 공고 간 공유 후보</caption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">이름</TableHead>
                <TableHead>관련 공고</TableHead>
                <TableHead>겹치는 기간</TableHead>
                <TableHead className="w-36">근거</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.sharedCandidates.map((row, i) => (
                <TableRow key={`${row.personId}:${i}`}>
                  <TableCell className="whitespace-normal wrap-anywhere">{row.name}</TableCell>
                  <TableCell className="whitespace-normal wrap-anywhere">
                    {row.bidIds.map((id) => (
                      <p key={id}>
                        <Link className="underline" href={`/bids/${id}`}>
                          {titleOf(id)}
                        </Link>
                      </p>
                    ))}
                  </TableCell>
                  <TableCell className="whitespace-normal wrap-anywhere">
                    {date(row.startsAt)} ~ {date(row.endsAt)}
                  </TableCell>
                  <TableCell className="whitespace-normal">동일 후보 · 수행 기간 겹침</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}
