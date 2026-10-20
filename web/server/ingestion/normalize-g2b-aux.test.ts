import { describe, expect, it } from "vitest";
import { canonicalJson, finalizeRevision } from "./checksum";
import type { G2bItem } from "./connector.model";
import type { G2bAuxRows } from "./g2b-aux";
import { normalizeG2bBidNotice } from "./normalize-g2b";
import {
  G2B_EORDER_ATTACHMENT_PATH,
  eorderAttachmentsOf,
  licenseRequirementsOf,
  listOnlyRevision,
  mergeG2bAux,
  regionRequirementsOf,
  registeredAtOf,
  splitNameAndCode,
} from "./normalize-g2b-aux";
import type { NormalizedBidDraft } from "./normalized-bid.model";
import type { StoredRevision } from "./revision";

// 보조 조회 행 → structuredQualifications·attachments(07 §3.1, 15 §3, C1 증거 §5·§10-5·§10-8). 순수 함수 시험.
// 행 모양은 2026-10-19 실측 응답을 본떴고, 번호·이름 값은 가상이다.

const NOTICE_NO = "R26BK00000001";
const FETCHED_AT = new Date("2026-10-19T01:00:00.000Z");
const LICENSE_OP = "getBidPblancListInfoLicenseLimit";
const REGION_OP = "getBidPblancListInfoPrtcptPsblRgn";
const RFP_URL = (no: number) =>
  `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do?rfpNo=R26DH00000001&rfpOrd=000&rfpUntyAtchFileNo=${no}`;
const LIST_DOC_URL = `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?bidPbancNo=${NOTICE_NO}&fileSeq=1`;

const licenseRow = (overrides: G2bItem = {}): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  lmtGrpNo: "1",
  lmtSno: "1",
  lcnsLmtNm: "정보통신공사업/0036",
  permsnIndstrytyList: "",
  indstrytyMfrcFldList: "",
  rgstDt: "2026-10-12 09:00:22",
  bsnsDivNm: "용역",
  ...overrides,
});
const regionRow = (overrides: G2bItem = {}): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  lmtSno: "1",
  prtcptPsblRgnNm: "대구광역시",
  rgstDt: "2026-10-12 09:00:22",
  bsnsDivNm: "용역",
  ...overrides,
});
const eorderRow = (overrides: G2bItem = {}): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  atchSno: "1",
  eorderDocDivNm: "제안요청서",
  eorderAtchFileNm: "제안요청서.hwpx",
  eorderAtchFileUrl: RFP_URL(1),
  ...overrides,
});
const listItem = (overrides: G2bItem = {}): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  ntceKindNm: "등록공고",
  bidNtceDt: "2026-10-12 09:00:22",
  rgstDt: "2026-10-12 09:00:25",
  bidNtceNm: "가상 정보시스템 유지관리 용역",
  dminsttNm: "가상수요기관",
  bidClseDt: "2026-11-23 12:00:00",
  asignBdgtAmt: "1264200000",
  bidNtceDtlUrl: `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${NOTICE_NO}&bidPbancOrd=000`,
  ntceSpecDocUrl1: LIST_DOC_URL,
  ntceSpecFileNm1: "1.제안요청서.pdf",
  ...overrides,
});
const draftOf = (item: G2bItem = listItem()): NormalizedBidDraft => {
  const outcome = normalizeG2bBidNotice(item, { fetchedAt: FETCHED_AT });
  if (!outcome.ok) throw new Error(`정규화 실패: ${outcome.issue.code}`);
  return outcome.draft;
};
const rows = (overrides: Partial<G2bAuxRows> = {}): G2bAuxRows => ({
  licenseLimit: [],
  region: [],
  eorderAttach: [],
  ...overrides,
});

describe("splitNameAndCode", () => {
  it.each([
    ["정보통신공사업/0036", { name: "정보통신공사업", code: "0036" }],
    [
      "소프트웨어사업자(컴퓨터관련서비스사업)/1468",
      { name: "소프트웨어사업자(컴퓨터관련서비스사업)", code: "1468" },
    ],
    [
      "제작자 등(자동차-국내 제작·조립)/5898",
      { name: "제작자 등(자동차-국내 제작·조립)", code: "5898" },
    ],
  ])("%s → 이름/4자리 코드", (raw, expected) => {
    expect(splitNameAndCode(raw)).toEqual(expected);
  });

  it("코드 꼴(/4자리)이 아니면 전체가 이름이고 코드는 null 이다", () => {
    expect([splitNameAndCode("정보통신공사업"), splitNameAndCode("a/b/12")]).toEqual([
      { name: "정보통신공사업", code: null },
      { name: "a/b/12", code: null },
    ]);
  });

  it("빈 값은 이름·코드 모두 null 이다(지어내지 않는다)", () => {
    expect(splitNameAndCode("  ")).toEqual({ name: null, code: null });
  });

  it("앞뒤 공백·연속 공백을 접는다", () => {
    expect(splitNameAndCode("  정보통신  공사업 / 0036".replace(" / ", "/"))).toEqual({
      name: "정보통신 공사업",
      code: "0036",
    });
  });
});

