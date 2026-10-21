@docs/CLAUDE.md
@AGENTS.md

# Claude Code

## 지침 우선순위

1. **`docs/CLAUDE.md` 와 SOL RADAR 설계 문서(`docs/00-README.md` 의 문서 표에 있는 설계 문서)가 정본이다.**
   기술 스택은 Next.js + Supabase(Postgres·RLS·Auth·Storage) + Redis/BullMQ + Qdrant + Python AI(Qwen3.8-Flash-Next·Bosun 결정 모델. `KEV_*`·`/kev` 이름은 호환 유지) + Docker Compose 다(`docs/16-DECISIONS.md` ADR-015·017·034).
   해커톤 뒤에는 API·worker 를 NestJS 로 옮긴다(ADR-028). 그 전에는 위 스택 그대로다.
2. `AGENTS.md` 는 저장소를 시작한 템플릿(agentic-boilerplate)의 규칙이다. 설계 문서와 부딪히지 않는 것만 따른다
   — 커밋 메시지 형식, 커밋 게이트·훅·린트를 끄거나 돌아가지 않기, pnpm, `pnpm verify`.
3. 부딪히면 설계 문서를 따른다. 템플릿의 Supabase(인증·DB·RLS·anon 키)·`web/server/<도메인>/` 구조와, 이것을 다루는 `docs/boilerplate/` 문서·스킬·에이전트(`.claude/`)는
   설계와 일치하므로 따른다(ADR-017). 템플릿의 Expo·EAS 전제는 적용하지 않는다. Vercel 배포는 SOL RADAR 정본 ADR-044·045와 검증된 env 선택 경로를 따른다. 데모 기본 Compose와 운영 변경 승인 원칙은 유지한다.

스킬·명령은 `.claude/` 에서 읽는다. 검증 설정의 정본은 `verify.config.json` 이다.
