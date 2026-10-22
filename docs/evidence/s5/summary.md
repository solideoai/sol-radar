---
title: "S5 변경 이력 격리 E2E 증거"
status: final
tags:
  - sol-radar
  - evidence
updated: 2026-10-21
---

# S5 변경 이력 격리 E2E (Task 5a)

계획 [[2026-10-21-s5-change-detection-plan|S5 구현 계획]] Task 5 의 앞쪽(화면)이다. 알림 벨 단계(Task 5b)는 BID_CHANGED 알림(Task 4) 뒤에 같은 spec 에 덧붙인다.

## 기준과 명령

- 기준 코드: `feat/s5-change-detection` `7876bfe`(main `09d4422` 병합 뒤, `pnpm verify` exit 0). 시험 커밋 `6005a80`.
- 명령: `pnpm -C web test:e2e:s5`(설정 `web/playwright.s5.config.ts`, globalSetup `work-setup.ts`, workers 1, retries 0). 무거운 명령은 공용 슬롯 + `timeout -k 30 2400` 으로 감쌌다.
- 결과: 두 번 실행, 두 번 모두 19개 통과(2.0분, 5.3분). 수집 프로젝트 `s5-ingest` 3개, `s5-1440` 8개, `s5-1280` 8개. 실패·불안정·did not run 0.
- globalSetup 끝 줄: `seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true`, `preanalyze: targets=18 completed=18 partial=0 failed=0`.

## 시험이 확인한 것

1. **LIVE 배치 수집(s5-ingest)** — admin@soltech.invalid 가 `/admin/ingestion` 에서 데모 데이터 · `LIVE · 변경분 투입` 을 보낸다. 202 `{source:"fixture", batch:"live", trigger:"MANUAL", status:"RUNNING"}`. worker 가 끝낸 run 은 `SUCCEEDED`, summary `{created:0, changed:3, cancelled:1, skippedDuplicate:1, quarantined:0, retried:0}`(19 S5 와 같다).
2. **API(s5-ingest)** — `GET /api/v1/bids/{FX-07}/revisions` 200, `[2,1]`, 차수 `["02","01"]`, r2 `changedFields` `amendmentNo·budgetKrw·content·status`. `/revisions/2` 200(예산 `2160000000`, 본문에 Kubernetes), `/revisions/1` 예산 `1800000000`. `/revisions/0`·`/9` 404 `NOT_FOUND` `{resource:"revision"}`.
3. **멱등(s5-ingest)** — 같은 수집을 다시 보내면 `skippedDuplicate 5`, 나머지 0. FX-07 revision 목록(번호·checksum·수집 시각) 그대로.
4. **FX-07 진입·비교(두 폭)** — 상세 단계 이력의 링크는 `r2 변경 이력 보기` 하나. 머리말 h1 `변경 이력`, `r1 → r2 · 차수 01 → 02`. `바뀐 항목 3개`, 예산 `18억`(취소선) → `21.6억`(밑줄), 공고 상태 `공고 → 정정 공고`. 본문 diff 의 `ins` 에 Kubernetes, 낭독 글자 `추가됨`·`추가 끝`. 레일 `?rev=N` 링크, `aria-current="page"` 하나. 가로 넘침 0, 콘솔 오류 0.
5. **첫 화면(두 폭, 1280×800 포함)** — 스크롤 없이 예산 줄·본문 머리·Kubernetes `ins` 가 보인다.
6. **FX-01(두 폭)** — 상세 `r1` 은 링크 아님. 변경 이력은 `처음 수집한 공고입니다. 아직 바뀐 내용이 없습니다.`, 표·범례 없음.
7. **FX-08(두 폭)** — 취소 띠 `이 공고는 취소되었습니다. 기존 분석·결정 기록은 보존됩니다`, 공고 상태 `공고 → 취소됨`.
8. **`?rev=1`(두 폭)** — r1 선택, 첫 revision 빈 상태와 `최신 변경 보기` 링크.
9. **`?rev=abc`·`0`·`9`(두 폭)** — 404 화면(`변경 이력을 찾을 수 없습니다`, `공고 목록으로`). HTTP 상태는 200 이다. `loading.tsx` 가 스트리밍을 먼저 시작하는 Next.js 동작으로, 상세 화면 `/bids/[id]` 와 같다(판정: 그대로 둔다). API 는 404 다.

## 스크린샷

| 파일 | 내용 |
|---|---|
| `20261021-s5-bid-detail-revision-link-{1440,1280}.png` | FX-07 상세. 단계 이력 `r2` 링크, 예산 2,160,000,000원 · revision 2. 분석은 r1 때 것(WATCH 68) 그대로(수집은 재분석을 넣지 않는다) |
| `20261021-s5-bid-revisions-fx07-loaded-{1440,1280}.png` | FX-07 비교 첫 화면 |
| `20261021-s5-bid-revisions-fx08-loaded-{1440,1280}.png` | FX-08 취소 |
| `20261021-s5-bid-revisions-fx01-empty-{1440,1280}.png` | FX-01 revision 하나뿐 |

본문 diff 의 토큰이 공백 기준이라 `Spark` → `Spark,` 가 `SparkSpark,` 처럼 붙어 보인다. 다음 라운드(Task 4·5b)에서 구두점을 따로 나누고 스크린샷을 다시 찍는다.

## 스택(값 제외)

- 격리 Supabase `sol-radar-93-s5`: API 59741, DB 59742, shadow 59740, 메일 59744·59745, site_url `http://localhost:59760`. 마이그레이션 30개.
- Compose `-p sol-radar-93-s5`: redis 59751, minio 59752, ai-gateway 59754, worker. `SOL_RUN_MODE=mock`, `AI_PROVIDER=mock`, `AI_HOSTED_APPROVED=false`, 공공 API 키 비움. worker 의 Supabase 주소가 격리 DB(`host.docker.internal:59741`)인지 `docker inspect` 로 먼저 확인했다.
- 웹: 격리 주소·anon 키로 build 뒤 `pnpm start :59760`. 웹 env 에 service role 없음.
- 키는 `supabase status -o env --workdir` 출력을 자식 env 로만 넘겼다. compose 용 파일 `infra/.env.s5e2e` 하나는 출력하지 않았고 끝에 지웠다.
- 54321·클라우드·다른 세션의 compose 는 쓰지 않았다. 공공 API·실행 모드 live 쓰지 않음.

## 철거

- `down -v`(컨테이너 4·볼륨 3·네트워크), 빌드 이미지 2개 삭제, `supabase stop --no-backup`.
- `docker ps -a`·`docker volume ls`·`docker images` 에 `93-s5` 0건.
- 비밀 파일 삭제: `infra/.env.s5e2e`, scratchpad `supabase-start.log`, 이번 실행이 만든 `web/e2e-auth/.auth/work-*.json` 5개.
- `grep -rn "eyJ" docs/evidence/s5` 0건.
- `web/.next` 는 격리 주소로 빌드돼 있다(깃 제외). 다른 E2E 전에 다시 빌드한다.

## 관련 문서

- [[2026-10-21-s5-change-detection-plan|S5 구현 계획]]
- [[2026-10-21-s5-revisions-ui-spec|S5 변경 이력 화면 스펙]]
- [[19-DEMO-SCENARIO|19 데모 시나리오]] S5
