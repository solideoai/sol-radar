---
title: "솔리데오 가상 인력 구현 계획 1 — 카탈로그·200명 명부"
status: in-progress
tags:
  - sol-radar
  - plan
  - people
updated: 2026-10-16
---

# 솔리데오 카탈로그·200명 명부 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원본 팀명·직급을 보존하는 카탈로그와 원본 이름을 제외한 가상 한국인 200명을 재현·검증 가능한 JSON으로 확정한다.

**Architecture:** 이 계획은 승인 스펙의 첫 단계다. 외부 엑셀은 로컬 추출·원본 대조 때만 읽고, 이후 웹·DB·이미지 작업은 저장소의 네 JSON을 사용한다. 가입용 생성 JSON은 카탈로그의 공개 필드만 투영하며 별도 정본으로 편집하지 않는다.

**Tech Stack:** Node `^22.13.0 || ^24.3.0`, pnpm 9.15.9, Node test runner, ExcelJS 4.4.0(루트 개발 의존성으로 추가), JSON, SHA-256.

**Spec:** [승인 스펙](../../polaris/specs/planned/2026-10-16-solideo-people-signup.md) §2~6·9~10, [07 데이터](../07-DATA-PIPELINE.md), [11 검증](../11-TESTING.md) PPL-01·02·07. 후속은 [사진](2026-10-16-solideo-people-portraits.md), [DB·가입](2026-10-16-solideo-people-signup.md) 계획이다. 실행 방식은 세 계획을 함께 검토한 뒤 선택한다.

## Global Constraints

- 회사 **솔리데오**, 가상 직원 정확히 200명, 남성 100명·여성 100명. Auth 계정 200개를 만들지 않는다.
- `personId`는 `SOL-P0001`~`SOL-P0200`. 이름 `^[가-힣]{3}$`, 고유 200개, 정규화한 원본 이름과 교집합 0. 가입자 이름 규칙과 혼동하지 않는다.
- 같은 팀명은 앞뒤 공백만 제거해 합산한다. 부서마다 최소 1명, 승인된 최대 나머지 방식·ID 오름차순 동률 처리로 총 200명.
- 원본은 `/Users/leegwanghui/dev/hackathon/sol-radar-inputs/people.xlsx` 읽기 전용. 원본 성명·연락처·주소·제외 집합·개인 대응표는 저장·로그·프롬프트에 남기지 않는다.
- 직급/직책 12개는 `CFO`, `사장`, `부사장`, `이사`, `본부장`, `그룹장`, `팀장`, `소장`, `수석`, `책임`, `담당`, `인턴`. 직무·기술등급·업무 권한과 별개다.
- 27명만 `scoringEligible=true`(PM 2·PL 4·개발 18·데이터/AI 3), 나머지 173명은 제외. 가용 20 FTE·점수 골든 94/72/68을 변경하지 않는다.
- 기존 무관한 작업은 유지하고 태스크 파일만 명시해 커밋한다. 훅·검증·린트를 우회하지 않는다. 푸시·클라우드 DB 적용은 이 계획에 포함하지 않는다.

## Review Focus

1. 병합 헤더·반복 팀·주소를 사람/부서로 오인: Task 1의 합성 XLSX 검사와 실제 입력의 미분류 행 0 검사로 고정한다.
2. 총량보다 팀이 많음·동률·원본 동명이인: Task 2에서 D=0/201 거절, D=200, 동률 재현, 중복 이름 행의 가중치 보존을 검사한다.
3. 괄호 메모·공백이 붙은 원본 이름·후보 고갈: Task 2에서 정규화 충돌 회피·고갈 오류를 검사한다. 오류에는 실제 이름을 싣지 않는다.
4. 원본 부재인데 개인정보 대조까지 통과했다고 표시: Task 3에서 로컬 대조는 실패하고 CI는 대조 미실행으로 명시하는지 검사한다.
5. 생성 카탈로그가 원본 가중치/인물을 노출하거나 정본과 어긋남: Task 3에서 정확한 공개 키 집합과 생성물 동일성을 검사한다.

---

## 파일·연결 규약

