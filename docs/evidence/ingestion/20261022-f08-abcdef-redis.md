---
title: "F08 실제 Redis A~F 재검증"
status: verified-local
tags:
  - sol-radar
  - ingestion
  - redis
updated: 2026-10-22
---

# F08 실제 Redis A~F 재검증

기준 문서 `docs/plans/2026-10-22-external-ingestion-completion-plan.md`의 F08/P0-B와 [최초 구현 보고](20261022-f08-quota-reservation.md)를 먼저 읽고 실제 quota 저장소·HTTP hook·보조 조회·Worker 연결·기존 시험을 확인했다. 최초 보고의468테스트/실제 Redis 미실행은 과거 상태다. 현재 구현 `ce257525d59865104f5768497df296e9077d6eee`에는 [이전 실제 Redis 검증](20261022-f08-isolated-redis.md)에서 확인한 미응답 EVAL 자동 재전송 차단과 보조 조회 전 저장소 장애 FAILED 처리도 들어 있다.

실제 Redis A~F 재검증 당시 기준은 `fix/f08-quota-reservation@ce25752`였다. 아래 Redis/웹 검사 결과는 그 구현과 현재 하네스 보완에 대한 결과이며 제품 코드는 수정하지 않았다. PR은 fetch한 최신 `origin/main@db4c2be`에서 새 `docs/f08-redis-abcdef` 브랜치를 만들어 준비했다. 기준 계획 문서와 원본 로그3개는 로컬 untracked로 보존하며 PR에는 이 보고서·하네스·진행 로그 한 행만 포함한다. 회사 접속·배포는 수행하지 않았다.

## 1. 환경 및 분리

- Docker Desktop27.4.0, Redis7.4.11 (`redis:7.4-alpine`), 이미지 digest `redis@sha256:892022f9f18c26c92c30e15194d132f90044af87b94a491a75429bbc3982eab1`.
- 하네스가 생성한 UUID 전용 컨테이너1개와 bridge network만 사용했다. 기존 컨테이너/네트워크/volume에는 변경하지 않았다. Docker는 로컬 Unix socket만 허용하며 DOCKER_HOST override는 거절한다.
- 최종 실행은 호스트 `127.0.0.1:63087` → 전용 컨테이너16379. 호스트6379/6380은 거절한다. 이미지의 EXPOSE6379는 게시되지 않았으며 그 포트로 접속하지 않는다.
- read-only root filesystem, non-root redis 사용자, capability 전체 제거, `/data` tmpfs, RDB/AOF 영속화 off. 새 인스턴스의 독립 DB0을 사용하며 회사 인스턴스/DB에 접속하지 않는다. Redis 키의 serviceId는 `single-slot`, `parallel-32`, `verify-g2b-shared-*` 등 시험 전용 값이다.
- 회사 Redis URL/키/계정·환경 파일을 읽지 않는다. Redis 연결은 하네스가 만든 loopback 포트 allowlist로 제한한다. 전용 네트워크는 기존 네트워크와 분리하고 egress masquerading을 끈다.
- 실제 HTTP는 사용하지 않는다. 공공 Connector에는 모의 transport를 주입하고 global fetch 호출 시도도 차단·계수했다(최종0회). 전체 Worker/scheduler는 시작하지 않고 실제 job handler만 직접 호출하며 저장 포트는 메모리다.
- 최종 명령 종료 후 전용 컨테이너와 network를 제거했다. 연결 실패 시험을 위해 정지한 것도 이 전용 컨테이너뿐이다.

## 2. 실행 명령과 실제 Redis 명령

```bash
pnpm -C web exec node --conditions=react-server --import tsx ../scripts/verify-quota-redis.mjs
pnpm verify:changed
pnpm -C web verify:quick
git diff --check
```

제품의 Lua 스크립트를 복제하지 않고 `createRedisQuotaStore()`를 import해 실제 `EVAL`을 보냈다. 아래는 최종 실행 원문 발췌다. 전체 Docker/명령 원문 로그는 로컬에 보존하고 이 PR에는 추가하지 않는다.

