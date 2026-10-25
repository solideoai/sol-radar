import { PHOTO_INPUT_MAX_BYTES, PHOTO_INPUT_TYPES, PHOTO_SIZE_PX } from "@/server/shared";

// ── 사진 파일 처리: 브라우저에서 고른 사진을 가운데 정사각형 512px JPEG 로 줄인다(설계 C11) ──

/** 올리기 전에 거른다. 문제가 있으면 한국어 안내, 없으면 null. 같은 크기·형식을 버킷이 한 번 더 막는다. */
export function checkPhotoFile(file: { type: string; size: number }): string | null {
  if (!PHOTO_INPUT_TYPES.some((type) => type === file.type))
    return "JPG·PNG·WEBP 사진만 올릴 수 있습니다";
  if (file.size === 0) return "빈 파일입니다";
  if (file.size > PHOTO_INPUT_MAX_BYTES) return "10MB 이하 사진을 골라 주세요";
  return null;
}

/** 긴 쪽의 가운데를 짧은 쪽 길이로 자르는 원본 좌표. */
export function centerSquare(width: number, height: number) {
  const size = Math.min(width, height);
  return {
    sx: Math.floor((width - size) / 2),
    sy: Math.floor((height - size) / 2),
    size,
  };
}

/**
 * 정리할 본인 사진 경로. 본인 폴더(users/<id>)만 대상이고 members/ 는 빈 목록이다.
 * 지금 쓰는 사진도 목록에 들지만 Storage 삭제 정책(20261025000110)이 쓰는 사진은 지우지 않는다.
 */
export const ownPhotoCleanupPaths = (prefix: string, names: readonly string[]): string[] =>
  prefix.startsWith("users/") ? names.map((name) => `${prefix}/${name}`) : [];

/** Storage 경로. 덮어쓰지 않으려고 올릴 때마다 새 id 를 쓴다. */
export const newPhotoPath = (prefix: string, id: string): string => `${prefix}/${id}.jpg`;

/** 사진을 정사각형 512px JPEG(흰 바탕, 품질 0.88)로 그린다. 읽지 못하는 파일이면 던진다. */
export async function toSquareJpeg(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { sx, sy, size } = centerSquare(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_SIZE_PX;
    canvas.height = PHOTO_SIZE_PX;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas_unavailable");
    // 투명한 PNG·WEBP 도 JPEG 에서 검게 바뀌지 않게 바탕을 칠한다.
    context.fillStyle = "white";
    context.fillRect(0, 0, PHOTO_SIZE_PX, PHOTO_SIZE_PX);
    context.drawImage(bitmap, sx, sy, size, size, 0, 0, PHOTO_SIZE_PX, PHOTO_SIZE_PX);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("encode_failed"))),
        "image/jpeg",
        0.88,
      ),
    );
  } finally {
    bitmap.close();
  }
}
