# 설치와 설정

처음 받은 뒤의 순서와, 내 프로젝트에 맞게 고치는 법입니다. 빠른 시작은 [README](../../README.md) 에 있습니다.

## 들어 있는 것

| 영역 | 스택 |
|---|---|
| 웹 `web/` | Next.js 16 · React 19 · Tailwind v4 · shadcn(Base UI) · react-hook-form + zod · zustand · sonner · Vitest · Playwright |
| DB·인증 | Supabase(RLS) · PGlite(DB 정책 시험·타입 생성) · 로컬 DB 는 Supabase CLI + Docker |
| 공통 | pnpm 9 · TypeScript · ESLint 9 · Prettier · Husky · lodestar |

브라우저에서 서버 데이터를 다시 가져오고 캐시해야 할 때만 TanStack Query를 설치합니다.

```
agentic-boilerplate/
├── web/                 Next.js — 웹 화면과 서버(web/server/<도메인>)
├── supabase/            DB 스키마(migrations/)와 로컬 DB 설정(config.toml)
├── design/              색·글꼴·글자 눈금 정본(tokens.json)
├── scripts/             커밋 게이트·검증·토큰·DB 스크립트와 그 시험
├── .claude/             클로드가 쓰는 스킬·명령·서브 에이전트·훅
├── .mcp.json            클로드가 쓰는 MCP 서버(playwright — 브라우저로 화면 확인)
├── .husky/              커밋 게이트(pre-commit·commit-msg)와 기본으로 꺼 둔 push 전 검사(pre-push)
├── .github/             CI·Claude 리뷰 봇·Dependabot
├── docs/                사람이 읽는 상세 안내
├── verify.config.json  검증 설정의 정본
└── AGENTS.md            에이전트 공통 규칙(CLAUDE.md 가 불러 씁니다)
```

`web` 은 루트와 workspace 로 묶지 않은 **독립된 프로젝트**라 따로 설치합니다. 웹이 쓰는 테마와 DB 타입은
`design/tokens.json` 과 `supabase/` 에서 생성됩니다.

## 준비물

| 필요한 것 | 확인 | 비고 |
|---|---|---|
| Node.js 22.13 이상 또는 24.3 이상 | `node -v` | 루트 `package.json` 의 `engines`. CI 는 `.nvmrc`(22)를 씁니다(`nvm use`) |
| pnpm 9 | `pnpm -v` | `corepack enable` 또는 `npm install -g pnpm`. npm·yarn 은 쓰지 않습니다 |
| git | `git --version` | 커밋 게이트는 git 저장소에서만 켜집니다 |
| Claude Code | `claude --version` | 스킬·훅이 여기에 맞춰져 있습니다 |
| (선택) Docker Desktop + Supabase CLI | `docker info` · `supabase --version` | 로컬 DB(`pnpm db:start`)를 쓸 때만 |
| (선택) Polaris 플러그인 | `claude plugin list` | 미션·스펙을 문서로 관리할 때만 |

**Windows** 에서는 명령을 **Git Bash**(Git for Windows 에 들어 있음)에서 실행합니다. 클로드 코드도 Windows 에서 같은 Git Bash 를 씁니다.
PowerShell·cmd 에서는 `bash` 가 잡히지 않거나 WSL 의 bash 가 잡혀 색 검사·DB 스크립트가 엉뚱하게 돌 수 있습니다.
줄바꿈은 `.gitattributes` 가 LF 로 고정하므로 `core.autocrlf` 설정을 바꾸지 않아도 됩니다.

Node 범위(`^22.13.0 || ^24.3.0`)는 루트 `package.json` 에 적은 LTS 두 줄이고, Next 16(`>=20.9.0`)이 받는 범위 안입니다.
`.nvmrc`(22)는 CI·배포가 쓰는 고정값이라 Node 24로 돌리면 doctor가 경고만 합니다. `engines`는 루트 `package.json`에만 두고 `web/package.json`에 중복 정의하지 않습니다. 현재 Vercel 웹·AI 서비스 구성과 배포 안내는 [10 배포](../10-DEPLOYMENT.md)와 [첫 배포 안내](first-deployment.md)에 있습니다.

## 시작하기

