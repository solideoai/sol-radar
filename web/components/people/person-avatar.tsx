"use client";
import { useState, type ComponentProps } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { demoPortraitPath, isDisplayablePortrait } from "@/lib/demo-portrait";
import { initialOf } from "@/lib/utils";
type PersonAvatarProps = Omit<ComponentProps<typeof Avatar>, "children"> & {
  personId?: string | null;
  name: string;
  portraitUrl?: string | null;
};
export function PersonAvatar({ personId, name, portraitUrl, ...props }: PersonAvatarProps) {
  const approvedPath = demoPortraitPath(personId);
  // portraitUrl 을 주지 않으면 정장 사진, 주면 서버가 고른 사진(올린 사진·정장 사진·제공자 사진·null)이다.
  // 불러오지 못하면(signed URL 만료 포함) 머리글자로 바꾼다.
  const portraitPath =
    portraitUrl === undefined
      ? approvedPath
      : portraitUrl !== null && isDisplayablePortrait(portraitUrl, personId)
        ? portraitUrl
        : null;
  const [failedPath, setFailedPath] = useState<string | null>(null);
  return (
    <Avatar {...props}>
      {portraitPath && portraitPath !== failedPath ? (
        <AvatarImage
          key={portraitPath}
          src={portraitPath}
          alt={`${name} 프로필 사진`}
          keepMounted
          referrerPolicy="no-referrer"
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
