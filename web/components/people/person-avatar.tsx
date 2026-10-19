"use client";
import { useState, type ComponentProps } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { demoPortraitPath } from "@/lib/demo-portrait";
import { initialOf } from "@/lib/utils";
type PersonAvatarProps = Omit<ComponentProps<typeof Avatar>, "children"> & {
  personId?: string | null;
  name: string;
  portraitUrl?: string | null;
};
export function PersonAvatar({ personId, name, portraitUrl, ...props }: PersonAvatarProps) {
  const approvedPath = demoPortraitPath(personId);
  const portraitPath =
    portraitUrl === undefined ? approvedPath : portraitUrl === approvedPath ? portraitUrl : null;
  const [failedPath, setFailedPath] = useState<string | null>(null);
  return (
    <Avatar {...props}>
      {portraitPath && portraitPath !== failedPath ? (
        <AvatarImage
          key={portraitPath}
          src={portraitPath}
          alt={`${name} 프로필 사진`}
          keepMounted
          loading="lazy"
          decoding="async"
          className="absolute inset-0 data-loading:opacity-0 data-error:hidden"
          onLoadingStatusChange={(status) => {
            if (status === "error") setFailedPath(portraitPath);
          }}
        />
      ) : null}
      <AvatarFallback role="img" aria-label={`${name} 프로필 사진 없음`}>
        {initialOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}
