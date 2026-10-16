# agentic-boilerplate

클로드 코드(Claude Code)로 **Next.js 웹·Expo 앱·Supabase** 프로젝트를 한 저장소에서 만들고, 그 뒤로도 계속 키워 가기 위한 보일러플레이트입니다.

핵심은 **"똑똑한 프롬프트가 아니라 가드레일"** 입니다. 결과물이 무너지지 않도록 검증을 사람의 기억이 아니라
구조(커밋 게이트·훅·린트·CI)가 강제합니다.

- 웹(Next.js 16)과 앱(Expo SDK 57)이 같은 Supabase DB 와 같은 디자인 토큰(`design/tokens.json`)을 씁니다. 둘은 workspace 가 아니라 각자 설치하는 독립 프로젝트입니다.
- 작은 일은 클로드가 바로 만들고 `/verify` 로 검증합니다. 큰 일은 인터뷰 → 스펙 → 계획 → 단계별 구현 →
  독립 검증 순서로 갑니다.
- 서식·타입·린트·테스트·계층 경계·색·DB 정책이 어긋나면 커밋이 막힙니다.
- 가입 → 로그인 → 본인 프로필 읽기 → 로그아웃 견본(웹 `/auth/login`·설정 화면, 앱 계정 화면)이 새 기능을 짓는 기준 코드입니다.
  웹에는 비밀번호 재설정과, 표시 이름을 고치는 쓰기 견본(서버 함수 → 도메인 검증 → RLS)도 있습니다.
- 조직 견본은 멀티테넌시의 기준 코드입니다. 모든 데이터는 조직에 속하고, 가입하면 개인 조직이 생기며, 협업은 팀 조직을 만들어
  이메일로 초대합니다. 역할(owner·member)과 권한은 DB 의 RLS 정책이 지킵니다.
- 작업·활동 견본(웹 작업 화면·대시보드)은 "조직의 행 여러 개"의 기준 코드입니다. 거르기·정렬·쪽이 있는 데이터 표, 추가·편집·삭제,
  DB 집계 함수로 낸 대시보드 수치, DB 트리거가 남기는 활동 기록이 들어 있습니다. 앱에는 로그인 견본만 있습니다.
- 웹은 첫 화면(랜딩), 로그인(이메일, 설정하면 구글·카카오·네이버), 로그인 뒤의 대시보드·작업·설정·멤버(사이드바와 조직 전환기가 있는 앱 틀), 팀 만들기·받은 초대,
  운영자만 여는 관리자 화면(`/admin`, 사용자 목록)까지 들어 있습니다.

## 빠른 시작

준비물: Node.js 22.13 이상 또는 24.3 이상(루트 `package.json` 의 `engines`, CI 는 `.nvmrc` 의 22), pnpm 9(`corepack enable`), git, Claude Code.
**Windows** 는 명령을 Git Bash 에서 실행합니다.

```bash
pnpm install --frozen-lockfile            # 루트 — 설치하면서 커밋 게이트가 켜집니다
pnpm -C web install --frozen-lockfile     # 웹
pnpm -C mobile install --frozen-lockfile  # 앱
pnpm run doctor                           # 설치 상태를 읽기만 하는 점검

pnpm -C web dev                           # 웹 — http://localhost:3000
pnpm -C mobile start                      # 앱 — 폰의 Expo Go 로 QR 스캔
pnpm verify                               # 전체 검증 — 서식·타입·린트·테스트·빌드
```

env 파일이 없어도 두 화면은 열리고 `pnpm verify` 도 통과합니다. DB 는 나중에 붙입니다 — 로컬은 Docker·Supabase CLI 를 갖추고 `pnpm db:start`,
클라우드는 각 폴더의 `.env.example` 을 보고 채웁니다([데이터베이스](docs/database.md)).

그다음 저장소 루트에서 `claude` 를 열고 `/setup` 을 입력합니다. 막히면 `/help` 입니다.

## 새 프로젝트로 시작하기

