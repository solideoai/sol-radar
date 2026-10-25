---
title: "10-25 운영 반영 실행서(release-1025)"
status: draft
tags: [sol-radar, evidence, ops, integration]
updated: 2026-10-25
---

# 10-25 운영 반영 실행서(release-1025)

> [!warning] 실행 기록이 아니다
> 기준은 `integration/release-1025` @04b4bf3a 다. 아직 main 에 들어가지 않았고 운영에 적용한 것은 없다.
> 아래 7개 승인 항목은 사용자가 항목마다 따로 승인한 뒤에만 실행한다. 실행 전에 영향·되돌리기·확인 방법을 다시 알린다.
> Analysis Worker·Redis·Redis API Gateway·AI Gateway·Dependency Reporter 는 어느 단계에서도 멈추거나 재시작하지 않는다.

## 1. 대상

브랜치 구성: `integration/freeze-1024`@6c044ffb(프로필 사진·N4b·가입 스냅숏·사진 상한) + `feat/live-ingest-worker`@16e1ab6b + `feat/live-ingest-web`@a261e780. 검증 결과는 [[20261025-release-verify|통합 검증 기록]](`20261025-release-verify.txt`)이다.

운영 DB 에 아직 없는 migration 8개(적용 순서 그대로):

| # | 파일 | 내용 | 기존 웹과 호환 |
|---|---|---|---|
| 1 | `20261024000200_profile_photos` | 사진 경로 열·`set_my_photo`·`set_member_photo`·사진 Storage 정책 | 열 추가·NOT NULL 완화 |
| 2 | `20261024000210_photo_rpc_defaults` | 사진 RPC 기본 인자 | 함수만 |
| 3 | `20261024000300_member_join_requests` | 가입 신청 표·`decide_join_request` 등 | 새 표·함수 |
| 4 | `20261024000400_team_member_edit` | 명부 편집·퇴사 상태·감사 action | 정책 갱신 |
| 5 | `20261024000410_find_unlinked_member_active` | 재직 직원만 연결 후보 | 함수만 |
| 6 | `20261025000100_join_request_snapshot_on_approve` | 승인은 신청 당시 스냅숏으로 등록(보안 중간 수정) | 함수만 |
| 7 | `20261025000110_profile_photo_quota` | 본인 폴더 3장 상한·쓰지 않는 본인 사진 삭제 정책 | 정책·함수·표 1개 |
| 8 | `20261025000200_procurement_live_metrics` | 대시보드 실수집 지표·live 범위 출처 확인 | 함수만 |

`decide_join_request` 는 3번이 만들고 6번이 다시 정의한다. 그 뒤 migration 은 이 함수를 건드리지 않는다. 기존 객체·데모 공고·분석 이력을 지우는 문장은 없다.

## 2. 권장 순서

DB 를 먼저 올린다. 새 웹 코드가 8번의 함수와 1~7번의 사진·가입 함수를 부르므로, 웹을 먼저 배포하면 대시보드 지표·사진·가입 화면이 실패한다. 8개 migration 은 추가·완화 변경이라 지금 운영 웹(main 4e84e084)과 같이 돌아도 된다.

1. 승인 ① 운영 Supabase migration 8개
2. 승인 ② 사진 버킷 `profile-photos` 생성(Storage 정책은 ①에 들어 있다)
3. 승인 ③ main 병합·push → Vercel 운영 배포
4. 승인 ⑥ Vercel env 추가(발표 기본 출처·수집 주기)
5. 승인 ⑤ 실제 data.go.kr 첫 호출(`--once`) → 결과 확인
6. 승인 ④ Ingest Worker 60분 일정 기동
7. 승인 ⑦ 기존 운영 컨테이너 재시작 — **이 계획에는 필요 없다.** 어느 단계도 기존 컨테이너를 재시작하지 않는다.

## 3. 승인 ① 운영 migration

실행 위치는 release 커밋을 깨끗하게 checkout 한 폴더다. 다른 세션의 미커밋 migration 이 `supabase/migrations` 에 있으면 같이 적용되므로 먼저 `git status` 가 비어 있는지 본다.

```bash
git -C <폴더> status --short                       # 비어 있어야 한다
NODE_EXTRA_CA_CERTS=$HOME/.supabase/prod-ca-2021.crt bash scripts/db-push.sh --check   # 읽기 전용 목록
```

