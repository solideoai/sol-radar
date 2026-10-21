---
title: "문서 최신 기준 정합화 수정 계획"
doc: "plan-docs-current-baseline-sync-20261021"
status: final
tags:
  - sol-radar
  - ops
  - decision
updated: 2026-10-21
---

# 문서 최신 기준 정합화 수정 계획

> **실행 담당:** 현재 세션에서 `superpowers:executing-plans`로 Task 1~7을 순서대로 수행한다. 체크박스는 실제 수정·확인을 마친 뒤 표시한다. 검증·리뷰 시점은 ADR-046을 따른다. 2026-10-21 사용자 승인으로 Task 1~7을 완료했다. 정정·검증 결과는 [[20261021-docs-current-baseline-sync|검증 기록]]을 따른다.

**Goal:** 현재 승인·구현·검증 상태와 어긋나는 문서 안내를 바로잡아 실행 절차, 개발 지침, 제출물이 같은 기준을 설명하게 한다.

**Architecture:** 기존 정본의 최신 개정과 저장소 증거를 기준으로 문구·상태·참조만 수정한다. 현행 안내를 바로잡고, 당시 결정·실행 결과가 명시된 이력은 보존한다. 같은 파일이 여러 단계에 걸치면 이 세션이 순서대로 편집한다.

**Tech Stack:** Markdown, Obsidian 위키링크, Git, `rg`, 읽기 전용 코드·설정 대조.

**Spec:** 사용자 문서 감사 브리핑과 후속 지시(2026-10-21), [[CLAUDE|정본 지침]], [[16-DECISIONS|ADR-034·039·041·042·046]], [[10-DEPLOYMENT|10 배포]]의 승인된 Vercel 구성, [[09-SECURITY|09 보안]]의 운영자 CLI 허용 범위. 별도 기능 스펙은 만들지 않는다.

## 공통 제약

- 수정 범위는 `docs/`다. 제품 코드·시험·마이그레이션·검증 설정·운영 환경은 변경하지 않는다.
- 실행 시작 시 HEAD와 작업 트리를 다시 읽는다. 계획 작성 기준은 `main@7133636`이며, ADR-047 관련 번호 문서의 기존 미커밋 변경과 미추적 문서를 보존한다.
- 승인된 설계, main 구현, 검증 완료, 외부 실행 대기, 제안 상태를 구분한다. 다른 브랜치의 구현은 main 완료로 표시하지 않는다.
- 모델은 Qwen3.8-Flash-Next·Bosun v3.1 0.6B, `KEV_*`·`/kev` 호환 이름 유지다. 실제 회사 served id와 실추론 성공 여부는 기존 검증 상태를 그대로 따른다.
- ADR-042 일정은 C9 3차 10-23, 기능 freeze 10-24 22:00, 최종 리허설 10-25, 완료 목표 10-26, 공식 제출 10-27이다.
- 데스크톱 1280px 이상, 결제·모바일·자동 투찰·승률 예측 제외, 규칙 점수·RLS·사람 결정 원칙을 유지한다.
- 퇴역 모델·과거 날짜·과거 시험 결과를 일괄 치환하지 않는다. 원본 증거·과거 로그는 덮어쓰지 않는다.
- 삭제한 시험은 복구하지 않는다. 문서 전용 작업에 새 시험·검사 도구를 추가하거나 전체 빌드·E2E·Compose를 반복 실행하지 않는다(ADR-046).
- frontmatter·기존 파일명·위키링크를 유지한다. Markdown은 현재 Prettier 제외 대상이므로 문서 서식은 직접 확인한다.

## 검토 초점

| 실패 조건 | 확인할 기대 결과 | 담당 |
|---|---|---|
| 예전 C1 절차를 현재 env로 복사 | 현재 모델·측정 부하를 사용하고 Qwen URL에 `/v1`이 중복되지 않음 | Task 1 |
| 미구현 기능이 발표·배포 완료처럼 보임 | 첨부 인용·Qwen 설명·클라우드 배포를 현재 증거 범위 안에서 설명 | Task 2·3 |
| 승인된 기능 또는 운영자 CLI를 다시 금지 | ADR-041·042와 제한된 로컬 CLI 예외를 반영하되 웹 service role 금지는 유지 | Task 3·4 |
| 삭제 시험 참조를 보고 복구하거나 검증을 과장 | 현재 실행 파일만 현행 검증 근거로 연결하고 과거 기록은 과거로 분류 | Task 5 |
| 이력·제안·병렬 작업이 현행 결정에 섞임 | ADR-047 제안, 다른 브랜치, 과거 실행 수치와 사용자 변경을 보존 | Task 6·7 |

