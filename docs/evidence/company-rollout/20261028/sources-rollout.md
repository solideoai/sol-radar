---
title: "공공데이터 수집 서비스 회사 반영 기록 (2026-10-28 오후)"
status: active
tags: [sol-radar, ops, ingestion, lh, kepco, kwater, program-notices, attachments]
updated: 2026-10-29
---

# 공공데이터 수집 서비스 회사 반영 기록 (2026-10-28 오후)

[[../../../plans/2026-10-28-all-sources-activation|10종 수집 계획]]에 따라 LH·KEPCO·K-water 입찰공고를 회사 ingest Worker에 켰다. 기업마당 전용 Worker와 Documents Worker도 띄웠다. 메인 세션 e3가 회사 망에서 SSH로 스크립트를 돌렸다. 오전 A단계는 [[lh-a-stage-ingest-worker|LH A단계 기록]]에 있다.

지킨 조건:
- 회사 서버에서는 `/data/www/ai_workspace` 밖으로 나가지 않았다(`/tmp` 안 씀).
- 반영은 회사 운영 저장소 `sol-radar-app` 에서 했다. `infra/compose.company.yaml` 의 로컬 수정은 보존했다. 로컬 diff sha256 앞 16자리 `e911b0f06832f2cb` 가 매번 같았다.
- 재생성은 KST 정각 15분 뒤부터 다음 정각 30분 전 사이에만 했다. 직전 `--status` 에서 waiting·active·prioritized 가 모두 0인 것도 확인했다.
- `--unschedule`·`docker compose down`·`--remove-orphans` 는 쓰지 않았다. redis-api·AI gateway·Analysis Worker 는 건드리지 않았다.
- 실호출·push·회사 반영·재생성은 단계마다 사용자 승인을 받았다.

## 1. 결과

| 시각(KST) | 단계 | 결과 |
|---|---|---|
| 12:15:22~12:15:34 | LH B2~B4: 회사 registry 켜기(사용자 선택 "12시 확인 뒤") | 회사 HEAD `1646e7d0` → `c5c88510`(registry만). 이미지 `1646e7d033a1` 그대로 재생성, healthy. `--check`: LH `READY`, 나머지 외부 5종 `DISABLED`. Job Scheduler 1개 → 2개(`g2b`·`lh`) |
| 15:00~15:12 | 15:00 회차 | 나라장터 `SUCCEEDED`(162건, 생성 148). LH 첫 정기 회차 `SUCCEEDED`(26건 생성, 격리 0, quota 1) |
| 15:15~15:16:08 | KEPCO·K-water 입찰 켜기(사용자 결정 "15:15 KEPCO 와 함께", KEPCO 하루 한도 100) | 회사 HEAD `c5c88510` → `209d5515`. 새 이미지 `209d551590c9`(`991dacb7c8ec`). `--check`: LH·KEPCO·K-water `READY`, 3종 `DISABLED`. 재생성 healthy, Job Scheduler 4개 |
| 15:59:49 | 누군가 ingest Worker를 옛 이미지 `24f2ac84963c` 로 재생성 | K-water `OPERATION_UNVERIFIED`, Job Scheduler 3개가 됐다. 어느 세션이 했는지 확인하지 못했다(기업마당 코드 담당 a8은 아니라고 답했다) |
| 16:03:53~16:03:58 | 되돌리기(사용자 결정 "209d551590c9 로 되돌리기") | 회사 HEAD `209d5515` 확인. `--check` 3종 `READY` 확인. `209d551590c9` 로 재생성, healthy, Job Scheduler 4개 |
| 16:05:18 | 기업마당 실응답 녹음 1회(승인) | HTTP 200, 100건(전체 279), 비밀값 누출 0. [[../../program-notices/20261028-bizinfo-schedule\|기업마당 증거]] §2 |
| 16:42 | 기업마당 전용 Worker 준비(사용자 승인 ①②③) | 회사 HEAD `209d5515` → `db442be1` fast-forward. 바꾸지 않을 경로가 그대로인지 확인했다: compose 2개, Dockerfile, `infra/sources`, ingest 진입점, `web/server/ingestion`, migrations, 패키지 파일. 이미지 `sol-radar-program-notices-worker:db442be15481`, `--check` 통과 |
| 16:43:22~16:43:24 | `--once` 기업마당 1회 | `SUCCEEDED` fetched 100·saved 100·dropped 0. 운영 `program_notices` 기업마당 100행 |
| 16:43:38~16:43:41 | `up`(프로젝트 `sol-radar-program-notices`) | healthy, `bizinfo-scheduled` Job Scheduler 1개(다음 18:00). ingest Worker는 그대로(`209d551590c9`, Scheduler 4개) |
| 17:37~17:39 | Documents Worker 사전 점검·준비(45 요청, 이 세션 사용자 승인) | 전체 Worker는 돌지 않는다. 파서 3종(PDF `pdfplumber@0.11.10`, HWPX `sol-hwpx@1`, HWP `sol-hwp5@1`+`olefile@0.47`)이 있다. documents compose sha 앞 16자리 `014c15e0c0312f9f` 가 세 곳에서 같다. 이미지 `sol-radar-documents-worker:db442be15481`, `--check` 통과 |
| 18:00~18:23 | 18:00 회차 | §2 |
| 18:16:42 | Documents 1단계(`DOCUMENTS_ROUND_MAX_REVISIONS=1`, 사용자 "1단계 기동 승인") | healthy. 45 판정: 47건 중 PARSED 45·PARTIAL 1·UNSUPPORTED 1·FAILED 0. 남은 3,793건을 다 받아도 약 1.4GB로 봤다 |
| 18:34:28 | Documents 2단계(기본값 10 revision/회차, 사용자 "2단계 승인") | healthy·restarts 0. §3 |
| 18:55:15~18:55:29 | K-water 진행 상태 3개 마감 처리(사용자 결정 "셋 다 CLOSED"·"오늘 20:30 전") | main `d171a716` push(pre-push 통과). 회사 HEAD `db442be1` → `d171a716` fast-forward. 들어온 변경 중 Worker에 닿는 것은 K-water 정규화·시험 2파일과 registry 설명 한 줄뿐이다(compose·worker·migrations·패키지·`services`·`fixtures` 변경 0). 새 이미지 `d171a7162e17`(`ca8ef75a9b2e`). `--check`: 3종 `READY`·3종 `DISABLED`. 재생성 healthy, Job Scheduler 4개. 기업마당·Documents Worker는 그대로(`db442be15481`, restarts 0) |

