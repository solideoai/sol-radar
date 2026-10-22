---
title: "Bosun 영어 State 번역 — 로컬 검증 보고"
status: draft
tags: [sol-radar, ai, test, security]
updated: 2026-10-22
---

# 구현 결과

- 작업 공간: `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/bosun-english-translations`
- 브랜치: `feat/bosun-english-translations`, 기준 `main@d57fcae`.
- 원래 main은 사용자 설명과 달리 이미 다른 변경이 있었다. 기존 변경을 건드리지 않고 커밋된 main HEAD에서 격리했다. 내장 worktree 생성은 저장소를 찾지 못해 실패하여 Git fallback을 사용했다.
- 최초 구현은 미커밋 상태로 남겼으며, 후속 사용자 요청에 따른 커밋·통합 준비 기록은 아래 절에 정리한다. main 병합/push/배포를 하지 않았다.

## 변경 동작

검증된 추출의 실제 State 경로를 수집하고 별도 Qwen 번역 prompt/schema로 호출한다. 원래 추출 prompt와 requirement-extraction.v0.1.json은 변경하지 않았다. 기존 Qwen endpoint/인증/TLS/리다이렉트 방어/HTTP Deadline을 재사용한다.

공고 번역은 추출·재시도와 같은 AI_TIMEOUT_MS Deadline이다. 프로필은 /extract에 없으므로 /kev에서 기존 KEV_TIMEOUT_MS Deadline 안에 기업 번역을 보충한다. 공고 누락을 /kev에서 재번역하지 않는다. State의 원래 공고 경로를 유지하고 기업은 profileSummary.* 경로를 사용한다. COMPANY trace recordKey는 기존 값을 유지한다. 자격 detail과 버전/괄호 세부 조건도 보존한다.

번역 결과는 엄격 JSON/중복 키/허용 경로/ASCII 영어/숫자 다중집합/기술 식별자/숫자 단위/주요 비교·필수·부정 표현/인젝션 패턴으로 검사한다. 최대64항목·값당2,000자·요청/응답 각64KiB다. 초과·누락은 원문을 자르거나 임의 번역하지 않고 경로로 표시한다.

번역 실패에도 원래 추출 payload, payload.warnings, evidence, quotedText는 그대로다. 최상위 경고와 PENDING_REVIEW로 전달한다. 실제 모델은 필요한 번역이 누락되면 호출하지 않고 enabled=false/KEV_UNAVAILABLE/warnings를 반환한다. Worker는 규칙만 사용하고 TRANSLATION_INCOMPLETE 검토 플래그와 경로 진단을 남긴다. 저장된 검토 플래그를 상세 화면 스키마/라벨도 받는다. mock은 기존 고정 fixture 계약을 유지하며 실제 모델 판단으로 표시하지 않는다.

## 검증 결과

| 검사 | 결과 |
|---|---|
| 변경 전 추출 기준선 | test_extraction_schema.py + test_local_qwen.py: 10 passed |
| 신규 번역 시험 | 37 passed |
| pnpm verify:changed | 통과. 이후 리뷰 수정과 UI 플래그 보완은 아래 최종 전체 검증으로 재확인 |
| 최종 pnpm verify | exit 0 |
| 루트 Node 시험 | 191 passed |
| 웹 Vitest | 446 passed, 51 files |
| AI pytest | 138 passed (기존 추출10 포함) |
| 결정 서비스 pytest | 57 passed |
| 타입/린트/서식/계층/DB 타입/토큰/색 검사 | 통과 |
| Next.js production build | 통과, 서버 기동 없음 |
| git diff --check | 통과 |
| 독립 코드 리뷰 | 조건 반전 P1 1건을 실제 재현 → 5개 회귀 추가 → 수정. 재검토 중대한 미해결 없음 |

[전체 검증 로그](20261022-bosun-translations-verify.txt). 기존 FastAPI TestClient/httpx 관련 Starlette deprecation 경고는 남아 있다. 게이트/훅/테스트를 끄지 않았다.

