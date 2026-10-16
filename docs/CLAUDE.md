---
title: "Claude Code 지침 — SOL RADAR"
status: draft
tags:
  - sol-radar
  - claude
updated: 2026-10-16
---

# Claude Code — SOL RADAR 지침

이 문서와 설계 문서(`docs/00-README.md` ~ `docs/20-GLOSSARY.md`)가 저장소 지침의 정본이다. 루트 `CLAUDE.md`가 이 문서를 먼저 불러오고, 루트 `AGENTS.md`(출발 템플릿 규칙)와 부딪히면 이쪽을 따른다(`docs/16-DECISIONS.md` ADR-015).

반드시 `docs/00-README.md`부터 읽고 `docs/17-CLAUDE-IMPLEMENTATION.md`에 따른다. 해커톤 범위와 데모 흐름은 `docs/18-HACKATHON.md`, `docs/19-DEMO-SCENARIO.md`, `docs/12-ROADMAP.md`의 해커톤 컷을 따른다.

- 기술 스택: Next.js + NestJS + PostgreSQL + Prisma + Redis/BullMQ + MinIO + Qdrant + Python(Qwen + Kev) + Docker Compose. 이외로 임의 변경하지 않는다.
- 순서: Phase 0 모노레포/인프라 구현 → 검증 → 보고 → 다음 Phase. 데모 필수 Phase를 먼저 끝낸다.
- `docs/09-SECURITY.md` 우선 준수. 미확인 외부 명세는 mock + ADR(`docs/16-DECISIONS.md`). 최종 결정은 사람이 한다.
- 범위 외: 결제·구독, 모바일 레이아웃, 자동 투찰, 승률 예측. 관련 코드를 쓰지 않는다. 화면은 데스크톱 1280px 이상.
- `AI_PROVIDER=mock`이 기본. 유료 hosted 모델 API는 사용자 승인 전 호출하지 않는다.
- 각 작업 후 `docs/PROGRESS.md` 갱신, 증거(테스트 리포트·스크린샷·기동 로그)는 `docs/evidence/`에 저장.
- 이 `docs/` 폴더는 Obsidian vault다. 문서를 고칠 때 frontmatter와 위키링크 규약(`docs/00-README.md` Obsidian 규약 절)을 유지한다.
- `docs/boilerplate/`는 출발 템플릿(agentic-boilerplate)의 문서다. 이 vault의 문서와 충돌하면 이 vault의 문서를 따른다(분류: `docs/boilerplate/README.md`).
