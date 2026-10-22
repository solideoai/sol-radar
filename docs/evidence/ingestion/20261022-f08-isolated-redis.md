---
title: "F08 실제 격리 Redis 검증"
status: verified-local
tags:
  - sol-radar
  - ingestion
  - redis
updated: 2026-10-22
---

# F08 실제 격리 Redis 검증

기능 브랜치 `fix/ingestion-quota-reservation`에서만 작업했다. F08 일일 호출 예산 검증과 그 과정에서 재현된 장애 처리 수정, 문서 갱신이 범위다. 커밋·push는 하지 않았다. 회사 Redis6379·loopback6380·Nginx `/redis/`·redis-api·운영 Worker·Supabase·외부 공공 API에는 접속하지 않았다(ADR-045). Registry 비활성 상태와 환경 파일·migration·AI 서비스는 변경하지 않았다.

## 1. 최신 main 반영과 기존 변경 보존

실행한 순서:

```bash
git status --short --untracked-files=all
git branch --show-current
git fetch origin
git rev-parse origin/main
# 02fc7c930ebe3cd06eedc986bb9dbac08bc5904f
git stash push --include-untracked -m 'temporary F08 preservation before origin-main fast-forward'
git merge --ff-only origin/main
# Updating 20cb79f..02fc7c9 / Fast-forward
git stash apply --index 'stash@{0}'
```

병합 전 변경15개를 저장소 밖 임시 디렉터리에 별도 복사하고 SHA256 manifest를 남겼다. stash 복원에서 `docs/PROGRESS.md`만 충돌했다. main의 통합·회사 runtime 기록과 F08 기록을 모두 남겨 해결했다. 나머지14개는 원본과 byte가 같음을 확인했다. 이 worktree의 원래 인덱스가 비어 있었으므로 복원 중 생긴 staged/unmerged 상태는 `git restore --staged .`로 해소하고 변경 파일은 모두 unstaged로 보존했다. 보존 stash와 외부 사본은 삭제하지 않았다. main worktree에는 쓰지 않았으며 기능 브랜치 HEAD만 기존 원격 commit02fc7c9로 이동했다. 새 commit을 만들지 않았다.

병합 직후 아래 명령은 3파일/24테스트 통과했다. 이후 발견한 보조 조회 장애 회귀를 추가한 최종 집중 검사는 3파일/25테스트 통과했다.

```bash
pnpm -C web exec vitest run server/ingestion/quota-ingestion.test.ts worker/quota-store.test.ts worker/external-ingest.test.ts
```

## 2. 재현 가능한 격리 검증 명령

```bash
docker pull redis:7.4-alpine
pnpm -C web exec node --conditions=react-server --import tsx ../scripts/verify-quota-redis.mjs
```

[검증 스크립트](../../../scripts/verify-quota-redis.mjs)는 실행할 때마다 UUID로 명명한 일회용 Redis 컨테이너1개와 전용 bridge network를 만들고 finally에서 둘을 삭제한다. 운영 접속 URL을 인자로 받지 않고 `.env`도 읽지 않는다. Docker는 로컬 Unix socket만 허용하고 `DOCKER_HOST` override는 거절한다. Redis는 컨테이너 내부16379, 호스트는 Docker가 할당한 `127.0.0.1` 임시 포트다. 포트6379/6380을 거절한다. 전용 네트워크는 IP masquerading을 끄고 기존 네트워크에 연결하지 않는다. root filesystem read-only·사용자redis·capability 전체 제거·tmpfs `/data`·영속화 off이며 기존 volume을 연결하지 않는다.

실행 환경은 Docker Desktop27.4.0, Redis7.4.11이다. 이미지 digest는 `redis@sha256:892022f9f18c26c92c30e15194d132f90044af87b94a491a75429bbc3982eab1`이다. tag의 향후 변경은 각 실행 로그의 실제 digest로 식별한다. 현재 실행은 회사 Redis 버전/ACL에 대한 검증을 대체하지 않는다.

