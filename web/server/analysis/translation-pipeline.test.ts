import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readTranslationWarnings } from "./analysis.model";
import { runAnalysis } from "./analysis.service";
import { kevResponseSchema } from "./gateway.model";
import {
  buildContext,
  buildDeps,
  extractBody,
  fakeExtractionStore,
  fakeGateway,
  healthyRoutes,
  jsonReply,
  kevDisabledBody,
  loadExtraction,
} from "./test-support";

const missing = "TRANSLATION_MISSING:profileSummary.technologies[2].name";
const sentStaffSchema = z.object({
  profileSummary: z.object({
    staffAvailability: z.object({
      from: z.string(),
      to: z.string(),
      availableFte: z.number(),
      eligibleStaff: z.number(),
    }),
  }),
});

describe("번역 전달 및 Bosun 누락 안전 처리", () => {
  it.each(["fixture", "live"] as const)(
    "%s 추출의 번역과 원문을 저장하고 영어 /kev 요청으로 전달한다",
    async (runMode) => {
      const translations = { "requiredSkills[3]": "e-Government Framework" };
      const payload = loadExtraction("FX-01");
      const source = structuredClone(payload);
      const store = fakeExtractionStore();
      const gateway = fakeGateway({
        ...healthyRoutes("FX-01"),
        "/extract": jsonReply(extractBody(payload, { translations })),
      });
      const context = buildContext("FX-01", {
        extraction: null,
        aiProvider: "local",
        runMode,
        ...(runMode === "live" ? { fixtureId: null } : {}),
      });
      await runAnalysis(context, buildDeps(gateway.gateway, store.store));
      expect(store.saves[0].translations).toEqual(translations);
      expect(store.saves[0].payload.requiredSkills).toEqual(source.requiredSkills);
      expect(gateway.bodyOf("/kev")).toMatchObject({
        stateLanguage: "en",
        translations,
        extraction: { requiredSkills: source.requiredSkills },
      });
      expect(payload).toEqual(source);
    },
  );

  it("캐시의 번역 누락으로 비활성화된 Bosun을 사용하지 않고 검토 플래그와 경로 진단을 남긴다", async () => {
    const gateway = fakeGateway({
      ...healthyRoutes("FX-01"),
      "/kev": jsonReply({ ...kevDisabledBody("KEV_UNAVAILABLE"), warnings: [missing] }),
    });
    const record = await runAnalysis(
      buildContext("FX-01", { aiProvider: "local" }),
      buildDeps(gateway.gateway, fakeExtractionStore().store),
    );
    expect(record.result.kev.enabled).toBe(false);
    expect(record.result.recommendationBasis).toBe("RULES_ONLY");
    expect(record.kevOutput).toBeNull();
    expect(record.meta.extraReviewFlags).toContain("TRANSLATION_INCOMPLETE");
    expect(record.diagnostics.kev).toEqual({
      failure: "TRANSLATION_INCOMPLETE",
      issues: [missing],
    });
  });

  it("기존 /kev 응답도 받으며 값이 섞인 번역 경고는 진단으로 내보내지 않는다", () => {
    expect(kevResponseSchema.safeParse(kevDisabledBody("KEV_UNAVAILABLE")).success).toBe(true);
    expect(
      readTranslationWarnings([missing, "TRANSLATION_MISSING:private document text", "other"]),
    ).toEqual([missing]);
  });
});

describe("Bosun 요청의 인력 가용(K6)", () => {
  it("/kev 요청 profileSummary.staffAvailability 는 규칙 엔진 인력 요소와 같은 기간·가용 FTE 다", async () => {
    const gateway = fakeGateway(healthyRoutes("FX-01"));
    const record = await runAnalysis(
      buildContext("FX-01"),
      buildDeps(gateway.gateway, fakeExtractionStore().store),
    );
    const sent = sentStaffSchema.parse(gateway.bodyOf("/kev")).profileSummary.staffAvailability;
    const staff = record.result.factors.find((factor) => factor.factor === "staffAvailability");
    expect(sent.eligibleStaff).toBe(200);
    expect(staff?.rawValue).toMatchObject({
      period: { startsAt: sent.from, endsAt: sent.to },
      availableFte: sent.availableFte,
      teamMembers: sent.eligibleStaff,
    });
  });
});