이 저장소를 그대로 고쳐 써도 되고, 새 폴더로 복사해 시작해도 됩니다.

```bash
pnpm bootstrap ../my-app --name my-app    # 웹과 앱 둘 다. 하나만이면 --mode web 또는 --mode mobile
```

설치와 Git 초기화는 대신 하지 않습니다. 새 폴더에서 `git init` → 위의 설치 → `pnpm run doctor` → `pnpm verify` 순서로 이어 갑니다.
플래그·복사 범위는 [설치와 설정](docs/setup.md#새-프로젝트로-복사하기-선택), 템플릿이 나중에 고쳐졌을 때 가져오는 법은
[템플릿 개선분 가져오기](docs/setup.md#템플릿-개선분-가져오기)에 있습니다.

## 일하는 법

| 일의 크기 | 흐름 |
|---|---|
| 작은 일 (화면 하나·표 하나·결함 하나) | 말하면 클로드가 규칙 스킬대로 구현 → `/verify` 초록불까지 → 배포 전 `/predeploy-review` |
| 큰 일 (여러 단계·여러 영역) | `/interview` → `/spec` → 계획 승인 → 단계별 구현(단계마다 `/verify`) → `/spec-check`·테스트·QA 는 다른 에이전트가 → `/predeploy-review` |

"다 됐다"는 `pnpm verify` 가 통과한 뒤에만 말합니다. 첫 배포는 사람이 직접 설정합니다 — [첫 배포 안내](docs/first-deployment.md).

## 다른 스택을 더할 때

다른 스택(Python 등)도 `verify.config.json` 에 등록하면 함께 검증하지만, 일부 장치는 기본 웹·앱 폴더 전용입니다
([다른 스택 추가](docs/setup.md#내-프로젝트에-맞추기)).

| 등록한 스택에도 그대로 | `web`·`mobile` 전용 |
|---|---|
| `pnpm verify`·커밋 게이트·CI 의 프로젝트 검증(등록한 설치·검증 명령), 커밋 메시지 규칙, 클로드 훅, 루트 시험·서식 | 디자인 토큰 생성·색 검사, lodestar 계층 검사(웹), DB 타입 생성, 서식 설정을 바꿨을 때 커밋 게이트의 폴더별 서식 검사 |

## 더 읽을 곳

| 문서 | 내용 |
|---|---|
| [설치와 설정](docs/setup.md) | 스택·폴더 구조, 준비물, `pnpm bootstrap`, 설치·doctor, DB 고르기, 웹만·앱만·다른 스택 맞추기, 템플릿 개선분 가져오기 |
| [클로드와 함께 만들기](docs/workflow.md) | 작은 일·큰 일, 슬래시 명령, 서브 에이전트, 루트·웹·앱 명령어 |
| [데이터베이스](docs/database.md) | 환경변수 파일, RLS 규칙, 로그인·조직·작업·활동 견본, 가입·재설정 메일 맞추기, 실제 로그인·초대 확인 |
| [인증 구조](docs/AUTH-ARCHITECTURE.md) | 간편 로그인(구글·카카오·네이버)·회원 관리·회원 API. 설정·제공자·API·보안·시험은 같은 폴더의 `AUTH-*`·`OAUTH-PROVIDERS`·`SUPABASE-SETUP` |
| [구조가 막아 주는 것들](docs/guardrails.md) | 디자인 토큰, 커밋 메시지·게이트, 린트·계층·생성물, CI·템플릿 스모크 |
| [첫 배포 안내](docs/first-deployment.md) | Vercel·EAS 설정, 환경 변수 자리, 운영 DB 검사 |
| [`AGENTS.md`](AGENTS.md) | 에이전트 공통 규칙의 정본(`CLAUDE.md` 가 불러 씁니다) |
| `verify.config.json` | 검증 설정의 정본 |
| `.claude/skills/<이름>/SKILL.md` | 스킬별 상세 규칙(`database`·`architecture`·`design-system` 등) |
