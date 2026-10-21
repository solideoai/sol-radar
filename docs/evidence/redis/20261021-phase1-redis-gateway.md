---
title: "Redis HTTPS Gateway Phase 1 — 로컬 구현·검증"
status: verified
updated: 2026-10-21
---

# Redis HTTPS Gateway Phase 1

사용자의 Phase 1 로컬 구현·테스트 승인 범위다. 기존 [계획](../../plans/2026-10-21-redis-gateway-supabase-storage-migration.md)의 Task 2를 수행하며 원래 Task 번호와 Storage·신규 문서 파이프라인 범위를 유지한다. 로컬 검증을 완료했으며 운영 배포는 별도 승인 대상이다.

## 구현 결과

별도 Gateway 서버를 만들지 않고 기존 Next.js Route Handler를 재사용했다. `SOL_DEPLOYMENT_ROLE`은 `frontend`·`redis-api`·`standalone`이며 운영은 역할을 명시한다. Vercel은 frontend만 허용한다. frontend는 분석·수집 POST만 HTTPS로 전달하고 Redis TCP·service role을 금지한다. 작업 조회·WHAT-IF는 기존 Supabase/RLS 경로다.

회사 역할은 서비스 token과 사용자 Bearer를 각각 검사한 뒤 현재 계정 상태·가입 완료·조직·RBAC/RLS를 다시 검증한다. Proxy와 업무 handler 양쪽에 가드를 적용한다. 임의 Redis 명령 API는 없다. 서버 환경 변수만 사용하며 Cookie/refresh token/위조 org·role header를 전달하지 않는다.

접수는 최초 인증부터 기본15초(`REDIS_API_TIMEOUT_MS`, 최대15000ms), 요청16KiB·응답1MiB 상한이다. 자동 재시도는 네트워크 오류(헤더 수신 후 stream 오류 포함)·502/503/504에 최대1회이며 같은 멱등 키와 원문 bytes를 쓴다. 4xx는 재시도하지 않으며429 Retry-After를 유지한다. redirect·HTML·잘못된 DTO·시간 초과는 안전한503으로 응답한다. 인증이 늦게 끝나도 제한 시간이 지난 작업을 제출하지 않는다.

서비스 health는 기존 DB·Redis·MinIO·AI probe를 사용한다. AI만2초 probe 시간 초과이면200/degraded를 유지하도록 원격 health에는 전송 여유를 둔5초 상한을 적용했다. Storage 전환 완료로 표시하지 않는다.

## API 명세

외부 base는 `https://acropolissg.com/redis`다. 기존 Nginx가 `/redis/`를 제거하므로 회사 Next.js의 upstream 경로에는 prefix가 없다. ID는 UUID다.

| 외부 경로 | 메서드 | 인증·권한 | 정상 응답 |
| --- | --- | --- | --- |
| `/redis/health` | GET | `X-Sol-Service-Token` | 기존 Readiness200, 핵심 의존성 장애503 |
| `/redis/api/v1/bids/{id}/analyses` | POST | 서비스 token + 사용자 Bearer, 기존 업무 역할 | 202 `analysisId/status/deduplicated/pollUrl` |
| `/redis/api/v1/analyses/{id}` | GET | 동일, 조직/RLS | 기존 분석 상태·결과 |
| `/redis/api/v1/admin/ingestion/runs` | POST | 동일 + 업무 ADMIN | 기존202 IngestionRun |
| `/redis/api/v1/admin/ingestion/runs/{id}` | GET | 동일 + 업무 ADMIN | 기존 IngestionRun, Worker DB행 생성 전404 가능 |

오류는 기존 `{error:{code,message,details,requestId}}`, `Cache-Control:no-store`, `X-Request-Id`다. 서비스 token/JWT 실패401, 권한403, 타 조직404, 입력400, 멱등 충돌409, 속도 제한429, 전송/의존성503을 유지한다. `pollUrl`은 공개 Vercel `/api/v1/analyses/{id}`이며 회사 주소를 노출하지 않는다.

비허용 화면·구형 API·정적 파일·Server Action은 차단한다. 기존 Next 설정의 `/account`·favicon 별칭과 slash 정규화는 Proxy 이전308일 수 있다. 실제 목적지에도 allowlist·인증이 적용된다. HTTP client는 redirect를 따라가지 않는다.

## 수정 파일

