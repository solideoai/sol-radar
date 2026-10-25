"use client";

import { ImageUpIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import type { PhotoSaveResult } from "@/server/photos";
import { PHOTO_BUCKET, PHOTO_INPUT_TYPES, PHOTO_MAX_BYTES } from "@/server/shared";
import { checkPhotoFile, newPhotoPath, ownPhotoCleanupPaths, toSquareJpeg } from "./photo-file";

// 사진 고르기 → 가운데 정사각형 512px JPEG 로 줄이기 → 사용자 JWT 로 Storage 에 올리기(덮어쓰기 없음) → 경로 저장.
// 누가 어느 경로에 올릴 수 있는지는 Storage 정책(profile_photos_insert), 포인터 저장은 DB 함수가 정한다.
// 본인 폴더는 3장 상한이 있어(20261025000110) 올리기 전과 저장·지우기 뒤에 쓰지 않는 본인 사진을 지운다.

const MESSAGES: Record<Exclude<PhotoSaveResult["status"], "saved">, string> = {
  "signed-out": "로그인이 풀렸습니다. 다시 로그인하세요.",
  invalid: "사진 경로가 올바르지 않습니다. 다시 골라 주세요.",
  forbidden: "권한이 없습니다.",
};

/** 본인 폴더에서 쓰지 않는 사진을 지운다. 쓰는 사진은 삭제 정책이 남긴다. 실패해도 흐름을 막지 않는다. */
async function cleanUpOwnPhotos(objectPrefix: string): Promise<void> {
  if (!objectPrefix.startsWith("users/")) return;
  try {
    const bucket = getSupabaseBrowser().storage.from(PHOTO_BUCKET);
    const { data } = await bucket.list(objectPrefix, { limit: 100 });
    const paths = ownPhotoCleanupPaths(
      objectPrefix,
      (data ?? []).map((item) => item.name),
    );
    if (paths.length > 0) await bucket.remove(paths);
  } catch {
    // 정리는 다음 올리기 때 다시 한다.
  }
}

export function PhotoPicker({
  objectPrefix,
  hasPhoto,
  save,
  subject = "사진",
  size = "sm",
}: {
  /** users/<내 id> 또는 members/<직원 id> */
  objectPrefix: string;
  hasPhoto: boolean;
  save: (path: string | null) => Promise<PhotoSaveResult>;
  /** 버튼의 접근 이름에 붙인다. 예: "내 사진", "김민준 사진" */
  subject?: string;
  size?: "sm" | "xs";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const report = (result: PhotoSaveResult, done: string) => {
    if (result.status === "saved") toast.success(done);
    else toast.error(MESSAGES[result.status]);
  };

  const upload = async (file: File) => {
    const problem = checkPhotoFile(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const jpeg = await toSquareJpeg(file).catch(() => null);
      if (!jpeg || jpeg.size > PHOTO_MAX_BYTES) {
        toast.error("사진을 읽지 못했습니다. 다른 파일을 골라 주세요.");
        return;
      }
      await cleanUpOwnPhotos(objectPrefix);
      const path = newPhotoPath(objectPrefix, crypto.randomUUID());
      const { error } = await getSupabaseBrowser()
        .storage.from(PHOTO_BUCKET)
        .upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
      if (error) {
        toast.error("사진을 올리지 못했습니다. 잠시 뒤 다시 시도하세요.");
        return;
      }
      const result = await save(path);
      report(result, "사진을 바꿨습니다");
      if (result.status === "saved") await cleanUpOwnPhotos(objectPrefix);
    } catch {
      toast.error("사진을 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const result = await save(null);
      report(result, "사진을 지웠습니다");
      if (result.status === "saved") await cleanUpOwnPhotos(objectPrefix);
    } catch {
      toast.error("사진을 지우지 못했습니다. 잠시 뒤 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={input}
        type="file"
        accept={PHOTO_INPUT_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={busy}
        aria-label={`${subject} ${hasPhoto ? "바꾸기" : "올리기"}`}
        onClick={() => input.current?.click()}
      >
        <ImageUpIcon aria-hidden data-icon="inline-start" />
        {busy ? "저장 중…" : hasPhoto ? "사진 바꾸기" : "사진 올리기"}
      </Button>
      {hasPhoto ? (
        <Button
          type="button"
          variant="ghost"
          size={size}
          disabled={busy}
          aria-label={`${subject} 지우기`}
          onClick={() => void remove()}
        >
          <Trash2Icon aria-hidden data-icon="inline-start" />
          사진 지우기
        </Button>
      ) : null}
    </div>
  );
}