## Task 1 운영 절차와 모델 증거 정리

**수정 파일:**

- `docs/plans/2026-10-19-c1-external-deps-procedure.md` — G2/G3 모델·URL·부하와 현행 절차 안내.
- `docs/plans/2026-10-20-bosun-qwen4b-migration-plan.md` — 상단에 10-21 개정과 현재 B2 런북 연결.
- `docs/evidence/README.md` — 앞으로 준비할 학습·평가 증거의 Bosun·E1′ 표기.

**읽을 기준:** `docs/03-AI-PIPELINE.md` §5.9·§11, `docs/16-DECISIONS.md` ADR-034 개정, `docs/plans/2026-10-21-bosun-b2-runbook.md`, `services/ai/models/registry.yaml`.

- [x] 현재 모델·주소·측정 조건을 기준 문서와 대조한다. 회사 API의 실제 id·접속·성능 미확인은 유지한다.
- [x] C1의 현행 G2/G3 안내를 Qwen3.8·Bosun, 500/6,000토큰 두 종류 ×24문항 ×10회에 맞춘다. 예시의 Qwen `/v1` 결합을 확인하고 실제 호출 없이 수정한다.
- [x] 마이그레이션 계획의 상단에 후속 개정을 명시하고 최신 B2 절차로 연결한다. Qwen4B·Qwen3.5 본문은 당시 기록임을 유지한다.
- [x] 증거 인덱스의 예정표를 Bosun LoRA·E1′/E4와 현행 산출물에 맞춘다. Kev feasibility 기록은 보존 이력으로 남긴다.

**완료 기준:** 현재 실행 안내만 따라도 퇴역 모델이나 옛 4문항 측정을 선택하지 않으며, 링크 대상과 명령에서 참조하는 파일이 존재한다. GPU·모델 API를 호출하지 않는다.

## Task 2 발표와 제출물의 주장 정리

**수정 대상:** `docs/18-HACKATHON.md`, `docs/19-DEMO-SCENARIO.md`, `docs/submission/README.md`, `docs/submission/architecture.md`, `docs/submission/evidence-list.md`, `docs/submission/limitations.md`, `docs/submission/slides-outline.md`, `docs/submission/video-storyboard.md`. 각 파일에서 확인된 현행 주장만 고친다.

**읽을 기준:** `docs/03-AI-PIPELINE.md`의 현재 구현 상태, `services/ai/src/sol_ai/parse.py`, `services/ai/src/sol_ai/explain.py`, 저장소의 documents 소비자·첨부 처리 존재 여부.

- [x] S-LIVE 스크립트의 실제 첨부 인용을 공고 본문·API 필드 근거로 고치고, 첨부 인용은 구현·증거 확보 후 가능하다고 구분한다.
- [x] 첨부 다운로드 실패 배지·파싱 화면·Qwen 생성 설명처럼 실제 구현보다 앞선 시연 지시가 남았는지 대조해 고친다. 제품의 목표 설계 자체는 삭제하지 않는다.
- [x] 제출물에서도 같은 주장과 증거 범위를 맞춘다. 실제 AI 추론과 사전 run·녹화·규칙만 PARTIAL을 구분한다.

**완료 기준:** 스크립트·정직성 표·한계 문서가 같은 상태를 설명하며, 실행·녹화·품질 측정이 끝났다는 새 주장을 만들지 않는다.

## Task 3 배포 안내와 service role 예외 정리

**수정 파일:** `docs/CLAUDE.md`, `docs/00-README.md`, `docs/16-DECISIONS.md`의 현재 적용 안내, `docs/17-CLAUDE-IMPLEMENTATION.md`, `docs/20-GLOSSARY.md`, `docs/boilerplate/README.md`, `docs/boilerplate/first-deployment.md`.

**읽을 기준:** `docs/10-DEPLOYMENT.md` Vercel 절, `docs/evidence/vercel/20261021-configuration.md`, 루트 `vercel.json`, `docs/09-SECURITY.md` 운영자 CLI 규칙.

