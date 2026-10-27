---
title: "10-27 서비스별 수집 격리 운영 적용 결과와 조달청 호출 사용량 점검"
doc: "evidence-20261027-ingest-ops-apply"
status: done
tags: [sol-radar, evidence, ingestion, ops, quota]
updated: 2026-10-27
---

# 10-27 서비스별 수집 격리 운영 적용 결과와 조달청 호출 사용량 점검

[[../../../plans/2026-10-27-ingest-source-isolation-deploy|10-27 배포 실행서]]의 운영 적용 결과와 조달청 입찰공고(15129394) 하루 호출 사용량 점검 기록이다. 근거를 셋으로 나눠 적는다.

- **실측**: 이 세션이 직접 읽은 값. GitHub 커밋 상태, 운영 `/health/ready` 응답, 코드.
- **사용자 보고**: 회사 서버에서 사용자가 확인해 알려 준 값. 이 세션은 회사 서버에 접속하지 않았다.
- **DB 실측**: 사용자가 `/mcp` 로 다시 로그인한 뒤 운영 Supabase(`brtysdocxemrqhdezzqg`)에서 [SQL](g2b-quota-readonly.sql) 의 `SELECT` 만 돌린 값(10-27 13:25 KST 기준, §2.2).
- **추정·미측정**: 계산한 값과 아직 읽지 못한 값. 회사 Redis 카운터는 이 세션이 읽지 않았다(§3.1 명령).

이 기록을 만들면서 운영 DB·Redis·회사 서버·공공 API 를 바꾸거나 부르지 않았다.

## 1. 운영 적용 결과

| # | 항목 | 결과 | 근거 |
|---|---|---|---|
| 1 | Vercel 배포 | main `43e4e024` → Production `dpl_HgpVjqZVF1Cui96gkEqKpTmuYkpM`, GitHub 커밋 상태 Vercel `success` 2026-10-27 10:36 KST. 되돌리기 대상 `dpl_8YGJA3ULFEG4U2dVnahQNjNhkDEd` | 실측 |
| 1-1 | 그 뒤 main | 다른 세션이 main `8cfaac31`(첨부 처리·가입 동의)을 push 했고 Vercel `success` 12:37 KST(`dpl_sFFBzEycU6UdsDXmhDxZuy535eNR`). 지금 Production 은 이 배포로 보인다. 이 배포의 화면은 이 세션이 확인하지 않았다 | 실측(커밋 상태) |
| 1-2 | 운영 상태 | 12:55 KST `GET /health/ready` 200 `{"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok","ai":"local"}}`, 로그인 없이 `GET /api/v1/admin/ingestion/manual-gate` 401 | 실측 |
| 2 | 회사 redis-api 갱신·healthcheck | 최신 이미지, healthy | 사용자 보고 |
| 3 | ingest 전용 Worker 갱신·healthcheck | 최신 이미지, healthy. 실행 중 이미지 태그 값은 이 세션이 보지 못했다 | 사용자 보고 |
| 4 | 서비스별 격리 적용 | 외부 6종(K-water 2·LH 2·조달요청·KEPCO) 모두 `NOT_CALLABLE(DISABLED)` | 사용자 보고 |
| 5 | 정기 일정 | Job Scheduler 는 `g2b-scheduled` 1개(`0 */3 * * *`, `Asia/Seoul`, KST 00·03·…·21시) | 사용자 보고 |
| 6 | 10-27 12:00 회차 | runId `91dbf7ab-8a0b-41d2-bbb2-4156fde2187d`, `SUCCEEDED`, 생성 195·변경 2·취소 18, `quota_used` 585 | 사용자 보고 |
| 7 | 추가 기관 계획 | 아래 §4 | 계획 |

## 2. 조달청 입찰공고(15129394) 호출 사용량

### 2.1 한도 구조 — 코드 실측

