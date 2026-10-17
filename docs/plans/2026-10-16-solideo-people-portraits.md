---
title: "솔리데오 가상 인력 구현 계획 2 — 정장 사진 200장"
status: in-progress
tags:
  - sol-radar
  - plan
  - imagegen
updated: 2026-10-16
---

# 솔리데오 정장 프로필 200장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가상 인물 200명 각각에 서로 다른 얼굴의 정장 PNG를 연결하고, 중단·재시도·품질 검수를 manifest에 기록한다.

**Architecture:** [명부 계획](2026-10-16-solideo-people-data.md)의 확정 ID·성별·PLANNED manifest를 입력으로 사용한다. 내장 imagegen으로 인물당 한 번씩 생성하고 선택한 파일만 공개 정적 자산으로 복사한다. 생성 API를 앱·CI에 연결하지 않는다.

**Tech Stack:** 내장 `image_gen`, imagegen 스킬, Node fs/crypto/test runner, PNG 헤더 검사, 브라우저 HTML 검수.

**Spec:** [승인 스펙](../../polaris/specs/planned/2026-10-16-solideo-people-signup.md) §4·7·10, [11 검증](../11-TESTING.md) PPL-03. [DB·가입 계획](2026-10-16-solideo-people-signup.md)은 이미지 완료를 기다리지 않고 진행할 수 있지만 최종 완료에는 세 계획 모두 필요하다.

## Global Constraints

- 남성 100장·여성 100장, 가상 성인 한국인·정장·실사·정사각형·얼굴/어깨·밝은 중립 배경·부드러운 조명·인물 한 명.
- 사진은 `web/public/demo/people/SOL-P0001.png`~`SOL-P0200.png`, 공개 URL은 `/demo/people/<personId>.png`. 실제 사용자 `profiles.avatar_url`에 넣지 않는다.
- 원본 이름·사진·유명인 참조·회사 로고·워터마크·글자를 프롬프트나 이미지에 넣지 않는다. 성별·외모는 권한·점수 근거가 아니다.
- 내장 도구가 기본이다. API/CLI로 자동 전환하거나 API 키를 요구하지 않는다. 캐시 경로를 앱 자산 URL로 저장하지 않는다.
- manifest 상태는 `PLANNED / GENERATED / READY / FAILED`. READY는 기계 검사와 얼굴·정장·품질 검수가 모두 끝난 상태다.
- 기계적으로 해시가 다른 것만으로 다른 얼굴이라고 판단하지 않는다. 확정 파일 교체는 새 후보 검수 후에만 한다.

## Review Focus

1. 중단 후 다시 시작하며 기존 READY를 덮어씀: Task 1의 READY 건너뛰기·교체 명시 검사.
2. 성별/파일명/경로가 다른 인물과 연결됨: Task 1의 ID·성별·고정 경로 일치 검사.
3. PNG 확장자만 맞고 실제 파일이 다른 형식·직사각형·빈 파일: Task 1의 시그니처·IHDR·정사각형 검사.
4. 다른 해시로 같은 얼굴이 반복됨: Task 2의 전체 200장 비교 검수. 사람 판단을 자동 검사 통과로 대체하지 않는다.
5. 경로 탈출·누락·같은 파일 재사용: Task 1의 허용 경로·경로/해시 고유성 검사, Task 2 최종 release 검사.

---

## 파일·연결 규약

| 파일 | 책임 |
|---|---|
| `scripts/people/portraits.mjs` | 대기열·파일 반입·PNG/해시 검사·상태 전이 CLI |
| `scripts/people/portraits.test.mjs` | 재시도·파일 형식·ID·경로·상태 검사 |
| `scripts/people/portrait-review.mjs` | 저장된 가상 이미지의 로컬 HTML 검수 목록 생성 |
| `fixtures/people/solideo.portraits.json` | 인물별 프롬프트·생성 결과·상태 정본 |
| `web/public/demo/people/<personId>.png` | 선택·검수한 공개 PNG 200장 |
| `docs/evidence/people/20261016-portraits-review.json` | ID별 얼굴·정장·성인·한 명·품질 검수 기록 |