### 주요 시험 근거

- 한국어 기술/자격 detail/실적/인력/기업 경로 번역과 v0.2 실제 wire State의 영문 값.
- 숫자·금액·연수/건수/인원 단위·Java/ISO/RAG 식별자 유지, 조건 반전/부정/공백/한국어/placeholder/임의 숫자 거부.
- 검증에 실패해 UNKNOWN이 된 필드는 번역 요청에서 제외.
- 추출 성공과 번역 실패의 payload 전체 비교가 동일함; trace에 원문 quotedText와 원래 COMPANY recordKey 유지.
- 번역 503/잘못된 JSON/스키마 위반/중복 키/과대 응답/과대 입력/누락/인젝션 출력 처리.
- 추출·번역이 동일 Deadline 객체를 공유. 350ms 요청 예산(추출150ms + 번역 지연5초)이 예산 내 timeout으로 추출 결과를 반환. 기업 번역도 기존200ms /kev 예산 안에서 끊고 Bosun을 호출하지 않음.
- Qwen 추출 자체 timeout/리다이렉트 및 mock fixture 회귀 유지.
- Worker fixture/live 번역 저장/전달과 안전 플래그, 기존 warnings 없는 /kev 응답 호환.

## 남은 위험 및 검증 경계

1. 실제 회사 Qwen/Bosun API, GPU 및 운영 서버에 연결하지 않았다. 실모델 번역 품질/도메인 판단 성능/지연은 검증하지 않았다. 가짜 서버 통과를 실제 서비스 완료로 주장하지 않는다.
2. 요청 안의 추출 성공은 번역 장애로 FAILED가 되지 않지만 PENDING_REVIEW가 늘 수 있다. 정상 경로에도 Qwen 번역 호출 지연이 추가된다. Deadline 초과는 막지만 기존과 같은 응답시간을 보장하지는 않는다.
3. 기업 번역은 매 /kev 요청의 기존 예산을 소비한다. 기본5초 안에 기업 번역+Bosun이 완료되는지 실측이 필요하다. 기업 번역 캐시는 추가하지 않았다.
4. 기존 translations=null 또는 불완전한 캐시는 자동 재추출/DB backfill하지 않는다. 누락을 명시하고 실제 Bosun을 차단한다. 갱신하려면 별도 캐시 갱신 절차가 필요하다.
5. 결정적 검증은 의미 동치 전체를 증명하지 못한다. 복잡한 AND/OR, 예외, 범위는 사람의 원문 검토와 별도 평가가 필요하다. 검증은 보수적으로 정확한 번역도 거절할 수 있다.
6. HTTP 이름 조회(getaddrinfo)가 Deadline 밖이라는 기존 transport 한계는 그대로다. 응답 socket/read/write 및 번역 재시도는 동일 남은 예산을 사용한다.
7. 로그인/E2E/브라우저 접근성 검사는 이번 변경에 실행하지 않았다. UI 변경은 검토 플래그 스키마/라벨 추가이며 타입/전체 웹 시험/빌드를 확인했다.
8. 비밀키 출력/커밋, 모델 재시작, Docker 실행/재배포, DB/운영 env 변경을 하지 않았다.

## 변경 파일 전체 목록

