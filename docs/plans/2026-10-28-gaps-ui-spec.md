---
title: "디자인 스펙 — 자격 갭 레이더 (/gaps)"
doc: "design-gaps-radar-ui"
status: draft
tags:
  - sol-radar
  - ui
  - hackathon
created: 2026-10-28
updated: 2026-10-28
---

# 디자인 스펙: 자격 갭 레이더 (`/gaps`)

[기능 스펙](../../polaris/specs/in-progress/2026-10-28-gaps-market-calendar.md) §5 파트 A의 화면 스펙이다. 구현자는 이 문서와 서버 계약 `web/server/gaps/gaps.model.ts`(`GapRadarView`)를 보고 짠다. "고정"이라 적은 문구는 그대로 쓴다. 나머지 문구는 초안이고, 확정은 사용자가 한다.

> [!warning] 미검증 가정
> 코드만 읽고 썼고 브라우저는 띄우지 않았다. 본문 폭은 사이드바 256px·`AppPage lg:px-8`·`max-w-360`으로 계산했다(1440 → 1120px, 1280 → 960px). 예시 숫자(54건·392.9억)는 스펙 §3 실측이라, 관련성 거르기·보조 조회를 거친 화면 값과 다를 수 있다.

## 1. 기준

- 데이터: `GapRadarView`(`NO_PROFILE`·`READY`), 라벨·고정 문구 상수(`GAP_*_LABELS`·`GAPS_*_NOTICE`), 주소 함수 `gapRadarHref`·`toggleAssume`.
- 견본: 숫자 띠는 `dashboard/dashboard-view.tsx` `SummaryStrip`, 화면 틀·로딩은 `analysis/`, 가정은 `components/bids/what-if-band.tsx`·`qualification-checklist.tsx`(`AssumptionSwitch`), 프로필 배지는 `bids/[id]/bid-detail-view.tsx` `ProfileBadge`.
- 정본: 06 §3.1·§3.2(의미색·아이콘+글자), §5.1(공통 상태), §6.1(ADR-037 "섞지 않는다"), §10(접근성), `design-system`(장식 금지, `rounded-lg`).

## 2. 흐름

1. `/gaps`를 연다. 사이드바 등록 전에는 주소로 연다. 서버는 `requireWork` 뒤 `parseGapQuery(searchParams)`로 계산한다.
2. 요약 띠에서 "참가 가능(API 기준) N건"을 읽고, 막는 자격 1위 행을 본다.
3. 행의 "보유 가정" 스위치를 켠다. `router.push(gapRadarHref(toggleAssume(…)), { scroll: false })`를 transition 안에서 부른다. 서버가 다시 계산하면 가정 띠와 "새로 열리는 공고"가 보인다.
4. 공고 제목을 누르면 `/bids/[id]?origin=live`로 간다. "가정 지우기"를 누르면 `assume`이 빠진 주소로 간다.

가정은 주소에만 있다. 저장·감사·알림은 0건이다. 예비 경로는 `/gaps?assume=SW_BUSINESS_REG`다.

## 3. 화면 구조 (1440)