최종 실행의 실제 명령·출력은 [전체 로그](20261022-f08-isolated-redis.txt)에 있다. 모든 공공 API transport는 주입한 응답 함수다. `globalThis.fetch`도 실패하도록 막았다. 실제 Redis를 사용한 부분은 저장소·ACL·연결/응답 장애이며 HTTP·저장 DB는 mock/메모리다. 전체 Worker 프로세스와 스케줄러는 시작하지 않고 실제 `processIngestJob()`을 직접 호출했다.

초기 하네스 준비 단계에서 root entrypoint의 chown과 capability 제거가 충돌했고, Docker `--internal` network에서는 게시 포트가 없어 검증 전 중단됐다. non-root 사용자와 전용 bridge/masquerading off로 수정했다. 수동 job의 요청자 UUID 누락도 하네스 입력에서 수정했다. 준비 실패를 제품 실패로 계산하지 않았고 해당 일회용 리소스는 정리했다.

## 3. 검증 결과

| 항목 | 실제 검증 방법과 결과 |
| --- | --- |
| 예약 Lua | 제품 `createRedisQuotaStore().reserve()`의 실제 EVAL 실행, 카운터1 확인 |
| 소진 Lua | 실제 markExhausted로10까지 올리고 추가 예약 거절. 이미12인 값은 낮추지 않음 |
| TTL2일 | 예약·소진 후 실제 Redis TTL이172799~172800초인지 확인 |
| 물리적 만료 | 이 일회용 인스턴스의 시험 키만 PEXPIRE50ms로 단축해 실제 삭제 확인. 재예약 시1과 TTL2일 복원 확인 |
| KST 경계 | 주입 clock의23:59:59→00:00:00 KST 사이에503 retry. `quota:midnight:20261022=1`, `quota:midnight:20261023=1`, HTTP 합계2 |
| 마지막 슬롯 | 독립 Redis 연결16개 ×20회. 매회9/10에서 시작해 승인1·최종10, 초과0건 |
| 동시 수동/일정 | Redis 연결이 다른 live job handler16개. HTTP1, 성공1·실패15를 직접 assert |
| 마지막 슬롯503 retry | 첫 HTTP503 후 두 번째 HTTP는 예약 거절. HTTP1·FAILED |
| 예약 전 연결 끊김 | EVAL을 Redis에 전달하기 직전 proxy가 연결을 끊음. HTTP0·FAILED·QUOTA_STORE_UNAVAILABLE, 카운터0 |
| 예약 응답 유실 | Redis가 EVAL을 실행한 뒤 반환한 응답을 proxy가 버리고 연결을 끊음. HTTP0·FAILED·QUOTA_STORE_UNAVAILABLE, 카운터1은 환불/재실행하지 않음 |
| timeout | EVAL을 전달하지 않고 TCP 연결은 유지. 제품 commandTimeout2000ms 후 HTTP0·FAILED·QUOTA_STORE_UNAVAILABLE, 카운터0 |
| 목록 이후 연결 끊김 | 목록 HTTP1 성공 직후 해당 실제 Redis client disconnect. 보조 HTTP0·FAILED·QUOTA_STORE_UNAVAILABLE |
| EVAL/EVALSHA ACL 거부 | 시험 사용자에게 두 권한 없음. 직접 호출은 NOPERM. G2B/LH ×수동/일정4경로 모두 HTTP0·FAILED·QUOTA_STORE_UNAVAILABLE |
| 최소 quota ACL 성공 | GET/EVAL/INCR/EXPIRE/SET 및 연결 초기화 권한으로 예약·소진·조회 성공. EVALSHA는 거부 상태여도 제품 store 정상 |

