---
title: "Bosun 영어 State 번역 구현 계획"
status: draft
tags: [sol-radar, ai, test]
updated: 2026-10-22
---

# Bosun English State Implementation Plan

> Execute inline using superpowers:executing-plans. User requested analysis, plan presentation, then implementation in this session.

**Goal:** 검증된 한국어 공고/기업 사실을 근거 보존한 영어 State로 전달한다.
**Architecture:** StateBuilder 경로 수집 → 별도 Qwen 번역 → 결정적 검증 → State 렌더링. 추출과 번역은 같은 deadline이다. 기업 번역은 /kev의 기존 deadline 안에서 처리한다.
**Tech Stack:** Python, FastAPI, httpcore, pytest, TypeScript, Vitest.
**Spec:** polaris/specs/in-progress/2026-10-22-bosun-translations.md (사용자 요구사항)

## Global Constraints

- translations: dict[str, str], 원문 payload/quotedText 불변.
- 추출 prompt/schema 변경 없음. mock/fixture/live 계약 유지.
- 운영 서버/배포/GPU/DB/env 변경 없음. 별도 브랜치에서 작업.

## Review Focus

- 검증 전 추출 값/UNKNOWN 값이 번역에 들어가지 않아야 한다.
- 숫자/기술명/범위/부정 조건 손실 또는 추가 시 거부한다.
- 기업 경로와 기존 trace recordKey를 혼동하지 않는다.
- 타임아웃/과대 응답이 추출 성공을 실패로 바꾸지 않는다.
- 캐시 translations=null 및 기업 번역 실패는 실제 Bosun을 차단한다.

### Task 1: 경로와 검증

**Files:** kev_state.py, kev_state_v02.py, new translation.py, tests/test_translation.py.
**Interfaces:** collect_notice_texts(extraction, dictionary), collect_profile_texts(request, dictionary), valid_translation(source, candidate, guard), StateBuilder.text(value, path).
- [x] 실패 테스트: 한국어 기술/자격 detail/실적/인력/기업 경로 및 숫자·기술명·조건/인젝션 거부.
- [x] Builder의 실제 text 호출에서 대상을 수집하고 profileSummary.* 경로를 사용한다.
- [x] 안전성 검사와 크기 제한 구현, 관련 테스트 통과 확인.

### Task 2: 추출 후 번역

**Files:** adapters/base.py, adapters/qwen.py, translation.py, extraction.py, prompts/state-translate.v0.1.md, schemas/state-translation.v0.1.json, tests/test_translation.py.
**Interfaces:** TranslationAdapter.translate(values: dict[str,str], *, deadline: Deadline) -> str; translate_texts returns accepted values and path-only warnings.
- [x] 가짜 Qwen 서버 성공/오류/타임아웃/불완전 응답 테스트를 먼저 실패시킨다.
- [x] 기존 endpoint 인증/HTTP/Deadline 재사용, 추출과 독립 프롬프트·응답 검증 구현.
- [x] 최종 검증 뒤만 번역, payload 불변, 실패는 PENDING_REVIEW 및 warnings.
- [x] 기존 추출 10개와 신규 테스트 통과 확인.

### Task 3: Bosun 안전 게이트와 Worker

**Files:** adapters/kev.py, app.py, contracts.py, web/server/analysis/{analysis.model.ts,analysis.service.ts,gateway.model.ts}, tests.
**Interfaces:** /kev warnings is additive and optional for old clients; existing KEV_UNAVAILABLE error disables assist. Worker forwards missing path diagnostics into existing diagnostics.
- [x] 실제 v0.2 State 영문/trace 원문 보존/누락 차단/기업 번역 실패 테스트를 먼저 실패시킨다.
- [x] 기존 deadline 내 기업 번역, notice 누락은 재호출 없이 차단, mock fixture 경로 유지.
- [x] Worker 번역 전달/안전 플래그 및 fixture/live 테스트.
- [x] verify:changed 및 전체 verify 수행, 변경 목록/검증 결과/한계 기록.

## 진행 기록

- baseline: test_extraction_schema.py + test_local_qwen.py = 10 passed.
- Ruling: main 작업 트리는 사용자 변경이 있어 main HEAD 기반 격리 worktree를 사용한다. 내장 worktree 생성 실패 후 Git fallback.
- Ruling: 사용자 지시대로 계획 제시 후 같은 세션에서 구현한다. 확인 질문/별도 승인 단계는 추가하지 않는다.

## 관련 문서

- [[03-AI-PIPELINE]]

- Task 1 complete: Builder 경로/기업 경로/자격 detail과 공통 검증 구현. 조건 반전 5개를 독립 리뷰에서 확인하고 RED → GREEN으로 수정했다.
- Task 2 complete: 추출 후 번역·실패 시 payload 불변·공유 Deadline·요청/응답 상한. 기존 추출 10개 포함 최종 AI138 통과.
- Task 3 complete: 실제 v0.2 영문 State/trace·누락 시 Bosun 차단·Worker 진단/상세 화면 플래그. 전체 pnpm verify 통과(루트191, 웹446, AI138, 결정57, Next 빌드).
- Ruling: 통합 UI 계약이 새 플래그를 거절하는 것을 실패 테스트로 확인했다. bids의 reviewFlagSchema와 라벨을 함께 추가했다.
- Ruling: 사용자가 요청한 별도 브랜치 구현 결과로 남긴다. main 병합/push/배포는 하지 않으며, 커밋하지 않은 변경을 포함한 전체 파일 목록을 검증 보고서에 기록한다.
