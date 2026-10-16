import { describe, expect, it } from "vitest";
import {
  formatPhone,
  isValidBirthDate,
  localToday,
  SIGN_UP_DEFAULTS,
  signUpSchema,
  type SignUpValues,
  toAddress,
  toSignUpRequest,
} from "./sign-up-schema";

const valid: SignUpValues = {
  ...SIGN_UP_DEFAULTS,
  name: "홍길동",
  email: "hong@example.com",
  password: "secret12",
  passwordConfirm: "secret12",
  agreeTerms: true,
  agreePrivacy: true,
  agreeAge: true,
};

const errorsOf = (values: SignUpValues) => {
  const result = signUpSchema.safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
};

describe("signUpSchema", () => {
  it("필수 항목과 필수 동의만 있으면 통과한다 — 휴대폰·주소·생년월일·마케팅은 선택이다", () => {
    expect(errorsOf(valid)).toEqual({});
  });

  it("이름은 앞뒤 공백을 걷고 1~40자다", () => {
    expect(errorsOf({ ...valid, name: "   " })).toMatchObject({ name: "이름을 입력하세요" });
    expect(errorsOf({ ...valid, name: "가".repeat(41) })).toMatchObject({
      name: "이름은 40자 이하입니다",
    });
    expect(errorsOf({ ...valid, name: ` ${"가".repeat(40)} ` })).toEqual({});
  });

  it("비밀번호 확인이 다르면 그 칸에 알린다 — 다른 칸이 틀려도 함께 알린다", () => {
    expect(errorsOf({ ...valid, passwordConfirm: "secret13" })).toEqual({
      passwordConfirm: "비밀번호가 일치하지 않습니다",
    });
    expect(errorsOf({ ...valid, email: "x", passwordConfirm: "other" })).toMatchObject({
      email: "이메일 형식이 아닙니다",
      passwordConfirm: "비밀번호가 일치하지 않습니다",
    });
  });

  it("필수 동의 셋이 하나라도 빠지면 그 동의에 알린다", () => {
    expect(errorsOf({ ...valid, agreeTerms: false, agreePrivacy: false, agreeAge: false })).toEqual(
      {
        agreeTerms: "이용약관에 동의해야 가입할 수 있습니다",
        agreePrivacy: "개인정보 수집·이용에 동의해야 가입할 수 있습니다",
        agreeAge: "만 14세 이상만 가입할 수 있습니다",
      },
    );
  });

  it("휴대폰 번호는 비우거나 01X 로 시작하는 10~11자리다(하이픈은 있어도 없어도 된다)", () => {
    ["010-1234-5678", "01012345678", "011-123-4567"].forEach((phone) =>
      expect(errorsOf({ ...valid, phone }), phone).toEqual({}),
    );
    ["02-123-4567", "010-12-5678", "010-1234-56789", "abc"].forEach((phone) =>
      expect(errorsOf({ ...valid, phone }), phone).toHaveProperty("phone"),
    );
  });

  it("기본 주소 없이 상세 주소만 적으면 주소 검색을 먼저 하라고 한다", () => {
    expect(errorsOf({ ...valid, addressDetail: "101호" })).toEqual({
      addressDetail: "주소 검색으로 기본 주소를 먼저 고르세요",
    });
    expect(
      errorsOf({
        ...valid,
        postcode: "06236",
        address: "서울 강남구 테헤란로 152",
        addressDetail: "101호",
      }),
    ).toEqual({});
  });

  it("생년월일은 비우거나 있는 날짜이고 미래가 아니다", () => {
    expect(errorsOf({ ...valid, birthDate: "1990-05-17" })).toEqual({});
    expect(errorsOf({ ...valid, birthDate: "2999-01-01" })).toHaveProperty("birthDate");
  });
});

describe("isValidBirthDate", () => {
  it("없는 날·범위 밖·모양이 틀린 값은 거절한다", () => {
    expect(isValidBirthDate("2000-02-29", "2026-10-15")).toBe(true);
    expect(isValidBirthDate("2001-02-29", "2026-10-15")).toBe(false);
    expect(isValidBirthDate("1899-12-31", "2026-10-15")).toBe(false);
    expect(isValidBirthDate("2026-10-15", "2026-10-15")).toBe(true);
    expect(isValidBirthDate("2026-10-16", "2026-10-15")).toBe(false);
    expect(isValidBirthDate("1990/05/17", "2026-10-15")).toBe(false);
  });
});

describe("localToday", () => {
  it("이 기기의 날짜를 YYYY-MM-DD 로 적는다", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("formatPhone", () => {
  it("숫자만 남겨 하이픈을 넣고, 11자리를 넘는 숫자는 버린다", () => {
    expect(formatPhone("01012345678")).toBe("010-1234-5678");
    expect(formatPhone("010 1234 5678")).toBe("010-1234-5678");
    expect(formatPhone("0111234567")).toBe("011-123-4567");
    expect(formatPhone("0101234567899")).toBe("010-1234-5678");
    expect(formatPhone("0101")).toBe("010-1");
    expect(formatPhone("01")).toBe("01");
    expect(formatPhone("")).toBe("");
  });
});

describe("toSignUpRequest", () => {
  it("이메일·비밀번호·이름만 싣고 휴대폰·주소·생년월일·동의는 싣지 않는다", () => {
    const request = toSignUpRequest({
      ...valid,
      name: "  홍길동 ",
      phone: "010-1234-5678",
      postcode: "06236",
      address: "서울 강남구 테헤란로 152",
      addressDetail: "101호",
      birthDate: "1990-05-17",
      agreeMarketing: true,
    });
    expect(request).toEqual({
      email: "hong@example.com",
      password: "secret12",
      options: { data: { name: "홍길동" } },
    });
  });
});

describe("toAddress", () => {
  const base = {
    zonecode: "06236",
    userSelectedType: "R",
    roadAddress: "서울 강남구 테헤란로 152",
    jibunAddress: "서울 강남구 역삼동 737",
    bname: "역삼동",
    buildingName: "강남파이낸스센터",
    apartment: "N",
  };

  it("도로명을 고르면 법정동을 괄호로 덧붙이고, 공동주택이면 건물 이름도 덧붙인다", () => {
    expect(toAddress(base)).toEqual({
      postcode: "06236",
      address: "서울 강남구 테헤란로 152 (역삼동)",
    });
    expect(toAddress({ ...base, apartment: "Y" }).address).toBe(
      "서울 강남구 테헤란로 152 (역삼동, 강남파이낸스센터)",
    );
    expect(toAddress({ ...base, bname: "역삼1리" }).address).toBe("서울 강남구 테헤란로 152");
  });

  it("지번을 고르면 지번 주소 그대로다", () => {
    expect(toAddress({ ...base, userSelectedType: "J" })).toEqual({
      postcode: "06236",
      address: "서울 강남구 역삼동 737",
    });
  });
});
