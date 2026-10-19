import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets, redactUrl } from "./redaction";

// V2-11 의 순수 부분: 서비스키가 로그·오류·ingest_errors 에 0회 남아야 한다(요청 URL 의 쿼리 포함).
// 아래 값은 모두 시험용 가짜 키다.
const SECRET = "fakeKey+abc/123==";
const ENCODED_ONCE = encodeURIComponent(SECRET);
const ENCODED_TWICE = encodeURIComponent(ENCODED_ONCE);
const ENDPOINT =
  "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc";
const forms = (secret: string) => [
  secret,
  encodeURIComponent(secret),
  encodeURIComponent(encodeURIComponent(secret)),
];

describe("redactSecrets", () => {
  it("가림 표시는 [REDACTED] 다", () => {
    expect(REDACTED).toBe("[REDACTED]");
  });

  it("secret 원문을 가린다", () => {
    expect(redactSecrets(`키=${SECRET} 실패`, [SECRET])).toBe("키=[REDACTED] 실패");
  });

  it("encodeURIComponent 1회 형태를 가린다", () => {
    expect(redactSecrets(`serviceKey=${ENCODED_ONCE}&pageNo=1`, [SECRET])).toBe(
      "serviceKey=[REDACTED]&pageNo=1",
    );
  });

  it("encodeURIComponent 2회 형태를 가린다", () => {
    expect(redactSecrets(`url=${ENCODED_TWICE}`, [SECRET])).toBe("url=[REDACTED]");
  });

  it("한 문자열 안의 세 형태와 반복 등장을 모두 가린다", () => {
    const text = `${SECRET} ${ENCODED_ONCE} ${ENCODED_TWICE} ${SECRET}`;
    expect(redactSecrets(text, [SECRET])).toBe("[REDACTED] [REDACTED] [REDACTED] [REDACTED]");
  });

  it("서비스키 4개의 모든 형태가 결과에 0회 남는다", () => {
    const secrets = [
      "fakeNotice+1/A==",
      "fakePreSpec+2/B==",
      "fakePlan+3/C==",
      "fakeIndustry+4/D==",
    ];
    const text = secrets.flatMap(forms).join(" | ");
    const redacted = redactSecrets(text, secrets);
    expect(secrets.flatMap(forms).filter((form) => redacted.includes(form))).toEqual([]);
  });

  it("빈 secret 은 무시하고 문자열을 그대로 둔다", () => {
    expect(redactSecrets("수집 실패", [""])).toBe("수집 실패");
  });

  it("공백뿐인 secret 은 무시하고 문자열을 그대로 둔다", () => {
    expect(redactSecrets("수집 실패 page 2", ["  "])).toBe("수집 실패 page 2");
  });

  it("secret 목록이 비면 문자열을 그대로 둔다", () => {
    expect(redactSecrets(`키=${SECRET}`, [])).toBe(`키=${SECRET}`);
  });

  it("긴 secret 부터 가려 짧은 secret 의 조각이 남지 않는다", () => {
    expect(redactSecrets("값 abcdef 끝", ["abc", "abcdef"])).toBe("값 [REDACTED] 끝");
  });

  it("정규식 특수문자가 든 secret 도 글자 그대로만 가린다", () => {
    expect(redactSecrets("axc a.b*c", ["a.b*c"])).toBe("axc [REDACTED]");
  });
});

// 7-6(security-auditor): 서버가 퍼센트 인코딩을 소문자 16진(%2b)으로 되돌려 줘도 가린다.
// 원문 키도 대소문자 무관으로 찾는다(과하게 가려도 해가 없다는 계약).
describe("redactSecrets — 대소문자 무관 (7-6)", () => {
  // 시험용 가짜 키. encodeURIComponent 1회 = ab%2Bc%2Fd%3D, 2회 = ab%252Bc%252Fd%253D
  const KEY = "ab+c/d=";

  it("인코딩 1회형을 소문자 16진으로 쓴 ab%2bc%2fd%3d 를 가린다", () => {
    expect(redactSecrets("serviceKey=ab%2bc%2fd%3d", [KEY])).toBe("serviceKey=[REDACTED]");
  });

  it("인코딩 2회형을 소문자 16진으로 쓴 ab%252bc%252fd%253d 를 가린다", () => {
    expect(redactSecrets("url=ab%252bc%252fd%253d", [KEY])).toBe("url=[REDACTED]");
  });

  it("16진 대소문자가 섞인 인코딩형도 가린다", () => {
    expect(redactSecrets("serviceKey=ab%2Bc%2fd%3D", [KEY])).toBe("serviceKey=[REDACTED]");
  });

  it("인코딩형 전체를 대문자로 바꿔도 가린다", () => {
    expect(redactSecrets("serviceKey=AB%2BC%2FD%3D", [KEY])).toBe("serviceKey=[REDACTED]");
  });

  it("원문의 대소문자를 바꾼 형태도 가린다", () => {
    expect(redactSecrets("키=AB+C/D= 실패", [KEY])).toBe("키=[REDACTED] 실패");
  });

  it("대소문자가 다른 형태가 여러 번 나오면 모두 가린다", () => {
    expect(redactSecrets("ab%2bc%2fd%3d | AB+c/D= | ab%252Bc%252fd%253D", [KEY])).toBe(
      "[REDACTED] | [REDACTED] | [REDACTED]",
    );
  });

  it("가린 키 옆의 다른 텍스트는 그대로 둔다", () => {
    expect(redactSecrets("serviceKey=ab%2bc%2fd%3d&pageNo=1&type=json", [KEY])).toBe(
      "serviceKey=[REDACTED]&pageNo=1&type=json",
    );
  });

  it("키의 일부만 같은 텍스트는 대소문자가 같아도 가리지 않는다", () => {
    expect(redactSecrets("AB+C 와 ab%2bc 는 키가 아니다", [KEY])).toBe(
      "AB+C 와 ab%2bc 는 키가 아니다",
    );
  });

  it("대소문자 무관으로 찾아도 정규식 특수문자는 글자 그대로만 가린다", () => {
    expect(redactSecrets("AXC A.B*C", ["a.b*c"])).toBe("AXC [REDACTED]");
  });
});

