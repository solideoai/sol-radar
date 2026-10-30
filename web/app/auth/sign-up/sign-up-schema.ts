import { z } from "zod";
import type { SignupOptions } from "@/server/shared";
import { createEmploymentSchema } from "@/app/auth/employment-schema";

// ── 회원가입 폼의 규칙. 화면의 검증은 편의다 ──
// 서버로 보내는 것은 이메일·비밀번호·이름·부서·직급 코드와 약관 동의 네 항목이다. 비밀번호 규칙의 정본은 Supabase Auth 설정(최소 길이 등)이고,
// 이름은 가입 트리거가 표시 이름 규칙(앞뒤 공백 없이 1~40자)으로 다듬어 저장한다.
// 약관 동의는 가입 트리거가 user_consents 에 항목별 시각과 함께 남긴다. 필수 셋 중 하나라도 true 가 아니면 트리거가 가입을 거절한다
// (supabase/migrations/20261027000600_signup_consents.sql). 여기의 필수 검사는 그 전에 칸 아래 오류를 보이는 편의다.
// 휴대폰·주소·생년월일은 화면에서 받기만 하고 보내지 않는다 — 암호화 저장을 붙일 때 함께 저장한다.
// 이메일은 @ 앞부분만 받고 뒤는 회사 도메인으로 고정한다. 이 화면의 제한이고 Supabase Auth 는 도메인을 거르지 않는다
// (간편 로그인 가입·관리자 API 로 만든 계정은 다른 도메인일 수 있다).

export const SIGN_UP_EMAIL_DOMAIN = "solideos.com";
export const toSignUpEmail = (local: string) => `${local}@${SIGN_UP_EMAIL_DOMAIN}`;

// 붙여넣기·자동 채우기로 회사 주소 전체가 들어오면 @ 앞만 남긴다. 다른 도메인은 오류로 알린다.
// 칸에 보이는 오류는 하나다. 앞 검사가 틀리면 뒤 검사는 돌지 않는다.
export const signUpEmailLocal = z
  .string()
  .trim()
  .transform((value) =>
    value.toLowerCase().endsWith(`@${SIGN_UP_EMAIL_DOMAIN}`)
      ? value.slice(0, -(SIGN_UP_EMAIL_DOMAIN.length + 1))
      : value,
  )
  .pipe(
    z
      .string()
      .min(1, { error: "이메일 아이디를 입력하세요", abort: true })
      .refine((local) => !local.includes("@"), {
        error: `@ 앞부분만 입력하세요. 뒤는 ${SIGN_UP_EMAIL_DOMAIN} 으로 정해져 있습니다`,
        abort: true,
      })
      .refine(
        (local) => z.email().safeParse(toSignUpEmail(local)).success,
        "이메일 형식이 아닙니다",
      ),
  );

const PHONE = /^01[016789]-?\d{3,4}-?\d{4}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MIN_BIRTH_DATE = "1900-01-01";

/** 숫자만 남겨 010-1234-5678 모양으로 맞춘다. 11자리를 넘는 숫자는 버린다. 10자리는 011-123-4567 처럼 가운데가 세 자리다. */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  const middle = digits.length === 10 ? 3 : 4;
  return `${digits.slice(0, 3)}-${digits.slice(3, 3 + middle)}-${digits.slice(3 + middle)}`;
}

/** YYYY-MM-DD 이고 실제로 있는 날이며 1900-01-01 부터 today(같은 모양)까지. */
export function isValidBirthDate(value: string, today: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // 2월 30일처럼 없는 날은 Date 가 다음 달로 넘겨 버린다. 되돌려 같은지 본다.
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= MIN_BIRTH_DATE &&
    value <= today
  );
}

// 이 브라우저의 오늘(YYYY-MM-DD). 날짜 입력칸의 max 와 검사에 같이 쓴다.
export const localToday = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

const required = (message: string) => z.boolean().refine((agreed) => agreed, message);

