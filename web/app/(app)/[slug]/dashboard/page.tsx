import { cn } from "cn";
import { UserIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { BarChart } from "@/components/bar-chart";
import { StatCard } from "@/components/stat-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { initialOf } from "@/lib/utils";
import { type ActivityView, getRecentActivities } from "@/server/activity";
import { getTaskDashboard, type TaskDashboard, type TaskView } from "@/server/task";
import { DueDate } from "@/app/(app)/[slug]/tasks/due-date";
import { activityScopeOf, requireWorkspace, taskScopeOf } from "@/app/(app)/[slug]/workspace";

export const metadata: Metadata = { title: "대시보드" };

// 화면은 세지 않는다 — 수치는 DB 집계 함수가 서울 날짜로 센다(@/server/task). 누가 무엇을 읽는지는 RLS 가 정한다.
// 작업 추가 버튼은 두지 않는다 — 작업 화면에 가서 추가한다.
export default async function DashboardPage({ params }: PageProps<"/[slug]/dashboard">) {
  await connection();
  const workspace = await requireWorkspace((await params).slug);
  const [dashboard, activities] = await Promise.all([
    getTaskDashboard(taskScopeOf(workspace)),
    getRecentActivities(activityScopeOf(workspace)),
  ]);
  const { slug, name, isPersonal } = workspace.current;

  return (
    <AppPage
      title="대시보드"
      description={
        isPersonal
          ? "내 작업의 진행 상황을 한눈에 봅니다."
          : `${name}의 작업 진행 상황을 한눈에 봅니다.`
      }
    >
      <Summary dashboard={dashboard} />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>최근 14일</h2>
          </CardTitle>
          <CardDescription>
            날짜별로 추가한 작업과 완료한 작업 수입니다. 서울 시간 기준입니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* 값이 모두 0 이면 눈금만 보인다 — 빈 상태 글을 따로 두지 않는다. */}
          <BarChart
            dates={dashboard.daily.map(({ date, label }) => ({ date, label }))}
            series={[
              { name: "추가", tone: "brand", counts: dashboard.daily.map((day) => day.added) },
              {
                name: "완료",
                tone: "chart-2",
                counts: dashboard.daily.map((day) => day.completed),
              },
            ]}
            caption="최근 14일 날짜별 작업 추가 수와 완료 수"
            unit="개"
          />
        </CardContent>
      </Card>

      {/* 기준은 화면 폭이 아니라 이 단의 폭이다(사이드바를 접고 펴면 달라진다). */}
      <div className="@container">
        {/* 두 카드의 길이가 달라 위쪽 정렬이다. */}
        <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <DueSoon slug={slug} tasks={dashboard.dueSoon} />
          <RecentActivity activities={activities} isPersonal={isPersonal} />
        </div>
      </div>
    </AppPage>
  );
}

// 값에 색을 입히지 않는다 — 기한 지남의 급함은 아래 표의 "지남" 표기가 맡는다. 카드는 링크가 아니다.
function Summary({ dashboard }: { dashboard: TaskDashboard }) {
  const { counts, weekStartLabel } = dashboard;
  return (
    <section aria-labelledby="dashboard-summary-title">
      <h2 id="dashboard-summary-title" className="sr-only">
        요약
      </h2>
      <div className="@container">
        <div className="grid grid-cols-2 gap-4 @2xl:grid-cols-4">
          <StatCard label="열린 작업" value={String(counts.open)} hint="할 일과 진행 중인 작업" />
          <StatCard
            label="기한 지남"
            value={String(counts.overdue)}
            hint="마감일이 오늘보다 이른 열린 작업"
          />
          <StatCard
            label="이번 주 완료"
            value={String(counts.completedThisWeek)}
            // 좁은 카드에서 날짜("10. 12.")가 가운데에서 꺾이지 않게 묶는다.
            hint={
              <>
                <span className="whitespace-nowrap">{weekStartLabel}</span> 월요일부터, 서울 시간
              </>
            }
          />
          <StatCard label="내 담당" value={String(counts.mine)} hint="나에게 맡겨진 열린 작업" />
        </div>
      </div>
    </section>
  );
}

