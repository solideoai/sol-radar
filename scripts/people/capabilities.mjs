// These profiles describe synthetic people only; approved identity and portrait data never enter generation.
export const CAPABILITY_VERSION = "synthetic-people/v2";
const PROFILES = [
  {
    role: "DEVELOPER",
    skills: ["Java", "Spring Boot", "PostgreSQL"],
    certificate: ["ENGINEER_INFORMATION_PROCESSING", "정보처리기사"],
  },
  {
    role: "DATA_AI",
    skills: ["Python", "SQL", "PyTorch", "RAG"],
    certificate: ["ADSP", "데이터분석준전문가"],
  },
  {
    role: "DEVOPS",
    skills: ["Kubernetes", "Docker", "Terraform", "AWS"],
    certificate: ["CKA", "Certified Kubernetes Administrator"],
  },
  {
    role: "QA",
    skills: ["Playwright", "Test Automation", "SQL"],
    certificate: ["ISTQB_CTFL", "ISTQB Foundation Level"],
  },
  {
    role: "DESIGNER",
    skills: ["Figma", "UX Research", "Accessibility"],
    certificate: ["WEB_DESIGN", "웹디자인기능사"],
  },
  {
    role: "BUSINESS_ANALYST",
    skills: ["Requirements Analysis", "BPMN", "SQL"],
    certificate: ["SQLD", "SQL 개발자"],
  },
  {
    role: "SECURITY",
    skills: ["Security Architecture", "OWASP", "Linux"],
    certificate: ["INFORMATION_SECURITY", "정보보안기사"],
  },
  {
    role: "DBA",
    skills: ["PostgreSQL", "Oracle", "SQL", "Database Tuning"],
    certificate: ["SQLP", "SQL 전문가"],
  },
  {
    role: "PM",
    skills: ["프로젝트 관리", "Risk Management", "Public SI"],
    certificate: ["PMP", "Project Management Professional"],
  },
  {
    role: "PL",
    skills: ["Java", "Spring Boot", "Architecture", "프로젝트 관리"],
    certificate: ["ENGINEER_INFORMATION_PROCESSING", "정보처리기사"],
  },
];
const LEGACY_ROLES = [
  "PM",
  "PM",
  ...Array(4).fill("PL"),
  ...Array(18).fill("DEVELOPER"),
  ...Array(3).fill("DATA_AI"),
];
const legacy = new Map(LEGACY_ROLES.map((role, index) => [((index * 37 + 11) % 200) + 1, role]));

