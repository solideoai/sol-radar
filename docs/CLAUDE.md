---
title: "Claude Code 지침 — SOL RADAR"
status: draft
tags:
  - sol-radar
  - claude
updated: 2026-10-19
---

# Claude Code — SOL RADAR 지침

이 문서와 설계 문서([[00-README|00 인덱스]]의 문서 표에 있는 설계 문서 전부)가 저장소 지침의 정본이다. 루트 `CLAUDE.md`가 이 문서를 먼저 불러오고, 루트 `AGENTS.md`(출발 템플릿 규칙)와 부딪히면 이쪽을 따른다(`docs/16-DECISIONS.md` ADR-015). 템플릿의 Supabase(인증·DB·RLS·anon 키)와 `web/server/<도메인>` 구조 규칙은 설계와 같으므로 따른다(ADR-017).

반드시 `docs/00-README.md`부터 읽고 `docs/17-CLAUDE-IMPLEMENTATION.md`에 따른다. 해커톤 범위와 데모 흐름은 `docs/18-HACKATHON.md`, `docs/19-DEMO-SCENARIO.md`, `docs/12-ROADMAP.md`의 해커톤 컷을 따른다.

- 기술 스택: Next.js + Supabase(Postgres·RLS·Auth) + Redis/BullMQ + MinIO + Qdrant + Python(Qwen + Kev) + Docker Compose(`docs/16-DECISIONS.md` ADR-017). 이외로 임의 변경하지 않는다.
  - 코드는 `web/`(화면·Route Handler `/api/v1`·서버 도메인 `web/server/<도메인>`), worker는 `web/worker`, 스키마·RLS는 `supabase/migrations/`(새 파일로만)에 둔다. 별도 API 서버·ORM은 두지 않는다(ADR-001·002 폐기). 해커톤 뒤에는 API·worker를 NestJS로 옮긴다(ADR-028). 그 전에는 위 구조로 구현한다.
  - Supabase가 맡는 것은 DB와 Auth뿐이다. 첨부는 MinIO, 검색은 Qdrant, 큐는 Redis/BullMQ, 모델 호출은 AI gateway(`services/ai`)다.
  - 조직 데이터는 `org_id` + RLS, 업무 역할은 `memberships.sol_role`이다. service role 키는 worker·seed 스크립트만 쓴다. 클라우드 DB 적용(`pnpm db:push`)은 사용자 확인 뒤에만 한다.
- 순서: Phase 0 저장소 정리/인프라 구현 → 검증 → 보고 → 다음 Phase. 핵심 컷(`docs/12-ROADMAP.md` Critical Path)을 먼저 끝낸다.
- `docs/09-SECURITY.md` 우선 준수. 미확인 외부 명세는 mock + ADR(`docs/16-DECISIONS.md`). 최종 결정은 사람이 한다.
- 범위 외: 결제·구독, 모바일, 자동 투찰, 승률 예측. 관련 코드를 쓰지 않는다. 화면은 데스크톱 1280px 이상.
  - 모바일과 결제는 해커톤 이후에도 구현하지 않는다(`docs/16-DECISIONS.md` ADR-007, `docs/17-CLAUDE-IMPLEMENTATION.md` 절대 규칙).
  - 모바일은 1280px 미만 반응형 레이아웃과 네이티브 앱 둘 다다. 템플릿의 `mobile/`(Expo 앱)과 모바일 전용 에이전트는 지웠다. 다시 만들지 않는다.
  - 화면 확인은 1440px·1280px 두 폭으로 한다. 모바일 폭은 확인하지 않는다.
  - 결제는 결제·구독·요금제 화면, 결제 게이트웨이 연동, 관련 패키지 설치를 모두 포함한다.
- `AI_PROVIDER=mock`이 기본. 유료 hosted 모델 API는 사용자 승인 전 호출하지 않는다.
- 솔리데오 고정·가상 직원 200명·가입 부서/직급 필수는 ADR-019와 `polaris/specs/planned/2026-10-16-solideo-people-signup.md`를 따른다. 원본 엑셀 실명 재사용 금지, 명부와 Auth 계정 분리, imagegen 기본 도구로 고유 정장 사진 200장.
- 각 작업 후 `docs/PROGRESS.md` 갱신, 증거(테스트 리포트·스크린샷·기동 로그)는 `docs/evidence/`에 저장.
- 이 `docs/` 폴더는 Obsidian vault다. 문서를 고칠 때 frontmatter와 위키링크 규약(`docs/00-README.md` Obsidian 규약 절)을 유지한다.
- `docs/boilerplate/`는 출발 템플릿(agentic-boilerplate)의 문서다. Supabase·인증·DB 정책 문서는 적용하고, Expo 앱 문서는 적용하지 않으며, Vercel·EAS 배포 문서는 배포처가 정해질 때까지 보류한다. 이 vault의 문서와 충돌하면 이 vault의 문서를 따른다(분류: `docs/boilerplate/README.md`).

## 관련 문서

- [[00-README|문서 인덱스]]
- [[16-DECISIONS|결정 기록]]
- [[17-CLAUDE-IMPLEMENTATION|구현 규칙]]
- [[PROGRESS|진행 상황]]
