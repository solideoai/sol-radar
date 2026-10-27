# 먼저: SOL RADAR 설계 문서가 이 파일보다 우선한다

이 저장소는 SOL RADAR 다. 정본은 `docs/CLAUDE.md` 와 설계 문서(`docs/00-README.md` 의 문서 표에 있는 설계 문서)다.
기술 스택은 Next.js + Supabase(Postgres·RLS·Auth·Storage) + Redis/BullMQ + Qdrant + Python AI(Qwen3.8-Flash-Next·Bosun 결정 모델. `KEV_*`·`/kev` 이름은 호환 유지) + Docker Compose 다(`docs/16-DECISIONS.md` ADR-015·017·034).
해커톤 뒤에는 API·worker 를 NestJS 로 옮긴다(ADR-028). 그 전에는 위 스택 그대로다.
모바일(1280px 미만 레이아웃·`mobile/` Expo 앱)과 결제·구독은 만들지 않는다. 화면은 데스크톱 1280px 이상이다(`docs/16-DECISIONS.md` ADR-007).
이 파일의 나머지는 저장소를 시작한 템플릿(agentic-boilerplate)의 규칙이다. 설계 문서와 부딪히면 설계 문서를 따른다.
아래의 Supabase(인증·DB·RLS·anon 키)·`web/server/<도메인>/` 구조 규칙은 설계와 일치하므로 따른다(ADR-017). Vercel frontend·회사 Gateway 배포는 ADR-045·049와 docs/10-DEPLOYMENT.md를 따른다.
템플릿의 Expo 앱(`mobile/`)과 그 규칙은 지웠다. 다시 만들지 않는다.
커밋 메시지 형식과 "결정적 강제 장치"(커밋 게이트·훅·린트를 끄거나 돌아가지 않기)는 그대로 지킨다.

해커톤 검증은 `docs/17-CLAUDE-IMPLEMENTATION.md`의 "해커톤 검증 정책"(ADR-046)을 따른다. 개발 중에는 `pnpm verify:changed`, 통합·제출 전에는 전체 `pnpm verify`를 실행한다. 이 정책은 아래 템플릿 및 스킬의 매 단계 전체 검증·개별 작업마다 별도 QA 지시보다 우선한다.

2026-10-21 사용자 추가 지시로 과도한 시험 파일·케이스도 실제 삭제하고 MVP 핵심만 남겼다. 현재 목록은 `docs/evidence/verification/20261021-pruned-tests.json`이다. 삭제한 전수 행렬·템플릿 회귀를 일률적으로 복구하지 않는다. 새 시험은 핵심 동작이나 실제 결함을 직접 검증할 때만 추가하고, 상수/목업 값 복사·계층별 중복·무차별 입력 조합은 만들지 않는다.

# 웹 코드 전에: 이 Next.js 는 학습 데이터와 다르다

이 안내는 웹(`web/`) 코드에 적용한다. Next.js 16 은 API·규약·파일 구조가 학습 데이터와 다를 수 있다.
웹 코드를 쓰기 전에 `web/node_modules/next/dist/docs/` 에서 관련 안내를 읽고, 폐기 예정(deprecation) 안내를 따른다.
루트 `node_modules` 에는 next 가 없다. 지침의 정본은 이 파일 하나다(`web/AGENTS.md`·`web/CLAUDE.md` 는 만들지 않는다).

# agentic-boilerplate — 공통 작업 규칙

이 저장소는 **Next.js 웹·Supabase 로 시작해, 이후에도 자기 제품을 잘 키워가기 위한 보일러플레이트**에서 출발했다.
핵심 철학: **"똑똑한 프롬프트가 아니라 가드레일."** 결과물이 무너지지 않게, 검증을 사람이 아니라 구조로 강제한다.

이 파일에는 에이전트가 늘 지킬 규칙만 둔다. 각 장치가 무엇을 언제 검사하는지는 `docs/boilerplate/guardrails.md`, 영역별 상세는 스킬에 있다.

## 폴더와 명령 (workspace 아님)