| 영역 | 파일 |
| --- | --- |
| 역할·인증·전송 | `web/app/_lib/deployment-role.ts`, `redis-api-auth.ts`, `redis-api-path.ts`, `redis-api-client.ts`, `redis-api-contract.ts`, `redis-api-deadline.ts`, `redis-api-response.ts`, `application-health.ts` |
| 기존 API 재사용 | `web/app/api/v1/_lib/work-route.ts`, `bids/[id]/analyses/route.ts`, `admin/ingestion/runs/route.ts`, `web/app/_lib/work-deps.ts` |
| 상태·입구 | `web/app/health/route.ts`, `web/app/health/ready/route.ts`, `web/proxy.ts`, `web/instrumentation.ts`, `web/next.config.ts` |
| 사용자 토큰 | `web/server/auth/auth.service.ts`, `web/server/auth/index.ts`, `web/server/supabase/client.ts` |
| 배포 준비·env | `web/Dockerfile`, `web/Dockerfile.dockerignore`, `infra/compose.company.yaml`, `infra/env/redis-api.env.example`, `web/.env.example`, `scripts/check-env.mjs` |
| 테스트 | `web/app/_lib/{deployment-role,redis-api-client}.test.ts`, `web/app/api/v1/redis-gateway-contract.test.ts`, `web/proxy.test.ts`, `web/server/supabase/client.test.ts`, `scripts/check-env.test.mjs`, `scripts/redis-gateway.test.mjs`, `scripts/redis-gateway-local-smoke.mjs` |
| 정본·진행 | `docs/05-API-SPEC.md`, `10-DEPLOYMENT.md`, `11-TESTING.md`, `16-DECISIONS.md` ADR-045, `CLAUDE.md`, `PROGRESS.md`, 기존 계획서, `polaris/specs/done/2026-10-21-redis-http-gateway.md` |

기존 변경은 별도 baseline73개 파일의 hash로 구분했다. 의도한 문서/예시8개 외65개 파일은 hash가 같고 누락·예상 밖 변경은0개다. 기존 staff200·Vercel Python 작업을 되돌리거나 새 작업에 함께 커밋하지 않았다. 검증 당시 브랜치는 `feat/redis-http-gateway`였고 미커밋 상태였다. 이후 사용자 정리 지시에 따라200명 커밋을 부모로 분리하고 Bosun 문서/Redis·Vercel 커밋을 각각 만들도록 변경했다. 최종 커밋은 브랜치 이력을 따른다. 전체 작업 파일 목록은 [파일 목록](20261021-phase1-files.json)으로 보존한다.

## 테스트 결과

- 최초 계약 시험과 리뷰 회귀 시험에서 RED를 확인한 뒤 구현했다. 리뷰3건은3 failed/31 passed →34/34 passed, 잘못된 JWT 인코딩은3 failed/52 passed →55/55 passed다.
- 웹 전체 `pnpm -C web verify`: exit0,222파일·6,900테스트, 서식·타입·린트·계층·토큰·색·Next 빌드 통과. [웹 검증 로그](20261021-phase1-web-verify.txt)
- 루트 `pnpm verify`: 최종 exit0. 공통774·웹6,900·AI1,517·decision152테스트와 빌드가 통과했다. 최초 실행은 웹 layout의 eager auth import 때문에 실패했고 access token 조회를 실제 relay 시점으로 늦춰 수정했다. [최종 전체 로그](20261021-phase1-verify.txt)
- 실제 로컬 Redis7.2.5와 Next standalone smoke: exit0. 분석40회 동시 요청 중30 허용, 수집10회 중5 허용, 동시20개 멱등 선점 중1개·24시간 TTL, quota20 증가/EXHAUSTED, BullMQ 실제 왕복을 확인했다. 회사 Redis7.4를 실행/변경한 시험은 아니다. [smoke 로그](20261021-phase1-smoke.txt)
- 실제 Next에서 token 없는 health401·정상 token200, 비허용10경로404, 별칭/정규화308 목적지 재검증, 허용 POST의 Next-Action+잘못된 JWT401을 확인했다. frontend 인증 직후 정지된 계정은 실제 backend handler 재검증에서403으로 거절하고 큐 의존성을 만들지 않았다.
- 별도 검증 담당자가 최종 Gateway/auth/기존 bids·ingestion 계약7파일·222테스트를 실행해 exit0·실패0을 확인했다. 추가 코드 리뷰를 반복하지 않았다.
- `git diff --check`: 통과. 최종 변경 파일·문서 참조도 확인했다.

## 리뷰와 판단

