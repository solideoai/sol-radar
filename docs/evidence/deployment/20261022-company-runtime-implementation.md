---
title: "회사 runtime 후속 구현·검증과 운영 접속 제한"
status: review
tags:
  - sol-radar
  - ops
  - test
updated: 2026-10-22
---

# 구현 결과

사용자가 남은 작업 구현을 지시하고 현재 회사에는 Redis만 실행 중이라고 확인했다. `c9bc496`에서 격리 브랜치 `feat/company-runtime-deployment`로 후속 구현을 준비했다. **코드·이미지 검증은 완료했으며, 회사 기동·Vercel 운영 전환은 아직 실행하지 않았다.**

- Vercel 코드: `web` 하나와 기존 catch-all rewrite를 유지하고 `ai` 서비스/binding을 제거했다(ADR-049). frontend는 모델 서버/AI gateway를 직접 호출하지 않는다.
- 관리자 상태: 정확한 `GET /api/v1/admin/ai/status`만 기존 HTTPS 전송에 추가했다. frontend ADMIN 검사, 서비스 token+업무 JWT, 회사 측 ADMIN 재검증, 기존 DTO와401/403/422, 크기·마감 제한을 유지한다. GET에 body·멱등키·cookie를 전달하지 않는다.
- readiness: `CONFIG_INVALID / UPSTREAM_HTTP / TIMEOUT / NETWORK / INVALID_RESPONSE / INCONSISTENT_RESPONSE`·HTTP 상태·소요시간·요청ID만 서버에 기록한다. URL·토큰·응답 원문·원시 exception을 기록하지 않으며 공개503/200-degraded 계약은 같다.
- 회사 Compose: 기존 Redis external network를 재사용하는 redis-api·AI gateway·Worker. Redis/Qdrant/Nginx/DB/모델 컨테이너를 추가하지 않는다. API만loopback6380으로 게시하고 AI/Worker는 내부 네트워크를 사용한다. Worker는 AI gateway health 이후 시작한다.
- 자격: 서비스별 env 파일을 분리했다. API는 anon/JWT, Worker만 Storage service role·수집 키, AI gateway만 모델 자격을 받는다. 모드와 내부 AI 주소는 Compose가 통일한다.
- 운영 준비: [실행서](../../../infra/company/README.md), [읽기 전용 회사 inventory](../../../scripts/ops/company-inventory.sh), env 예시4개를 준비했다. 기존 Redis/Nginx/모델 프로세스는 변경하지 않는다. 학습본이 준비되지 않았으므로 현재 mock을 유지한다.

## 검증

| 검사 | 결과 |
| --- | --- |
| 기능 RED → GREEN | 관리자 회사 GET·인증·안전한 readiness 진단의 기존 미구현3건 실패 확인 후 통과 |
| 삭제/추가한 topology 계약 | 회사3서비스·외부 Redis·loopback 게시·Vercel web-only 실패 확인 후3개 통과 |
| 변경 범위 | `pnpm verify:changed` 종료0 |
| 최종 통합 | `pnpm verify` 종료0. 루트186·웹420·AI101·decision57 = **764개**, 타입·린트·계층·생성물·Next 빌드 포함 |
| Docker | API·AI gateway·Worker 실제 이미지 빌드 모두 성공. API는 리뷰 수정 후 재빌드 |
| 격리 로컬 컨테이너 | API 미인증401·화면 경로404, AI health `mock`, Worker `--check` 모듈 import 성공 |
| Vercel dry-run | Services의 web 하나, binding 없음, 비밀/작업 기록 업로드 파일0개. 클라우드 배포 아님 |
| 읽기 전용 운영 재확인 | 회사 `/redis/health` 502, `bim@acropolissg.com:22` 연결 거절 |

로컬 컨테이너 검사에는 운영 DB·모델 자격을 사용하지 않았고 생성한 검사 컨테이너만 정리했다. Worker `--check`는 모듈 import 확인이며 큐 소비·DB 연결·회사 readiness 성공을 의미하지 않는다. 전체 인증 E2E나 운영 분석 요청은 실행하지 않았다.

## 독립 리뷰와 수정

전체 diff를 한 번 독립 리뷰했다. Critical/Important 지적은 없었다. Minor2건을 반영했다.

1. ADMIN GET 오류의 본문 `error.requestId`와 `X-Request-Id`가 달랐다. 422 재현 시험에서 실패를 확인하고 upstream 요청ID를 헤더에도 보존했다. 수정 후 집중43개가 통과했다.
2. `docs/CLAUDE.md`의 과거 Vercel web+ai 사용 지시를 ADR-049의 web 단독 기준과 구분했다.

code 검토는 인증/DTO/시간·크기 제한/비밀 배제, infra 검토는 역할별 자격/기존 자원 보존/게시 포트/기동 순서를 확인했다. 로컬 준비는 통과이며 회사 운영 GO 판정은 실제 inventory와 readiness 확인 전까지 내리지 않는다.

## 실제 회사 적용에 남은 정보

회사 명령을 실행할 SSH host·port·계정 또는 내부 터미널 경로가 필요하다. 추가 승인 요청이 아니다. 현재 알려진 외부22번 포트는 연결을 거절한다. 기존 Redis의 실제 network·인증·6380 점유와 Worker 대기 job도 내부에서 읽어야 한다. 포트502만으로 Nginx의 정확한 upstream 오류를 확정하지 않았다.

접속이 확보되면 [실행서](../../../infra/company/README.md)의 inventory → 서비스별 env → config/build → 신규 앱 기동 → token health/Worker scope·TTL → 접수202/조회 검증 순서로 진행한다. 회사 준비 후 같은 소스의 Vercel web-only를 전환한다. 기존 Vercel sensitive 모델 키는 회사 쪽 자격 보존 확인 전 삭제하지 않았다.

Bosun 학습본 identity, 실제 모델 추론, documents 소비자·첨부 파서는 후속 검증/기능 범위다. 이번 mock 이미지/health를 실모델 또는 전체 첨부 분석 완료로 보고하지 않는다.

## 관련 문서

- [[10-DEPLOYMENT]]
- [[16-DECISIONS|ADR-049]]
- [[PROGRESS]]
- [구조화 검증 결과](20261022-company-runtime-results.json)
