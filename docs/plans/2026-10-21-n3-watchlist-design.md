---
title: "디자인 스펙 — N3 관심 공고 (/watchlist·★ 토글)"
doc: "design-n3-watchlist"
status: draft
tags:
  - sol-radar
  - ui
  - p1
created: 2026-10-21
updated: 2026-10-21
---

# 디자인 스펙: N3 관심 공고 (`/watchlist`·★ 토글·상세 "관심 N명")

[N3 스펙](../../polaris/specs/done/2026-10-21-n3-watchlist.md) §5 화면과 [[2026-10-21-n3-watchlist-plan|N3 구현 계획]] Task 6 을 구현자가 추측 없이 옮길 수 있게 고정한다. 코드·정본·설정은 바꾸지 않는다. 문구는 §6 에서 "고정"이라고 적은 것 말고는 모두 초안이고 확정은 사용자 몫이다. 결정이 필요한 것은 §12 에 D1~D16 으로 모았고, 각 항목은 추천안 ①을 먼저 적었다. 스펙 §8 의 Q2·Q3 은 ①안(목록 응답 불변·화면이 내 관심 id 를 따로 읽음, `/watchlist` 기본 조건은 `/bids` 와 같음)으로 가정했다.

> [!warning] 미검증 가정
> 코드와 문서만 읽고 썼다. dev 서버·브라우저는 띄우지 않았다. 폭은 사이드바 256px·`AppPage` 좌우 32px(`lg:px-8`)·`BidTable` 열 폭 클래스에서 계산한 값이고, 기존 브라우저 시험의 상자 폭(표 `bid-list.browser.test.tsx` 960·1120, 상세 `bid-detail-view.browser.test.tsx` 1024·1184)과 같은 기준이다. 서버 모양은 이 작업 폴더에서 다른 작업자가 쓰는 중인 미커밋 `web/server/watchlist/watchlist.model.ts`(`WatchState`·`WatchSummary`)와 계획 Task 3~6 을 읽고 맞췄다. 모양이 바뀌면 §5 만 고친다. 형식은 [[2026-10-20-boost2-what-if-ui|BOOST-2 화면 스펙]]을 따랐다(지시서가 든 N2 스펙 파일은 이 작업 폴더에 없다).

> [!note] 판단 반영(2026-10-21, fa)
> D1~D16 은 모두 ①. §11 열린 질문은 추천안으로 정했다: ★ 이름은 "관심 공고" 고정 + `aria-pressed`(T6·T7 대신), D10 ①, `/watchlist` 에 `BidsSourceNav` 없음, 1280 제목 열 144px 수용. 근거는 [N3 스펙](../../polaris/specs/done/2026-10-21-n3-watchlist.md) §8. §11-4 데모 장면은 12 몫으로 남는다.
> 구현 뒤 확인(fa): §4.1 "행 높이가 늘지 않는다"는 두 곳이 틀렸다. ① 모든 행이 두 줄(약 56px)은 아니다. 단계·마감·제목이 한 줄이면 행은 `h-11`(44px)이고, ★ 칸이 기본 여백(`py-2.5`)이면 32 + 20 = 52px 라 행이 커진다 → ★ 칸만 `py-1.5`(32 + 12 = 44px, 초점 고리 3px 는 6px 안)로 고쳤다. ② ★ 열 40px 만큼 제목 열이 줄어 1440 펼침(344 → 304px)에서 한 줄이던 제목이 두 줄이 되면 그 행은 약 8px 커진다. D1 의 제목 열 축소를 받아들인 결과라 그대로 둔다. M4 는 제목 열 폭을 같게 맞춰(★ 없음 1080 · ★ 있음 1120) ★ 칸 자체가 행을 키우지 않는지만 잰다.

## 0. 범위

이미 정해진 것(스펙 §5, 설계 §2.2·§2.4·D6, 메인 세션 지시. 바꾸지 않는다):

- `/watchlist` 는 `/bids` 와 같은 `BidTable`·`BidFilters`·더 보기를 쓰고 `watched=me` 조건이 고정으로 붙는다. 공고 복제·별도 표 없음.
- 관심은 본인 것만. 조직에는 공고별 "관심 N명"(인원 수)만 보인다. 누가 표시했는지는 어디에도 보이지 않는다.
- ★ 토글은 `/bids` 행, `/watchlist` 행, `/bids/[id]` 머리 세 곳. 모든 역할(VIEWER 포함)이 쓴다. 낙관적 반영, 실패하면 되돌리고 sonner 토스트.
- 버튼 접근성: `aria-pressed`, 이름 "관심 공고에 추가"·"관심 공고에서 빼기", lucide `StarIcon` 16px.
- `/watchlist` 에서 해제해도 그 자리에서 행을 바로 지우지 않는다(스펙 §5).
- 데스크톱 전용(1280px 이상, 기준 1440px). 승률·확률·결제 표시 없음. 장식(그라데이션·알약 머리글·색 강조) 없음. 색은 `design/tokens.json` 토큰만.

이 스펙이 하지 않는 것:

- 표에 "관심 N명" 열을 두지 않는다. 인원 수는 상세 머리에만 보인다(1280 에서 열을 더 줄 자리가 없다, §4.1).
- 대시보드 compact 표(`BidTable compact`)에는 ★ 가 없다.
- 사이드바 "관심 공고" 줄에 개수 배지를 두지 않는다(06 §4.1 메뉴에 배지 규칙 없음).
- 다른 탭·다른 사람의 변경을 실시간으로 맞추지 않는다. 다음 서버 읽기 때 맞춰진다.
- 알림 화면은 바꾸지 않는다. `DEADLINE_APPROACHING` 행은 기존 라벨 "마감 임박"·`CalendarClockIcon`(`web/components/bids/labels.ts`)으로 이미 그려진다.

## 1. 기준

