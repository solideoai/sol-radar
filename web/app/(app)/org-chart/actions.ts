"use server";

import { refresh } from "next/cache";
import { requireCompleteEmployment } from "@/app/(app)/employment-guard";
import { type PhotoSaveResult, saveMemberPhoto } from "@/server/photos";

// 관리자의 직원 사진 변경(설계 5.1 사진 바꾸기). 파일은 브라우저가 먼저 Storage 에 올린다.
// ADMIN 인지는 Storage 정책과 DB 함수(set_member_photo)가 정한다. 인자는 화면 밖 POST 도 오므로 unknown 으로 받는다.
export async function saveMemberPhotoAction(
  memberId: unknown,
  path: unknown,
): Promise<PhotoSaveResult> {
  await requireCompleteEmployment("/org-chart");
  const result = await saveMemberPhoto(memberId, path);
  if (result.status === "saved") refresh();
  return result;
}
