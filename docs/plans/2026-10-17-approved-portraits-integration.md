---
title: "승인된 프로필 사진과 직원 명부 통합 계획"
status: in-progress
tags:
  - sol-radar
  - plan
updated: 2026-10-17
---

# 승인된 프로필 사진과 직원 명부 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. 기존 세 계획의 완료 작업을 반복하지 않는다.

**Goal:** 사용자가 최종 승인한 사진 200장을 기존 명부에 연결하고 승인·회귀·병합 준비 증거를 남긴다.

**Architecture:** 9663의 원본 PNG와 해시를 보존하고 기존 검수 API로 사람 PASS/manifest READY를 기록한다. 승인된 manifest와 사진만 b3ef로 반입한다. 기존 고정 URL과 재사용 가능한 사진/fallback 컴포넌트를 제공하며 미출시 조직도·직원 상세 화면은 출시하지 않는다.

**Tech Stack:** Node fs/crypto/test, 기존 Base UI Avatar, Next.js 정적 public, Vitest/Playwright, PGlite.

**Spec:** [기존 승인 스펙](../../polaris/specs/planned/2026-10-16-solideo-people-signup.md), [[16-DECISIONS]] ADR-021, 2026-10-17 사용자 최종 승인·통합 요청. 사용자가 이번 통합과 검증은 승인했으며 main 병합은 별도 승인 대상이다.

## Global Constraints

- SOL-P0001~SOL-P0200의 명부 ID·이름·성별·부서·직급과 기존 SHA-256 유지. 원본 사진 재생성·교체 금지.
- 9663 시작 HEAD `2d416f774b4d69e6a7a241bc2edd83ab46d1f5bb`; b3ef 시작 HEAD `f695ef4fe80beac4059c38fda74dffd7b77e2a85`; main 시작 HEAD `114a10aa245b76909c4952c3c82a473337ba0cbd`.
- 기존 자동 검수는 PASS 200/FAIL 0. 사람 승인 기록은 APPROVED, 기존 manifest 상태 계약은 READY로 유지한다. 자동 검수와 사람 검수는 구분한다.
- 원본 audit `/Users/leegwanghui/dev/hackathon/sol-radar-inputs/portrait-audits/20261017-b3i_is2a`는 역사적 PENDING 증거이므로 수정하지 않는다. 승인 범위 snapshot SHA-256 `19cbd9408e9672273db9405073dde5f9133d7715fa40041e51b91c824e8ff0e1`과 실제 파일·명부를 다시 대조한다.
- 공유 DB 적용, main 병합, push, 다른 세션 파일 덮어쓰기/삭제 금지. 마이그레이션·가입·기존 문서의 무관한 변경 금지. source main은 읽기 전용.
- 48개 조직(본부 6·그룹 4·팀 38), 상위 targetCount NULL, 팀 합계 200과 미확정 parent 사유를 보존한다. 원본으로 확인하지 못한 부모를 만들지 않는다. 평가 27명/배정/골든 입력 보존.
- 공개 자산은 `web/public/demo/people/SOL-Pxxxx.png`, URL `/demo/people/SOL-Pxxxx.png`. 실제 사용자 avatar_url과 섞지 않는다. 모바일·신규 조직도/직원 상세 제품 화면 범위 추가 금지.
- shell로 .env를 읽거나 기존 web/.env.local의 공유 스택을 사용하지 않는다. QA는 명시적 가짜 build 환경 또는 별도 격리 환경만 사용한다.

## Review Focus

1. 승인받은 해시와 실제 반입 파일이 다른 경우: 쓰기 전후 모든 200 SHA와 전체 승인 범위를 비교한다.
2. 잘못된 ID·없는 이미지·이미지 로딩 실패: 고정 경로 생성과 기존 Avatar fallback을 검증한다.
3. 실명·부서·직급 또는 평가 입력의 우발적 변경: 명부/카탈로그/점수 입력의 이전 SHA를 비교한다.
4. 자동 검사 PASS를 사람 승인으로 오인하거나 과거 기록 소실: 사용자 승인 원문과 시각·범위·해시를 별도 기록하고 AI/기계 기록을 보존한다.
5. 미출시 화면/골든 전체 테스트를 통과로 과장: 실제 실행 및 미검증 상태를 항목별로 기록한다.

## Task 1: 승인 기록과 정적 사진 통합

**Files:** 9663 `fixtures/people/solideo.portraits.json`, `docs/evidence/people/20261017-portraits-approval.json`; b3ef 동일 manifest·승인 증거·`web/public/demo/people/*.png`, `web/lib/demo-portrait.ts`, `web/components/people/person-avatar.tsx` 및 인접 시험; `scripts/people/approved-portraits.test.mjs`, `docs/PROGRESS.md`, 기존 사진 계획. 원본 AI 검수 증거는 보존·복사한다.