manifest 항목은 승인 스펙의 `personId,gender,prompt,status,path,sha256,generator,generatedAt`를 사용한다. `path`는 공개 URL이다. 검수 기록은 `{personId,reviewedAt,checks:{oneAdult,formalSuit,squareComposition,distinctFace,noText},result:"PASS"|"REGENERATE"}`. 원본 인물에 대한 정보는 없다.

## Task 1: 재시도 가능한 이미지 반입과 검증

**Files:** Create `scripts/people/portraits.mjs`, `scripts/people/portraits.test.mjs`, `scripts/people/portrait-review.mjs`; Modify `scripts/people/check.mjs`, `scripts/demo-people.test.mjs`.

**Interfaces:** Consumes 앞 계획의 `Gender`, `personId`, manifest. Produces `pendingPortraits(manifest):{personId:string,gender:Gender,prompt:string}[]`; `importPortrait({personId,sourcePath,generatedAt,replace?:boolean}):Promise<{path:string,sha256:string,status:"GENERATED"}>`; `markPortraitReady({personId,review}):Promise<void>`; `validatePortraitAssets(people,manifest):Promise<{code:string,personId?:string}[]>`. `sourcePath`는 도구가 돌려준 실제 로컬 PNG이며 고정 캐시 위치를 가정하지 않는다. `replace` 기본값은 false다.

- [ ] **1. 실패 시험 작성:** 임시 디렉터리의 작은 합성 PNG로 검사한다. `assert.deepEqual(pendingPortraits([ready,planned,failed]).map(p=>p.personId), [planned.personId,failed.personId])`; 같은 바이트 재사용은 `DUPLICATE_IMAGE`, 잘못된 성별은 `GENDER_MISMATCH`, 경로 탈출은 `INVALID_PATH`, 직사각형은 `NOT_SQUARE`, READY 덮어쓰기는 `READY_REPLACEMENT_REQUIRED`여야 한다. 이미지 생성 호출은 시험에 넣지 않는다.
- [ ] **2. 실패 확인:** `node --test scripts/people/portraits.test.mjs` → 반입/검증 미구현 FAIL.
- [ ] **3. 구현:** `importPortrait`가 PNG 시그니처·IHDR·양수 폭/높이·정사각형을 검사하고 SHA-256을 계산한 뒤 인물 ID 고정 경로로 복사한다. GENERATED는 대기열에서 재생성하지 않고 검수 대상으로 남긴다. 실패는 FAILED, 검수 PASS만 READY, 재생성 판정은 FAILED로 전이한다. READY 교체는 `--replace`를 명시하고 새 후보를 검수한 뒤 원자적으로 바꾼다. 임시 후보의 캐시 경로는 커밋 manifest에 넣지 않는다. HTML 목록은 가상 이름/ID·사진·검수 현황만 표시하고 저장소 밖 임시 파일로 만든다.
- [ ] **4. 통과 확인:** 위 시험 PASS. `node --test scripts/demo-people.test.mjs`는 manifest 구조와 현재 단계 상태를 검사하고, strict release는 READY 200개가 없으면 실패한다. 사람이 PASS한 기록 없이 READY로 올릴 수 없는지 검사한다.
- [ ] **5. 커밋:** `git add scripts/people/portraits.mjs scripts/people/portraits.test.mjs scripts/people/portrait-review.mjs scripts/people/check.mjs scripts/demo-people.test.mjs`; `git commit -m "feat: 가상 프로필 이미지 검수 흐름 추가"`.

## Task 2: 내장 imagegen으로 200명 생성·검수

**Files:** Modify `fixtures/people/solideo.portraits.json`; Create `web/public/demo/people/<personId>.png` 200개, `docs/evidence/people/20261016-portraits-review.json`; Modify `docs/PROGRESS.md`.

**Interfaces:** Consumes Task 1 대기열/반입/READY 전이 함수. Produces READY 200건과 고유 최종 PNG 200개. 가상 이름은 이미지 프롬프트에 필요하지 않으므로 ID·성별·외모 설정만 사용한다.

