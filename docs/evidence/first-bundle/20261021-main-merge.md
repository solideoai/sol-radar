---
title: "첫 구현 묶음 — main 로컬 병합·기존 작업 복원"
status: final
tags:
  - sol-radar
  - test
  - ops
updated: 2026-10-21
---

# main 로컬 병합 결과

사용자가 브랜치 처리 선택지1(main 로컬 병합)을 승인했다. `feat/first-bundle-integration@d87cc40`은 **main의 `23e9834`에 병합**됐고, 병행 문서 정정 `eca5552`도 `cd6d644`로 통합했다. push·PR 생성·클라우드 DB/bucket·회사 Gateway/Worker·Vercel 배포는 이번에 실행하지 않았다.

## 최신 main과의 통합

처음 확인한 main은7133636이었다. 작업 중 별도 Storage PR #7이 원격 main76eea2a에 병합됐고, 이어 문서 정정eca5552가 추가된 것을 확인해 모두 포함했다. 원격의 E2E 서버 역할·솔리데오 제목 기대값 수정과 Git 환경 격리 수정도 보존했다. Storage의 현재 결정은 **ADR-048**, 기존 공공 입찰 확장 제안은 **ADR-047**이다. 초기 통합 브랜치/증거에서 Storage를 ADR-047로 쓴 것은 당시 번호이며, 현재 정본의 번호가 우선한다.

PR #7에서00700/00701이 먼저 커밋됐으므로 해당 파일은 원격 main의 bytes 그대로 유지했다. 삭제 경합 보강은 새 `20261021000702_document_storage_incarnations.sql`로 옮겼다. 이미 적용된 인력00600도14834dc와 동일하다.

00702는 기존 raw/parsed 원장의 `logical_path=path`를 채우고, 기존 실제 경로·문서 FK·파일 bytes를 보존한다. 기존 파일은 claim이 반환한 경로에서 checksum 검증 후 재사용하며 새 원장만 UUID 경로를 받는다. 과거 삭제가 늦게 완료돼도 새 파일과 경로가 다르므로 영향을 줄 수 없다. 전체 원본/결과 파일을 이동하거나 재업로드하는 migration은 아니다.

원격의 `changedFiles(root)` 자체가 호출자 Git 환경을 제거하는 보강과 이 통합의 시험 harness 격리를 함께 유지했다. 회귀 두 개는 각각 실제 함수의 대상 저장소 선택과 훅에서 실행되는 시험의 호출 저장소 HEAD/index/config 보존을 확인한다.

## 기존 미커밋 작업 보존

병합 전 main의 변경75경로(추적46·새 파일29)를 파일별 사본·hash·binary patch와 stash에 보존했다. 원본 stash는 `89c5b6e9632e74b4c79a6bd4e5f11bb8c977bae0`(`codex-first-bundle-main-merge-20261021`)이며 지우지 않았다. 이전 stash도 유지했다.

두 병합을 끝낸 뒤 최신 main과 원래 변경을 3-way로 합쳤다. 로그인·데모 관리자·공공 입찰 제안 등 기존 작업은 미커밋 상태로 복원했다. Storage/Gateway·배포/권한 설명과 겹친14문서는 양쪽의 현재 계약과 제안을 보존해 해결했다. 파일75개 모두 준비한 복원 bytes와 실제 작업 폴더의 hash가 일치했다.

원래 새 파일이던 문서 정합화 계획과 증거는 그 사이eca5552에서 정식 커밋됐다. 계획은 같은 bytes였고, 증거는 더 최신의 커밋된 버전을 유지했다. 이전 증거 bytes도 원본 stash·사본에 남아 있다. 기존 다른 작업을 이 세션의 커밋에 일괄 포함하지 않았다.

사본·복원 manifest·판단 기록은 호스트 관리 작업 폴더f572의 `.superpowers/sdd/2026-10-21-first-bundle-main-merge/`에 남겼다. 원래 작업을 보존한 stash는 Git에도 유지한다. 다른 worktree를 정리하지 않았다.

## 검증

| 대상 | 결과 | 증거 |
|---|---|---|
| DB 업그레이드/삭제 경합/RLS·Git 격리 | 43/43. 기존 raw/parsed 참조를 가진 상태에서00702 적용 후 경로/FK 유지와 새 UUID 경로 확인 | [로그](20261021-main-database-git-upgrade.txt) |
| Worker 기존 파일 재사용 | 실패 `storage_claim_path_mismatch`를 먼저 확인한 뒤 호환 보강 | [RED](20261021-main-legacy-worker-red.txt) |
| Worker SDK·Proxy·골든 | 38/38(Worker8 포함) | [GREEN](20261021-main-legacy-worker-green.txt) |
| 첫 main 병합 커밋 훅 | 정책·웹365·DB27·DB 타입·루트183 등 필수 검사 통과 | [로그](20261021-main-merge-gate.txt) |
| 병행 문서 정정 병합 훅 | 정책·커밋 게이트 통과 | [로그](20261021-main-docs-gate.txt) |
| **복원된 작업을 포함한 main 전체 `pnpm verify`** | **exit0: 루트187·웹367·AI101·결정57, 총712테스트**. Next 빌드·타입·린트·계층·토큰·DB 타입 포함 | [최종 로그](20261021-main-final-verify.txt) |

첫 main 커밋 시 DB 타입 일치 검사가 생성물에 적용된 Prettier 서식 때문에 실패했다([로그](20261021-main-gate-initial.txt)). `pnpm db:types`로 정본 출력을 다시 생성한 뒤 타입 일치·실제 커밋 훅·최종 전체 검증을 통과했다. 생성물은 Prettier로 수정하지 않는 저장소 규칙을 적용했고, 검사·훅·린트를 끄거나 약하게 만들지 않았다.

최종 전체 검사는 main cd6d644와 복원된 기존 작업을 대상으로 직접 실행했다. 복원된 별도 관리자/로그인 시험도 포함하므로 처음 브랜치의703개와 구분한다. 이번 병합에서 전체 브라우저·인증 E2E·회사 Redis HTTPS·클라우드 Storage·GPU 학습은 새로 실행하지 않았다. 이전 로컬 HTTP/Redis smoke와 독립 리뷰는 [최초 통합 기록](20261021-implementation.md)에 있다. Python 의존성 deprecation 경고는 숨기지 않았고 실패는0이다.

## 남은 적용

- 운영에는00700/00701/00702와 private bucket2개 준비·실제 JWT/파일 검증이 남아 있다. 사용자 확인 없이 cloud DDL·bucket·seed/reset을 실행하지 않았다.
- 회사 Gateway의 기존6380 upstream 확인과 같은 release의 Worker/frontend 연결·Vercel 적용은 별도다. 기존 Redis/Nginx/MinIO를 변경·삭제하지 않았다.
- documents 소비자·실파서·durable dispatch/quota 예약·실모델 연결과 학습은 후속 범위다.

구체적인 운영 적용/복구 순서는 [갱신한 적용안](20261021-release-plan.md)을 따른다. 현재 main이 로컬 원격보다 앞선 상태를 운영 배포나 push 완료로 해석하지 않는다.

## 관련 문서

- [[PROGRESS]]
- [[16-DECISIONS]]
- [[17-CLAUDE-IMPLEMENTATION]]
