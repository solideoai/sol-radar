# MinIO → Supabase Storage (2026-10-21)

구현 기준: ADR-047, `polaris/specs/in-progress/2026-10-21-supabase-storage.md`, 기존 전환 계획 Task 3·4.
브랜치 `feat/supabase-storage`, 기준 `206db64`. 운영 적용 승인 대기.

## 변경

- 기존 Gateway의 frontend/redis-api 역할·인증·전송 소스만 현재 main 위에 재사용했다. 인력 데이터/추가 schema나 삭제된 템플릿 시험을 가져오지 않았다.
- private raw/parsed bucket, Worker 전용 immutable SDK 저장·실제 바이트 checksum 검증·한정 재시도, 물리 원장/lease·DB 확정과 고아 정리를 구현했다.
- 같은 원본을 참조하는 논리 문서 두 행을 보존하고, 업로드 성공 후 DB 실패 때 object를 즉시 삭제하지 않는다. 참조/삭제는 같은 object row lock으로 직렬화한다.
- 사용자 JWT/RLS로60초 attachment URL만 발급한다. 웹의 service role 사용은 없다.
- Worker Storage 실검사 보고30초/TTL120초, scope(DB URL·모드·bucket) 일치 검사. MinIO 없는 Compose4서비스·env·smoke·현행 문서를 동기화했다.
- 새 migration `20261021000700`·`00701` 및 생성 타입. 기존 migration/문서/볼륨/파일 삭제 없음.

## 검증

- 전체 `pnpm verify` exit0: 루트172·웹323·AI101·decision57, 서식/타입/린트/계층/생성물/Next 프로덕션 빌드 포함. [전체 로그](20261021-verify.txt)
- 실제 로컬 Supabase Storage HTTP: UUID 임시 private bucket2개, 각각50MiB 업로드/다운로드/삭제, 익명 읽기 거부, signed URL 실제 만료 PASS. 임시 bucket만 정리했으며 앱 DB는 변경하지 않았다. [로그](20261021-storage-http-smoke.txt)
- 실제 로컬 Redis + Next standalone Gateway: 큐 왕복·limiter·멱등·quota·401/404·설정 redirect 후 차단·Worker report readiness200 PASS. 외부 회사/클라우드는 변경하지 않았다. [로그](20261021-gateway-smoke.txt)
- 처음 변경 범위 검사에서 이전 proxy matcher를 가정한 시험2개가 실패했다. 실제 런타임 분기/차단을 검증하도록 갱신했고 proxy7·통합 전체가 통과했다. 초기 실패 로그는 이력으로 보존한다.
- 독립 읽기 전용 리뷰(gpt-6-astra): Critical/Important0. redis-api의 불필요한 AI_GATEWAY_URL 필수값을 기능 결함으로 재분류해 재현 시험 RED→GREEN으로 수정했다.
- `/predeploy-review` code/infra/qa 관점: 비밀키/권한·append-only schema·실제 timeout·핵심 회귀·빌드·독립 리뷰 확인. 운영 GO는 아래 cloud/회사 배포 증거까지 대기.
- 알려진 도구 경고: FastAPI/Starlette TestClient deprecation, native Gateway smoke의 BullMQ/ioredis listener 경고. 검사를 끄거나 경고를 숨기지 않았다.

## 읽기 전용 inventory

- 로컬 `sol-radar-stack-minio-1`: Compose SOL label와 `sol-radar-stack_miniodata` volume 확인. 인증된 S3 ListBuckets 결과 bucket0·object0. 컨테이너/볼륨은 그대로다.
- Supabase project `brtysdocxemrqhdezzqg`: 계획된 Storage bucket0. DB bid_documents18행, raw/object_key 참조0, parsed/text_object_key 참조0. 기존 문서 행을 보존한다.
- DB TLS 검증은 기존 `/private/tmp/sol-radar-supabase-ca.crt`(Supabase Root 2021 CA)를 명시해 유지했다. 검증을 끄지 않았다. 클라우드 최신 migration은00600이며 새00700/00701만 미적용이다.
- 회사 서버의 별도 MinIO/파일 존재 여부는 조회하지 않았다. 위 로컬 결과를 회사 전체 파일 없음으로 일반화하지 않는다.

## 운영 확인 대기

AGENTS.md의 운영 DB 변경 확인 규칙에 따라 사용자에게 새 migration2개와 private bucket2개 생성/실검증을 확인 요청했다. 아직 cloud DDL/bucket/production 변경은 없다.
회사 Gateway/Worker 배포, Vercel production/env 전환과 기존 ai binding 정리는 별도 운영 절차다. parser/documents consumer·processing attempt fencing·durable dispatch·quota 보강은 후속 Task 5·6이다.

## 구현 판단과 한계

1. 검증된 Gateway 소스만 선별 재사용했다. 비용: 새 main 기준 전송 회귀를 다시 검증해야 했으며 수행했다.
2. 이번 완료 범위는 Task 3·4다. 비용: documents 소비자/실파서 등 후속 기능을 실제 완성으로 간주할 수 없다.
3. Storage managed schema의 정책은 PGlite로, SDK HTTP는 별도로 검증했다. 비용: 실제 cloud JWT 정책 검증을 대체하지 못하므로 운영 적용 후 확인한다.
4. Worker만 fetch deadline이 있는 Storage client를 별도로 만든다. 비용: client 하나가 추가되며 기존 업무 DB/웹 secret 통로는 바꾸지 않는다.
5. bucket 생성 후 owner sentinel 기록 전에 중단되면 다음 실행은 소유 불명으로 멈춘다(리뷰 Minor). 비용: 소유 확인 후 운영자 수동 복구가 필요하며 자동 인수/공개 전환을 하지 않는다.