장애 시험의 proxy는 첫 EVAL에만 장애를 주고 이후 재연결/명령은 허용한다. 따라서 서버가 계속 죽어 있어서 우연히 실패하는 시험이 아니라 자동 재전송을 검출한다. 실제 Redis server clock/호스트 시간은 변경하지 않았다. TTL2일을 실제로 이틀 기다린 것은 아니며 설정값과 단축한 물리적 만료를 나누어 검증했다. 경합은 단일 Node 프로세스에서 생성한 독립 Redis 클라이언트이며 다중 호스트/전체 Worker 운영 E2E는 아니다.

## 4. 검증 중 발견한 결함과 수정

### IORedis의 미응답 EVAL 자동 재전송

초기 옵션은 enableOfflineQueue=false여도 IORedis 기본 autoResendUnfulfilledCommands=true가 남아 있었다. 연결 복구 뒤 미응답 EVAL이 재전송돼 연결 끊김은 HTTP1/성공, 응답 유실은 카운터2/HTTP1/성공이었다. maxRetriesPerRequest=1은 재연결 직후 자동 재전송을 금지하는 옵션이 아니었다.

[실패 출력](20261022-f08-isolated-redis-red.txt):

```text
FAULT disconnect: {"status":"SUCCEEDED","http":1,"errors":[]} used=1
FAULT response-loss: {"status":"SUCCEEDED","http":1,"errors":[]} used=2
AssertionError: Redis faults must fail closed without replaying EVAL
```

`web/worker/quota-store.ts`의 **quota 전용 연결 옵션**에 `autoResendUnfulfilledCommands: false`만 추가했다. 기존 offline queue 금지·재연결 제한·2000ms timeout은 유지한다. BullMQ 본 연결의 재연결 정책은 바꾸지 않았다. 제품 옵션을 그대로 쓰는 같은 실제 Redis 시험에서 재실행되지 않고 약2000ms 후 FAILED/HTTP0임을 확인했다.

### 보조 조회 전 저장소 조회 실패가 성공으로 기록됨

독립 코드 검토에서 `withAux()`가 저장소 unavailable을 정상적인90% 보조 조회 생략과 합쳐 처리하는 경로를 찾았다. 목록이 마지막 페이지면 run이 성공했다. 회귀 단위 테스트와 [실제 연결 끊김 RED 출력](20261022-f08-aux-read-red.txt) 모두 `SUCCEEDED`를 재현했다. `ingestion.service.ts`에서 그 경우 `halted: QUOTA_UNAVAILABLE`을 전달하도록 최소 수정했다. 원래90% 생략·다시 채우기와 이미 받은 목록 저장은 유지하며 run은 FAILED로 닫는다. 목록은 이미1회 송신했으므로 이 시험의 기대값은 **추가 보조 HTTP0**이다. 신규 테스트는 오류 원문 비노출도 확인한다.

## 5. 회사 Redis 계정에서 운영자가 확인할 권한

회사 ACL에는 접속하지 않았다. 아래는 F08 **quota 연결** 권한이며 기존 BullMQ/다른 기능의 계정 권한 전체를 대체하는 ACL은 아니다.

| 구분 | 명령 / 키 범위 |
| --- | --- |
| 제품 quota 필수 | `GET`, `EVAL`, `INCR`, `EXPIRE`, `SET`; `~quota:*` |
| 현재 불필요 | `EVALSHA`·SCRIPT LOAD. 현재 제품은 직접 EVAL을 호출하므로 EVALSHA 거부만으로 수집이 멈추지 않음 |
| 기존 진단용 합산 사용 시 | `INCRBY`; 제품 수집의 예약 뒤에는 사용하지 않음 |
| 연결/점검 | 이 시험의 IORedis 기본 handshake/점검은 `INFO`, `CLIENT SETINFO`, `PING`; 인증/RESP/선택 DB에 따라 AUTH·HELLO·SELECT 확인 |
| 검증 전용 관리자 | ACL SETUSER·TTL·PEXPIRE·EXISTS·키 초기화 등은 일회용 시험 관리자만 사용. Worker quota 필수 권한에 포함하지 않음 |

