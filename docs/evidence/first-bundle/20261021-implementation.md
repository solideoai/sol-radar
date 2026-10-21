---
title: "첫 구현 묶음 — 로컬 통합·검증·리뷰"
status: verified-local
updated: 2026-10-21
---

# 200명·Gateway·Storage 통합 결과

작업 브랜치는 `feat/first-bundle-integration`, 기준 main은 `206db640465fc3bb3d7b9fa6cfde921de74cfada`다. 사용자 승인 범위에서 인력200명·Redis HTTPS Gateway·private Supabase Storage를 한 release로 통합했다. 운영 적용 완료 기록은 아니다.

## 변경과 입력

- `14834dc`의 인력200명 속성·seed·상세 조회와 `feat/redis-http-gateway`의 `e2a9c93`·`531d1ee`·`71cf481`을 통합했다. 전체 인력 가용95.5 FTE와 기존 골든94/72/68을 검증했다. 클라우드 적용 이력이 있는00600의 bytes는 변경하지 않았다.
- Storage는 원본 c289 작업 폴더가 계속 변경되어 고정 baseline과 비교한 파일 bytes만 읽기 전용으로 인수했다. 파일별 hash와 출처는 [manifest](20261021-storage-source.json)에 있다. 원본 폴더·index·main의 미커밋 작업을 수정하지 않았다. 이후 원본 변경은 별도 비교가 필요하다.
- private raw/parsed bucket·문서 메타데이터/물리 원장·업로드/정리 lease·checksum·사용자 JWT/RLS signed URL·Worker health 보고와 Compose/env 전환을 통합했다. 새00700/00701을 적용하면 되고 DB 타입은 전체 migration에서 생성했다.
- main의 Vercel 빌더/ASGI/runtime-data와 ADR-046 시험 축소를 유지했다. 오래된 branch의 삭제된 전수 시험·옛 Vercel 준비 스크립트를 복원하지 않았다. imported 과거 증거는 당시 결과다.

## 독립 리뷰와 실제 결함 수정

통합 단위에서 코드·인프라·QA를 묶어 독립 리뷰를 한 번 수행했다. 검토 snapshot은 staged tree `0e2aeba3abb21534f2c99a1add6b7c18a809471b`이며 중요한 결함은 아래 P1 한 건이었다.

1. Worker A가 DELETE_PENDING을 선점하고 멈춘다. lease 만료 뒤 B가 인수해 물리 파일과 원장을 지운다.
2. 같은 논리 checksum 키에 새 문서를 만들면 기존 구현은 같은 실제 경로를 재사용한다.
3. 늦게 재개한 A의 Storage DELETE가 새 파일을 지운다. 마지막 DB CAS가 실패해도 외부 DELETE를 되돌릴 수 없다.

실제 `createDocumentStorage`·Supabase SDK·격리 PGlite와 지연시킨 byte transport로 재현했다. 수정 전 참조된 OK 문서1행에 실제 파일0개가 남았다. 회귀 시험 두 개를 먼저 실패시킨 뒤 수정했다.

수정은 `(bucket, logical_path)`의 살아 있는 중복 판정을 유지하고, 각 물리 파일 경로에 원장 UUID 디렉터리를 넣는 것이다. raw/parsed 모두 같은 규칙이다. claim은 실제 경로를 반환하고 Worker는 이를 검증해 업로드·확인·문서 참조에 쓴다. 문서의 bid/revision/checksum 검사는 논리 경로를, FK는 실제 경로를 검증한다. 늦은 A는 이전 UUID의 파일만 삭제하므로 새 참조 파일이 남는다. 아직 미커밋·미배포인00700에 반영했으며 이미 적용한 migration은 수정하지 않았다.

증거: [DB RED](20261021-delete-race-red.txt)·[DB GREEN](20261021-delete-race-green.txt), [Worker RED](20261021-delete-path-red.txt)·[Worker GREEN](20261021-delete-path-green.txt), [실제 Worker/SDK 경합 재현 PASS](20261021-delete-race-smoke.txt). 리뷰 후 같은 검토를 반복 의뢰하지 않고 결함의 재현과 최종 전체 검사로 확인했다.

## 커밋 훅에서 드러난 임시 Git 저장소 격리 결함

첫 실제 커밋 시 필수 훅의 `pnpm test`가 `verify-changed.test.mjs`에서 실패했다. 임시 저장소를 만드는 Git 명령이 훅의 `GIT_DIR`·`GIT_INDEX_FILE` 등 환경을 상속해, 이 통합 브랜치에 잘못된 `chore: baseline` merge commit을 만들고 index/공유 `core.bare` 설정을 바꿨다. 앞선 일반 전체 검사에서는 Git 훅 환경이 없어 드러나지 않았다. [실패 로그](20261021-commit-hook-failed.txt).

잘못된 commit `613f706`은 복구용 로컬 브랜치 `recovery/first-bundle-hook-baseline-20261021`에 보존했다. main ref를 되돌리지 않고 이 통합 브랜치만 원래206db64·Gateway71cf481의 merge 상태로 복구했다. index는 baseline에서 재구성했고 공유 `core.bare`를 원래 false로 복원했다. 실제 작업 파일은 리뷰 tree와 대조해 삭제 경합/문서 수정12개 외의 차이가 없음을 확인했고, 복구 전후 bytes도 검증 도구의 의도한 수정 외에는 일치했다. 구현 파일·main의 다른 진행 중인 작업을 지우거나 초기화하지 않았다.

