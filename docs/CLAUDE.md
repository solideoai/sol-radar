---
title: "Claude Code 지침 — SOL RADAR"
status: draft
tags:
  - sol-radar
  - claude
updated: 2026-10-27
---

# Claude Code — SOL RADAR 지침

이 문서와 설계 문서([[00-README|00 인덱스]]의 문서 표에 있는 설계 문서 전부)가 저장소 지침의 정본이다. 루트 `CLAUDE.md`가 이 문서를 먼저 불러오고, 루트 `AGENTS.md`(출발 템플릿 규칙)와 부딪히면 이쪽을 따른다(`docs/16-DECISIONS.md` ADR-015). 템플릿의 Supabase(인증·DB·RLS·anon 키)와 `web/server/<도메인>` 구조 규칙은 설계와 같으므로 따른다(ADR-017).

반드시 `docs/00-README.md`부터 읽고 `docs/17-CLAUDE-IMPLEMENTATION.md`에 따른다. 해커톤 범위와 데모 흐름은 `docs/18-HACKATHON.md`, `docs/19-DEMO-SCENARIO.md`, `docs/12-ROADMAP.md`의 해커톤 컷을 따른다.

- 일정: 공식 제출 2026-11-03·발표 2026-11-04(ADR-054). 발표는 덱 20분 + 녹화 클립이고, D1 운영 사이트(`?origin=demo`, `demo:reset` 안 함)는 촬영 경로이자 질의응답 라이브다. 남은 일은 `docs/12-ROADMAP.md` 남은 일정 제안 표와 `docs/PROGRESS.md`를 본다.
- 기술 스택: Next.js + Supabase(Postgres·RLS·Auth·Storage) + Redis/BullMQ + Qdrant + Python(Qwen3.8-Flash-Next + Bosun 결정 모델. `KEV_*`·`/kev` 이름은 호환 유지, ADR-034) + Docker Compose(`docs/16-DECISIONS.md` ADR-017). 이외로 임의 변경하지 않는다.
  - 2026-10-22 배포 기준(ADR-049): Vercel은 web만 실행하고 AI binding을 두지 않는다. 회사 Compose는 기존 Redis를 재사용하는 redis-api·AI gateway·Worker를 맡는다. 관리자 AI 상태도 서비스 token+업무 JWT로 회사 API에 전달한다. 회사 기동·실모델 연결 확인과 코드 준비를 구분한다. 운영 `/health/ready`는 `ai: local`을 보고하고, 회사 AI provider 설정 값은 미확인이다. 실행서는 `infra/company/README.md`다.
  - 코드는 `web/`(화면·Route Handler `/api/v1`·서버 도메인 `web/server/<도메인>`), worker는 `web/worker`, 스키마·RLS는 `supabase/migrations/`(새 파일로만)에 둔다. 별도 API 서버·ORM은 두지 않는다(ADR-001·002 폐기). 해커톤 뒤에는 API·worker를 NestJS로 옮긴다(ADR-028). 그 전에는 위 구조로 구현한다.
  - Supabase가 맡는 것은 DB·Auth·private Storage다. 첨부는 Supabase Storage, 검색은 Qdrant, 큐는 Redis/BullMQ, 모델 호출은 AI gateway(`services/ai`)다.
  - Vercel `frontend`는 회사 Gateway에 서비스 token+사용자 JWT로 HTTPS 접수한다. 회사 `redis-api`만 Redis TCP를 사용하고 웹에 service role을 넣지 않는다. 회사 Redis6379·HTTP loopback6380·기존 Nginx `/redis/`는 유지한다(ADR-045). 운영 변경은 검증 결과를 준비한 뒤 확인받는다.
  - 조직 데이터는 `org_id` + RLS, 업무 역할은 `memberships.sol_role`이다. service role 키는 worker·seed 스크립트와 사람이 로컬에서 직접 돌리는 운영자 CLI(`scripts/ops/`)만 쓴다. 웹 서버(Route Handler·서버 컴포넌트)와 클라이언트 번들에서는 쓰지 않는다. 클라우드 DB 적용(`pnpm db:push`)은 사용자 확인 뒤에만 한다.
