#!/usr/bin/env node
// db-local.mjs — 클라우드 계정 없이 로컬 Supabase(Docker + Supabase CLI)를 켜고 끈다.
//
//   pnpm db:start              켜고, 마이그레이션을 적용하고, 웹 env 파일에 주소·anon 키를 적는다
//   pnpm db:stop               끈다. 데이터는 Docker 볼륨에 남는다
//
// start 는 처음 켤 때만 마이그레이션을 적용한다. 이미 켜진 DB 에 새 마이그레이션 파일이 생겼으면
// start 는 아무것도 하지 않으므로 migration up 으로 따라잡는다. 이력 표는 db-push.mjs 와 같은
// supabase_migrations.schema_migrations 다. DB 를 비우는 명령은 쓰지 않는다.
//
// 적는 곳은 web/.env.local 의 Supabase 두 값과, 웹의 초대 메일을 로컬 메일함으로 보내는 값
// (SMTP_HOST·SMTP_PORT·MAIL_FROM·SITE_URL, 메일 설정이 비어 있을 때만)이다. 루트 .env.local 은 건드리지 않는다 —
// db:push·db:verify 는 TLS 인증서를 검사해서 로컬 DB 에 붙지 않는다(둘은 늘 클라우드용이다).
// 무엇을 적을지는 local-env.mjs 의 순수 함수가 정한다. 키 값은 화면에 찍지 않는다.
import { spawnCommandSync } from "./command.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  localEnvUpdates,
  localMailSettings,
  localMailUpdates,
  parseDbLocalArgs,
  parseStatusEnv,
  planEnvFile,
  unsetMailUpdates,
} from "./local-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `사용법:
  pnpm db:start              로컬 Supabase 를 켜고 웹 env 파일에 주소·anon 키를 적습니다
  pnpm db:stop               로컬 Supabase 를 끕니다 (데이터는 남습니다)`;

const INSTALL_GUIDE = `❌ Supabase CLI 가 없습니다. 로컬 Supabase 는 Supabase CLI 와 Docker Desktop 으로 돕니다.
   1. Docker Desktop 을 설치하고 켭니다: https://www.docker.com/products/docker-desktop/
   2. Supabase CLI 를 설치합니다:
        macOS    brew install supabase/tap/supabase
        Windows  scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
                 scoop install supabase
        Linux    https://supabase.com/docs/guides/local-development/cli/getting-started
   3. 다시 실행합니다: pnpm db:start`;

// web/ 에 package.json 이 없으면 env 파일을 만들지 않는다.
const TARGETS = [
  {
    name: "web",
    label: "웹",
    file: "web/.env.local",
    example: "web/.env.example",
    urlKey: "NEXT_PUBLIC_SUPABASE_URL",
  },
];

// 셸을 거치지 않고 인자 배열 그대로 넘긴다. 기본은 CLI 의 출력을 그대로 보여 준다.
const supabase = (args, options = {}) =>
  spawnCommandSync("supabase", args, { cwd: root, stdio: "inherit", ...options });

const readText = (relativePath) => {
  const path = join(root, relativePath);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

const hasCli = () => {
  const result = supabase(["--version"], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  if (result.error?.code === "ENOENT") {
    console.error(INSTALL_GUIDE);
    return false;
  }
  if (result.error || result.status !== 0) {
    console.error(
      `❌ supabase CLI 를 실행하지 못했습니다: ${result.error?.message ?? result.stderr}`,
    );
    return false;
  }
  return true;
};

// ── env 파일 ─────────────────────────────────────────────────

const ACTION_LABEL = { write: "적음", unchanged: "그대로" };

const printSummary = (plans) => {
  plans
    .filter((plan) => plan.action !== "skip")
    .forEach((plan) =>
      console.log(
        `  ${plan.label}  ${plan.file} ${plan.isNew ? "만듦" : ACTION_LABEL[plan.action]} — ${plan.url} · anon 키 기록`,
      ),
    );
};

const printMail = (plans, mailUpdates) => {
  if (!plans.some((plan) => plan.wroteMail)) return;
  const values = new Map(mailUpdates);
  console.log(
    `  메일  web/.env.local 에 로컬 메일함 SMTP(${values.get("SMTP_HOST")}:${values.get("SMTP_PORT")})·사이트 주소(${values.get("SITE_URL")}) 기록 — 초대 메일이 메일함으로 옵니다`,
  );
};

const printLinks = (status) => {
  const mailbox = status.MAILPIT_URL || status.INBUCKET_URL;
  if (status.STUDIO_URL) console.log(`  Studio  ${status.STUDIO_URL}  (표·데이터를 보는 화면)`);
  if (mailbox)
    console.log(
      `  메일함  ${mailbox}  (매직 링크·비밀번호 재설정 메일이 실제로 나가지 않고 여기로 옵니다)`,
    );
};

const printSkipped = (skipped) => {
  console.error(
    "❌ 다음 파일에는 클라우드 값이 있어 건드리지 않았습니다 (.env* 는 깃 밖이라 덮으면 되돌릴 수 없습니다):",
  );
  skipped.forEach((plan) => console.error(`   ${plan.file} — ${plan.reason}`));
  console.error(
    "   로컬로 바꾸려면 그 파일을 같은 폴더의 .env.cloud.local 로 옮긴 뒤 다시 실행하세요.",
  );
  skipped.forEach((plan) =>
    console.error(`     mv ${plan.file} ${join(dirname(plan.file), ".env.cloud.local")}`),
  );
  console.error("   .env.cloud.local 은 웹이 읽지 않는 이름이라 클라우드 값을 보관만 해 둡니다.");
};

// ── 명령 ─────────────────────────────────────────────────────

const start = () => {
  console.log("▶ 로컬 Supabase 시작 (처음에는 Docker 이미지를 받느라 몇 분 걸립니다)");
  if (supabase(["start"]).status !== 0) {
    console.error(
      "❌ 로컬 Supabase 를 켜지 못했습니다. Docker Desktop 이 켜져 있는지 확인하고 다시 실행하세요.",
    );
    return 1;
  }

  console.log("▶ 마이그레이션 적용 (supabase/migrations 중 아직 적용하지 않은 것만)");
  if (supabase(["migration", "up", "--local"]).status !== 0) {
    console.error(
      "❌ 마이그레이션을 적용하지 못했습니다. 이미 적용된 마이그레이션은 고칠 수 없습니다 — 고칠 내용은 supabase/migrations 에 새 마이그레이션 파일로 적고 다시 실행하세요.",
    );
    return 1;
  }

  // 출력에는 service_role·secret 키도 들어 있다. 화면에 흘리지 않고 받아서 필요한 값(주소·anon 키·메일함 주소)만 꺼낸다.
  const statusRun = supabase(["status", "-o", "env"], {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  if (statusRun.status !== 0) {
    console.error("❌ 로컬 Supabase 상태(supabase status)를 읽지 못했습니다.");
    return 1;
  }
  const status = parseStatusEnv(statusRun.stdout);

  const targets = TARGETS.filter((target) => existsSync(join(root, target.name, "package.json")));
  const updates = localEnvUpdates(status);
  // SMTP 포트·웹 주소의 정본은 supabase/config.toml 이다. 메일함 SMTP 를 열지 않았으면 빈 목록이다.
  const mailUpdates = localMailUpdates(status, localMailSettings(readText("supabase/config.toml")));

  const plans = targets.map((target) => {
    const existing = readText(target.file);
    const example = readText(target.example);
    const mail = target.name === "web" ? unsetMailUpdates(existing ?? example, mailUpdates) : [];
    const plan = planEnvFile({
      existing,
      example,
      updates: [...updates[target.name], ...mail],
      urlKey: target.urlKey,
    });
    const url = new Map(updates[target.name]).get(target.urlKey);
    const wroteMail = mail.length > 0 && plan.action === "write";
    return { ...target, ...plan, url, isNew: existing === null, wroteMail };
  });
  plans
    .filter((plan) => plan.action === "write")
    .forEach((plan) => writeFileSync(join(root, plan.file), plan.text, "utf8"));

  console.log("✓ 로컬 Supabase 가 켜졌습니다");
  if (targets.length === 0) console.log("  web/ 이 없어 env 파일은 적지 않았습니다");
  printSummary(plans);
  printMail(plans, mailUpdates);
  printLinks(status);
  if (plans.some((plan) => plan.action === "write"))
    console.log("  env 파일이 바뀌었습니다. 켜 둔 개발 서버를 다시 시작하세요: pnpm -C web dev");

  const skipped = plans.filter((plan) => plan.action === "skip");
  if (skipped.length === 0) return 0;
  printSkipped(skipped);
  return 1;
};

// --no-backup 은 붙이지 않는다. 붙이면 Docker 볼륨(로컬 DB 의 데이터)까지 지운다.
const stop = () => {
  if (supabase(["stop"]).status !== 0) {
    console.error("❌ 로컬 Supabase 를 끄지 못했습니다. Docker Desktop 이 켜져 있는지 확인하세요.");
    return 1;
  }
  console.log("✓ 로컬 Supabase 를 껐습니다. 데이터는 남아 있고 pnpm db:start 로 다시 켭니다.");
  return 0;
};

const parseArgs = (argv) => {
  try {
    return parseDbLocalArgs(argv);
  } catch (error) {
    console.error(`❌ ${error.message}\n\n${USAGE}`);
    return null;
  }
};

const run = (argv) => {
  const args = parseArgs(argv);
  if (!args) return 2;
  if (!hasCli()) return 1;
  return args.command === "start" ? start() : stop();
};

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
}
