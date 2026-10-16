#!/bin/bash
# PreToolUse 가드 — 실행·편집 직전에 위험한 일을 막는다.
#
# 설정(settings.json permissions)은 '이름'으로만 막는다. "이런 조건일 때만"처럼 판단이
# 필요한 규칙은 훅으로 막는다. 여기서는 '이력을 안 남기고 DB를 파괴적으로 바꾸는 명령'과
# '비밀 키가 코드·문서에 박히는 것'을 막는다.
#
# 명령(Bash)과 파일 편집(Write/Edit/MultiEdit/NotebookEdit)을 둘 다 본다.
# 사고는 대부분 편집 쪽으로 난다. 명령만 보면 화면 코드에 키를 적는 길이 열려 있다.
#
# 차단하려면 stdout 에 permissionDecision=deny 를 JSON 으로 내고 exit 0 으로 끝낸다.
# (훅 계약: 구조화된 결정과 이유는 exit 0 에서만 파싱된다.)
# 이유를 적어 두면 클로드가 읽고 정식 경로로 다시 시도한다.
#
# 판정은 아래 node 한 프로세스가 전부 한다. grep·sed 를 줄마다 띄우면 Windows Git Bash 에서
# 프로세스 하나에 0.3초씩 걸려 호출 한 번이 10초를 넘는다. 이 훅은 도구 호출마다 돈다.

# node 가 없으면 판정할 수 없다. 게이트가 조용히 뚫리면 안 되므로 막는다.
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"가드(.claude/hooks/guard.sh)를 돌릴 node 가 없습니다. Node 를 설치한 뒤 다시 실행하세요."}}'
  exit 0
fi

IFS= read -r -d '' js <<'JS' || true
const R = (source, flags) => new RegExp(source, flags);
// grep 처럼 줄 단위로 본다. 통째로 보면 \s 와 [^…] 가 줄바꿈을 넘어 다음 줄까지 한 값으로 읽는다.
const any = (text, re) => text.split("\n").some((line) => re.test(line));

// .env 실파일인가. 파일 이름(경로의 마지막 마디) 자체가 .env 또는 .env.<무엇> 이고 .example 로
// 끝나지 않을 때만이다. 이름 중간에 .env 가 든 코드 파일(config.env.ts, secrets.env)은 아니다.
// scripts/check-policy.mjs 의 env 파일 판정과 같은 규칙이다. 한쪽을 바꾸면 다른 쪽도 바꾼다.
// 여기서 .env 로 보는데 그쪽이 아니라고 보면, 비밀 검사를 건너뛴 파일이 그대로 커밋된다.
const isEnvFile = (file) => {
  const name = file.slice(file.lastIndexOf("/") + 1);
  return !name.endsWith(".example") && (name === ".env" || name.startsWith(".env."));
};