export const createSignUpSchema = (options: SignupOptions) =>
  z
    .object({
      ...createEmploymentSchema(options).shape,
      emailLocal: signUpEmailLocal,
      password: z.string().min(6, "비밀번호는 6자 이상입니다"),
      passwordConfirm: z.string().min(1, "비밀번호를 한 번 더 입력하세요"),
      phone: z
        .string()
        .trim()
        .refine(
          (phone) => phone === "" || PHONE.test(phone),
          "휴대폰 번호 형식이 아닙니다 (예: 010-1234-5678)",
        ),
      // 우편번호·기본 주소는 주소 검색이 채운다. 상세 주소만 직접 적는다.
      postcode: z.string(),
      address: z.string(),
      addressDetail: z.string().trim().max(100, "상세 주소는 100자 이하입니다"),
      birthDate: z
        .string()
        .refine(
          (date) => date === "" || isValidBirthDate(date, localToday()),
          "생년월일을 확인하세요",
        ),
      agreeTerms: required("이용약관에 동의해야 가입할 수 있습니다"),
      agreePrivacy: required("개인정보 수집·이용에 동의해야 가입할 수 있습니다"),
      agreeAge: required("만 14세 이상만 가입할 수 있습니다"),
      agreeMarketing: z.boolean(),
    })
    // 칸 하나의 오류와 상관없이 늘 본다(기본값은 다른 칸이 틀리면 건너뛴다). 오류는 그 칸 아래에 보인다.
    .refine((values) => values.password === values.passwordConfirm, {
      path: ["passwordConfirm"],
      message: "비밀번호가 일치하지 않습니다",
      when: ({ value }) =>
        typeof value === "object" && value !== null && "passwordConfirm" in value,
    })
    .refine((values) => values.addressDetail.trim() === "" || values.address !== "", {
      path: ["addressDetail"],
      message: "주소 검색으로 기본 주소를 먼저 고르세요",
      when: ({ value }) => typeof value === "object" && value !== null && "address" in value,
    });

export type SignUpValues = z.infer<ReturnType<typeof createSignUpSchema>>;

export const SIGN_UP_DEFAULTS: SignUpValues = {
  name: "",
  departmentId: "",
  jobTitleId: "",
  emailLocal: "",
  password: "",
  passwordConfirm: "",
  phone: "",
  postcode: "",
  address: "",
  addressDetail: "",
  birthDate: "",
  agreeTerms: false,
  agreePrivacy: false,
  agreeAge: false,
  agreeMarketing: false,
};

// 가입 요청에 실을 것. 민감 정보(휴대폰·주소·생년월일)는 여기 없다 — 저장을 붙일 때 이 함수만 넓힌다.
// 이름은 user_metadata.name 으로 가서 가입 트리거가 표시 이름으로 옮긴다(로그인 토큰에도 실린다).
// consents 의 키 이름은 가입 트리거가 읽는 이름과 같아야 한다. 동의 시각은 트리거가 정한다(화면 시계를 믿지 않는다).
export const toSignUpRequest = (values: SignUpValues) => ({
  email: toSignUpEmail(values.emailLocal),
  password: values.password,
  options: {
    data: {
      name: values.name.trim(),
      department_code: values.departmentId,
      job_title_code: values.jobTitleId,
      consents: {
        terms: values.agreeTerms,
        privacy: values.agreePrivacy,
        age_over_14: values.agreeAge,
        marketing: values.agreeMarketing,
      },
    },
  },
});

// 우편번호 서비스가 돌려준 값으로 기본 주소를 만든다. 도로명을 고르면 법정동·건물 이름을 괄호로 덧붙인다(서비스 안내의 예시와 같다).
export type PostcodeSelection = {
  zonecode: string;
  userSelectedType: string;
  roadAddress: string;
  jibunAddress: string;
  bname: string;
  buildingName: string;
  apartment: string;
};

export function toAddress(selection: PostcodeSelection): { postcode: string; address: string } {
  if (selection.userSelectedType !== "R") {
    return { postcode: selection.zonecode, address: selection.jibunAddress };
  }
  const extras = [
    /[동로가]$/.test(selection.bname) ? selection.bname : "",
    selection.apartment === "Y" ? selection.buildingName : "",
  ].filter((part) => part !== "");
  const extra = extras.length > 0 ? ` (${extras.join(", ")})` : "";
  return { postcode: selection.zonecode, address: `${selection.roadAddress}${extra}` };
}