| 근거 | 경로 | 이 스펙에서 쓴 것 |
|---|---|---|
| 스펙 | `polaris/specs/done/2026-10-21-n3-watchlist.md` §5·§8·§9 | 화면 범위, Q2·Q3 ①, 빈 상태 문구 일부 |
| 계획 | `docs/plans/2026-10-21-n3-watchlist-plan.md` Task 4·6, Review Focus 5 | 파일 이름, `back-href` 가 `watched=me` 를 `/watchlist` 로 보내는 규칙 |
| 설계 | `docs/plans/2026-10-16-sidebar-ia-design.md` §2.1·§2.2·§2.4·D6 | 화면 책임, 권한(본인), 인원 수만 공개 |
| 정본 | `docs/06-UI-UX.md` §1·§3.1·§3.3·§4·§4.1·§5.1·§5.4·§5.5·§10·§12 | 폭, 의미색, 표 규칙, 사이드바 현재 표시, 공통 상태, 증거 이름 |
| 정본 | `docs/05-API-SPEC.md` §3 `status`·`watched` 행 | `CLOSED` 는 `status` 로 받을 수 있고 "취소 포함"은 `CLOSED` 를 더하지 않는다(ADR-031 C15) |
| 디자인 시스템 | `.claude/skills/design-system/SKILL.md`, `design/tokens.json` | `brand` = 선택 표시, 버튼 32·36px, 눈금 |
| 견본: 목록 | `web/app/(app)/(work)/bids/page.tsx`·`bid-list-view.tsx`·`bid-list-more.tsx`·`bids-copy.ts`·`loading.tsx`·`error.tsx`, `web/app/(app)/(work)/load-more.tsx` | 정보 위계, 더 보기, 결과 줄, 뼈대 |
| 견본: 표·필터 | `web/components/bids/bid-table.tsx`·`bid-filters.tsx`, `web/components/ui/table.tsx`·`button.tsx` | 열 폭(합 776px), 셀 여백, 행 열기는 제목 링크뿐, 상태 선택지 |
| 견본: 상세 | `web/app/(app)/(work)/bids/[id]/bid-detail-view.tsx`(`DetailEyebrow`·`HeaderActions`)·`back-href.ts`·`loading.tsx`·`api-envelope.ts` | 머리 동작 자리(`max-w-sm`), 뒤로 링크, `CSRF_HEADERS`·`failureOf` |
| 견본: 빈 상태·토스트 | `web/app/(app)/(work)/empty-state.tsx`, `web/app/(app)/(work)/notifications/notification-list.tsx`(`READ_FAILED`) | `EmptyState` 모양, 실패 토스트 한 문장 |
| 견본: 사이드바 | `web/components/app-nav.ts`(`isCurrentItem`·`screenLabelOf`), `web/components/app-shell.tsx` | 현재 표시(`aria-current`·`sidebar-accent`·3px `brand` 막대) |
| 시험 | `web/components/bids/bid-list.browser.test.tsx`·`bid-table-font.browser.test.tsx`, `web/e2e-auth/fx01-flow.write.spec.ts`(`cellOf`)·`support/work-fixtures.ts`(`tableRows`) | 기존 시험이 열 순서가 아니라 머리 글자로 칸을 찾는다 → 맨 앞 열을 더해도 E2E 가 깨지지 않는다 |

## 2. 흐름

**F1 등록 → 모아 보기**: `/bids` 행 ★(꺼짐) 누름 → 별이 바로 채워짐(요청 PUT) → 사이드바 "관심 공고" → `/watchlist` 에 그 공고가 보인다.

**F2 해제와 되돌리기**: `/watchlist` 행 ★(켜짐) 누름 → 별이 바로 빈 별(요청 DELETE) → 행은 그 자리에 남는다 → (되돌리기) 같은 별을 다시 누르면 다시 켜진다 → (확정) 새로 고침·필터 변경·다른 화면 다녀옴처럼 서버가 다시 읽으면 그 행이 빠진다.

**F3 상세에서**: `/bids/[id]` 머리 ★ 누름 → 별이 바로 바뀜 → 응답의 `watcherCount` 로 "관심 N명"이 바뀐다(0명이면 사라진다). `/watchlist` 에서 열었으면 "← 관심 공고"가 `/watchlist`(같은 조건)로 돌아간다.

**F4 실패**: 어느 자리든 응답이 실패(4xx·5xx·네트워크) → 별을 누르기 전 모양으로 되돌림 → 토스트 한 줄 → 초점은 버튼에 남아 다시 누를 수 있다.

**F5 마감 알림(화면 변경 없음)**: D-3·D-1 09:00 KST 이후 인앱 알림 → `/notifications` 행 "마감 임박" → 링크 `/bids/<id>`(상세, "← 공고 목록").

분기:
- 로그인 전·가입 보완 전·조직 상태 이상: `requireWork("/watchlist…")` 가 기존 안내로 보낸다. 역할로 막는 것은 없다(403 상태 없음).
- 취소·마감 공고: ★ 는 그대로 쓴다(관심 행은 남고 알림만 멈춘다, 스펙 §9).

## 3. 공통 규칙 — ★ 토글

### 3.1 두 가지 크기

| 자리 | 부품 | 크기 | 이유 |
|---|---|---|---|
| 표 행(`/bids`·`/watchlist`) | `Button variant="ghost" size="icon-sm"` | 32×32px, 아이콘 16px | 행마다 테두리 상자가 20개 서면 표가 시끄럽다. 32px 는 작은 버튼 눈금이고 행 높이(56px)를 늘리지 않는다 |
| 상세 머리 | `Button variant="outline" size="icon"` | 36×36px, 아이콘 16px | 옆 [원문 보기]·[분석 실행]과 같은 높이·테두리 |

두 자리 모두 같은 부품 `WatchToggle`(§8.5)이고 `size`·`variant` 만 다르다.

### 3.2 시각 상태

| 상태 | 별 아이콘 | 버튼 바탕 |
|---|---|---|
| 꺼짐 | `StarIcon` 선만(채움 없음), `text-muted-foreground` | 표: 투명 / 머리: `bg-background border-border` |
| 켜짐 | `StarIcon` `fill-current text-brand`(선·채움 모두 brand) | 같다 |
| hover · 꺼짐 | `group-hover/button:text-foreground` | `hover:bg-muted`(버튼 기본) |
| hover · 켜짐 | brand 그대로 | `hover:bg-muted` |
| focus-visible | 바뀌지 않음 | 버튼 기본 `focus-visible:border-ring ring-3 ring-ring/50` |
| 누름 | 바뀌지 않음 | 버튼 기본 `active:translate-y-px` |
| 요청 중 | 누른 뒤 모양 그대로(낙관적) | 흐림·회전 아이콘 없음(D3) |

- 색은 아이콘(`svg`)에 둔다. 버튼에 두면 ghost·outline 의 `hover:text-foreground` 가 켜진 별의 brand 를 덮는다.
- 채움에 애니메이션(크기·튕김)을 넣지 않는다.

### 3.3 요청과 되돌림

1. 누르면 바로 `aria-pressed`·이름·아이콘을 바꾼다.
2. 켜기는 `PUT`, 끄기는 `DELETE` `/api/v1/bids/:id/watch`. 머리글 `CSRF_HEADERS`(`X-Requested-With: sol-radar`), 본문 없음.
3. 응답 전에는 같은 버튼을 다시 눌러도 무시한다. `disabled` + `focusableWhenDisabled`(`LoadMoreFooter` 와 같은 방식, `aria-disabled` 라 초점이 남는다). 다른 행의 ★ 는 따로 움직인다.
4. 200: 응답 `watched` 로 확정한다. 상세는 `watcherCount` 로 인원 수를 바꾼다(D7). `router.refresh()` 를 부르지 않는다 — 더 보기로 붙인 행과 초점이 사라진다.
5. 실패(4xx·5xx·네트워크·본문 형식 오류): 누르기 전 상태로 되돌리고 `toast.error`(T12·T13). 초점은 버튼에 남는다. 인원 수는 바꾸지 않았으므로 그대로다.
6. 서버가 새 관심 id 목록을 내려 주면(필터 변경·새로 고침·다른 화면 다녀옴) 화면이 덮어 둔 값을 버리고 서버 값을 쓴다(`useLoadMore` 의 "첫 쪽이 바뀌면 새 세대" 규칙과 같다).
7. 다른 탭에서 바꾼 것은 다음 서버 읽기 때 맞춰진다.

### 3.4 상태표 — ★ 토글 (세 자리 공통)

