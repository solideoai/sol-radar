// 로컬 Supabase 의 주소·키를 웹 env 파일에 옮기는 규칙. db-local.mjs 가 부른다.
//
// 순수 함수만 둔다. supabase CLI 를 부르고 파일을 읽고 쓰는 일은 db-local.mjs 가 한다.
// 옮기는 값은 주소와 anon 키 둘뿐이다. `supabase status` 가 함께 내는 service_role·secret 키와
// JWT secret 은 RLS 를 무시하고, DB 주소는 DB 를 통째로 연다. 그래서 어떤 결과에도 싣지 않는다.
// 웹에는 초대 메일을 로컬 메일함으로 보내는 SMTP 값도 적는다(3-2절). 비밀이 아니고, 비어 있을 때만 적는다.

// ── 1. supabase status -o env 읽기 ─────────────────────────────

// KEY=값 꼴의 줄만 읽는다. 첫 = 에서만 잘라서 값 안의 = 는 값으로 남는다.
const STATUS_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

const unquote = (value) =>
  value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]
    ? value.slice(1, -1)
    : value;

// `supabase status -o env` 출력 → { API_URL: "...", ANON_KEY: "...", ... }
export const parseStatusEnv = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => STATUS_LINE.exec(line))
      .filter(Boolean)
      .map(([, key, value]) => [key, unquote(value)]),
  );

// ── 2. 주소 가르기 ─────────────────────────────────────────────

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const ipv4Octets = (host) => {
  const octets = IPV4.exec(host)?.slice(1).map(Number) ?? null;
  return octets?.every((octet) => octet <= 255) ? octets : null;
};

const hostnameOf = (value) => {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
};

const isLoopbackHost = (host) =>
  host === "localhost" || host === "[::1]" || ipv4Octets(host)?.[0] === 127;

// 같은 와이파이 안에서만 닿는 사설 대역(10/8 · 172.16/12 · 192.168/16). 클라우드 주소가 아니므로 로컬로 본다.
const isPrivateHost = (host) => {
  const [first, second] = ipv4Octets(host) ?? [];
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
};

// 이 컴퓨터나 같은 네트워크를 가리키는 주소인가. 클라우드 주소·빈 값·URL 이 아닌 값은 false.
export const isLocalUrl = (value) => {
  const host = typeof value === "string" && value !== "" ? hostnameOf(value) : null;
  return host !== null && (isLoopbackHost(host) || isPrivateHost(host));
};

// ── 3. 무엇을 어디에 적나 ──────────────────────────────────────

// status → { web: [[이름, 값], ...] }. 웹 env 파일에 적을 두 값.
// 키는 anon 키(옛 JWT 형식)를 먼저, 없으면 새 형식 publishable 키를 쓴다. 둘 다 화면용 공개 키다.
export const localEnvUpdates = (status) => {
  const apiUrl = status.API_URL;
  const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY;
  if (!apiUrl)
    throw new Error(
      "supabase status 출력에 API_URL 이 없습니다. `supabase status` 로 API 가 켜져 있는지 확인하세요.",
    );
  if (!anonKey)
    throw new Error(
      "supabase status 출력에 ANON_KEY·PUBLISHABLE_KEY 가 없습니다. `supabase status` 로 auth 가 켜져 있는지 확인하세요.",
    );
  return {
    web: [
      ["NEXT_PUBLIC_SUPABASE_URL", apiUrl],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey],
    ],
  };
};

// ── 3-2. 초대 메일을 로컬 메일함으로 ───────────────────────────
//
// 웹의 초대 메일(web/server/organization)은 SMTP 설정이 있을 때만 나간다. 로컬에서는 Supabase 의 메일함(Mailpit)이
// SMTP 를 받아 실제로 내보내지 않고 쌓아 둔다(http://127.0.0.1:54324). 그 SMTP 포트와 웹 주소는
// supabase/config.toml 이 정본이라 거기서 읽는다(status 출력에는 SMTP 포트가 없다).
// 이 값들은 비밀이 아니다. 로컬 메일함은 인증이 없어 SMTP_USER·SMTP_PASSWORD 는 적지 않는다.

// 웹 env 에서 메일 설정으로 보는 이름. web/.env.example 의 메일 절과 같다.
const MAIL_ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "MAIL_FROM",
  "SITE_URL",
];

const LOCAL_MAIL_FROM = "no-reply@example.com";