describe("licenseRequirementsOf", () => {
  it("행마다 LICENSE_LIMIT 하나. lcnsLmtNm 을 name/code 로 나누고 value 는 원본 행이다", () => {
    expect(licenseRequirementsOf([licenseRow()])).toEqual([
      {
        kind: "LICENSE_LIMIT",
        code: "0036",
        name: "정보통신공사업",
        value: licenseRow(),
        sourceOperation: LICENSE_OP,
      },
    ]);
  });

  it("lmtGrpNo → lmtSno 숫자 순으로 정렬한다(실측은 2-3, 1-1, 2-4, 1-2 순서로 온다)", () => {
    const unordered = [
      licenseRow({ lmtGrpNo: "2", lmtSno: "3" }),
      licenseRow({ lmtGrpNo: "1", lmtSno: "1" }),
      licenseRow({
        lmtGrpNo: "2",
        lmtSno: "4",
        lcnsLmtNm: "소프트웨어사업자(패키지소프트웨어개발.공급사업)/1426",
      }),
      licenseRow({
        lmtGrpNo: "1",
        lmtSno: "2",
        lcnsLmtNm: "소프트웨어사업자(컴퓨터관련서비스사업)/1468",
      }),
    ];

    expect(
      licenseRequirementsOf(unordered).map((row) => [
        row.value.lmtGrpNo,
        row.value.lmtSno,
        row.code,
      ]),
    ).toEqual([
      ["1", "1", "0036"],
      ["1", "2", "1468"],
      ["2", "3", "0036"],
      ["2", "4", "1426"],
    ]);
  });

  it("'10' 은 '9' 뒤다(문자열이 아니라 숫자로 비교)", () => {
    const sorted = licenseRequirementsOf([
      licenseRow({ lmtSno: "10" }),
      licenseRow({ lmtSno: "9" }),
    ]);
    expect(sorted.map((row) => row.value.lmtSno)).toEqual(["9", "10"]);
  });

  it("permsnIndstrytyList 의 [이름/코드] 항목마다 PERMITTED_INDUSTRY 를 만든다(LICENSE_LIMIT 뒤)", () => {
    const row = licenseRow({
      lcnsLmtNm: "식품판매업(집단급식소식품판매업)/5246",
      permsnIndstrytyList: "[식품제조·가공업/1399],[축산물가공업(식육가공업)/4004]",
    });

    expect(licenseRequirementsOf([row]).map(({ kind, code, name }) => [kind, code, name])).toEqual([
      ["LICENSE_LIMIT", "5246", "식품판매업(집단급식소식품판매업)"],
      ["PERMITTED_INDUSTRY", "1399", "식품제조·가공업"],
      ["PERMITTED_INDUSTRY", "4004", "축산물가공업(식육가공업)"],
    ]);
  });

  it("PERMITTED_INDUSTRY 의 value 는 그 목록이 실린 면허제한 행이고 sourceOperation 은 면허제한 오퍼레이션이다", () => {
    const row = licenseRow({ permsnIndstrytyList: "[식품제조·가공업/1399]" });
    const [, industry] = licenseRequirementsOf([row]);
    expect([industry?.value, industry?.sourceOperation]).toEqual([row, LICENSE_OP]);
  });

  it("두 면허제한 행이 같은 허용 업종 목록을 실으면 한 번만 만든다", () => {
    const list = "[식품제조·가공업/1399]";
    const result = licenseRequirementsOf([
      licenseRow({ lmtSno: "1", permsnIndstrytyList: list }),
      licenseRow({ lmtSno: "2", permsnIndstrytyList: list }),
    ]);
    expect(result.filter((row) => row.kind === "PERMITTED_INDUSTRY")).toHaveLength(1);
  });

  it("lcnsLmtNm 이 비어 있으면 name·code 가 null 인 행으로 둔다(값을 지어내지 않는다)", () => {
    const [row] = licenseRequirementsOf([licenseRow({ lcnsLmtNm: "" })]);
    expect([row?.name, row?.code]).toEqual([null, null]);
  });

  it("빈 입력은 빈 배열이다", () => {
    expect(licenseRequirementsOf([])).toEqual([]);
  });
});