시험 계정은 일회용 Redis 안의 nopass 계정이며 비밀정보는 사용/저장하지 않았다. `~quota:*` 범위로 실제 예약·소진 성공을 확인했다. `+@all`을 회사 Worker 계정의 최소 권한으로 제안하지 않는다. Redis 버전과 기존 BullMQ 키/명령 권한, 인증 방식은 운영자가 별도로 확인한다.

**동일한 권한 거부 계정을 사용하는 live 수집은 모두 예약 단계에서 멈춘다.** 직접 검증한 실제 job 경로는 G2B/LH ×수동/일정이며 다른 소스도 같은 예약 경계를 사용한다. 비활성 소스를 활성화하거나 전체 Worker를 기동해 확인한 결과는 아니다. 수집 run이 실패하는 것이며 분석·AI 등 Worker의 다른 기능을 종료시키는 정책은 아니다.

## 6. 문서와 커밋 범위

- `docs/07-DATA-PIPELINE.md`: 사후 합산을 HTTP별 원자 예약으로 변경, 저장소 장애·미응답 재전송 차단·KST·카운터 의미 기록.
- `infra/company/README.md`: 옛 Worker 먼저 정지/드레인 → 모든 옛 프로세스 종료 확인 → 같은 버전 새 Worker 기동. 혼합 운용 위험, quota 키 유지·ACL 정리. 이 운영 절차는 실행하지 않음.
- `docs/PROGRESS.md` 및 기존 F08 구현 보고: 현재 검증 결과로 연결, 병합한 main 기록 보존.
- 기존 F08 제품9개·테스트3개는 유지하며 이번 후속 작업은 `web/worker/quota-store.ts`, `web/server/ingestion/ingestion.service.ts`, `web/server/ingestion/quota-ingestion.test.ts`, 신규 `scripts/verify-quota-redis.mjs` 및 위 문서/증거를 변경했다.
- **`docs/plans/2026-10-22-external-ingestion-completion-plan.md`는 기존 미커밋 별도 작업이다. 내용·위치 그대로 보존하고 이번 커밋 대상에서 제외한다.** 향후 staging은 파일을 명시하며 add-all을 사용하지 않는다. 현재 staged 파일은0개다.

제안 메시지: `fix(ingestion): reserve quota per HTTP attempt` (첫 줄46자). `scripts/commit-message.mjs`의 findProblems()로 사전 검사해 problems=[]를 확인했다. 아직 커밋하지 않았으므로 commit-range 검사 대상은0개다. 사용자 승인 후 실제 커밋을 만들면 다음 명령을 다시 실행하고 대상이1개 이상인지 반드시 확인한다.

```bash
EVENT_NAME=push BASE_SHA=$(git rev-parse origin/main) HEAD_SHA=$(git rev-parse HEAD) node scripts/check-commits.mjs
```

## 7. 최종 변경 범위 검사와 남은 범위

실행 명령과 전체 출력은 [pnpm verify:changed 로그](20261022-f08-verify-changed.txt)에 보존한다. 최종 제품 코드·테스트·스크립트에서 실행해 종료 코드0을 확인했다.

| 검사 | 결과 |
| --- | --- |
| `pnpm verify:changed` | 통과. HEAD02fc7c9 대비23파일(기존 별도 계획1개 포함), 검사3개 선택 |
| 루트 Prettier | 통과 |
| 루트 단위 시험 | 202개 통과, 실패/skip0 |
| 웹 verify:quick | 58파일/490개 테스트 통과, TypeScript·ESLint·Prettier·린트 가드·아키텍처/순환 의존성·토큰·색 검사 통과 |
| 집중 시험 | 3파일/25개 통과. F08 신규 회귀21개(기존20+보조 저장소 조회 장애1) 포함 |
| 실제 Redis 통합 하네스 | 전체 통과, 종료 코드0, 자기 컨테이너/네트워크 제거 |
| 파일별 diff 검토 / `git diff --check` | 통과. 코드9개와 테스트3개, 하네스·문서·증거 검토 |
| 독립 검토 | 보조 조회 전 저장소 장애의 성공 처리1건 발견, 단위·실제 Redis RED→GREEN 후 수정. 동시 handler 실패15개를 명시적으로 assert하도록 검증도 보강 |
| 계획 문서 보존 | 병합 전 SHA256과 동일, untracked·unstaged 유지 |
| 최종 상태 | HEAD=origin/main=02fc7c9, origin/main..HEAD commit0개, staged0개. F08 대상22파일 + 별도 계획1파일 |

