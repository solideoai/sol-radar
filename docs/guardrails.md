# 구조가 막아 주는 것들

혼자 만들 때 가장 위험한 건 "나중에 확인하자"입니다. 아래는 사람이 아니라 구조(커밋 게이트·훅·린트·CI)가 막습니다. 끄지 마세요.
에이전트가 늘 지키는 규칙은 [`AGENTS.md`](../AGENTS.md) 의 "결정적 강제 장치"에 짧게 있고, 각 장치가 무엇을 언제 검사하는지는 이 문서가 정본입니다.

## 디자인 토큰

색·글꼴·글자 눈금은 `design/tokens.json` 한 곳에만 적습니다. `pnpm tokens` 가 웹 `web/app/globals.css` 와 앱 `mobile/theme/tokens.ts` 를
만들어서, 정본 하나를 고치면 웹과 앱이 같이 바뀝니다.

화면 코드에 색을 직접 적거나(`#fff`·`rgba(...)`·`oklch(...)`) 웹에서 Tailwind 기본 팔레트 클래스(`bg-red-500`·`text-white`)를
쓰면 커밋 게이트와 CI 가 막습니다. 새 색이 필요하면 `tokens.json` 에 추가합니다.

## 커밋

### 메시지: `타입: 작업 내용`

```
feat: 로그인 화면 추가
fix(mobile): 키보드가 입력창을 가리는 문제
```

- 타입(소문자): `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`
- 범위는 선택이고 타입 바로 뒤 괄호에 공백 없이 씁니다. 콜론 뒤는 정확히 한 칸, 첫 줄은 50자 이내.
- 어기면 `.husky/commit-msg` 가 막습니다. 규칙은 `scripts/commit-message.mjs`.

### 커밋 게이트가 보는 것

`.husky/pre-commit` 은 바뀐 곳만 골라 검사합니다. 빌드와 앱의 Expo 점검(네트워크 필요)은 빼서 빠르게 끝나게 했고, 둘은 CI 가 봅니다.
느린 게이트는 결국 `--no-verify` 로 우회되기 때문입니다.

| 바뀐 곳 | 검사 |
|---|---|
| `web/`·`mobile/` | 그 폴더의 서식·타입·린트·테스트·구조·토큰·색 |
| `design/` | 토큰·색 |
| `supabase/` | DB 정책 시험(`pnpm test:db`)·DB 타입, 마이그레이션 수정·삭제 금지 |
| 루트 소유 파일 (`scripts/`·`design/`·`verify.config.json`·`package.json`·`.claude/settings.json`·`.github/`) | 루트 서식 |
| 게이트 자신 (`scripts/` 전부·`.husky/`·`.claude/hooks/`·`.claude/settings.json`·`verify.config.json`·`.github/`) | `pnpm test` |
| 루트·`web`·`mobile` 의 `package.json` 만 | `pnpm test:package` (그 파일을 읽는 시험만. 전체는 CI 가 봅니다) |

검사는 작업 폴더의 파일을 읽습니다. 그래서 스테이징한 파일에 스테이징하지 않은 수정이 남아 있으면(`git add -p` 같은 부분 스테이징) 검사 전에 막습니다.
전부 스테이징하거나, 이번 커밋에 넣지 않을 수정은 `git stash push --keep-index` 로 치워 두세요.

`web/server`·`web/lib`·`mobile/lib` 에 새 로직 파일을 넣었는데 옆에 테스트 파일이 없으면 경고합니다(차단하지는 않습니다).

### push 전 검사 (CI 가 돌지 못할 때만 켠다)

`.husky/pre-push` 는 기본으로 꺼져 있습니다. Actions 사용 분을 다 써서 CI 가 돌지 않는 동안처럼, CI 를 대신할 때만 저장소마다 켭니다.

```bash
git config gate.prePush true      # 켜기 (이 저장소, 이 PC 에만)
git config --unset gate.prePush   # 끄기 — CI 가 다시 돌면 끈다
```

켜면 push 할 커밋을 임시 worktree 에 꺼내 CI 처럼 깨끗한 상태에서 같은 검사를 돌립니다.
작업 폴더의 커밋 안 한 변경이나 같은 폴더에서 일하는 다른 세션의 작업은 결과에 섞이지 않습니다.

