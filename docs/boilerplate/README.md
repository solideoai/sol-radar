# 출발 템플릿 문서 (agentic-boilerplate)

이 폴더는 저장소를 시작한 템플릿 `agentic-boilerplate`(커밋 `06b8978`, 루트 `template.json`)의 문서입니다.
SOL RADAR 설계 문서는 상위 `docs/` 의 번호 문서(`00-README.md` ~ `20-GLOSSARY.md`)이고, **둘이 다르면 번호 문서가 우선합니다.**

- 지우지 않고 둔 이유: 지금 저장소의 템플릿 코드(`web/`·`mobile/`·`supabase/`)와 스킬·에이전트(`.claude/`)·`AGENTS.md` 가 이 문서를 가리킵니다.
  그 코드가 SOL RADAR 구조([02 아키텍처](../02-ARCHITECTURE.md))로 바뀌면 함께 정리합니다.
- Obsidian vault 규약(frontmatter·위키링크) 대상이 아닙니다. `docs/.obsidian/app.json` 의 제외 목록에 있어 검색·그래프에 나오지 않습니다.
- 폴더 안 문서끼리의 상대 링크는 그대로 동작합니다. 저장소 파일을 가리키는 링크는 `../../` 로 고쳤습니다.

## 분류

| 분류 | 문서 | 내용 | SOL RADAR 기준 |
| --- | --- | --- | --- |
| 저장소 도구 — 지금도 동작 | [guardrails.md](guardrails.md) | 커밋 게이트·훅·린트·CI 가 막는 것 | 유효. 테스트 범위와 수용 기준은 [11 테스트](../11-TESTING.md) |
| | [workflow.md](workflow.md) | Claude 작업 흐름·슬래시 명령 | 유효. Phase 순서·보고 형식·증거 저장은 [17 구현 규칙](../17-CLAUDE-IMPLEMENTATION.md) 우선 |
| | [setup.md](setup.md) | 설치·doctor·DB 고르기·템플릿 복사 | 설치 절만 유효. 실행 환경은 [10 배포](../10-DEPLOYMENT.md) 우선 |
| Supabase 데이터·인증 견본 — 스택 충돌 | [database.md](database.md) | Supabase DB·RLS·환경변수 파일·로그인 견본 | [04 데이터베이스](../04-DATABASE.md)(PostgreSQL + Prisma)로 대체 |
| | [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md) | 간편 로그인·회원 관리 구조 | [09 보안](../09-SECURITY.md)(HttpOnly 쿠키·RBAC)로 대체 |
| | [AUTH-API.md](AUTH-API.md) | 인증·회원 HTTP 주소 | [05 API 명세](../05-API-SPEC.md)(NestJS)로 대체 |
| | [AUTH-SECURITY.md](AUTH-SECURITY.md) | 인증 보안 항목 | [09 보안](../09-SECURITY.md)으로 대체 |
| | [AUTH-TESTING.md](AUTH-TESTING.md) | 인증 자동·수동 시험 | [11 테스트](../11-TESTING.md)로 대체 |
| | [OAUTH-PROVIDERS.md](OAUTH-PROVIDERS.md) | 구글·카카오·네이버 제공자 설정 | 해당 없음(설계 문서에 간편 로그인 없음) |
| | [SUPABASE-SETUP.md](SUPABASE-SETUP.md) | Supabase 인증 설정 순서 | 해당 없음 |
| 배포 — 스택 충돌 | [first-deployment.md](first-deployment.md) | 웹 Vercel·앱 EAS 첫 배포 | [10 배포](../10-DEPLOYMENT.md)(Docker Compose)로 대체. 앱은 범위 외 |

스택 충돌의 근거: [17 구현 규칙](../17-CLAUDE-IMPLEMENTATION.md) 절대 규칙의 "Supabase 전용 인증/스토리지 사용 금지"와
"모바일 레이아웃·1280px 미만 breakpoint·네이티브 앱 코드 작성 금지", 그리고 [16 ADR](../16-DECISIONS.md) ADR-007.