독립 검토1회에서 Critical0·Important3·Minor2를 받았다. Important는 AI probe와 전송 deadline 충돌, 헤더 이후 응답 유실 재시도 누락, 최초 인증이 전체 deadline 밖인 문제였다. 각각 실패 시험으로 재현하고 수정했다. Compose interpolation에 `--env-file`이 필요함을 문서화했고 Next 선행308 예외는 실제 smoke로 확인해 API/운영 문서에 기록했다. 재리뷰를 반복하지 않고 수정 후 전체 시험을 수행한다.

실제 Next 시험에서 SDK의 잘못된 UTF-8/JSON JWT 예외가500이 되는 기존 빈틈도 확인했다. 토큰 인코딩을 먼저 검사해401로 거절하며 서명·만료 검증은 기존 Supabase SDK가 계속 담당한다. 네트워크/서버 오류를 인증 실패로 삼키지 않는다. Vercel에서 redis-api 역할을 잘못 선택하면 시작 검증으로 거절한다.

구현 중 판단과 비용:

1. 진행 중인 dirty checkout을 새 로컬 브랜치에서 유지했다. 사용자가 기존 작업 연속성을 요구했고 승인된 미커밋 소스가 선행 조건이다. 비용은 baseline으로 변경 소유권을 구분해야 한다는 점이다.
2. Phase 1 검증 당시 이전 변경을 포함한 커밋·merge를 만들지 않고 로컬 diff를 남겼다. 이후 사용자 요청으로200명 부모 커밋 위에 별도 커밋으로 정리한다. 병합·push는3e 사용자 승인 작업으로 남긴다. 비용은 단계별 검증 기록과 최종 커밋 범위를 구분해야 한다는 점이다.
3. 리뷰에서 제외한 durable dispatch·다중 Worker quota 예약은 기존 한계를 명시하고 다음 단계로 유지한다. 비용은 DB/큐 crash 구간·동시 예산 예약 정확성 보강이 아직 남는다는 점이다.
4. Storage/파서/downloader·source-version 작업은 다음 단계다. 비용은 실제 문서 저장·분석 E2E를 이번 Gateway 검증으로 보증할 수 없다는 점이다.
5. 상세 ADMIN AI 상태와 Vercel ai binding은 기존 ADR-044 구성을 유지했다. 비용은 요약 health와 상세 AI 화면이 서로 다른 gateway를 볼 수 있어 후속 정리가 필요하다는 점이다.
6. 회사 Redis/Nginx/network·Docker 이미지 실행·실제 Supabase/RLS와 GPU E2E는 로컬 승인 범위 밖이다. 비용은 배포 후 실제 인증·업무 왕복 검증이 남는다는 점이다.
7. 선행 staff200·Vercel Python 변경은 이번 작업 범위에서 제외했다. 비용은 이 변경들의 독립 검증 기록을 별도로 읽어야 한다는 점이다.

## 배포 상태와 남은 작업

운영 서버·Nginx·Docker 컨테이너·운영 DB·Supabase 데이터·Vercel production은 변경하지 않았다. 회사 Redis는 기존127.0.0.1:6379 유지다. Compose는 Gateway host publish를127.0.0.1:6380으로만 정의하고 새 Redis·볼륨·network를 생성하지 않는다. Docker 내부 listener0.0.0.0:3000은 host loopback publish와 구분한다. 준비 파일을 실행하거나 이미지를 빌드하지 않았다.

회사 external Redis network 이름·인증/ACL·AOF/noeviction·기존 큐 상태·Worker 호스트 관계를 확인하고 운영 승인을 받아 회사 API를 배포해야 실제 Nginx502를 해결할 수 있다. 이때 같은 소스 버전의 Vercel frontend 설정과 실제 인증/202/DB polling을 검증한다. Nginx 설정 수정/reload는 하지 않는다. `env_file`과 Compose 변수 보간은 별도이므로 운영 명령에 `--env-file infra/.env.redis-api.local`을 명시한다([운영 절차](../../10-DEPLOYMENT.md)).

다음 승인 대상은 SOL RADAR MinIO 리소스·데이터 inventory 및 Supabase Storage 전환의 로컬 구현/검증이다. 실제 사용 데이터가 있으면 보존한다. bucket/RLS·메타데이터 migration·운영 적용은 별도 승인 경계를 따른다. 문서 다운로드·PDF/HWP/HWPX 파싱·documents 소비자 신규 구현, durable dispatch·quota 예약 보강은 별도 후속 작업이며 현재 구현 완료로 분류하지 않는다.