- 확인: 목록이 위 표 8개와 정확히 같아야 한다. 다르면 멈춘다.
- 적용(승인 뒤): `NODE_EXTRA_CA_CERTS=$HOME/.supabase/prod-ca-2021.crt bash scripts/db-push.sh`
- 적용 뒤 확인: `NODE_EXTRA_CA_CERTS=$HOME/.supabase/prod-ca-2021.crt bash scripts/db-verify.sh`(RLS·security definer 허용 목록 검사).
- `pnpm db:push -- --check` 대신 `bash scripts/db-push.sh --check` 를 쓴다. 인자가 빠지면 실제로 적용된다.
- 되돌리기: migration 은 append-only 라 down 이 없다. 문제가 있으면 직전 정의를 복원하는 새 migration 을 만든다. 예: 7번이 정상 업로드를 막으면 `profile_photos_insert` 를 000200 의 정의로 다시 만들고 `profile_photos_delete_own` 을 지운다. 8번은 머리 주석의 drop 문장으로 되돌린다.

## 4. 승인 ② 사진 버킷

버킷은 SQL 이 아니라 운영자 CLI 가 만든다(service role, 사람이 로컬에서 직접 실행). Worker env 파일 경로를 `--env-file` 로 준다. 키 값을 출력하지 않는다.

```bash
node --env-file=<Worker env 절대경로> scripts/ops/ensure-storage-buckets.mjs            # 읽기 전용: ready / missing
node --env-file=<Worker env 절대경로> scripts/ops/ensure-storage-buckets.mjs --apply    # 없는 private 버킷만 만든다
```

- 기대: `bid-documents`·`bid-parsed` 는 `ready`, `profile-photos` 는 처음 `missing` → `--apply` 뒤 `created`(private, 2MB, jpeg·png·webp).
- 기존 버킷이 public 이거나 한도가 다르면 고치지 않고 `storage_bucket_public`·`storage_bucket_limits_mismatch` 로 멈춘다.
- 선택: `--apply --smoke` 는 `bid-documents`·`bid-parsed` 에 임시 객체를 올리고 받고 지운다. 지금 "업로드·다운로드 미검증" 상태를 확인하는 유일한 방법이다. 운영 Storage 에 쓰기이므로 따로 승인받는다.
- 되돌리기: 빈 버킷은 Supabase 대시보드에서 지운다. 사진이 올라간 뒤에는 지우지 않는다.

## 5. 승인 ③ main 병합·배포

```bash
git -C <main 폴더> status --short       # 미커밋 정본·다른 세션 작업이 있으면 멈춘다
git -C <main 폴더> merge --ff-only integration/release-1025
git -C <main 폴더> push origin main
```

- main 이 4e84e084 에서 움직이지 않았으면 fast-forward 다. 움직였으면 release 브랜치에 main 을 합쳐 전체 `pnpm verify` 를 다시 돌린 뒤 병합한다.
- push 하면 Vercel Git 연동이 운영 배포를 만든다(프로젝트 Production Branch 설정 확인 필요).
- 확인: Vercel 배포 Ready → `/dashboard`·`/dashboard?origin=demo`·`/bids?origin=demo`·공고 상세 1건·`/admin/ingestion` 을 1440·1280 폭으로 본다.
- 되돌리기: Vercel 대시보드에서 직전 배포로 Instant Rollback(또는 Promote). DB 는 그대로 둔다(1번 표의 호환 열).

## 6. 승인 ⑥ Vercel env

현재 Vercel web env 이름(10 배포 문서 기준): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `API_CURSOR_SECRET`, `SOL_RUN_MODE`, `SOL_DEPLOYMENT_ROLE`, `REDIS_API_BASE_URL`, `REDIS_API_TOKEN`. 이 값들은 바꾸거나 지우지 않는다.

| 이름 | 값 | 효과 |
|---|---|---|
| `SOL_DEFAULT_ORIGIN` | `demo` | 주소에 `?origin=` 이 없을 때 DEMO 데이터를 기본으로 보인다(발표용). 발표 뒤 `live` 로 바꾼다 |
| `G2B_INGEST_INTERVAL_MINUTES` | `60` | "다음 수집 예정" 카드를 켜고, 수집 지연 기준을 120분으로 맞춘다 |

