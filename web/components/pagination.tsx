"use client";

import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

// 끝에서는 링크 대신 꺼진 단추를 그린다(초점을 받지 않는다). 데이터는 읽지 않는다.
// 이동은 표를 가진 쪽이 한다(onNavigate) — 표를 흐리게 하고 새 쪽에서 초점을 옮기려고 같은 전환(transition)으로 묶는다.
// 자바스크립트가 없으면 링크(href)로 그대로 간다.
export function Pagination({
  page,
  pageCount,
  hrefOf,
  onNavigate,
}: {
  page: number;
  pageCount: number;
  hrefOf: (page: number) => string;
  onNavigate: (href: string) => void;
}) {
  const linkClass = cn(buttonVariants({ variant: "outline", size: "sm" }));
  const pageLink = (target: number, children: React.ReactNode) => (
    <Link
      href={hrefOf(target)}
      onNavigate={(event) => {
        event.preventDefault();
        onNavigate(hrefOf(target));
      }}
      className={linkClass}
    >
      {children}
    </Link>
  );
  const previous = (
    <>
      <ChevronLeftIcon data-icon="inline-start" />
      이전
    </>
  );
  const next = (
    <>
      다음
      <ChevronRightIcon data-icon="inline-end" />
    </>
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-3 sm:px-6">
      <p className="type-label text-muted-foreground tabular-nums">
        <span aria-hidden>
          {page} / {pageCount}쪽
        </span>
        <span className="sr-only">
          {pageCount}쪽 중 {page}쪽
        </span>
      </p>
      <nav aria-label="쪽 이동" className="flex gap-2">
        {page > 1 ? (
          pageLink(page - 1, previous)
        ) : (
          <Button variant="outline" size="sm" disabled>
            {previous}
          </Button>
        )}
        {page < pageCount ? (
          pageLink(page + 1, next)
        ) : (
          <Button variant="outline" size="sm" disabled>
            {next}
          </Button>
        )}
      </nav>
    </div>
  );
}
