import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PeopleReadError, type PeopleQuery } from "./people.model";
type Binding = { orgId: string; query: PeopleQuery };
type Position = { personCode: string; id: string };
const payloadSchema = z.strictObject({
  version: z.literal(1),
  personCode: z.string().regex(/^SOL-P\d{4}$/),
  id: z.uuid(),
  orgId: z.string(),
  filters: z.string(),
  issuedAt: z.number().int().nonnegative(),
});
const ttlMs = 24 * 60 * 60 * 1000;
export function assertPeopleCursorConfigured(): string {
  const secret = process.env.API_CURSOR_SECRET;
  if (!secret || secret.length < 32)
    throw new PeopleReadError(503, "SERVICE_UNAVAILABLE", "페이지 조회 설정이 필요합니다.", {
      component: "cursor",
    });
  return secret;
}
const filtersOf = ({ query }: Binding): string =>
  JSON.stringify([
    query.q ?? "",
    query.departmentId ?? "",
    query.jobTitleId ?? "",
    query.scoring ?? "",
    query.limit,
  ]);
const signatureOf = (body: string, secret: string): Buffer =>
  createHmac("sha256", secret).update(body).digest();
const invalid = (): PeopleReadError =>
  new PeopleReadError(400, "INVALID_CURSOR", "페이지 정보가 만료되었거나 올바르지 않습니다.");
export function createPeopleCursor(binding: Binding, position: Position, now = Date.now()): string {
  const secret = assertPeopleCursorConfigured();
  const payload = payloadSchema.parse({
    version: 1,
    personCode: position.personCode,
    id: position.id,
    orgId: binding.orgId,
    filters: filtersOf(binding),
    issuedAt: now,
  });
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signatureOf(body, secret).toString("base64url")}`;
}
export function readPeopleCursor(token: string, binding: Binding, now = Date.now()): Position {
  const secret = assertPeopleCursorConfigured();
  const pieces = token.split(".");
  if (
    token.length > 4096 ||
    pieces.length !== 2 ||
    pieces.some((part) => !part || !/^[A-Za-z0-9_-]+$/.test(part))
  )
    throw invalid();
  const [body, signature] = pieces;
  const provided = Buffer.from(signature, "base64url");
  const expected = signatureOf(body, secret);
  if (
    provided.toString("base64url") !== signature ||
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    throw invalid();
  const decoded = Buffer.from(body, "base64url");
  if (decoded.toString("base64url") !== body) throw invalid();
  let value: unknown;
  try {
    value = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw invalid();
  }
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const payload = parsed.data;
  if (
    payload.orgId !== binding.orgId ||
    payload.filters !== filtersOf(binding) ||
    payload.issuedAt > now ||
    now - payload.issuedAt >= ttlMs
  )
    throw invalid();
  return { personCode: payload.personCode, id: payload.id };
}