// 발주기관은 모두 가상이다. 실존 부처·지자체·공공기관 이름을 쓰지 않는다(ADR-019).
const CLIENTS = [
  { client: "한빛시청", prefix: "한빛시", kind: "LOCAL" },
  { client: "새솔도청", prefix: "새솔도", kind: "LOCAL" },
  { client: "가람군청", prefix: "가람군", kind: "LOCAL" },
  { client: "다온시청", prefix: "다온시", kind: "LOCAL" },
  { client: "하늬도청", prefix: "하늬도", kind: "LOCAL" },
  { client: "라온구청", prefix: "라온구", kind: "LOCAL" },
  { client: "누리정보진흥원", kind: "AGENCY" },
  { client: "윤슬데이터진흥원", kind: "AGENCY" },
  { client: "한빛도시공사", kind: "AGENCY" },
  { client: "새솔도교육청", kind: "EDUCATION" },
  { client: "하늬도교육청", kind: "EDUCATION" },
  { client: "한빛교통공사", kind: "TRAFFIC" },
  { client: "다온복지재단", kind: "WELFARE" },
  { client: "가람의료원", kind: "HOSPITAL" },
];
const GENERAL = ["LOCAL", "AGENCY"];
const PROJECTS = {
  CIVIL: { title: "통합 민원 시스템 고도화", domain: "민원", kinds: GENERAL },
  DATA: { title: "데이터 플랫폼 구축 2단계", domain: "데이터", kinds: GENERAL },
  OPEN_DATA: { title: "공공데이터 개방 포털 구축", domain: "데이터", kinds: GENERAL },
  DB_MIGRATION: {
    title: "DB 이관 및 데이터 표준화",
    domain: "데이터",
    kinds: [...GENERAL, "HOSPITAL"],
  },
  BIGDATA: {
    title: "빅데이터 분석·예측 모델 구축",
    domain: "AI",
    kinds: [...GENERAL, "TRAFFIC"],
  },
  CHATBOT: { title: "AI 민원 상담 서비스 구축", domain: "AI", kinds: ["LOCAL"] },
  CLOUD: { title: "행정정보시스템 클라우드 전환", domain: "클라우드", kinds: GENERAL },
  PIPELINE: {
    title: "클라우드 네이티브 전환 및 CI/CD 구축",
    domain: "클라우드",
    kinds: ["AGENCY"],
  },
  OPS: {
    title: "정보시스템 통합 유지관리",
    domain: "운영",
    kinds: [...GENERAL, "EDUCATION", "HOSPITAL"],
  },
  FINANCE: { title: "차세대 재정관리시스템 구축", domain: "행정", kinds: GENERAL },
  DOCUMENTS: { title: "전자문서 유통 시스템 재구축", domain: "행정", kinds: GENERAL },
  ISP: { title: "정보화전략계획(ISP) 수립", domain: "컨설팅", kinds: [...GENERAL, "EDUCATION"] },
  ISMS: { title: "정보보호 관리체계 고도화", domain: "보안", kinds: [...GENERAL, "HOSPITAL"] },
  SECURITY_AUDIT: {
    title: "개인정보 영향평가 및 보안 진단",
    domain: "보안",
    kinds: [...GENERAL, "WELFARE"],
  },
  QUALITY: { title: "응용시스템 품질 검증 및 시험 자동화", domain: "품질", kinds: GENERAL },
  ACCESSIBILITY: {
    title: "누리집 웹 접근성 개선",
    domain: "웹",
    kinds: [...GENERAL, "EDUCATION", "WELFARE"],
  },
  UX: { title: "대국민 서비스 UI·UX 개편", domain: "웹", kinds: GENERAL },
  SCHOOL: { title: "학사 행정 정보시스템 고도화", domain: "교육", kinds: ["EDUCATION"] },
  TRAFFIC: { title: "스마트 교통정보 시스템 구축", domain: "교통", kinds: ["LOCAL", "TRAFFIC"] },
  WELFARE: { title: "복지급여 통합관리 시스템 개편", domain: "복지", kinds: ["LOCAL", "WELFARE"] },
  HOSPITAL: { title: "병원 정보시스템 재구축", domain: "의료", kinds: ["HOSPITAL"] },
};
// 직무마다 다섯 개 이상이라 한 사람의 3~5건은 사업 종류가 겹치지 않는다.
const ROLE_PROJECTS = {
  DEVELOPER: ["CIVIL", "FINANCE", "DOCUMENTS", "WELFARE", "SCHOOL", "TRAFFIC"],
  DATA_AI: ["DATA", "BIGDATA", "CHATBOT", "OPEN_DATA", "TRAFFIC"],
  DEVOPS: ["CLOUD", "PIPELINE", "OPS", "DATA", "HOSPITAL"],
  QA: ["QUALITY", "CIVIL", "FINANCE", "SCHOOL", "ACCESSIBILITY"],
  DESIGNER: ["UX", "ACCESSIBILITY", "CIVIL", "OPEN_DATA", "SCHOOL"],
  BUSINESS_ANALYST: ["ISP", "CIVIL", "WELFARE", "FINANCE", "DOCUMENTS"],
  SECURITY: ["ISMS", "SECURITY_AUDIT", "CLOUD", "HOSPITAL", "OPS"],
  DBA: ["DB_MIGRATION", "DATA", "FINANCE", "HOSPITAL", "OPEN_DATA"],
  PM: ["ISP", "CIVIL", "DATA", "FINANCE", "WELFARE", "CLOUD"],
  PL: ["CIVIL", "CLOUD", "DOCUMENTS", "SCHOOL", "FINANCE", "TRAFFIC"],
};
// 등급이 높을수록 첫 프로젝트가 더 과거다. 등급별 첫 시작 범위(from 부터 spread 개월)는 서로 겹치지 않는다.
const CAREERS = {
  초급: { from: 2022, spread: 12, minCount: 3, maxCount: 4, minMonths: 6, maxMonths: 10 },
  중급: { from: 2018, spread: 18, minCount: 3, maxCount: 5, minMonths: 8, maxMonths: 16 },
  고급: { from: 2013, spread: 24, minCount: 4, maxCount: 5, minMonths: 12, maxMonths: 24 },
  특급: { from: 2007, spread: 36, minCount: 4, maxCount: 5, minMonths: 14, maxMonths: 30 },
};
// 2026-09-01. 가용 창(2026-10-01 부터)보다 앞에서 끝난다. 달은 year * 12 + (month - 1) 로 센다.
const LAST_PROJECT_END = 2026 * 12 + 8;
const monthDate = (month) =>
  `${Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}-01`;