**Interfaces:** 기존 `markPortraitReady({personId,review,root})` API로 actor human/verdict PASS/sha256 일치 상태만 READY. 승인 기록은 `status: APPROVED`, 승인 범위와 이전 AI 검수 보존. `demoPortraitPath(personId: string | null | undefined): string | null`은 정확한 200 ID만 고정 URL로 바꾼다. `PersonAvatar({personId,name,...})`는 기존 Avatar/Image/Fallback을 이용해 ID 없음·이미지 오류 때 중립 인물 아이콘과 접근 가능한 설명을 표시한다. 미래 두 화면은 동일 컴포넌트를 소비한다.

- [x] 실제 명부·이미지·manifest와 승인 snapshot 재대조. 사용자 승인 원문 “사진 200장 전체를 최종 승인합니다.”, 전체 범위, 기록 시각, 자동 PASS 200/FAIL 0, 사람 APPROVED 200 기록. 기존 AI review는 승인 기록에 보존하고 이미지 바이트는 쓰지 않는다.
- [x] API로 READY 200 기록하고 9663에서 정상 커밋. 과거 생성/검수 기록은 삭제하지 않는다.
- [x] b3ef로 승인 manifest·200 PNG·증거만 선택 반입한다. 9663의 구형 DB·문서 전체를 cherry-pick하지 않는다. 명부/조직/직급/점수/마이그레이션 무변경을 확인한다.
- [x] 경로 범위/누락 ID/오류 fallback에 의미 있는 RED→GREEN 시험 후 최소 경로 helper·재사용 Avatar 구현. Next 설치 문서와 저장소 해당 스킬을 먼저 읽는다. 기존 UI 토큰·아이콘 사용, 제품 화면이나 메뉴는 새로 만들지 않는다.
- [x] `pnpm people:check:release -- --input /Users/leegwanghui/dev/hackathon/sol-radar-inputs/people.xlsx`, 사진 매핑/해시/누락/고아/명부/조직/순수 점수 회귀 시험, web 타입·관련 Avatar 브라우저 시험을 실행하고 결과를 남긴다. 원본 엑셀 내용은 출력하지 않는다.
- [x] 현재 상태·실행 증거·미출시 화면 경계를 문서에 기록하고 정상 훅으로 커밋한다. 전체 verify는 Task 2에서 한 번 새로 실행한다.

## Task 2: 독립 통합 QA와 병합 준비

**Files:** `docs/evidence/people/20261017-portraits-integration.md`, `docs/evidence/people/20261017-portraits-integration/` 증거, `docs/11-TESTING.md`, `docs/PROGRESS.md`의 해당 상태만 갱신.

**Interfaces:** Task 1의 고정 HEAD·승인 파일을 읽기 전용으로 검증한다. 구현과 다른 QA 담당자가 실제 명령·출력·HEAD를 기록한다. main 및 다른 세션은 읽기 전용. main 병합 자체는 수행하지 않는다.

- [x] 명부 JSON 계약·200 매핑/원본 SHA·조직 구조/팀 배치/target 합계·평가 27명 입력 보존을 독립 검사한다.
- [x] 명시적 격리 build 환경에서 `pnpm verify`를 실행하고 실제 Next 서버의 200 URL을 GET해 상태·MIME·바이트 SHA를 검사한다. 공유 DB와 통신하지 않는다. 가입 부서/직급 및 Avatar fallback 브라우저 검증을 실행한다. 실제 Auth 가입 쓰기가 필요한 경우 기존 검증된 명시적 대상 harness로 별도 격리 스택을 만들어야 한다.
- [x] 기존 인증·인가/RLS 회귀를 실행하고, G1~G10의 구현 여부·실행 명령 존재·실행 결과를 개별 분류한다. 미구현 조직도/명부 화면과 전체 골든은 미검증으로 표시한다.
- [x] main/두 worktree HEAD·미커밋 상태 재확인. 읽기 전용 merge-tree 또는 외부 임시 index로 PPL-07/PROGRESS/마이그레이션 충돌을 재현·분석한다. 무관한 main 변경이나 실제 merge 금지.
- [ ] 검수 결과를 커밋하고 한 번의 전체 브랜치 리뷰(기존 분기점 f6700e1부터)를 받는다. 해결할 지적은 한 차례 수정 묶음과 범위 재검토로 처리한다. 결과와 공유 DB 적용 전 작업을 보고하고 main 병합은 별도 승인을 기다린다.