| 규칙 | 값 | 위치 |
|---|---|---|
| 하루 카운터 | Redis `quota:15129394:<KST YYYYMMDD>`. 목록·보조 조회 3종·재시도를 한 카운터로 센다. 호출마다 Lua 로 원자 예약 | `web/server/ingestion/quota.ts` `quotaKey`, `quota-store.ts` |
| 정기 수집 | 보조 조회는 900(90%)에서 멈추고 공고에 `auxLookup.status = SKIPPED_QUOTA` 를 남긴다. 목록은 1000 까지 | `quota.ts` `QUOTA_AUXILIARY_STOP_RATIO = 0.9` |
| 수동 수집 | 같은 카운터, 상한 800·보조 조회 720 | `quota-store.ts` |
| 1000 도달 | 그 회차는 `FAILED`(`QUOTA_*` 오류). 다음 회차가 같은 창·cursor 를 다시 쓰고, KST 자정에 새 카운터로 잇는다. 창 상한 24시간 안이면 빠지는 구간이 없다 | `ingestion.service.ts`, `worker/ingest-queue.ts` `g2bWindowOf` |
| 목록 | 쪽당 100행(`G2B_DEFAULT_ROWS`). 정보화사업 필터는 응답을 받은 뒤 걸러서, DB 의 `fetched_count` 로는 목록 쪽 수를 알 수 없다. `totalCount` 도 저장하지 않는다 | `g2b.model.ts`, `official-api-connector.ts` |
| 보조 조회 | 새 공고·바뀐 공고 1건마다 3종(면허 제한·참가 지역·e발주 첨부)을 최소 1회씩(999행). 쪽이 더 있으면 종류당 최대 5쪽. 처음부터 취소로 들어온 공고와 취소 공고는 부르지 않는다 | `g2b-aux.ts` `G2B_AUX_MAX_PAGES = 5`, `revision.ts` |
| 다른 서비스 | LH 등 외부 서비스는 서비스 ID 별 카운터라 조달청 카운터를 쓰지 않는다(시험으로 확인, [LH 증거](../20261027-lh-bid-notice/summary.md)) | `ingest-only-main.test.ts` |

### 2.2 요청 항목별 상태

| # | 항목 | 상태 | 값 |
|---|---|---|---|
| 1 | 오늘 KST Redis 카운터 | **미측정** | 회사 서버에서 §3.1 명령으로 읽는다. DB 합계(658)와 같거나 조금 클 것으로 본다 |
| 2 | 오늘 `ingest_runs.quota_used` 합계 | **DB 실측 658** | 00시 43 · 03시 1 · 06시 1 · 09시 28 · 12시 585. 900 까지 242, 1000 까지 342 남음 |
| 3 | 목록·보조 호출 비율 | **DB 실측 + 계산** | 보조 조회는 `aux = OK` 공고당 3회(실패·재시도 0건): 오늘 보조 651(14+9+194 공고 × 3) · 목록 7(회차당 1~3쪽). 보조가 98.9% |
| 4 | `SKIPPED_QUOTA` 건수 | **DB 실측** | 지금까지 250건(revision 254), 전부 10-26 18·21시 회차. 오늘은 0건. 최신 revision 기준 243건이 아직 `SKIPPED_QUOTA`(그중 마감 전 210건) |
| 5 | 면허·지역·첨부 누락 | **DB 실측** | 아래 §2.5 |
| 6 | 1000 한도 보호 | **코드 실측** | §2.1. 목록·보조 조회·재시도 모두 호출 직전에 Redis 예약을 거쳐 1000 에서 거절된다. 900 검사는 공고 앞에서만 해서 정기 회차의 보조 조회가 900 을 몇 회(보통 3회, 쪽이 더 있으면 더) 넘을 수 있다 |
| 7 | 15시 이후 목록 수집 | **추정** | 아래 §2.3 |
| 8 | 창 빈 구간 | **DB 실측 0** | 10-26 13:51 첫 회차부터 12:00 회차까지 창이 끊김 없이 이어진다. `windowCap` 0건, `PARTIAL`·`FAILED` 0건. 10-26 15시 회차 기록은 없지만 18시 회차가 13:51 부터 받아 빈 구간은 아니다. 오류는 날짜 순서 경고 2건뿐 |
| 9 | 보조 정보 누락 공고 보완 | **계획** | §2.4 |

