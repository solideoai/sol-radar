"use client";

import Link from "next/link";
import { MenuIcon } from "lucide-react";
import { useState } from "react";
import { LOGIN_HREF, SECTION_LINKS } from "@/components/landing/landing-links";
import { Logo } from "@/components/logo";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const MENU_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-lg px-3.5 py-2.5 type-ui-lg font-medium text-muted-foreground outline-none hover:bg-brand/5 hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/50";

export function SiteHeader({ startHref }: { startHref: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background break-keep">
      <div className="mx-auto flex min-h-16 w-full max-w-300 items-center gap-2 px-4 sm:px-6 xl:min-h-18 xl:gap-10 xl:px-10">
        <Link
          href="/"
          className="flex min-h-11 shrink-0 items-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>
        <nav aria-label="주요 메뉴" className="hidden xl:block">
          <ul className="flex items-center gap-1">
            {SECTION_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={MENU_LINK_CLASS}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1 xl:gap-2">
          <Link
            href={LOGIN_HREF}
            className={cn(
              buttonVariants({ variant: "ghost", size: "lg" }),
              "hidden xl:inline-flex",
            )}
          >
            로그인
          </Link>
          <Link
            href={startHref}
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "border-brand/25 px-3 text-brand hover:bg-brand/5 hover:text-brand xl:px-4",
            )}
          >
            시작하기
          </Link>
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label="메뉴 열기"
                  className="xl:hidden"
                />
              }
            >
              <MenuIcon aria-hidden className="size-4" />
            </SheetTrigger>
            <SheetContent className="data-[side=right]:w-[min(22rem,90vw)] [&_[data-slot=sheet-close]]:size-11">
              <SheetHeader className="pr-16">
                <SheetTitle>둘러보기</SheetTitle>
                <SheetDescription>SOL RADAR 서비스 소개와 계정 메뉴</SheetDescription>
              </SheetHeader>
              <nav aria-label="모바일 메뉴" className="flex flex-col gap-1 px-4 pb-6">
                {SECTION_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className={MENU_LINK_CLASS}
                  >
                    {link.label}
                  </Link>
                ))}
                <Link
                  href={LOGIN_HREF}
                  onClick={() => setMenuOpen(false)}
                  className={cn(MENU_LINK_CLASS, "mt-3 border-t border-border pt-4")}
                >
                  로그인
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
