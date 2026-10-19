@docs/CLAUDE.md
@AGENTS.md

# Claude Code

## 지침 우선순위

1. **`docs/CLAUDE.md` 와 SOL RADAR 설계 문서(`docs/00-README.md` ~ `docs/20-GLOSSARY.md`)가 정본이다.**
   기술 스택은 Next.js + Supabase(Postgres·RLS·Auth) + Redis/BullMQ + MinIO + Qdrant + Python AI(Qwen·Kev) + Docker Compose 다(`docs/16-DECISIONS.md` ADR-015·017).
   해커톤 뒤에는 API·worker 를 NestJS 로 옮긴다(ADR-028). 그 전에는 위 스택 그대로다.
2. `AGENTS.md` 는 저장소를 시작한 템플릿(agentic-boilerplate)의 규칙이다. 설계 문서와 부딪히지 않는 것만 따른다
   — 커밋 메시지 형식, 커밋 게이트·훅·린트를 끄거나 돌아가지 않기, pnpm, `pnpm verify`.
3. 부딪히면 설계 문서를 따른다. 템플릿의 Supabase(인증·DB·RLS·anon 키)·`web/server/<도메인>/` 구조와, 이것을 다루는 `docs/boilerplate/` 문서·스킬·에이전트(`.claude/`)는
   설계와 일치하므로 따른다(ADR-017). 여전히 템플릿 기준이라 따르지 않는 것은 Expo 앱(`mobile/`, 지웠다)과 Vercel·EAS 배포 전제(배포처 미결정, `docs/16-DECISIONS.md` 미결정 8번)다.

스킬·명령은 `.claude/` 에서 읽는다. 검증 설정의 정본은 `verify.config.json` 이다.
