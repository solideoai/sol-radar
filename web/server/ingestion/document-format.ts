import "server-only";
import type { DocumentFormat } from "./attachment.model";

// ── 첨부 형식 판정: 확장자는 공고 작성자가 아무렇게나 붙일 수 있어 내용의 매직 바이트만 본다 ──
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

const HWP_SIGNATURE = "HWP Document File";
const HWPX_MIMETYPE = "application/hwp+zip";
const XLSX_PART_PREFIX = "xl/";

const startsWith = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  bytes.length >= magic.length && magic.every((byte, index) => bytes[index] === byte);

const containsAscii = (bytes: Uint8Array, text: string): boolean =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(text, 0, "latin1");

export function detectDocumentFormat(bytes: Uint8Array): DocumentFormat {
  if (startsWith(bytes, PDF_MAGIC)) return "PDF";
  // OLE 복합 문서는 doc·xls 도 같은 헤더라 HWP 서명이 있어야 HWP 로 본다.
  if (startsWith(bytes, OLE_MAGIC)) return containsAscii(bytes, HWP_SIGNATURE) ? "HWP" : "UNKNOWN";
  if (startsWith(bytes, ZIP_MAGIC)) {
    if (containsAscii(bytes, HWPX_MIMETYPE)) return "HWPX";
    if (containsAscii(bytes, XLSX_PART_PREFIX)) return "XLSX";
    return "ZIP";
  }
  return "UNKNOWN";
}