```text
자격 갭 레이더                                        전체 업종 보기 [○]
마감 전 실공고의 면허제한·참가가능지역을 …            관련 312건 · 전체 1,051건
[공개 자료 회사 프로필로 분석] 회사 프로필 r5 · 기준 2026-10-28 14:05 KST
나라장터 입찰공고 수집분 기준 · 낙찰·계약 데이터는 … · 발주계획·사전규격 미포함
─────────────────────────────────────────────────────────────────────────
대상 공고   │✓참가 가능(API 기준)│◌회사 기록 없음│✕미보유 │?사람 확인 필요
312건       │41건                │81건          │0건     │190건
예산 합 1,284억│예산 합 41.2억   │예산 합 405억 │0억     │837.8억
─────────────────────────────────────────────────────────────────────────
고정 문구 1 · 고정 문구 2 (두 줄)
┌ ─ 가정 시나리오 (점선, min-h-44) ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ [가정 지우기] ┐
  켠 가정 [소프트웨어사업자 신고확인서 보유]
  '…' 보유를 가정하면 참가 가능(API 기준) 공고가 41건에서 95건으로, …
                       원래      가정        차이
  참가 가능(API 기준)  41건    → 95건        +54건
  배정 예산 합         41.2억  → 434.1억     +392.9억
  묶음 이동: 회사 기록 없음 81 → 27건 · 미보유 변화 없음 · …
  가정 결과입니다. 저장되지 않고 …          새로 열리는 공고 54건 보기
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
막는 자격
순위│자격(API 업종)      │판정          │막힌 공고│예산 합│조건 묶음│보유 가정
 1  │소프트웨어사업자(…) │◌회사 기록 없음│   54건 │392.9억│   37건 │[●]
    │API 1468 · 사전: 소프트웨어사업자 신고확인서
 2  │기타자유업종        │?사전 밖       │   21건 │187.8억│    —   │가정 불가
 … 10행 · [나머지 6개 업종 보기]
새로 열리는 공고 54건 (가정이 있을 때만): 제목 │ 발주기관 │ 마감 │ 예산
사람 확인 필요 사유 (구분선 목록, max-w-160)
```

**1280**(본문 960px): 숫자 띠는 5칸 그대로다(칸당 약 190px). 메타 두 줄은 꺾인다. "자격" 열은 약 320px로 줄고 업종 이름은 2줄까지 꺾인다. 가로 스크롤은 없다. 두 폭 모두 첫 화면(1440×900·1280×800)에 순위 표 1~3행과 스위치가 보여야 한다.

## 4. 영역별 명세

### 4.1 머리말·메타

- `AppPage`의 `actions` 자리에 관련성 거르기를 둔다: `Label` "전체 업종 보기" + `Switch`, 그 아래 `type-caption` "관련 {n}건 · 전체 {n}건"(`scopeCounts`). 켜면 `?scope=all`이 되고, `assume`은 유지한다. `default` 버튼은 두지 않는다.
- 메타 1줄(`type-caption text-muted-foreground`, `flex-wrap`): 프로필 배지 칩("공개 자료 회사 프로필로 분석", `isDemo`면 "가상 회사 프로필로 분석", 툴팁은 상세와 같다) · "회사 프로필 r{revision}" · `<time>` "기준 {formatKst(asOf)} KST"(`title`에 UTC). `asOf=null`이면 "기준 시각 없음"이다.
- 메타 2줄: `GAPS_SOURCE_NOTICE`.

### 4.2 요약 띠

`SummaryStrip` 마크업이다(`dl grid-cols-5 border-y`, 칸 사이 `border-l`, subgrid 세 줄). 칸은 ① 대상 공고 ② 참가 가능(API 기준)(`CircleCheckIcon text-success`) ③ 회사 기록 없음(`CircleDashedIcon text-muted-foreground`) ④ 미보유(`CircleXIcon text-destructive`) ⑤ 사람 확인 필요(`CircleHelpIcon text-warning`) 순서다.

- 값은 `type-title tabular-nums` 숫자 + `type-body text-muted-foreground` "건"이다.
- 보조 줄은 "예산 합 {억}"이다. ①에만 "마감 전 · 관련 업종"(또는 "전체 업종")을 앞에 붙인다.
- 이 띠는 늘 원래 값이다. 가정을 켜도 바뀌지 않는다.
- 띠 바로 아래에 `GAPS_SCOPE_NOTICE`·`GAPS_BUDGET_NOTICE`를 `type-label text-foreground` 두 줄로 둔다. 상자·아이콘은 없다.

### 4.3 가정 시나리오 띠

`WhatIfBand` 겉모양을 따른다: `section rounded-lg border border-dashed border-muted-foreground p-4`, `h2` "가정 시나리오"(`tabIndex={-1}`). 자리를 늘 차지하고 `min-h-44`로 높이를 고정해, 스위치를 켜도 아래 표가 밀리지 않는다.