describe("redactUrl — URL 로 읽히는 경우", () => {
  const url = `${ENDPOINT}?serviceKey=${ENCODED_ONCE}&type=json&numOfRows=10&pageNo=1`;

  it("serviceKey 값을 [REDACTED] 로 바꾼다", () => {
    expect(new URL(redactUrl(url)).searchParams.get("serviceKey")).toBe(REDACTED);
  });

  it("서비스키의 원문·인코딩 형태가 남지 않는다", () => {
    const redacted = redactUrl(url);
    expect([redacted.includes(SECRET), redacted.includes(ENCODED_ONCE)]).toEqual([false, false]);
  });

  it("다른 쿼리 파라미터는 그대로 둔다", () => {
    const params = new URL(redactUrl(url)).searchParams;
    expect([params.get("type"), params.get("numOfRows"), params.get("pageNo")]).toEqual([
      "json",
      "10",
      "1",
    ]);
  });

  it("호스트와 경로를 그대로 둔다", () => {
    const redacted = new URL(redactUrl(url));
    expect(`${redacted.origin}${redacted.pathname}`).toBe(ENDPOINT);
  });

  it.each(["ServiceKey", "SERVICEKEY", "servicekey", "serviceKey"])(
    "파라미터 이름 %j 를 대소문자 구분 없이 가린다",
    (name) => {
      const redacted = new URL(redactUrl(`${ENDPOINT}?${name}=${ENCODED_ONCE}&pageNo=1`));
      expect(redacted.searchParams.get(name)).toBe(REDACTED);
    },
  );

  it("대소문자만 다른 servicekey 파라미터가 여러 개면 모두 가린다", () => {
    const redacted = redactUrl(`${ENDPOINT}?serviceKey=AAA111&ServiceKey=BBB222&pageNo=1`);
    expect([redacted.includes("AAA111"), redacted.includes("BBB222")]).toEqual([false, false]);
  });

  it("이름이 servicekey 와 정확히 같지 않은 파라미터는 가리지 않는다", () => {
    const params = new URL(redactUrl(`${ENDPOINT}?serviceKeyEnv=G2B_BID_NOTICE&myservicekey=v1`))
      .searchParams;
    expect([params.get("serviceKeyEnv"), params.get("myservicekey")]).toEqual([
      "G2B_BID_NOTICE",
      "v1",
    ]);
  });

  it("servicekey 가 없는 URL 은 그대로 돌려준다", () => {
    const plain = `${ENDPOINT}?type=json&numOfRows=10&pageNo=1`;
    expect(redactUrl(plain)).toBe(plain);
  });
});

describe("redactUrl — URL 로 읽히지 않는 경우(정규식)", () => {
  it("상대 경로의 serviceKey 값을 가리고 나머지를 그대로 둔다", () => {
    expect(
      redactUrl(`/1230000/ad/getBidPblancListInfoServc?serviceKey=${ENCODED_ONCE}&pageNo=1`),
    ).toBe("/1230000/ad/getBidPblancListInfoServc?serviceKey=[REDACTED]&pageNo=1");
  });

  it("문장 속 URL 조각의 ServiceKey 를 대소문자 구분 없이 가린다", () => {
    expect(
      redactUrl(`요청 실패: getBidPblancListInfoServc?ServiceKey=${ENCODED_ONCE}&pageNo=1`),
    ).toBe("요청 실패: getBidPblancListInfoServc?ServiceKey=[REDACTED]&pageNo=1");
  });

  it("& 뒤의 servicekey 도 가린다", () => {
    expect(redactUrl(`op?pageNo=1&SERVICEKEY=${ENCODED_ONCE}`)).toBe(
      "op?pageNo=1&SERVICEKEY=[REDACTED]",
    );
  });

  it("# 앞에서 가림을 멈춘다", () => {
    expect(redactUrl(`op?serviceKey=${ENCODED_ONCE}#top`)).toBe("op?serviceKey=[REDACTED]#top");
  });
});