되돌리기(18:55 반영): `git reset --keep db442be1 && INGEST_WORKER_TAG=209d551590c9 docker compose -f infra/compose.ingest-only.company.yaml up -d --no-deps --force-recreate ingest-worker`.
기업마당 되돌리기: stop → `--unschedule` → `--status`(`infra/company/README.md` §10). Documents 되돌리기: stop.

## 2. 18:00 회차 (운영 DB `ingest_runs` 읽기)

큐가 하나이고 동시 처리 수가 1이라 서비스가 차례로 돈다.

| 서비스 | 시각 | 상태 | 받은 건수 | 생성 | 중복 | 격리 | quota |
|---|---|---|---|---|---|---|---|
| 기업마당 | 18:00:00 | `SUCCEEDED` | 100 | 저장 100 | — | 버림 0 | — |
| 나라장터 입찰공고 | 18:00~18:08 | `SUCCEEDED`·`COMPLETE` | 317 | 292 | 2 | 0 | 4 |
| K-water 입찰공고 | 18:08~18:20 | `PARTIAL`·`COMPLETE` | 325 | 317 | 0 | 8 | 4 |
| LH 입찰공고 | 18:20 | `SUCCEEDED`·`COMPLETE` | 5 | 0 | 5 | 0 | 1 |
| KEPCO 입찰·계약 | 18:20~18:23 | `PARTIAL`·`PARTIAL` | 71 | 71 | 0 | 0 | 1 |

- K-water 격리 8건은 모두 `SCHEMA_INVALID`(`PROVIDER_STATUS_NOT_VERIFIED`)다. 녹음에 없던 진행 상태(`tndrStat`)인 제안서제출 5·기술협상 2·PQ심사 1건이다. 사용자 결정으로 셋 다 `CLOSED` 로 두었다(main `d171a716`). 18:55 반영이라 21:00 회차부터 적용된다.
- KEPCO `PARTIAL` 은 예상한 결과다. 응답 상한과 빠진 회사 범위를 확인하지 못해 코드가 모든 쪽을 `PARTIAL` 로 둔다(`web/server/ingestion/external-api-connector.ts`). 따로, KEPCO 첨부 주소는 `http://srm.kepco.net` 이라 허용 목록 밖이다. 허용할지는 따로 정한다.
- LH 5건은 15:00에 받은 공고와 내용이 같아 새 revision을 만들지 않았다.
- 나라장터 하루 quota 사용은 09:00 68, 12:00 684, 15:00 95, 18:00 4였다. 12:00 회차가 크게 썼다. 하루 한도와 비교는 아직 하지 않았다.

