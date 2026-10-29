---
title: "10-29 나라장터 보조 조회 예산을 기능별로 나누고 같은 revision 에 다시 채우기"
doc: "evidence-20261029-g2b-aux-budget"
status: active
tags: [sol-radar, evidence, ingestion, g2b, quota]
updated: 2026-10-29
---

# 10-29 나라장터 보조 조회 예산 기능별 분리·다시 채우기

사용자가 "공고를 4만 건쯤 불러온다는데 중복 공고도 호출하는 것 아니냐"고 물었다(2026-10-29). 4만이라는 수는 코드·DB 어디에서도 찾지 못했다. 나라장터 목록은 같은 공고를 다시 부르지 않았다. 대신 보조 조회(면허제한·참가가능지역·e발주 첨부)가 하루 예산 90%에서 멈춰, 공고가 보조 정보 없이 저장되고 있었다.

## 1. 증상 (운영 DB 읽기, 2026-10-29 10:2x KST)

나라장터 입찰공고의 최신 revision 중 `normalized.auxLookup.status` 기준이다.

| 보조 조회 | 마감 전 | 마감 지남 |
|---|---|---|
| `OK` | 754 | 92 |
| `SKIPPED_QUOTA`(예산 90%로 건너뜀) | 1,003 | 51 |
| `FAILED`(일부 실패) | 2 | 0 |
| 없음(보조 조회 전·취소) | 117 | 29 |

- 건너뜀은 매일 오후 회차에 몰렸다. 10-28 기준 12:00 회차가 호출 684회를 쓰고, 15:00 121건·18:00 298건·21:00 73건을 건너뛰었다. 10-26·10-27 오후도 같았다.
- 건너뛴 1,003건 중 관련성 `RELEVANT` 는 0건이다(`CANDIDATE` 105, `UNCLASSIFIED` 898). `OK` 754건에는 `RELEVANT` 59건이 있다. 관련성 분류가 보조 정보(면허)를 쓰기 때문으로 보인다.
- K-water 는 회차마다 두 달치(약 325행)를 다시 받는다. 10-28 받은 1,302행 중 1,300행이 중복이었고 호출은 회차당 4회다. 중복은 저장 때 걸러져 revision 이 늘지 않는다.

## 2. 원인

- 호출 예산 카운터가 서비스 하나(`quota:15129394:YYYYMMDD`)였다. 목록과 보조 3종을 합쳐 하루 1,000회로 셌고, 보조 조회는 900회(90%)에서 멈췄다.
- 사용자 확인: 공공데이터포털 한도는 기능(오퍼레이션)마다 따로 1,000회다. 실제 여유가 있는데 코드가 4분의 1만 쓰고 있었다.
- 같은 공고를 다시 받으면 보조를 다시 불러 채우는 경로가 있었다. 하지만 나라장터 창은 겹치지 않아 건너뛴 공고를 다시 받는 일이 없었다. 다시 채워도 새 revision(`CHANGED`)이 생겨 변경 이력·이벤트가 늘고, revision 단위 분석·결정이 화면에서 빠지는 문제가 있었다.

## 3. 수정 (main `cbb3831e`, 사용자 결정 "1번"·"기능마다 따로 1,000"·"이 계획대로 진행")

사용자 조건: "같은 공고면 다시 호출은 하는데 DB에는 저장 안 되도록 해. 저장되더라도 화면에 중복해서 나오면 절대 안돼."

- **기능별 예산**: 예약·판정 키를 오퍼레이션마다 나눴다(`web/server/ingestion/quota.ts` `scopedServiceId`). 목록은 이전 키 그대로, 보조는 `quota:15129394:<registryKey>:YYYYMMDD` 다. 공고 앞에서 보조 3종 중 하나라도 90%면 그 공고의 보조 조회를 건너뛴다.
- **결과코드 22**: 보조 한 오퍼레이션의 22는 그 오퍼레이션 카운터만 소진시킨다. 목록·다른 보조는 계속 부르고 run 은 성공으로 끝난다. run 을 멈추는 것은 예산 저장소 장애뿐이다.
- **같은 revision 에 다시 채우기**: 새 revision·outbox 이벤트를 만들지 않는다(`ingestion.repo.ts` `refillAux`). 그 revision 의 구조화 자격은 지우고 다시 쓴다. 첨부는 없던 원본 url 만 `PENDING` 으로 더한다. 같은 revision id 로 다시 투영한 뒤, 마지막에 `normalized`·`checksum`(과 `bid_notices.content_hash`)을 바꾼다. 중간에 실패하면 그 revision 이 그대로 "보조 빠짐"이라 다시 돌려 같은 결과를 낸다.
- **다시 채우기 명령**: ingest 전용 worker 에 `--refill-aux --limit N`(1~1,000)을 더했다. 마감 전 최신 revision 만 최근 수집 순으로 채우고, 보조 오퍼레이션 예산 90%에서 멈춘다. 정기 수집과 같은 예산을 쓰므로 그날 마지막 회차(21시) 뒤에 돌린다.