- `SOL_RUN_MODE` 는 Ingest Worker 기동(승인 ④) 전까지 `mock` 그대로 둔다. `live` 로 바꾸면 관리자 수동 수집이 나라장터 실제 호출을 허용하고, 그 job 이 소비자 없는 `ingest` 큐에 쌓였다가 Worker 기동 때 바로 실행된다. 기동 뒤 `live` 로 바꾸면 상단 "실행 모드" 라벨이 회사 런타임과 같아진다.
- 절차: Settings → Environment Variables 화면에서 바꾸기 전 이름 목록을 기록한다. "Add New" 로 Production 에만 두 이름을 넣는다(.env 가져오기·덮어쓰기 기능을 쓰지 않는다). 바꾼 뒤 이름 목록을 다시 기록해 전보다 정확히 2개 많은지 본다. env 변경은 재배포(Redeploy) 뒤에 반영된다.
- 확인: `/dashboard` 상단에 DEMO 배지가 보이고, `/dashboard?origin=live` 에서는 배지가 없고 DEMO 공고가 세지지 않는다.
- 되돌리기: 두 이름을 지우고 재배포하면 지금 동작(실행 모드로 기본 출처 결정)으로 돌아간다.

## 7. 승인 ⑤·④ Ingest Worker

절차 정본은 [회사 실행서](../../../infra/company/README.md) §7 이다. 요약:

1. D0 읽기: `docker ps`·`git log`·`ingest_runs` SQL. 전체 Worker(`worker/main.ts`)가 같은 Redis 에서 돌고 있으면 멈춘다.
2. 회사 전용 파일 보존(§7.2): `analysis-only-main.ts`·`compose.analysis-only.company.yaml` 원본을 `cp -p` 로 백업 → `cmp` → 원본 삭제 → checkout → 정규화 비교 `SAME` 두 줄 → `diff -u`. `DIFF` 면 원본을 되돌리고 멈춘다. 실행 중 Analysis Worker 는 이미 빌드된 이미지라 영향이 없다.
3. D1 build: `INGEST_WORKER_TAG=$(git rev-parse --short=12 HEAD)`, 이미지 `sol-radar-ingest-worker:<SHA>` 만 생긴다. `sol-radar-ai-worker-worker:latest` 는 만들거나 덮지 않는다.
4. D2 `--status`: Job Scheduler 0개, waiting·active·delayed 0 이어야 한다(사용자가 본 값: 전부 0, Scheduler 0개). 아니면 멈춘다.
5. D3 `--check`: registry `/srv/sol-radar/infra/sources/registry.yaml`, 소스 4개, 간격 60분.
6. D4 **승인 ⑤** `--once --window-minutes 60`: 일정 없이 최근 60분 1회. 첫 실제 data.go.kr 호출이다.
7. D5 결과 확인: run `g2b:ONCE:…` 의 status·completeness·quota_used. 예상보다 크게 많으면 일정을 켜지 않는다.
8. D6 **승인 ④** `up -d --no-deps ingest-worker`: 일정을 처음 만들면 **즉시 1회** 돈다. 창은 D4 끝부터 지금까지(최대 120분). 그 뒤 60분마다.
9. D7 확인: 로그 `ingest 큐 Job Scheduler 1개`·`id=g2b-scheduled every=3600000`, `--status` Scheduler 1개, healthy.

## 8. 호출 예산과 첫 실행 추정

- 내부 예산: 목록·보조 3종이 카운터 하나(`quota:15129394:YYYYMMDD`, KST 날짜)를 같이 쓴다. 일 1000회, 900회부터 보조 조회를 멈추고(공고는 `SKIPPED_QUOTA` 로 저장), 1000회면 목록도 부르지 않는다(fail-closed). 요청마다 HTTP 전에 Lua 로 1회를 예약하므로 재시도·다음 쪽도 같이 센다.
- 제공처 한도: 2026-10-19 실측 응답의 `x-ratelimit-remaining` 이 operation 마다 999 에서 시작했다. operation 마다 하루 약 1000회로 보이며, 내부 카운터(전체 합 1000)가 더 보수적이다. data.go.kr 마이페이지의 승인 한도 화면은 아직 확인하지 않았다. registry 의 tps 30 은 대조할 실측이 없다.
- 공고량: 8일 3555건, 하루 평균 약 444건, 시간당 평균 약 19건(`docs/evidence/phase-0/external-deps-api-20261019.md`).
- 한 회차(60분 창): 목록 1~2회(쪽당 100건) + 신규·변경 공고마다 보조 최대 3회. 평균 약 1 + 19×3 ≈ 58회, 업무 시간 최대 약 1 + 60×3 ≈ 181회로 추정한다.
- D4 `--once 60` 추정: 약 60~190회. D6 즉시 회차는 D4 직후면 창이 짧아 수십 회 이하로 추정한다.
- 하루: 목록 약 24~48회 + 보조 약 1330회가 필요해 내부 예산을 넘는다. 매일 900회에서 보조가 멈추고, 그 뒤 공고는 면허·지역·첨부 정보 없이 저장된다(다음 수집 때 같은 공고가 다시 보이면 다시 채운다). 보조를 날짜 창 한 번(`inqryDiv=1`, `numOfRows=999`)으로 받으면 호출이 크게 줄지만 해커톤 뒤 과제다.