| 상태 | 언제 | 보이는 것 | 사용자가 할 수 있는 것 |
|---|---|---|---|
| 꺼짐 | 내 관심 id 에 없음 | 빈 별 `muted-foreground`, `aria-pressed="false"`, 이름 "관심 공고에 추가" | 눌러 추가 |
| 켜짐 | 내 관심 id 에 있음 | 채운 별 `brand`, `aria-pressed="true"`, 이름 "관심 공고에서 빼기" | 눌러 빼기 |
| 요청 중 | PUT·DELETE 응답 전 | 누른 뒤 모양, `aria-disabled="true"`, 초점 유지 | 기다림(다시 눌러도 무시). 다른 행 ★·제목 링크는 그대로 |
| 성공 | 200 | 응답 `watched` 모양. 상세는 "관심 N명" 갱신 | 다시 눌러 반대로 |
| 실패 | 4xx·5xx·네트워크 | 누르기 전 모양으로 되돌림 + 토스트 T12/T13 | 다시 누르기 |
| 취소·마감 공고 | `status` `CANCELLED`·`CLOSED` | 같은 토글(비활성 아님). 상세의 분석 버튼이 비활성이어도 ★ 는 활성 | 추가·빼기 |
| VIEWER | 읽기 전용 역할 | 같은 토글(비활성 아님) | 추가·빼기 |
| 관심 읽기 실패 | 서버가 내 관심 id·요약을 못 읽음 | D15: `/bids`·상세는 ★ 를 그리지 않는다. `/watchlist` 는 오류 화면 | — |

## 4. 화면 명세

### 4.1 `/bids` 표 — ★ 열

```text
1280px, 사이드바 펼침 (본문 960)
┌관심┬출처┬단계───┬제목(144, 2줄)─┬발주기관─┬예산┬마감┬SOL Score┬권고──┬분석 상태┬최종 결정┐
│ ★  │DEMO│입찰공고│세종특별자치시 │세종특별…│12억│D-21│      94 │▲ BID │✓ 완료  │▲ BID   │
│    │    │진행    │차세대 행정정…│         │    │    │         │      │        │        │
│ ☆  │DEMO│사전규격│…             │         │    │    │         │      │        │        │
└────┴────┴───────┴──────────────┴─────────┴────┴────┴─────────┴──────┴────────┴────────┘
★ = 켜짐(brand 채움), ☆ = 꺼짐(muted-foreground 선)
```

| 열 | 폭(셀 여백 포함) | 머리 | 칸 |
|---|---|---|---|
| **관심(새)** | `w-10` 40px | "관심"(`type-label`, `TableHead` 기본 색), `px-1 text-center` | `WatchToggle` 32px, `px-1 text-center` |
| 출처 ~ 최종 결정 | 지금 그대로(80·72·가변·120·80·72·80·88·96·88) | 그대로 | 그대로 |

- 고정 열 합이 776 → 816px 가 된다. 제목 열 = 본문 폭 − 816px.

| 화면 폭 · 사이드바 | 본문(표) 폭 | 제목 열 (지금 → 바뀐 뒤) |
|---|---|---|
| 1280 · 펼침 | 960 | 184 → **144** |
| 1440 · 펼침 | 1120 | 344 → 304 |
| 1280 · 접힘(64) | 1216 | 440 → 400 |
| 1440 · 접힘 | 1376 | 600 → 560 |

- 넘치지 않는 근거: `table-fixed` 라 고정 열은 폭이 그대로이고 제목 열만 준다. 제목 칸은 `whitespace-normal` + `line-clamp-2` + `break-words` 라 좁아져도 칸을 넘지 않고, 전체 제목은 링크 `title` 과 상세에 있다. 머리 "관심"(13px 두 글자, 약 26px)은 내용 폭 32px 안에 든다. 1280 펼침에서 제목 한 줄은 어림 8자(지금 11자)로 준다 — 어느 위치에 두어도 40px 안팎을 쓴다(D1).
- 행 높이: 단계·마감 칸이 두 줄이라 행은 이미 약 56px 다(뼈대 `h-14`). 32px 버튼 + 셀 위아래 10px = 52px 라 행 높이가 늘지 않는다.
- 행 열기와 겹치지 않음: 지금 행에는 클릭 처리기가 없고 상세로 가는 길은 제목 링크 하나다(`bid-table.tsx`). ★ 는 `<a>` 밖, 다른 칸의 `<button type="button">` 이다. 행에 `onClick` 을 더하지 않는다. 더 보기 뒤 초점 이동(`querySelector("a")`)은 제목 링크로 그대로 간다.
- 켜고 끄는 방법: `BidTable` 에 선택 prop 하나(예: `watch`)를 더해 그 prop 이 있을 때만 ★ 열을 그린다. 기본은 끔 — 대시보드 compact 표와 기존 시험(10열 기대)은 바뀌지 않는다.
- 초점 고리: ★ 칸은 다른 고정 열처럼 `overflow-hidden` 이다. 좌우 여백 4px(`px-1`)가 3px 고리를 담으므로 잘리지 않는다(§9 M3). 표 상자(`overflow-x-auto`)에도 맨 왼쪽 4px 여백이 같은 일을 한다.

### 4.2 `/watchlist`

**목적**: 내가 눈여겨보는 공고만 같은 표로 훑고, 마감이 다가오는 것을 놓치지 않는다.

**정보 위계**: ① h1 "관심 공고" + 설명 → ② 필터 막대 → ③ 결과 줄 → ④ 표 → ⑤ 더 보기. `/bids` 와 같다.

```text
1280px, 사이드바 펼침 (본문 960)
관심 공고
내가 관심 표시한 공고만 보입니다. SOL Score는 내부 적합도이며 낙찰 확률이 아닙니다. 최종 참여 결정은 사람이 합니다.
[🔍 제목·기관·공고번호 (240)] [단계 ▾][상태 ▾][권고 ▾][결정 ▾][출처 ▾][정렬 ▾]   [필터 초기화]   ← 넘치면 2줄
공고 4건 표시
┌관심┬출처┬단계───┬제목(144)──────┬발주기관─┬예산┬마감┬SOL Score┬권고──┬분석 상태┬최종 결정┐
│ ★  │DEMO│입찰공고│…             │…        │12억│D-3 │      94 │▲ BID │✓ 완료  │—       │
│ ☆  │…   │        │(방금 해제한 행: 그 자리에 남는다)                                     │
└────┴────┴───────┴──────────────┴─────────┴────┴────┴─────────┴──────┴────────┴────────┘
                                         [더 보기]
```

- 틀: 업무 틀. 파일은 `web/app/(app)/(work)/watchlist/`. `requireWork` 의 돌아올 주소는 `/watchlist` + 쿼리(`/bids` 의 `nextPathOf` 와 같은 방식). 본문 `AppPage contentClassName="max-w-360"`. 동작 자리(주요 버튼)는 없다.
- 필터: `BidFilters` 그대로. 이동은 `usePathname()` 기준이라 `/watchlist` 에 머문다. `watched` 는 막대에 보이지 않고 주소에도 적지 않는다. 상태 선택지에 "마감·취소 포함"이 하나 더 있다(D10).
- 정렬 기본값·출처 기본값은 `/bids` 와 같다(Q3 ①).
- 표: `BidTable` + ★ 열. 표 이름(`caption`, 화면에는 안 보임)은 "관심 공고 목록"(T4).
- 더 보기: `/api/v1/bids?watched=me&<조건>`. [처음부터 보기]는 `/watchlist?<조건>`(지금 `bid-list-more.tsx` 의 `/bids` 고정 두 곳을 경로 prop 으로). 커서 방식이라 해제한 행이 남아 있어도 다음 쪽이 밀리지 않는다.
- 상세 링크: `?list=` 에 `watched=me` 가 들어가 상세가 "← 관심 공고"로 돌아온다(D14, 계획 Task 4).
- 해제한 행: D4 — 그 자리에 그대로(흐리지 않음), 별만 빈 별. 결과 줄 "공고 N건 표시"도 그대로다.