describe("regionRequirementsOf", () => {
  it("행마다 PARTICIPATION_REGION 하나. name 은 prtcptPsblRgnNm, code 는 null 이다", () => {
    expect(regionRequirementsOf([regionRow()])).toEqual([
      {
        kind: "PARTICIPATION_REGION",
        code: null,
        name: "대구광역시",
        value: regionRow(),
        sourceOperation: REGION_OP,
      },
    ]);
  });

  it("lmtSno 숫자 순으로 정렬한다", () => {
    const sorted = regionRequirementsOf([
      regionRow({ lmtSno: "2", prtcptPsblRgnNm: "경상북도" }),
      regionRow({ lmtSno: "1" }),
    ]);
    expect(sorted.map((row) => row.name)).toEqual(["대구광역시", "경상북도"]);
  });
});

describe("eorderAttachmentsOf", () => {
  it("행마다 {name, url} 하나다(mimeType·sizeBytes 는 응답에 없어 넣지 않는다)", () => {
    expect(eorderAttachmentsOf([eorderRow()])).toEqual([
      { name: "제안요청서.hwpx", url: RFP_URL(1) },
    ]);
  });

  it("이름이 비어 있으면 '문서구분 순번' 으로 만든다(실측에 이름 없는 행 2건)", () => {
    expect(
      eorderAttachmentsOf([
        eorderRow({ atchSno: "31", eorderAtchFileNm: "", eorderAtchFileUrl: RFP_URL(31) }),
      ]),
    ).toEqual([{ name: "제안요청서 31", url: RFP_URL(31) }]);
  });

  it("URL 이 없는 행은 뺀다", () => {
    expect(eorderAttachmentsOf([eorderRow({ eorderAtchFileUrl: "" })])).toEqual([]);
  });

  it("첨부 허용 목록(https://www.g2b.go.kr/pn/) 밖의 URL 은 저장하지 않는다(09 SSRF — 응답 변조·다른 호스트·http·사설 주소)", () => {
    const rejected = [
      "http://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do?x=1",
      "https://evil.example/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do",
      "https://www.g2b.go.kr/other/downloadRfpFile.do",
      "https://127.0.0.1/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do",
      "https://user:pw@www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do",
      "javascript:alert(1)",
      "not a url",
    ];
    for (const url of rejected) {
      expect(eorderAttachmentsOf([eorderRow({ eorderAtchFileUrl: url })]), url).toEqual([]);
    }
    // 허용 목록 안의 행은 같은 입력에서 그대로 남는다(검사가 전부를 버리는 것이 아니다).
    expect(
      eorderAttachmentsOf([
        eorderRow(),
        eorderRow({ atchSno: "99", eorderAtchFileUrl: rejected[1] }),
      ]),
    ).toHaveLength(1);
  });

  it("atchSno 숫자 순으로 정렬하고 같은 url 은 하나만 남긴다(실측은 26, 31, 30 순서로 온다)", () => {
    const sorted = eorderAttachmentsOf([
      eorderRow({ atchSno: "26", eorderAtchFileUrl: RFP_URL(26) }),
      eorderRow({ atchSno: "31", eorderAtchFileUrl: RFP_URL(31), eorderDocDivNm: "기타문서" }),
      eorderRow({ atchSno: "30", eorderAtchFileUrl: RFP_URL(30) }),
      eorderRow({ atchSno: "30", eorderAtchFileUrl: RFP_URL(30) }),
    ]);
    expect(sorted.map(({ url }) => url)).toEqual([RFP_URL(26), RFP_URL(30), RFP_URL(31)]);
  });
});

