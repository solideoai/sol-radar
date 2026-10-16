"use client";

import { cn } from "cn";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// type 은 이 부품이 정한다. 나머지 props(id·autoComplete·register 가 주는 것)는 입력칸으로 그대로 간다.
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative">
      {/* pr-10: 글자가 버튼 밑으로 들어가지 않게 버튼 폭만큼 비운다. */}
      <Input type={isVisible ? "text" : "password"} className={cn("pr-10", className)} {...props} />
      {/* 입력칸(40px) 안쪽에 2px 띄워 둔다. translate 로 가운데를 맞추지 않는다 — 버튼의 눌림 효과(active:translate-y-px)와 겹친다. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-0.5 right-0.5 rounded-md text-muted-foreground"
        aria-label={isVisible ? "비밀번호 숨기기" : "비밀번호 보기"}
        onClick={() => setIsVisible((wasVisible) => !wasVisible)}
      >
        {isVisible ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  );
}