## 3. Documents Worker (운영 DB `bid_documents` 읽기, 19:0x KST)

| download | parse | 건수 |
|---|---|---|
| `OK` | `PARSED` | 393 |
| `OK` | `PARTIAL` | 3 |
| `OK` | `UNSUPPORTED` | 3 |
| `OK` | `PENDING`(처리 중) | 1 |
| `PENDING` | — | 6,127 |

- 18:00 이후 받은 첨부는 약 167MB다(`size_bytes` 합). `FAILED` 0건, 다운로드 실패 0건이다.
- 남은 `PENDING` 이 오후 3,793건에서 6,127건으로 늘었다. 18:00 나라장터 회차가 새 공고 292건을 더했다.
- 중간 확인은 45가 DB로 한다. `FAILED` 가 반복되면 stop 한다.

## 4. 10-29 ingest Worker 반영 (메인 세션 c5, 사용자 승인 단계마다)

| 시각(KST) | 단계 | 결과 |
|---|---|---|
| 09:40:39 | KEPCO 공고 없는 날 404 를 빈 쪽으로·조회 시작일 3일 앞당김(사용자 결정 "404 빈 응답 + 3일 앞당김"·"지금 연이어 진행") | main `a2e4a35b`. 회사 HEAD `d171a716` → `a2e4a35b` fast-forward(돌고 있는 컨테이너의 바인드 마운트 아래 변경은 `infra/sources/registry.yaml` 설명뿐). 새 이미지 `a2e4a35b6ffb`. `--check` 3종 `READY`·3종 `DISABLED`. 재생성 healthy, Job Scheduler 4개. [[../../ingestion/20261028-kepco-contract/no-data-404\|KEPCO 404 기록]] |
| 10:49:08 | 나라장터 보조 조회 예산을 기능별로 나누기·같은 revision 에 다시 채우기(사용자 결정 "지금 push·반영") | main `cbb3831e`. 회사 HEAD `a2e4a35b` → `cbb3831e` fast-forward(infra·패키지·fixtures·migrations·services 변경 0). 새 이미지 `cbb3831e86da`. `--check` 같음. 재생성 healthy, Job Scheduler 4개. 기업마당·Documents Worker 그대로 |
| 10:49:51 | `--refill-aux --limit 1`(사용자 결정 "오늘 1건 시험 + 밤 일괄") | `refilled=1`·호출 3회. revision·이벤트·첨부 수 그대로. [[../../ingestion/20261029-g2b-aux-budget\|보조 예산 기록]] |

되돌리기(10:49 반영): `git reset --keep a2e4a35b && INGEST_WORKER_TAG=a2e4a35b6ffb docker compose -f infra/compose.ingest-only.company.yaml up -d --no-deps --force-recreate ingest-worker`.

## 5. 남은 것

- 10-29 12:00 회차에서 KEPCO 가 `FAILED` 없이 끝나는지 본다(404 수정 첫 확인). 12:00 이후 나라장터 회차가 `SKIPPED_QUOTA` 없이 끝나는지 본다.
- 21:00 회차 뒤 `--refill-aux --limit 300` 1회(사용자 결정, 회사 망 필요).
- 21:00 회차에서 K-water 격리가 0건인지 확인한다.
- `/bids` "부처 지원사업" 탭에 기업마당 100건이 보이는지 화면으로 확인한다.
- 15:59:49 재생성을 누가 했는지 확인한다(사용자가 다른 터미널 확인).
- KEPCO 첨부 주소 허용 여부를 정한다.
- ~~나라장터 하루 quota와 실제 사용량을 비교한다.~~ 10-29 비교했다. 기능별 한도로 나눴다(§4).
- 회사 녹음 폴더 `sol-bizinfo-rec`·`sol-datagokr-rec`·`sol-kepco-rec` 는 사용자 OK 뒤 정리한다.
- 아직 켜지 않은 서비스: K-water 발주계획(정규화 없음), LH 사전규격, 나라장터 사전규격·발주계획, 조달요청, 업종 마스터(migration·`db:push` 승인 필요).

## 관련 문서

- [[lh-a-stage-ingest-worker|LH A단계 기록]]
- [[../../../plans/2026-10-28-all-sources-activation|10종 수집 계획]]
- 회사 반영 실행서(git `3ae02acf` 의 `docs/plans/2026-10-27-company-rollout-attachments.md`) §8
- [[../../program-notices/20261028-bizinfo-schedule|기업마당 정기 수집 증거]]
- `infra/company/README.md` §10