- 차례로: 커밋 메시지(`check-commits`) → 변경분 정책(`check-policy`) → 루트 설치
- 동시에: 공통 검사(`verify --common`)·루트 의존성 감사, 프로젝트마다 설치 → `verify`(빌드 포함) → E2E → 의존성 감사
- 프로젝트 검사는 그 폴더나 공유 파일(프로젝트 폴더 밖의 문서 아닌 파일)이 바뀐 push 에서만 돕니다. 새 브랜치면 전부 돕니다.

매번 설치하고 캐시 없이 빌드하므로 push 마다 몇 분이 걸립니다. Claude Code 에서 push 할 때는 명령 시간 제한을 넉넉히 둡니다.
E2E 브라우저 설치는 하지 않습니다. 브라우저가 없으면 E2E 가 설치 명령을 알려 줍니다. 실패하면 그 작업의 로그 끝을 보여 주고, 전체 로그는 임시 폴더에 남깁니다.

## 막는 장치

- **ESLint** — 재할당하지 않는 변수는 `const`(`prefer-const`), 재할당이 필요하면 `let`을 씁니다. 도메인 안쪽 파일 직접 import(딥 임포트), 상대 경로(`../`)는 금지입니다. 검사를 끄는 길도 막습니다:
  `eslint-disable` 주석은 효과가 없고, `any`·`@ts-ignore`·설명 없는 `@ts-expect-error`·테스트 `.only`·`.skip`·`.fixme` 는 오류입니다.
  이 규칙이 설정에서 빠지면 `check:lint-guards` 가 실패합니다. 예외가 꼭 필요하면 사람이 설정에서 엽니다.
- **lodestar** — 계층 경계를 넘는 import 차단(예: 화면이 DB 접속 코드를 직접 부르기). 규칙은 `web/lodestar.config.ts`.
- **`server-only`** — 서버 코드가 브라우저 번들로 새면 빌드가 실패합니다.
- **마이그레이션 append-only** — 이미 있는 스키마 파일은 고치거나 지우거나 이름을 바꿀 수 없습니다. 이력이 곧 DB 상태입니다.
- **RLS 기본 잠금** — 실제 DB 없이 PGlite(PostgreSQL 엔진)에 마이그레이션 전체를 적용해 RLS·권한·트리거를 시험합니다.
- **생성물 4개** — `web/app/globals.css`·`mobile/theme/tokens.ts`·`web/lib/database.types.ts`·`mobile/lib/database.types.ts` 는
  정본에서 만들고 손으로 고치지 않습니다. 어긋나면 게이트와 CI 가 잡습니다.
- **Prettier** — 서식의 정본은 루트 `.prettierrc.json` 하나입니다. 손으로 맞추지 말고 `pnpm format` 을 돌립니다.
  마크다운·락파일·생성물은 대상이 아닙니다.
- **클로드 훅** — `.claude/hooks/guard.sh` 가 실행 직전에 막습니다: 이력을 남기지 않는 DB 파괴 명령(`supabase db reset` 등),
  비밀 키를 코드·공개 변수에 넣는 일, 셸로 `.env` 실파일 읽기(`cat`·`grep`·`sed`·`source`·`cp` 의 원본·`< .env` 등),
  재귀 강제 삭제(`rm -rf` 와 `-fr`·`-r -f`·`--recursive --force`). `.env` 를 Read·Edit 도구로 여는 것은 `.claude/settings.json` 이 거부합니다.
  실수를 막는 장치이지 샌드박스는 아닙니다 — `node -e`·`bash -c "..."` 안의 읽기, 폴더째 훑는 `grep -r` 은 통과하고,
  `-f` 없는 `rm -r` 은 일부러 막지 않습니다. 막는 범위와 한계는 `guard.sh` 주석에 있습니다.
- **문서 경로(템플릿 원본에만)** — README·`docs/`·`.claude/` 문서에 적힌 저장소 경로가 실제로 있는지 `scripts/template/doc-paths.test.mjs` 가 봅니다.
  `scripts/template/` 의 시험은 새 프로젝트로 복사하지 않습니다. 제품의 README·문서는 제품이 고쳐 쓰기 때문입니다.