**빈 상태 고르기**(관심 id 개수는 ★ 상태를 그리려고 어차피 읽는다, Q2 ①):

```text
내 관심 id 0개 ───────────────────────────────→ E1 관심 0건
내 관심 id 1개 이상, 표 0건
  ├ 필터를 바꿨다(watched 를 뺀 조건 문자열이 비어 있지 않다) → E2 조건 0건
  └ 기본 조건 그대로 ──────────────────────────→ E3 기본 조건 0건(관심은 있는데 진행 중이 아님)
```

| 빈 상태 | 아이콘 | 제목 | 설명 | 단추 |
|---|---|---|---|---|
| E1 관심 0건 | `StarIcon` | T8 "아직 관심 공고가 없습니다" | T8 설명 | [입찰 공고 보기] `Link` + `buttonVariants({ variant: "outline" })` → `/bids` |
| E2 조건 0건 | `SearchIcon` | T9 "조건에 맞는 공고가 없습니다" | 없음 | [필터 초기화] `Button variant="outline"` → `/watchlist`(지금 `/bids` 고정인 `resetFilters` 를 경로 prop 으로) |
| E3 기본 조건 0건 | `StarIcon` | T10 "진행 중인 관심 공고가 없습니다" | T10 설명(관심 N건) | [관심 공고 모두 보기] `Link` outline → `/watchlist?status=OPEN&status=AMENDED&status=CANCELLED&status=CLOSED&origin=all` |

모양은 `EmptyState`(`web/app/(app)/(work)/empty-state.tsx`) 그대로다. 필터 막대와 결과 줄("공고 0건 표시")은 세 경우 모두 그대로 둔다(상태마다 틀이 튀지 않게).

**상태표 — `/watchlist`**

| 상태 | 언제 | 보이는 것 | 사용자가 할 수 있는 것 |
|---|---|---|---|
| 로딩(첫 진입) | 서버가 읽는 중 | `loading.tsx` 뼈대(§4.5), 제목·설명은 진짜 글자 | 기다림 |
| 정상 | 1건 이상 | 필터 막대, "공고 N건 표시", 표(모든 ★ 켜짐), 다음 쪽이 있으면 [더 보기] | 필터·정렬, 제목으로 상세, ★ 빼기, 더 보기 |
| 필터 바꾸는 중 | 주소 이동 후 서버 응답 전 | 표 `opacity-60` + `aria-busy`(지금 그대로), 필터 막대는 그대로 | 기다림 |
| 해제한 행 | 이 화면에서 ★ 를 끔 | 행은 그대로, 빈 별(D4) | 같은 별 다시 눌러 되돌리기. 다시 읽으면 빠진다 |
| E1 관심 0건 | 내 관심 id 0개 | E1 | [입찰 공고 보기] |
| E2 조건 0건 | 관심 있음 + 필터 결과 0건 | E2 | [필터 초기화] |
| E3 기본 조건 0건 | 관심 있음 + 기본 조건 결과 0건(마감·취소·다른 출처만 있음) | E3 | [관심 공고 모두 보기] |
| 더 보기 중·실패·커서 무효 | `LoadMoreFooter` 상태 | 지금 그대로("불러오는 중…"·"더 불러오지 못했습니다"+[다시 시도]·"목록이 바뀌었습니다"+[처음부터 보기]) | 다시 시도 / `/watchlist?<조건>` 으로 처음부터 |
| 오류 | 목록·관심 id 읽기 실패 | `error.tsx` → `WorkError title="관심 공고"` + 요청 id + [다시 시도](06 §5.1) | 다시 시도 |
| 긴 제목 | 120자 등 | 2줄 말줄임, 링크 `title` 에 전체 | 상세에서 전체 |
| 대량 | 관심 100건 이상 | 20건씩, 더 보기 | 더 보기·필터 |
| 권한 | 모든 역할 | 같은 화면. 역할 안내 없음 | 같다 |
| 1280 미만 | — | 가로 스크롤 허용(틀 기본), 따로 설계하지 않음 | — |

### 4.3 `/bids/[id]` 머리 — ★ 와 "관심 N명"

```text
1440px (본문 1120, 주 영역 776 + 레일 320). AppPage 머리 줄은 items-start 라 동작 자리가 뒤로 링크 줄 높이에 붙는다.
← 관심 공고                                        관심 3명 [☆] [↗ 원문 보기] [↻ 재분석]
[DEMO] [입찰공고] [진행] 출처 나라장터
세종특별자치시 차세대 행정정보시스템 고도화 (가상)
발주기관 세종특별자치시 · 예산 1,200,000,000원 · 마감 2026-11-06 (D-21)
공고번호 DEMO-2026-0001 · revision 1 · 수집 2026-10-16 09:12 KST
```

- 자리(D5): `HeaderActions` 의 버튼 줄(`flex flex-wrap justify-end gap-2`) 맨 앞에 [관심 N명 글자][★]. 순서는 인원 수 글자 → ★ → [원문 보기] → [분석 실행/재분석]. 버튼 줄에 `items-center` 를 더해 글자가 36px 줄 가운데에 온다.
- 인원 수 글자: `type-label text-muted-foreground tabular-nums whitespace-nowrap`, 문구 T11 "관심 N명". 0명이면 글자를 비운다(D6). 줄이 오른쪽 정렬이라 글자가 생기거나 사라져도 ★·다른 버튼은 움직이지 않는다.
- 숫자 갱신(D7): 토글 응답의 `watcherCount` 로만 바꾼다. 낙관적 ±1 은 하지 않는다. 별은 바로 바뀌고 숫자는 응답 뒤에 바뀐다.
- 뒤로 링크(D14): `?list=` 에 `watched=me` 가 있으면 "← 관심 공고"(T15) → `/watchlist?<나머지 조건>`. 없으면 지금 그대로 "← 공고 목록".
- 폭: 동작 자리 `max-w-sm`(384px) 안에서 가장 긴 경우 — "관심 999명"(약 62) + ★ 36 + [원문 보기] 약 108 + [분석 요청 중…] 약 138 + 간격 8×3 = 약 368px — 가 한 줄에 든다(§9 M8). VIEWER 의 역할 안내 줄("분석 요청은 …")은 지금처럼 그 아래 오른쪽 정렬이다.
- 취소 공고·VIEWER: 분석 버튼이 비활성이어도 ★ 는 활성이다.

**상태표 — 상세 머리**

