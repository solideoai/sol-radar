# 출발 템플릿 문서 (agentic-boilerplate)

이 폴더는 저장소를 시작한 템플릿 `agentic-boilerplate`(커밋 `06b8978`, 루트 `template.json`)의 문서입니다.
SOL RADAR 설계 문서는 상위 `docs/` 의 번호 문서(`00-README.md`부터)이고, **둘이 다르면 번호 문서가 우선합니다.**

- SOL RADAR 는 [16 ADR](../16-DECISIONS.md) ADR-017(2026-10-16)부터 템플릿과 같은 Next.js(`web/`) + Supabase(Postgres·RLS·Auth) 구조를 씁니다.
  그래서 Supabase 데이터·인증 문서는 번호 문서와 부딪히지 않는 범위에서 그대로 적용합니다. Expo 앱(`mobile/`)은 지웠고(ADR-007) 문서에 남아 있던 앱(Expo·EAS) 내용도 걷어 냈습니다(2026-10-18).
  Vercel은 web 하나만 배포하고(ADR-049) 회사 서버가 redis-api·AI gateway·Worker를 맡습니다. 현재 배포 기준은 [10 배포](../10-DEPLOYMENT.md)이고 운영 반영 기록은 [진행 상황](../PROGRESS.md)에 있습니다. Compose 데모 경로는 유지합니다.
- 템플릿 원본에만 있는 도구(`pnpm bootstrap`·`pnpm smoke:template`·`scripts/template/`·`.github/workflows/template.yml`)의 사용법도 걷어 냈습니다. 이 저장소에는 그 도구가 없습니다.
- 지우지 않고 둔 이유: 템플릿 코드(`web/`·`supabase/`·`scripts/`)와 스킬·에이전트(`.claude/`)·`AGENTS.md` 가 이 문서를 가리키고, SOL RADAR 도 같은 구조를 씁니다.
  템플릿 견본 도메인(작업 `tasks` 등)을 정리할 때 해당 절을 함께 정리합니다.
- Obsidian vault 규약(frontmatter·위키링크) 대상이 아닙니다. `docs/.obsidian/app.json` 의 제외 목록에 있어 검색·그래프에 나오지 않습니다.
- 폴더 안 문서끼리의 상대 링크는 그대로 동작합니다. 저장소 파일을 가리키는 링크는 `../../` 로 고쳤습니다.

## 분류