## 9. Storage·documents 큐

- 버킷 `bid-documents`·`bid-parsed`: 사용자 확인으로 private 버킷이 있다. 버킷 env 는 비어 있지만 코드 기본값이 같은 이름이다. 업로드·다운로드는 확인하지 않았다(§4 `--smoke` 가 확인 방법).
- documents 큐: 저장소 어디에도 소비자(`new Worker(DOCUMENTS_QUEUE)`)가 없다. Ingest 전용 Worker 는 documents job 을 넣지 않고 첨부 재확인 회차도 돌리지 않는다. 새 공고의 첨부 행은 `bid_documents.download_status = 'PENDING'` 으로만 남는다. 첨부 파이프라인은 동작하지 않는 상태로 보고한다.
- live 공고는 자동 분석되지 않는다. 분석은 사람이 요청할 때만 회사 Analysis Worker 가 한다.

## 10. 발표 DEMO 확인(읽기 전용)

- 사용자가 Supabase SQL 편집기에서 실행한다(쓰기 없음):

```sql
select b.notice_id, o.slug as org, s.status, s.score, s.recommendation, s.run_mode, s.ai_provider, s.created_at
from public.score_runs s
join public.bid_notices b on b.id = s.bid_id
join public.organizations o on o.id = s.org_id
where b.source = 'fixture' and b.notice_id = 'DEMO-2026-0002'
order by s.created_at desc limit 5;
```

- FX-02 는 사전 분석에서 일부러 뺀 공고다(`web/worker/demo-preanalyze.ts`). 발표 S4 장면에서 즉석 분석한다. 회사가 LIVE 라 즉석 분석은 실모델 결과(회사 시험 66·WATCH)가 나온다. 72 는 위 SQL 에 예전 MOCK 결과가 있을 때만 화면에 있다.
- 발표 주소: `/dashboard?origin=demo`, `/bids?origin=demo`. 발표 전 `demo:reset` 은 하지 않는다.

## 11. 되돌리기·장애 대응

| 상황 | 대응 | 하지 않는 것 |
|---|---|---|
| 웹 배포 뒤 화면 오류 | Vercel 직전 배포로 Instant Rollback. env 2개를 지우고 재배포 | DB 되돌리기 |
| migration 뒤 사진 업로드 거부 | 새 migration 으로 직전 정책 복원 | 기존 migration 수정 |
| Ingest 호출이 예상보다 많음 | `stop ingest-worker` → `--unschedule` → `--status` 로 Scheduler 0개(§7.10) | Redis `FLUSH*`, 큐 키 삭제 |
| 일 예산 소진 | 할 일 없음. 목록·보조 모두 멈추고 KST 자정에 키가 바뀐다 | 한도 우회 |
| Ingest Worker 반복 실패 | `restart: on-failure:3` 뒤 멈춘다. 로그 확인 후 `stop` | 전체 `restart`, `down`, `--remove-orphans` |
| Analysis Worker·Redis·AI Gateway 이상 | 이 계획과 무관하다. 그대로 두고 보고한다 | 재시작·재생성 |

## 12. 미완료·미검증

- 운영 적용 0건(migration·버킷·main·Vercel env·회사 Worker 모두 승인 대기).
- 운영 DB 의 FX-02 72 존재 여부(§10 SQL 결과 필요).
- data.go.kr 승인 한도 화면, tps 실측.
- 운영 Storage 업로드·다운로드(§4 `--smoke`).
- documents 소비자 없음(첨부 파이프라인 미동작).
- 회사 서버에서 ingest 이미지 빌드·`--check`·`--status` 실행(로컬 동일 Dockerfile 로만 확인).
- Vercel 의 Production Branch 자동 배포 설정.

## 관련 문서

- [[20261025-security-review|10-25 보안 검토]]
- [[2026-10-25-live-ingest-hourly-plan|10-25 실수집 계획]]
- [[10-DEPLOYMENT|10 배포]]
- [[PROGRESS|진행 상황]]
