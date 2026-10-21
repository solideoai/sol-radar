// These profiles describe synthetic people only; approved identity and portrait data never enter generation.
export const CAPABILITY_VERSION = "synthetic-people/v1";
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
  return {
    scoringEligible: true,
    role: profile.role,
    grade: legacyRole
      ? legacyRole === "DEVELOPER"
        ? "중급"
        : "고급"
      : ["초급", "중급", "고급", "특급"][number % 4],
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
    pastProjects: Array.from({ length: 1 + (number % 3) }, (_, index) => ({
      projectId: `SYN-${personId}-${index + 1}`,
      name: `가상 ${["행정정보", "데이터 플랫폼", "통합 민원", "AI 업무지원"][(number + index) % 4]} 프로젝트 ${index + 1}`,
      domain: ["행정", "데이터", "민원", "AI"][(number + index) % 4],
      role: profile.role,
      startsAt: `202${2 + index}-01-01`,
      endsAt: `202${2 + index}-12-01`,
      skills: [...skills],
      isDemo: true,
      evidenceRef: `synthetic:${personId}:project:${index + 1}`,
    })),
    capabilitySource: "SYNTHETIC",
    capabilityVersion: CAPABILITY_VERSION,
  };
}

export const enrichPeople = (people) =>
  people.map((person) => {
    if (person.isDemo !== true) throw new Error("Synthetic capabilities require demo people");
    return { ...person, ...generateCapabilities(person.personId) };
  });