`web/`(Next.js)은 루트와 **따로** 설치되고 돌아간다. 패키지 매니저는 pnpm 이다(npm 아님).
웹이 루트에서 가져다 쓰는 것은 `supabase/`(스키마)와 `design/tokens.json`(색·글꼴·글자 눈금)이고,
worker(`web/worker`)는 `fixtures/` 와 `infra/sources/registry.yaml` 을 읽는다(Compose 에서는 읽기 전용 바인드, `docs/10-DEPLOYMENT.md` "로컬 Compose 서비스 (대체 경로)" 표).
검증 설정의 정본은 `verify.config.json` 이다. `pnpm verify`·커밋 게이트·CI 가 같은 설정을 읽고, 새 스택도 여기 등록한다.

- 설치: 루트·`web` 두 곳에서 각각 `pnpm install`. 패키지 추가는 그 폴더 안에서 `pnpm add <패키지>` — 루트에 넣지 않는다
- 실행: `pnpm -C web dev`
- DB: 로컬은 `pnpm db:start`(Docker·Supabase CLI 필요)가 켜고, 마이그레이션을 적용하고, `web/.env.local` 을 채운다. 끄기 `pnpm db:stop`.
  시험 계정·데이터는 `pnpm db:seed`(로컬 전용, 다시 돌리면 처음 상태로 되돌린다. 계정은 `scripts/db-seed.mjs` 머리에 있다)
  운영(클라우드) 적용은 `pnpm db:push` — 운영 DB 를 바꾸므로 사용자 확인 뒤에만 실행한다
- 개발 중 검증: `pnpm verify:changed`(HEAD 대비 변경 영역). 커밋된 브랜치 변경까지 보려면 `pnpm verify:changed --base <기준 커밋>`, 실행 계획만 보려면 `--dry-run`.
- 통합·제출 전 검증: `pnpm verify`(공통 검사 + 등록된 프로젝트·빌드). `pnpm verify:quick`은 빌드만 뺀 전체 검사이며 변경 범위 검사가 아니다.
- 시험 하나만: 웹 `pnpm -C web exec vitest run <파일> -t "<이름>"` · 루트 `node --test scripts/<이름>.test.mjs`. 브라우저 시험은 `pnpm -C web test:browser`, E2E 는 `pnpm -C web test:e2e`.
  로그인 뒤 E2E 는 `pnpm -C web test:e2e:auth`(로컬 Supabase 필요, verify·CI 에는 없다 → `testing` 스킬)
- 서식: 고친 폴더에서 `pnpm format` (루트·`web` 각자). 손으로 맞추지 않는다.
- Node 는 루트 `package.json` 의 `engines` 범위를 따른다. `web/package.json` 에는 `engines` 를 두지 않는다(이유는 `docs/boilerplate/first-deployment.md`).

## 커밋 메시지: `타입: 작업 내용`

- 예: `feat: 로그인 화면 추가`. 콜론 뒤는 **정확히 한 칸**, 첫 줄은 50자 이내로 작업 내용만 간단히. 자세한 설명은 한 줄 비우고 아래에 쓴다.
- 타입(소문자): `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`.
  범위는 선택이고 타입 바로 뒤 괄호 안에 공백 없이 쓴다: `feat(web): …` · `fix(db): …`.
- 어기면 `.husky/commit-msg` 가 커밋을 막는다.

## 황금 규칙 (항상 지킨다)

1. **구현은 단계로 쪼개고 단계마다 검증한다.** 스펙이 있으면 그것을 근거로 쓰고, 없으면 없다고 한 줄 알린 뒤 진행한다.
   큰 일(여러 단계·여러 영역)은 스펙과 계획을 먼저 세운다(아래 표준 흐름).
2. **작게 만든다.** 한 번에 기능 하나.
3. **선택한 검증을 통과하기 전에는 "다 됐다"고 말하지 않는다.** 개발 작업은 변경 범위 검사, 통합·제출은 전체 검사와 빌드가 기준이다. 실행한 범위와 미실행 검사를 구분해 보고한다.
4. **배포 전에 `/predeploy-review`.** 전문가 관점으로 점검한다.
5. **항상 좋은 코드·구조로.** 코드 `conventions`, 화면 `design-system`, 구조 `architecture`, 저장 `database`, 테스트 `testing`,
   웹 React·Next.js 성능 `vercel-react-best-practices`.