## 4. 검증

- 새 시험 `web/server/ingestion/g2b-aux-budget.test.ts` 5건: 오퍼레이션별 카운터, 22가 그 오퍼레이션만 막음, 같은 공고 재수신 때 새 revision·이벤트 없이 채움(첨부·자격 행 중복 없음, 채운 뒤에는 보조를 다시 부르지 않음), 명령이 마감 지난 공고를 건너뜀, 90%에서 멈춤.
- 공유 예산을 전제로 한 기존 시험 2개를 오퍼레이션별로 고쳤다(`quota-ingestion.test.ts` 보조 재시도, `worker/ingest-schedule-budget.test.ts` 수동 예산 경계 표). 명령 인자 시험을 `worker/ingest-only-main.test.ts` 에 더했다.
- 결함 넣기 4건을 시험이 모두 잡았다: 예약 키를 공유로 되돌리기(3건 실패), 22에서 남은 오퍼레이션 멈추기(1건), 다시 채우기를 새 revision 으로 되돌리기(1건), 마감 검사 빼기(1건).
- `pnpm verify:changed` 통과(web 103파일·904 시험). 커밋 게이트·pre-push 통과. Vercel `success`.

## 5. 회사 반영 (2026-10-29, `/data/www/ai_workspace` 안에서만)

| 시각(KST) | 단계 | 결과 |
|---|---|---|
| 10:48 | main `cbb3831e` push | pre-push 통과 |
| 10:49 | 회사 HEAD `a2e4a35b` → `cbb3831e` fast-forward, 이미지 `sol-radar-ingest-worker:cbb3831e86da` | 들어온 변경은 `web/server/ingestion` 12파일·`web/worker` 4파일·문서뿐이다(infra·패키지·fixtures·migrations·services 변경 0, 돌고 있는 컨테이너의 바인드 마운트 아래 변경 0). 재생성 전 `--status` waiting·active·prioritized 0. `--check`: LH·KEPCO·K-water `READY`, 3종 `DISABLED` |
| 10:49:08 | ingest Worker 재생성(창 offset 109분) | healthy·restarts 0, Job Scheduler 4개. 기업마당·Documents Worker 그대로(`db442be15481`) |
| 10:49:51 | `--refill-aux --limit 1`(사용자 결정 "오늘 1건 시험 + 밤 일괄") | `checked=1 refilled=1 incomplete=0 closed=0 conflicted=0 calls=3`. 대상 `R26BK01795307`(첨부 조회 타임아웃으로 `FAILED`) |

1건 시험 뒤 운영 DB(읽기): revision 1 그대로(revision 수 1), `auxLookup` `OK`, checksum 이 바뀌었고 `bid_notices.content_hash` 와 같다. 첨부 4행(원본 url 4개, 중복 없음), 공고 이벤트 1행, outbox 1행 그대로다.

되돌리기: `git reset --keep a2e4a35b && INGEST_WORKER_TAG=a2e4a35b6ffb docker compose -f infra/compose.ingest-only.company.yaml up -d --no-deps --force-recreate ingest-worker`. 오퍼레이션별 Redis 키는 TTL 2일로 사라진다.

## 6. 남은 것

- 밀린 1,005건 채우기: 하루 새 공고가 약 800건이라 기능별 1,000회 중 다시 채우기 몫은 하루 100~200건이다. 다 채우는 데 5~10일 걸린다. 오늘 21시 회차 뒤 `--limit 300` 1회(사용자 결정), 이후 날짜는 다시 확인받는다. 더 빨리 채우려면 공공데이터포털 트래픽 한도를 늘려야 한다.
- 오늘(10-29) 반영 전에 쓴 보조 호출(00~09시 약 38건/오퍼레이션)은 새 키에 없다. 오늘만 카운터가 그만큼 적게 센다. 실제 한도에 닿으면 22를 받아 그 오퍼레이션이 멈춘다.
- 다시 채운 공고의 첨부는 Documents Worker 복구기가 `PENDING` 행을 보고 받는다. 같은 revision 의 이전 documents job 이 BullMQ 에 남아 있으면(완료 뒤 24시간) 그 뒤에 받는다.
- 다시 채운 공고의 분석·결정은 그대로다(다시 분석하지 않는다).

## 관련 문서

- [[evidence/ingestion/20261028-kepco-contract/no-data-404|KEPCO 공고 없는 날 404]]
- [[evidence/company-rollout/20261028/sources-rollout|회사 수집 서비스 반영 기록]]
- [[PROGRESS|진행 상황]]