| 파일 | 책임 |
|---|---|
| `scripts/people/workbook.mjs` | XLSX 읽기·팀 셀 범위 대조·메모리 내 원본 이름 집합 |
| `scripts/people/allocation.mjs` | 부서·직급·성별의 결정적 정수 배분 |
| `scripts/people/names.mjs` | 출처가 있는 후보와 원본/명부 중복 제외 |
| `scripts/people/generate.mjs` | 최초 JSON 생성·기존 ID 보존·공개 카탈로그 투영 |
| `scripts/people/check.mjs` | fixture 불변식 및 선택적 실제 원본 대조 CLI |
| `scripts/people/workbook.test.mjs`, `scripts/people/allocation.test.mjs`, `scripts/people/names.test.mjs` | 합성 입력의 단위 검사(원본 인물 사용 금지) |
| `scripts/demo-people.test.mjs` | 저장된 fixture·공개 투영·점수 계산 대상·이미지 완료 검사 |
| `fixtures/people/solideo.{departments,job-titles,people,portraits}.json` | 승인 스펙 §4의 네 정본 |
| `web/server/profile/signup-options.generated.json` | 카탈로그에서 생성하는 가입용 공개 투영 |
| `docs/evidence/people/20261016-people-data.json` | 입력 해시·건수·출처·수동 이름 검토·대조 결과, 개인정보 제외 |

공통 JS 값의 구조를 각 함수의 JSDoc에 정의한다. `DepartmentWeight={id,name,sourceCount,titleCounts,sourceRanges}`, `OptionItem={id,label}`, `Gender="MALE"|"FEMALE"`. 부서 코드는 `SOL-D001`부터 최초 팀명 정렬 순으로 부여 후 보존한다. 직급 코드는 위 12개 순서의 `SOL-J001`~`SOL-J012`다. 버전은 부서/직급 `solideo-organization/v1.0`, 명부 `solideo-people/v1.0`, 이미지 manifest `solideo-portraits/v1.0`.

## Task 1: 원본을 노출하지 않는 조직도 추출

**Files:** Create `scripts/people/workbook.mjs`, `scripts/people/workbook.test.mjs`, `fixtures/people/solideo.departments.json`, `fixtures/people/solideo.job-titles.json`; Modify `package.json`, `pnpm-lock.yaml`.

**Interfaces:** Produces `readOrganizationWorkbook(path:string,departments:DepartmentWeight[],excludedRanges:SourceRange[]=[]):Promise<{sourceSha256:string,departments:DepartmentWeight[],excludedNames:Set<string>,recognizedRows:number,excludedRowCount:number,unmappedCells:string[]}>`. `SourceRange`는 아래 `sourceRanges` 항목 구조와 같고, 부서 JSON 최상위 `excludedSourceRanges`에 승인된 비팀 구역을 익명 범위로 저장한다. `excludedNames`는 호출자 메모리에서만 사용한다. `sourceRanges`는 `{sheet:"people",headerCell:string,nameRange:string,titleColumn:"B"|"F"|"J"|"N"}[]`다.

