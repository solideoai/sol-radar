import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { G2bItem } from "./connector.model";
import { isInfoBizPreSpec } from "./g2b-stage-filter";
import {
  buildG2bOrderPlanListUrl,
  buildG2bPreSpecListUrl,
  formatG2bYearMonth,
} from "./g2b-stage-request";
import { G2B_CONTACT_FIELDS, parseG2bEnvelope } from "./g2b.model";
import type { NormalizeOutcome } from "./normalize-common";
import { normalizeG2bOrderPlan } from "./normalize-g2b-order-plan";
import { normalizeG2bPreSpec } from "./normalize-g2b-pre-spec";
import { normalizedBidDraftSchema, type NormalizedBidDraft } from "./normalized-bid.model";
import { loadRecordedResponse, toG2bEnvelopeBody } from "./recorded-api";
import { linkStages } from "./stage-link";

// P0-8 Task 3: 사전규격(15129437)·발주계획(15129462) 녹음 응답(2026-10-19 실호출, 담당자 마스킹)을 정규화한다.
// 녹음 파일은 읽기만 한다. 기대 값은 녹음 파일을 구현과 따로 파이썬으로 세어 적었다(2026-10-21).

const RECORDED_DIR = fileURLToPath(new URL("../../../fixtures/recorded/", import.meta.url));
const PRE_SPEC_FILE = "15129437/getPublicPrcureThngInfoServc.20261019.masked.json";
const ORDER_PLAN_FILE = "15129462/getOrderPlanSttusListServc.20261019.masked.json";
const ORDER_PLAN_ERROR_FILE = "15129462/getOrderPlanSttusListServc.20261019.error08.masked.json";
const FETCHED_AT = new Date("2026-10-19T01:00:05.000Z");

async function itemsOf(file: string): Promise<G2bItem[]> {
  const envelope = parseG2bEnvelope(
    toG2bEnvelopeBody(await loadRecordedResponse(`${RECORDED_DIR}${file}`)),
  );
  if (!envelope.ok) throw new Error(`녹음 봉투가 정상이 아니다: ${file}`);
  return envelope.items;
}

const draftOf = (outcome: NormalizeOutcome): NormalizedBidDraft => {
  if (!outcome.ok) throw new Error(`격리됐다: ${outcome.issue.code} ${outcome.issue.detail}`);
  return outcome.draft;
};

const hasContactKey = (value: unknown): boolean =>
  JSON.stringify(value).includes("***") ||
  G2B_CONTACT_FIELDS.some((field) => JSON.stringify(value).includes(`"${field}"`));

describe("normalizeG2bPreSpec — 녹음 10건", () => {
  it("10건 모두 사전규격 draft 가 되고 담당자 값이 없다", async () => {
    const outcomes = (await itemsOf(PRE_SPEC_FILE)).map((item) =>
      normalizeG2bPreSpec(item, { fetchedAt: FETCHED_AT }),
    );
    expect(outcomes).toHaveLength(10);
    const drafts = outcomes.map(draftOf);
    for (const draft of drafts) {
      expect(normalizedBidDraftSchema.safeParse(draft).success).toBe(true);
      expect(draft).toMatchObject({ source: "g2b-pre-spec", stage: "PRE_SPEC", isDemo: false });
      expect(draft.preSpecRef).toBe(draft.noticeId);
      expect(draft.planRef).toBeUndefined();
      expect(draft.amendmentNo).toBeUndefined();
      expect(draft.sourceUrl.startsWith("https://www.g2b.go.kr/pn/")).toBe(true);
      expect(hasContactKey(draft)).toBe(false);
    }
    // 첨부 칸 수(파이썬 집계): 1·2·2·2·1·1·3·1·1·1
    expect(drafts.map(({ attachments }) => attachments.length)).toEqual([
      1, 2, 2, 2, 1, 1, 3, 1, 1, 1,
    ]);
    // 실수요기관(rlDminsttNm)이 먼저다. 5·6번째 행은 공고기관이 조달청 서울지방조달청이다.
    expect(drafts.map(({ agency }) => agency)).toEqual([
      "제주특별자치도",
      "재단법인 부산경제진흥원",
      "재단법인 부산경제진흥원",
      "한국마사회",
      "교육부 국사편찬위원회",
      "통일부",
      "한국해양수산개발원",
      "서울특별시교육청 충암고등학교",
      "한국수자원공사",
      "한국수자원공사",
    ]);
  });

  it("첫 행: 등록번호·실수요기관·배정예산·KST → UTC 날짜", async () => {
    const [first] = await itemsOf(PRE_SPEC_FILE);
    expect(draftOf(normalizeG2bPreSpec(first!, { fetchedAt: FETCHED_AT }))).toMatchObject({
      noticeId: "R26BD00286413",
      title: "제주형 일방통행 및 AI 공유주차 운영모델 수립 용역(협상에 의한 계약)",
      agency: "제주특별자치도",
      budgetKrw: "174696000",
      noticeDate: "2026-10-18T04:22:06.000Z",
      deadlineAt: "2026-10-23T14:59:00.000Z",
      status: "OPEN",
      sourceUrl:
        "https://www.g2b.go.kr/pn/pnz/pnza/UntyAtchFile/downloadFile.do?bfSpecRegNo=R26BD00286413&fileType=BFDTL&fileSeq=1",
    });
  });

  it("실수요기관이 없으면 공고기관을 쓴다", () => {
    const draft = draftOf(
      normalizeG2bPreSpec(preSpecItem({ rlDminsttNm: "", orderInsttNm: "조달청 서울지방조달청" }), {
        fetchedAt: FETCHED_AT,
      }),
    );
    expect(draft.agency).toBe("조달청 서울지방조달청");
  });

  it("허용 목록 안의 첨부가 없으면 원문 주소가 없어 격리한다", () => {
    const outcome = normalizeG2bPreSpec(
      preSpecItem({ specDocFileUrl1: "https://evil.example/pn/a.hwp" }),
      { fetchedAt: FETCHED_AT },
    );
    expect(outcome).toMatchObject({
      ok: false,
      issue: { code: "MISSING_REQUIRED_FIELD", sourceKey: "g2b-pre-spec:R26BD99999999" },
    });
  });

  it("허용 목록 밖 첨부는 빼고 경고를 남긴다", () => {
    const outcome = normalizeG2bPreSpec(
      preSpecItem({ specDocFileUrl2: "http://www.g2b.go.kr/pn/b.hwp" }),
      { fetchedAt: FETCHED_AT },
    );
    expect(outcome.ok && outcome.draft.attachments).toHaveLength(1);
    expect(outcome.ok && outcome.warnings.map(({ code }) => code)).toEqual([
      "ATTACHMENT_URL_BLOCKED",
    ]);
  });

  it("등록번호가 없으면 격리한다", () => {
    expect(
      normalizeG2bPreSpec(preSpecItem({ bfSpecRgstNo: " " }), { fetchedAt: FETCHED_AT }),
    ).toMatchObject({ ok: false, issue: { code: "MISSING_REQUIRED_FIELD" } });
  });
});