최종 커밋 대상22파일은 다음과 같다. 모든 변경은 아직 unstaged이며 아래 표는 staging을 실행한 결과가 아니다.

| 파일 | 목적 |
| --- | --- |
| `web/server/ingestion/quota-store.ts` | 원자 예약 포트/메모리 구현 |
| `web/server/ingestion/connector.model.ts` | HTTP 전 hook/장애 분류 |
| `web/server/ingestion/g2b-http.ts` | 송신 직전 hook |
| `web/server/ingestion/official-api-connector.ts` | 목록 hook 전달 |
| `web/server/ingestion/external-api-connector.ts` | 외부 API 송신 전 hook |
| `web/server/ingestion/g2b-aux.ts` | 보조 조회 매 요청 예약 |
| `web/server/ingestion/ingestion.service.ts` | 공유 예산·집계·보조 조회 장애 실패 처리 |
| `web/worker/quota-store.ts` | Lua 및 미응답 명령 자동 재전송 차단 |
| `web/worker/ingest-queue.ts` | live quota 누락 차단 |
| `web/server/ingestion/quota-ingestion.test.ts` | 예산/장애 회귀13개 |
| `web/worker/quota-store.test.ts` | Redis 포트 계약5개 |
| `web/worker/external-ingest.test.ts` | Worker 모드/누락 quota 회귀 |
| `scripts/verify-quota-redis.mjs` | 일회용 Redis 실제 검증 |
| `docs/07-DATA-PIPELINE.md` | 사전 예약 계약 |
| `infra/company/README.md` | 교체 순서/ACL |
| `docs/PROGRESS.md` | 현재 진행 기록, main 기록 보존 |
| `docs/evidence/ingestion/20261022-f08-quota-reservation.md` | 최초 구현 기록과 후속 링크 |
| `docs/evidence/ingestion/20261022-f08-isolated-redis.md` | 이 보고서 |
| `docs/evidence/ingestion/20261022-f08-isolated-redis.txt` | 실제 Redis 최종 GREEN 원문 출력 |
| `docs/evidence/ingestion/20261022-f08-isolated-redis-red.txt` | 자동 재전송 RED 원문 출력 |
| `docs/evidence/ingestion/20261022-f08-aux-read-red.txt` | 보조 조회 장애 RED 원문 출력 |
| `docs/evidence/ingestion/20261022-f08-verify-changed.txt` | 최종 변경 범위 검사 출력 |

정리 확인 명령은 다음과 같으며 두 명령 모두 출력0행이었다. label은 이 하네스의 일회용 리소스에만 붙인다.

```bash
docker ps -a --filter label=sol.f08 --format '{{.Names}}'
docker network ls --filter label=sol.f08 --format '{{.Name}}'
```

전체 저장소 빌드·회사 운영 ACL·실제 외부 API·다중 호스트 Worker·Redis 데이터 유실/복구·네트워크 분할의 모든 조합은 검증하지 않았다. F07 Retry-After·F13 응답/증거 크기·F14 개인정보 정제는 남아 있다. 배포 때 모든 옛 Worker를 먼저 정지해야 하며 Redis quota를 초기화하지 않는다. 모호한 예약 슬롯은 환불하지 않아 예산을 보수적으로 소모할 수 있다. 이번 검증 결과를 운영 활성화 완료로 표시하지 않는다.
