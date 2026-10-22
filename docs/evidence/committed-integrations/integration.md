---
title: "커밋된 브랜치 통합 기록"
status: review
updated: 2026-10-22
---

# 커밋된 브랜치 통합 기록

사용자 요청: “지금까지 커밋은 했는데 push 안 된 것들 push 하고 main에 합쳐”. 기준 main은 `d57fcae7a10ab12e99d5941a2cc4296991f262fe`이며 native 격리 작업 트리의 `integration/committed-work-20261022`에서 기능을 통합한다. 이 문서는 기능·이력·운영 적용을 구분한다.

## 원본 보존과 대응

로컬 미발행 제품 브랜치 17개를 먼저 동일 이름으로 origin에 push했다. 이미 origin에 있던 AI·회사 runtime 브랜치도 main 통합 범위다. 원본 브랜치는 삭제하지 않는다. 아래에서 “현재 구현 유지”는 오래된 브랜치의 덮어쓰기를 하지 않고 대응 코드를 확인했다는 뜻이다.

| 원본 브랜치 | 통합 방식과 현재 결과 |
|---|---|
| `feat/bosun-english-translations`, `integration/bosun-english-translations`, `fix/qwen-body-document-id` | 번역·문서 인용 ID·Docker 쓰기 권한 및 커밋된 인증/데모 사본을 정상 merge. 새 번역 검토 flag를 forward SQL로 허용. 중복 dependency reporter는 기존 Worker의 Storage/AI health reporter로 대체 |
| `feat/company-runtime-deployment` | 회사 Redis 재사용 runtime 준비, 서비스별 env 예시, web-only Vercel, 인증된 관리자 AI 상태 GET을 이식. 실제 회사 기동·운영 env 전환은 미실행 |
| `feat/n2-org-settings` | 현재 조직 ADMIN의 멤버·초대·업무 역할·감사 화면을 이식. 구버전 audit action 축소 SQL 대신 현재 PROJECT_* 허용 집합을 유지하는 새 trigger migration |
| `feat/s5-change-detection` | revision 이력·필드 diff·상세 링크를 이식. nullable 기관/제목 및 structured qualification JSON과 현재 snapshot 계약을 호환 |
| `feat/p08-prespec-plan` | 발주계획/사전규격 단계 연결을 현재 7단계로 이식. provider namespace·확인된 기관 ID·DEMO 경계 유지. 구버전 live 정보화 사전필터는 ADR-047에 따라 도입하지 않음 |
| `feat/n3-watchlist`, `feat/n6-bid-projects` | main의 최신 관심 공고·D-3/D-1 알림·프로젝트 UI/API·원자 자산 수정을 유지. 대응 domain/SQL을 대조했고 같은 기능을 다시 도입하지 않음 |
| `feat/n9-analysis-card`, `fix/c9-followups-ui` | main의 새 대시보드 KPI/포트폴리오/4개 업무화면 연결을 유지. 상세 AI 미완료 안내와 모델 분포의 확률 오인 방지 문구만 추가. 과거 5개 카드 배치는 최신 공공조달 화면으로 대체됨 |
| `feat/kakao-notify-r2` | 카카오 개인 연결·동의·해제·시험·outbox/mock 발송을 이식. OFF 직전 재확인 및 durable claim으로 중복 전송 방지 보완 |
| `feat/kakao-notify` | r2와 원본 파일/SQL 의미 대응을 확인하고 원본 이력 보존. 같은 migration을 두 번 만들지 않음 |
| `feat/program-notices-r2` | 기업마당/중기부 지원사업 adapter·별도 목록·필터·원문 링크·모드/RLS를 이식. 점수·분석·알림과 분리 |
| `feat/program-notices`, `feat/program-notices-ui` | 원본/r2 및 UI의 patch equivalence를 확인하고 원본 이력 보존 |
| `docs/kakao-notify-design` | main의 기존 3개 동등 설계 commit을 유지. 실제 migration 번호/구현 상태는 이번 기록과 정본 상단에 정리 |
| `docs/current-code-reconcile` | 최신 main의 설계·정책을 유지하고 고유 CLI/조사 증거를 보존 |
| `docs/sync-28` | 현행 모델/평가/embeddings 정정과 대조. 오래된 정본 덮어쓰기 없이 이력을 보존 |
| `docs/hackathon-deck` | PPTX·슬라이드 spec·미리보기와 outline 링크를 보존. 10-21 초안이며 현재 구현/운영 사실과 재대조 필요 |
| `feat/fx01-vertical` | 원본 `82bea1b`와 후속 `3d065`는 이미 main 조상. 최신 v0.2/공공조달 구현을 유지하고 provenance를 보존. 초기 v0.1 전체 코드와 삭제한 전수 시험을 복원하지 않음 |