| 상태 | 언제 | 보이는 것 | 사용자가 할 수 있는 것 |
|---|---|---|---|
| 꺼짐 · 0명 | 아무도 관심 없음 | [☆] 만(인원 글자 없음) | 추가 |
| 꺼짐 · N명 | 같은 조직 다른 사람이 관심 | "관심 N명" [☆] | 추가 |
| 켜짐 · N명 | 나 포함 N명 | "관심 N명" [★] | 빼기 |
| 요청 중 | 응답 전 | 별은 바뀐 모양, 숫자는 그대로, `aria-disabled` | 기다림 |
| 성공 | 200 | 숫자 = `watcherCount`(0 이면 글자 비움) | 반대로 |
| 실패 | 4xx·5xx·네트워크 | 별 되돌림, 숫자 그대로, 토스트 T12/T13 | 다시 누르기 |
| 관심 읽기 실패 | 서버가 요약을 못 읽음 | ★·인원 글자 없이 머리를 그린다(D15). 서버 로그 한 줄 | 다른 동작 그대로 |
| 로딩 | `loading.tsx` | 동작 자리 뼈대 앞에 36px 뼈대 하나(D11) | — |

### 4.4 사이드바

- `web/components/app-nav.ts` 의 관심 공고 줄을 `planned` 에서 `released` 로 바꾼다(사람이 코드 리뷰로, 파일 머리 주석 규칙).
- 다른 출시 메뉴와 똑같다: 링크, `/watchlist` 에서 `aria-current="page"`, `sidebar-accent` 바탕 + 트리 세로선 자리 3px `brand` 막대, 업무 묶음은 들어올 때 펼침(`currentNavGroupId`), 접힌 64px 줄에서는 `StarIcon` + 툴팁·`aria-label` "관심 공고". 위 막대 화면 이름은 `screenLabelOf` 가 "관심 공고"를 낸다.
- 사이드바의 별 아이콘은 채우지 않는다. 메뉴 아이콘이지 상태 표시가 아니다.
- 현재 표시는 주소 기준이다(D13). `/bids/[id]` 는 관심 공고에서 열었어도 "입찰 공고"가 현재다.

### 4.5 로딩·오류

- `watchlist/loading.tsx`: `/bids/loading.tsx` 와 같은 뼈대(필터 7칸 + 결과 줄 + 머리 줄 + 10행 `h-14`). 제목·설명은 T1·T2, 낭독 글자 T14. 행 맨 앞에 `size-4 shrink-0` 뼈대 하나(★ 자리)를 더한다(D11).
- `/bids/loading.tsx` 행에도 같은 ★ 뼈대를 더한다. 읽은 뒤 첫 칸이 생기며 행 내용이 40px 밀리는 튐을 막는다.
- 상세 `loading.tsx` 동작 자리 뼈대(`h-9 w-28`·`h-9 w-24`) 앞에 `size-9` 하나를 더한다.
- `watchlist/error.tsx`: `WorkError title="관심 공고" contentClassName="max-w-360"`(`bids/error.tsx` 와 같다).

## 5. 화면 요소 ↔ 데이터·API

| 화면 요소 | 데이터 | 읽는 곳 |
|---|---|---|
| `/bids`·`/watchlist` 행의 ★ 상태 | `listMyWatchedBidIds(scope)` → `string[]` | 서버 컴포넌트가 읽어 클라이언트에 넘긴다(Q2 ①, `BidListItem` 불변) |
| E1 판단, E3 의 "관심 N건" | 위 배열의 길이 | 같다 |
| `/watchlist` 첫 쪽 | `loadBidPage(orgId, { …query, watched: "me" })` | 서버 컴포넌트 |
| `/watchlist` 더 보기 | `GET /api/v1/bids?watched=me&<조건>&cursor=` | `useLoadMore` |
| 상세 ★·"관심 N명" 처음 값 | `getWatchSummary(scope, bidId)` → `{ watched, watcherCount }` | 상세 서버 컴포넌트 |
| 토글 | `PUT`·`DELETE /api/v1/bids/:id/watch` → `{ bidId, watched, watcherCount }` | 클라이언트(`watch-bid.ts`, 계획 Task 6) |
| 토글 실패 | `failureOf(response, body)` | 코드·요청 id 는 토스트에 싣지 않는다(D12) |

누가 표시했는지(사용자 id·이름)는 어떤 응답에도 없다. 화면도 그런 칸을 만들지 않는다.

## 6. 화면 문구

| # | 자리 | 문구 | 상태 |
|---|---|---|---|
| T1 | `/watchlist` h1·`metadata.title`·로딩·오류 제목 | 관심 공고 | 고정(정본 06 §4.1, 스펙 §5) |
| T2 | `/watchlist` 설명 | 내가 관심 표시한 공고만 보입니다. SOL Score는 내부 적합도이며 낙찰 확률이 아닙니다. 최종 참여 결정은 사람이 합니다. | 첫 문장 초안, 뒤 두 문장은 `BIDS_DESCRIPTION` 그대로(D8) |
| T3 | 결과 줄 | 공고 N건 표시 | 지금 그대로 |
| T4 | 표 이름(`caption`, 낭독 전용) | 관심 공고 목록 | 초안 |
| T5 | ★ 열 머리 | 관심 | 초안 |
| T6 | ★ 이름(꺼짐) | 관심 공고에 추가 | 고정 |
| T7 | ★ 이름(켜짐) | 관심 공고에서 빼기 | 고정 |
| T8 | E1 | 제목 "아직 관심 공고가 없습니다" · 설명 "입찰 공고 목록에서 별을 누르면 여기에 모입니다. 관심 표시는 나만 볼 수 있습니다." · 단추 "입찰 공고 보기" | 제목·단추 고정(스펙 §5), 설명 초안 |
| T9 | E2 | 제목 "조건에 맞는 공고가 없습니다" · 단추 "필터 초기화" | `/bids` 그대로 |
| T10 | E3 | 제목 "진행 중인 관심 공고가 없습니다" · 설명 "관심 공고 N건은 마감·취소됐거나 다른 출처 공고입니다." · 단추 "관심 공고 모두 보기" | 초안 |
| T11 | 상세 인원 수 | 관심 N명 | 초안 |
| T12 | 토스트(추가 실패) | 관심 공고에 추가하지 못했습니다. 잠시 뒤 다시 시도하세요. | 초안 |
| T13 | 토스트(빼기 실패) | 관심 공고에서 빼지 못했습니다. 잠시 뒤 다시 시도하세요. | 초안 |
| T14 | 로딩 낭독 | 관심 공고를 불러오는 중… | 초안 |
| T15 | 상세 뒤로 링크(관심 공고에서 연 경우) | 관심 공고 | 초안 |
| T16 | 상태 필터 선택지(D10) | 마감·취소 포함 | 초안 |

금지 글자: 이 화면들의 문구·낭독 글자에 "확률"은 T2 의 "낙찰 확률이 아닙니다" 한 곳뿐이다. "승률"·"수주 가능성"·"%"는 쓰지 않는다. 성공 토스트는 없다(D12).

## 7. 접근성 체크 항목

