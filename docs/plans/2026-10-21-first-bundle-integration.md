---
title: "첫 구현 묶음 — 200명·Redis Gateway·Supabase Storage 통합"
status: done
updated: 2026-10-21
---

# 첫 구현 묶음 통합 계획

2026-10-21 사용자가 "첫 구현 묶음부터" 실행하도록 승인했다. 기존 Storage 전환 계획 Task 2~4와 인력 ADR-043, Gateway ADR-045를 현재 main `206db64` 기준으로 통합한다. 실행은 `superpowers:executing-plans`로 직접 수행한다.

## 범위와 완료 기준

- main 및 다른 작업 폴더의 미커밋 변경은 보존하고 `feat/first-bundle-integration`에서 작업한다.
- 200명 속성·seed·상세 조회와 기존 골든 94/72/68을 보존한다. 이미 적용된 `20261021000600`은 변경하지 않는다.
- Gateway의 HTTPS 접수·사용자 JWT·현재 조직/RLS 재검증을 보존한다. 회사 Redis 자체를 재구축하지 않는다.
- Storage의 private raw/parsed, 원장·lease·다운로드 URL·health·MinIO 의존성 해제를 통합하고 검증한다.
- ADR-046에 따라 삭제한 시험을 복원하지 않는다. 새 핵심 계약·실제 통합 결함만 검증한다.
- documents 소비자·실파서·durable dispatch·quota 예약·모델 학습은 후속 묶음이다.
- 클라우드 migration/bucket, 회사 프로세스·Nginx, Vercel production은 이번 로컬 통합과 구분한다. 운영 변경은 검증 결과와 구체적인 적용안을 준비한 뒤 확인받는다.

## Task 1 — 200명·Gateway 통합

대상: `14834dc`, `e2a9c93`, `531d1ee`, `71cf481`의 현재 main 대비 변경. 주요 경계는 `scripts/database.test.mjs`, fixture·seed, `web/server/people`, `web/server/scoring`, `web/proxy.ts`, `web/app/_lib/redis-api-*`, 기존 분석·수집 API다.

- [x] 원본 branch와 충돌 파일을 확인하고 로컬 통합한다. 기존 main의 Vercel 구성·검증 축소·보안 수정은 유지한다.
- [x] DB 타입을 migration에서 재생성한다. 핵심 DB·200명 점수·Gateway 계약 시험으로 변경을 확인한다.

## Task 2 — Storage 구현 인수 및 결함 수정

정본: 기존 `2026-10-21-redis-gateway-supabase-storage-migration.md` Task 3·4, `polaris/specs/in-progress/2026-10-21-supabase-storage.md`. 원본은 `feat/supabase-storage` 작업 폴더이며 다른 작성자가 있으면 원본을 수정하지 않는다.

- [x] 안정된 소스 snapshot 또는 커밋을 받아 Gateway 변경과 분리해 통합한다.
- [x] 충돌·실패의 원인을 먼저 재현한다. 새 계산·권한·복구 결함은 최소 회귀 시험을 실패시킨 뒤 수정한다.
- [x] DB 정책·Storage 업로드/확정 실패/중복/삭제 경합·원본 signed URL·Worker health의 핵심 계약을 확인한다.
- [x] `pnpm verify:changed`로 변경 범위를 검증한다.

## Task 3 — 통합 검증과 적용안

- [x] 최종 코드에서 전체 `pnpm verify`를 실행한다.
- [x] 격리 로컬 Gateway의 실제 Redis 왕복, private Storage HTTP 왕복과 접근 제어를 확인한다. 기존 환경의 성공 결과는 입력·커밋이 같을 때만 재사용한다.
- [x] 통합 단위 독립 리뷰 1회 후 중요한 결함을 수정·재검증한다.
- [x] 외부 `/redis/health` 응답과 로컬 성공을 구분하고, 새 migration·bucket·Gateway 배포의 적용/복구안을 정리한다.
- [x] `docs/PROGRESS.md`와 `docs/evidence/first-bundle/`에 실제 결과를 남긴다.
- [x] 실제 커밋 훅에서 발견한 임시 Git 환경 격리 결함을 재현·복구하고 harness 회귀 시험15/15를 확인한다. 필수 훅은 유지한다.

## 결과

로컬 통합 완료. 독립 리뷰의 삭제 경합 P1 한 건은 논리 중복 키를 보존하면서 실제 Storage 경로에 원장 UUID를 넣어 수정했다. 실패 재현 후 DB26·Worker7을 통과했고, 실제 커밋 훅에서 드러난 임시 Git 환경 상속 결함도 복구·격리 회귀15/15로 보강했다. 최종 전체 검사(루트181·웹364·AI101·결정57·빌드)가 통과했다. [구현·판정 기록](../evidence/first-bundle/20261021-implementation.md)과 [운영 적용안](../evidence/first-bundle/20261021-release-plan.md)을 남겼다. main 병합·클라우드 DB/bucket·회사 Gateway·Vercel 운영 배포는 실행하지 않았다.

## 검토 초점

1. 이미 적용된 인력 migration이 누락되거나 Storage migration의 순서·타입과 어긋나지 않는가.
2. 오래된 branch를 통합하면서 삭제한 대량 시험이나 오래된 Vercel 구성을 되살리지 않는가.
3. 사용자 다운로드 경로에 service role이 들어가거나, Storage object를 DB 확정 전에 공개하지 않는가.
4. 중복 파일의 논리 문서 두 행과 업로드/삭제 lease가 보존되는가.
5. 외부 Gateway 502·모델 미학습·실파서 미구현을 로컬 성공과 혼동하지 않는가.

## 관련 문서

- [[PROGRESS]]
- [[16-DECISIONS]]
- [[17-CLAUDE-IMPLEMENTATION]]