const projectHistory = ({ personId, number, role, grade, skills }) => {
  const career = CAREERS[grade];
  // 등급이 number % 4 로 정해지므로 건수·시작 달·PL 여부는 number / 4 로 갈라야 등급 안에서도 섞인다.
  const cohort = Math.floor(number / 4);
  const count = career.minCount + (cohort % (career.maxCount - career.minCount + 1));
  const first = career.from * 12 + ((cohort * 5) % career.spread);
  const last = LAST_PROJECT_END - (number % 3);
  const durations = Array.from(
    { length: count },
    (_, index) =>
      career.minMonths + ((number * 7 + index * 13) % (career.maxMonths - career.minMonths + 1)),
  );
  // 첫 프로젝트는 first 에 시작하고 마지막은 last 에 끝난다. 남는 달을 사이 간격(1개월 이상)으로 나눠 기간이 겹치지 않는다.
  const weights = durations.slice(1).map((_, index) => 2 + ((number + index) % 2));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const spare = last - first - durations.reduce((sum, months) => sum + months, 0) - weights.length;
  const starts = durations
    .slice(0, -1)
    .reduce(
      (acc, months, index) => [
        ...acc,
        acc[index] + months + 1 + Math.floor((spare * weights[index]) / totalWeight),
      ],
      [first],
    );
  const templates = ROLE_PROJECTS[role];
  // 고급은 절반이 최근 1건을, 특급은 최근 2건을 PL·PM 으로 맡는다. PM·PL 직무는 늘 본인 직무다.
  const leads =
    role === "PM" || role === "PL"
      ? 0
      : grade === "특급"
        ? 2
        : grade === "고급"
          ? 1 - (cohort % 2)
          : 0;
  return durations.map((months, index) => {
    const recent = index === count - 1;
    const startsAt = recent ? last - months : starts[index];
    const endsAt = startsAt + months;
    const project = PROJECTS[templates[(number + index) % templates.length]];
    const clients = CLIENTS.filter((client) => project.kinds.includes(client.kind));
    const client = clients[(number * 3 + index * 7) % clients.length];
    const offset = (number + index) % skills.length;
    const size = Math.min(skills.length, 2 + ((number + index) % 2));
    return {
      projectId: `SYN-${personId}-${index + 1}`,
      name: `${client.prefix ?? client.client} ${project.title}`,
      client: client.client,
      domain: project.domain,
      role:
        index < count - leads ? role : recent && grade === "특급" && number % 3 === 0 ? "PM" : "PL",
      startsAt: monthDate(startsAt),
      endsAt: monthDate(endsAt),
      skills: skills.filter(
        (_, position) => (position - offset + skills.length) % skills.length < size,
      ),
      isDemo: true,
      evidenceRef: `synthetic:${personId}:project:${index + 1}`,
    };
  });
};

export function generateCapabilities(personId) {
  if (!/^SOL-P(0[0-1]\d\d|0200)$/.test(personId) || personId === "SOL-P0000")
    throw new Error("Unknown synthetic person ID");
  const number = Number(personId.slice(5));
  const legacyRole = legacy.get(number);
  const profile = legacyRole
    ? PROFILES.find((item) => item.role === legacyRole)
    : PROFILES[(number * 7) % PROFILES.length];
  const skills =
    legacyRole === "DEVELOPER"
      ? ["TypeScript", "Java"]
      : legacyRole === "DATA_AI"
        ? ["Python", "SQL"]
        : legacyRole
          ? ["프로젝트 관리"]
          : [...profile.skills];
  const availability = legacyRole
    ? [{ startsAt: "2026-12-01", endsAt: "2027-07-01", fte: 1 }]
    : [
        { startsAt: "2026-10-01", endsAt: "2027-04-01", fte: ((number % 4) + 1) / 4 },
        { startsAt: "2027-04-01", endsAt: "2028-01-01", fte: (((number + 1) % 4) + 1) / 4 },
      ];
  const grade = legacyRole
    ? legacyRole === "DEVELOPER"
      ? "중급"
      : "고급"
    : ["초급", "중급", "고급", "특급"][number % 4];
  return {
    scoringEligible: true,
    role: profile.role,
    grade,
    skills,
    availability,
    certifications: [
      {
        code: profile.certificate[0],
        name: profile.certificate[1],
        issuedAt: `202${2 + (number % 3)}-03-01`,
        expiresAt: "2028-03-01",
        isDemo: true,
        evidenceRef: `synthetic:${personId}:certificate:1`,
      },
    ],
    pastProjects: projectHistory({ personId, number, role: profile.role, grade, skills }),
    capabilitySource: "SYNTHETIC",
    capabilityVersion: CAPABILITY_VERSION,
  };
}

export const enrichPeople = (people) =>
  people.map((person) => {
    if (person.isDemo !== true) throw new Error("Synthetic capabilities require demo people");
    return { ...person, ...generateCapabilities(person.personId) };
  });