- 칩 "{사전 이름} 보유"(`what-if-band`의 `CHIP` 클래스).
- 요약 문장(`type-body`): "'{이름}' 보유를 가정하면 참가 가능(API 기준) 공고가 {N}건에서 {N′}건으로, 배정 예산 합이 {X}에서 {X′}으로 바뀝니다." 이름이 둘 이상이면 가운뎃점(·)으로 잇는다.
- 비교표(sr-only `caption` "원래 결과와 가정 결과 비교"): 행 머리 `th scope="row"`, 열은 원래 · 가정(앞에 `ArrowRightIcon`) · 차이, 값은 `type-title tabular-nums`다. 차이는 `+54건`·`+392.9억`으로 쓰고, 줄면 `−`(U+2212), 같으면 "변화 없음"이다.
- 묶음 이동 한 줄(`type-caption`). `GAPS_ASSUMPTION_NOTICE`는 모든 상태에서 보인다. 링크 "새로 열리는 공고 {n}건 보기"는 `#gaps-opened`로 간다.
- "가정 지우기"는 `Link` + `cn(buttonVariants({ variant: "outline", size: "sm" }))`이다. 누른 뒤 초점은 띠 제목으로 옮긴다.

### 4.4 막는 자격 순위 표

`h2` "막는 자격". 설명: "자격 하나만 보유로 확인되면(회사 기록 없음·미보유) 참가 가능(API 기준)으로 셀 수 있는 공고를 자격별로 묶었습니다. 사전 밖 업종은 사람 확인 필요입니다. 공고 수가 많은 순, 같으면 예산 합이 큰 순입니다." 회사 기록 없음은 정보 부족이지 미충족이 아니므로 "참가할 수 없는"이라고 쓰지 않는다. 안내 줄(스위치의 `aria-describedby`): "'보유 가정'을 켜면 저장하지 않고 서버에서 다시 계산합니다. 위 요약과 이 표의 숫자는 원래 값 그대로입니다."

| 열 | 폭 | 내용 |
|---|---|---|
| 순위 | 48 | 숫자만 쓴다(`type-label text-muted-foreground`). 색 원 번호는 쓰지 않는다 |
| 자격(API 업종) | 나머지 | `th scope="row"`. `name`(`type-body wrap-anywhere`) 아래 `type-caption`으로 "API {apiCode} · 사전: {사전 이름}" 또는 "API {apiCode} · 자격 코드 사전 밖" |
| 판정 | 136 | 아이콘 + `GAP_BLOCKER_KIND_LABELS`(◌ 회사 기록 없음 / ✕ 미보유 / ? 자격 코드 사전 밖) |
| 막힌 공고 · 예산 합 · 조건 묶음 포함 | 96·112·112 | 오른쪽 정렬, `font-mono tabular-nums`. 예산은 억(§6.3), 묶음 0은 "—" |
| 보유 가정 | 128 | 사전 코드가 있고 회사 기록 없음·미보유인 행: `Label` "보유 가정" + `Switch`. 사전 밖: "가정 불가" |

- 정렬은 서버 순서로 고정한다. 처음 10행을 보이고, 그 아래 `ghost sm` "나머지 {n}개 업종 보기"(`aria-expanded`)를 둔다.
- 각주: "조건 묶음 포함: 이 업종이 다른 업종과 함께 걸린 면허제한 2행 이상 공고입니다. AND/OR 를 확인하지 못해 사람 확인 필요로 세며, 보유 가정으로 열리지 않습니다."
- 같은 사전 코드의 행이 여럿이면 스위치 상태를 함께 쓴다. 행의 판정·숫자는 원래 값 그대로다.

### 4.5 새로 열리는 공고 (가정이 있을 때만)

`id="gaps-opened"`, `h2` "새로 열리는 공고 {n}건", 설명 "보유 가정으로 참가 가능(API 기준)이 되는 마감 전 공고입니다. 예산이 큰 순입니다." 열: 제목(링크 `/bids/{bidId}?origin=live`, `line-clamp-2` + `title`) · 발주기관(200, `truncate`) · 마감(`formatKstShort` + `dDay`, 120) · 예산(`formatKrwCompact`, 96, `/bids` 표와 같다). 10행을 보이고 "10건 더 보기"를 둔다.

