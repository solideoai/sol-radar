import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { finalizeRevision } from "./checksum";
import {
  fixtureFileSchema,
  fixtureManifestSchema,
  fixtureRecordSchema,
  type FixtureFile,
  type FixtureRecord,
} from "./fixture.model";
import { normalizeFixtureRecord, type NormalizeContext } from "./normalize";
import {
  NORMALIZED_BID_SCHEMA_VERSION,
  normalizedBidDraftSchema,
  normalizedBidSchema,
  type NormalizedBid,
  type NormalizedBidDraft,
} from "./normalized-bid.model";
import { normText } from "./text-normalize";

// G10 — 15 §9: NormalizedBid 스키마를 fixture 20건 전부에서 검증한다(FX-12 는 격리).
const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const FIXTURE_IDS = Array.from(
  { length: 20 },
  (_, index) => `FX-${String(index + 1).padStart(2, "0")}`,
);
// KST 2026-10-19 12:00 — 상대 날짜의 기준
const ANCHOR = new Date("2026-10-19T03:00:00.000Z");
const FETCHED_AT = new Date("2026-10-19T03:05:00.000Z");
const CONTEXT: NormalizeContext = { fetchedAt: FETCHED_AT, anchor: ANCHOR };

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const loadFixture = (id: string): FixtureFile =>
  fixtureFileSchema.parse(readJson(join(FIXTURES_DIR, "bids", `${id}.json`)));
const recordOf = (id: string, batch: "SEED" | "LIVE"): FixtureRecord => {
  const record = loadFixture(id).records.find((candidate) => candidate.ingestBatch === batch);
  if (!record) throw new Error(`${id} 에 ${batch} 레코드가 없다`);
  return record;
};
const draftFrom = (
  record: FixtureRecord,
  context: NormalizeContext = CONTEXT,
): NormalizedBidDraft => {
  const outcome = normalizeFixtureRecord(record, context);
  if (!outcome.ok) throw new Error(`정규화 실패: ${outcome.issue.code}`);
  return outcome.draft;
};
const draftOf = (id: string, batch: "SEED" | "LIVE" = "SEED") => draftFrom(recordOf(id, batch));
const allRecords = () =>
  FIXTURE_IDS.flatMap((id) =>
    loadFixture(id).records.map((record) => ({
      id,
      record,
      outcome: normalizeFixtureRecord(record, CONTEXT),
    })),
  );
const successes = () =>
  allRecords().flatMap(({ id, record, outcome }) =>
    outcome.ok ? [{ id, record, ...outcome }] : [],
  );
const withRecord = (patch: Record<string, unknown>, drop: readonly string[] = []): FixtureRecord =>
  fixtureRecordSchema.parse(
    Object.fromEntries(
      Object.entries({ ...recordOf("FX-01", "SEED"), ...patch }).filter(
        ([key]) => !drop.includes(key),
      ),
    ),
  );
const baseBid = (): NormalizedBid => finalizeRevision(draftOf("FX-01"), 1);
const accepts = (patch: Record<string, unknown>): boolean =>
  normalizedBidSchema.safeParse({ ...baseBid(), ...patch }).success;

describe("fixture 입력", () => {
  it("20개 fixture 파일이 fixtureFileSchema 를 통과하고 fixtureId 가 파일 이름과 같다", () => {
    expect(FIXTURE_IDS.map((id) => loadFixture(id).fixtureId)).toEqual(FIXTURE_IDS);
  });

  it("manifest 가 fixtureManifestSchema 를 통과한다", () => {
    const manifest: unknown = parseYaml(readFileSync(join(FIXTURES_DIR, "manifest.yaml"), "utf8"));
    expect(fixtureManifestSchema.safeParse(manifest).success).toBe(true);
  });
});

