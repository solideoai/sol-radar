---
title: 발주 현황 증거 2026-10-28
status: done
tags: [sol-radar, evidence, market]
updated: 2026-10-28
---

# 발주 현황 증거 2026-10-28

스펙 `polaris/specs/done/2026-10-28-gaps-market-calendar.md` §6 의 `/market` 증거다.

| 파일 | 내용 |
|---|---|
| `market-overview-1440.png`·`market-overview-1280.png` | 1단계(B1) 화면. 브라우저 시험의 mock 값 |
| `market-b2-1440.png`·`market-b2-1280.png` | 2단계(B2) 판정 묶음 겹쳐 보기. 브라우저 시험의 mock 값 |

## B2 판정 묶음 겹쳐 보기

2026-10-28, sol-radar-ac. 발표 장면에는 넣지 않는다(사용자 결정).

### 동작

- 상위 발주기관 행과 분야 행의 막대 아래에 `/gaps` 판정 묶음 분포를 한 줄로 겹친다. 묶음은 참가 가능(API 기준)·회사 기록 없음·미보유·사람 확인 필요이고, `/gaps` 묶음 띠와 같은 아이콘을 묶음 이름·건수와 함께 쓴다(색만으로 나누지 않음). 0건 묶음은 빼고, 마감 전 공고가 없는 행은 "마감 전 공고 없음"이라 적는다.
- 집계와 같은 거르기(기간·관련성·취소 제외) 뒤 마감 전 공고(OPEN·AMENDED, 마감이 남은 것)만 센다. 마감이 지난 공고는 묶음에 넣지 않는다. 행 위 한 줄에 범위("기간 내 공고 중 지금 마감이 남은 것(마감 전 공고) 기준", 1단계 "마감 전 공고" 카드와 같은 말)와 `/gaps` 는 게시 기간과 무관하게 마감 전 공고 전부를 본다는 것, 대조한 회사 프로필 revision, 판정을 찾지 못한 건수, `/gaps` 링크를 적는다.
- 공고는 bidId(사업기회 대표 공고 id = `/gaps` 공고 id)로 맞추고, 기관 키(앞뒤 빈칸 다듬은 이름)·분야 키(중복 없는 카테고리, 없으면 NONE)는 1단계 집계와 같은 함수를 쓴다.
- 회사 프로필이 없으면(NO_PROFILE) 겹쳐 보기만 빼고 1단계 화면은 그대로다. 판정 읽기가 실패하면 안내 한 줄만 보이고 1단계 집계는 그린다. 로그 `market_gap_overlay_failed` 에 오류의 code·message·details·hint 를 남긴다(PostgREST 오류 일반 객체도 풀고, Error 로 감싼 경우 cause 도 푼다).
- 새 표·마이그레이션·토큰은 없다. 공고 읽기와 판정 읽기는 `Promise.all` 로 함께 시작한다. 둘 다 anon 키 + 세션(RLS)이다.

### 코드

| 파일 | 바뀐 것 |
|---|---|
| `web/server/gaps/gaps.model.ts`·`gaps.service.ts`·`index.ts` | 순수 함수 `bucketByBid`, `getGapBuckets(orgId, now)`(프로필 먼저 읽고 없으면 공고를 읽지 않음), 타입 `GapBucketsView`. `/gaps` 화면 계약은 그대로 |
| `web/server/gaps/gaps.repo.ts` | PostgREST 오류를 `new Error("자격 갭 레이더 공고를 읽지 못했습니다", { cause })` 로 감싸 던진다(market.repo 와 같은 방식) |
| `web/server/market/market.model.ts`·`market.service.ts`·`index.ts` | `MarketGapOverlay`·`MarketGapCounts`, `MarketOverview = MarketAggregate & { gapOverlay }`, 순수 함수 `overlayGaps`, 집계와 겹쳐 보기가 함께 쓰는 거르기(`selectRows`·`agencyOf`·`categoriesOf`), 실패 로그용 `errorFields`. `RELEVANT_STATES` 는 공유하지 않고 market·gaps 두 모델에 서로를 가리키는 주석을 둔다 |
| `web/app/(app)/(work)/market/market-view.tsx`·`page.tsx` | 행 아래 분포 줄·안내 한 줄. 묶음 이름과 `/gaps` 주소는 페이지가 서버 배럴에서 내린다 |

### 시험