| 분류 | 문서 | 내용 | SOL RADAR 기준 |
| --- | --- | --- | --- |
| 저장소 도구 — 지금도 동작 | [guardrails.md](guardrails.md) | 커밋 게이트·훅·린트·CI 가 막는 것 | 유효. 단 GitHub Actions job 은 멈춰 있어 로컬 pre-push 게이트로 검사한다([11 테스트](../11-TESTING.md) §2). 테스트 범위와 수용 기준은 11 |
| | [workflow.md](workflow.md) | Claude 작업 흐름·슬래시 명령 | 유효. Phase 순서·보고 형식·증거 저장은 [17 구현 규칙](../17-CLAUDE-IMPLEMENTATION.md) 우선 |
| | [setup.md](setup.md) | 설치·doctor·DB 고르기·템플릿 개선분 가져오기 | 설치 절과 DB 고르기(클라우드) 절 유효. 실행 환경은 [10 배포](../10-DEPLOYMENT.md) 우선 |
| Supabase 데이터·인증 — 적용 (ADR-017) | [database.md](database.md) | Supabase DB·RLS·환경변수 파일·로그인·조직 견본 | 적용. anon 키 기본 통로, `org_id in (select public.my_org_ids())`, append-only 마이그레이션, `pnpm db:types`·`pnpm db:push`(사용자 확인 뒤) 규칙 그대로. SOL RADAR 표·`memberships.sol_role`·공용 공고 표 정책·seed(`pnpm demo:reset`)는 [04 데이터베이스](../04-DATABASE.md) 우선. 작업·활동 견본(`tasks`·`activities`)은 지우지 않는다. `tasks` 는 ADR-021 P1 입찰 프로젝트 체크리스트로 재사용하고(`bid_project_id` 열은 `20261022000300_bid_projects`), 사이드바 "작업" 메뉴는 N1 앱 셸 때 뺐다([04 데이터베이스](../04-DATABASE.md) §7, [12 로드맵](../12-ROADMAP.md) Phase 0, [16 ADR](../16-DECISIONS.md) ADR-021) |
| | [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md) | 인증 역할 분리·토큰 검증·`auth.users`↔`profiles`·정지·탈퇴 | 토큰 검증·`profiles`·계정 상태 구조와 간편 로그인(OAuth) 흐름은 적용(ADR-018). service_role 키는 worker·seed·사람이 로컬에서 직접 실행하는 운영자 CLI만 쓴다([09 보안](../09-SECURITY.md) 우선) |
| | [AUTH-API.md](AUTH-API.md) | 템플릿 회원 API(`/api/auth/*`·`/api/users/me` 등) | 토큰 검증 규칙(JWKS·`iss`·`aud`·`role`)은 참고. SOL RADAR 외부 계약은 [05 API 명세](../05-API-SPEC.md)(`/api/v1`) 우선 — 템플릿 `/api/*` 는 Bearer 만 받지만 `/api/v1` 은 세션 쿠키(+ `X-Requested-With: sol-radar`) 또는 Bearer 를 받는다 |
| | [AUTH-SECURITY.md](AUTH-SECURITY.md) | 인증 보안 항목·쿠키·CSP·요청 수 제한 | 쿠키(HttpOnly 아님·SameSite=Lax·운영 Secure)·CSP nonce·신뢰하는 값은 적용. CSRF(`/api/v1` 쿠키 요청의 헤더 검사)·요청 수 제한(분석·수집은 Redis)·service_role 사용 범위는 [09 보안](../09-SECURITY.md) 우선 |
| | [AUTH-TESTING.md](AUTH-TESTING.md) | 인증 자동·수동 시험 | 시험 방식(PGlite 정책 시험 `pnpm test:db`·Vitest·`test:e2e:auth`)은 적용. 골든·수용 기준은 [11 테스트](../11-TESTING.md) 우선. OAuth 수동 확인은 제공자를 설정한 뒤 한다(ADR-018 후순위) |
| | [SUPABASE-SETUP.md](SUPABASE-SETUP.md) | Supabase 프로젝트·환경 변수·대시보드·첫 운영자 | 적용(개발은 Supabase 클라우드 프로젝트). 제공자 줄은 적용(ADR-018 후순위). manual linking(로그인 수단 연결)은 설정 화면 `login-methods`에 있다. SOL RADAR 환경 변수 전체는 [10 배포](../10-DEPLOYMENT.md) 우선. Auth 세부 설정값은 16 ADR 미결정 10번 |
| | [OAUTH-PROVIDERS.md](OAUTH-PROVIDERS.md) | 구글·카카오·네이버 제공자 설정 | 적용(ADR-018). 제공자 설정은 다른 기능을 모두 끝낸 뒤 한다(후순위). 데모 로그인은 seed 계정의 이메일 + 비밀번호 |
| 배포 | [first-deployment.md](first-deployment.md) | Vercel web 단독 배포 안내(ADR-049)와 `engines`·오류 로그 | 루트 `vercel.json`과 회사 런타임 구성은 [10 배포](../10-DEPLOYMENT.md)에 따라 적용. 삭제한 템플릿 빌드 wrapper는 복구하지 않음 |

적용 근거: [16 ADR](../16-DECISIONS.md) ADR-017(Next.js + Supabase 전환)과 ADR-015(지침 우선순위 갱신).
적용하지 않는 범위는 ADR-007(모바일·결제 제외)을 따릅니다. 데모 대체 경로는 ADR-023, 현재 배포 기준은 [10 배포](../10-DEPLOYMENT.md)(ADR-049)를 따릅니다.