### 4.6 사람 확인 필요 사유

`h2` + 설명 "공고 하나에 사유가 여러 개일 수 있어 합이 사람 확인 필요 공고 수({n}건)보다 클 수 있습니다." 대시보드 `MetricRow`처럼 구분선 목록(`max-w-160`)으로 그린다. 왼쪽은 `GAP_REVIEW_REASON_LABELS`, 오른쪽은 `{count}건`이다. 코드는 `data-reason`에만 둔다.

## 5. 상태표

| 상태 | 언제 | 보이는 것 | 사용자가 할 수 있는 것 |
|---|---|---|---|
| 로딩 | 첫 진입 | 같은 제목. skeleton: 메타 `h-4`, 띠 5칸 `h-24`, 가정 띠 `h-44`, 표 6행 `h-11`. sr-only "자격 갭을 계산하는 중…" | 기다린다 |
| 계산 중 | 스위치·지우기·거르기 뒤 pending | 누른 스위치는 낙관적으로 켜진다(`useOptimistic`). 가정 띠 값은 skeleton + `aria-busy`이고, 켠 가정 칩·"가정 지우기"·"새로 열리는 공고 N건 보기"는 숨긴다. 새로 열리는 공고 구역은 `aria-busy` + 흐림. 요약·표 숫자는 그대로다 | 끝날 때까지 스위치(보유 가정·전체 업종 보기)는 `disabled`다. 다음 주소가 지금 쿼리 기준이라 겹쳐 누르면 앞의 조작이 사라지기 때문이다 |
| 가정 없음 | `assumption=null` | 가정 띠: "아래 막는 자격 표에서 '보유 가정'을 켜면 참가 가능(API 기준) 공고 수와 배정 예산 합이 어떻게 바뀌는지 여기에 보입니다." + 고정 문구 | 스위치·거르기 |
| 가정 있음 | `assumption≠null` | 띠 결과 + 새로 열리는 공고. 열리는 공고가 0건이면 "새로 열리는 공고가 없습니다. 다른 조건(복수 면허·지역)이 함께 걸려 있을 수 있습니다." | 끄기·지우기·공고 열기 |
| 프로필 없음·읽기 불가 | `NO_PROFILE` | `EmptyState`(`Building2Icon`) "회사 프로필을 찾지 못했습니다" / "자격 갭은 회사 프로필의 보유 자격과 공고 조건을 대조해 셉니다. 이 조직의 회사 프로필이 없거나 읽을 권한이 없습니다." | ADMIN·EXECUTIVE: outline "회사 역량 보기"(`/company`). 다른 역할: 설명 뒤 "관리자에게 문의하세요." |
| 관련 공고 0건 | `scope=relevant`, 0건, 전체 >0 | `EmptyState`(`InboxIcon`) "마감 전 관련 공고가 없습니다" / "전체 업종에는 {n}건이 있습니다." | outline "전체 업종 보기" |
| 대상 0건 | `scope=all`, 0건 | "마감 전 수집 공고가 없습니다". ADMIN이 아니면 "관리자에게 수집을 요청하세요"가 붙는다 | ADMIN: outline "수집 실행" |
| 표 0행 | `blockers`·`reviewReasons` 빈 배열 | 구분선 한 줄 "막는 자격이 없습니다." / "사람 확인이 필요한 공고가 없습니다." | — |
| 오류 | 서버 오류(가정 계산 포함) | `WorkError title="자격 갭 레이더" contentClassName="max-w-360"`. 주소의 `assume`은 남는다 | 다시 시도 |
| 권한 없음 | 별도 화면 없음. 모든 업무 역할(VIEWER 포함)이 읽는다. RLS로 프로필을 못 읽으면 `NO_PROFILE`이다 | 위 행 | — |

## 6. 문구