- **스크립트 단위 시험(템플릿 원본에만)** — `scripts/` 의 도구 하나하나를 시험하는 파일(doctor·토큰·색·DB 타입 생성기·가드 훅·배포 검사 등)과
  게이트를 임시 저장소에서 돌려 보는 시험(커밋 게이트·커밋 메시지·CI 필수 검사·CI 커밋 검사)도 `scripts/template/` 에 있어 새 프로젝트로 가지 않습니다.
  새 프로젝트의 `pnpm test` 는 `scripts/` 바로 아래의 시험만 돕니다: DB 정책 시험(`scripts/database.test.mjs`), 게이트가 약해지지 않았는지 보는 시험(`scripts/gate-integrity.test.mjs`),
  push 전 검사 시험(`scripts/pre-push.test.mjs`), 시드 시험(`scripts/db-seed.test.mjs`).
  새 프로젝트에서 `scripts/` 의 도구나 `.husky/` 의 게이트를 고칠 때는 그 시험을 템플릿 원본에서 가져와 함께 고칩니다.
- **게이트 파일 편집 금지** — 클로드는 검증이 기대는 파일을 고치지 못합니다(`.claude/settings.json` 의 `deny`):
  `.husky/`, `.claude/settings*.json`·`.claude/hooks/`, `.github/`, `web/lodestar.config.*`. 검사를 고쳐 초록불을 만드는 길을 막기 위해서이고,
  권한 모드와 상관없이(`bypassPermissions` 에서도) 묻지 않고 막습니다. `package.json`·`.npmrc`·`verify.config.json`·`scripts/`·`eslint.config.*` 는
  막지 않습니다. 이 파일들에서 검사를 빼거나 약하게 만드는 수정은 `scripts/gate-integrity.test.mjs`·`check:lint-guards`·커밋 때의 `pnpm test` 가 잡습니다.
  고쳐야 하면 **사람이 해당 `deny` 줄을 잠시 지우고** 작업한 뒤
  `git checkout -- .claude/settings.json` 으로 되돌립니다. 지운 상태는 커밋하지 않습니다(커밋 때 `pnpm test` 가 막습니다).
  막는 것은 파일 도구와 셸이 직접 쓰는 명령(`sed -i`·`>`·`tee`)이고, 스크립트가 파일을 여는 우회까지는 못 막습니다 — CI 가 마지막 안전망입니다.

## CI

- **`ci`** — 공통 검사(루트 시험·토큰·색·DB 타입·서식) → PR·push 변경분 정책 검사 → 설치된 프로젝트마다 설치·검증·웹 E2E·의존성 감사.
  커밋 메시지는 `commits` 잡이, 루트 의존성 감사는 `audit` 잡이 따로 봅니다(어느 쪽이 실패해도 프로젝트 검증은 그대로 돕니다).
  마지막 `required` 잡이 결과를 모읍니다. 공통 검증·커밋 메시지·루트 감사는 성공만 통과하고, 프로젝트 검증은 검사할 프로젝트가 없을 때만 건너뛸 수 있습니다(판정: `scripts/ci-required.mjs`).
  같은 PR 에 다시 push 하면 이전 실행은 취소됩니다.
- **`template`(템플릿 원본에만)** — 템플릿 스모크(`smoke-web`·`smoke-mobile`·`smoke-both`)와 Windows(Git Bash) 공통 검증(`windows`).
  각각 10분 넘게 걸려서 PR·push 에서는 돌지 않고, 주 1회 예약 실행(월요일 03:00 KST)과 Actions 에서 직접 돌릴 때(workflow_dispatch)만 돕니다.
  예약 실행은 기본 브랜치를 봅니다. 설치·의존성·훅·스크립트·bootstrap 을 크게 바꿨으면 병합 전에 직접 돌립니다.
  이 워크플로(`.github/workflows/template.yml`)는 새 프로젝트로 복사하지 않습니다.
- **커밋 메시지** — 로컬 훅과 같은 규칙으로 PR 의 커밋들과 PR 제목(squash 병합 제목), `main` push 의 새 커밋을 다시 봅니다(`scripts/check-commits.mjs`).
  PR 제목에는 `Merge `·`fixup! ` 같은 예외가 없고 GitHub 되돌리기 제목(`Revert "…"`)만 통과합니다. 비교 기준 커밋이 이력에 없으면(force push) 실패합니다.
  PR 제목만 고치면 검사가 다시 돌지 않으니(Re-run 은 옛 제목을 봅니다) **PR 을 닫았다 다시 열거나 새 커밋을 push** 하세요.
