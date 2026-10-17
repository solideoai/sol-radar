import { z } from "zod";

// v1 HTTP errors generate UUID request IDs; never display arbitrary response text.
const requestIdSchema = z.string().max(36).uuid();
const envelopeSchema = z.object({ error: z.object({ requestId: requestIdSchema }) });
export function employmentRequestId(body: unknown, headers: Headers): string | null {
  const envelope = envelopeSchema.safeParse(body);
  if (envelope.success) return envelope.data.error.requestId;
  const header = requestIdSchema.safeParse(headers.get("X-Request-Id"));
  return header.success ? header.data : null;
}
