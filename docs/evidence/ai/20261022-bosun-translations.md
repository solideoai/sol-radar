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
- 사용자 후속 요청으로 기능 커밋 `1950202815300987e7b5140c4111f412a863d21a`(30개 파일)을 만들었다. 후속 통합 준비 기록과 병합 제안은 아래 절에 정리한다. main 병합/push/배포를 하지 않았다.

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

## 커밋 결과 및 main 비교

| 항목 | 결과 |
|---|---|
| 기능 커밋 | `1950202815300987e7b5140c4111f412a863d21a` |
| 메시지 | `feat(ai): Bosun 영어 State 번역 추가` |
| 기능 커밋 변경 파일 | **30개**(검토한 목록과 동일) |
| 커밋 직후 번역 worktree | clean |
| 커밋 훅 | pre-commit 정책 검사, 웹/AI/결정 서비스 검사, 서식 검사 및 commit-msg 통과. 우회 없음 |
| 최신 로컬 main | `d57fcae7a10ab12e99d5941a2cc4296991f262fe` |
| 공통 조상 | `d57fcae7a10ab12e99d5941a2cc4296991f262fe`(main과 동일) |
| main에만 있는 새 커밋 | 0개 |
| 기능 브랜치에만 있는 커밋 | 기능 커밋 기준1개. 이 보고서 후속 문서 커밋은 별도 |
| main 미커밋 상태 | tracked 수정16개 + 새 파일24개 = **40개** |
| 파일 경로 중첩 | `docs/PROGRESS.md` **1개** |
| 제품 코드 경로 중첩/신규 파일 충돌 | **0개** |
| 임시 복사본 3방향 계산 | `git merge-file -p`: exit0, 충돌 마커0개 |
| main 보존 검사 | HEAD·status40개·파일 SHA-256·index SHA-256 모두 시작 시점과 일치 |

여기서 최신 main은 검사 시점의 로컬 `refs/heads/main`이다. 원격 fetch/PR/push를 하지 않았으므로 원격의 최신 상태를 보증하지 않는다. main 작업 폴더에서 checkout/add/stash/commit/merge를 실행하지 않았다. 파괴적 정리 명령도 사용하지 않았다.

### 충돌 가능성

커밋 이력만 보면 main이 기능 커밋의 직접 조상이므로 fast-forward 가능한 관계다. main에 새 커밋이 생기거나 기존 미커밋 작업을 커밋하면 이 판단을 다시 계산해야 한다.

main 작업 중첩은 `docs/PROGRESS.md`뿐이다. main의 조사/관리자/기존 진행 기록 수정과 번역 브랜치의 영어 State 구현 기록을 공통 조상과 함께 **임시 디렉터리**에서 3방향 계산했다. 현재 스냅샷은 자동 결합되며 텍스트 충돌은 없다. 임시 결과를 어느 worktree에도 덮어쓰지 않았다. main이 dirty이므로 실제 main 병합의 덮어쓰기 보호가 작동할 수 있으며, 이 계산이 지금 바로 병합해도 된다는 승인은 아니다.

서로 다른 파일의 문서 의미는 추가로 맞출 필요가 있다. main 작업본의 `docs/09-SECURITY.md:183`은 자유 텍스트를 `/extract` translations만으로 설명하지만 이제 기업 값은 `/kev`에서도 번역한다. `docs/11-TESTING.md:152`는 미번역 값을 `(untranslated)`로 표시하는 기준만 적고 있어 실제 Bosun 차단/검토 플래그 기준을 함께 반영해야 한다. 이 두 파일은 main의 기존 미커밋 작업이므로 이번 브랜치에서 수정하지 않았다. `docs/04-DATABASE.md`의 기존 nullable translations 열은 그대로 호환되며 DB 변경이 필요하지 않다.

### 제안하는 병합 절차 — 이번 작업에서 실행하지 않음

1. 병합 직전 main/기능 브랜치 HEAD와 양쪽 status를 다시 기록한다. main의 변경40개와 tracked diff·staged diff·새 파일을 검증 가능한 별도 백업으로 먼저 보존한다. 필요하면 소유자가 커밋 가능한 작업만 별도 보존 브랜치에 커밋한다. 새 증빙 파일을 포함해 무조건 `git add .`하거나 자동 stash/pop하지 않는다. 이번 검토는 main의 모든 새 파일을 공개 커밋해도 된다는 검토가 아니다.
2. 최신 main에서 **새 통합 검토 브랜치/worktree**를 만들고, 그곳에서 이 기능 브랜치를 병합해 확인한다. 기존 main 작업을 함께 통합할지는 소유자가 정한다. 함께 반영할 경우 `docs/PROGRESS.md` 양쪽 기록을 보존하고 위 보안/테스트 문서의 설명을 현재 동작에 맞춘다. 기존 main worktree에는 파일을 복사하거나 덮어쓰지 않는다.
3. 통합 결과에서 `pnpm verify:changed --base <병합 전 main SHA>`와 전체 `pnpm verify`를 실행한다. 한국어 공고/기업 번역·금액/조건 보존·원문 evidence 불변·실제 v0.2 영문 wire·누락 차단·mock/fixture/live 전달·타임아웃을 확인한다. 현 브랜치의 테스트 성공을 미래 통합본의 성공으로 대체하지 않는다.
4. 검토 결과와 차이/검증 기록을 준비해 **별도 main 병합 승인**을 받는다. main의 미커밋 작업이 안전하게 보존되고 worktree가 정리된 뒤, 승인된 통합 커밋으로 main을 이동한다. 새 변경이 끼었으면 충돌 분석/검증을 다시 한다. main 작업 보존 및 복원은 파일 해시/상태로 확인한다.
5. push·운영 배포·실제 모델 연결 검증·기존 번역 캐시 갱신은 각각 별도 작업으로 남긴다. 이 번역 기능 통합 자체에는 DB 마이그레이션/GPU 재시작/운영 env 수정이 필요하지 않다.