6. **반복되는 문제는 구조로 막는다.** 같은 에러가 두 번 나오면 재현 테스트를 남긴다.
7. **미션의 "안 할 것"은 절대 넘지 않는다.** 사용자가 요청해도 먼저 미션 수정을 권한다.

## 미션 & 스펙 (정본 자리는 `polaris/`)

미션·스펙 파일을 다른 위치에 만들지 않는다. Polaris 는 같은 자리를 쓰는 선택 플러그인이고, 이 템플릿에 들어 있지 않다.

- **`polaris/mission.md`**: 프로젝트 전체의 나침반. 한 줄 정의, 안 할 것(Anti-strategy), 현재 단계.
  있으면 설계 판단 전에 먼저 읽는다. 없으면 사용자와 정해 직접 쓴다.
- **`polaris/specs/`**: 스펙의 정본 자리(`/spec` 이 쓴다). 스펙은 `in-progress/` 부터 찾고, 비어 있으면 `planned/` 를 본다.
  `done/`·`canceled/` 는 지난 기록이다.

**이 폴더가 없다고 구현을 멈추지 않는다**(황금 규칙 1).

## 생각 규칙 — 모든 설계 판단의 첫 질문 (결정적 vs 비결정적)
- **결정적(기계가 채점: 빌드·타입·테스트·린트)** → 자동 검증으로 **강제**.
- **비결정적(판단 필요: 구조·저장방식·우선순위)** → 결정 전에 **탐색 범위를 좁히고 가장 단순하고 되돌리기 쉬운 것**을 고른다.

## 스킬

스킬·명령을 언제 쓰는지는 각 파일의 설명(`.claude/skills/`·`.claude/commands/`)에 있다. 뭐부터 할지 모르면 `/help`.

`vercel-react-best-practices`·`web-design-guidelines` 는 `skills add` 로 받은 외부 스킬이다(출처는 `skills-lock.json`). 원본을 고치지 않고 `web/` 에만 쓴다.
이 저장소 규칙과 부딪히면 저장소 규칙을 따른다 — 도메인은 배럴(`@/server/<도메인>`)로만, 데이터 캐시 라이브러리는 필요할 때만, 색·글꼴은 `design-system`.

## 표준 흐름
`/setup`(처음 한 번) → 일의 크기로 두 갈래:

- **작은 일** — 한 세션에 끝나는 화면 하나·표 하나·결함 하나. 바로 구현한다(황금 규칙 5 의 스킬을 적용하고 변경 범위 검증을 실행한다).
  요구가 모호하면 먼저 `/interview-quick`. → `/predeploy-review` → 배포
- **큰 일** — 여러 단계·여러 영역. `/interview` → `/spec`(`polaris/specs/`) → 계획(단계마다 고칠 파일과 완료 기준을 적어 사용자 승인) →
  단계별 구현(단계마다 관련 검사) → 통합 검증(전체 `pnpm verify`·변경 흐름 E2E·독립 리뷰 1회) → `/predeploy-review` → 배포
  - 화면이 새로 생기거나 흐름이 바뀌면 구현 전에 `web-designer` 에게 디자인 스펙을 받는다.
  - 서로 독립인 단계는 Claude Code 의 worktree 에이전트에 병렬로 맡길 수 있다. 같은 파일은 한 작업자가 맡는다.
  - 작은 작업은 구현자가 관련 검증까지 맡는다. 독립 리뷰는 통합 단위로 한 번 모으고, 데모 전에 `demo-verifier` 의 GO/NO-GO 를 받는다(`demo-verifier` 는 로컬 Compose 를 본다. 발표는 D1 운영 사이트, 웹 배포처는 Vercel). 작은 단계마다 test·e2e·qa 에이전트와 다중 프로필 리뷰를 연달아 실행하지 않는다.