- [ ] ★ 는 `<button type="button">`. `aria-pressed` 가 `true`/`false`, 이름은 `aria-label` T6/T7, 아이콘 `aria-hidden`.
- [ ] 표의 ★ 는 `aria-describedby` 로 같은 행 제목 링크(id)를 가리킨다. 버튼 목록으로 훑어도 어느 공고인지 들린다. 이름은 고정 문구 그대로다.
- [ ] 상세 ★ 는 인원 수가 있을 때만 `aria-describedby` 로 "관심 N명" 글자를 가리킨다.
- [ ] "관심 N명"을 감싼 요소는 0명일 때도 DOM 에 있고(빈 글자) `aria-live="polite"` 다. 바뀐 수를 읽어 준다. 처음 그릴 때는 읽지 않는다.
- [ ] Enter·Space 로 토글한다(버튼 기본). 누른 뒤·실패 뒤에도 초점이 버튼에 남는다. 요청 중에도 초점을 받는다(`focusableWhenDisabled`).
- [ ] Tab 순서: 표는 행마다 ★ → 제목 링크. 상세는 ← 뒤로 → 배지 → ★ → [원문 보기] → [분석 실행].
- [ ] 초점 고리(3px)가 ★ 칸·표 상자에 잘리지 않는다(§9 M3).
- [ ] 색만으로 알리지 않는다: 켜짐/꺼짐은 채움(모양) + `aria-pressed` + 이름이 함께 바뀐다. 강제 색 모드에서도 `currentColor` 라 채움 차이가 남는다.
- [ ] 대비(비텍스트 3:1 이상): 켜진 별 `brand` 흰 바탕 약 5.4:1, hover `muted` 바탕 약 4.9:1. 꺼진 별 `muted-foreground` 약 7.1:1. "관심 N명"·열 머리 글자(`muted-foreground`)도 4.5:1 이상.
- [ ] 별 채움에 애니메이션 없음.
- [ ] 실패는 sonner 토스트(낭독 영역)로 알린다. 성공은 `aria-pressed` 변화로 들린다.
- [ ] `/watchlist`: h1 하나(`type-title`), 결과 줄 `role="status"` 하나(지금 그대로), 빈 상태 아이콘은 장식(`EmptyState` 기본 `aria-hidden`).
- [ ] 사이드바 "관심 공고"는 `/watchlist` 에서 `aria-current="page"`, 접힌 줄에서 `aria-label`.
- [ ] axe 위반 0건(E2E, 06 §10).

## 8. 토큰·부품 매핑

### 8.1 색 (`design/tokens.json` 만, 새 색 없음)

| 쓰임 | 토큰 클래스 |
|---|---|
| 꺼진 별 | `text-muted-foreground` |
| 켜진 별 | `text-brand` + `fill-current` |
| hover 꺼진 별 | `group-hover/button:text-foreground` |
| 버튼 hover 바탕 | ghost·outline 기본 `hover:bg-muted` |
| 상세 ★ 테두리·바탕 | outline 기본 `border-border bg-background` |
| 초점 | 버튼 기본 `border-ring`·`ring-ring/50` |
| "관심 N명" | `text-muted-foreground` |
| 빈 상태 | `EmptyState` 기본(`border-border`, 아이콘 칸 `bg-muted text-muted-foreground`) |

쓰지 않는 것: `warning`(노란 별 — WATCH·확인 필요와 같은 색), `brand` 바탕 채움, `chart-2`, `demo`.

### 8.2 글자 (앱 틀 기본 눈금만)

| 요소 | 눈금 |
|---|---|
| `/watchlist` h1 | `type-title`(`AppPage`) |
| 설명 | `type-body`(`AppPage`) |
| ★ 열 머리 "관심" | `type-label`(`TableHead` 기본) |
| "관심 N명" | `type-label` + `tabular-nums` |
| 빈 상태 제목 / 설명 | `type-body font-semibold` / `type-label`(`EmptyState`) |
| 결과 줄 | `type-label`(지금 그대로) |

### 8.3 간격 (Tailwind 눈금)

★ 열 `w-10`, 머리·칸 `px-1`. 상세 버튼 줄 `gap-2`(지금 그대로) + `items-center`. 그 밖은 `/bids` 그대로(본문 `gap-6`, 결과 줄과 표 `gap-3`).

### 8.4 부품

| 부품 | 쓰임 |
|---|---|
| `Button`(`ghost` `icon-sm`) | 표 ★ |
| `Button`(`outline` `icon`) | 상세 ★ |
| `Button`(`outline`) | E2 [필터 초기화] |
| `Link` + `cn(buttonVariants({ variant: "outline" }))` | E1 [입찰 공고 보기], E3 [관심 공고 모두 보기] |
| lucide 16px | `StarIcon`(★·빈 상태), `SearchIcon`(E2) |
| `BidTable`·`BidFilters`·`BidListView`·`BidListMore`·`LoadMoreFooter` | 목록(경로·빈 상태·표 이름은 prop 으로) |
| `EmptyState` | E1·E2·E3 |
| `Skeleton` | 로딩 |
| `AppPage`·`WorkError` | 틀·오류 |
| `toast.error`(sonner) | 실패 |

### 8.5 새로 필요한 것 (제안 — 승인 필요)

| 무엇 | 왜 | 넣는 법 |
|---|---|---|
| `WatchToggle`(`web/components/bids/watch-toggle.tsx`, 클라이언트) | 표 행과 상세 머리 두 곳 이상에서 같은 동작을 쓴다(design-system "두 번 이상 쓴 것만"). 계획 Task 6 에 이미 적힌 파일 | `Button` 을 감싼다. props: 공고 id·처음 값·`size`(표/머리)·성공 콜백(상세가 `watcherCount` 를 받는다)·`describedBy` |
| `BidTable` 선택 prop(예: `watch`) | ★ 열을 켠 화면에서만 그린다 | 기본 끔. compact 에서는 무시 |
| `BidFilters` 상태 선택지 선택 prop | D10 "마감·취소 포함"을 `/watchlist` 에서만 | 기본 끔이면 `/bids` 는 지금 그대로. 지금 `status` 판정(`CANCELLED` 포함 여부)보다 `CLOSED` 포함 여부를 먼저 본다 |
| `BidListView`·`BidListMore` 경로·빈 상태·표 이름 prop | 지금 `/bids` 가 세 곳에 고정(`resetFilters`, `restart`, API 주소) | 기본값은 지금 값 |

새 shadcn 부품·새 토큰은 없다.

## 9. 측정 기준 (브라우저 시험·E2E 로 옮길 값)

부품 시험 상자 폭: 표 960(1280·펼침)·1120(1440·펼침)·1216(1280·접힘)·1376(1440·접힘). 상세 1024(1280)·1184(1440). Pretendard 를 받은 뒤 잰다(`bid-detail-view.browser.test.tsx` 의 `document.fonts.load` 방식).