- `docs/03-AI-PIPELINE.md`
- `docs/PROGRESS.md`
- `docs/evidence/ai/20261022-bosun-translations-verify.txt`
- `docs/evidence/ai/20261022-bosun-translations.md`
- `docs/plans/2026-10-22-bosun-translations.md`
- `polaris/specs/in-progress/2026-10-22-bosun-translations.md`
- `services/ai/prompts/state-translate.v0.1.md`
- `services/ai/schemas/state-translation.v0.1.json`
- `services/ai/src/sol_ai/adapters/base.py`
- `services/ai/src/sol_ai/adapters/kev.py`
- `services/ai/src/sol_ai/adapters/qwen.py`
- `services/ai/src/sol_ai/app.py`
- `services/ai/src/sol_ai/contracts.py`
- `services/ai/src/sol_ai/extraction.py`
- `services/ai/src/sol_ai/kev_state.py`
- `services/ai/src/sol_ai/kev_state_v02.py`
- `services/ai/src/sol_ai/translation.py`
- `services/ai/src/sol_ai/translation_validation.py`
- `services/ai/tests/test_local_kev_v02.py`
- `services/ai/tests/test_local_qwen.py`
- `services/ai/tests/test_mock_identity.py`
- `services/ai/tests/test_translation.py`
- `web/components/bids/labels.ts`
- `web/server/analysis/analysis.model.ts`
- `web/server/analysis/analysis.service.ts`
- `web/server/analysis/fallback.model.ts`
- `web/server/analysis/gateway.model.ts`
- `web/server/analysis/translation-pipeline.test.ts`
- `web/server/bids/bid.model.ts`
- `web/server/bids/translation-review-flag.test.ts`

## main 통합 준비 — 변경 범위 및 비밀정보 검토

사용자 후속 요청에 따라 기존30개 파일을 모두 검토했다. 기존 보고서 목록과 실제 수정/신규 파일 목록은 각각30개로 동일하며 누락/추가 파일은 없다.

| 구분 | 파일 수 | 범위 |
|---|---:|---|
| 제품 코드 | 16 | AI 번역 어댑터/검증/State, Worker 안전 처리, 검토 플래그 계약/표시 |
| 테스트 | 6 | AI 기존3+신규1, 웹 신규2 |
| 프롬프트·스키마 | 2 | 별도 State 번역 전용 |
| 문서·검증 로그 | 6 | 파이프라인/진행 기록, 계획/요구사항, 이 보고서와 검증 로그 |
| 합계 | 30 | 번역 기능·검증·직접 관련 기록 |

무관한 기능 수정은 발견하지 않았다. 특히 DB 마이그레이션, 패키지/잠금 파일, 환경변수 파일, 모델 레지스트리, Docker/배포 설정, 기존 추출 prompt/schema, 훅/검사 설정은 변경 목록에 없다. 기존 추출 테스트의 수정은 새 번역 응답을 가짜 서버에 추가하기 위한 것이며 실패/타임아웃 검증을 유지한다. 상세 화면 파일2개는 새 검토 플래그가 저장 결과에서 거부되는 것을 막기 위한 직접 연관 변경이다.

30개 파일의 전체 내용과 diff를 검토하고, API/provider token·JWT·AWS 키 형식·개인키 PEM·문자열 credential 할당·URL 내 인증정보 패턴을 검사했다. 일치0건이며 커밋할 실제 비밀정보는 발견하지 않았다. 검사는 변경 파일/로그에 한정했고 환경변수 파일은 읽지 않았다. 이 검토를 모든 가능한 비밀정보 부재의 수학적 보장으로 해석하지 않는다. 기존 로그의 로컬 경로/공개 라이브러리 경고는 검증 맥락으로 유지한다.

커밋 직전 전체 `pnpm verify`를 다시 실행해 exit0을 확인했다. 루트191·웹446·AI138(기존 추출10 포함)·결정57, Next production build 및 타입/린트/서식/계층 검사가 모두 통과했다. 기존 검증 로그 파일을 이번 실행 결과로 갱신했다(진행 표시의 CR/줄 끝 공백만 정규화). 제품 코드 수정은 없으며 이후 커밋 훅도 우회하지 않는다.

main은 읽기 전용으로 HEAD, tracked/새 파일40개의 상태와 SHA-256, index SHA-256을 기록했다. 작업 종료 때 같은 기록과 대조한다. 별도 승인 없는 main 변경/병합/배포/DB/env 조작은 하지 않는다.

## 관련 문서

- [[03-AI-PIPELINE]]
- [[PROGRESS]]
- [구현 계획](../../plans/2026-10-22-bosun-translations.md)
