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
import { formatKst } from "@/components/bids/format";
import type { OrgAuditPerson, OrgAuditView } from "@/server/organization";
import { AUDIT_COPY, MEMBERS_COPY } from "./org-settings-copy";

// 최근 변경 기록(§4.6). 읽기 전용이라 서버 부품이다. 행에 초점 받는 요소가 없다.
export function OrgAuditTable({ entries }: { entries: OrgAuditView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="org-audit-title">{AUDIT_COPY.title}</h2>
        </CardTitle>
        <CardDescription>{AUDIT_COPY.description}</CardDescription>
        <CardAction>
          <p className="type-label text-muted-foreground tabular-nums">{entries.length}건</p>
        </CardAction>
      </CardHeader>
      {entries.length === 0 ? (
        <CardContent>
          <p className="type-label text-muted-foreground">{AUDIT_COPY.empty}</p>
        </CardContent>
      ) : (
        <CardContent className="-mb-4 px-0">
          <Table className="min-w-180 table-fixed" containerClassName="rounded-none border-0">
            <caption className="sr-only">{AUDIT_COPY.caption(entries.length)}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="w-40 pl-6">
                  시각
                </TableHead>
                <TableHead scope="col" className="w-26">
                  종류
                </TableHead>
                <TableHead scope="col">한 사람</TableHead>
                <TableHead scope="col">대상</TableHead>
                <TableHead scope="col" className="w-48 pr-6">
                  업무 역할
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} className="h-11">
                  <TableCell className="pl-6 whitespace-nowrap text-muted-foreground tabular-nums">
                    <time dateTime={entry.at} title={entry.at}>
                      {formatKst(entry.at)}
                    </time>
                  </TableCell>
                  <TableCell className="text-foreground">
                    {entry.kind === "role-change" ? AUDIT_COPY.roleChange : AUDIT_COPY.invite}
                  </TableCell>
                  <TableCell>
                    <PersonName person={entry.actor} />
                  </TableCell>
                  <TableCell>
                    {entry.kind === "role-change" ? (
                      <PersonName person={entry.target} />
                    ) : (
                      <p className="truncate text-foreground" title={entry.email}>
                        {entry.email}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="pr-6 text-foreground">
                    {entry.kind === "role-change" ? (
                      <span className="whitespace-nowrap">
                        {entry.fromRole}
                        {/* 낭독은 "SALES에서 ANALYST로"다. 화살표는 읽지 않는다. */}
                        <span aria-hidden> → </span>
                        <span className="sr-only">에서 </span>
                        {entry.toRole}
                        <span className="sr-only">로</span>
                      </span>
                    ) : (
                      entry.toRole
                    )}
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

// 이름을 모르면(탈퇴·조직을 떠남) 회색 글자로 그 사실을 적는다(D11).
function PersonName({ person }: { person: OrgAuditPerson }) {
  if (person.kind !== "member") {
    return (
      <p className="truncate text-muted-foreground">
        {person.kind === "deleted" ? AUDIT_COPY.deleted : AUDIT_COPY.left}
      </p>
    );
  }
  return (
    <p className="flex min-w-0 items-baseline gap-1" title={person.name}>
      <span className="truncate text-foreground">{person.name}</span>
      {person.isMe ? (
        <span className="shrink-0 text-muted-foreground">{MEMBERS_COPY.me}</span>
      ) : null}
    </p>
  );
}