| # | 무엇 | 기준 |
|---|---|---|
| M1 | ★ 열을 켠 표의 머리 | 11개, 순서 `관심·출처·단계·제목·발주기관·예산·마감·SOL Score·권고·분석 상태·최종 결정` |
| M2 | 열 폭 | `[40, 80, 72, 제목, 120, 80, 72, 80, 88, 96, 88]`, 제목 = 상자 − 816(144·304·400·560, ±0.5), `table.scrollWidth ≤ host.clientWidth` |
| M3 | ★ 버튼 크기·자리·고리 | 버튼 32×32, 아이콘 16×16. 버튼 가운데가 칸 가운데(가로·세로 ±0.5). 버튼 사각형을 사방 3px 넓힌 상자가 그 `td` 사각형 안 |
| M4 | 행 높이 불변 | 같은 항목을 ★ 열 켬/끔으로 그렸을 때 행마다 높이가 같다(±0.5) |
| M5 | 머리·칸 넘침 | 모든 `th` 의 `scrollWidth ≤ clientWidth`("관심" 포함), ★ 칸 `td` 도 같다 |
| M6 | compact 표 | 대시보드 compact 두 표의 머리에 "관심" 없음(기존 시험 그대로 통과) |
| M7 | 행 열기와 분리 | `button.closest("a") === null`. ★ 를 눌러도 라우터 이동·링크 클릭 0회. 제목 링크 `href` 그대로 |
| M8 | 상세 머리 한 줄 | `watcherCount=999` + "분석 요청 중…" 상태에서 [관심 999명]·★·[원문 보기]·[분석 요청 중…]의 `top` 이 같다(±0.5). ★ 36×36. 주 영역 616·776, 레일 320 그대로. 상자 가로 넘침 없음(기존 시험 그대로) |
| M9 | 인원 글자 유무와 ★ 자리 | 0명(글자 없음)과 3명일 때 ★ 의 `left` 가 같다(±0.5) |
| M10 | 토글 동작 | 누르면 응답 전에 `aria-pressed`·이름이 바뀐다. 응답 전 다시 누르면 `fetch` 1회. 실패 응답이면 원래 값으로 돌아오고 `toast.error` 가 T12/T13 으로 1회. 성공·실패 뒤 `document.activeElement` 가 그 버튼 |
| M11 | 상세 숫자 | 응답 `watcherCount: 4` → "관심 4명", `0` → 글자 비움. 응답 전에는 이전 숫자 |
| M12 | `/watchlist` 실앱(E2E, 뷰포트 1280×900·1440×900) | 정상·E1·E3 에서 `horizontalOverflow(page) === 0`. h1 "관심 공고" 30px. 사이드바 "관심 공고" 링크 `aria-current="page"`. axe 0 |
| M13 | 빈 상태 | E1·E2·E3 상자 폭 = 본문 폭(960·1120), 단추 높이 36 |
| M14 | 로딩 | 행 뼈대 높이 56(`h-14`), 첫 뼈대 16×16 |

증거 스크린샷(06 §12 이름 규칙): `…-watchlist-loaded-1440/1280.png`, `…-watchlist-empty-1440/1280.png`(E1), `…-bids-list-loaded-1440/1280.png`(★ 열), `…-bid-detail-loaded-1440/1280.png`("관심 N명").

## 10. 서버·다른 작업자에게 필요한 것

1. `/bids`·`/watchlist` 서버 화면은 `listMyWatchedBidIds`, 상세는 `getWatchSummary` 를 부른다(계획 Task 6 의 `work-data.ts` 로더).
2. `/watchlist` 의 `list-query.ts` 는 `search` 에 `watched=me` 를 넣되(더 보기·상세 `?list=`), 빈 상태 판단용으로 `watched` 를 뺀 조건 문자열도 돌려준다(E2·E3 구분).
3. 시험 자리 이름: ★ `data-slot="watch-toggle"` + `data-bid-id`, 인원 수 `data-slot="watch-count"`.
4. E2E 준비 데이터: (가) 관심 0건 계정(E1), (나) 같은 조직 두 사람이 관심인 공고(상세 "관심 2명"), (다) 다른 조직 사용자도 관심인 같은 공고(인원 수가 조직 안 수만인지), (라) 마감 지난 관심 공고만 가진 계정(E3·D10).
5. 9c 의 `bids/page.tsx`·`loading.tsx` 덧붙임(`BidsSourceNav`)과 93 의 `bid-detail-view.tsx` 덧붙임은 계획대로 먼저 병합된 쪽 위에 맞춘다. `/watchlist` 에 `BidsSourceNav` 를 둘지는 §11-3.
6. 정본 반영(06 §4.1 "해커톤 노출" 열·§5.12·§12 라우트 `watchlist`)은 병합 뒤 45 와 절 목록을 합의해서(스펙 §7-6).

## 11. 열린 질문

1. **`aria-pressed` 와 바뀌는 이름을 함께 쓰는 것**(정해진 것이라 그대로 적었다). WAI-ARIA APG 는 토글 버튼의 이름을 상태에 따라 바꾸지 말라고 한다. 지금 조합이면 낭독이 "관심 공고에서 빼기, 전환 버튼, 눌림"이 되어 동작과 상태를 두 번 말한다. 고친다면 (가) 이름을 "관심 공고"로 고정 + `aria-pressed`(추천), (나) 이름만 바꾸고 `aria-pressed` 없음. 바꾸면 T6·T7·M10 과 계획 Task 6 시험 기대값만 바뀐다.
2. **D10 은 Q3 ① 확인과 묶여 있다.** Q3 ①의 "마감·취소된 관심 공고는 상태 필터로 본다"는 지금 필터로는 취소만 된다("취소 포함"은 `CLOSED` 를 더하지 않는다, ADR-031 C15). D10 ③을 고르면 마감 지난 관심 공고는 `/watchlist` 에서 볼 길이 없고, T10 설명에서 "마감"을 빼고 E3 단추를 "취소 포함해 보기"로 바꾼다.
3. 9c 가 `/bids` 에 더하는 `BidsSourceNav` 의 모양을 이 작업 폴더에서 볼 수 없다. 추천은 `/watchlist` 에 두지 않는 것이다(관심 공고는 공고 종류 전환이 아니다).
4. 19 데모 시나리오에 관심 공고 장면이 없다. 넣는다면 S3 끝에 ★ 한 번 → 사이드바 "관심 공고"(약 15초). 넣을지는 12 몫이다.

## 12. 결정 필요 항목