### 2.3 15시 이후 — DB 실측 바탕 추정

12:00 회차 뒤 DB 합계 658. 900 까지 보조 조회 약 80건(242 ÷ 3)이 남았다.

- 15시 회차(창 12~15시): 어제 같은 시간대(10-26 13:51~18:00 창)는 정보화 공고 414건이었다. 오늘도 80건을 넘으면 15시 회차 안에서 900 에 닿고, 그 뒤 공고는 `SKIPPED_QUOTA` 다.
- 18·21시 회차: 새 공고는 모두 `SKIPPED_QUOTA` 일 가능성이 높다(어제 21시 회차와 같은 모양: 새 공고 80건, 호출 1회).
- 목록: 회차당 1~5쪽(어제 18시 5쪽이 최대)이라 1000 까지 342 회 여유로 계속 받는다. 공고 목록 수집은 멈추지 않는다.

결론: 목록 수집은 오늘 남은 회차에도 계속된다. 오늘 오후·저녁 공고의 면허·지역·e발주 첨부 정보는 어제처럼 대부분 비게 된다. 어제는 하루 904회(13:51 · 18 · 21시)로 보조 조회가 18시 회차 중간에 멈췄다.

### 2.5 면허·지역·첨부 정보 현황 — DB 실측(최신 revision, DEMO 제외 787건)

| 공고 상태 | 보조 조회 | 건수 | 마감 전 | 면허 있음 | 지역 있음 | e발주 첨부 | 첨부 1개 이상 |
|---|---|---|---|---|---|---|---|
| OPEN | OK | 471 | 390 | 310 | 133 | 97 | 441 |
| OPEN | SKIPPED_QUOTA | 228 | 200 | 0 | 0 | 0 | 224 |
| AMENDED | OK | 14 | 11 | 10 | 2 | 4 | 14 |
| AMENDED | SKIPPED_QUOTA | 15 | 10 | 0 | 0 | 0 | 14 |
| CANCELLED | 없음(부르지 않음) | 59 | 40 | 0 | 0 | 0 | 5 |

- 보조 조회를 한 485건 중 면허 제한·허용 업종이 있는 공고 66%(320), 참가 지역 28%(135), e발주 첨부 21%(101). 나머지는 원래 그 정보가 없는 공고다.
- `SKIPPED_QUOTA` 243건은 면허·지역·e발주 첨부를 **모른다**(0 은 "없음"이 아니라 "조회 안 함"). 마감 전 210건이 보완 대상이다. 목록 응답의 첨부(규격서 등)는 238건에 있다.
- 다시 채우기는 같은 공고가 목록에 다시 나와야 일어나서, 250건 중 7건만 `SKIPPED_QUOTA` 를 벗어났다(다시 채워졌거나 취소됨).

### 2.4 보조 정보 누락 공고 보완 — 제안(구현 안 함)

지금 코드는 `FAILED`·`SKIPPED_QUOTA` 공고를 **같은 공고가 다음 목록 창에 다시 나올 때만** 다시 채운다(`ingestion.service.ts` "다시 채우기"). 3시간 창은 겹치지 않으므로 대부분 다시 채워지지 않는다. 한도를 올리지 않고 할 수 있는 개선 후보다.

1. **자정 직후 보완 회차**: 새 카운터가 열린 00시 회차 끝에 전날 `SKIPPED_QUOTA`·`FAILED` 이면서 마감 전인 공고만 마감 가까운 순으로 다시 채운다. 하루 상한을 넘지 않게 보완 몫(예: 200)을 따로 둔다.
2. **보조 조회 순서**: 900 에 가까울 때 마감이 가까운 공고부터 부른다.
3. **사용량 기록**: 회차 `summary` 에 목록 호출·보조 호출을 따로 남긴다. 지금은 비율을 추정으로만 낼 수 있다.
4. **바뀐 공고**: 목록 필드 중 마감·금액·첨부와 무관한 변경이면 보조 조회를 건너뛸지 검토한다(변경 감지 규칙과 함께 결정).

