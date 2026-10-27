# 첫 배포 안내

Vercel은 `web` 서비스 하나만 배포한다(ADR-049, 루트 [vercel.json](../../vercel.json)). 내부 `ai` 서비스와 `web → ai` 바인딩은 없다(ADR-044 대체).
redis-api·AI gateway·Worker는 회사 Compose가 맡는다. 현재 배포 기준은 [10 배포](../10-DEPLOYMENT.md)의 "현재 배포 코드와 회사 기동" 절이고, 운영 반영 기록은 [진행 상황](../PROGRESS.md)에 있다.

## 프로젝트 설정

- Root Directory는 **저장소 루트**(`.` 또는 기본 빈 값)이다. `web/`를 지정하지 않는다.
- `web` 서비스의 root·framework·install 명령은 `vercel.json`이 정한다(`root: web`, `framework: nextjs`, `pnpm install --frozen-lockfile`). 모든 경로는 `web` 서비스로 보낸다.
- AI 상태·분석 접수는 Vercel web이 회사 Gateway에 서비스 token과 사용자 JWT로 HTTPS 요청한다. 웹에는 AI 주소 바인딩이 없다.
- 파일은 private Supabase Storage를 쓴다(ADR-048). 웹과 회사 Worker의 Supabase·Redis·실행 모드가 같아야 요청 처리가 이어진다.
- 환경변수 목록과 외부 연결 조건은 [10 배포](../10-DEPLOYMENT.md)를 따른다. `SUPABASE_SERVICE_ROLE_KEY`·공공 API 서비스키·DDL용 DB 연결 문자열을 웹 배포 설정에 넣지 않는다. 웹 DB 접근은 anon 키와 사용자 세션·RLS를 쓴다.

## 배포 전 확인

1. 통합 코드의 `pnpm verify`와 영향 흐름 검증 결과를 확인한다(문서만 바꾼 경우는 [17 검증 정책](../17-CLAUDE-IMPLEMENTATION.md)의 문서 전용 기준).
2. `/predeploy-review`로 변경 관련 배포 검토를 한다.
3. Vercel 프로젝트 환경변수, 회사 Gateway 접근, Supabase Auth의 배포 URL 설정을 확인한다.
4. 운영 DB 적용(`pnpm db:push`)과 실제 배포는 사용자가 승인한 범위에서 따로 진행하고 결과를 기록한다. 구성 파일이 있다는 것만으로 배포 완료로 표시하지 않는다.

## Node 버전과 `engines`

`engines`는 루트 `package.json`에만 두고 `web/package.json`에는 두지 않는다. 템플릿 원본 기록에 따르면 `web/package.json`에 `engines`가 있으면 Vercel이 프로젝트의 Node 설정(22.x, `.nvmrc`와 같은 메이저)을 덮고 범위 안의 가장 높은 메이저(24)를 고른다. 루트의 `engines`는 Vercel이 읽지 않는다. 현재 Vercel 프로젝트의 Node 설정값은 이 문서에서 확인하지 않았다(미확인).

## 오류 로그 보는 곳

외부 오류 수집 업체는 붙이지 않았다. 서버 오류는 배포 플랫폼의 로그에 JSON 한 줄로 남는다.

- **어디서**: Vercel 프로젝트의 Logs(실행 로그). `next start`로 직접 띄운 서버면 그 프로세스의 표준 오류 출력이다.
- **무엇이**: Next가 잡은 서버 오류(서버 렌더·라우트 핸들러·서버 함수·proxy)마다 `web/instrumentation.ts`의 `onRequestError`가 `web/server/shared/error-report.ts`의 `reportServerError`를 거쳐 한 줄을 쓴다. 키는 `level`·`source`·`time`·`name`·`message`·`digest`·`path`·`method`·`routePath`·`routeType`이다. `path`는 검색어를 뗀 요청 경로다.
- **사용자가 본 오류와 맞춰 보기**: 오류 화면의 오류 번호가 `digest`다. 로그에서 그 번호로 찾는다.
- **남기지 않는 것**: 쿠키·인증 헤더·요청 본문·검색어(`?` 뒤). 오류 메시지에 토큰·비밀값을 넣지 않는다.
- 화면의 오류 경계(`web/app/error.tsx`·`global-error.tsx`)는 같은 모양의 한 줄(`"source":"browser"`)을 그 사용자의 브라우저 콘솔에만 남기고 서버로 보내지 않는다.
- 업체(Sentry 등)를 붙일 때는 `reportServerError`·`reportBrowserError` 두 함수만 고친다. 값이 바깥으로 나가므로 "남기지 않는 것"을 그대로 지킨다.
- Vercel 실행 로그는 요금제마다 보관 기간이 짧다. 오래 남기려면 Log Drains를 쓴다(유료일 수 있음).
- 메일 발송 실패 기록(`web/server/organization/organization.mail.ts`)도 같은 JSON 한 줄이며 오류 문장은 남기지 않는다.

## 과거 템플릿과 달라진 점

템플릿의 Root Directory=`web`, `pnpm vercel-build`, `web/scripts/vercel-build.sh`, `web/scripts/verify-db.mjs`, 전용 DB 검사 역할 생성 절차는 적용하지 않는다. 삭제한 wrapper를 복구하거나 이를 전제로 환경변수·DB 역할을 추가하지 않는다. 과거 내용은 Git 이력에 있다.

## 관련 문서

- [10 배포](../10-DEPLOYMENT.md)
- [09 보안](../09-SECURITY.md)
- [17 구현·검증 정책](../17-CLAUDE-IMPLEMENTATION.md)