### 남은 위험

- 실제 Qwen/Bosun 번역 품질·응답시간과 기업 번역 후 남는 `/kev` 기본5초 예산은 실측하지 않았다.
- 기존 `translations=null`/불완전 캐시는 자동 갱신되지 않아 Bosun이 차단된다. 별도 캐시 갱신 절차가 필요하다.
- 비교/부정/숫자 검증은 의미 동치 전체를 보증하지 않는다. AND/OR·예외·범위는 원문 검토가 필요하다.
- main의 미커밋 작업과 이후 추가 커밋은 이번 코드 검증 범위 밖이다. 특히 사용자 작업을 함께 통합한 결과의 전체 검사와 문서 정합성 확인이 남는다.

## 기존 작업과 번역 기능의 격리 통합 (2026-10-22)

사용자 추가 지시에 따라 **`integration/bosun-english-translations`**를 새 worktree `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/integration-bosun-english-translations`에 만들었다. main 원본은 읽기 전용으로 유지했다. 내장 worktree 도구가 저장소를 찾지 못해 실패한 뒤 Git worktree로 생성했다.

**통합 병합 커밋:** `3e6b18004ef25bbd0a3d4115f6ea3c12f96ec66e` (`feat: 기존 작업과 Bosun 영어 번역 격리 통합`). 부모는 사본 `26f0f90` 및 번역 `11907f3`이며, 사본 커밋 대비37개 파일을 반영했다. main 대비 누적 변경 파일은73개(기존40 + 번역30 - 중첩 PROGRESS1 + 통합 증거4)다. 커밋 뒤 main 보존 검사를 다시 통과했고 통합 worktree는 clean이었다. 이 해시를 기록하는 후속 문서 커밋은 별도로 남긴다.

### 보존 및 통합 범위

- 기준 main: `d57fcae7a10ab12e99d5941a2cc4296991f262fe`.
- 기존 미커밋40개(수정16/신규24), staged/unstaged binary patch와 index 원본을 권한을 제한한 별도 로컬 보존본으로 복사했다. 환경변수 파일은 읽거나 복사하지 않았다. [보존 manifest](20261022-bosun-integration-preservation.json)에 보존본 위치·파일 SHA-256·index SHA-256을 기록했다. 이 보존본은 로컬 임시 경로이므로 영구 외부 백업을 대신하지 않는다.
- **기존 작업 사본 커밋:** `26f0f906f4918cf7032d3de1ebf54d8c9d71642c`. 통합 브랜치에서만 커밋했고40개 모두 스냅샷과 byte 단위로 같다. main에서 add/checkout/stash/commit/merge를 실행하지 않았다.
- **번역 입력:** 기능 `1950202815300987e7b5140c4111f412a863d21a` + 보고서 `11907f34b14afc95f2856382aaf7fb3513c27ece`. cherry-pick 사본 대신 이력과 두 부모를 보존하는 병합으로 반영했다.
- `docs/PROGRESS.md`는 **자동 병합, 충돌0건**이다. 기존 조사·데모 관리자·기존 통합 기록과 번역 기록을 모두 유지하고 맨 위에 현재 격리 통합 상태를 추가했다. 과거 진행/운영 기록을 이번 작업의 운영 실행 결과로 바꾸지 않았다.
- 문서04는 공고 번역 저장과 기업 번역 비저장을 구분하고, 09/11은 기업 보충 번역/누락 차단을 반영했다. 03에는 선택형 `/kev.warnings`, 번역 경고와 검토 플래그 계약을 맞췄다. 기존40개 중36개는 통합 worktree에서도 byte 단위로 유지하며, 의도적으로 조정한4개는 문서04/09/11/PROGRESS뿐이다.
- 기존 로그인 별칭·부서/직급 카탈로그·데모 계정 스크립트와 연관 시험/문서는 함께 통합했다. 이 스크립트의 실제 실행은 하지 않았다. 기존 증빙의6개 credential 패턴 일치는 문서 예시/시험용 값이며 실제 키를 발견하지 않았다. 운영 계정/토큰을 새로 생성하거나 변경하지 않았다.

