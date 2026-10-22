---
title: "커밋된 미통합 작업 push·main 통합 계획"
status: done
updated: 2026-10-22
---

# 커밋된 작업 통합 계획

**Goal:** 사용자가 요청한 로컬 미발행 커밋을 원격에 보존하고, 실제 기능을 최신 main에 통합한다.

**Architecture:** main `d57fcae`에서 native 격리 작업 트리를 사용한다. 기존 미커밋 파일은 덮어쓰거나 임의로 새 커밋하지 않는다. 이미 별도 브랜치에 커밋된 동일 사본은 사용자 요청 범위에 포함하고, 원래 작업 폴더 상태와 대조해 보존한다. 원본·재정리 브랜치의 이력은 남기되 같은 SQL·기능·시험을 중복 도입하지 않는다.

**Tech Stack:** 기존 Next.js16·Supabase RLS/Auth/Storage·Redis/BullMQ·Python Qwen/Bosun. 모델·점수·권한 핵심 정책과 ADR-046을 유지한다.

**Spec:** 사용자 “지금까지 커밋은 했는데 push 안 된 것들 push 하고 main에 합쳐”, `docs/CLAUDE.md`, `docs/17-CLAUDE-IMPLEMENTATION.md`.

## 제약과 검토 초점

- 기존 main의 공공조달 UI·인력200·새4개 업무화면·원자 프로젝트수정·Storage·실제 Qwen served ID를 보존한다.
- append-only는 main 정본에 적용한다. 아직 main에 채택되지 않은 구버전 migration은 원본 브랜치에 보존하고, 현재 제약과 충돌하는 동작은 새로운 전진 migration으로 이식한다. 운영 SQL은 실행하지 않는다.
- 과거에 삭제한 시험을 일률 복원하지 않는다. 새 기능의 핵심 동작과 실제 통합 결함만 검증한다.
- 회사 배포·실수집·메시지 실발송·모델 기동/교체·시드/리셋은 실행하지 않는다.
- Git 시험에서 생긴 `recovery/first-bundle-hook-baseline-20261021`은 제품 작업이 아니므로 통합 대상에서 제외하고 로컬 복구 ref를 보존한다.
- 주요 실패 조건: 중복 migration, 오래된 정책 덮어쓰기, 분석 결과 DB flag 거부, Worker 중복 등록, 비밀값 발행, 다른 세션의 수정 손실.

## 실행 순서

- [x] origin fetch 및 모든 로컬 브랜치의 ancestry·patch-equivalence·미발행 커밋을 조사한다.
- [x] 원본 main의 patch/status 사본을 보존하고 native 작업 트리를 만든다.
- [x] AI 번역·인용 ID·커밋된 인증/데모 사본을 통합한다. 새 review flag의 SQL 저장과 기존 health reporter를 확인한다.
- [x] 회사 runtime 준비 묶음, 부처 공고·카카오 재정리본, N2·N3·N6·P0-8·S5·C9 및 문서/발표 자료를 현재 구현과 대조해 통합한다.
- [x] 중복·구버전 브랜치는 새 구현과의 파일/동작 대응을 기록하고 원본 이력도 연결한다. 초기 FX01은 현재 main이 해당 원본 구현을 이미 포함하는지 확인하고 오래된 v0.1/대형 시험을 다시 도입하지 않는다.
- [x] 합친 migration에서 DB 타입을 생성하고 변경 범위 검사, 최종 전체 `pnpm verify`, 영향 사용자 흐름 브라우저 확인 및 독립 통합 검토1회를 수행한다.
- [x] 비밀값/실제 env/기존 migration 불변 검사를 통과한 원본 브랜치와 통합 커밋을 push한다. main에 통합하고 기존 미커밋 파일을 보존하고 이미 통합된 동일 커밋 사본과 대조한다.
- [x] 원격 ref 일치·미통합 제품 커밋0·미해결 충돌0을 확인하고 완료/제외/운영 미적용을 보고한다.

완료 기준은 정상 게이트를 통과한 최신 main과 원격 일치다. 원본 브랜치·worktree·안전 사본은 삭제하지 않는다.

검증 체크포인트: 전체202/469/153/57·Next빌드, localhost DB49개/기존데이터불변, 변경화면18개·14스크린샷 통과. 제품 브랜치17개는 먼저push됐으며 기능/원본이력 통합커밋·최종main push는 후속 실행한다.

완료: 기능 `6b4ff0a`·원본 이력 `73eac5a`를 main에 fast-forward하고 push했다. 첫 원격 main SHA 일치·제품21개 tip 도달·미발행 제품 commit0·미해결 충돌0을 확인했다. Git 시험용 복구 ref와 안전 stash는 보존한다. 현재 작업 폴더의40개는 이미 커밋된 동일 사본으로 통합됐으므로 과거 내용을 다시 덮어쓰지 않는다. [최종 기록](../evidence/committed-integrations/integration.md).