describe("normalizeG2bOrderPlan — 녹음 10건", () => {
  it("10건 모두 발주계획 draft 가 되고 planRef 는 자기 통합번호, 마감은 없다", async () => {
    const drafts = (await itemsOf(ORDER_PLAN_FILE)).map((item) =>
      draftOf(normalizeG2bOrderPlan(item, { fetchedAt: FETCHED_AT })),
    );
    expect(drafts).toHaveLength(10);
    for (const draft of drafts) {
      expect(normalizedBidDraftSchema.safeParse(draft).success).toBe(true);
      expect(draft).toMatchObject({ source: "g2b-order-plan", stage: "PLAN", deadlineAt: null });
      expect(draft.planRef).toBe(draft.noticeId);
      expect(draft.preSpecRef).toBeUndefined();
      expect(draft.amendmentNo).toBeUndefined();
      expect(hasContactKey(draft)).toBe(false);
    }
  });

  it("첫 행: 통합번호·사업명·발주기관·합계 발주금액·상세 주소", async () => {
    const [first] = await itemsOf(ORDER_PLAN_FILE);
    expect(draftOf(normalizeG2bOrderPlan(first!, { fetchedAt: FETCHED_AT }))).toMatchObject({
      noticeId: "R26DD20899213",
      title: "달성제1어린이공원 폭염저감시설 설치사업 실시설계 용역",
      agency: "대구광역시 중구",
      budgetKrw: "22000000",
      noticeDate: "2026-10-19T01:07:47.000Z",
      sourceUrl: "https://www.g2b.go.kr/link/PRPA015_01/single/?oderPlanNo=R26DD20899213",
    });
  });

  it("오류 08 녹음은 봉투 단계에서 오류다(정규화하지 않는다)", async () => {
    const envelope = parseG2bEnvelope(
      toG2bEnvelopeBody(await loadRecordedResponse(`${RECORDED_DIR}${ORDER_PLAN_ERROR_FILE}`)),
    );
    expect(envelope).toMatchObject({ ok: false, kind: "RESULT_CODE", resultCode: "08" });
  });

  it("상세 주소가 없으면 격리한다", () => {
    expect(
      normalizeG2bOrderPlan(
        { orderPlanUntyNo: "R26DD1", bizNm: "사업", orderPlanDtlUrl: "" },
        { fetchedAt: FETCHED_AT },
      ),
    ).toMatchObject({ ok: false, issue: { code: "MISSING_REQUIRED_FIELD" } });
  });
});