### 통합본 검증

| 검사 | 결과 |
|---|---|
| 전체 `pnpm verify` | **exit0** |
| 루트 Node | **195 passed** |
| 웹 Vitest | **448 passed**, 52 files |
| AI pytest | **138 passed**(기존 추출10, 번역37 포함) |
| 결정 서비스 pytest | **57 passed** |
| 타입·린트·서식·계층·토큰·색·DB 타입 대조 | 통과 |
| Next.js production build | 통과, 서비스 기동 없음 |
| Python 실제 응답 → Worker 검증기 | mock/local 추출 봉투 및 payload, mock/v0.2 wire, 누락 차단, 이전 응답 호환 통과 |
| 독립 통합 리뷰 | 중대한 미해결 없음. 기존 코드 의존성/API/trace/원본 보존 확인 |
| main 보존 | HEAD/branch/index/status40개/파일40개 SHA-256 모두 시작 시점과 동일 |

[통합 전체 검증 로그](20261022-bosun-integration-verify.txt), [서비스 간 계약 검사 결과](20261022-bosun-integration-contract.txt), [Python gateway 응답 사본](20261022-bosun-integration-contract-sample.json). 기존 Starlette TestClient/httpx deprecation 경고는 남아 있다. commit hook도 우회하지 않는다. 최초 병합 커밋 시도는 제품 검사 통과 뒤 허용되지 않는 `merge:` 메시지 타입 때문에 commit-msg가 거부했다. 허용된 `feat:` 타입으로 고쳐 훅을 다시 실행했고 모든 검사와 커밋이 통과했다. 제품 코드나 검사를 약하게 바꾸지 않았다. 운영 Supabase/Redis/DB를 사용하지 않고, DB 관련 자동 시험은 기존 in-memory PGlite 검사만 수행했다. 로그인 E2E는 외부 서비스 조작 금지 범위 때문에 실행하지 않았다.

### API 계약 대조

| 경계 | 확인 내용 |
|---|---|
| `/extract` → Worker | 기존 status/payload/errorCode 유지. mock translations=null, local은 dict[str,str]. 실제 gateway JSON을 extractResponseSchema와 readExtractResult로 검증 |
| 추출 원문/근거 | 원래 extraction prompt/schema 및 payload/evidence 불변. 번역 실패도 성공 추출 보존, 최상위 경고/PENDING_REVIEW |
| Worker → `/kev` | 공고 기존 경로·profileSummary·stateLanguage=en·kev-qs/v0.2 계약 유지. 기업은 profileSummary.* 번역 키로 보충 |
| `/kev` → Worker | 새 warnings는 선택 필드여서 이전 응답도 수용. 실제 v0.2 wire는 readKevWire 통과. 번역 누락 응답은 enabled=false/KEV_UNAVAILABLE/wire=null과 안전한 경로 전달 |
| 저장/상세 화면 | TRANSLATION_INCOMPLETE 코드가 기존 문자열 review_flags 및 상세 스키마에서 수용됨. 기존 translations JSONB nullable 유지, DB 변경 없음 |

서비스 간 계약 검사는 `/extract`·`/kev`를 실제 FastAPI TestClient로 실행해 나온 JSON을 Worker 코드의 검증기로 읽었다. Qwen/Bosun은 loopback 가짜 모델 서버만 사용했다. 번역 누락 시 fake Bosun 호출 횟수도 증가하지 않는 것을 확인했다. fixture/live Worker 전달·mock 회귀·인용/trace 보존·타임아웃은 전체 자동 시험에도 포함된다.

### main 병합 전 주의사항

1. 현재 main에는 원래40개가 그대로 남아 있다. 통합 브랜치에 그 사본을 커밋했다고 main 작업 폴더가 clean해진 것이 아니다. 원본과 index를 검증해 보존/정리한 뒤 별도 승인으로 main을 병합해야 한다. 이번 작업은 통합 브랜치에서 끝낸다.
2. 이 통합 브랜치는 번역뿐 아니라 기존40개(로그인/데모 관리자/문서/증빙)도 포함한다. main 반영 전 해당 전체 범위를 검토해야 하며, 새 main 커밋/미커밋 변경이 생겼으면 다시 대조한다. 원격 fetch/push는 하지 않았다.
3. 실모델 품질/지연, 기업 번역 뒤 남는 KEV_TIMEOUT_MS 예산과 기존 translations=null 캐시 갱신은 별도 검증/절차가 필요하다. 의미 동치 전체는 검증기가 보증하지 못하며 최종 판단은 사람이 한다.
4. 운영 서버·DB·Redis·Supabase·환경변수·GPU/모델·Docker를 변경하지 않았다. 기존 증빙/운영 기록은 보존한 과거 자료다.

## 관련 문서

- [[03-AI-PIPELINE]]
- [[PROGRESS]]
- [구현 계획](../../plans/2026-10-22-bosun-translations.md)