- [x] 배포처 미결정·Vercel 보류라는 현재 안내를 승인된 웹·AI 구성과 실제 클라우드 배포 미실행으로 구분해 고친다. Compose 데모 경로는 유지한다.
- [x] 템플릿 첫 배포 문서에는 현행 10 배포로 가는 안내를 넣는다. 옛 웹 단독 설정·삭제된 빌드 스크립트 재생성·Vercel service role 등록 안내를 현행 실행 지시에서 분리한다.
- [x] service role 허용 범위를 worker·seed·사람이 로컬에서 직접 실행하는 `scripts/ops/` CLI로 맞춘다. 웹 서버·브라우저 금지와 클라우드 적용 사용자 확인은 유지한다.
- [x] 과거 ADR 원문을 새 결정처럼 고치지 않고, 현재 적용 안내에서 후속 승인·기존 정본을 연결한다.

**완료 기준:** 문서 진입점이 승인된 Vercel 구성으로 연결되고, 로컬 smoke를 클라우드 배포 완료로 오해하지 않는다. 배포·권한 범위를 넓히거나 비밀값을 읽지 않는다.

## Task 4 기능 범위와 일정 정리

**수정 파일:** `docs/04-DATABASE.md`, `docs/05-API-SPEC.md`, `docs/06-UI-UX.md`, `docs/12-ROADMAP.md`, `docs/13-NOTIFICATIONS.md`, `docs/18-HACKATHON.md`, `docs/19-DEMO-SCENARIO.md`, `docs/23-WEEKEND-FINETUNE.md`, `docs/submission/limitations.md`. `docs/09-SECURITY.md`·`docs/10-DEPLOYMENT.md`는 EMAIL 관련 현재 범위 안내만 대조해 필요한 경우 수정한다.

**읽을 기준:** ADR-039·041·042, 현재 `web/components/app-nav.ts`, `docs/06-UI-UX.md`의 사이드바 배지 제거 후속 결정.

- [x] P1의 옛 순차 착수 게이트를 ADR-042의 조건부 병행으로 맞추고 제출물의 핵심 컷 green 뒤에만 진행한다는 일반화를 고친다.
- [x] 이메일은 해커톤 승인 범위·opt-in·SMTP·`EMAIL` 채널의 설계로 반영한다. 현재 DB 채널·API·구현 현황과 구분하고 승인되지 않은 새 라우트나 DTO는 만들지 않는다.
- [x] 현행 일정 표·리허설 안내를 C9 3차 10-23 / freeze 10-24 22:00 / 최종 리허설 10-25 / 완료 목표 10-26 / 공식 제출 10-27로 맞춘다. 날짜가 붙은 과거 실행 로그는 보존한다.
- [x] 미출시 메뉴의 `planned`·비링크·404 상태와 실제 배지 문구를 구분한다. 상위 지침의 "준비 중 유지"가 화면에 배지를 다시 붙이라는 지시로 읽히지 않게 한다.

**완료 기준:** 승인 범위·착수 순서·일정이 ADR과 일치하고, EMAIL 설계를 이미 적용된 DB ENUM이나 발송 성공으로 설명하지 않는다.

## Task 5 검증 정책과 현재 시험 참조 정리

**수정 파일:** `docs/11-TESTING.md`, `docs/13-NOTIFICATIONS.md`, `docs/15-DATA-CONTRACTS.md`, `docs/boilerplate/AUTH-TESTING.md`, `docs/boilerplate/workflow.md`, `docs/boilerplate/setup.md`.

**읽을 기준:** ADR-046, `docs/17-CLAUDE-IMPLEMENTATION.md` 해커톤 검증 정책, `docs/evidence/verification/20261021-pruned-tests.json`, 실제 남은 시험 파일.

