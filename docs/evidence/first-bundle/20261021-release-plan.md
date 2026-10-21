---
title: "첫 구현 묶음 — 운영 적용·복구 계획"
status: review
updated: 2026-10-21
---

# 200명·Gateway·Storage 운영 적용안

로컬 통합과 운영 적용은 별개다. 최초 통합 기준은 main206db64였으며 사용자 선택1에 따라 main23e9834·cd6d644에 병합했다([검증](20261021-main-merge.md)). 이 문서는 운영 변경의 구체적인 검토 자료이며 운영 실행 완료 기록이 아니다.

## 적용할 변경

| 항목 | 변경 | 현재 확인 |
|---|---|---|
| 인력 DB | `20261021000600_enrich_all_demo_people.sql` | 이전 클라우드 적용 증거가 있다. 재작성·재적재하지 않는다 |
| 새 public schema | `20261021000700_document_storage.sql` | 문서 메타데이터·원장·lease·확정/정리 RPC. 먼저 병합된 main 파일을 그대로 보존 |
| Storage 접근 | `20261021000701_document_storage_access.sql` | 활동 중 업무 사용자가 참조된 원본만 읽는 SELECT 정책. 사용자 쓰기·parsed 읽기 없음 |
| 삭제 경합 보강 | `20261021000702_document_storage_incarnations.sql` | 기존 raw/parsed 실제 경로·문서 FK를 유지하고 논리 경로를 채운다. 새 원장만 UUID 경로로 분리. 이미 커밋된00600/00700/00701은 수정하지 않음 |
| private bucket | `bid-documents`, `bid-parsed` | 원본/결과, 각각 50MiB. 공개 전환·기존 외부 bucket 인수 없음 |
| Gateway | 회사 Redis6379 유지, 기존 Nginx `/redis/` → loopback6380의 Next `redis-api` | 사용자 Redis 기동 보고와 별개로 외부 health는 2026-10-21 22:59 KST 502 |
| Worker/web | 같은 release의 Gateway·Worker·Vercel frontend 설정 | Worker만 Storage service role 사용. 웹은 JWT+anon |

## 운영 DB·bucket 확인 후 실행할 순서

1. 동일 release를 검증하고, 운영 CLI의 기존 TLS 인증서 검증을 유지한 `pnpm db:push --check`로 적용 목록을 확인한다. 예상은 새00700/00701/00702 세 개다. 일부가 먼저 적용돼 있다면 DB 이력·파일 일치를 확인하고 남은 추가 migration만 검토한다. 목록이 예상과 다르면 적용하지 않고 차이를 보고한다.
2. 사용자 확인 뒤 `pnpm db:push`, 이어서 `pnpm db:verify`를 실행한다. 기존 공고/원본·프로필·Auth·분석 스냅샷을 reset/seed하지 않는다.
3. Worker 전용 자격을 가진 운영 환경에서 `node scripts/ops/ensure-storage-buckets.mjs`로 read-only 확인한다. 이름 충돌·public·소유 불명·한도 차이는 강제로 고치지 않는다.
4. 별도 bucket 생성 확인 범위에서 `node scripts/ops/ensure-storage-buckets.mjs --apply --smoke --large`를 실행한다. private 설정·owner marker·50MiB 왕복을 확인한다. CLI가 만든 UUID smoke object만 정리한다.
5. 실제 사용자 JWT로 참조된 원본 signed URL 발급과 비로그인·비참조 파일 거부를 확인한다. 사용자로 parsed 또는 health object를 읽을 수 없어야 한다. 키·JWT·signed URL은 로그에 남기지 않는다.

## Gateway 502 확인 및 배포

회사 서버의 기존 Nginx 설정·다른 프로세스를 바꾸기 전에 HTTP upstream을 확인한다. 아래 두 GET은 키를 보내지 않으며, 이 구현이 동작 중이면 인증 거부401이 기대값이다.

```bash
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:6380/health
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://acropolissg.com/redis/health
```

- Redis PONG만으로 HTTP Gateway 기동 성공을 판정하지 않는다. 502의 원인은 회사 upstream의 listener·대상 release·프로세스 상태·오류 로그를 읽기 전용으로 대조한 뒤 정한다.
- Gateway 프로세스/컨테이너·network·env 변경이 필요하면 실제 대상과 변경 명령을 준비한 뒤 운영 확인을 받는다. `infra/compose.company.yaml`은 새 Redis를 만들지 않고 기존 external network를 사용한다.
- 회사 `redis-api`는 `SOL_DEPLOYMENT_ROLE=redis-api`, 기존 TCP `REDIS_URL`, 서비스 token, URL/anon, 모드와 bucket 이름을 받는다. AI·Storage 상태는 같은 scope의 Worker 보고에서 읽는다.
- Worker는 Storage 운영 준비 후 같은 release로 기동한다. 30초 주기 보고의 Storage 상태와 120초 만료를 확인한다. 보고가 없으면 readiness503이 정상이며 정상으로 꾸미지 않는다.
- 서비스 token이 있는 health200 및 분석/수집 접수202 → DB polling → Worker 완료를 검증한 뒤 Vercel `frontend`를 같은 release로 연결한다. Vercel에는 Redis TCP·service role을 넣지 않는다.
- 기존 Vercel `ai` binding의 정리는 이번 로컬 묶음의 완료 범위에 넣지 않았다. 상세 AI 관리 화면과 Worker가 실제로 어느 gateway를 보는지 기록한 뒤 후속 운영 단계에서 정리한다.

## 복구와 보존

- 새 schema·bucket은 추가형으로 보존한다. 장애 시 신규 접수를 중단하고 이전 release와 기존 실행 경로로 수동 복귀한다. 이전 DB snapshot·저장된 분석을 덮어쓰지 않는다.
- 이미 적용된 migration을 수정/삭제하거나 bucket을 비우지 않는다. 회사 Redis·Nginx·기존 MinIO 컨테이너/볼륨은 이 작업에서 제거하지 않는다.
- 회사 MinIO 데이터 존재 여부는 미확인이다. 필요한 경우 SOL 소유 inventory·복사·checksum 검증 후에만 별도 제거를 검토한다. 로컬 empty inventory를 회사 전체에 일반화하지 않는다.
- documents 소비자·실파서·모델 학습·durable dispatch·quota 예약 보강은 다음 묶음이다. Storage 준비를 실제 RFP 분석 완료로 보고하지 않는다.

## 관련 문서

- [[17-CLAUDE-IMPLEMENTATION]]
- [[10-DEPLOYMENT]]
- [[PROGRESS]]
