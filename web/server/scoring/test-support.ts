// 시험 전용 헬퍼. 제품 코드가 import 하지 않는다(규칙 엔진은 런타임에 fixtures/ 를 읽지 않는다).
// fixtures/ 의 공고·추출·Kev·골든·회사 프로필·인력 명부를 AnalysisInput 으로 조립한다.
import { existsSync, readFileSync } from "node:fs";
import {
  SCORING_CONFIG,
  type AnalysisInput,
  type CompanyProfile,
  type KevMockResponse,
  type NormalizedBidSummary,
  type RequirementExtraction,
} from "./analysis-input.model";
import { toScoringTeam, type ScoringPerson, type ScoringTeam } from "./scoring.model";

/** fixtures/manifest.yaml calculationDate. 모든 골든은 이 기준일로 계산한다. */
export const CALCULATION_DATE = "2026-10-16";
/** fixture 추출·Kev 의 extractedAt 과 같은 시각. bid.fetchedAt 으로 쓴다. */
export const FIXTURE_FETCHED_AT = "2026-10-16T09:00:00Z";

const fixtureUrl = (path: string) => new URL(`../../../fixtures/${path}`, import.meta.url);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(fixtureUrl(path), "utf8")) as T;

type BidFixture = {
  fixtureId: string;
  stage: "PLAN" | "PRE_SPEC" | "NOTICE";
  records: {
    amendmentNo: string;
    noticeId: string;
    title: string;
    agency: string | null;
    budgetKrw: string | null;
    noticeDate: string | null;
    deadlineAt: string | null;
    stage: "PLAN" | "PRE_SPEC" | "NOTICE";
  }[];
};

/** ADR-014: "+21d" 같은 상대 표기를 기준일 + N일의 KST 18:00(= UTC 09:00)로 바꾼다. 절대 ISO 는 그대로. */
export function relativeDate(spec: string | null, base = CALCULATION_DATE): string | null {
  if (spec === null) return null;
  const match = /^([+-])(\d+)d$/.exec(spec);
  if (!match) return spec;
  const days = Number(match[2]) * (match[1] === "-" ? -1 : 1);
  const [year, month, day] = base.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 9, 0, 0)).toISOString();
}

export function loadBid(id: string, recordIndex = 0): NormalizedBidSummary {
  const fixture = readJson<BidFixture>(`bids/${id}.json`);
  const record = fixture.records[recordIndex];
  return {
    noticeId: record.noticeId,
    revisionId: `${id}#${record.amendmentNo}`,
    title: record.title,
    agency: record.agency,
    stage: record.stage,
    budgetKrw: record.budgetKrw,
    deadlineAt: relativeDate(record.deadlineAt),
    noticeDate: relativeDate(record.noticeDate),
    fetchedAt: FIXTURE_FETCHED_AT,
    projectPeriod: null,
    structuredQualifications: [],
  };
}

export function loadExtraction(id: string): RequirementExtraction {
  return readJson<RequirementExtraction>(`extractions/${id}.json`);
}

export function loadKev(id: string): KevMockResponse | null {
  return existsSync(fixtureUrl(`kev/${id}.json`))
    ? readJson<KevMockResponse>(`kev/${id}.json`)
    : null;
}

export function loadProfile(): CompanyProfile {
  return readJson<CompanyProfile>("company/solideo-profile.json");
}

export function loadTeam(): ScoringTeam {
  const people = readJson<{
    people: ScoringPerson[];
    assignments: {
      personId: string;
      startsAt: string;
      endsAt: string;
      allocationPercent: number;
    }[];
    asOf: string;
  }>("people/solideo.people.json");
  return toScoringTeam(people.people, people.assignments, people.asOf);
}

export type Golden = {
  fixtureId: string;
  factors: { factor: string; normalized: number; points: number; maxPoints: number }[];
  total: number;
  score: number;
  recommendation: "BID" | "WATCH" | "NO_BID";
  reviewFlags: string[];
};

export function loadGolden(id: string): Golden {
  return readJson<Golden>(`goldens/${id}.json`);
}

export function buildInput(id: string, overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    schemaVersion: "analysis-input/v0.1",
    bid: loadBid(id),
    extraction: loadExtraction(id),
    profile: loadProfile(),
    team: loadTeam(),
    kev: loadKev(id),
    config: { ...SCORING_CONFIG, today: CALCULATION_DATE },
    ...overrides,
  };
}

/** 깊은 복사 뒤 일부를 바꾸는 작은 도우미. 원본 입력을 변형하지 않는다. */
export function withPatch<T>(value: T, patch: (draft: T) => void): T {
  const draft = structuredClone(value);
  patch(draft);
  return draft;
}