- [x] 현행 문장에서 참조하는 시험 파일의 존재를 `rg --files`로 확인하고 삭제 목록과 대조한다. 과거 결과를 설명하는 참조는 구분한다.
- [x] 알림·학습·인증 문서에서 삭제 시험을 현재 자동 검증 근거로 쓰는 문장을 현재 시험 또는 과거 검증 기록으로 바로잡는다. 대응 시험이 없으면 현재 자동 검증된다고 쓰지 않는다.
- [x] 작업 흐름의 개발 중 검증을 `pnpm verify:changed`, 통합·제출 시 전체 `pnpm verify`로 맞춘다. 작은 작업의 구현자 검증·통합 단위 독립 리뷰와 문서 전용 검증 예외를 연결한다.
- [x] 11 테스트의 현재 MVP 목록을 우선하는 안내와 과거 전체 표의 이력 표시를 유지한다. 시험 수를 별도 문서에 중복 고정하지 않는다.

**완료 기준:** 존재하지 않는 시험이 현행 보장 근거로 안내되지 않고, 삭제 시험 복구·매 단계 전체 검증·다중 QA를 새로 요구하지 않는다.

## Task 6 구현 상태와 진행 요약 정리

**수정 파일:** `docs/07-DATA-PIPELINE.md`, `docs/23-WEEKEND-FINETUNE.md`, `docs/PROGRESS.md`.

**읽을 기준:** `web/server/ingestion/fixture-attachment-fetcher.ts`, `web/server/ingestion/ingestion.service.ts`, `web/worker/ingest-queue.ts`, 실제 documents 소비자·fixture 첨부 경로, ADR-035의 보조 조회 구현 기록.

- [x] FixtureAttachmentFetcher 구현과 첨부 샘플·실행 연결·documents 소비자 미완을 나누어 적는다.
- [x] 보조 조회 3종은 구현됨, documents 소비자·첨부 본문 처리 등은 미완이라는 현재 상태로 맞춘다. 실행 시작 시 코드가 달라졌다면 새 HEAD를 근거로 갱신한다.
- [x] PROGRESS의 현재 요약과 중복 Vercel 요약을 정리하고, 각 단계의 수정·근거·검증 범위를 작업 로그에 기록한다. 날짜별 과거 로그의 당시 상태·시험 수치는 유지한다.

**완료 기준:** 부분 구현을 전체 미구현 또는 전체 완료로 묶지 않으며, 현재 요약과 과거 기록이 분리된다.

## Task 7 전체 문서 정합 확인

**수정 파일:** 앞 단계에서 실제 수정한 문서, `docs/evidence/documentation/20261021-docs-current-baseline-sync.md`(실행 완료 때 새로 생성할 검증 기록), 이 계획의 체크박스.

- [x] 수정한 문서의 Markdown 링크·위키링크·파일 참조·frontmatter·표 열과 위키링크 파이프 이스케이프를 확인한다. 코드블록·원래부터 없던 미래 산출물은 현재 파일과 구분한다.
- [x] `rg -n 'Qwen3\.5-9B|Qwen3\.5-27B|Kev-9B|배포처.*(미정|미결정)|데모 필수가 모두|핵심 컷 green 뒤에만|최종 리허설.*10-24' docs` 결과를 현재 안내·과거 기록·제안으로 판독한다. 문자열 0건을 목표로 일괄 삭제하지 않는다.
- [x] 앞선 감사 항목과 Task 1~6 완료 기준을 대응시켜 누락·새 모순을 한 번 대조한다. ADR-047·기존 미커밋 변경이 보존됐는지 시작 상태와 비교한다.
- [x] `git diff --check`와 변경 파일 목록을 확인한다. 이번 변경은 문서 전용이므로 ADR-046에 따라 코드 시험·빌드·Compose는 실행하지 않고 그 범위를 증거와 PROGRESS에 명시한다.
- [x] 검증 기록에 실행 HEAD·수정 파일·바로잡은 주장·현재 근거·남은 미검증을 남기고, 사용자에게 변경 요약을 보고한다. 새 제품 결정을 내려야만 해결되는 항목은 기존 정책을 유지한 채 분리해 보고한다.

**최종 완료 기준:** 감사의 운영 절차·시연 주장·배포·P1·EMAIL·검증·일정·service role·부분 구현·예정 증거 항목을 모두 처리했고, 보존 이력과 승인 대기 설계를 현행 완료로 바꾸지 않았다.

## 관련 문서

- [[CLAUDE|정본 지침]]
- [[00-README|문서 인덱스]]
- [[16-DECISIONS|결정 기록]]
- [[17-CLAUDE-IMPLEMENTATION|구현·검증 정책]]
- [[PROGRESS|진행 상황]]