```text
ISOLATED redis=127.0.0.1:63087, internal container port=16379
Redis 7.4.11
PASS A dailyLimit=1: reserve=true,false final counter=1
PASS accelerated physical expiration: absent -> reserve=1, TTL reset to 2 days
PASS KST 23:59:59 -> 00:00:00: quota:midnight:20261022=1 quota:midnight:20261023=1, HTTP=2
PASS B 32 simultaneous independent clients: successes=10 denied=22 counter=10 overshoots=0
PASS 503 retry with final slot: HTTP=1 FAILED, second HTTP blocked
PASS F shared G2B list/3 auxiliaries/retry: limit=4 HTTP=4 quota_used=4 counter=4; other-service HTTP=1 counter=1 unaffected
PASS F shared G2B list/3 auxiliaries/retry: limit=5 HTTP=5 quota_used=5 counter=5; other-service HTTP=1 counter=1 unaffected
FAULT timeout: {"status":"FAILED","http":0,"quotaUsed":0,"errors":["QUOTA_STORE_UNAVAILABLE","QUOTA_STORE_UNAVAILABLE"]} used=0 elapsed=2006ms
PASS E actual Lua command failure (EVAL allowed, INCR denied): {"status":"FAILED","http":0,"quotaUsed":0,"errors":["QUOTA_STORE_UNAVAILABLE","QUOTA_STORE_UNAVAILABLE"]}
PASS actual Redis INFO commandstats: EVAL calls=733; INCRBY calls=0
PASS E actual Redis connection failure (ECONNREFUSED): {"status":"FAILED","http":0,"quotaUsed":0,"errors":["QUOTA_STORE_UNAVAILABLE"]}
PASS isolation: actual external HTTP attempts=0; Redis targets restricted to owned loopback ports
CLEANUP: disposable Redis container and its dedicated network removed
```

명령 범위는 예약의 `EVAL → GET/INCR/EXPIRE`, 소진의 `EVAL → GET/SET EX 또는 EXPIRE`, 시험 관리의 `GET`, `SET`, `TTL`, `PEXPIRE`, `EXISTS`, `INFO server/commandstats`, `ACL SETUSER`, EVAL/EVALSHA 권한 거부 probe다. 관리자 권한·키 초기화·ACL 생성은 이 새 Redis에서만 사용했다. 시험 계정은 이 일회용 인스턴스 안의 nopass 계정이며 운영 비밀값을 사용하지 않았다.

## 3. A~F 결과

| 요구 | 실제 실행과 결과 | 판정 |
| --- | --- | --- |
| A 예약 | limit1, 첫 reserve=true·두 번째=false·최종 카운터1 | 통과 |
| B 동시성 | 독립 Redis 클라이언트32개가 동시에 빈 예산10에 예약: 성공10·거절22·최종10·초과0 | 통과 |
| B 마지막 슬롯 |32개 클라이언트 ×20회, 9/10에서 매회 승인1·최종10·초과0. 수동/자동 handler32개에서도 HTTP1·성공1·실패31 | 통과 |
| C 재시도 | 잔여1회, 첫 모의 HTTP503 후 다음 reserve 거절. HTTP1·카운터1·run quota_used1·FAILED | 통과 |
| D KST | 2026-10-22 23:59:59→2026-10-23 00:00:00 KST를 주입 clock으로 전환. 날짜 키 각각1회·각 키 TTL>0, 이전 날짜 카운터 유지 | 통과 |
| D TTL/만료 | 예약·소진 후 실제 TTL172800초(허용172799~172800), 시험 키만 PEXPIRE50ms로 단축해 물리 삭제 후 카운터1/TTL2일 복원 | 통과 |
| E 연결 실패 | 전용 Redis를 실제 stop하고 stopped 상태 확인. 이후 Redis 연결 실패(최종 실행 ECONNREFUSED)에서 HTTP0·FAILED·QUOTA_STORE_UNAVAILABLE | 통과 |
| E EVAL 실패 | EVAL/EVALSHA 권한 거부4개 live 경로와, EVAL/GET은 허용하되 Lua의 INCR만 거부하는 실제 실행 오류를 시험. 모두 HTTP0·FAILED·QUOTA_STORE_UNAVAILABLE | 통과 |
| E timeout/응답 유실 | 실제 TCP proxy로 응답을 막거나 버리고 연결을 끊음. 약2000ms 후 HTTP0·FAILED. 응답 유실 시 Redis 카운터1만 남고 자동 재전송하지 않음 | 통과 |
| F 공유 예산 | G2B 목록1+면허503/재시도2+지역1+첨부1에 같은 synthetic serviceId 사용. limit4는 HTTP4 뒤 첨부 차단/FAILED, limit5는 HTTP5/SUCCEEDED. Redis 카운터와 quota_used는 각각4/5로 일치 | 통과 |
| F 다른 서비스 | G2B 예산이 소진돼도 별도 serviceId는0→1 예약과 HTTP1 성공. G2B 카운터 불변 | 통과 |
| 이중 계수 | 실제 Redis INFO commandstats EVAL733회·INCRBY0회. 공유/재시도 HTTP 수와 Redis·run 카운터 일치 | 통과 |

성공한 예약에서만 HTTP 송신 경계가 통과하는 것을 실제 Connector/job handler로 확인했다. 모의 HTTP 수는 실제 공공 API 전송 수가 아니다. 모든 공공 API 전송은0회다. 실패한 추가 예약 후 HTTP도0회다. 목록 성공 후 보조 조회 직전에 저장소가 끊기는 기존 회귀도 목록 HTTP1/추가 보조 HTTP0·FAILED로 다시 통과했다.

## 4. 발견 사항과 수정 파일