describe("isInfoBizPreSpec", () => {
  it("녹음 10건은 모두 swBizObjYn 'N' 이라 하나도 통과하지 않는다", async () => {
    expect((await itemsOf(PRE_SPEC_FILE)).filter(isInfoBizPreSpec)).toEqual([]);
  });

  it("'Y' 면 통과한다(앞뒤 공백 무시)", async () => {
    const [first] = await itemsOf(PRE_SPEC_FILE);
    expect(isInfoBizPreSpec({ ...first!, swBizObjYn: "Y" })).toBe(true);
    expect(isInfoBizPreSpec({ ...first!, swBizObjYn: " Y " })).toBe(true);
    expect(isInfoBizPreSpec({ ...first!, swBizObjYn: undefined })).toBe(false);
  });
});

describe("사전규격·발주계획 요청 주소", () => {
  const slice = {
    from: new Date("2026-10-17T15:00:00.000Z"),
    to: new Date("2026-10-19T14:59:00.000Z"),
  };

  it("사전규격: 녹음과 같은 파라미터(inqryDiv=1, KST 일시)", () => {
    const url = new URL(
      buildG2bPreSpecListUrl({
        endpoint: "https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/",
        serviceKey: "a+b/c=",
        pageNo: 1,
        numOfRows: 10,
        slice,
      }),
    );
    expect(url.pathname).toBe("/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServc");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      serviceKey: "a+b/c=",
      type: "json",
      pageNo: "1",
      numOfRows: "10",
      inqryDiv: "1",
      inqryBgnDt: "202610180000",
      inqryEndDt: "202610192359",
    });
  });

  it("발주계획: 녹음과 같은 파라미터(inqryDiv=1, orderBgnYm·orderEndYm)", () => {
    const url = new URL(
      buildG2bOrderPlanListUrl({
        endpoint: "https://apis.data.go.kr/1230000/ao/OrderPlanSttusService",
        serviceKey: "key",
        pageNo: 1,
        numOfRows: 10,
        from: new Date("2026-10-01T00:00:00+09:00"),
        to: new Date("2026-12-31T23:59:00+09:00"),
      }),
    );
    expect(url.pathname).toBe("/1230000/ao/OrderPlanSttusService/getOrderPlanSttusListServc");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      serviceKey: "key",
      type: "json",
      pageNo: "1",
      numOfRows: "10",
      inqryDiv: "1",
      orderBgnYm: "202610",
      orderEndYm: "202612",
    });
    expect(url.searchParams.has("inqryBgnDt")).toBe(false);
  });

  it("연월은 KST 기준이다(UTC 로는 전달 말일이어도 KST 로는 다음 달)", () => {
    expect(formatG2bYearMonth(new Date("2026-10-31T15:30:00.000Z"))).toBe("202611");
  });
});

describe("정규화한 단계 공고와 입찰공고의 연결", () => {
  it("입찰공고의 orderPlanUntyNo·bfSpecRgstNo 가 맞으면 PLAN_REF·PRE_SPEC_REF 로 이어진다", async () => {
    const [plan] = (await itemsOf(ORDER_PLAN_FILE)).map((item) =>
      draftOf(normalizeG2bOrderPlan(item, { fetchedAt: FETCHED_AT })),
    );
    const [preSpec] = (await itemsOf(PRE_SPEC_FILE)).map((item) =>
      draftOf(normalizeG2bPreSpec(item, { fetchedAt: FETCHED_AT })),
    );
    // 합성 입찰공고: 녹음 표본에는 서로 맞물리는 행이 없다(C1 증거 §10, 표본 기간이 다르다).
    const notice = {
      bidId: "notice",
      stage: "NOTICE" as const,
      noticeId: "R26BK99999999",
      planRef: plan!.noticeId,
      preSpecRef: preSpec!.noticeId,
      title: "합성 입찰공고",
    };
    const { links } = linkStages([
      {
        bidId: "plan",
        stage: plan!.stage,
        noticeId: plan!.noticeId,
        planRef: plan!.planRef,
        title: plan!.title,
      },
      {
        bidId: "pre",
        stage: preSpec!.stage,
        noticeId: preSpec!.noticeId,
        preSpecRef: preSpec!.preSpecRef,
        title: preSpec!.title,
      },
      notice,
    ]);
    expect(links).toEqual([
      { fromBidId: "plan", toBidId: "notice", basis: "PLAN_REF" },
      { fromBidId: "pre", toBidId: "notice", basis: "PRE_SPEC_REF" },
    ]);
  });
});

function preSpecItem(patch: G2bItem = {}): G2bItem {
  return {
    bfSpecRgstNo: "R26BD99999999",
    prdctClsfcNoNm: "합성 사전규격",
    rlDminsttNm: "합성기관",
    orderInsttNm: "합성발주기관",
    asignBdgtAmt: "100000000",
    rgstDt: "2026-10-18 13:22:06",
    opninRgstClseDt: "2026-10-23 23:59:00",
    specDocFileUrl1: "https://www.g2b.go.kr/pn/a.hwp",
    swBizObjYn: "N",
    ...patch,
  };
}