| 시험 | 결과 |
|---|---|
| `pnpm exec vitest run server/market server/gaps` | 32 passed. 새 시험: 마감 지난 공고·CLOSED·마감 없음·취소·기간 밖·관련성 밖 제외와 기관 키 다듬기(`overlayGaps`), NO_PROFILE·FAILED, 판정 읽기 실패 때 1단계 집계 유지·두 읽기 동시 시작(차례로 기다리면 끝나지 않게 만든 시험)·실패 로그에 PostgREST 일반 객체의 code·message·details·hint 와 Error cause 를 푼 값, `bucketByBid` 가 `classifyNotice` 와 같은 묶음 |
| 변형 확인 | ① 마감 전 거르기(`isOpen`)를 빼면 겹쳐 보기 시험 1건 실패 ② 기관 이름 다듬기(`trim`)를 빼면 2건 실패 ③ 실패 로그를 예전처럼 `error.message`/`String(error)` 만 남기게 하면 1건 실패. 모두 되돌린 뒤 32 passed |
| `market-view.browser.test.tsx`(슬롯) | 3 passed. 1단계 시험은 NO_PROFILE 로 겹쳐 보기 요소 0개를 단언. 새 시험은 분포 글자·아이콘·0건 묶음 생략·"마감 전 공고 없음"·예산 구간에는 겹치지 않음·금지어(점유율·경쟁사·승률·확률·가능성·수주·%)·1440·1280 가로 넘침 0(문서와 겹쳐 보기 줄 각각), FAILED 안내 한 줄 |
| `pnpm verify:changed`(슬롯, 09 리뷰 반영 뒤) | rc=0. `변경 15개 · 검사 1개 (기준 HEAD)`, `Test Files  97 passed (97)`, `Tests  857 passed (857)`, lodestar `2 rules passed, 0 errors, 0 warnings`, 토큰·색 검사 통과, `✓ web: pnpm verify:quick (41.9초)` |

스크린샷 숫자는 모두 가상이다(회사 프로필 `r9(가상)`, 운영 실측과 겹치지 않게 만든 값). 1440 은 시험 창(1280)에 줄여 그려진 것을 1280 폭으로 이었다.

09 독립 리뷰(상 0·중 0·하 3)와 README 보완 1건을 반영했다: 실패 로그 원인 남기기(gaps.repo cause 감싸기·로그에서 일반 객체 풀기), 안내 문구 범위 밝히기, `RELEVANT_STATES` 상호 주석, 이 표의 `verify:changed` 줄. 문구가 바뀌어 스크린샷을 다시 찍었다.

### 늘어난 응답 크기(격리 로컬 DB)

격리 로컬 Supabase(project_id `sol-radar-gaps-ac`, API 59621, 이 worktree 의 마이그레이션 63개)에 가상 나라장터 입찰공고 2,000건(최근 90일 게시, 마감 전 1,100건·마감 지난 900건, 기관 12곳, 면허제한 1행)과 시드 팀 회사 프로필(정보통신공사업 HELD)을 넣었다. 시드 owner 세션(anon 키 + 사용자 토큰)으로 market repo 와 같은 select·거르기(1,000건 keyset)와 gaps repo `readLiveNotices`(500건 keyset)를 그대로 보냈다. 키는 `supabase status` 에서 읽어 메모리로만 썼다. 데우기 1회 뒤 3회 쟀다(시간은 1·2·3회 순).

| 읽기 | 요청 | 응답 합(바이트) | 시간(ms, 3회) |
|---|---|---|---|
| 1단계 market(공고 2,000건) | 3 | 746,792 | 786 · 60 · 91 |
| B2 로 더한 gaps(프로필 1 + 공고 1,100건 3쪽) | 4 | 841,453 | 201 · 189 · 156 |
| 둘을 `Promise.all` 로 | 7 | 1,588,245 | 200 · 171 · 215 |

- Next 서버와 Supabase 사이 응답이 요청 4개·약 0.84MB 늘었다. 합은 1단계의 약 2.1배다. 함께 읽은 시간은 두 읽기 중 긴 쪽(gaps)과 비슷하다. 브라우저로 가는 것은 행 아래 줄 글자뿐이다(서버 컴포넌트).
- 판정은 owner 화면 데이터로 마감 전 1,100건 = 참가 가능 968 + 회사 기록 없음 88 + 사람 확인 필요 44, 판정을 찾지 못한 공고 0건, 기관 키 12곳이 1단계 기관 이름과 같다. 손계산(공고 번호 10의 배수 = 소프트웨어사업자, 25의 배수 = 보조 조회 실패)과 같다.
- 조직 밖 사람(outsider)은 프로필이 RLS 로 0행 → NO_PROFILE, 공고 요청을 보내지 않았다(요청 1개·2바이트).
- 실행: `node --conditions=react-server --import tsx <scratchpad>/market-b2-localdb-check.mts`. 끝난 뒤 `supabase stop --workdir <scratchpad>/gapsdb --no-backup` 으로 이 스택의 컨테이너·볼륨만 지웠다(남은 컨테이너·볼륨 0). 다른 세션 스택은 건드리지 않았다.

### 남은 확인

- 운영 데이터 크기에서의 응답 크기·시간은 재지 않았다(운영 DB 호출 금지). 운영 `/gaps` 대상 공고 수가 로컬 1,100건보다 크면 그만큼 늘어난다.
- 로그인한 실제 화면(Next dev + 로컬 Supabase)으로는 보지 않았다. 화면은 브라우저 부품 시험의 mock 값으로 확인했다.

## 관련 문서

- [[11-TESTING|11 테스트]]
- [[09-SECURITY|09 보안]]