## 서버·저장 구조 (요약)
- 서버 코드는 `web/server/<도메인>/` 에 `model`·`repo`·`service`·`index`(배럴)로 둔다. 견본은 `web/server/profile/`·`web/server/organization/`·`web/server/task/`·`web/server/activity/`·`web/server/admin/` → `architecture` 스킬.
- 데이터 접근의 기본 통로는 **anon 키**이고, 누가 무엇을 읽고 쓰는지는 **DB의 RLS 정책**이 정한다.
  `service_role` 키는 RLS를 무시하므로 기본 통로로 쓰지 않는다 → `database` 스킬.
- 모든 데이터는 조직에 속한다. 사용자가 만드는 데이터의 표는 `user_id` 가 아니라 `org_id` 로 거른다(`org_id in (select public.my_org_ids())`).
  조직 역할(`org_role`: owner·member)은 서비스 운영자(`profiles.is_admin`)와 다르다 — 운영자도 남의 조직은 못 읽는다.
- `web/server/<도메인>/`·`web/server/supabase/` 의 파일은 `import "server-only";` 로 시작한다. 비밀키는 `web/.env.local`(깃 제외), 서버에서만.

## 결정적 강제 장치 (끄지 말 것)

검사가 막으면 원인을 고친다. 끄거나 돌아가지 않는다. 장치마다의 상세와 CI 구성은 `docs/boilerplate/guardrails.md` 가 정본이다.

- **커밋 게이트**(`.husky/`): 검사는 작업 폴더를 읽는다. 파일은 통째로 스테이징한다.
- **편집 금지 파일**(`.claude/settings.json` 의 `deny`): `.husky/`·`.claude/settings*.json`·`.claude/hooks/`·`web/lodestar.config.*`. `.github/`는 2026-10-21 사용자 지시로 편집 금지를 해제했다. CI 필수 검사와 훅은 유지한다. 지금 GitHub Actions job 은 계정 결제 문제로 시작되지 않으므로 검사는 로컬 pre-push 게이트(`.husky/pre-push`, `git config gate.prePush true` 로 켠 저장소에서만 돈다, `scripts/pre-push.mjs`)로 한다.
  막히면 다른 길(스크립트로 파일 쓰기 등)로 돌아가지 말고 사용자에게 알린다.
- **약하게 만들지 않는 파일**: `package.json`·`.npmrc`·`verify.config.json`·`scripts/`·`eslint.config.*` 는 고칠 수 있지만, 검사를 빼거나 약하게 만들지 않는다.
- **린트·계층**: 검사를 끄는 길이 없다(`eslint-disable`·`any`·`@ts-ignore`·테스트 `.only`·`.skip`). 도메인은 배럴로만, 부모 상대경로(`../`) 대신 `@/`,
  계층 경계는 lodestar 가 막는다 → `conventions`·`architecture` 스킬. 규칙의 예외는 사람이 설정에서 연다.
- **생성물 2개**: 정본에서 만들고 손으로 고치지 않는다.
  - `web/app/globals.css` ← `design/tokens.json` (`pnpm tokens`). 색·글꼴·글자 눈금은 `tokens.json` 에만 적는다 → `design-system` 스킬.
  - `web/lib/database.types.ts` ← `supabase/migrations/` (`pnpm db:types`). 마이그레이션과 같은 커밋에 넣는다.
- **마이그레이션**: 새 파일로만 쌓는다(append-only). 이미 있는 파일은 고치거나 지우지 않는다.
- **RLS**: 표는 만들자마자 잠그고, 필요한 권한과 정책으로만 연다. 새 표의 정책 시험은 `scripts/database.test.mjs` 에 더한다.
- **훅**(`.claude/hooks/guard.sh`): 게이트 우회(`--no-verify` 등), 이력 없는 DB 파괴 명령, 비밀 키를 코드·공개 변수에 넣는 일, 셸로 `.env` 읽기, `rm -rf` 를 막는다.

## 기술 스택
- **웹**: Next.js 16 · React 19 · Tailwind v4 · shadcn(Base UI, `web/components/ui/`) · react-hook-form + zod · zustand · sonner · Vitest.
  TanStack Query 는 필요할 때만 설치한다 → `conventions` 스킬
- 공통: pnpm · TypeScript · ESLint 9 · Prettier · Husky · lodestar · **Supabase**(DB·인증) · PGlite(DB 정책 시험·타입 생성)