// 제목은 링크가 아니다(작업 상세 화면이 없다).
function DueSoon({ slug, tasks }: { slug: string; tasks: TaskView[] }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2 id="due-soon-title">기한이 가까운 작업</h2>
        </CardTitle>
        <CardDescription>
          마감일이 있는 열린 작업을 마감일 순으로 5개까지 보여 줍니다.
        </CardDescription>
        {/* 비었을 때도 둔다 — 마감일이 없는 작업이 있을 수 있다. */}
        <CardAction>
          {/* buttonVariants 는 클래스를 이어 붙이기만 한다. cn 으로 합쳐야 outline 의 테두리가 바탕의 투명 테두리를 이긴다. */}
          <Link
            href={`/${slug}/tasks?sort=due`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            모두 보기
          </Link>
        </CardAction>
      </CardHeader>
      {tasks.length === 0 ? (
        <CardContent>
          <p className="type-label text-muted-foreground">마감일이 있는 열린 작업이 없습니다.</p>
        </CardContent>
      ) : (
        // 표는 카드 끝까지 닿고 첫·끝 칸 여백을 카드 여백(24px)에 맞춘다.
        // -mb-4: 줄마다 위아래 여백이 있어 그대로 두면 표 아래만 비어 보인다.
        <CardContent className="@container -mb-4 px-0">
          {/* table-fixed 가 없으면 긴 제목이 표를 넓혀 말줄임되지 않는다. */}
          <Table className="table-fixed" aria-labelledby="due-soon-title">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">작업</TableHead>
                <TableHead className="hidden w-36 @lg:table-cell">담당자</TableHead>
                <TableHead className="w-32 pr-6">마감일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="pl-6">
                    <p className="truncate text-foreground" title={task.title}>
                      {task.title}
                    </p>
                    <p className="mt-0.5 type-caption text-muted-foreground @lg:hidden">
                      {task.assignee === null ? (
                        "담당자 없음"
                      ) : (
                        <AssigneeName assignee={task.assignee} />
                      )}
                    </p>
                  </TableCell>
                  <TableCell className="hidden @lg:table-cell">
                    {task.assignee === null ? (
                      <span className="text-muted-foreground">없음</span>
                    ) : (
                      <p className="text-foreground">
                        <AssigneeName assignee={task.assignee} />
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="pr-6">
                    <DueDate task={task} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}

// 한 문자열로 통째로 줄이면 "(나)"가 잘려 내 담당인지 모른다. 긴 이름만 줄인다.
function AssigneeName({ assignee }: { assignee: NonNullable<TaskView["assignee"]> }) {
  return (
    <span className="flex min-w-0 gap-1">
      <span className="truncate" title={assignee.name}>
        {assignee.name}
      </span>
      {assignee.isMe ? <span className="shrink-0">(나)</span> : null}
    </span>
  );
}

// 문장은 서버 모델이 만든 글자 하나다. 문장 안에서 색으로 강조하지 않는다.
function RecentActivity({
  activities,
  isPersonal,
}: {
  activities: ActivityView[];
  isPersonal: boolean;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2 id="activity-title">최근 활동</h2>
        </CardTitle>
        <CardDescription>
          {isPersonal
            ? "최근 10개까지 보여 줍니다."
            : "팀에서 일어난 일을 최근 10개까지 보여 줍니다."}
        </CardDescription>
      </CardHeader>
      {activities.length === 0 ? (
        <CardContent>
          <p className="type-label text-muted-foreground">
            아직 기록된 활동이 없습니다. 작업을 추가하면 여기에 남습니다.
          </p>
        </CardContent>
      ) : (
        <CardContent className="-mb-4 px-0">
          <ul aria-labelledby="activity-title" className="divide-y divide-border">
            {activities.map((activity) => (
              <li key={activity.id} className="flex gap-3 px-6 py-3">
                {/* 문장에 이름이 있어 아바타는 숨긴다. */}
                <Avatar size="sm" aria-hidden className="mt-0.5">
                  <AvatarFallback>
                    {activity.subjectName === null ? (
                      <UserIcon className="size-3.5" />
                    ) : (
                      initialOf(activity.subjectName)
                    )}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  {/* 긴 제목·이름은 자르지 않고 줄을 바꾼다. */}
                  <p className="type-label wrap-anywhere text-foreground">{activity.text}</p>
                  <time
                    dateTime={activity.createdAt}
                    className="type-caption text-muted-foreground tabular-nums"
                  >
                    {activity.createdAtText}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