**고정**(`gaps.model.ts`, 바꾸지 않는다): `GAPS_SCOPE_NOTICE`, `GAPS_BUDGET_NOTICE`("예산 합계는 참가 자격이 열리는 공고의 배정 예산 합이며 수주 금액이나 확률이 아닙니다."), `GAPS_ASSUMPTION_NOTICE`("가정 결과입니다. 저장되지 않고 결정 기록에 쓰이지 않습니다."), `GAPS_SOURCE_NOTICE`, 묶음·사유·종류 라벨, 프로필 배지·툴팁.

**초안**(사용자 확정):

- 제목: 자격 갭 레이더
- 설명: 마감 전 실공고의 면허제한·참가가능지역을 회사 프로필과 대조해, 어떤 자격이 몇 건의 공고를 막는지 봅니다.
- 버튼·링크: 보유 가정 · 가정 지우기 · 새로 열리는 공고 {n}건 보기 · 나머지 {n}개 업종 보기 · 10건 더 보기 · 회사 역량 보기 · 전체 업종 보기 · 수집 실행
- 설명·빈 상태 문구는 §4·§5에 있다.

**쓰지 않는 말**: 승률, 확률(고정 문구의 부정문만 예외), 가능성, 수주 금액, 기대 매출, 점유율, 경쟁사, `%`.

### 6.3 예산 "억" 표기

- 합계(요약 띠·가정 띠·순위 표)는 억으로 고정하고, 조로 바꾸지 않는다(`1,284억`).
- 원 → 억은 bigint로 계산한다. 소수 첫째 자리에서 사사오입하고, 천 단위 쉼표를 붙이고, 끝의 `.0`은 지운다(`12억`·`392.9억`).
- 0원은 `0억`, 0원 초과 500만 원 미만은 `0.1억 미만`이다.
- 차이는 원 단위로 뺀 뒤 반올림한다. 반올림한 두 값의 차와 0.1억 어긋날 수 있다.
- `title`·sr-only에는 전체 금액을 쓴다(`39,290,000,000원`).
- 공고 한 건의 예산은 `/bids`와 같은 `formatKrwCompact`다.

## 7. 접근성

- `main`은 하나(`AppPage`)다. `h1` 아래 `h2` 4개: 가정 시나리오·막는 자격·새로 열리는 공고·사람 확인 필요 사유. 요약 띠는 `section aria-label="자격 갭 요약"` + `dl`이다.
- 색만으로 뜻을 전하지 않는다: 아이콘(`aria-hidden`) + 글자, 차이는 부호 + 단위 글자.
- 스위치 이름은 "{업종 이름} 보유 가정"이다(`aria-labelledby` = 행 머리 id + 보이는 라벨 id). `Space`로 켜고 끈다. 행 `key`가 같아 주소가 바뀌어도 다시 마운트되지 않고 초점이 남는다.
- 표: `caption`, `th scope="col"`·`scope="row"`. 행 클릭은 없다. Tab 순서는 화면 순서와 같다.
- `aria-live="polite"`(sr-only) 한 곳에서 마지막 결과만 읽는다:
  - 가정: "가정 결과. 참가 가능(API 기준) 41건에서 95건으로 바뀜. 배정 예산 합 41.2억에서 434.1억으로 바뀜."
  - 지움: "가정을 지웠습니다. 원래 결과만 보입니다."
  - 거르기: "관련 업종 공고 312건 기준으로 다시 셌습니다."
  - 계산 중에는 띠에 `aria-busy`만 둔다.
- 링크 초점은 `focus-visible:ring-3 ring-ring/50`이다. skeleton에는 `motion-reduce:animate-none`을 둔다. axe 위반은 0건이어야 한다.

## 8. 토큰·부품 매핑