describe("G10 — fixture 20건 전체 정규화", () => {
  it("FX-12 만 격리되고 나머지 24개 레코드는 정규화된다", () => {
    const records = allRecords();
    expect(records.filter(({ outcome }) => !outcome.ok).map(({ id }) => id)).toEqual(["FX-12"]);
    expect(records.filter(({ outcome }) => outcome.ok)).toHaveLength(24);
  });

  it("정규화된 레코드를 revision 1 로 확정하면 모두 normalizedBidSchema 를 통과한다", () => {
    const rejected = successes()
      .filter(({ draft }) => !normalizedBidSchema.safeParse(finalizeRevision(draft, 1)).success)
      .map(({ id }) => id);
    expect(rejected).toEqual([]);
  });

  it("정규화 draft 는 normalizedBidDraftSchema 를 통과하고 revision·checksum 키가 없다", () => {
    for (const { draft } of successes()) {
      expect(normalizedBidDraftSchema.safeParse(draft).success).toBe(true);
      expect(draft).not.toHaveProperty("revision");
      expect(draft).not.toHaveProperty("checksum");
    }
  });

  it("fixture 레코드는 경고 없이 정규화된다", () => {
    expect(successes().flatMap(({ warnings }) => warnings)).toEqual([]);
  });

  it("모든 레코드가 source fixture·isDemo true·schemaVersion v0.2 다", () => {
    for (const { draft } of successes()) {
      expect([draft.source, draft.isDemo, draft.schemaVersion]).toEqual([
        "fixture",
        true,
        "normalized-bid/v0.2",
      ]);
    }
  });

  it("스키마 버전 상수는 normalized-bid/v0.2 다", () => {
    expect(NORMALIZED_BID_SCHEMA_VERSION).toBe("normalized-bid/v0.2");
  });

  it("fetchedAt 은 context.fetchedAt 의 ISO 문자열이다", () => {
    for (const { draft } of successes()) expect(draft.fetchedAt).toBe("2026-10-19T03:05:00.000Z");
  });

  it("structuredQualifications 는 빈 배열이다", () => {
    for (const { draft } of successes()) expect(draft.structuredQualifications).toEqual([]);
  });

  it("ingestBatch 는 정규화 결과에 들어가지 않는다", () => {
    for (const { draft } of successes()) expect(draft).not.toHaveProperty("ingestBatch");
  });

  it("content 는 원문에 normText 를 적용한 값이다", () => {
    for (const { record, draft } of successes()) {
      expect(draft.content).toBe(normText(String(record.content)));
    }
  });

  it("preSpecRef 가 없는 fixture 는 preSpecRef 키가 없다", () => {
    for (const { draft } of successes()) expect(draft).not.toHaveProperty("preSpecRef");
  });
});

