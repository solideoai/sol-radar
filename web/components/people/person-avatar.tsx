"use client";

import type { ComponentProps } from "react";
import { UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { demoPortraitPath } from "@/lib/demo-portrait";

type PersonAvatarProps = Omit<ComponentProps<typeof Avatar>, "children"> & {
  personId?: string | null;
  name: string;
};

export function PersonAvatar({ personId, name, ...props }: PersonAvatarProps) {
  const portraitPath = demoPortraitPath(personId);

  return (
    <Avatar {...props}>
      {portraitPath ? (
        <AvatarImage key={portraitPath} src={portraitPath} alt={`${name} 프로필 사진`} />
      ) : null}
      <AvatarFallback role="img" aria-label={`${name} 프로필 사진 없음`}>
        <UserRound className="size-4" aria-hidden="true" />
      </AvatarFallback>
    </Avatar>
  );
}