- 색: `background`·`border`·`divide-border`. 면 채움은 없다. 아이콘은 `success`(참가 가능)·`muted-foreground`(기록 없음)·`destructive`(미보유)·`warning`(확인 필요·사전 밖)이다. 가정 띠는 `border-dashed border-muted-foreground`이고, 스위치는 `ui/switch` 기본(`primary`)이다. `brand`는 쓰지 않는다.
- 글자: `type-title`(h1·띠 숫자·비교 값), `type-heading`(h2), `type-body`, `type-label`(라벨·표 머리·고정 문구), `type-caption`(메타·보조·각주).
- 간격: 구역 사이 `gap-8`, 제목 아래 `mt-3`, 띠 칸 `px-5 py-4`, 표 셀 `px-3`.
- 그대로 쓰는 부품: `AppPage`, `EmptyState`(`(work)/empty-state.tsx`), `WorkError`, `ui/table`·`switch`·`label`·`button`·`skeleton`·`tooltip`. 서식은 `components/bids/format.ts`의 `formatKst`·`formatKstShort`·`dDay`·`formatKrwCompact`다.
- 모양만 따르는 것: `WhatIfBand`는 `WhatIfSummary`(권고·점수) 전용이라 그대로 못 쓴다. 띠 클래스·`CHIP`·`−` 규칙과 `AssumptionSwitch` 패턴만 같은 값으로 쓴다.

**새로 필요한 것(제안 — 승인 필요)**: 새 토큰은 없다. 새 파일은 `web/app/(app)/(work)/gaps/`의 `page`·`loading`·`error`·`gaps-view`(클라이언트)·`gaps-copy`·`gaps-format`(`formatEok`, §6.3)다. `SummaryStrip`·`ProfileBadge`는 두 번째로 쓰인다.

1. **(추천)** gaps 화면 안에 같은 마크업·문구로 둔다. 다른 화면 파일을 건드리지 않아 병렬 작업과 부딪히지 않는다. 공용화는 발표 뒤에 한다.
2. `components/work/summary-strip.tsx`·`components/bids/profile-badge.tsx`로 빼서 대시보드·상세도 같이 쓴다. 문구는 한 곳에 남지만, 두 화면 파일을 고쳐야 한다.

## 9. 발표 30초 동선 (1440, 로그인, `/gaps` 미리 열어 둠)

| 초 | 동작 | 말할 것 |
|---|---|---|
| 0~6 | 요약 띠를 가리킨다 | "실공고 기준, 공개 자료로 지금 참가할 수 있는 공고는 N건입니다" |
| 6~10 | 순위 표 1행(소프트웨어사업자 · 회사 기록 없음) | "가장 많이 막는 자격은 소프트웨어사업자입니다" |
| 10~18 | 1행 "보유 가정" 스위치 클릭 → 가정 띠 | "보유했다고 가정하면 M건, Y억이 열립니다. 저장되지 않고 수주 금액이 아닙니다" |
| 18~26 | "새로 열리는 공고 보기" 클릭 | "어느 기관의 어떤 사업인지 바로 보입니다" |
| 26~30 | (선택) 첫 공고 제목 → 상세 | — |

스위치가 늦으면 `/gaps?assume=SW_BUSINESS_REG`를 바로 연다. 대본 숫자는 배포 뒤 운영 화면에서 읽어 정한다.

## 10. 열린 질문

1. 발표 기본 거르기: 관련 업종(추천, 기본값)으로 할지, 전체 업종(1,051건)으로 할지.
2. 대본의 M·Y가 스펙 §3 실측(54건·392.9억)과 다를 때 어느 값을 쓸지. 추천은 화면 값이다.
3. 순위 표에 예산순 정렬 버튼이 필요한지. 지금은 고정 순서다.
4. `assume`의 사전 밖 값은 조용히 버린다. 안내 한 줄이 필요한지.
5. "기타자유업종/9999"(사전 밖)가 상위에 뜨면 질의응답용 설명이 필요하다.
6. 사이드바 등록(분석 묶음, 아이콘 후보 `radar`)은 메인 세션이 한다.

## 관련 문서

- [[06-UI-UX|06 UI/UX]] — §3.1·§3.2, §5.1, §6.1, §10, §12
- [[2026-10-20-boost2-what-if-ui|BOOST-2 가정 재계산 화면 스펙]] — 띠·스위치·live 문구 원본
- [[16-DECISIONS|16 결정]] — ADR-007, ADR-037