새 제품 결함은 발견하지 않았다. 과거 발견한 재전송/보조 조회 실패 처리 결함은 이번에도 수정 상태로 통과했으며 새로 수정했다고 계산하지 않는다.

초기 추가 하네스는 `connect()` rejection의 errno를 직접 검사해 실패했다. IORedis6은 이 Promise에 일반 `Connection is closed` 오류를 반환할 수 있고, Docker Desktop의 중간 포트도 TCP를 수락한 뒤 Redis에 연결하지 못해 닫힐 수 있다. 설치된 IORedis의 close handler를 확인하고 실제 error/close/ready 이벤트와 컨테이너 stopped 상태를 검사하도록 수정했다. 최종 실행에서는 실제 ECONNREFUSED도 관측했다. 제품 장애가 아닌 시험의 플랫폼 가정 오류였으며 초기 실행을 전체 성공으로 보고하지 않았다.

PR 변경 파일은 `scripts/verify-quota-redis.mjs`, `docs/PROGRESS.md`의 작업 로그 한 행, 이 보고서3개다. Redis/검사 출력3개는 로컬에서만 보존한다. 기준 계획 문서는 byte 변경 없이 untracked 상태로 보존한다. 제품 API/QuotaStore 계약·Lua/TTL·Registry·환경 파일·migration·운영 서비스는 변경하지 않았다.

## 5. 전체 테스트 및 정적 검사

검증 당시 루트 변경 범위 검사와 웹 전체 quick 검사 원문은 로컬 로그로 보존했다. 두 명령 모두 종료 코드0이며 주요 출력은 다음과 같다. PR 브랜치의 `pnpm verify:changed --base origin/main`과 커밋 범위 검사는 별도로 실행하고 PR 본문에 결과를 기록한다.

```text
루트: tests 202 / pass 202 / fail 0 / skipped 0
웹: Test Files 58 passed (58) / Tests 490 passed (490)
TypeScript·ESLint·Prettier·lint guards·architecture·tokens·colors: 통과
```

| 검증 | 결과 |
| --- | --- |
| 실제 Redis A~F 하네스 | 전체 통과, 종료 코드0, 전용 컨테이너/network 제거 |
| `pnpm verify:changed` | 이번 코드 변경은 시험 스크립트뿐이므로 루트 서식과 루트202개 테스트 선택, 모두 통과 |
| `pnpm -C web verify:quick` | 웹58파일/490개 테스트, TypeScript·ESLint·Prettier·린트 가드·아키텍처/순환 의존성·토큰/색 검사 전부 통과 |
| 로그 점검 | 시험 credential marker와 인증 query를 가진 공공 API URL 출력0건 |
| `git diff --check` | 통과 |
| 기존 작업 보존 | 기존 계획 문서의 병합 전 SHA256과 동일, 여전히 untracked. 검증 시점 HEADce25752·staged0 유지 |

재실행한 단위 테스트는 루트202+웹490=692개다. 실제 Redis 하네스의 시나리오는 이 숫자에 더하지 않는다. 전체 저장소 `pnpm verify`를 실행했다고 표시하지 않는다.

## 6. 운영 반영 및 남은 미검증

- 회사 Redis ACL/버전·운영 Worker 배포는 여전히 미확인이다. quota 최소 명령 `GET EVAL INCR EXPIRE SET`, 키 `~quota:*`, IORedis 인증/초기화 및 기존 BullMQ 권한은 운영자가 확인해야 한다. 현재 제품에서 EVALSHA는 필수가 아니다.
- 옛 사후 합산 Worker를 전부 정지/드레인한 뒤 새 사전 예약 Worker를 기동한다. 혼합 운용에서는 초과 방지가 보장되지 않는다. 기존 quota를 초기화하지 않으며 DB migration은 필요하지 않다.
- Redis 응답 유실/Worker 중단으로 승인 여부가 불명확한 슬롯은 환불하지 않아 예산을 보수적으로 소모할 수 있다.
- TTL을 실제 이틀 기다린 시험은 아니다. 설정된172800초와 시험 키의 단축 물리 만료를 따로 검증했다. KST는 주입 clock이며 시스템/Redis clock을 변경하지 않았다.
- 동시성은 단일 Node 프로세스의 독립 Redis 연결32개다. 다중 호스트·전체 Worker E2E·Redis failover/데이터 유실·과거 snapshot 복원·모든 네트워크 분할 조합은 미검증이다.
- 외부 HTTP 차단 계수와 Redis 목적지 allowlist/전용 네트워크를 검증했으며 호스트 전체 packet capture를 수행한 것은 아니다. 운영/외부 endpoint에는 접속하지 않았다.
- AI/decision 서비스 전체 시험·새 빌드·운영 E2E는 이번 시험 코드 변경으로 반복하지 않는다. 이전 PR에서 완료한 빌드/CI와 이번 재실행 검사는 구분한다. F07/F13/F14·TPS 제한도 이번 범위에 포함하지 않는다.