- **의존성 감사** — 루트(`audit` 잡)와 각 프로젝트에서 `pnpm audit --audit-level critical`. critical 만 막고 그 아래는 Dependabot PR 로 올립니다.
- **액션 고정** — `uses:` 는 커밋 SHA 로 고정하고(`소유자/액션@<40자 SHA> # v버전`), 체크아웃은 토큰을 남기지 않습니다(`persist-credentials: false`).
- **Claude Review Bot** — PR 마다 1차 리뷰를 답니다. 기본은 꺼져 있고, 저장소 Secrets 에 `ANTHROPIC_API_KEY`,
  Variables 에 `CLAUDE_REVIEW=on` 을 넣으면 켜집니다. 드래프트·포크·Dependabot PR 은 건너뜁니다.

### 저장소 설정에서 직접 켜는 것

CI 가 빨개도 병합을 막는 것은 GitHub 설정입니다. 템플릿이 대신 켤 수 없고, 켰는지 CI 가 확인하지도 못합니다.

1. **브랜치 보호** — Settings → Rules → Rulesets(또는 Branches)에서 `main` 에 "Require status checks to pass" 를 켜고 필수 검사로 `required` 하나를 등록합니다.
   프로젝트를 지우거나 더해도 이 이름은 그대로입니다. "Require a pull request before merging" 도 켜면 웹에서 `main` 에 바로 커밋하는 길이 닫힙니다.
   룰셋이면 `gh api repos/{owner}/{repo}/rules/branches/main` 결과의 `required_status_checks` 에 `required` 가 보여야 합니다.
2. **Dependabot** — `.github/dependabot.yml` 이 기본 브랜치에 있으면 루트·`web`·액션의 갱신을 폴더마다 한 PR 로 묶어 주 1회 엽니다.
   제목은 커밋 규칙(50자 이내)을 지나도록 `build:`·`ci:` 로 시작하고, npm major 는 사람이 올립니다(보안 갱신은 그대로 옵니다).
   `mobile/` 은 Expo SDK 마다 맞는 버전이 정해져 있어 하나씩 올리면 어긋나므로 넣지 않았습니다(`pnpm -C mobile exec expo install --fix` 로 맞춥니다).
   `web/` 을 지운 프로젝트는 `/web` 항목도 지웁니다.
   취약점 알림·보안 갱신은 Settings → Code security 에서 따로 켭니다.

### 템플릿 스모크 — `pnpm smoke:template`

`pnpm bootstrap` 과 같은 복사 계획으로 임시 폴더에 새 프로젝트를 만들고, 처음 쓰는 사람의 순서를 실제로 돌립니다:
`git init` → 루트·있는 폴더 frozen 설치(훅 설치 포함) → `pnpm run doctor` → `pnpm verify` → 웹은 임시 폴더 전용 chromium 을 받아 E2E,
앱은 pnpm 을 거치지 않은 Jest 직접 실행 → 훅이 타입 오류·직접 적은 색·잘못된 메시지를 막고 작은 변경의 첫 커밋을 통과시키는지.
mode 를 빼면 web·mobile·both 를 차례로 돕니다. 실패하면 단계를 알리고 멈추며, `--evidence <폴더>` 를 주면 경로를 가린 실패 기록을 남깁니다.

- 원본 작업 폴더의 현재 내용(커밋 전 수정 포함)을 쓰고, 원본은 바꾸지 않습니다. 실제 env·개인 파일은 복사하지 않습니다.
- 네트워크는 패키지와 Playwright 브라우저 설치에만 씁니다. 실행 환경의 DB·배포 변수를 지우므로 DB·Auth·배포에는 요청하지 않습니다.
- 브라우저용 OS 라이브러리는 미리 갖춰 둬야 합니다(스모크가 시스템에 설치하지 않습니다). 없으면 건너뛰지 않고 실패합니다.
- 앱은 `pnpm verify` 안의 iOS·Android JS export 까지 확인합니다. 네이티브 빌드·실기기 확인은 아닙니다.
- `pnpm test`·`pnpm verify` 는 스모크를 부르지 않습니다(오래 걸려서 따로 둡니다).