describe("mergeG2bAux", () => {
  it("목록 첨부 뒤에 e발주 첨부를 더한다", () => {
    const merged = mergeG2bAux(draftOf(), rows({ eorderAttach: [eorderRow()] }));
    expect(merged.attachments).toEqual([
      { name: "1.제안요청서.pdf", url: LIST_DOC_URL },
      { name: "제안요청서.hwpx", url: RFP_URL(1) },
    ]);
  });

  it("목록 첨부와 같은 url 의 e발주 첨부는 목록 쪽만 남긴다", () => {
    const merged = mergeG2bAux(
      draftOf(),
      rows({ eorderAttach: [eorderRow({ eorderAtchFileUrl: LIST_DOC_URL })] }),
    );
    expect(merged.attachments).toEqual([{ name: "1.제안요청서.pdf", url: LIST_DOC_URL }]);
  });

  it("structuredQualifications 는 kind 순(LICENSE_LIMIT → PERMITTED_INDUSTRY → PARTICIPATION_REGION)이다", () => {
    const merged = mergeG2bAux(
      draftOf(),
      rows({
        region: [regionRow()],
        licenseLimit: [licenseRow({ permsnIndstrytyList: "[식품제조·가공업/1399]" })],
      }),
    );
    expect(merged.structuredQualifications.map(({ kind }) => kind)).toEqual([
      "LICENSE_LIMIT",
      "PERMITTED_INDUSTRY",
      "PARTICIPATION_REGION",
    ]);
  });

  it("다른 필드는 그대로 둔다", () => {
    const draft = draftOf();
    const merged = mergeG2bAux(draft, rows({ licenseLimit: [licenseRow()] }));
    expect({ ...merged, attachments: draft.attachments, structuredQualifications: [] }).toEqual(
      draft,
    );
  });

  it("빈 보조 결과를 합치면 draft 와 같다", () => {
    const draft = draftOf();
    expect(mergeG2bAux(draft, rows())).toEqual(draft);
  });

  it("보조 행의 순서가 달라도 같은 결과(같은 checksum)다", () => {
    const forward = rows({
      licenseLimit: [
        licenseRow({ lmtSno: "1" }),
        licenseRow({ lmtSno: "2", lcnsLmtNm: "소프트웨어사업자/1468" }),
      ],
      region: [regionRow({ lmtSno: "1" }), regionRow({ lmtSno: "2", prtcptPsblRgnNm: "경상북도" })],
      eorderAttach: [
        eorderRow({ atchSno: "1" }),
        eorderRow({ atchSno: "2", eorderAtchFileUrl: RFP_URL(2) }),
      ],
    });
    const backward = rows({
      licenseLimit: [...forward.licenseLimit].reverse(),
      region: [...forward.region].reverse(),
      eorderAttach: [...forward.eorderAttach].reverse(),
    });

    const left = finalizeRevision(mergeG2bAux(draftOf(), forward), 1);
    const right = finalizeRevision(mergeG2bAux(draftOf(), backward), 1);
    expect([canonicalJson(left) === canonicalJson(right), left.checksum]).toEqual([
      true,
      right.checksum,
    ]);
  });
});

describe("listOnlyRevision", () => {
  const stored = (): StoredRevision => {
    const bid = finalizeRevision(
      mergeG2bAux(
        draftOf(),
        rows({ licenseLimit: [licenseRow()], region: [regionRow()], eorderAttach: [eorderRow()] }),
      ),
      3,
    );
    return { bidId: "bid-1", revision: 3, checksum: bid.checksum, normalized: bid };
  };

  it("보조 유래 구조화 자격과 e발주 첨부를 뺀다. 목록 첨부는 남는다", () => {
    const listOnly = listOnlyRevision(stored());
    expect([listOnly.normalized.structuredQualifications, listOnly.normalized.attachments]).toEqual(
      [[], [{ name: "1.제안요청서.pdf", url: LIST_DOC_URL }]],
    );
  });

  it("checksum 은 목록만으로 만든 draft 를 같은 revision 으로 확정한 값과 같다", () => {
    const listOnly = listOnlyRevision(stored());
    const expected = finalizeRevision(draftOf(), 3);
    expect([
      listOnly.checksum,
      listOnly.normalized.checksum,
      listOnly.revision,
      listOnly.bidId,
    ]).toEqual([expected.checksum, expected.checksum, 3, "bid-1"]);
  });

  it("e발주 첨부는 경로로 알아본다(목록 첨부 downloadFile.do 는 남긴다)", () => {
    expect(G2B_EORDER_ATTACHMENT_PATH).toBe("/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do");
    expect(new URL(LIST_DOC_URL).pathname).not.toBe(G2B_EORDER_ATTACHMENT_PATH);
  });

  it("입력을 바꾸지 않는다", () => {
    const previous = stored();
    const before = structuredClone(previous);
    listOnlyRevision(previous);
    expect(previous).toEqual(before);
  });
});

describe("registeredAtOf", () => {
  it("rgstDt(KST)를 먼저 쓴다", () => {
    expect(registeredAtOf(listItem(), FETCHED_AT).toISOString()).toBe("2026-10-12T00:00:25.000Z");
  });

  it("rgstDt 가 없으면 bidNtceDt 를 쓴다", () => {
    expect(registeredAtOf(listItem({ rgstDt: "" }), FETCHED_AT).toISOString()).toBe(
      "2026-10-12T00:00:22.000Z",
    );
  });

  it("둘 다 읽을 수 없으면 받은 시각이다", () => {
    expect(registeredAtOf(listItem({ rgstDt: "어제", bidNtceDt: undefined }), FETCHED_AT)).toEqual(
      FETCHED_AT,
    );
  });
});