| # | 결정할 것 | 선택지 | 추천 이유 |
|---|---|---|---|
| D1 | 표 ★ 열의 위치·폭·크기 | ① 맨 앞(출처 앞) 40px 열(`w-10 px-1`), 32px ghost 아이콘 버튼, 보이는 머리 "관심" ② 맨 뒤(최종 결정 뒤) 같은 크기 ③ 제목 칸 안 제목 앞 28px 버튼 | ①은 행을 훑을 때 첫 칸에서 내 관심인지 보이고, Tab 이 ★ → 제목 순이다. E2E 는 머리 글자로 칸을 찾아 열 순서에 기대지 않는다. ②는 1440 에서 제목 칸 끝과 ★ 사이가 600px 넘게 벌어져 어느 행인지 놓친다. ③은 제목 글자 폭이 거의 같이 줄고(32px) 링크 옆 버튼이라 잘못 누르기 쉽다. 어느 안이든 1280 펼침 제목 열이 40px 안팎 준다(184 → 144). 28px 버튼·36px 열로 줄여도 4px 만 번다 |
| D2 | 켜진 별 색 | ① `brand` 채움(`fill-current text-brand`) ② `foreground` 채움 ③ `warning`(노란 별) | ①은 design-system 방향 5·06 §3.1 의 "brand = 선택 표시"에 맞고, 안 읽은 알림 점(`bg-brand`)·사이드바 현재 막대와 같은 뜻으로 쓰인다. 상태색과 겹치지 않는다. ②는 꺼진 별(`muted-foreground`, 7:1)과 색 차이가 작아 채움만으로 갈려 훑기 약하다. ③은 WATCH 권고·확인 필요와 같은 색이라 금지다 |
| D3 | 요청 중 표시 | ① 누른 뒤 모양 유지, 같은 버튼은 응답까지 `aria-disabled`(초점 유지)로 연타 무시, 흐림·회전 없음 ② 연타 허용, 앞 요청을 취소하고 마지막 의도만 보냄 ③ 회전 아이콘으로 바꿈 | 요청이 짧고 멱등이라 ①이 가장 단순하다. ②는 PUT·DELETE 응답 순서 경합을 다뤄야 한다. ③은 별 모양(상태)이 잠깐 사라지고 행마다 깜빡인다 |
| D4 | `/watchlist` 에서 해제한 행 | ① 그 자리에 그대로(흐리지 않음), 별만 빈 별, 다음 서버 읽기 때 빠짐, 되돌리기는 같은 별 다시 누르기 ② 흐리게 + "해제됨" 글자 ③ 바로 빼고 [되돌리기] 토스트 | ①은 Gmail 별표 편지함과 같은 방식이고 새 상태가 없다. ②의 흐림(`opacity-60`)은 이미 "다시 읽는 중"(busy) 뜻이라 섞인다. ③은 스펙 §5 위반이고 초점을 잃는다 |
| D5 | 상세 ★·"관심 N명" 자리 | ① 동작 자리 버튼 줄 맨 앞 [관심 N명][★ outline 36][원문 보기][분석 실행] ② 제목 위 배지 줄 끝 ③ h1 옆 | ①은 누르는 것과 바뀌는 숫자가 붙어 있고 다른 동작 버튼과 높이·테두리가 같다. ②는 20px 배지 줄이 32px 로 커져 제목이 밀리고 메타 줄에 동작이 섞인다. ③은 `AppPage` 를 고쳐야 하고 버튼 이름이 h1 낭독에 섞인다 |
| D6 | 0명일 때 | ① 글자를 비움(★ 만) ② "관심 0명" ③ "관심 없음" | 대부분 공고가 0명이라 ②·③은 모든 상세에 같은 소음이다. 줄이 오른쪽 정렬이라 글자가 생겨도 ★ 가 움직이지 않는다(M9) |
| D7 | 숫자 갱신 시점 | ① 토글 응답 `watcherCount` 로만 ② 누르자마자 ±1, 응답으로 다시 맞춤 | 숫자에는 다른 사람이 들어 있어 화면이 짐작하면 틀릴 수 있다. ②는 숫자가 두 번 바뀔 수 있다. 응답이 짧아 늦음이 거의 보이지 않는다 |
| D8 | `/watchlist` 설명 | ① T2(관심 안내 한 문장 + `/bids` 면책 두 문장) ② 관심 안내만 ③ `/bids` 면책만 | 같은 SOL Score 열이 보이므로 면책을 뺄 까닭이 없다. 첫 문장이 `/bids` 와 다른 점을 말한다 |
| D9 | 빈 상태 갈래 | ① E1 관심 0건 · E2 조건 0건 · E3 기본 조건 0건 ② E1·E2 둘(기본 조건 0건도 E2) ③ E2 하나 | 마감·취소된 관심 공고만 남은 사람에게 E2 [필터 초기화]는 눌러도 같은 화면이고, E1 "아직 없습니다"는 틀린 말이다. 판단에 쓰는 관심 id 개수는 이미 읽는다 |
| D10 | 마감 지난 관심 공고 보기 | ① `/watchlist` 상태 필터에만 "마감·취소 포함"(`status` 네 값) 선택지를 더한다 ② `/bids`·`/watchlist` 둘 다 ③ 더하지 않음 | Q3 ①을 지키려면 마감 선택지가 있어야 한다. API 는 `status=CLOSED` 를 이미 받는다(05 §3). ②는 `/bids` 의 ADR-031 C15 를 다시 여는 일이라 이번 범위 밖이다. ③이면 §11-2 대로 문구를 바꾼다 |
| D11 | 로딩 뼈대 | ① `/bids`·`/watchlist` 행 첫 칸에 16px ★ 뼈대, 상세 동작 자리에 36px 뼈대 ② 뼈대는 그대로 | 읽은 뒤 첫 칸이 생기며 행 내용이 40px 밀리는 튐을 막는다(06 §5.1 "레이아웃과 같은 형태") |
| D12 | 토스트 | ① 실패만, 방향별 한 문장(T12·T13), 성공 토스트 없음 ② 성공도("관심 공고에 추가했습니다") ③ 실패를 원인별로(401·404·5xx) | 별이 바로 바뀌는 것이 성공 신호다. 여러 행을 연달아 누르면 성공 토스트가 쌓인다. 알림 읽음 실패(`READ_FAILED`)와 같은 모양이다 |
| D13 | 사이드바 현재 표시 | ① 다른 출시 메뉴와 같은 링크·현재 표시, `/bids/[id]` 는 늘 "입찰 공고" ② 관심 공고에서 연 상세는 "관심 공고"를 현재로 | 현재 표시는 주소 기준 한 규칙(`isCurrentItem`)이다. ②는 사이드바가 쿼리를 읽어야 하고 같은 상세가 두 메뉴에 걸친다 |
| D14 | 상세에서 돌아가기 | ① `?list=` 에 `watched=me` 를 실어 "← 관심 공고" → `/watchlist?<나머지>`(계획 Task 4) ② 따로 `from=watchlist` ③ 늘 "← 공고 목록" | 새 파라미터 없이 기존 `list` 규칙 하나로 된다. 계획 Review Focus 5 와 같다. ③은 `/watchlist` 에서 연 사람을 전체 목록으로 보낸다 |
| D15 | 관심 읽기 실패 | ① 관심이 보조인 화면(`/bids`·상세)은 ★·인원 없이 그리고 서버 로그 한 줄, `/watchlist` 는 오류 화면 ② 세 화면 모두 오류 화면 | 상세의 분석 이력 읽기 실패와 같은 원칙이다(보조 정보 때문에 본 화면을 막지 않는다). `/watchlist` 는 관심이 곧 목록이라 그릴 것이 없다 |
| D16 | 툴팁 | ① 없음(표는 보이는 머리 "관심", 상세는 옆 "관심 N명"이 뜻을 말한다. 이름은 `aria-label`) ② 상세 머리만 `Tooltip landmark` ③ 표·상세 모두 | 표의 행 배지도 툴팁이 없다(`DemoBadge dense`). 행마다 툴팁이 뜨면 hover 할 때마다 소음이다. 0명 상세에서 ★ 혼자 보이는 것이 마음에 걸리면 ②가 다음 안이다 |

## 관련 문서

- [N3 스펙](../../polaris/specs/done/2026-10-21-n3-watchlist.md) — §5 화면, §8 Q2·Q3, §9 엣지 케이스
- [[2026-10-21-n3-watchlist-plan|N3 구현 계획]] — Task 4(`watched=me`·돌아가기), Task 6(화면), Review Focus 5
- [[2026-10-16-sidebar-ia-design|사이드바 정보 구조 설계]] — §2.1·§2.2·§2.4·D6
- [[2026-10-19-c6-screens-design|C6 화면 디자인 스펙]] — §5.3 `/bids` 위계·열 폭
- [[2026-10-20-boost2-what-if-ui|BOOST-2 화면 스펙]] — 형식 견본
- [[06-UI-UX|06 UI]] — §1 폭, §3.1 의미색, §3.3 표, §4.1 사이드바, §5.1 공통 상태, §5.4·§5.5, §10 접근성, §12 증거 이름
- [[05-API-SPEC|05 API]] — §3 `status`·`watched`
- [[16-DECISIONS|16 ADR]] — ADR-007·ADR-021·ADR-031 C15·ADR-042