describe("필드 매핑 — FX-01", () => {
  it("FX-01 레코드를 계약의 필드 그대로 정규화한다", () => {
    const record = recordOf("FX-01", "SEED");
    expect(draftOf("FX-01")).toStrictEqual({
      schemaVersion: "normalized-bid/v0.2",
      source: "fixture",
      noticeId: "DEMO-2026-0001",
      amendmentNo: "01",
      stage: "NOTICE",
      status: "OPEN",
      title: "세종특별자치시 차세대 행정정보시스템 고도화 (가상)",
      agency: "세종특별자치시",
      budgetKrw: "1200000000",
      noticeDate: "2026-10-14T09:00:00.000Z",
      deadlineAt: "2026-11-09T09:00:00.000Z",
      sourceUrl: "https://demo.sol-radar.invalid/notices/FX-01",
      content: record.content,
      attachments: [{ name: "제안요청서.pdf", url: "fixtures/docs/FX-01-rfp.pdf" }],
      structuredQualifications: [],
      original: {
        noticeNo: "DEMO-2026-0001",
        stage: "NOTICE",
        budget: "1200000000",
        noticeDate: "-5d",
        deadline: "+21d",
      },
      normalizationNotes: [
        "noticeDate: 시각 없는 값(-5d)을 KST 18:00으로 간주",
        "deadlineAt: 시각 없는 값(+21d)을 KST 18:00으로 간주",
      ],
      isDemo: true,
      fetchedAt: "2026-10-19T03:05:00.000Z",
    });
  });

  it("planRef 가 null 인 레코드는 planRef 키가 없다", () => {
    expect(draftOf("FX-01")).not.toHaveProperty("planRef");
  });

  it("planRef 가 빈 문자열이면 planRef 키가 없다", () => {
    expect(draftFrom(withRecord({ planRef: "" }))).not.toHaveProperty("planRef");
  });

  it("planRef 가 있는 FX-17 은 planRef 를 그대로 둔다", () => {
    expect(draftOf("FX-17").planRef).toBe("DEMO-PLAN-0042");
  });

  it("preSpecRef 가 비어 있지 않으면 키를 둔다", () => {
    expect(draftFrom(withRecord({ preSpecRef: "DEMO-PRESPEC-0001" })).preSpecRef).toBe(
      "DEMO-PRESPEC-0001",
    );
  });

  it("status 가 없으면 OPEN 이다", () => {
    expect(draftOf("FX-01").status).toBe("OPEN");
  });

  it("정정 revision(FX-06 r2) 이라고 status 를 AMENDED 로 바꾸지 않는다", () => {
    expect(draftOf("FX-06", "LIVE").status).toBe("OPEN");
  });

  it("FX-08 r2 의 status CANCELLED 를 그대로 쓰고 original.status 에 원문을 둔다", () => {
    const draft = draftOf("FX-08", "LIVE");
    expect([draft.status, draft.original.status]).toEqual(["CANCELLED", "CANCELLED"]);
  });

  it("status 원문이 없으면 original.status 키가 없다", () => {
    expect(draftOf("FX-08", "SEED").original).not.toHaveProperty("status");
  });

  it("첨부가 없는 FX-04 는 attachments 가 빈 배열이다", () => {
    expect(draftOf("FX-04").attachments).toEqual([]);
  });

  it("attachments 키가 없으면 빈 배열이다", () => {
    expect(draftFrom(withRecord({}, ["attachments"])).attachments).toEqual([]);
  });

  it("첨부의 mimeType·sizeBytes 가 있으면 그대로 둔다", () => {
    const record = withRecord({
      attachments: [
        {
          name: "제안요청서.pdf",
          objectKey: "fixtures/docs/X.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
        },
      ],
    });
    expect(draftFrom(record).attachments).toStrictEqual([
      {
        name: "제안요청서.pdf",
        url: "fixtures/docs/X.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      },
    ]);
  });

  it("content 키가 없으면 빈 문자열이다", () => {
    expect(draftFrom(withRecord({}, ["content"])).content).toBe("");
  });

  it("agency 가 빈 문자열이면 null 이다", () => {
    expect(draftFrom(withRecord({ agency: "" })).agency).toBeNull();
  });

  it("agency 키가 없으면 null 이다", () => {
    expect(draftFrom(withRecord({}, ["agency"])).agency).toBeNull();
  });

  it("title·agency 의 앞뒤 공백을 지우고 연속 공백을 1개로 줄인다", () => {
    const draft = draftFrom(
      withRecord({ title: "  가상   시험   공고 ", agency: " 가상\t\t기관 " }),
    );
    expect([draft.title, draft.agency]).toEqual(["가상 시험 공고", "가상 기관"]);
  });

  it("noticeId 의 앞뒤 공백을 지운다", () => {
    expect(draftFrom(withRecord({ noticeId: "  DEMO-2026-0001 " })).noticeId).toBe(
      "DEMO-2026-0001",
    );
  });

  it("숫자 예산은 정수 문자열로 바꾸고 original.budget 에 문자열로 남긴다", () => {
    const draft = draftFrom(withRecord({ budgetKrw: 1200000000 }));
    expect([draft.budgetKrw, draft.original.budget]).toEqual(["1200000000", "1200000000"]);
  });

  it("시각이 있는 날짜만 있으면 normalizationNotes 키가 없다", () => {
    const draft = draftFrom(
      withRecord({ noticeDate: "2026-10-14 10:00", deadlineAt: "2026-11-02 18:00:00" }),
    );
    expect(draft).not.toHaveProperty("normalizationNotes");
  });

  it("날짜만 있는 값은 원문을 넣은 메모를 남긴다", () => {
    const draft = draftFrom(
      withRecord({ noticeDate: "2026-10-14 10:00", deadlineAt: "2026-11-02" }),
    );
    expect(draft.normalizationNotes).toEqual([
      "deadlineAt: 시각 없는 값(2026-11-02)을 KST 18:00으로 간주",
    ]);
  });

  it("같은 레코드를 두 번 정규화하면 같은 결과다", () => {
    expect(draftOf("FX-07", "LIVE")).toStrictEqual(draftOf("FX-07", "LIVE"));
  });

  it("레코드를 바꾸지 않는다", () => {
    const record = recordOf("FX-14", "SEED");
    const before = structuredClone(record);
    normalizeFixtureRecord(record, CONTEXT);
    expect(record).toStrictEqual(before);
  });
});

describe("FX-11 — 예산·마감 누락 (null 대체 금지)", () => {
  it("예산 null 을 0 이나 빈 문자열로 바꾸지 않고 null 로 둔다", () => {
    expect(draftOf("FX-11").budgetKrw).toBeNull();
  });

  it("마감 null 을 미래 날짜로 채우지 않고 null 로 둔다", () => {
    expect(draftOf("FX-11").deadlineAt).toBeNull();
  });

  it("원문이 없는 budget·deadline 은 original 에 넣지 않는다", () => {
    expect(draftOf("FX-11").original).toStrictEqual({
      noticeNo: "DEMO-2026-0011",
      stage: "NOTICE",
      noticeDate: "-1d",
    });
  });

  it("값이 있는 noticeDate 의 메모만 남긴다", () => {
    expect(draftOf("FX-11").normalizationNotes).toEqual([
      "noticeDate: 시각 없는 값(-1d)을 KST 18:00으로 간주",
    ]);
  });

  it("null 인 예산·마감에는 경고를 내지 않는다", () => {
    const outcome = normalizeFixtureRecord(recordOf("FX-11", "SEED"), CONTEXT);
    expect(outcome.ok && outcome.warnings).toEqual([]);
  });
});

describe("FX-13 — 금액 텍스트", () => {
  it("'1,500백만원' 을 '1500000000' 으로 정규화한다", () => {
    expect(draftOf("FX-13").budgetKrw).toBe("1500000000");
  });

  it("original.budget 에 원문 '1,500백만원' 을 병기한다", () => {
    expect(draftOf("FX-13").original.budget).toBe("1,500백만원");
  });
});

describe("FX-14 — KST→UTC", () => {
  it("마감 '+2d' 를 UTC 09:00 으로 저장한다", () => {
    expect(draftOf("FX-14").deadlineAt).toBe("2026-10-21T09:00:00.000Z");
  });

  it("공고일 '-6d' 를 UTC 09:00 으로 저장한다", () => {
    expect(draftOf("FX-14").noticeDate).toBe("2026-10-13T09:00:00.000Z");
  });

  it("상대 날짜를 KST 18:00 으로 간주했다는 메모를 noticeDate → deadlineAt 순서로 남긴다", () => {
    expect(draftOf("FX-14").normalizationNotes).toEqual([
      "noticeDate: 시각 없는 값(-6d)을 KST 18:00으로 간주",
      "deadlineAt: 시각 없는 값(+2d)을 KST 18:00으로 간주",
    ]);
  });

  it("original 에 날짜 원문을 병기한다", () => {
    const { original } = draftOf("FX-14");
    expect([original.noticeDate, original.deadline]).toEqual(["-6d", "+2d"]);
  });
});

describe("FX-09 — SEED·LIVE 중복 전달", () => {
  it("SEED·LIVE 레코드의 정규화 결과가 같다", () => {
    expect(draftOf("FX-09", "LIVE")).toStrictEqual(draftOf("FX-09", "SEED"));
  });

  it("다른 fetchedAt 으로 정규화해도 revision 1 의 checksum 이 같다", () => {
    const seed = draftFrom(recordOf("FX-09", "SEED"), CONTEXT);
    const live = draftFrom(recordOf("FX-09", "LIVE"), {
      fetchedAt: new Date("2026-10-19T09:00:00.000Z"),
      anchor: ANCHOR,
    });
    expect(finalizeRevision(live, 1).checksum).toBe(finalizeRevision(seed, 1).checksum);
  });
});

describe("normalizedBidSchema — 제약", () => {
  it("기준 공고(FX-01 revision 1)는 통과한다", () => {
    expect(accepts({})).toBe(true);
  });

  it("모르는 최상위 키를 거부한다", () => {
    expect(accepts({ ingestBatch: "SEED" })).toBe(false);
  });

  it("original 의 모르는 키를 거부한다", () => {
    expect(accepts({ original: { noticeNo: "DEMO-2026-0001", rawTitle: "x" } })).toBe(false);
  });

  it("첨부의 모르는 키를 거부한다", () => {
    expect(
      accepts({ attachments: [{ name: "a.pdf", url: "fixtures/docs/a.pdf", objectKey: "x" }] }),
    ).toBe(false);
  });

  it("source 가 fixture 인데 isDemo 가 false 면 거부한다", () => {
    expect(accepts({ isDemo: false })).toBe(false);
  });

  it("source 가 g2b-bid-notice 인데 isDemo 가 true 면 거부한다", () => {
    expect(accepts({ source: "g2b-bid-notice", isDemo: true })).toBe(false);
  });

  it("source 가 g2b-bid-notice 이고 isDemo 가 false 면 통과한다", () => {
    expect(accepts({ source: "g2b-bid-notice", isDemo: false })).toBe(true);
  });

  it("목록에 없는 source 를 거부한다", () => {
    expect(accepts({ source: "g2b", isDemo: false })).toBe(false);
  });

  it("planRef 가 null 이면 거부한다(정규화가 키를 뺀다)", () => {
    expect(accepts({ planRef: null })).toBe(false);
  });

  it("planRef 가 빈 문자열이면 거부한다", () => {
    expect(accepts({ planRef: "" })).toBe(false);
  });

  it("budgetKrw null 을 받는다", () => {
    expect(accepts({ budgetKrw: null })).toBe(true);
  });

  it("budgetKrw '0' 을 받는다", () => {
    expect(accepts({ budgetKrw: "0" })).toBe(true);
  });

  it.each(["01200", "1,200", "12억", "", "-1", "1.5"])("budgetKrw %j 를 거부한다", (budgetKrw) => {
    expect(accepts({ budgetKrw })).toBe(false);
  });

  it("budgetKrw 숫자 타입을 거부한다", () => {
    expect(accepts({ budgetKrw: 1200000000 })).toBe(false);
  });

  it("deadlineAt 에 Z 가 아닌 오프셋이 있으면 거부한다", () => {
    expect(accepts({ deadlineAt: "2026-11-09T18:00:00+09:00" })).toBe(false);
  });

  it("deadlineAt 이 날짜만이면 거부한다", () => {
    expect(accepts({ deadlineAt: "2026-11-09" })).toBe(false);
  });

  it("fetchedAt 이 null 이면 거부한다", () => {
    expect(accepts({ fetchedAt: null })).toBe(false);
  });

  it.each(["ftp://demo.sol-radar.invalid/x", "/notices/FX-01", "demo.sol-radar.invalid/x"])(
    "http(s) 절대 URL 이 아닌 sourceUrl %j 를 거부한다",
    (sourceUrl) => {
      expect(accepts({ sourceUrl })).toBe(false);
    },
  );

  it("http sourceUrl 을 받는다", () => {
    expect(accepts({ sourceUrl: "http://demo.sol-radar.invalid/notices/FX-01" })).toBe(true);
  });

  it("checksum 이 대문자 16진수면 거부한다", () => {
    expect(accepts({ checksum: "A".repeat(64) })).toBe(false);
  });

  it("checksum 이 63자면 거부한다", () => {
    expect(accepts({ checksum: "a".repeat(63) })).toBe(false);
  });

  it("revision 0 을 거부한다", () => {
    expect(accepts({ revision: 0 })).toBe(false);
  });

  it("정수가 아닌 revision 을 거부한다", () => {
    expect(accepts({ revision: 1.5 })).toBe(false);
  });

  it("빈 normalizationNotes 배열을 거부한다", () => {
    expect(accepts({ normalizationNotes: [] })).toBe(false);
  });

  it("다른 schemaVersion 을 거부한다", () => {
    expect(accepts({ schemaVersion: "normalized-bid/v0.1" })).toBe(false);
  });

  it("빈 title 을 거부한다", () => {
    expect(accepts({ title: "" })).toBe(false);
  });

  it("agency null 을 받는다", () => {
    expect(accepts({ agency: null })).toBe(true);
  });

  it("빈 content 를 받는다", () => {
    expect(accepts({ content: "" })).toBe(true);
  });

  it("목록에 없는 stage·status 를 거부한다", () => {
    expect([accepts({ stage: "AWARD" }), accepts({ status: "PENDING" })]).toEqual([false, false]);
  });

  it("음수·소수 첨부 크기를 거부한다", () => {
    const attachment = { name: "a.pdf", url: "fixtures/docs/a.pdf" };
    expect([
      accepts({ attachments: [{ ...attachment, sizeBytes: -1 }] }),
      accepts({ attachments: [{ ...attachment, sizeBytes: 1.5 }] }),
    ]).toEqual([false, false]);
  });

  it("구조화 자격 행을 받는다", () => {
    const row = {
      kind: "LICENSE_LIMIT",
      code: null,
      name: "소프트웨어사업자",
      value: { lcnsLmtNm: "소프트웨어사업자" },
      sourceOperation: "getBidPblancListInfoLicenseLimit",
    };
    expect(accepts({ structuredQualifications: [row] })).toBe(true);
  });

  it("구조화 자격 행의 모르는 키·빈 sourceOperation·모르는 kind 를 거부한다", () => {
    const row = { kind: "LICENSE_LIMIT", code: null, name: null, value: {}, sourceOperation: "op" };
    expect([
      accepts({ structuredQualifications: [{ ...row, contactName: "x" }] }),
      accepts({ structuredQualifications: [{ ...row, sourceOperation: "" }] }),
      accepts({ structuredQualifications: [{ ...row, kind: "CREDIT_RATING" }] }),
    ]).toEqual([false, false, false]);
  });
});

describe("normalizedBidDraftSchema — 제약", () => {
  it("revision·checksum 이 붙은 확정 공고는 draft 스키마에서 거부한다", () => {
    expect(normalizedBidDraftSchema.safeParse(baseBid()).success).toBe(false);
  });

  it("draft 에도 isDemo↔source 규칙을 적용한다", () => {
    expect(normalizedBidDraftSchema.safeParse({ ...draftOf("FX-01"), isDemo: false }).success).toBe(
      false,
    );
  });
});