고유 과거 설계·화면 증거는 [가져온 자료 목록](historical-document-imports.json)에 보존한다. 당시의 “main 미병합”, 구 migration 번호, 검증 수치는 역사 기록이며 현재 상태를 뜻하지 않는다. [수집/알림 파일 대응표](source-adapters-port.json)는 raw/r2의 SQL 대응과 제외한 과거 시험을 기록한다.

기능 대응을 확인한 뒤 최신 내용이 아닌 구버전 diff의 재적용을 막기 위해 원본 제품 브랜치 tip의 ancestry를 별도 `ours` merge로 연결한다. 이것은 기능 이식을 대신하지 않는다. 기능 검증은 첫 통합 commit의 실제 tree를 대상으로 한다. 제품이 아닌 Git 시험용 `recovery/first-bundle-hook-baseline-20261021`은 제외하고 로컬 복구 ref를 유지한다.

## 스키마와 운영 경계

기준 main의 migration 41개는 파일 내용·이름을 모두 보존한다. 운영 DB에는 새 SQL을 실행하지 않는다.

| 새 migration | 역할 |
|---|---|
| `20261023000500` | `TRANSLATION_INCOMPLETE` 검토 flag 저장. 모르는 flag 거절 유지 |
| `20261023000600` | 조직 역할/초대 감사 trigger. 기존 프로젝트 action 유지 |
| `20261023000700` | 카카오 개인 연결 표·본인 전용 RPC 4개·열 권한 |
| `20261023000701` | 현재 `finish_score_run`에 추천 outbox만 추가. 기존 상태/조직/attempt/원자 계약 보존 |
| `20261023000702` | 토큰 RPC·시험 발송 상한 보안 보강 |
| `20261023000703` | 본인 시험 메시지 빈도 조회 index |
| `20261023000704` | Worker 전용 전송 의도 claim. 송신 결과가 불확실한 시도는 자동 재송신하지 않음 |
| `20261023000800` | 별도 지원사업 표·worker 저장 경로·authenticated 읽기 RLS |

DB 타입은 전체 migration에서 `pnpm db:types`로 생성한다. 새 worker 전용 함수는 화면에 열지 않는다. 화면용 RPC의 DB 검증 예외는 본인 행·auth.uid()·고정 search_path를 확인한 카카오 4개 서명만 명시한다.

실행 기본은 `SOL_RUN_MODE=mock`, `NOTIFY_KAKAO_PROVIDER=mock`이며 실제 API 수집·카카오 발송·모델 교체·운영 DB/서버/Redis/Nginx 변경·운영 전체 재수집은 하지 않는다. Git push가 연결된 배포를 촉발할 수 있으므로 새 migration/회사 runtime 활성화는 별도 운영 단계다. 미적용 DB의 설정 화면은 카카오 칸만 숨기고 나머지 설정을 연다.

## 보존·보안 검증

