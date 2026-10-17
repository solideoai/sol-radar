---
title: "솔리데오 인력·가입 통합 검증 — 기존 계획 코드 QA 통과"
status: draft
tags:
  - sol-radar
  - evidence
  - people
updated: 2026-10-16
---

# 솔리데오 인력·가입 통합 검증

Task 1~4 구현·작업별 독립 리뷰와 기존 계획의 독립 통합 QA 기록이다. 코드 QA는 통과했으며 사진 release·사람 검수·ADR-021 후속 반영은 남아 있다. 전체 기능·배포 완료 증거가 아니다.

## 계산 범위와 승인된 기간 의미

`web/server/scoring`은 저장소/화면을 모르는 순수 함수다. `toPeopleProfile`은 전체 입력 길이로 `financials.employeeCount`를 계산하고, `toScoringTeam`은 `scoringEligible=true`인 27명(PM2/PL4/개발18/데이터·AI3)의 ID·역할·등급·스킬·가용 기간과 해당 인력 배정·기준일만 복사한다. 이름·성별·사진·부서·직급은 투영하지 않는다. 제외173명의 스킬·잘못된 가용성·배정 변경도 계산에 영향을 주지 않는다.

컨트롤러가 승인한 `availableFte`의 의미는 요청한 반개구간 `[startsAt,endsAt)` 전체에서 **개인별로 보장되는 최소 잔여 FTE의 합**이다. 비어 있는 가용 구간은0, 인접 구간은 연속 보장으로 인정한다. 가용 구간 중첩은 최대값만 쓰고, 같은 시점의 배정 비율은 합산해 잔여량을0 아래로 내리지 않는다. 서로 겹치지 않는 배정은 두 번 차감하지 않는다. 짧은 일부 가용 구간만으로 전체 기간 가용량을 부풀리지 않는다. 비어 있거나 역전/잘못된 날짜·비유한 수·FTE0..1/배정0..100 범위 위반은 `RangeError`다.

이는 시간 가중 평균·직원 교대 최적화가 아니다. Phase4에서 다른 용량 척도를 정하면 이 격리된 함수와 경계 시험을 바꾼다. 명부·DB·정체성 자료는 바꾸지 않는다. 기준일 `2026-10-16T00:00:00.000Z`, 고정 창 `2026-12-01`~`2027-07-01`에서는27명 중 서로 다른7명의100%배정을 제외해20FTE다.

`docs/08-SCORING.md` §6의 다른 요소 점수를 별도로 선언하고 **실제로 계산한**20FTE에 §3.3 비율·일정 계수를 적용한 합계는94/72/68이다. 적격자의 가용성을0.5로 바꿔10FTE가 되면91/65/58로 변하는 회귀도 둔다. 이 시험은 공고8/12개월 기간·추출·자격·전체 점수 엔진을 연결한 골든이 아니다. 전체 bid/score 파이프라인 골든은 Phase4 미완료다.

## 로컬 E2E 계약

- 읽기 `signup-employment.spec.ts`: 1440·1280 가입 필수 오류/초점·Tab/방향키/Home/End/Enter/Escape·실제 카탈로그의 긴 부서명·가로 넘침·스크린샷, 기존 완성 계정의 현재 신고 정보와 보완 반복 방지. 시드 프로필/팀을 변경하지 않는다.
- 쓰기 `signup-employment.write.spec.ts`: 로컬 실제 이메일 가입·Mailpit 확인 링크·재로그인 유지, 간편 가입과 **동일한 미완료 DB 상태**의 계정 보완·계정 관리/로그아웃 접근,1440·1280 보완 스크린샷, 보완 후 Solideo 조직/명부/멤버십 RLS0행 및 org-01 URL404, 기존 계정 선언 삭제 후 열려 있던 작업 폼의 Server Action 차단·미저장·직접 업무 URL 차단. 모두 기존 `chromium-write` 단계에서 독립 시험 계정을 정리한다.
- 기존 disposable Auth 도우미 두 곳은 기본 이름1..40/승인 코드로 완성 계정을 만들고 `incomplete:true`에서만 선언을 생략한다. 제품 데모5개 `.invalid` 계정과 템플릿 로컬5개 시험 계정은 서로 다른 용도이며 치환하지 않았다. 가상 명부200명은 Auth200명이 아니다.
- 현재 구현된 v1 조직 업무 REST API가 없으므로 실제 URL 대상이 있는 것처럼 주장하지 않는다. `requireCompleteUser`의403 `PROFILE_INCOMPLETE`+`completionPath`는 기존 단위 계약 시험에서 검사한다. 실제 URL/Server Action과 anon+사용자 세션 RLS 검사는 E2E에서 수행한다. 기존 self/auth/admin API의 Bearer·오류 계약은 유지한다.
- 외부 OAuth 제공자 설정·실제 OAuth 왕복 E2E는 **미실행**이다. 미완료 DB 상태 시험을 실제 제공자 연동 성공이라고 기록하지 않는다.