- [ ] **1. 미완료 확인:** `pnpm people:check:release -- --input /Users/leegwanghui/dev/hackathon/sol-radar-inputs/people.xlsx` → `PORTRAITS_INCOMPLETE` FAIL. 불완전한 manifest가 최종 완료로 판정되지 않아야 한다.
- [ ] **2. 프롬프트 확정:** imagegen 스킬을 다시 적용하고 인물별 성인 연령대·헤어스타일·안경·정장 색/세부를 다양하게 지정한 200개 프롬프트를 manifest에 저장한다. 신입/임원 등 실제 원본 인물이나 성별에 직급을 대응하지 않는다. 공통 구도·배경·조명은 고정한다.
- [ ] **3. 생성·반입:** 각 대기 ID에 대해 내장 `image_gen`으로 **한 인물의 정사각형 사진 한 장**을 생성한다. 200장 콜라주나 얼굴 재사용을 하지 않는다. 도구의 생성 결과를 표시하고 선택 PNG의 실제 경로로 `importPortrait`를 호출한다. tool 실패는 해당 ID만 FAILED로 기록하고 다음 작업 또는 재시도로 진행한다. 한 번에 처리하는 양은 도구의 실제 동시 실행 한도를 따르며 무리한 200개 동시 호출을 하지 않는다.
- [ ] **4. 검수·통과 확인:** GENERATED 사진을 모두 보고 한 명·성인·정장·구도·텍스트 없음·품질을 검수한다. HTML 목록으로 200장 전체의 얼굴 반복도 확인하고 유사한 얼굴은 재생성한다. 검수 PASS 뒤 READY로 올린다. `pnpm people:check:release -- --input /Users/leegwanghui/dev/hackathon/sol-radar-inputs/people.xlsx` → READY 200·남녀 100/100·고유 경로/해시 200·PNG 정사각형·원본 이름 일치 0 PASS. `pnpm verify`도 통과하고 증거에는 실제 검수 결과만 쓴다.
- [ ] **5. 커밋:** `git add fixtures/people/solideo.portraits.json web/public/demo/people docs/evidence/people/20261016-portraits-review.json docs/PROGRESS.md`; `git commit -m "feat: 가상 직원 정장 프로필 200장 추가"`. 이 경로의 기존 무관 파일이 없는지 먼저 확인한다.

## 계획 자체 검토

승인 스펙 §7의 개별 생성·내장 도구·캐시 복사·재시도·사람 검수·READY 조건을 각각 태스크에 연결했다. 생성 자체에는 동일 구현을 흉내 내는 테스트를 만들지 않고 상태·파일·연결·완료 조건을 시험한다. 사진 계획만 통과해도 DB·가입까지 완료했다고 표시하지 않는다.


## 2026-10-17 후속 승인·통합 기록

이 계획의 생성과 AI 검수는 9663의 `2d416f774b4d69e6a7a241bc2edd83ab46d1f5bb`에서 이미 완료했다. 이번 작업은 사진을 다시 생성하거나 교체하지 않았다. 사용자 원문 “사진 200장 전체를 최종 승인합니다.”와 정확한 200 binding snapshot을 [사람 승인 기록](../evidence/people/20261017-portraits-approval.json)에 기록하고 기존 AI review200개를 먼저 보존한 뒤 `markPortraitReady`로 READY200을 기록했다(9663 `8ba281060d1cb27c6e3cb06da22b5d4ab3ca801e`).

b3ef에는 승인 manifest·원본 PNG200개·승인/이전 AI 증거만 선택 반입했다. 실제 원본 엑셀을 필수 대조한 release 검사는 통과했다. 현재 정적 사진과 재사용 Avatar/fallback을 제공하며 미출시 조직도·직원 상세 화면은 만들지 않았다. [통합 계획](2026-10-17-approved-portraits-integration.md)의 독립 Task 2가 전체 검증과 병합 준비를 맡는다. 상세 실행 결과는 [Task 1 증거](../evidence/people/20261017-portraits-integration-task1.md)를 참조한다.
