"use client";

import { cn } from "cn";
import { BanIcon, SearchIcon, SearchXIcon, ShieldCheckIcon, UsersIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { initialOf } from "@/lib/utils";
import type { StatusChangeResult, UserListPage, UserView } from "@/server/admin";
import { nameOf } from "@/server/shared";
import { changeUserStatus } from "./actions";
import { listStatusText, usersHref } from "./user-query";

const SEARCH_ID = "admin-user-search";
const UNKNOWN_FAILURE = "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

// 대화상자 안에 보이는 거절. not-found 는 그 줄이 사라지므로 대화상자를 닫고 토스트로 알린다.
const statusFailure = (
  status: Exclude<StatusChangeResult["status"], "saved" | "not-found">,
): string => {
  switch (status) {
    case "self":
    case "admin-target":
      return "자기 자신과 다른 운영자는 정지할 수 없습니다. 화면을 새로 고칩니다.";
    case "forbidden":
    case "no-database":
      return "운영자 권한이 없어졌습니다. 화면을 새로 고칩니다.";
    case "signed-out":
      return "로그인이 풀렸습니다. 다시 로그인하세요.";
    case "invalid":
      return UNKNOWN_FAILURE;
  }
};

// 검색어와 쪽은 주소(URL 쿼리)에 있다. 쓰는 일은 회원 정지·해제 하나다.
// 버튼을 감추는 것(나·다른 운영자 줄)은 화면 요구이고, 막는 것은 도메인과 DB 함수(admin_set_user_status)다.
export function UserList({
  list,
  searchMaxLength,
}: {
  list: UserListPage;
  searchMaxLength: number;
}) {
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // 쪽 이동일 때만 새 쪽이 그려진 뒤 초점을 제목으로 옮긴다(검색한 경우는 입력칸에 남긴다).
  const focusAfterPageRef = useRef(false);
  // 방금 검색한(또는 지운) 결과가 그려질 때는 입력칸을 건드리지 않는다 — 그새 더 친 글자를 지우지 않게.
  const submittedRef = useRef<string | null>(null);

  const { rows, total, page, pageCount, pageSize, q } = list;
  const [confirm, setConfirm] = useState<UserView | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 줄이 사라졌으면(이미 탈퇴) 누른 버튼이 없으니 초점을 목록 제목으로 돌린다.
  const isGoneRef = useRef(false);

  const openConfirm = (user: UserView) => {
    setConfirm(user);
    setError(null);
    isGoneRef.current = false;
    setIsOpen(true);
  };

  const onConfirm = async () => {
    if (!confirm) return;
    const next = confirm.status === "active" ? "suspended" : "active";
    const name = nameOf(confirm.displayName, confirm.email);
    setIsPending(true);
    setError(null);
    try {
      const result = await changeUserStatus(confirm.id, next);
      setIsPending(false);
      if (result.status === "saved") {
        toast.success(
          next === "suspended" ? `${name} 님을 정지했습니다` : `${name} 님의 정지를 해제했습니다`,
        );
        setIsOpen(false);
        return;
      }
      if (result.status === "not-found") {
        toast.error("이미 탈퇴한 회원입니다. 목록을 새로 고칩니다.");
        isGoneRef.current = true;
        setIsOpen(false);
        return;
      }
      setError(statusFailure(result.status));
    } catch {
      setError(UNKNOWN_FAILURE);
      setIsPending(false);
    }
  };

  useEffect(() => {
    if (!focusAfterPageRef.current) return;
    focusAfterPageRef.current = false;
    headingRef.current?.focus();
  }, [page]);

  // 입력칸은 제어하지 않는다(글자마다 다시 그리지 않는다). 주소의 검색어가 다른 길(뒤로·앞으로 가기)로 바뀌면 입력칸을 맞춘다.
  useEffect(() => {
    const justSubmitted = submittedRef.current;
    submittedRef.current = null;
    if (justSubmitted !== null && justSubmitted === (q ?? "")) return;
    if (searchRef.current) searchRef.current.value = q ?? "";
  }, [q]);

  const navigate = (href: string, scroll: boolean) => {
    startTransition(() => {
      router.push(href, { scroll });
    });
  };

  const goToPage = (href: string) => {
    focusAfterPageRef.current = true;
    navigate(href, true);
  };

  // 자바스크립트가 없으면 폼이 그대로 GET /admin?q=… 로 간다.
  const onSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    const next = typeof value === "string" ? value.trim() : "";
    submittedRef.current = next;
    navigate(usersHref(next), false);
  };

  return (
    // min-w-0 이 없으면 긴 이메일이 단을 넓혀 화면이 가로로 넘친다.
    <section aria-labelledby="users-title" className="min-w-0">
      {/* 카드의 기본 여백을 풀어 줄 사이 선이 카드 끝까지 닿게 한다. 칸을 숨기는 기준은 화면 폭이 아니라 카드 폭(@container)이다. */}
      <Card className="@container gap-0 py-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
          <h2
            id="users-title"
            ref={headingRef}
            tabIndex={-1}
            className="type-heading text-foreground outline-none"
          >
            사용자 목록
          </h2>
          <p className="type-label text-muted-foreground tabular-nums">{total}명</p>
        </div>
        {/* 검색·쪽이 바뀐 것을 화면 낭독기에 여기 한 곳에서만 알린다. */}
        <p role="status" className="sr-only">
          {listStatusText({ total, page, pageSize, shown: rows.length, isSearching: q !== null })}
        </p>
        <form
          role="search"
          aria-label="사용자 검색"
          action="/admin"
          onSubmit={onSearch}
          className="flex flex-wrap items-end gap-3 border-b border-border px-6 py-4"
        >
          {/* 입력칸은 도구 줄이라 32px 로 둔다(작업 목록의 고르기와 같은 높이). */}
          <Field className="min-w-0 flex-1 basis-48 @2xl:max-w-sm">
            <FieldLabel htmlFor={SEARCH_ID}>검색</FieldLabel>
            <Input
              ref={searchRef}
              id={SEARCH_ID}
              name="q"
              type="search"
              defaultValue={q ?? ""}
              maxLength={searchMaxLength}
              placeholder="이메일 또는 표시 이름"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              className="h-8"
            />
          </Field>
          <Button type="submit" variant="outline" size="sm">
            <SearchIcon data-icon="inline-start" />
            검색
          </Button>
          {/* 누르면 사라지므로 초점을 입력칸으로 보낸다(새 검색어를 바로 친다). */}
          {q === null ? null : (
            <Link
              href="/admin"
              scroll={false}
              onNavigate={(event) => {
                event.preventDefault();
                submittedRef.current = "";
                if (searchRef.current) {
                  searchRef.current.value = "";
                  searchRef.current.focus();
                }
                navigate("/admin", false);
              }}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "@2xl:ml-auto")}
            >
              <XIcon data-icon="inline-start" />
              검색 지우기
            </Link>
          )}
        </form>
        {/* 흐리게 하는 것은 움직이는 효과가 아니라서 motion-reduce 와 상관없다. */}
        <div
          aria-busy={isNavigating}
          className={cn("transition-opacity", isNavigating && "opacity-60")}
        >
          {rows.length === 0 ? (
            <EmptyResult q={q} />
          ) : (
            // table-fixed 가 없으면 긴 이름·이메일이 표를 넓혀 말줄임되지 않는다.
            <Table className="table-fixed" aria-labelledby="users-title">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">사용자</TableHead>
                  {/* 조직 안 역할(소유자·멤버)과 헷갈리지 않게 설정 화면처럼 "계정 유형"이라 부른다. */}
                  <TableHead className="hidden w-28 @xl:table-cell">계정 유형</TableHead>
                  <TableHead className="hidden w-24 @xl:table-cell">상태</TableHead>
                  <TableHead className="hidden w-36 @2xl:table-cell">가입일</TableHead>
                  <TableHead className="w-24 pr-6">
                    <span className="sr-only">관리</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((user) => (
                  <UserRow key={user.id} user={user} onChangeStatus={() => openConfirm(user)} />
                ))}
              </TableBody>
            </Table>
          )}
          {/* 쪽이 하나여도 둔다 — 관리 목록은 전체 수와 지금 쪽이 늘 같은 자리에 보이는 편이 읽기 쉽다. */}
          {total > 0 ? (
            <Pagination
              page={page}
              pageCount={pageCount}
              hrefOf={(target) => usersHref(q, target)}
              onNavigate={goToPage}
            />
          ) : null}
        </div>
      </Card>
      <Dialog
        open={isOpen}
        // 진행 중에는 닫히지 않는다. 중복 요청과 "닫았는데 바뀜"을 같이 막는다.
        onOpenChange={(next) => {
          if (!isPending) setIsOpen(next);
        }}
      >
        <DialogContent
          showCloseButton={false}
          finalFocus={() => (isGoneRef.current ? headingRef.current : true)}
        >
          {confirm ? <StatusConfirm user={confirm} /> : null}
          {error ? (
            <p role="alert" className="type-label text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isPending} />}>
              취소
            </DialogClose>
            {confirm?.status === "active" ? (
              <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
                {isPending ? "정지하는 중…" : "정지"}
              </Button>
            ) : (
              <Button onClick={onConfirm} disabled={isPending}>
                {isPending ? "해제하는 중…" : "해제"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StatusConfirm({ user }: { user: UserView }) {
  const name = nameOf(user.displayName, user.email);
  return (
    <>
      <DialogHeader>
        {user.status === "active" ? (
          <>
            <DialogTitle className="wrap-anywhere">{name} 님을 정지할까요?</DialogTitle>
            <DialogDescription>
              정지하면 이 회원은 바로 모든 기기에서 로그아웃되고, 다시 로그인하거나 팀의 데이터를 볼
              수 없습니다. 데이터는 지우지 않으며, 해제하면 다시 이용할 수 있습니다.
            </DialogDescription>
          </>
        ) : (
          <>
            <DialogTitle className="wrap-anywhere">{name} 님의 정지를 해제할까요?</DialogTitle>
            <DialogDescription>
              해제하면 이 회원이 다시 로그인해 이전처럼 이용할 수 있습니다.
            </DialogDescription>
          </>
        )}
      </DialogHeader>
      <div className="rounded-lg bg-muted px-4 py-3 type-label wrap-anywhere">
        <p className="font-medium text-foreground">{name}</p>
        <p className="text-muted-foreground">{user.email ?? "이메일 없음"}</p>
      </div>
    </>
  );
}

function UserRow({ user, onChangeStatus }: { user: UserView; onChangeStatus: () => void }) {
  const name = nameOf(user.displayName, user.email);
  const isSuspended = user.status === "suspended";
  return (
    <TableRow>
      <TableCell className="pl-6">
        <div className="flex min-w-0 items-center gap-3">
          {/* 머리글자는 장식이다. 이름·이메일이 바로 옆에 글자로 있다. */}
          <Avatar aria-hidden>
            <AvatarFallback>{initialOf(nameOf(user.displayName, user.email))}</AvatarFallback>
          </Avatar>
          <div className="grid min-w-0">
            <p className="flex min-w-0 gap-1">
              {user.displayName === null ? (
                <span className="truncate text-muted-foreground">표시 이름 없음</span>
              ) : (
                <span className="truncate font-medium text-foreground" title={user.displayName}>
                  {user.displayName}
                </span>
              )}
              {user.isMe ? <span className="shrink-0 text-muted-foreground">(나)</span> : null}
              {/* 좁은 폭에서는 상태 칸이 없어 이름 옆에 둔다. */}
              {isSuspended ? (
                <span className="shrink-0 font-medium text-destructive @xl:hidden">정지</span>
              ) : null}
            </p>
            <p
              className="truncate type-caption text-muted-foreground"
              title={user.email ?? undefined}
            >
              {user.email ?? "이메일 없음"}
            </p>
            {/* 넓어지면 열에 있는 값은 뺀다: 계정 유형은 @xl, 가입일은 @2xl 부터 열에 있다. */}
            <p className="type-caption text-muted-foreground tabular-nums @2xl:hidden">
              <span className="@xl:hidden">{user.isAdmin ? "운영자" : "회원"} · </span>
              가입 <time dateTime={user.joinedAt}>{user.joinedDateText}</time>
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden @xl:table-cell">
        {user.isAdmin ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <ShieldCheckIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            운영자
          </span>
        ) : (
          <span className="text-muted-foreground">회원</span>
        )}
      </TableCell>
      <TableCell className="hidden @xl:table-cell">
        {isSuspended ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
            <BanIcon aria-hidden className="size-4 shrink-0" />
            정지
          </span>
        ) : (
          <span className="text-muted-foreground">정상</span>
        )}
      </TableCell>
      <TableCell className="hidden text-muted-foreground tabular-nums @2xl:table-cell">
        <time dateTime={user.joinedAt} title={user.joinedAtText}>
          {user.joinedDateText}
        </time>
      </TableCell>
      <TableCell className="pr-6">
        {user.canChangeStatus ? (
          <Button
            variant="outline"
            size="sm"
            aria-label={isSuspended ? `${name} 정지 해제` : `${name} 정지`}
            onClick={onChangeStatus}
          >
            {isSuspended ? "해제" : "정지"}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

// 검색하지 않았는데 비는 일은 거의 없다(보고 있는 운영자 자신이 사용자다). 그래도 빈 표 대신 안내를 둔다.
function EmptyResult({ q }: { q: string | null }) {
  const Icon = q === null ? UsersIcon : SearchXIcon;
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <Icon className="size-5" />
      </span>
      <div>
        <p className="type-body font-semibold text-foreground">
          {q === null ? "가입한 사용자가 없습니다" : "검색 결과가 없습니다"}
        </p>
        <p className="mt-1 type-label wrap-anywhere text-muted-foreground">
          {q === null
            ? "가입한 사람이 생기면 여기에 보입니다."
            : `검색어 “${q}”에 맞는 이메일·표시 이름이 없습니다. 다른 검색어를 쓰거나 검색을 지우세요.`}
        </p>
      </div>
    </div>
  );
}
