# 첫 배포 안내

> [!warning] 보류 문서 (2026-10-19)
> 웹 배포처가 아직 정해지지 않아([16 ADR](../16-DECISIONS.md) 미결정 8번) 이 문서는 보류 상태입니다. 아래 본문이 가리키는 `pnpm vercel-build`(`web/package.json`)·`web/scripts/vercel-build.sh`·`web/scripts/verify-db.mjs` 는 2026-10-19 에 지웠습니다(해당 줄에 "삭제됨" 표시). 배포처가 정해지면 다시 만들고 이 문서를 그때 고칩니다. 나머지 본문은 템플릿 원문 그대로입니다. 서비스 실행은 [10 배포](../10-DEPLOYMENT.md)(Docker Compose)가 우선입니다.

이 문서는 웹(Vercel)의 **첫 배포를 사람이 직접 설정하는 순서**입니다. 시작 순서와 로컬 실행은
[README](../../README.md) 에 있습니다. 이 저장소의 시험은 아래 설정 파일과 빌드 스크립트의 연결만 확인합니다.
실제 Vercel 배포는 이 저장소가 대신 하거나 통과를 보장하지 않습니다.

계정·프로젝트 만들기, 결제, 운영 DB 에 마이그레이션 적용은 모두 **사용자 작업**입니다.
클로드는 이 작업을 대신 실행하지 않습니다.

## 0. 배포 전에

1. `pnpm verify` 가 통과합니다(웹 `next build` 까지).
2. 클로드에서 `/predeploy-review` 로 배포 전 점검을 합니다.
3. Node·pnpm 버전은 저장소의 고정값을 따릅니다. Node 는 [`.nvmrc`](../../.nvmrc) 의 메이저(22),
   pnpm 은 각 `package.json` 의 `packageManager`(`pnpm@9.15.9`)입니다. 배포 서비스에도 같은 메이저를 고릅니다.
4. DB 를 쓸지 정합니다. 템플릿 화면은 DB 없이 열리므로 첫 배포를 DB 없이 해도 됩니다.

## 1. 환경 변수는 어디에 두나

값은 그 값을 읽는 프로그램이 있는 곳에 둡니다. 파일들은 깃에 올라가지 않고, 배포 서비스는 이 파일들을 읽지 않으므로
배포 서비스에는 따로 넣습니다. 설명은 [`.env.example`](../../.env.example)·[`web/.env.example`](../../web/.env.example) 에 있습니다.

| 값 | 로컬 자리 | 배포 자리 | 공개 여부 |
|---|---|---|---|
| `SUPABASE_DB_URL` | 루트 `.env.local` (`pnpm db:push`·`pnpm db:verify` 가 읽음, DDL 권한) | Vercel Production — 읽기 전용 검사 역할의 값 (운영 빌드의 DB 검사가 읽음) | 비밀 |
| `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY` | `web/.env.local` | Vercel (환경마다) | 공개 — 빌드 때 브라우저 번들에 들어감 |
| `SUPABASE_SERVICE_ROLE_KEY` | `web/.env.local` (쓸 때만) | Vercel (쓸 때만) | 비밀 — 기본 준비물이 아님 |
| `REQUIRE_DATABASE` | — | Vercel Production (선택) | 설정값 |
| `SMTP_HOST`·`SMTP_PORT`·`MAIL_FROM`·`SITE_URL` | `web/.env.local` (로컬은 `pnpm db:start` 가 메일함 값을 적음) | Vercel (초대 메일을 보낼 때만) | 서버 전용 설정값 — 접두어를 붙이지 않음 |
| `SMTP_USER`·`SMTP_PASSWORD` | `web/.env.local` (인증 있는 SMTP 일 때만) | Vercel (초대 메일을 보낼 때만) | 비밀 — 서버 전용 |

- 데이터 접근은 anon 키로 하고, 누가 무엇을 읽고 쓰는지는 DB 의 RLS 정책이 정합니다. 그래서 공개 값은 URL 과 anon 키뿐입니다.
- `SUPABASE_SERVICE_ROLE_KEY` 는 RLS 를 무시합니다. 서버 코드에서 `getSupabaseAdmin()` 을 실제로 쓰기 전에는 어디에도 넣지 않습니다.
  넣더라도 `NEXT_PUBLIC_` 접두어를 붙이지 않습니다.
