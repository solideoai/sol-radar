import "server-only";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import { isPlainRecord } from "./normalize-common";
import { REDACTED, redactSecrets, redactUrl } from "./redaction";
import type { ExternalItem } from "./external-connector.model";

export const EXTERNAL_RESPONSE_MAX_BYTES = 20 * 1024 * 1024;
const MAX_DEPTH = 32;
const privateField = (rawName: string): boolean => {
  const name = rawName.replace(/^@_/, "");
  return (
    /^(?:servicekey|apikey|authorization|access_?token|refresh_?token|password)$/i.test(name) ||
    /(?:ofcl|charger|chpsn|email|telno|telnum|fax|phone|hpno|exctvnm|crdtrnm)/i.test(name)
  );
};
export function sanitizeExternalValue(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") return redactSecrets(redactUrl(value), secrets);
  if (Array.isArray(value)) return value.map((item) => sanitizeExternalValue(item, secrets));
  if (isPlainRecord(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !privateField(key))
        .map(([key, item]) => [redactSecrets(key, secrets), sanitizeExternalValue(item, secrets)]),
    );
  return value;
}
function withinDepth(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (Array.isArray(value)) return value.every((item) => withinDepth(item, depth + 1));
  return (
    !isPlainRecord(value) || Object.values(value).every((item) => withinDepth(item, depth + 1))
  );
}
function jsonWithinDepth(text: string): boolean {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "[" || char === "{") {
      depth++;
      if (depth > MAX_DEPTH) return false;
    } else if (char === "]" || char === "}") depth--;
  }
  return true;
}
function xmlWithinDepth(text: string): boolean {
  const withoutText = text.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  let depth = 0;
  for (const match of withoutText.matchAll(/<([^>]+)>/g)) {
    const tag = match[1].trim();
    if (tag.startsWith("?")) continue;
    if (tag.startsWith("/")) depth--;
    else if (!tag.endsWith("/")) {
      depth++;
      if (depth > MAX_DEPTH) return false;
    }
  }
  return true;
}
const field = (record: ExternalItem, name: string): unknown =>
  Object.entries(record).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const countOf = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  const count = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(count) ? count : null;
};
export type ExternalPayload =
  | {
      ok: true;
      items: ExternalItem[];
      totalCount: number | null;
      successCodeVerified: boolean;
      contentType: "application/json" | "application/xml";
      sanitizedPayload: string;
    }
  | {
      ok: false;
      kind: "MALFORMED" | "RESULT_CODE";
      resultCode?: string;
      detail: string;
      evidence?: { contentType: "application/json" | "application/xml"; sanitizedPayload: string };
    };
export function parseExternalPayload(
  text: string,
  secrets: readonly string[] = [],
): ExternalPayload {
  const malformed = (): ExternalPayload => ({
    ok: false,
    kind: "MALFORMED",
    detail: "RESPONSE_SCHEMA_INVALID",
  });
  if (Buffer.byteLength(text, "utf8") > EXTERNAL_RESPONSE_MAX_BYTES) return malformed();
  const isXml = text.trimStart().startsWith("<");
  let parsed: unknown;
  try {
    if (isXml) {
      if (
        /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text) ||
        !xmlWithinDepth(text) ||
        XMLValidator.validate(text) !== true
      )
        return malformed();
      parsed = new XMLParser({
        parseTagValue: false,
        parseAttributeValue: false,
        ignoreAttributes: false,
        processEntities: false,
        removeNSPrefix: true,
        maxNestedTags: MAX_DEPTH,
      }).parse(text);
    } else {
      if (!jsonWithinDepth(text)) return malformed();
      parsed = JSON.parse(text, (_key: string, value: unknown, context?: { source: string }) => {
        if (typeof value !== "number") return value;
        if (context?.source !== undefined) return context.source;
        if (!Number.isSafeInteger(value)) throw new Error("unsafe JSON number");
        return String(value);
      });
    }
  } catch {
    return malformed();
  }
  if (!withinDepth(parsed)) return malformed();
  const safe = sanitizeExternalValue(parsed, secrets);
  const contentType = isXml ? "application/xml" : "application/json";
  const sanitizedPayload = isXml
    ? new XMLBuilder({ ignoreAttributes: false, processEntities: false }).build(safe)
    : JSON.stringify(safe);
  const evidence: {
    contentType: "application/json" | "application/xml";
    sanitizedPayload: string;
  } = { contentType, sanitizedPayload };
  let root: unknown = safe;
  if (isPlainRecord(root))
    root = field(root, "response") ?? field(root, "OpenAPI_ServiceResponse") ?? root;
  if (!isPlainRecord(root) && !Array.isArray(root)) return malformed();
  let successCodeVerified = false;
  if (isPlainRecord(root)) {
    const gateway = field(root, "cmmMsgHeader");
    const header = field(root, "header");
    const codeValue = isPlainRecord(gateway)
      ? field(gateway, "returnReasonCode")
      : isPlainRecord(header)
        ? field(header, "resultCode")
        : field(root, "resultCode");
    if (codeValue !== undefined) {
      const code = String(codeValue);
      successCodeVerified = ["00", "0000", "0", "200", "INFO-000"].includes(code);
      if (!successCodeVerified)
        return {
          ok: false,
          kind: "RESULT_CODE",
          resultCode: code === REDACTED ? "REDACTED" : code,
          detail: "PROVIDER_RESULT_ERROR",
          evidence,
        };
    }
  }
  const body = isPlainRecord(root) ? (field(root, "body") ?? root) : root;
  const totalCount = isPlainRecord(body) ? countOf(field(body, "totalCount")) : null;
  let rows: unknown = Array.isArray(body)
    ? body
    : isPlainRecord(body)
      ? (field(body, "items") ?? field(body, "item") ?? field(body, "data") ?? field(body, "list"))
      : undefined;
  if (isPlainRecord(rows) && field(rows, "item") !== undefined) rows = field(rows, "item");
  if (rows === "" || rows === null || (rows === undefined && totalCount === 0)) rows = [];
  if (isPlainRecord(rows)) rows = [rows];
  if (!Array.isArray(rows) || !rows.every(isPlainRecord)) return malformed();
  return { ok: true, items: rows, totalCount, successCodeVerified, contentType, sanitizedPayload };
}