- 순서: Phase 0 저장소 정리/인프라 구현 → 검증 → 보고 → 다음 Phase. 핵심 컷(`docs/12-ROADMAP.md` Critical Path)을 먼저 끝낸다. 지금은 제출 준비 단계다.
- `docs/09-SECURITY.md` 우선 준수. 미확인 외부 명세는 mock + ADR(`docs/16-DECISIONS.md`). 최종 결정은 사람이 한다.
- 범위 외: 결제·구독, 모바일, 자동 투찰, 승률 예측. 관련 코드를 쓰지 않는다. 화면은 데스크톱 1280px 이상.
  - 모바일과 결제는 해커톤 이후에도 구현하지 않는다(`docs/16-DECISIONS.md` ADR-007, `docs/17-CLAUDE-IMPLEMENTATION.md` 절대 규칙).
  - 모바일은 1280px 미만 반응형 레이아웃과 네이티브 앱 둘 다다. 템플릿의 `mobile/`(Expo 앱)과 모바일 전용 에이전트는 지웠다. 다시 만들지 않는다.
  - 화면 확인은 1440px·1280px 두 폭으로 한다. 모바일 폭은 확인하지 않는다.
  - 결제는 결제·구독·요금제 화면, 결제 게이트웨이 연동, 관련 패키지 설치를 모두 포함한다.
- `AI_PROVIDER=mock`이 기본. 유료 hosted 모델 API는 사용자 승인 전 호출하지 않는다.
- 솔리데오 고정·가상 직원 200명·가입 부서/직급 필수는 ADR-019와 `polaris/specs/done/2026-10-16-solideo-people-signup.md`를 따른다. 원본 엑셀 실명 재사용 금지, 명부와 Auth 계정 분리, imagegen 기본 도구로 고유 정장 사진 200장.
- 각 작업 후 `docs/PROGRESS.md` 갱신, 증거(테스트 리포트·스크린샷·기동 로그)는 `docs/evidence/`에 저장.
- 해커톤 검증은 [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] "해커톤 검증 정책"(ADR-046)을 우선한다. 개발 중 `pnpm verify:changed`, 통합·제출 전 전체 `pnpm verify`를 실행한다. 같은 코드·입력·환경에서 통과한 검사를 중복 실행하지 않는다. Compose·전체 E2E·독립 리뷰는 변경 영향과 통합 시점에 맞춰 실행한다. 이 정책이 템플릿 및 개별 스킬의 매 단계 전체 검증 지시보다 우선한다.
- 이 `docs/` 폴더는 Obsidian vault다. 문서를 고칠 때 frontmatter와 위키링크 규약(`docs/00-README.md` Obsidian 규약 절)을 유지한다.
- 2026-10-21 사용자 추가 지시로 시험 자체도 MVP 핵심으로 축소했다(ADR-046 개정). 이전 문서·스킬의 전수 행렬·템플릿 회귀를 다시 만들지 않는다. 현재 목록과 삭제 범위는 `docs/evidence/verification/20261021-pruned-tests.json`, 기준은 [[11-TESTING|11 테스트]] "현재 MVP 자동 시험"이다.
- `docs/boilerplate/`는 출발 템플릿(agentic-boilerplate)의 문서다. Supabase·인증·DB 정책 문서는 적용하고, Expo·EAS 문서는 적용하지 않는다. Vercel의 현재 배포 코드는 ADR-049의 web 단독이며 회사 AI runtime을 [[10-DEPLOYMENT|10 배포]]에 따라 사용한다. 2026-10-21 웹·AI 다중 서비스 구성(ADR-044)은 퇴역했다. 로컬 검증과 실제 클라우드 배포 완료는 구분하며, Compose 데모 구성은 유지한다. 이 vault의 문서와 충돌하면 이 vault의 문서를 따른다(분류: `docs/boilerplate/README.md`).

## 관련 문서

- [[00-README|문서 인덱스]]
- [[16-DECISIONS|결정 기록]]
- [[17-CLAUDE-IMPLEMENTATION|구현 규칙]]
- [[PROGRESS|진행 상황]]