- `SUPABASE_DB_URL`(DB 연결 문자열)도 비밀입니다. 공개 변수에는 넣지 않습니다.
  로컬 값은 표를 만들고 바꾸는 권한(DDL)이 있어 Vercel 에 넣지 않습니다. Vercel 에는 아래
  [배포 검사 전용 DB 역할](#배포-검사-전용-db-역할)의 값을 넣습니다.

## 2. 웹 — Vercel

근거: [Vercel 빌드 설정](https://vercel.com/docs/builds/configure-a-build)

### 프로젝트 설정

Vercel 에서 저장소를 가져온 뒤 프로젝트 설정(Build and Deployment)을 아래처럼 맞춥니다.
기본값이 무엇인지에 기대지 말고, 명령은 Override 를 켜서 직접 적습니다.

| 항목 | 값 | 이유 |
|---|---|---|
| Framework Preset | Next.js | |
| Root Directory | `web` | 루트와 `web` 은 workspace 가 아닌 독립 프로젝트입니다 |
| Root Directory 밖 파일 포함 | 켬 | 아래 설명 |
| Install Command | `pnpm install --frozen-lockfile` | `web/pnpm-lock.yaml` 과 다르면 설치를 멈춥니다 |
| Build Command | `pnpm vercel-build` (삭제됨, 위 콜아웃) | 운영 DB 검사 뒤에 빌드하는 wrapper 를 부릅니다 |
| Node.js Version | 22.x | `.nvmrc` 와 같은 메이저 |

- **Node.js Version 은 프로젝트 설정에서 22.x 로 둡니다.** `web/package.json` 에 `engines` 를 넣으면 Vercel 이 이 설정을 덮고
  범위 안의 가장 높은 메이저(24)를 고르므로 넣지 않습니다(템플릿 원본의 `scripts/template/doctor.test.mjs` 가 지킵니다). 루트의 `engines` 는 Vercel 이 읽지 않습니다.
- **Build Command 를 꼭 `pnpm vercel-build` 로 둡니다.** [`web/package.json`](../../web/package.json) 의 `vercel-build` 가
  `web/scripts/vercel-build.sh` 를 실행합니다(둘 다 삭제됨, 위 콜아웃). 다른 명령으로 빌드하면 아래 운영 DB 검사를 건너뜁니다.
- **Root Directory 밖 파일 포함**: 운영 DB 검사 `web/scripts/verify-db.mjs`(삭제됨, 위 콜아웃) 는 `web` 밖의
  [`scripts/db-verify.mjs`](../../scripts/db-verify.mjs)·`scripts/migrations.mjs` 와 `supabase/migrations/` 를 읽습니다.
  Root Directory 밖 소스를 빌드에 포함하는 설정이 켜져 있는지 확인합니다.
  근거: [Vercel 모노레포 FAQ](https://vercel.com/docs/monorepos/monorepo-faq). 이 설정 때문에 두 폴더를 workspace 로 바꾸지는 않습니다.
- **pnpm 버전**: 첫 빌드 로그에서 pnpm 메이저가 9 인지 확인합니다. 다르면 Vercel 문서의 패키지 매니저·Corepack 안내에 따라
  `packageManager` 고정값을 쓰도록 맞춥니다.

### 환경 변수

근거: [Vercel 환경 변수](https://vercel.com/docs/environment-variables)

Vercel 은 Production·Preview(·Development) 환경마다 값을 따로 둡니다. 값을 바꾸면 이미 끝난 배포에는 반영되지 않으니
**새로 배포(Redeploy)** 합니다. `NEXT_PUBLIC_` 값은 빌드 때 번들에 굳으므로 특히 그렇습니다.

**DB 를 쓰지 않는 사이트**

`NEXT_PUBLIC_SUPABASE_URL`·`SUPABASE_DB_URL`·`REQUIRE_DATABASE` 를 **모두 넣지 않습니다.** 그러면 wrapper 는 DB 검사 없이 바로 빌드합니다.
셋 중 하나라도 운영(Production)에 있으면 DB 를 쓰는 사이트로 보고 검사합니다.

**DB 를 쓰는 사이트 — Production**

| 변수 | 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY` | 운영 Supabase 프로젝트의 URL·anon 키 |
| `SUPABASE_DB_URL` | [배포 검사 전용 DB 역할](#배포-검사-전용-db-역할)의 연결 문자열(Session pooler). 루트 `.env.local` 의 값(DDL 권한)이 아닙니다. 유형은 Secret(옛 이름 Sensitive)으로 넣습니다 |
| `REQUIRE_DATABASE` | (선택) `1`. URL 을 빠뜨려도 검사를 강제해 실수로 DB 없이 배포되지 않게 합니다 |

**초대 메일 — 선택**

팀에 초대하면 웹 서버가 SMTP 로 초대 메일을 보냅니다. 아래 넷이 모두 있어야 보내고, 하나라도 없으면 메일 없이 초대만 저장합니다
(화면이 "직접 알려 주세요"라고 안내합니다). 메일 발송 업체(SMTP 를 주는 곳)는 직접 고릅니다. 무엇을 보내는지는
[데이터베이스 — 초대 메일](database.md#초대-메일)에 있습니다. 모두 서버만 읽는 값이라 `NEXT_PUBLIC_` 를 붙이지 않습니다.

| 변수 | 값 |
|---|---|
| `SMTP_HOST`·`SMTP_PORT` | 메일 업체의 SMTP 주소와 포트. 465 는 처음부터 TLS, 587 은 STARTTLS 입니다 |
| `SMTP_USER`·`SMTP_PASSWORD` | 메일 업체의 SMTP 로그인. 둘 다 넣거나 둘 다 비웁니다. 넣으면 TLS 가 없을 때 보내지 않습니다. `SMTP_PASSWORD` 는 Secret 유형으로 넣습니다 |
| `MAIL_FROM` | 보내는 주소. 메일 업체에서 발신을 허락한(도메인 인증을 마친) 주소여야 받은 편지함에 들어갑니다 |
| `SITE_URL` | 웹의 운영 주소(예: `https://your-domain.com`, 끝의 `/` 없이). 메일의 링크가 `<SITE_URL>/invitations` 입니다. Supabase 의 Site URL 과 같은 값입니다 |

- 보내지 못하면(접속 실패·거절·약 10초 시간 초과) 초대는 그대로 남고, 실행 로그(Vercel → Logs)에 `"event":"invitation-mail-failed"` 한 줄이
  오류 이름·코드·SMTP 응답 번호와 함께 남습니다. 받는 사람 주소는 남기지 않습니다. 변수를 일부만 넣으면 `"event":"invitation-mail-misconfigured"` 한 줄에 빠진 변수 이름이 남습니다.
- Preview 에 넣으면 Preview 에서 초대한 사람에게도 진짜 메일이 갑니다. Preview 에는 넣지 않거나 시험용 SMTP(받기만 하는 메일함)를 씁니다.

**Preview**

현재 wrapper 는 **운영(`VERCEL_ENV=production`) 빌드만** DB 를 검사합니다. Preview 빌드는 DB 값이 있어도 검사 없이 빌드합니다.
Preview 에 운영 DB 값을 그대로 넣지 말고, 넣는다면 별도 개발용 Supabase 프로젝트 값을 씁니다.

### 운영 DB 검사(배포 게이트)가 하는 일

운영 빌드이고 위 세 값 중 하나라도 있으면 wrapper 가 **빌드 전에** `node scripts/verify-db.mjs` 를 실행합니다(삭제됨, 위 콜아웃).

1. `SUPABASE_DB_URL` 로 TLS 인증서를 검증하며 접속하고, 읽기 전용 트랜잭션에서만 확인합니다. 값이 없으면 접속하지 않고 실패합니다.
   별도 CA 가 필요하면 `NODE_EXTRA_CA_CERTS` 로 줍니다.
2. `supabase/migrations/` 의 모든 마이그레이션이 적용 이력(`supabase_migrations.schema_migrations`)에 있는지 봅니다.
3. public 표마다 RLS 가 켜져 있는지 봅니다.
4. 화면 역할(anon·authenticated)에 RLS 를 거치지 않는 위험한 표 권한(TRUNCATE 등)이 없는지 봅니다.
5. public 의 뷰·함수가 RLS 를 거치지 않고 화면 역할에 열려 있지 않은지 봅니다(`security_invoker` 가 아닌 뷰, 화면 역할이 부르는 SECURITY DEFINER 함수 등).

하나라도 어긋나면 **빌드를 시작하지 않고** 배포가 실패합니다. 이 검사는 아무것도 고치거나 적용하지 않습니다.
마이그레이션 적용은 운영자가 배포 **전에** 직접 합니다.

```bash
pnpm db:push     # 운영 DB 에 새 마이그레이션 적용 — 운영 DB 를 바꿉니다. 승인한 사람이 실행합니다
pnpm db:verify   # 같은 검사를 로컬에서 읽기 전용으로 미리 확인 (루트 .env.local 의 SUPABASE_DB_URL)
```

### 배포 검사 전용 DB 역할

근거: [Vercel 환경 변수 관리](https://vercel.com/docs/environment-variables/managing-environment-variables)·
[Vercel Config·Secret 환경 변수](https://vercel.com/docs/environment-variables/sensitive-environment-variables)·
[Supabase 연결](https://supabase.com/docs/guides/database/connecting-to-postgres)·[Supabase 역할](https://supabase.com/docs/guides/database/postgres/roles)

Vercel 의 프로젝트 환경 변수는 **빌드와 함수(Vercel Function) 실행 양쪽에** 들어갑니다. 변수를 빌드 단계에만 두는 설정은 없습니다.
Secret 유형(옛 이름 Sensitive)은 저장한 값을 다시 못 보게 하고, 32자 이상인 값이 빌드 로그에 찍히면 `[REDACTED]` 로 가릴 뿐입니다.
빌드와 함수에서는 그대로 읽힙니다.
`vercel.json` 의 `build.env` 는 프로젝트 환경 변수로 옮기라고 안내하는 옛 방식이라 쓰지 않습니다.
그래서 `pnpm db:push` 용 연결 문자열(표를 만들고 지우는 DDL 권한, RLS 를 거치지 않는 표 주인 권한)을 Vercel 에 넣으면
서버 코드의 취약점 하나로 그 자격이 샙니다. 운영 Vercel 에는 **배포 검사가 읽는 것만 읽는 역할**의 연결 문자열을 넣습니다.
이 값이 새더라도 표의 행은 읽지도 쓰지도 못합니다. 다만 카탈로그는 누구나 읽으므로 표 구조·함수 본문은 보입니다.
새면 아래 방법으로 비밀번호를 바꿉니다.

검사([`scripts/db-verify.mjs`](../../scripts/db-verify.mjs))가 읽는 것은 둘입니다.

- PostgreSQL 카탈로그(`pg_class`·`pg_namespace`·`pg_proc`·`pg_roles`·`pg_depend`)와 권한 함수(`has_table_privilege` 등)·`to_regclass`·서버 버전.
  누구나 읽을 수 있어 따로 줄 권한이 없습니다.
- 마이그레이션 적용 이력 `supabase_migrations.schema_migrations` 의 `version` 열. 이것만 엽니다.

첫 `pnpm db:push` 로 이력 표가 생긴 **뒤에** Supabase 대시보드의 SQL 편집기에서 한 번 실행합니다.
비밀번호가 들어 있으므로 마이그레이션 파일로 만들지 않습니다(깃에 남습니다). 비밀번호는 비밀번호 관리자로 길게 만듭니다.

```sql
-- 배포 검사 전용 역할. 다른 속성(슈퍼유저·역할 만들기·RLS 무시 등)은 기본값대로 없다.
create role deploy_verifier with login password '<비밀번호>';
-- 이 역할로 연 연결은 기본이 읽기 전용이다. 검사도 읽기 전용 트랜잭션에서만 돈다.
alter role deploy_verifier set default_transaction_read_only = on;
-- 검사가 읽는 이력 표의 version 열만 연다. 카탈로그는 원래 누구나 읽는다.
grant usage on schema supabase_migrations to deploy_verifier;
grant select (version) on supabase_migrations.schema_migrations to deploy_verifier;
```

Vercel Production 의 `SUPABASE_DB_URL` 에는 Supabase 의 Connect 화면에 있는 **Session pooler** 연결 문자열에서 사용자와 비밀번호만 바꿔 넣습니다.
공유 pooler 에 사용자 정의 역할로 접속할 때 사용자 이름은 `<역할>.<프로젝트 ref>` 입니다.

```text
postgresql://deploy_verifier.<프로젝트 ref>:<비밀번호>@<pooler 호스트>:5432/postgres
```

- 비밀번호에 특수 문자가 있으면 연결 문자열 안에서는 퍼센트 인코딩합니다(예: `=` → `%3D`).
- 빌드 로그(와 `pnpm db:verify`)의 `DB 검증 실패` 는 접속 주소·비밀값이 섞일 수 있는 오류 원문 대신 코드만 보여 줍니다.
  코드 `42501`(권한 없음)이면 위 권한을, `28P01`(인증 실패)이면 사용자 이름·비밀번호를 확인합니다.
- 비밀번호를 바꿀 때는 SQL 편집기에서 `alter role deploy_verifier with password '<새 비밀번호>';` 를 실행하고, Vercel 값을 바꾼 뒤 다시 배포합니다.
- 루트 `.env.local` 의 값은 그대로 둡니다. `pnpm db:push` 는 표를 만들어야 하므로 이 역할로는 돌지 않습니다.
- 검사가 새로 읽는 것이 생기면 이 역할의 권한도 같이 고칩니다. 템플릿 원본에는 위 SQL 을 이 문서에서 꺼내 흉내 DB 에서
  확인하는 시험(`scripts/template/`)이 있지만 이 저장소에는 없습니다. 권한을 고치면 `SUPABASE_DB_URL` 에 이 역할의 연결 문자열을
  주고 `pnpm db:verify` 를 돌려 직접 확인합니다(환경 변수가 있으면 루트 `.env.local` 보다 먼저 씁니다).

### 첫 배포

1. DB 를 쓴다면 먼저 `pnpm db:push` 로 운영 DB 에 마이그레이션을 적용하고, [배포 검사 전용 DB 역할](#배포-검사-전용-db-역할)을 만듭니다.
2. 위 설정·환경 변수를 넣고 Vercel 화면에서 Deploy 를 누릅니다.
3. 빌드 로그에서 Install Command·Build Command 가 위 값으로 돌았는지, DB 를 쓴다면 DB 검사 성공 줄이 빌드보다 먼저 나왔는지 봅니다.
4. 배포 주소에서 시작 화면이 열리는지 직접 확인합니다.
5. 가입·비밀번호 재설정을 쓴다면 배포 주소가 정해진 뒤 Supabase 대시보드에 Site URL 과 메일 템플릿을 넣습니다.
   순서는 [데이터베이스 — 클라우드에서 가입·재설정 메일 맞추기](database.md#클라우드에서-가입재설정-메일-맞추기-사람이-한-번)에 있습니다.
   넣지 않으면 메일의 링크가 `localhost` 로 가서 가입 확인이 끝나지 않습니다.

### 오류 로그 보는 곳

외부 오류 수집 업체는 붙이지 않았습니다. 서버 오류는 **배포 플랫폼의 로그**에 JSON 한 줄로 남습니다.

- **어디서**: Vercel 프로젝트 → **Logs**(실행 로그). `next start` 로 직접 띄운 서버면 그 프로세스의 표준 오류 출력입니다.
- **무엇이**: Next 가 잡은 서버 오류(서버 렌더·라우트 핸들러·서버 함수·proxy)마다 `web/instrumentation.ts` 의 `onRequestError` 가
  `web/server/shared/error-report.ts` 의 `reportServerError` 를 거쳐 한 줄을 씁니다. Next 가 따로 남기는 오류 원문(호출 스택 포함)도 그 옆에 찍힙니다.

  ```json
  {"level":"error","source":"server","time":"2026-10-15T06:30:00.000Z","name":"Error","message":"…","digest":"708337598","path":"/teams/new","method":"GET","routePath":"/teams/new","routeType":"render"}
  ```

  `path` 는 요청 경로(검색어를 뗀다), `routePath` 는 Next 가 알려 주는 라우트 파일 기준 경로입니다.
  `routeType` 은 `render`(화면)·`route`(라우트 핸들러)·`action`(서버 함수)·`proxy` 중 하나입니다.
- **사용자가 본 오류와 맞춰 보기**: 오류 화면에 나오는 **오류 번호**가 `digest` 입니다. 로그에서 그 번호로 찾습니다(Vercel Logs 검색창에 번호를 넣는다).
- **남기지 않는 것**: 쿠키·인증 헤더·요청 본문·검색어(`?` 뒤). 경로와 오류 메시지만 남기므로, 오류 메시지에 토큰·비밀값을 넣지 않습니다.
- 화면의 오류 경계(`web/app/error.tsx`·`global-error.tsx`)는 같은 모양의 한 줄(`"source":"browser"`)을 **그 사용자의 브라우저 콘솔**에만 남기고 서버로 보내지 않습니다.
- 업체(Sentry 등)를 붙일 때는 `reportServerError`·`reportBrowserError` 두 함수만 고칩니다. 값이 바깥으로 나가므로 위의 "남기지 않는 것"을 그대로 지킵니다.
- Vercel 의 실행 로그는 요금제마다 보관 기간이 짧습니다. 오래 남겨야 하면 Log Drains 로 다른 곳에 보냅니다(유료 기능일 수 있다).