// "표.키" → 값. 한 줄짜리 문자열("…"·'…')·정수 값만 읽는다. config.toml 에서 필요한 두 값이 이 모양이다.
const TOML_TABLE = /^\s*\[([A-Za-z0-9_.-]+)\]\s*(?:#.*)?$/;
const TOML_PAIR = /^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\d+))\s*(?:#.*)?$/;

const tomlValues = (text) => {
  const values = new Map();
  let table = "";
  for (const line of (text ?? "").split(/\r?\n/)) {
    const header = TOML_TABLE.exec(line);
    if (header) {
      table = header[1];
      continue;
    }
    const pair = TOML_PAIR.exec(line);
    if (pair) values.set(`${table}.${pair[1]}`, pair[2] ?? pair[3] ?? pair[4]);
  }
  return values;
};

// supabase/config.toml → { smtpPort, siteUrl }. 메일함 SMTP 포트를 열지 않았거나 웹 주소가 없으면 null.
// 메일함 설정 표의 이름은 CLI 2.120 의 [local_smtp] 이고, 옛 이름 [inbucket] 도 읽는다.
export const localMailSettings = (configToml) => {
  const values = tomlValues(configToml);
  const smtpPort = values.get("local_smtp.smtp_port") ?? values.get("inbucket.smtp_port");
  const siteUrl = values.get("auth.site_url");
  return smtpPort && siteUrl ? { smtpPort, siteUrl } : null;
};

// status·설정 → 웹 env 에 적을 메일 값 [[이름, 값], ...]. 메일함 주소나 설정을 모르면 빈 목록(메일 없이 동작한다).
export const localMailUpdates = (status, settings) => {
  const mailbox = status.MAILPIT_URL || status.INBUCKET_URL;
  const host = mailbox ? hostnameOf(mailbox) : null;
  if (!settings || !host) return [];
  return [
    ["SMTP_HOST", host],
    ["SMTP_PORT", settings.smtpPort],
    ["MAIL_FROM", LOCAL_MAIL_FROM],
    ["SITE_URL", settings.siteUrl],
  ];
};

// ── 4. env 파일 고치기 ─────────────────────────────────────────

// 주석이 아닌 KEY= · export KEY= 줄. # 으로 시작하는 줄(꺼 둔 값)은 걸리지 않아 그대로 남는다.
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

const keyOf = (line) => ASSIGNMENT.exec(line)?.[1] ?? null;

// dotenv 처럼 읽는다: 따옴표로 감쌌으면 그 안, 아니면 # 앞까지.
const valueOf = (line) => {
  const raw = line.slice(line.indexOf("=") + 1).trim();
  const quoted = /^(["'])(.*?)\1/.exec(raw);
  return quoted ? quoted[2] : raw.split("#")[0].trim();
};

const withoutTrailingBlank = (lines) =>
  lines.slice(0, lines.findLastIndex((line) => line.trim() !== "") + 1);

// 값에 줄바꿈이 섞이면 다음 줄이 새 변수로 읽힌다. 적기 전에 막는다.
const assertSingleLine = ([key, value]) => {
  if (/[\r\n]/.test(value))
    throw new Error(`${key} 값에 줄바꿈이 있어 env 파일에 적을 수 없습니다`);
};

// updates([[이름, 값], ...])의 키를 가진 줄을 전부 이름=값 으로 바꾸고, 없던 키는 끝에 붙인다.
// 다른 줄·주석·줄바꿈 방식(CRLF)은 그대로 두고, 끝 줄바꿈만 하나로 맞춘다. 두 번 돌려도 같다.
export const mergeEnv = (text, updates) => {
  updates.forEach(assertSingleLine);
  const source = text ?? "";
  const values = new Map(updates);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = withoutTrailingBlank(source.split(/\r?\n/)).map((line) => {
    const key = keyOf(line);
    return key !== null && values.has(key) ? `${key}=${values.get(key)}` : line;
  });
  const present = new Set(lines.map(keyOf));
  const added = [...values]
    .filter(([key]) => !present.has(key))
    .map(([key, value]) => `${key}=${value}`);
  const result = [...lines, ...added];
  return result.length > 0 ? `${result.join(eol)}${eol}` : "";
};

// 메일 값은 비어 있을 때만 적는다. 메일 설정 이름 가운데 하나라도 값이 있으면(손으로 진짜 SMTP 를 적어 둔 경우 등)
// 아무것도 적지 않는다 — .env* 는 깃 밖이라 덮으면 되돌릴 수 없다. text 는 지금 파일(없으면 .env.example) 내용이다.
export const unsetMailUpdates = (text, updates) => {
  const configured = (text ?? "")
    .split(/\r?\n/)
    .some((line) => MAIL_ENV_KEYS.includes(keyOf(line)) && valueOf(line) !== "");
  return configured ? [] : updates;
};

// env 파일 하나를 어떻게 할지 정한다. existing 은 지금 파일 내용(없으면 null), example 은 .env.example 내용.
//   { action: "skip", reason } — urlKey 에 로컬이 아닌 주소(클라우드)가 있다. .env* 는 깃 밖이라
//                                 덮으면 되돌릴 수 없으므로 손대지 않는다.
//   { action: "unchanged" }    — 이미 같은 값이다.
//   { action: "write", text }  — text 로 쓴다. 파일이 없으면 .env.example 을 바탕으로 만든다.
export const planEnvFile = ({ existing, example, updates, urlKey }) => {
  const hasFile = existing !== null && existing !== undefined;
  const isCloud =
    hasFile &&
    existing
      .split(/\r?\n/)
      .filter((line) => keyOf(line) === urlKey)
      .map(valueOf)
      .some((value) => value !== "" && !isLocalUrl(value));
  if (isCloud)
    return {
      action: "skip",
      reason: `${urlKey} 에 로컬이 아닌 주소(클라우드 프로젝트)가 적혀 있습니다`,
    };
  const text = mergeEnv(hasFile ? existing : (example ?? ""), updates);
  return hasFile && text === existing ? { action: "unchanged" } : { action: "write", text };
};

// ── 5. 명령 인자 ───────────────────────────────────────────────

const COMMANDS = ["start", "stop"];

// db-local.mjs 의 인자 → { command: "start" | "stop" }. 명령 뒤의 인자는 받지 않는다.
// pnpm 9 는 `pnpm db:start -- …` 의 -- 를 그대로 넘긴다. npm 습관으로 붙여도 되게 건너뛴다.
export const parseDbLocalArgs = (argv) => {
  const [command, ...options] = argv.filter((arg) => arg !== "--");
  if (!COMMANDS.includes(command))
    throw new Error(command ? `모르는 명령입니다: ${command}` : "명령(start·stop)을 적으세요");
  if (options.length > 0) throw new Error(`모르는 인자입니다: ${options[0]}`);
  return { command };
};