// 막을 이유를 돌려준다. 통과면 null.
function decide(input) {
  const t = JSON.parse(input).tool_input ?? {};
  const cmd = String(t.command ?? "");
  // 편집 도구마다 내용이 실리는 자리가 다르다. 전부 모아 문자열 하나로 만든다.
  const payload = [t.content, t.new_string, t.new_source, ...(t.edits ?? []).map((e) => e?.new_string)]
    .filter((v) => v != null)
    .join("\n");
  const path = String(t.file_path ?? t.notebook_path ?? "");

  // 명령 규칙은 '실행되는 것'만 본다. 따옴표 안은 실행이 아니라 인자다
  // (`grep "HUSKY=0"`, 커밋 메시지 속 "-n"). 따옴표 덩어리를 Q 로 바꾼 뒤 ; & | 괄호·줄바꿈으로
  // 잘라 한 줄에 실행 단위 하나씩 둔다. 아래 규칙은 줄의 맨 앞(변수 대입 뒤)이 무엇인지로 가른다.
  const unquoted = cmd.replace(/"(?:\\.|[^"\\])*"/gs, "Q").replace(/'[^']*'/g, "Q");
  const segments = unquoted.replace(/[;&|(){}`]/g, "\n");

  // 줄 맨 앞의 `env`·`export`·`FOO=bar` 를 건너뛴 자리. 그 뒤에 오는 것이 실제로 실행되는 명령이다.
  const PRE = String.raw`^\s*((env|export|command)\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*`;
  // git 과 서브명령 사이의 전역 옵션(-C 경로, -c 키=값, --no-pager 등)
  const GIT = String.raw`${PRE}git(\s+-[cC]\s+\S+|\s+--[A-Za-z-]+(=\S*)?)*\s+`;

  // 커밋 게이트 우회는 일반 세션에서도 허용하지 않는다.
  // 막는 길: --no-verify(접두 축약 포함)·커밋의 -n, HUSKY 변수, core.hooksPath 바꾸기·지우기.
  if (
    any(segments, R(String.raw`${PRE}HUSKY=`)) ||
    any(segments, R(String.raw`${GIT}(commit|merge)(\s+\S+)*\s+--no-veri[a-z]*(\s|$)`)) ||
    any(segments, R(String.raw`${GIT}commit(\s+\S+)*\s+-[A-Za-z]*n[A-Za-z]*(\s|$)`)) ||
    any(segments, R(String.raw`${PRE}git\s.*-c\s*core\.hookspath=`, "i")) ||
    (any(segments, R(String.raw`${PRE}git\s`)) && any(cmd, /-c\s+["']core\.hookspath=/i)) ||
    segments
      .split("\n")
      .filter((line) => R(String.raw`${GIT}config\s.*core\.hookspath`, "i").test(line))
      .some((line) => /(--unset|\sunset\s|core\.hookspath\s+[^\s-])/i.test(line))
  ) {
    return "커밋 게이트를 우회할 수 없습니다. 실패 원인을 고친 뒤 다시 실행하세요.";
  }

  // 1) supabase db reset: DB 전체를 날린다. 우리 흐름엔 정당한 용도가 없다.
  if (any(segments, /(^|[\s/])supabase\s+db\s+reset/)) {
    return "이력 없이 DB를 초기화합니다. 스키마 변경은 supabase/migrations/ 새 파일 + pnpm db:push 로 하세요.";
  }

  // 2) 마이그레이션 밖 파괴적 SQL. 이력이 안 남는다.
  //    SQL 은 따옴표 안에 오므로 원래 명령에서 찾고, DB 에 붙는지는 psql 실행이나
  //    SUPABASE_DB_URL 값을 펼치는지로 본다. 문서를 grep 하는 것은 걸리지 않는다.
  if (
    any(cmd, /(drop\s+(table|schema|database)|truncate\s)/i) &&
    (any(segments, R(String.raw`${PRE}(\S*/)?psql(\s|$)`)) ||
      any(cmd, /\$\{?SUPABASE_DB_URL|process\.env\.SUPABASE_DB_URL/))
  ) {
    return "이력 없는 파괴적 DB 변경입니다. supabase/migrations/ 새 파일로 남기고 pnpm db:push 로 적용하세요.";
  }

  // Supabase service_role 키(JWT)의 생김새. 가운데 마디에 "role":"service_role" 이 base64 로
  // 들어가서 'service_role' 글자는 보이지 않는다. 정렬이 셋이라 조각도 셋이다. anon 키는 이 조각에
  // 걸리지 않는다. 3번(공개 변수)과 4번(파일) 규칙이 함께 쓴다.
  const SERVICE_ROLE_JWT = String.raw`eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*(c2VydmljZV9yb2x|NlcnZpY2Vfcm9s|zZXJ2aWNlX3Jvb)`;

  // 3) 비밀 키를 공개 변수에 넣기. 앱·브라우저 번들에 그대로 박혀 누구나 꺼내 본다.
  //
  // 두 갈래로 본다. 변수 '이름'이 비밀을 말하는 경우(..._SECRET_KEY)와, 값이 비밀 키의
  // 생김새인 경우(service_role 이름이나 JWT, Supabase sb_secret_, 결제사의 sk_ 계열, 웹훅 서명 whsec_)다.
  // 공개가 정상인 것들(ANON_KEY 와 anon JWT, 결제사의 ck_/pk_ 계열, URL)은 어느 쪽에도 안 걸린다.
  //
  // 편집으로 .env 실파일에 적는 것도 본다. 그 자리는 아래 비밀 검사(4번부터)에서 통째로 빠지므로
  // 공개 변수에 비밀을 넣는 사고는 여기서만 잡힌다. 문서·코드 편집은 4번부터가 값의 생김새로 본다.
  //
  // 명령 한 줄 안에 글자 그대로 적힌 \n 은 줄바꿈으로 바꿔 놓고 본다. printf·echo -e 는 이것을 줄바꿈으로
  // 쓴다. 그대로 두면 값 범위가 다음 줄의 서버 전용 비밀까지 공개 변수의 값으로 읽는다. 편집 내용은
  // 줄바꿈이 이미 진짜이고, 거기 남은 \n 은 같은 값의 일부(따옴표 값이면 env 로더가 줄바꿈으로 펼친다)이므로 그대로 둔다.
  let publicTarget = cmd.replaceAll("\\n", "\n");
  if (isEnvFile(path)) publicTarget = `${payload}\n${publicTarget}`;

  // 이름과 값 사이. Next·Expo 의 env 로더는 = 앞뒤의 공백을 걷어 내고 읽고, Next 는 `이름: 값` 도 읽는다.
  // 붙여 쓴 `이름=값` 만 보면 `NEXT_PUBLIC_X = <키>` 가 그대로 공개 변수가 된다.
  const ASSIGN = String.raw`(\s*=|:\s)\s*`;

  if (
    any(
      publicTarget,
      R(
        String.raw`(NEXT_PUBLIC|EXPO_PUBLIC)[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|PASSWD|PASSWORD)[A-Z0-9_]*${ASSIGN}`,
      ),
    )
  ) {
    return "비밀 키를 공개 변수(NEXT_PUBLIC_/EXPO_PUBLIC_)에 넣고 있습니다. 이 접두어가 붙은 값은 브라우저·앱 번들에 그대로 박혀 누구나 꺼내 봅니다. 시크릿 키는 접두어 없는 이름으로 .env 에만 두고 서버에서만 읽으세요. 화면에 두는 것은 클라이언트 키(결제사의 ck_/pk_ 계열)와 anon 키뿐입니다.";
  }

  if (
    any(
      publicTarget,
      R(
        String.raw`(NEXT_PUBLIC|EXPO_PUBLIC)[A-Z0-9_]*${ASSIGN}\S*(service_role|SERVICE_ROLE|sk_test|sk_live|test_sk_|live_sk_|whsec_|sb_secret_|${SERVICE_ROLE_JWT})`,
      ),
    )
  ) {
    return "공개 변수(NEXT_PUBLIC_/EXPO_PUBLIC_)에 넣는 값이 비밀 키의 생김새입니다(service_role 키, Supabase sb_secret_ 또는 결제사의 sk_/whsec_ 계열). 이 값은 브라우저·앱 번들에 노출됩니다. DB는 anon 키 + RLS 정책으로, 결제는 클라이언트 키만 화면에 두고 검증은 서버에서 시크릿 키로 하세요.";
  }

  // 아래 3-2·3-3 은 '어느 파일·플래그를 넘기는가'를 본다. 따옴표로 감싼 낱말 하나(공백·구분자 없는 경로)는
  // 인자가 아니라 이름일 뿐이라 풀어서 본다(`cat "web/.env.local"`). 공백이 든 덩어리(메시지·검색어)는 그대로 Q 다.
  const bare = cmd.replace(/"((?:\\.|[^"\\])*)"|'([^']*)'/gs, (_, double, single) => {
    const inner = double ?? single;
    return /^[^\s;&|(){}<>`]*\n?$/.test(inner) ? inner : "Q";
  });
  // 출력 리다이렉트 대상(> · >>)은 쓰는 자리라 지우고, .example 은 깃에 올라가는 예시라 X 로 바꿔 둔다.
  const bareSegments = bare
    .replace(/[;&|(){}`]/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[0-9&]*>>?\s*\S+/g, "").replace(/\S*\.example(\s|$)/g, "X$1"));
  const BIN = String.raw`(\S*/)?`;
  const ENVF = String.raw`(\S*/)?\.env([.*]\S*)?`;

  // 3-2) 셸로 .env 실파일 내용을 내는 것. 값이 대화 기록·로그에 그대로 남는다.
  //      Read·Edit 도구는 settings.json 이 막고, 여기서는 흔한 셸 읽기를 막는다:
  //      파일을 통째로 내는 명령(cat·head·less·source·base64·xxd·diff 등), 검색·편집 도구에 파일로 넘기기
  //      (grep·rg·sed·awk — 첫 낱말은 검색어라 `grep -n .env.local .gitignore` 는 통과), cp 의 원본, 입력 리다이렉트(< .env).
  //      한계: 결정적으로 다 막을 수는 없다. `node -e`·`python -c`·`bash -c "..."` 안의 읽기, find -exec·xargs,
  //      디렉터리째 훑는 `grep -r`, 목록에 없는 명령은 통과한다. 이 규칙은 실수를 막는 장치지 샌드박스가 아니다.
  const envReads = [
    String.raw`${PRE}${BIN}(cat|head|tail|less|more|source|\.|base64|xxd|od|strings|nl|tac|bat|diff)(\s+\S+)*\s+${ENVF}(\s|$)`,
    String.raw`${PRE}${BIN}(grep|egrep|fgrep|rg|sed|awk)(\s+-\S+)*\s+[^-\s]\S*(\s+\S+)*\s+${ENVF}(\s|$)`,
    String.raw`${PRE}${BIN}cp(\s+\S+)*\s+${ENVF}\s+\S`,
    String.raw`(^|[^<])<\s*${ENVF}(\s|$)`,
  ].map((source) => R(source));
  if (bareSegments.some((line) => envReads.some((re) => re.test(line)))) {
    return "셸로 .env 실파일 내용을 읽고 있습니다. 비밀 값이 대화 기록에 그대로 남습니다. 어떤 변수가 있는지는 .env.example 에서 보고, 값이 맞는지는 그 값을 쓰는 명령(pnpm db:start 등)을 돌려 확인하세요. 값이 꼭 필요하면 사용자에게 직접 확인을 부탁하세요.";
  }

  // 3-3) 재귀+강제 삭제. settings.json 의 Bash(rm -rf *) 는 이름으로만 막아 -fr·-r -f·--recursive --force 로 샌다.
  //      플래그 순서·분리와 상관없이 같은 규칙으로 막는다. -f 없는 rm -r 과 git rm 은 막지 않는다.
  //      목적은 확인 없는 대량 삭제 습관을 끊는 것이지 삭제 자체를 없애는 것이 아니다.
  const RM = R(String.raw`${PRE}${BIN}rm\s`);
  if (
    bareSegments.some(
      (line) =>
        RM.test(line) &&
        /\s(-[A-Za-z]*[rR][A-Za-z]*|--recursive)(\s|$)/.test(line) &&
        /\s(-[A-Za-z]*f[A-Za-z]*|--force)(\s|$)/.test(line),
    )
  ) {
    return "재귀 강제 삭제(rm -rf 와 -fr·-r -f·--recursive --force 같은 변형)는 막혀 있습니다. 의존성이 꼬였으면 pnpm install 로 다시 맞추세요. 무시된 생성물은 git clean -X -n 으로 목록을 먼저 보고 지울 것만 고르세요(.env 실파일도 무시 대상이라 -X -f 를 그대로 쓰면 함께 지워집니다). 꼭 지워야 하면 사용자에게 직접 실행을 부탁하세요.";
  }

  // ── 여기서부터는 파일 편집도 함께 본다 ─────────────────────────────────────────
  //
  // 1·2번(DB 명령)은 셸에서만 의미가 있어 위에서 끝났다. 아래 규칙은 '비밀 키가 어디에
  // 적히는가'를 보므로 편집에도 걸어야 한다. 실제 사고는 이 길로 난다.
  //
  // 가르는 기준은 하나다. **변수 이름을 말하는 것은 괜찮고, 값을 적는 것이 사고다.**
  // 문서가 `SUPABASE_SERVICE_ROLE_KEY` 를 설명하거나 .env.example 이 빈 이름을 적어 두는
  // 것은 정상이다. 그래서 아래 규칙은 전부 '값의 생김새'를 본다.

  // 편집 내용과 셸 명령을 한 덩어리로 놓고 본다. 화면 코드에 키를 적는 길은 편집으로도
  // 열리고 `echo ... > 파일` 로도 열린다. 두 문을 같은 규칙으로 잠근다.
  const target = `${payload}\n${cmd}`;

  // .env 실파일은 비밀 값의 정식 자리다. 그 자리에 넣는 것은 막지 않는다.
  // 단 .env.example 은 깃에 올라가므로 예외가 아니다. 판정은 위 isEnvFile 하나로 한다.
  if (isEnvFile(path)) return null;
  // 셸로 .env 에 쓰는 것도 같은 정식 경로다(`echo ... >> .env.local`).
  // 단 쓰는 곳(> · >> · >| · tee)이 전부 .env 실파일일 때만이다. 명령에 .env 가 한 번 나온다고 풀어 주면
  // `cat .env.local; echo <키> > app.ts` 처럼 다른 파일에 쓰는 길이 같이 열린다.
  // tee 는 여러 파일에 한꺼번에 쓰므로 옵션이 아닌 인자를 전부 쓰는 곳으로 센다.
  // 단 `2>/dev/null` 의 2 는 파일이 아니라 리디렉션 번호이므로 tee 인자를 뽑기 전에 떼어 낸다.
  // tee 는 단어 처음일 때만 센다: 줄 처음, 공백(sudo tee), | ; & ( ` 뒤, 경로(/usr/bin/tee)·역슬래시(\tee) 뒤.
  // committee·guarantee 처럼 단어 안의 tee 를 세면 그 뒤 단어가 쓰는 곳이 되어 .env 예외가 괜히 풀린다.
  // 반대로 진짜 tee 를 놓치면 남은 쓰는 곳이 전부 .env 라서 예외가 잘못 열리므로, 앞 글자는 넓게 받는다.
  // 줄마다 앞에 공백을 붙여 줄 처음도 같은 앞 글자 규칙으로 본다.
  // 글자 그대로의 \n·\r·\t 뒤도 공백으로 본다. printf·echo -e 에 적힌 것은 실행될 때 줄바꿈·탭이 된다.
  // 쓰는 곳의 파일 이름에 셸 펼침($ · `)이 있으면 실제로 어느 파일에 쓰는지 알 수 없으니 예외로 보지 않는다.
  const writes = cmd
    .split("\n")
    .flatMap((line) => [
      ...[...line.matchAll(/>[>|]?\s*([^\s|;&<>]+)/g)].map((m) => m[1]),
      ...[
        ...` ${line.replace(/(\s)[0-9]+>/g, "$1>")}`.matchAll(
          /(?:\\[nrt]|[\s|;&(`/\\])tee((?:\s+[^\s|;&<>]+)+)/g,
        ),
      ].flatMap((m) => m[1].split(/\s+/).filter((arg) => arg && !arg.startsWith("-"))),
    ])
    .map((dest) => dest.replace(/["']/g, ""))
    .filter((dest) => !/^(&|\/dev\/null$)/.test(dest));
  if (
    writes.some(Boolean) &&
    writes.every((dest) => !/[$`]/.test(dest.slice(dest.lastIndexOf("/") + 1)) && isEnvFile(dest))
  ) {
    return null;
  }

  // 4) Supabase service_role 키가 파일에 박히는 것. 생김새는 위 SERVICE_ROLE_JWT 가 정한다.
  if (any(target, R(SERVICE_ROLE_JWT))) {
    return "service_role 키를 파일에 직접 적고 있습니다. 이 키는 RLS 를 통째로 무시해서, 코드에 들어가는 순간 누구나 모든 사용자의 데이터를 읽고 고치고 지울 수 있습니다. 비밀 키는 접두어 없는 이름으로 .env 파일에만 두고 서버 코드에서만 읽으세요(getSupabaseAdmin). 화면 쪽에 두는 것은 anon 키뿐이고, 무엇을 읽고 쓸 수 있는지는 키가 아니라 RLS 정책이 정합니다.";
  }

  // 5) Supabase 새 형식 시크릿 키(sb_secret_), 결제사 시크릿·웹훅 서명 키가 파일에 박히는 것.
  //    접두어 뒤에 실제 키 글자가 여덟 자 넘게 붙은 것만 본다. 문서가 "sk_ 계열" 이라고
  //    부르는 것과 진짜 값을 이 길이로 가른다.
  if (any(target, /(sb_secret_|sk_test_|sk_live_|test_sk_|live_sk_|whsec_)[A-Za-z0-9]{8,}/)) {
    return "시크릿 키의 실제 값을 파일에 직접 적고 있습니다(Supabase sb_secret_ 또는 결제사의 sk_/whsec_ 계열). 이 값들은 서버에서만 써야 합니다. 접두어 없는 이름으로 .env 파일에 두고 서버 코드에서 읽으세요. 화면에 두어도 되는 것은 클라이언트 키(ck_/pk_ 계열)와 anon 키뿐입니다.";
  }

  // 5-2) 생김새가 정해진 외부 서비스 키. 하나만 새도 계정이 통째로 넘어간다.
  //      AWS 액세스 키, GitHub 토큰, Anthropic·OpenAI API 키, Slack 토큰, PEM 개인키.
  if (
    any(
      target,
      /((AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|sk-(ant|proj)-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN[A-Z ]*PRIVATE KEY-----)/,
    )
  ) {
    return "외부 서비스의 비밀 키를 파일에 직접 적고 있습니다(AWS·GitHub·Anthropic·OpenAI·Slack 토큰 또는 PEM 개인키). 한 번 깃에 들어가면 이력에서 지워도 노출된 것으로 봐야 합니다. 값은 .env 파일에만 두고 코드는 process.env 로 읽으세요.";
  }

  // 6) 비밀을 뜻하는 이름에 값을 대입하는 것. 이름만 언급하는 문서·예시와 가르려고
  //    따옴표로 감싼 스무 자 이상의 문자열이 붙은 경우만 본다.
  if (
    any(
      target,
      /(SERVICE_ROLE|SECRET_KEY|PRIVATE_KEY)[A-Za-z0-9_]*\s*[:=]\s*.?["'\\`][^"'\\`]{20,}/,
    )
  ) {
    return "비밀 키로 보이는 값을 코드에 직접 적고 있습니다. 이름이 SERVICE_ROLE·SECRET_KEY·PRIVATE_KEY 인 값은 코드 파일에 두지 않습니다. 접두어 없는 이름으로 .env 파일에만 두고 서버에서 process.env 로 읽으세요. 변수 이름을 문서에 적는 것은 괜찮고, 값을 적는 것이 사고입니다.";
  }

  return null;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin
  .on("data", (chunk) => (input += chunk))
  .on("end", () => {
    let reason;
    try {
      reason = decide(input);
    } catch {
      // 판정이 터지면 조용히 통과시키지 않고 막는다.
      reason = "가드(.claude/hooks/guard.sh)가 입력을 판정하지 못했습니다. 사용자에게 알리세요.";
    }
    if (reason) {
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason,
          },
        }),
      );
    }
  });
JS

# Git Bash 가 스크립트 속 /경로 모양 글자를 Windows 경로로 바꾸지 않게 한다.
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' exec node -e "$js"