- [x] **1. 실패 시험 작성:** 합성 XLSX에 A/B·E/F·I/J·M/N 이름/직급 쌍, 병합된 팀 헤더, 반복 팀, 전화·주소, 팀 없는 인력 행을 만든다. `assert.equal(result.departments.filter(d => d.name === "개발팀").length, 1)`; `assert.equal(result.recognizedRows, 4)`; 미분류 인력은 셀 주소로만 보고하며 직급 12개·표시명·내부 공백 보존을 단언한다.
- [x] **2. 실패 확인:** `node --test scripts/people/workbook.test.mjs` → 추출기 미구현으로 FAIL.
- [x] **3. 구현:** 루트에서 `pnpm add -D --save-exact exceljs@4.4.0`. [ExcelJS 공식 문서](https://github.com/exceljs/exceljs#reading-xlsx)대로 workbook을 읽는다. 실제 시트의 팀 헤더와 인력 범위를 읽어 두 카탈로그를 작성하고 추출기로 재검사한다. 원본 파일 해시는 `d4febca8607f628d4fd405c5dac423d2eb0b7f6d4ab926f691ec45488b79a4c3`와 대조한다. 기존 조사에서 인식한 250행은 대조 출발점이며 고유 임직원 수로 발표하지 않는다. 추가 인터뷰의 사용자 1번 선택에 따라 팀명이 명시된 행만 배분 가중치에 사용한다. 팀명 없는 임원·본부·그룹·프로젝트 구역은 익명 제외 범위로 기록하고 가중치에 넣지 않는다. 새 비팀 조직/프로젝트 표제를 넘어 앞선 팀을 상속하지 않는다. 근무지·주소 행만으로 팀 소속을 끊지는 않는다. 원본 전체 250행의 이름은 제외 집합에 계속 포함하며, 제외 범위/팀 범위 밖의 행은 오류다.
- [x] **4. 통과 확인:** 위 Node 시험 PASS, 실제 입력 미분류 행 0, 각 원본 이름 셀을 정확히 한 팀 또는 승인된 비팀 제외 구역에 연결, 표시 팀명/직급의 추가·변경 0. 콘솔/임시 파일에 원본 이름이 없는지 확인한다.
- [x] **5. 커밋:** `git add package.json pnpm-lock.yaml scripts/people/workbook.mjs scripts/people/workbook.test.mjs fixtures/people/solideo.departments.json fixtures/people/solideo.job-titles.json`; `git commit -m "feat: 솔리데오 조직도 카탈로그 추출"`.

## Task 2: 비례 배분과 자연스러운 가상 이름 200개

**Files:** Create `scripts/people/allocation.mjs`, `scripts/people/allocation.test.mjs`, `scripts/people/names.mjs`, `scripts/people/names.test.mjs`, `scripts/people/generate.mjs`, `fixtures/people/solideo.people.json`, `fixtures/people/solideo.portraits.json`; Modify 두 카탈로그의 계산 필드.

**Interfaces:** Consumes Task 1 결과. Produces `allocatePeople(departments:DepartmentWeight[]):{departmentId:string,targetCount:number,maleCount:number,titleCounts:Record<string,number>}[]`; `selectNames({gender,count,excludedNames,usedNames}:{gender:Gender,count:number,excludedNames:Set<string>,usedNames:Set<string>}):string[]`; `generatePeople({departments,jobTitles,excludedNames,existingPeople}):{people,portraits}`. CLI `node scripts/people/generate.mjs --input <외부 xlsx>`는 최초 생성용이며, 기존 명부가 있으면 ID·이름을 보존하고 불일치는 덮어쓰기 대신 실패한다.

- [ ] **1. 실패 시험 작성:** 아래 단언과 D=0/201·양수가 아닌 가중치 거절, D=200일 때 전원 1명, 직급 동률은 직급 ID 순, 원본의 동명이인 2행을 가중치 2로 세는 시험을 작성한다. 이름 시험은 실제 원본 대신 합성 이름에 공백/괄호 메모를 붙여 충돌 회피·후보 고갈 오류·개인정보 없는 메시지를 검사한다.

```js
assert.equal(allocated.reduce((n, d) => n + d.targetCount, 0), 200);
assert.equal(allocated.reduce((n, d) => n + d.maleCount, 0), 100);
assert.ok(allocated.every(d => d.targetCount >= 1));
assert.deepEqual(allocatePeople(weights), allocatePeople([...weights].reverse()));
assert.equal(new Set(people.map(p => p.name)).size, 200);
assert.ok(people.every(p => /^[가-힣]{3}$/.test(p.name) && !excludedNames.has(p.name)));
```

- [ ] **2. 실패 확인:** `node --test scripts/people/allocation.test.mjs scripts/people/names.test.mjs` → 배분/이름 함수 미구현 FAIL.
- [ ] **3. 구현:** 스펙 §5 공식을 그대로 적용한다. 이름 후보는 [남성](https://www.namechart.kr/chart/2008?gender=m)·[여성](https://www.namechart.kr/chart/2008?gender=f) 통계의 실제 두 글자 이름과 일반적인 한 글자 성씨를 사용하고 출처/확인일을 코드 주석과 증거에 남긴다. 임의 음절 생성·실존 직원 검색은 하지 않는다. 고정 후보 순서에서 제외 집합과 이미 쓴 이름을 건너뛰며 남녀 명단을 배분 결과에 연결한다. `normalizeSourceName(value:string):string`으로 공백·괄호 메모를 제거한 값도 제외한다. 27명 계산 대상 역할은 성별·직급과 독립적으로 지정하고, 이들의 기간 가용성·기존 가상 배정으로 20 FTE를 구성한다. 나머지 173명은 `scoringEligible=false`. 이미지 항목은 PLANNED와 인물 ID별 경로만 먼저 만든다.
- [ ] **4. 통과 확인:** 위 Node 시험 PASS. 실제 원본을 넣어 생성 후 이름 200개를 읽고 자연스러운 조합인지 검토한다. 원본 정규화 이름과 교집합 0·ID 200·남녀 100/100·부서/직급 참조·반복 실행 동일성을 확인한다.
- [ ] **5. 커밋:** `git add scripts/people/allocation.mjs scripts/people/allocation.test.mjs scripts/people/names.mjs scripts/people/names.test.mjs scripts/people/generate.mjs fixtures/people/solideo.departments.json fixtures/people/solideo.job-titles.json fixtures/people/solideo.people.json fixtures/people/solideo.portraits.json`; `git commit -m "feat: 가상 한국인 200명 명부 생성"`.

## Task 3: 공개 카탈로그 생성물과 검증 진입점

**Files:** Create `scripts/people/check.mjs`, `scripts/demo-people.test.mjs`, `web/server/profile/signup-options.generated.json`, `docs/evidence/people/20261016-people-data.json`; Modify `scripts/people/generate.mjs`, `package.json`, `docs/11-TESTING.md`, `docs/PROGRESS.md`.

**Interfaces:** Produces `projectSignupOptions(departments,jobTitles):SignupOptions`, `checkPeople({fixtures,sourcePath,requirePortraits:boolean}):Promise<{ok:boolean,sourceComparison:"passed"|"not-run",errors:{code:string,personId?:string}[]}>`. `SignupOptions`는 05 §8 그대로다. `people:check:fixtures`는 저장 fixture 검사, 정본 문서의 `people:check -- --input <path>`는 원본 필수 대조, `people:check:release -- --input <path>`는 원본과 READY 이미지까지 필수 검사다.

- [ ] **1. 실패 시험 작성:** `Object.keys(options)`가 `companyName,catalogVersion,departments,jobTitles` 네 개뿐이고 각 옵션은 `id,label`뿐임을 단언한다. 생성 투영과 커밋된 JSON의 깊은 동일성, 계산 대상 27명·역할별 2/4/18/3·나머지 173명, ID 안정성을 검사한다. 원본 없는 strict 대조는 `SOURCE_REQUIRED`, 일반 CI는 `sourceComparison:"not-run"`이어야 한다. PLANNED manifest는 데이터 단계에서 허용하되 release 모드에서 `PORTRAITS_INCOMPLETE`로 반드시 실패한다.
- [ ] **2. 실패 확인:** `node --test scripts/demo-people.test.mjs` → 검증기/투영 미구현 FAIL.
- [ ] **3. 구현:** 공개 투영을 생성 스크립트에서 함께 출력한다. 웹에서 루트 fixture를 직접 읽거나 전체 명부를 번들하지 않는다. 루트 기존 `test`가 새 `*.test.mjs`들을 자동 실행하도록 유지하고 검사를 빼지 않는다. 증거에는 sourceSha256·팀/직급/인물 건수·이름 출처·수동 검토 결과·원본 일치 0만 남긴다. 원본 파일이 없는 CI를 로컬 원본 대조 완료로 기록하지 않는다. 11 문서에 세 명령과 이미지 전/후 검증 범위를 명시한다.
- [ ] **4. 통과 확인:** 위 시험 및 `pnpm people:check:fixtures` PASS, `pnpm people:check -- --input /Users/leegwanghui/dev/hackathon/sol-radar-inputs/people.xlsx` PASS, `pnpm people:check:release -- --input /Users/leegwanghui/dev/hackathon/sol-radar-inputs/people.xlsx`는 아직 이미지 미완료로 FAIL. `pnpm verify` 통과 후에만 데이터 단계 완료 표시한다. 전체 인력/이미지/가입 완료로 표시하지 않는다.
- [ ] **5. 커밋:** `git add scripts/people/check.mjs scripts/demo-people.test.mjs scripts/people/generate.mjs web/server/profile/signup-options.generated.json package.json docs/11-TESTING.md docs/PROGRESS.md docs/evidence/people/20261016-people-data.json`; `git commit -m "test: 인력 명부와 공개 카탈로그 검증"`.

## 계획 자체 검토

승인 스펙 §4~6은 Task 1~3에 연결했다. 이미지 실물과 최종 READY 검사는 사진 계획, DB/가입은 가입 계획에서 수행한다. PPL-07의 27명/20 FTE/점수 회귀는 가입 계획 Task 4에서 실제 계산까지 검사하며 현재 계획의 명단 건수 검사로 대체하지 않는다. 원본 해석에서 새 판단이 생기면 원본 인물 정보를 제시하지 않고 한 주제씩 질문한다.