- 기존 main의 40개 미커밋/미추적 파일은 먼저 patch·status 사본으로 보존했다. 별도 브랜치의 `26f0f90` 사본과 40/40 byte 일치를 확인했다. 이 커밋은 이미 존재한 작업이므로 통합 범위에 포함한다.
- 미발행 이력 71개 commit·텍스트 blob 574개에 가드를 적용해 차단 0건. 실제 env 파일은 발행 대상 0개이며 키 값은 출력하지 않았다. 바이너리 문서/화면은 비밀값 OCR 전수 검사를 했다고 주장하지 않는다.
- 기존 N3/N6 SQL·원자 수정과 Storage/health/cleanup worker 경로를 보존했다. worker는 기존 7종에 지원사업 1종만 추가한다.
- pruning 명세에서 삭제했던 시험 경로의 신규 복원 0개. 새 시험은 신규 경계와 실제 발견 결함에 한정한다.
- 독립 통합 리뷰: P1 카카오 전송 후 DB 실패 시 중복 발송을 확인해 durable claim으로 보완한다. 같은 원인에 대한 회귀와 최종 재검토를 수행한다.

## 최종 검증과 원격 상태

전체 `pnpm verify` exit0: 루트202·웹469(56파일)·AI153·결정57, Next 프로덕션 빌드·타입·린트·계층·토큰·색·생성 DB 타입 검사 통과. 처음에는 새 DB 회귀 파일의 서식1건이 실패했고 수정·동결 후 전체를 다시 실행해 통과했다. [검증 로그](verify.txt), [집계](verification.json), [보존 감사](preservation.json).

독립 리뷰 P1은 durable claim과 실제 DB 저장 실패 재현으로 해결됐다. 첫 실패 뒤 sends1/DEAD/TIMEOUT_UNKNOWN이고 재처리 뒤에도 sends1이었다. 새 회귀와 DB 권한·교차 조직 claim 검증도 통과했으며 남은 blocking은0이다. 실제 외부 발송은0회다.

변경 화면은 격리 localhost DB의 기존 계정/데이터로 1440·1280에서 확인했다. N2 ADMIN 화면/SALES 차단, P0-8 단계 연결, S5 첫 revision, 카카오 미연결 설정, 지원사업 빈 상태·필터/API 권한 등18개 확인과 화면14장을 남겼다. 브라우저 오류·외부/변경 요청·가로 넘침은0이다. 로컬 DB는49개 migration 검증 통과, 기존7개 주요 표 지문이 같다. [브라우저 결과](browser.json).

이번 로컬 브라우저는 revision1과 지원사업0건 데이터로 실행했으므로 다중 revision diff·지원사업 채워진 목록/drawer는 단위/API 시험과 과거 화면 증거를 참고한다. 실제 운영/외부 검사를 통과했다고 주장하지 않는다. main push/원격 ancestry 결과는 최종 후속 기록으로 남긴다.

## main push 완료

기능 통합 `6b4ff0a`와 원본 이력 연결 `73eac5a`를 정상 커밋 게이트로 저장하고 통합 브랜치와 main에 push했다. 첫 원격 확인에서 main/origin main 모두 `73eac5a819a19156de12bfd3ac731808d814345b`다. [Git 감사](git-main.json)는 제품 브랜치21개 tip의 main 도달과 제품 미발행 commit0을 확인한다. 이후 이 문서 완료 기록 commit이 main에 추가된다. 최종 ref는 `git rev-parse main`과 `git ls-remote origin refs/heads/main`으로 확인한다.

원본 작업 폴더40개는 기존 커밋 `26f0f90`과 모두 byte일치했고 그 커밋이 main에 포함됐다. 35개는 최종 파일도 동일하며5개 정본은 승인된 번역/runtime/통합 설명을 추가했다. main을 안전 stash 후 fast-forward했고 이미 반영된 과거 사본을 재적용해 새 설명을 되돌리지 않았다. [원본 보존](original-work-preservation.json), stash `a3446713c1b874bc81b2cbc9b336b84ff2305bcd`와 원본 브랜치를 삭제하지 않는다. 이력 연결 commit의 내용 변경은 가져온 문서/로그의 끝 공백 정리4개뿐이며 검증된 소스는 같다.

운영 새 SQL8개 적용·회사 프로세스 기동·실 API 인증/수집·카카오 실발송·모델 교체·운영 배포는 이번 Git 작업에서 실행하지 않았다. 로컬 검증용 DB 적용49개와 운영 적용을 구분한다.