## 구현자 집중 실행 결과

| 명령 | 실제 결과 |
|---|---|
| `pnpm -C web exec vitest run server/scoring` 최초 | RED: 계산 모듈 부재 |
| 같은 명령 구현 후 | PASS10/10; 전체 웹 회귀 통과 주장이 아님 |
| `pnpm -C web exec playwright test -c playwright.auth.config.ts signup-employment --list` |7개 새 시험 발견. 프로젝트 의존성 때문에 전체 목록에는 기존 읽기 단계도 포함된다. **목록은 실행 성공이 아니다** |
| `pnpm -C web exec tsc --noEmit` | PASS |
| `pnpm -C web build` | PASS; 새 E2E의 실제 프로덕션 라우트 집중 디버깅용 |
| 새 E2E 집중 실행 | 새7개 사례가 각각 PASS. 최초 쓰기4건:3PASS/1FAIL→이메일1건 수정 후1PASS. 읽기3건:2PASS/1FAIL→기존계정1건 수정 후1PASS. 전체 auth suite 실행 아님 |
| 새1440/1280 화면·키보드 | 실제 Chromium 집중 실행에서 가입2건/보완2건 PASS. screenshot은 시험 outputPath에 생성하며 최종 보존 증거는 독립 QA에서 다시 수집 |
| `node --test scripts/demo-people.test.mjs` | PASS33/33; 고정 창·배정 대상/개수/기간을 검증. FTE 계산은 scoring 시험에서 수행 |
| 정상 커밋 게이트 | 실제 결과는 Task4 작업 리포트/게이트 로그에 기록하고 독립 QA 후 이 초안을 확정한다. 우회/검사 약화 없음 |

최초 이메일 실패는127.0.0.1에서 가입/확인 후 Next 로컬 production redirect가localhost로 이동해 쿠키 원본이 달라진 fixture 문제였다. 로컬 메일 템플릿과 같은 `http://localhost:3244`를 이메일 시험의 첫 가입 탐색부터 확인/재로그인까지 일관되게 사용해1건 재실행이 통과했다. 실제 OTP·PostgREST를 사용하고 프로덕션 redirect/auth 정책은 변경하지 않았다. 다른 집중 E2E는 `http://127.0.0.1:3244`를 사용했다. 외부 배포 origin/프록시 검증을 이 로컬 결과로 대신하지 않는다.

읽기 기존계정 시험의 첫 실패는 집중 명령 `--no-deps`가 `auth.setup`을 실행하지 않아 저장 상태 파일이 없던 준비 문제였다. 해당 사례를 실제 기존 seed-owner 폼 로그인으로 시작하도록 바꿔1건 재실행이 통과했다. 계정/시드 변경이나 가드 완화는 없었다. 최종 독립 QA는 정규 설정 의존성과 시드 절차대로 실행한다.

집중 로그는 작업용 `.superpowers/sdd/2026-10-16-solideo-people-signup/task-4-*.log`에 있다. 키·세션·원본 실명은 요약에 싣지 않는다.

## 독립 QA 실제 결과

구현자와 다른 QA 담당자가 실제 로컬 Supabase Auth/PostgREST/Mailpit와 production Next/Chromium으로 실행했다. 가드 회귀와 seed 재실행 오류를 먼저 재현하고 원래 구현자의 수정·별도 검토 후 필요한 검사만 다시 실행했다. 아래 커밋별 실행 근거를 구분하며 다른 커밋의 결과를 새 실행으로 바꾸어 쓰지 않는다.

