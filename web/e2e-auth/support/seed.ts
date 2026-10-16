import path from "node:path";

// 시드(scripts/db-seed.mjs)가 만드는 계정과 팀. 웹 코드는 부모 경로(../)를 가져오지 못해(eslint) 값을 여기에 옮겨 적는다.
// 시드를 바꾸면 이 파일과, 시드 수치를 단언하는 시험(dashboard·tasks-view·admin)을 같이 고친다.

// 로컬 Supabase 에서만 쓰는 시험용 비밀번호다. 시드가 출력하는 값과 같다.
export const SEED_PASSWORD = "seed-password-1234";

export const SEED_ACCOUNTS = {
  owner: { email: "seed-owner@example.test", name: "김소유" },
  member: { email: "seed-member@example.test", name: "이멤버" },
  outsider: { email: "seed-outsider@example.test", name: "박외부" },
  invitee: { email: "seed-invitee@example.test", name: "최초대" },
  // 서비스 운영자(profiles.is_admin). 어느 팀에도 속하지 않는다.
  admin: { email: "seed-admin@example.test", name: "정운영" },
} as const;

export type SeedRole = keyof typeof SEED_ACCOUNTS;

// 시드가 계정을 만드는 순서다(가입 시각이 이 순서로 늦어진다).
export const SEED_ROLES: readonly SeedRole[] = ["owner", "member", "outsider", "invitee", "admin"];

export const SEED_TEAM = { name: "시드 팀", slug: "seed-team" } as const;

// 개인 조직의 이름. 가입 트리거(create_personal_org)가 붙인다.
export const PERSONAL_ORG_NAME = "개인 공간";

// 역할마다 로그인 상태를 저장하는 파일. auth.setup.ts 가 쓰고, 시험은 test.use({ storageState }) 로 읽는다. 깃에서 뺀다.
export const authFileOf = (role: SeedRole): string =>
  path.join(__dirname, "..", ".auth", `${role}.json`);

const seoulDateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });

// 오늘(서울)에서 offset 일 떨어진 날. iso 는 "YYYY-MM-DD", label 은 화면의 월·일 표기("10. 21.")다.
// 시드는 날짜를 "오늘에서 며칠"로 적는다. 시드를 넣은 뒤 서울 자정을 넘기면 수치가 하루씩 밀린다.
export const seoulDay = (offset: number, now = new Date()): { iso: string; label: string } => {
  const [year, month, day] = seoulDateFormat.format(now).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return {
    iso: date.toISOString().slice(0, 10),
    label: `${date.getUTCMonth() + 1}. ${date.getUTCDate()}.`,
  };
};

// 실행마다 겹치지 않는 꼬리표. 시험이 만든 작업·팀의 이름에 붙여 병렬로 돌거나 다시 돌려도 서로 섞이지 않게 한다.
export const uniqueTag = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// 정규식에 글자 그대로 넣는다.
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
