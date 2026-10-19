import "server-only";
import { z } from "zod";
import { BID_STAGES } from "./normalized-bid.model";

// ── fixture 파일·manifest 모양 (07 §6.1·§6.5). 어긋나면 기동을 멈춰야 하므로 모르는 키도 거부한다 ──
export const FIXTURE_BATCHES = ["SEED", "LIVE"] as const;
export type FixtureBatch = (typeof FIXTURE_BATCHES)[number];

export const CONNECTOR_BEHAVIORS = ["normal", "duplicate-delivery", "rate-limit-then-ok"] as const;
export type ConnectorBehavior = (typeof CONNECTOR_BEHAVIORS)[number];

const fixtureIdSchema = z.string().regex(/^FX-\d{2}$/);

// 레코드 필드는 여기서 검사하지 않는다. 필수 필드가 빠진 레코드(FX-12)도 읽혀야 정규화가 격리로 기록한다.
export const fixtureRecordSchema = z
  .object({
    amendmentNo: z.string().min(1),
    ingestBatch: z.enum(FIXTURE_BATCHES),
  })
  .catchall(z.unknown());
export type FixtureRecord = z.infer<typeof fixtureRecordSchema>;

export const fixtureFileSchema = z.strictObject({
  fixtureId: fixtureIdSchema,
  isDemo: z.literal(true),
  stage: z.enum(BID_STAGES),
  connectorBehavior: z.enum(CONNECTOR_BEHAVIORS),
  records: z.array(fixtureRecordSchema).min(1),
});
export type FixtureFile = z.infer<typeof fixtureFileSchema>;

export const fixtureManifestSchema = z.strictObject({
  schemaVersion: z.literal("sol-fixtures/v1.0"),
  calculationDate: z.string(),
  batches: z.strictObject({
    SEED: z.array(fixtureIdSchema),
    LIVE: z.array(fixtureIdSchema),
  }),
  fixtures: z.array(
    z.strictObject({
      id: fixtureIdSchema,
      stage: z.enum(BID_STAGES),
      tags: z.array(z.string()),
      expected: z.strictObject({
        outcome: z.string(),
        designScore: z.number().nullable(),
      }),
    }),
  ),
});
export type FixtureManifest = z.infer<typeof fixtureManifestSchema>;