| 검사 | 실제 결과와 실행 커밋 |
|---|---|
| 전체 `pnpm verify` | `83e1fac` exit0, 루트292·웹773 시험 및 서식·타입·린트·계층·새 production build PASS |
| `pnpm -C web test:e2e` | 같은 커밋 공개130/130 PASS; 포함된 component-browser 단계89/89 PASS. 중복 단독 실행 없음 |
| 로컬 `pnpm -C web test:e2e:auth` | seed 수정 `bff0daad`, 정규 seed 포함 exit0,92/92 PASS. 기존 실패4개와 이후 세션 격리 단언·새 가입7건 모두 실행 |
| 실제 로컬 명부 seed2회 | `90c67bc` 독립 실행:200→200→200, 동일 UUID, 기존 Auth5→5→5 동일 ID, 명부 seed Auth 호출0 |
| 실제1440·1280 화면/키보드·긴 라벨 | `90c67bc` 실제 브라우저·독립 AI 시각 검수 PASS. 아래 저장 스크린샷 참조. 사람의 제품 승인과 별개 |
| 원본 필수 대조·사진 release | 데이터 단계 원본 대조 완료. 최종 사진 병합·사람 승인 후 release 재검증 대기. 이 코드 worktree manifest는 PLANNED200/READY0 |

독립 QA가 실제로 열어 검토한 안정 상태 스크린샷: [가입1440](screenshots/20261016-people-signup-loaded-1440.png), [가입1280](screenshots/20261016-people-signup-loaded-1280.png), [보완1440](screenshots/20261016-people-completion-loaded-1440.png), [보완1280](screenshots/20261016-people-completion-loaded-1280.png). 원본 PNG를 그대로 보존했다.

`83e1fac` 이후 변경은 로컬 seed와 인접 회귀 시험 두 파일뿐이다. 웹 코드·빌드 산출물은 같아서 통과한 공개/브라우저/빌드를 반복하지 않았다. `bff0daad` 정상 커밋 게이트 루트293/293 PASS는 구현자 실행이며 독립 전체 verify의 재실행으로 기록하지 않는다.

해결한 오류는 두 개다. QA-01은 미로그인/DB 미설정에서 새 보완 가드가 기존 안내·noindex보다 먼저 redirect하던 회귀였다. 기존 안내와 도메인 인증을 보존하고 미완료 계정 차단은 유지했다. QA-02는 앞선 E2E에서 초대를 수락한 seed-invitee에게 다음 seed가 다시 초대해400으로 중단되던 오류였다. 소유자 세션/RLS로 정확한 seed-team·seed-invitee·member 멤버십만 복원하며, Auth/조직/팀 ID·다른 멤버십·승격된 owner를 보존한다. 상태 회귀 RED→11PASS, 실제 전체 seed2회 멱등·정규 auth92PASS로 확인했다.

직접 API 검사에서 쿠키 PATCH CSRF403, 잘못된 Bearer의 쿠키 대체 금지401, Bearer와 쿠키가 다른 계정일 때 Bearer 본인만 변경, 역할·목표 인원·알 수 없는 코드 위조400과 부분 저장 없음, 비구성원의 솔리데오 명부 RLS0행을 확인했다. 실제 초대 수락 후에도 보완 전 업무 차단, 복구 메일·계정 삭제, 지연 저장 중 중복 요청 방지·오류 입력 유지·실제 재시도도 확인했다. 실제 초기 서버 읽기 장애 주입은 미실행이며 해당 오류/재시도/로그아웃 상태는 component browser 시험으로 검사했다.

원시 로그/보고서는 작업용 `.superpowers/sdd/2026-10-16-solideo-people-signup/independent-qa-report.md`, `independent-qa-rerun-report.md`, `independent-qa-rerun2-report.md`와 인접 로그에 보존한다. 초기 실패·trace도 유지했다. QA가 만든 임시 계정·팀·서버를 정리했고 마지막 Auth5/명부200/마이그레이션00002를 확인했다. 클라우드·공유 schema 변경·main 병합은 하지 않았다. 외부 OAuth·사진 사람 승인·전체 Phase4 파이프라인·ADR-021은 이 통과 범위에 포함하지 않는다.

로컬 seed 확인은 기존 템플릿5개 계정 ID가 유지되는지 별도로 보고, 전역 Auth 행수는 disposable 계정 때문에5라고 가정하지 않는다. 다른 시험이 Auth를 생성/삭제하지 않는 단독 시점에서 roster seed 전후 전체 Auth ID집합/건수와200명 ID집합을 비교한다. `supabase status -o env`는 메모리에서만 파싱하고 로컬 URL 거절 helper를 사용한다. 출력은 건수·동일성 여부·Auth 호출0 같은 익명 요약만 남긴다. 클라우드 push/reset/운영 DB 검사는 수행하지 않는다.

## 관련 문서

- [[11-TESTING|검증 기준]] §8
- [[08-SCORING|인력 계산과 worked example]] §3.3·6
- [[PROGRESS|진행 상황]]