1. Node 를 루트 `package.json` 의 `engines` 범위로 맞추고(`nvm use` 는 `.nvmrc` 의 22), pnpm 은 `packageManager`(`pnpm@9.15.9`)를 따릅니다(`corepack enable`).
2. 루트와 `web` 을 각각 설치합니다(아래 "1. 설치").
3. `pnpm run doctor` 로 설치 상태를 읽기만 하는 점검을 합니다.
4. env 파일 없이 `pnpm -C web dev` 로 시작 화면을 엽니다. DB 는 나중에 붙여도 됩니다.
5. 개발 중 코드 변경은 `pnpm verify:changed`, 통합·제출 전은 전체 `pnpm verify`를 실행합니다. 문서만 바꾸면 경로·계약·사실관계를 직접 대조합니다([17 검증 정책](../17-CLAUDE-IMPLEMENTATION.md), ADR-046).
6. 배포 전에 클로드에서 `/predeploy-review` 로 점검합니다.
7. 첫 배포는 사람이 직접 설정합니다 — [첫 배포 안내](first-deployment.md).

### 템플릿에서 만든 저장소

이 저장소는 템플릿에서 복사해 만들었습니다. 루트 `template.json` 에 템플릿 이름·원본 커밋·만든 날짜가 있습니다.
스크립트·게이트·클로드 설정은 복사본이라 템플릿이 나중에 고쳐져도 저절로 들어오지 않습니다. 가져오는 순서는
[템플릿 개선분 가져오기](#템플릿-개선분-가져오기)에 있습니다. 템플릿 원본에만 있는 `pnpm bootstrap`·`pnpm smoke:template` 은 이 저장소에 없습니다.

### 1. 설치

```bash
pnpm install --frozen-lockfile           # 루트: 커밋 게이트·토큰·DB 스크립트 (설치하면서 커밋 게이트가 켜집니다)
pnpm -C web install --frozen-lockfile    # 웹
```

zip 으로 받아 `.git` 이 없다면 먼저 `git init` 을 하세요. 루트 설치 때 커밋 게이트를 켜려면 git 저장소여야 합니다.

Git 저장소에서 커밋 게이트 설치가 실패하면 루트 설치도 실패합니다. 원인을 해결한 뒤 `node scripts/install-hooks.mjs` 로
다시 확인하세요. 기존 `core.hooksPath` 를 자동으로 덮지 않습니다. `HUSKY=0` 으로 명시적으로 건너뛰면 커밋을 검사하지 않습니다.

설치한 뒤 환경을 읽기만 하는 점검을 실행합니다.

```bash
pnpm run doctor                 # 사람이 읽는 결과
pnpm --silent run doctor --json # 기계가 읽는 JSON (pnpm 실행 배너 제거)
```

`pnpm doctor` 는 pnpm 자체 명령이므로 이 저장소 점검에는 `run` 을 붙입니다. Node/pnpm 버전, 루트와 있는 플랫폼의
락파일·직접 의존성·실행 파일, 커밋 게이트, 토큰·DB 타입 생성물을 검사하고 해결 명령을 알려 줍니다.
Node 는 `engines` 범위 안이면 통과이고 `.nvmrc` 와 다르면 경고(`!`)만 합니다. pnpm 은 `packageManager` 와 같아야 합니다.
커밋 게이트는 husky 가 훅보다 먼저 실행하는 사용자 파일(`~/.config/husky/init.sh`)도 봅니다. 그 파일 한 줄로 두 훅이 다 꺼질 수 있어 실패로 알립니다.
종료 코드는 0 통과(경고 포함), 1 환경·훅·생성물 문제, 2 잘못된 인자입니다. 없는 플랫폼은 건너뛰고, 락파일과 importer 의 정확한 일치는
frozen 설치가 검사합니다. 설치·파일 수정·네트워크·실제 DB 접속·env 파일 읽기는 하지 않습니다.
`HUSKY=0` 의 훅 skip 은 게이트 활성화 성공이 아니며, doctor 통과는 `pnpm verify` 통과를 대신하지 않습니다.

### 2. DB 고르기

셋 중 하나로 시작합니다. 나중에 바꿔도 됩니다.

- **DB 없이** — 환경변수 파일이 없어도 화면이 뜹니다. 로그인 견본 화면은 DB 가 없다고 알려 줍니다.
- **로컬(계정 없이)** — Docker Desktop 을 켜고 Supabase CLI 를 설치한 뒤(macOS `brew install supabase/tap/supabase`,
  CLI 가 없으면 `pnpm db:start` 가 OS 별 설치법을 알려 줍니다) `pnpm db:start` 를 실행합니다.
  로컬 DB 를 켜고, 마이그레이션을 적용하고, `web/.env.local` 을 채웁니다. 첫 실행은 Docker 이미지를 받느라 몇 분 걸립니다.
- **클라우드** — supabase.com 에서 무료 프로젝트를 만들고, 각 폴더의 `.env.example` 을 보고 환경변수 파일을 채웁니다.
  자세한 순서는 `database` 스킬(`.claude/skills/database/SKILL.md`)에 있습니다.

환경변수 파일과 DB 규칙은 [데이터베이스](database.md) 에 있습니다.

### 3. 실행

```bash
pnpm -C web dev           # 웹 — http://localhost:3000
```

### 4. 클로드 코드 열기

저장소 루트에서 `claude` 를 실행하고 `/setup` 을 입력합니다. 환경을 점검하고 이 환경이 어떻게 동작하는지 짧게
소개합니다. 처음 한 번이면 충분하고, 그 뒤로 막히면 `/help` 를 씁니다.

방향부터 문서로 세워 두고 싶으면 Polaris 플러그인을 설치하고 `/polaris:init` 을 실행하세요. 미션과 스펙이
`polaris/` 에 남고, 클로드가 구현하기 전에 먼저 읽습니다. Polaris 를 쓰지 않으면 `/interview` → `/spec` 이 같은
자리(`polaris/specs/planned/`)에 스펙을 남깁니다.

## 내 프로젝트에 맞추기

- **템플릿으로 프로젝트를 여럿 만들 때** — `supabase/config.toml` 의 `project_id` 가 프로젝트마다 달라야 합니다.
  같으면 로컬 Docker 컨테이너·볼륨 이름이 겹쳐 서로의 로컬 DB 를 건드립니다. 손으로 복사한 프로젝트는 직접 바꿉니다.
- **다른 스택 추가** — `verify.config.json` 의 `verification.projects` 에 이름·폴더·존재 확인 파일(`marker`)·설치·검증 명령을
  등록합니다. 명령은 `{ "command": "실행파일", "args": ["인자"] }` 형태이며 셸 문자열을 실행하지 않습니다.
  예를 들어 Python 프로젝트는 `marker: "pyproject.toml"`, 검증은 `command: "uv", args: ["run", "pytest"]` 입니다.
  필요 없는 공통 검사(`verification.common`)도 같이 맞춥니다. CI 와 커밋 게이트도 같은 설정을 읽습니다.

## 템플릿 개선분 가져오기

`template.json` 의 `commit`(프로젝트를 만든 템플릿 커밋)부터 템플릿 최신까지의
변경을 스크립트·게이트·클로드 설정에 한해 3-way 로 합칩니다. 게이트 파일(`.husky/`·`.github/`·`.claude/settings.json`)이
함께 바뀌므로 클로드에게 맡기지 않고 **사람이 터미널에서** 합니다. 커밋하지 않은 변경이 없는 상태에서 시작합니다.

```bash
OLD=$(node -p "require('./template.json').commit")
git remote add template <템플릿 저장소 주소>      # 처음 한 번
git fetch template main
git diff --binary --no-renames "$OLD" template/main -- \
  scripts .husky .claude .mcp.json .github AGENTS.md CLAUDE.md verify.config.json package.json pnpm-lock.yaml \
  .prettierrc.json .prettierignore .gitignore .gitattributes .nvmrc \
  web/eslint.config.mjs web/lodestar.config.ts \
  ':!scripts/template' ':!.github/workflows/template.yml' ':!scripts/database.test.mjs' \
  | git apply --3way
```

- 제품이 고친 줄과 겹치지 않으면 그대로 합쳐집니다(루트 `package.json` 에 더한 내 스크립트, 고쳐 쓴 `AGENTS.md` 제목은 남습니다).
  겹치면 `Applied patch to '<파일>' with conflicts.` 가 나오고 그 파일에 충돌 표시(`<<<<<<< ours` … `>>>>>>> theirs`)가 남습니다.
  나머지 파일은 적용된 상태이니 표시를 고친 뒤 `git add` 합니다. 여러 번 나오는 `Falling back to direct application...` 은 오류가 아닙니다.
- 템플릿의 `.claude/` 에는 이 저장소에서 지운 앱(모바일) 전용 에이전트·스킬이 있습니다. 합친 뒤 다시 생기면 지웁니다(ADR-007).
- 가져오지 않는 것: 견본 코드(`web/` 의 화면·서버·로직), `supabase/`, `design/`, `docs/`, 웹의 의존성, 템플릿 관리용(`scripts/template/`).
  필요하면 위 명령에 경로를 더합니다. `scripts/database.test.mjs` 는 제품의 표에 맞춰 고쳐 쓰는 파일이라 뺐습니다.
- 끝나면 `template.json` 의 `commit` 을 가져온 커밋(`git rev-parse template/main`)으로 고치고, `pnpm install --frozen-lockfile` 뒤 `pnpm verify` 가
  통과하면 커밋합니다. `scripts/`·`.husky/` 가 바뀐 커밋이라 커밋 게이트가 루트 시험을 한 번 더 돕니다.
