// 직무 코드(scripts/people/capabilities.mjs PROFILES 의 직무 10종)와 화면 이름, 공고 역할 문구 대응표.
export const WORK_ROLE_CODES = [
  "PM",
  "PL",
  "DEVELOPER",
  "DATA_AI",
  "DBA",
  "DEVOPS",
  "SECURITY",
  "DESIGNER",
  "QA",
  "BUSINESS_ANALYST",
] as const;
export type WorkRoleCode = (typeof WORK_ROLE_CODES)[number];

export const WORK_ROLE_LABELS: Record<WorkRoleCode, string> = {
  DEVELOPER: "개발자",
  DATA_AI: "데이터·AI",
  DEVOPS: "DevOps",
  QA: "QA",
  DESIGNER: "디자이너",
  BUSINESS_ANALYST: "업무 분석",
  SECURITY: "보안",
  DBA: "DBA",
  PM: "PM",
  PL: "PL",
};

const isWorkRoleCode = (code: string): code is WorkRoleCode =>
  (WORK_ROLE_CODES as readonly string[]).includes(code);

// 모르는 코드는 그대로 보인다.
export const workRoleLabel = (code: string) =>
  isWorkRoleCode(code) ? WORK_ROLE_LABELS[code] : code;

// 위에서부터 보고 처음 맞는 직무를 고른다. 영문 낱말은 같을 때만, 한글 낱말은 포함이면 맞는다.
// "개발"·"프로그래머"는 인프라·디자인·시험 낱말보다 먼저 본다("서버 개발자"·"UI 개발자"는 개발자다).
// "엔지니어"만 있으면 앞의 직무 낱말("클라우드 엔지니어", "테스트 엔지니어")을 따르고, 없을 때만 개발자다.
const ROLE_WORDS: { code: WorkRoleCode; english: string[]; korean: string[] }[] = [
  {
    code: "PM",
    english: ["pm"],
    korean: ["사업관리", "사업책임", "프로젝트관리", "프로젝트책임", "총괄"],
  },
  { code: "PL", english: ["pl"], korean: ["개발책임", "파트리더"] },
  { code: "DBA", english: ["dba", "db"], korean: ["데이터베이스"] },
  { code: "DATA_AI", english: ["ai"], korean: ["인공지능", "데이터", "머신러닝", "빅데이터"] },
  { code: "SECURITY", english: ["security"], korean: ["보안", "정보보호"] },
  { code: "DEVELOPER", english: [], korean: ["개발", "프로그래머"] },
  {
    code: "DEVOPS",
    english: ["devops"],
    korean: ["인프라", "클라우드", "시스템엔지니어", "네트워크", "서버"],
  },
  { code: "DESIGNER", english: ["ui", "ux"], korean: ["디자인", "디자이너", "퍼블리"] },
  { code: "QA", english: ["qa"], korean: ["테스트", "품질", "시험"] },
  { code: "BUSINESS_ANALYST", english: ["ba"], korean: ["업무분석", "분석가", "컨설", "기획"] },
  { code: "DEVELOPER", english: [], korean: ["엔지니어"] },
];

// 공고 원문 역할("개발", "AI 엔지니어")을 직무 코드로 바꾼다. 맞는 것이 없으면 짐작하지 않고 null 이다.
export function workRoleOf(text: string): WorkRoleCode | null {
  const lower = text.toLowerCase();
  const compact = lower.replace(/\s+/g, "");
  if (!compact) return null;
  const code = compact.toUpperCase();
  if (isWorkRoleCode(code)) return code;
  const words = new Set(lower.match(/[a-z]+/g) ?? []);
  return (
    ROLE_WORDS.find(
      (entry) =>
        entry.english.some((word) => words.has(word)) ||
        entry.korean.some((word) => compact.includes(word)),
    )?.code ?? null
  );
}