어느 것도 이번 브랜치에 넣지 않았다. 1번이 효과가 가장 크다. 넣으려면 별도 스펙과 승인이 필요하다.

## 3. 회사 서버에서 읽는 명령 — 읽기 전용

비밀값을 출력하지 않는다. 공공 API 를 부르지 않는다. 컨테이너를 재시작하지 않는다.

### 3.1 오늘 Redis 카운터

```bash
C=$(docker ps -q --filter label=com.docker.compose.project=sol-radar-ingest --filter label=com.docker.compose.service=ingest-worker)
D=$(TZ=Asia/Seoul date +%Y%m%d)
docker exec "$C" node -e '
const Redis = require("ioredis");
const r = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
r.mget(process.argv[1], process.argv[2])
  .then((v) => { console.log(JSON.stringify({ g2b_15129394: Number(v[0] ?? 0), lh_15159012: Number(v[1] ?? 0) })); r.disconnect(); })
  .catch((e) => { console.error(e.name); r.disconnect(); process.exit(1); });
' "quota:15129394:$D" "quota:15159012:$D"
```

- 출력은 숫자 두 개뿐이다. 접속 주소·비밀번호는 출력하지 않는다(오류도 이름만).
- 기대: `lh_15159012` 는 0(LH 미활성).

### 3.2 운영 DB

`/mcp` 로 Supabase 를 다시 로그인한 뒤 [g2b-quota-readonly.sql](g2b-quota-readonly.sql) 을 차례로 돌린다. 모두 `SELECT` 다. 로컬 PGlite(마이그레이션 전부 적용)에서 8문장 모두 오류 없이 실행되는 것을 확인했다(빈 표라 결과 0행).

## 4. 추가 기관 계획

| 순서 | 서비스 | 지금 막힌 이유(코드 기준) | 활성화 전 필요 |
|---|---|---|---|
| 1 | LH 입찰공고 15159012 | `enabled: false`·`NOT_VERIFIED`·`NOT_REQUESTED`. 정규화·필드 매핑은 이번 브랜치에서 구현(합성 응답 시험만) | 활용신청 승인 확인 → 실응답 1~3회 녹음 → 매핑 확정 → registry 갱신 → Worker 재기동. [[../../../plans/2026-10-27-lh-bid-notice-activation|LH 활성화 계획]] |
| 2 | K-water 입찰공고 15101635 | `fieldMapping` 비어 있음(`NO_FIELD_MAPPING`). 기본 조회 방식 `servcList` 는 녹음 검증 목록에 없다(검증된 것은 `dmscptList`). 정규화 함수가 없어 켜도 모든 행을 `PROVIDER_STATUS_NOT_VERIFIED` 로 격리한다 | 활용신청·실응답 녹음, 조회 방식 결정, LH 와 같은 방식의 정규화·매핑 |
| 3 | KEPCO 15148223 | `quota.daily: null` → `QUOTA_UNVERIFIED`. 자체 포털이라 쪽 번호가 없고 응답 범위 미검증(항상 `PARTIAL`) | 하루 한도 확인, 범위 검증 방법 결정 |
| 뒤 | LH 사전규격 15159011·K-water 발주계획 15102588·조달요청 15129468 | 매핑 없음·미승인 | 입찰공고 쪽이 안정된 뒤 |

한 번에 한 기관만 켠다. 켠 뒤 최소 하루(8회차)는 나라장터 `quota_used`·`SUCCEEDED` 가 그대로인지 본다.

## 관련 문서

- [[../../../plans/2026-10-27-ingest-source-isolation-deploy|10-27 배포 실행서]]
- [[../../../plans/2026-10-27-lh-bid-notice-activation|LH 입찰공고 활성화 계획]]
- [격리 로컬 확인](../20261027-source-isolation/summary.md)
- [[../../../PROGRESS|진행 상황]]
