---
title: "해커톤 검증 축소 구현 계획"
status: done
tags: [sol-radar, hackathon, testing]
updated: 2026-10-21
---

# 해커톤 검증 축소 구현 계획

> 실행: Superpowers executing-plans로 현재 세션에서 직접 구현한다. 사용자의 우선순위별 개선 지시를 따른다.

**Goal:** 개발 중 변경 범위를 검사하고 전체 검증·Compose·QA의 반복을 줄인다.
**Architecture:** 기존 전체 검증과 게이트에 더해 변경 범위를 선택하는 별도 명령을 둔다. 검사 명령과 경로 규칙은 `verify.config.json`에서 읽는다.
**Tech Stack:** Node.js ESM, pnpm, node:test, Git.
**Spec:** [검증 실행 범위](../../polaris/specs/done/2026-10-21-hackathon-verification.md).

## 제약과 검토

기존 게이트·CI·린트를 끄거나 편집 금지 파일을 수정하지 않는다. 미분류 파일·잘못된 기준 커밋·이름 변경·새 파일·검사 실패로 필수 검사가 누락되지 않아야 한다. 보안·골든·핵심 데모 흐름은 보존한다.

## 구현 순서

사용자 추가 지시: 실행 범위뿐 아니라 실제 시험도 MVP 핵심으로 줄인다. 웹·Python·브라우저/E2E·루트 도구의 비핵심 시험 파일/케이스를 삭제하고, DB는 기존 핵심 21개와 격리된 DB 설정만 남긴다. 삭제 목록은 증거 JSON에 기록하고 전체 명령이 남은 시험을 모두 실행하는지 확인한다.

- [x] `scripts/verify-changed.test.mjs`: 웹/Python/DB/문서/미분류 변경의 선택, 실제 Git의 staged·unstaged·untracked·rename·delete, 잘못된 기준과 실패 즉시 중단 시험을 먼저 작성해 실패를 확인한다.
- [x] `scripts/verify-changed.mjs`, `verify.config.json`, 루트 `package.json`: 변경 수집·계획·dry-run·시간 표시와 `verify:changed` 명령을 구현해 시험을 통과시킨다.
- [x] `AGENTS.md`, `docs/CLAUDE.md`, `docs/11-TESTING.md`, `docs/17-CLAUDE-IMPLEMENTATION.md`, `docs/16-DECISIONS.md`, `docs/boilerplate/guardrails.md`: 개발/통합 검증 시점·Compose 조건·중복 E2E 제거·통합 리뷰 정책을 맞춘다.
- [x] 루트 서식과 게이트 자기 보호 검사를 확인하고 전체 `pnpm verify`를 한 번 실행한다. `docs/PROGRESS.md`와 증거에 실제 결과와 한계를 기록한다.

검증: 전체 `pnpm verify` PASS(루트163·웹286·AI101·결정57·빌드). 사용자 추가 지시로 비핵심 시험293파일을 실제 삭제하고 DB·Python 시험을 축소했다. 상세는 [구현·검증 기록](../evidence/verification/20261021-implementation.md)을 따른다.
