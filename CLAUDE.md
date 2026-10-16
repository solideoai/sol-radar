@docs/CLAUDE.md
@AGENTS.md

# Claude Code

## 지침 우선순위

1. **`docs/CLAUDE.md` 와 SOL RADAR 설계 문서(`docs/00-README.md` ~ `docs/20-GLOSSARY.md`)가 정본이다.**
   기술 스택은 Next.js + NestJS + PostgreSQL(Prisma) + Redis/BullMQ + MinIO + Qdrant + Python AI(Qwen·Kev) + Docker Compose 다(`docs/16-DECISIONS.md` ADR-001·002·015).
2. `AGENTS.md` 는 저장소를 시작한 템플릿(agentic-boilerplate)의 규칙이다. 설계 문서와 부딪히지 않는 것만 따른다
   — 커밋 메시지 형식, 커밋 게이트·훅·린트를 끄거나 돌아가지 않기, pnpm, `pnpm verify`.
3. 부딪히면 설계 문서를 따른다. Supabase(인증·DB·RLS·anon 키), Expo 앱(`mobile/`), `web/server/<도메인>/` 구조, Vercel·EAS 배포,
   `docs/boilerplate/` 문서, 그리고 이것을 전제로 한 스킬·에이전트(`.claude/`)의 지시는 템플릿 기준이다.

스킬·명령은 `.claude/` 에서 읽는다. 검증 설정의 정본은 `verify.config.json` 이다.
