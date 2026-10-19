# 클로드와 함께 만들기

만들고 싶은 것을 말하면 됩니다. 클로드는 일의 크기에 따라 두 갈래로 갑니다. 규칙의 정본은 [`AGENTS.md`](../../AGENTS.md) 입니다.

## 작은 일: 바로 만든다

화면 하나·표 하나·결함 하나처럼 한 세션에 끝나는 일입니다.

```
> 설정 화면에 다크 모드 토글을 추가해 줘
```

1. 요구가 모호하면 `/interview-quick` 으로 필요한 것만 묻고 정리합니다.
2. 클로드가 규칙 스킬(`architecture`·`conventions`·`design-system`·`database`·`testing`)에 맞춰 구현합니다.
   가장 가까운 코드를 따라 하므로 로그인·조직·작업·활동 견본이 서버 도메인·폼·화면의 기준입니다(자리와 동작은 [데이터베이스](database.md#로그인-견본)).
3. `/verify` 가 초록불이 될 때까지 스스로 고칩니다. 통과하기 전에는 "다 됐다"고 하지 않습니다.
4. 배포 전에 `/predeploy-review` 로 전문가 관점에서 점검합니다.

## 큰 일: 스펙과 계획부터

여러 단계·여러 영역(웹 화면·서버·DB)에 걸치는 일입니다.

```
> /interview 팀원 초대와 권한 관리 (웹 화면 + DB)
```

| 단계 | 일어나는 일 | 내가 할 일 |
|---|---|---|
| 인터뷰 | `/interview` 가 코드베이스를 병렬로 훑고 한 주제씩 묻습니다 | 답하고 결정 목록 확인 |
| 스펙 | `/spec` 이 `polaris/specs/planned/<slug>.md` 로 저장합니다 | 미결정 사항이 남으면 다시 인터뷰 |
| 계획 | 클로드가 단계를 나누고 단계마다 고칠 파일과 완료 기준을 적습니다. 화면이 있으면 디자이너 에이전트가 디자인 스펙을 붙입니다 | **계획 승인** |
| 구현 | 단계마다 구현하고 `/verify` 를 통과시킵니다. 서로 독립인 단계는 worktree 에이전트에 병렬로 맡길 수 있습니다 | 의존성 추가·DB 적용처럼 사람이 할 일 |
| 검증 | 스펙 대조(`/spec-check`)·테스트·E2E·QA 를 구현과 다른 에이전트가 맡습니다 | DB·로그인이 필요한 검사에 env 값 제공 |
| 검토·배포 | `/predeploy-review` 와 배포 점검(`test-deployment` 의 GO/NO-GO)을 거칩니다 | **병합·배포는 직접** |

스펙이 이미 있으면 "이 스펙으로 계획부터"처럼 중간 단계에서 시작할 수 있습니다. 배포 뒤 문제가 생기면 `git revert` 로
되돌리고 새 작업으로 고칩니다.

## 슬래시 명령

| 명령 | 언제 쓰나 |
|---|---|
| `/setup` | 처음 한 번 — 환경 점검과 소개 |
| `/help` | 뭐부터 할지 모를 때, 막혔을 때 |
| `/interview-quick` | 작은 일의 요구가 모호할 때 |
| `/interview` → `/spec` | 큰 일의 요구 정리와 스펙 저장 |
| `/spec-check <스펙 경로>` | 구현이 스펙을 다 채웠는지 근거와 함께 대조 |
| `/verify` | 코드를 바꾼 뒤 — 통과할 때까지 고칩니다 |
| `/check-stub` | 구현된 척하는 코드(빈 핸들러·가짜 반환값·삼켜진 예외) 찾기 |
| `/predeploy-review [프로필]` | 배포 전 점검. code·design·product·developer·marketer·customer-support·infra·qa 중 자동 선택하거나 지정(`all` 은 전부) |
| `/add-review-profile` | 내 프로젝트에 맞는 리뷰 프로필 추가 |

배포 전 점검의 이름이 `/review` 가 아닌 것은 Claude Code 가 `/review` 를 내장 코드 리뷰의 별칭으로 쓰기 때문입니다.
`architecture`·`conventions`·`design-system`·`database`·`testing` 은 직접 부르기보다 클로드가 작업할 때 읽는 규칙 스킬입니다.
`vercel-react-best-practices`(웹 React·Next.js 성능 규칙)와 `web-design-guidelines`(웹 화면의 UI·접근성 지침 점검, `/web-design-guidelines <파일>`)는
`skills add` 로 받은 외부 스킬입니다(`skills-lock.json`). 이 저장소 규칙과 부딪히면 저장소 규칙을 따릅니다.

## 서브 에이전트

`.claude/agents/` 에 역할별 에이전트가 있습니다. 큰 일의 설계·검증 단계에서 부르고, 직접 일을 맡겨도 됩니다.

- 설계: `web-designer`
- 작은 일 구현: `frontend-developer` · `backend-developer`
- 테스트: `test-server` — E2E: `e2e-web` · `e2e-admin` · `e2e-healer`(깨진 E2E 수리)
- QA: `qa-web` · `qa-admin` — 배포 점검: `test-deployment`

웹 화면을 직접 열어 보는 일(`qa-web`·`qa-admin`)은 `.mcp.json` 의 `playwright` 서버가 맡습니다. 버전을 고정해 두었고(`@playwright/mcp`),
처음 쓸 때 Claude Code 가 승인을 묻고 `npx` 가 패키지를 받습니다(네트워크 필요). 브라우저는 창이 보이는 상태로 열립니다.
이름을 주지 않은 스크린샷·로그는 `.playwright-mcp/`(깃 제외)에 남고, 이름을 직접 준 파일은 저장소 루트 기준으로 저장되니 저장소 밖 경로를 줍니다.

## 명령어

### 루트

| 하고 싶은 것 | 명령 |
|---|---|
| 설치 상태 점검 (읽기 전용) | `pnpm run doctor` (기계 JSON: `pnpm --silent run doctor --json`) |
| 전체 검증 (공통 검사 + 등록된 프로젝트의 서식·타입·린트·테스트·빌드) | `pnpm verify` |
| 빌드를 뺀 빠른 검증 | `pnpm verify:quick` |
| 루트 스크립트·커밋 게이트 시험 | `pnpm test` |
| DB 정책 시험만 | `pnpm test:db` |
| 루트 파일 서식 맞추기 (웹은 `web` 폴더에서) | `pnpm format` |
| 토큰 생성물 다시 만들기 | `pnpm tokens` |
| DB 타입 생성물 다시 만들기 | `pnpm db:types` |
| 생성물·색·서식 검사만 (고치지 않음) | `pnpm check:tokens` · `pnpm check:colors` · `pnpm check:db-types` · `pnpm format:check` |
| 로컬 DB 켜기 (새 마이그레이션 적용, 웹 env 기록) | `pnpm db:start` |
| 로컬 DB 끄기 (데이터는 남습니다) | `pnpm db:stop` |
| 로컬 DB 에 시험 계정·데이터 넣기 (다시 돌리면 처음 상태로, 로컬 전용) | `pnpm db:seed` |
| 클라우드 DB 에 마이그레이션 적용 (**운영 DB 를 바꿉니다**) | `pnpm db:push` |
| 클라우드 DB 상태 확인 (읽기 전용: 연결·적용 이력·RLS) | `pnpm db:verify` |

### 웹 — `pnpm -C web <명령>`

| 명령 | 하는 일 |
|---|---|
| `dev` | 개발 서버 |
| `build` · `start` | 빌드 · 빌드 결과 실행 |
| `verify` | 서식 → 타입 → 린트 → 테스트 → 구조(lodestar) → 토큰 → 색 → 빌드 |
| `test` | Vitest (브라우저 없이 도는 시험) |
| `test:e2e` | 브라우저 시험(`e2e/` 의 Playwright 시험 뒤 `test:browser`). 빌드한 뒤 실행합니다. 처음에는 `pnpm -C web exec playwright install chromium` |
| `test:e2e:auth` | 로그인 뒤 E2E(`e2e-auth/` — 대시보드·작업·멤버·초대·관리자 화면). 로컬 Supabase 에 시드를 다시 넣고 시드 계정으로 돕니다. 빌드한 뒤 실행하고, `verify`·CI 에는 들어 있지 않습니다 |
| `test:browser` | 부품 레이아웃 시험(`*.browser.test.tsx`). 빌드는 필요 없습니다 |
| `format` | 서식 맞추기 |

시험마다 무엇을 보는지는 `testing` 스킬(`.claude/skills/testing/SKILL.md`)에 있습니다.

의존성 갱신 PR(Dependabot)이 언제 도는지는 [구조가 막아 주는 것들](guardrails.md#ci)에 있습니다.

패키지는 쓰는 폴더 안에서 추가합니다(`pnpm -C web add <패키지>`). 루트에 넣지 않습니다.
