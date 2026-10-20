import Link from "next/link";
import { cn } from "cn";
import { CircleCheckIcon, CircleMinusIcon } from "lucide-react";
import { formatKrwCompact, formatKrwFull, formatKst } from "@/components/bids/format";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  CompanyProfile,
  CompanyProfileSummary,
  CompanyStaffing,
} from "@/server/company-profile";

// 06 §5.6 탭별 본문. 각 탭 머리에 "이 값이 어느 점수 요소에 쓰이는지"를 한 줄로 적는다(08 §3·§4·§5.1).
// 빈 값은 점수 영향을 문장으로 밝힌다(06 §5.6 빈 상태, 08 §4 missing 정책).

const EMPTY = "—";
const TABLE_CARD = "gap-0 overflow-hidden py-0";

const kstDate = (iso: string): string => formatKst(iso).slice(0, 10);

function Panel({
  id,
  title,
  usage,
  children,
}: {
  id: string;
  title: string;
  usage: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-heading`} className="type-heading text-foreground">
          {title}
        </h2>
        <p className="type-body text-muted-foreground">{usage}</p>
      </div>
      {children}
    </section>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="type-body text-muted-foreground">{children}</p>
      </CardContent>
    </Card>
  );
}

// 점수 요소 이름은 공고 상세 점수 분해(FACTOR_LABEL)와 같은 글자다.
function Factor({ name, points }: { name: string; points: number }) {
  return (
    <span className="text-foreground">
      「{name}」({points}점)
    </span>
  );
}

const LEVEL_LABEL = { BASIC: "기초", INTERMEDIATE: "중급", EXPERT: "전문" } as const;

export function TechPanel({ profile }: { profile: CompanyProfile }) {
  const { technologies, technologiesComplete } = profile;
  return (
    <Panel
      id="tech"
      title={`기술 스택 ${technologies.length}개`}
      usage={
        <>
          <Factor name="기술 스택 적합" points={30} /> 점수와 기술 요건 판정에 쓰입니다.
        </>
      }
    >
      <p className="type-body text-foreground">
        {technologiesComplete
          ? "전체 목록입니다. 목록에 없는 기술은 ‘보유하지 않음’으로 판정합니다."
          : "목록이 완전하지 않습니다. 목록에 없는 기술은 ‘확인 필요’로 판정합니다."}
      </p>
      {technologies.length === 0 ? (
        <EmptyNote>
          등록된 기술이 없습니다. 점수 요소 「기술 스택 적합」이 0점으로 계산됩니다.
        </EmptyNote>
      ) : (
        <Card className={TABLE_CARD}>
          {/* 칸마다 오른쪽·아래 선을 긋고, 바깥 줄의 선은 -m 으로 카드 테두리 밖으로 밀어 겹치지 않게 한다. */}
          <ul className="-mr-px -mb-px grid grid-cols-4">
            {technologies.map((technology) => {
              const detail = [
                technology.level ? LEVEL_LABEL[technology.level] : null,
                technology.yearsOfExperience === undefined
                  ? null
                  : `경력 ${technology.yearsOfExperience}년`,
              ].filter((part) => part !== null);
              return (
                <li
                  key={technology.name}
                  className="flex min-w-0 flex-col gap-0.5 border-b border-r border-border px-4 py-3"
                >
                  <span className="type-body font-medium wrap-anywhere text-foreground">
                    {technology.name}
                  </span>
                  {detail.length > 0 ? (
                    <span className="type-caption text-muted-foreground">{detail.join(" · ")}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </Panel>
  );
}

function HeldStatus({ status }: { status: "HELD" | "NOT_HELD" }) {
  return status === "HELD" ? (
    <span className="inline-flex items-center gap-1 type-body text-success">
      <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0" />
      보유
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 type-body text-muted-foreground">
      <CircleMinusIcon aria-hidden="true" className="size-4 shrink-0" />
      미보유
    </span>
  );
}

export function LicensesPanel({ profile }: { profile: CompanyProfile }) {
  const { licenses, industryCodes } = profile;
  const heldCount = licenses.filter((license) => license.status === "HELD").length;
  return (
    <Panel
      id="licenses"
      title={`보유 자격 ${heldCount}개 · 미보유 ${licenses.length - heldCount}개`}
      usage="필수 자격 판정(충족 · 미충족 · 확인 필요)에 쓰입니다. 미보유로 확인한 자격만 ‘미충족’의 근거가 되고, 목록에 없는 자격은 ‘확인 필요’입니다."
    >
      {licenses.length === 0 ? (
        <EmptyNote>
          등록된 자격이 없습니다. 자격 요건이 있는 공고는 ‘확인 필요’로 판정합니다.
        </EmptyNote>
      ) : (
        <Card className={TABLE_CARD}>
          <Table className="table-fixed">
            <caption className="sr-only">보유 자격과 미보유로 확인한 자격</caption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col" className="pl-4">
                  자격
                </TableHead>
                <TableHead scope="col" className="w-[200px]">
                  코드
                </TableHead>
                <TableHead scope="col" className="w-[120px]">
                  상태
                </TableHead>
                <TableHead scope="col" className="w-[140px] pr-4">
                  유효 기간
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {licenses.map((license) => (
                <TableRow key={license.code} className="h-11">
                  <TableCell className="pl-4 type-body whitespace-normal wrap-anywhere">
                    {license.name}
                  </TableCell>
                  <TableCell className="font-mono type-caption text-muted-foreground">
                    {license.code}
                  </TableCell>
                  <TableCell>
                    <HeldStatus status={license.status} />
                  </TableCell>
                  <TableCell className="pr-4 type-body tabular-nums">
                    {license.validUntil ?? EMPTY}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <h3 className="mt-3 type-label font-medium text-foreground">
        나라장터 업종 코드 {industryCodes.length}개
      </h3>
      {industryCodes.length === 0 ? (
        <EmptyNote>
          등록된 업종 코드가 없습니다. 업종 제한이 있는 공고는 공고 API 의 면허 제한 필드로 먼저
          판정하고, 그것도 없으면 ‘확인 필요’입니다.
        </EmptyNote>
      ) : (
        <Card className={TABLE_CARD}>
          <ul className="divide-y divide-border">
            {industryCodes.map((industry) => (
              <li key={industry.code} className="flex items-center gap-4 px-4 py-3">
                <span className="min-w-0 flex-1 type-body wrap-anywhere">{industry.name}</span>
                <span className="font-mono type-caption text-muted-foreground">
                  {industry.code}
                </span>
                <HeldStatus status={industry.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Panel>
  );
}

export function ProjectsPanel({ profile }: { profile: CompanyProfile }) {
  const { pastProjects } = profile;
  return (
    <Panel
      id="projects"
      title={`수행 실적 ${pastProjects.length}건`}
      usage={
        <>
          <Factor name="유사 수행 실적" points={25} />과 <Factor name="규모 적합성" points={15} />에
          쓰입니다. 분야·금액·완료 시점이 공고와 가까울수록 높고, 증빙이 없는 실적은 절반만
          인정합니다.
        </>
      }
    >
      {pastProjects.length === 0 ? (
        <EmptyNote>
          등록된 실적이 없습니다. 「유사 수행 실적」은 0점, 「규모 적합성」은 중립 점수로
          계산합니다.
        </EmptyNote>
      ) : (
        <Card className={TABLE_CARD}>
          <Table className="table-fixed">
            <caption className="sr-only">수행 실적. 최근 완료한 사업이 위에 있습니다.</caption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col" className="pl-4">
                  사업명
                </TableHead>
                <TableHead scope="col" className="w-[160px]">
                  분야
                </TableHead>
                <TableHead scope="col" className="w-[120px] text-right">
                  금액
                </TableHead>
                <TableHead scope="col" className="w-[120px]">
                  완료일
                </TableHead>
                <TableHead scope="col" className="w-[96px] pr-4">
                  증빙
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...pastProjects]
                .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
                .map((project) => {
                  const amount = formatKrwCompact(project.amountKrw);
                  return (
                    <TableRow key={project.id} className="h-11">
                      <TableCell className="pl-4 type-body whitespace-normal wrap-anywhere">
                        {project.name}
                      </TableCell>
                      <TableCell className="type-body whitespace-normal wrap-anywhere">
                        {project.domain}
                      </TableCell>
                      <TableCell className="text-right type-body tabular-nums">
                        <span title={amount.full}>{amount.text}원</span>
                      </TableCell>
                      <TableCell className="type-body tabular-nums">
                        {project.completedAt}
                      </TableCell>
                      <TableCell className="pr-4 type-body">
                        {project.evidenceRef ? "있음" : "없음"}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </Card>
      )}
    </Panel>
  );
}

const NUMBER = new Intl.NumberFormat("ko-KR");

export function PeoplePanel({ staffing }: { staffing: CompanyStaffing }) {
  return (
    <Panel
      id="people"
      title="인력"
      usage={
        <>
          <Factor name="인력 가용성" points={20} />은 점수 계산 대상 인력의 가용 FTE 를 공고 수행
          기간에 맞춰 셉니다. 같은 기간에 다른 사업에 배정된 비율만큼 뺍니다.
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Card size="sm">
          <CardContent className="flex flex-col gap-1">
            <p className="type-label text-muted-foreground">점수 계산 대상</p>
            <p className="type-title tabular-nums text-foreground">
              {NUMBER.format(staffing.scoringCount)}명
            </p>
            <p className="type-caption text-muted-foreground">기술·등급·가용 기간이 입력된 인력</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="flex flex-col gap-1">
            <p className="type-label text-muted-foreground">전체 직원</p>
            <p className="type-title tabular-nums text-foreground">
              {NUMBER.format(staffing.totalCount)}명
            </p>
            <p className="type-caption text-muted-foreground">가상 솔리데오 명부</p>
          </CardContent>
        </Card>
      </div>
      {staffing.scoringCount === 0 ? (
        <EmptyNote>
          점수 계산 대상 인력이 없습니다. 「인력 가용성」은 중립 점수로 계산합니다.
        </EmptyNote>
      ) : null}
      <div>
        <Link
          href="/people?scoring=1"
          className={cn(buttonVariants({ variant: "outline" }), "w-fit")}
        >
          점수 계산 대상 인력 보기
        </Link>
      </div>
    </Panel>
  );
}

function DefinitionList({ rows }: { rows: { term: string; value: string }[] }) {
  return (
    <Card className={TABLE_CARD}>
      <dl className="divide-y divide-border">
        {rows.map((row) => (
          <div key={row.term} className="grid grid-cols-[200px_1fr] gap-4 px-4 py-3">
            <dt className="type-label text-muted-foreground">{row.term}</dt>
            <dd className="type-body wrap-anywhere text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const listText = (values: string[]): string => (values.length === 0 ? "없음" : values.join(" · "));

export function PreferencesPanel({ profile }: { profile: CompanyProfile }) {
  const { preferences } = profile;
  return (
    <Panel
      id="preferences"
      title="선호 설정"
      usage={
        <>
          <Factor name="전략적 선호" points={10} />에 쓰입니다. 제외 분야나 제외 키워드에 걸리는
          공고는 0점입니다.
        </>
      }
    >
      {preferences === null ? (
        <EmptyNote>선호 설정이 없습니다. 「전략적 선호」는 중립 점수(5점)로 계산합니다.</EmptyNote>
      ) : (
        <DefinitionList
          rows={[
            { term: "선호 분야", value: listText(preferences.domains) },
            { term: "선호 기관", value: listText(preferences.agencies) },
            { term: "선호 기관 유형", value: listText(preferences.agencyTypes) },
            { term: "제외 분야", value: listText(preferences.excludedDomains) },
            { term: "제외 키워드", value: listText(preferences.excludedKeywords) },
          ]}
        />
      )}
    </Panel>
  );
}

const krwOrEmpty = (value: string | undefined): string =>
  value === undefined ? EMPTY : formatKrwFull(value);

export function FinancialsPanel({ profile }: { profile: CompanyProfile }) {
  const { financials } = profile;
  return (
    <Panel
      id="financials"
      title="재무"
      usage={
        <>
          단일 사업 수행 상한은 <Factor name="규모 적합성" points={15} />에 쓰입니다. 공고 예산이
          상한을 넘으면 0점이 되고 ‘규모 초과’ 경고가 붙습니다.
        </>
      }
    >
      {financials === null ? (
        <EmptyNote>
          재무 정보가 없습니다. 「규모 적합성」은 수행 실적의 최대 금액으로만 계산합니다.
        </EmptyNote>
      ) : (
        <DefinitionList
          rows={[
            { term: "회계 연도", value: `${financials.fiscalYear}년` },
            { term: "연 매출", value: krwOrEmpty(financials.annualRevenueKrw) },
            { term: "자본금", value: krwOrEmpty(financials.capitalKrw) },
            {
              term: "직원 수",
              value:
                financials.employeeCount === undefined
                  ? EMPTY
                  : `${NUMBER.format(financials.employeeCount)}명`,
            },
            { term: "신용 등급", value: financials.creditRating ?? EMPTY },
            { term: "단일 사업 수행 상한", value: krwOrEmpty(financials.maxContractKrw) },
          ]}
        />
      )}
    </Panel>
  );
}

export function HistoryPanel({
  revisions,
  currentRevision,
}: {
  revisions: CompanyProfileSummary[];
  currentRevision: number;
}) {
  return (
    <Panel
      id="history"
      title={`변경 이력 ${revisions.length}건`}
      usage="프로필은 고쳐 쓰지 않고 새 revision 으로 쌓습니다. 분석 결과는 그때 쓴 revision 번호를 남겨서, 프로필이 바뀌어도 지난 분석은 그대로입니다."
    >
      <Card className={TABLE_CARD}>
        <Table className="table-fixed">
          <caption className="sr-only">회사 프로필 revision 이력. 최신이 위에 있습니다.</caption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="w-[120px] pl-4">
                revision
              </TableHead>
              <TableHead scope="col" className="w-[120px]">
                적용일
              </TableHead>
              <TableHead scope="col">메모</TableHead>
              <TableHead scope="col" className="w-[140px]">
                등록한 사람
              </TableHead>
              <TableHead scope="col" className="w-[160px] pr-4">
                등록 시각
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {revisions.map((revision) => (
              <TableRow key={revision.id} className="h-11">
                <TableCell className="pl-4 type-body tabular-nums">
                  <span className="inline-flex items-center gap-2">
                    rev {revision.revision}
                    {revision.revision === currentRevision ? (
                      <span className="inline-flex h-5 items-center rounded-sm border border-border px-1.5 type-caption text-foreground">
                        현재
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="type-body tabular-nums">
                  {kstDate(revision.effectiveAt)}
                </TableCell>
                <TableCell className="type-body whitespace-normal wrap-anywhere">
                  {revision.note ?? EMPTY}
                </TableCell>
                <TableCell className="type-body truncate">{revision.createdBy.name}</TableCell>
                <TableCell className="pr-4 type-body tabular-nums">
                  {formatKst(revision.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Panel>
  );
}

export { kstDate };