임시 저장소의 Git·CLI 호출에는 `GIT_*`를 제거한 환경을 명시하고, `changedFiles`의 실제 Git 호출도 같은 격리 프로세스에서 검증하도록 시험 harness를 고쳤다. 제품 코드·필수 검사·훅은 끄거나 약하게 만들지 않았다. 호출 저장소를 가리키는 훅 환경을 주입하고 HEAD/index/config 보존 및 실제 시험 실행을 확인하는 회귀 시험을 추가해 RED→GREEN을 확인했다. 해당 파일15/15 통과. [RED](20261021-hook-isolation-red.txt)·[GREEN](20261021-hook-isolation-green.txt). 이후 전체 `pnpm verify`도 root181/web364/AI101/decision57·빌드까지 exit0을 확인했다.

## 이번 통합에서 직접 실행한 검증

| 실행 | 결과 | 증거 |
|---|---|---|
| 인력/DB 핵심(통합 초반) | 26/26 | [로그](20261021-people-db.txt) |
| Gateway/proxy/골든(통합 초반) | 82/82 | [로그](20261021-gateway-goldens.txt) |
| `pnpm verify:changed` | exit0 | [로그](20261021-verify-changed.txt) |
| 리뷰 전 전체 `pnpm verify` | root179/web363/AI101/decision57·빌드 통과 | [당시 로그](20261021-verify-full.txt) |
| 삭제 경합 수정 후 `pnpm verify` | exit0: root180/web364/AI101/decision57·빌드 통과 | [로그](20261021-verify-final.txt) |
| Git 시험 격리 보강 후 최종 `pnpm verify` | **exit0: root181/web364/AI101/decision57**·빌드·타입·린트·계층·생성물 검사 통과 | [최종 로그](20261021-verify-final-hook.txt) |
| 로컬 실제 Redis/Next/BullMQ | limiter30/5·동시 멱등1건·quota·queue 왕복·health200·무인증401·차단10경로·정적/Next-Action/308 통과 | [로그](20261021-gateway-smoke.txt) |
| 로컬 실제 Supabase Storage HTTP | UUID 임시 private bucket 각각50MiB upload/download/delete·anon 거부·signed URL 만료 통과·임시 대상 정리 | [로그](20261021-storage-http.txt) |
| 외부 `/redis/health` 무인증 GET | TLS 검증 성공, **HTTP502** (2026-10-21 22:59 KST) | [응답 메타데이터](20261021-external-gateway.json) |

Gateway smoke는 loopback의 별도 Redis와 Next를 썼다. Storage smoke는 로컬 Supabase의 전용 임시 bucket을 썼으며 앱 DB는 바꾸지 않았다. 수정한 경합은 DB/SDK transport 시험과 최종 전체 검사에서 재검증했다. 회사 upstream·운영 bucket·실사용자 파일·클라우드 DDL·전체 브라우저/인증 E2E·GPU 학습은 이번에 실행하지 않았다. Python Starlette deprecation과 로컬 BullMQ/ioredis EventEmitter listener 경고는 숨기지 않았으며 검사는 exit0이다.

## 판단과 남은 작업

- 삭제한 전수 시험을 일률적으로 되살리지 않는다. 이번 두 회귀 시험은 실제 데이터 손실 결함을 직접 검증한다. 새로 드러나는 핵심 결함은 개별 재현을 추가한다.
- 원본 작업 폴더는 읽기 전용 snapshot으로 인수했다. 이후 원본 변경은 이 release에 자동으로 포함되지 않는다.
- 기존 raw evidence의 도구 공백은 그대로 보존했다. 코드/설정의 diff whitespace 검사는 통과했으며 전체 raw-log `git diff --check`에는 과거 출력 공백이 보일 수 있다.
- 리뷰는 고정된 staged tree를 대상으로 했다. 이후 변경은 삭제 경합 수정·타입/정본 문서이며 두 RED→GREEN·SDK 재현·최종 전체 검사로 확인했다.
- UUID 실제 경로는 외부 DELETE를 세대별로 격리하기 위해 필요하다. 소비자는 경로 모양을 추정하지 않고 DB 메타데이터/claim 결과를 사용해야 한다.
- documents 소비자·실파서·처리 시도 fencing은 기존 전환 계획 Task6, durable dispatch·quota 예약은 Task5다. Storage 기반 완성을 RFP 분석 파이프라인 완성으로 보고하지 않는다.
- Bosun 학습·실모델 연결, 전체 확장 화면 통합, 기존 Vercel AI binding/관리 화면과 Worker gateway 정합화는 후속이다.
- main 병합·push·운영 DB/bucket·회사 Gateway/Worker/Vercel 배포는 미실행이다. 회사 Redis의 PONG 보고를 HTTPS Gateway 성공으로 해석하지 않는다. 기존 MinIO inventory/이전/삭제도 별도다.

구체적인 새 migration·private bucket·Gateway 배포 순서와 복구/보존 기준은 [운영 적용안](20261021-release-plan.md)에 있다. 운영 변경은 그 대상과 범위를 확인한 뒤 수행한다.

## 관련 문서

- [[PROGRESS]]
- [[16-DECISIONS]]
- [[17-CLAUDE-IMPLEMENTATION]]
