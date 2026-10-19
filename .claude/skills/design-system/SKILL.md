---
name: design-system
description: 화면을 만들거나 고칠 때 따르는 디자인 시스템 규칙. 색·글꼴·글자 눈금은 design/tokens.json 정본에서만 오고, 웹 CSS 는 거기서 생성된다. UI 작업 시 항상 적용.
---

# 화면 만들 때 규칙 — 디자인 시스템 잠금

## 방향 — SaaS 제품형

웹(`web/`)은 조밀하고 가는 선으로 나눈 제품 화면이다.

1. **바탕은 흰색, 구역은 가는 선.** 카드는 `border` + `shadow-xs`, 줄 사이는 `divide-border` 다. 면의 색만으로 구역을 나누지 않는다. 첫 화면(마케팅 틀)만 예외다 — 아래 "웹 틀" 표를 따른다.
2. **조밀하게.** 본문 14px, 라벨 13px. 버튼은 기본 36px(작은 것 32·28px, 큰 것 44px), 입력칸 40px, 모서리 8px 이다.
3. **제목이 화면을 이끈다.** `h1` 은 화면에 하나이고 `type-title` 이다. 같은 역할의 글자는 어느 화면에서나 같은 크기다.
4. **주요 버튼은 화면에 하나.** `default`(남색)는 하나만 두고 나머지는 `outline`·`ghost`·링크로 낮춘다.
5. **색은 아낀다.** 버튼은 `primary`(남색)이고 브랜드 색 `brand` 는 차트·선택 표시에만 쓴다(첫 화면에서는 로고 점·선택 막대·점수 막대·인용 바탕·안내 아이콘에도 쓴다). 나머지 위계는 회색 단계로 만든다.
6. **틀 안에 둔다.** 로그인 뒤 화면은 앱 틀(사이드바와 위 막대), 로그인·안내 화면은 인증 틀(화면 가운데의 좁은 단, 로고·카드 없음), 첫 화면은 마케팅 틀(머리말과 바닥글)이다.
7. **아이콘은 `lucide-react`, 16px.** 글자 없이 아이콘만 둔 버튼에는 이름(`aria-label`)을 단다.
8. **장식하지 않는다.** 그라데이션, 알약 배지 머리글, 색 원 번호, 문장 속 색 강조, 지어낸 수치·후기·로고, 동작하지 않는 버튼을 넣지 않는다.

글자 크기는 아래 눈금에서 고른다. `type-<이름>` 클래스를 쓰고, 한 요소에 눈금 클래스 둘을 겹치지 않는다(폭이나 부품 크기 변형으로 바꾸는 `md:type-display`·`group-data-[size=sm]/card:type-body` 는 된다).
`text-<이름>` 으로 만들지 않은 것은 `cn` 이 낯선 `text-*` 를 색으로 보고 색 클래스와 합쳐 지울 수 있어서다.

| 웹 이름 | 크기/줄 높이(px) | 굵기 | 쓰임 |
|---|---|---|---|
| `display` | 64/76 | 700 | 첫 화면 전용: 히어로 큰 제목 |
| `headline` | 44/56 | 700 | 첫 화면 전용: 구역 제목 |
| `subhead` | 28/38 | 700 | 첫 화면 전용: 하위 제목 |
| `title` | 30/36 | 700 | 화면 제목(`h1`) |
| `heading-lg` | 24/34 | 600 | 첫 화면 전용: 큰 카드·구역 소제목 |
| `heading` | 16/24 | 600 | 카드·구역 제목 |
| `lead` | 20/32 | — | 첫 화면 전용: 설명 |
| `body-lg` | 18/30 | — | 첫 화면 전용: 본문 |
| `ui-lg` | 17/26 | — | 첫 화면 전용: 메뉴·버튼·판 주요 글자 |
| `label-lg` | 15/22 | — | 첫 화면 전용: 라벨·배지·인용 |
| `body` | 14/22 | — | 본문 |
| `label` | 13/20 | — | 라벨·메뉴·표 머리 |
| `caption` | 12/16 | — | 날짜·배지 |
| `wordmark` | 20/20 | 800 | 첫 화면 전용: 로고 글자 |


## 토큰 정본

색·글꼴·글자 눈금·자간을 적는 곳은 **`design/tokens.json` 하나**다. 웹의 CSS 는
거기서 **만들어진다**. 두 곳에 적으면 반드시 어긋나기 때문에, 적는 곳을 하나로 줄인 것이다.

```
design/tokens.json  ──pnpm tokens──▶  web/app/globals.css
```

## 반드시

- 색·글자 눈금을 바꾸거나 추가할 때는 **`design/tokens.json` 만** 고치고 `pnpm tokens` 를 돌린다.
- 색 이름은 shadcn 의 짝을 따른다: `<이름>` 은 바탕, `<이름>-foreground` 는 그 위 글자.
  `muted` 는 연한 바탕이고 보조 글자는 `muted-foreground` 다. 테두리는 `border`, 입력칸 테두리는 `input`, 포커스 링은 `ring`.
- `primary` 는 주요 버튼(남색), `brand` 는 브랜드 색(파랑), `accent` 는 메뉴 항목 hover 바탕이다.
  `sidebar-*` 여덟 개는 사이드바 안에서만 쓴다(`web/components/ui/sidebar.tsx`·`web/components/app-shell.tsx`).
- `chart-2` 는 차트의 둘째 계열 색이다(첫째 계열은 `brand`). 막대와 범례 색 칸에만 쓰고 글자·바탕·버튼에는 쓰지 않는다.
- `kakao`·`naver`(와 `-foreground`)는 각 회사 로그인 버튼 가이드의 지정 색이다. 간편 로그인 버튼(`web/app/auth/social-sign-in.tsx`)과 로그인 수단 목록의 회사 표시(`web/components/provider-mark.tsx`)에만 쓰고 값을 바꾸지 않는다.
  네이버 짝(흰 글자/#03A94D)은 대비가 3.09:1 이라 대비 검사에서 예외다 — 대신 가이드 값 그대로인지를 검사한다. 예외는 사람이 정한다(이 짝은 2026-10-15 사용자 결정).
  회사 로고는 브랜드 색 그대로인 정적 파일(`web/public/google.svg`·`kakao.svg`·`naver.svg`)이다.
- 웹에서는 토큰 Tailwind 클래스(`bg-primary`·`text-muted-foreground`), CSS 에서는 `var(--이름)`(`var(--primary)`).
- 글자 눈금은 `typography`(`type-<이름>`)에 적는다. 항목에 `tracking` 이 없으면 전역 `tracking` 을 쓴다.
- 글꼴은 `var(--font-sans)` / `var(--font-mono)`. 지정하지 않고 기본값에 맡기지 않는다.
- 웹 글꼴은 Pretendard 다. 불러오는 자리는 `web/app/layout.tsx` 와 `global-error.tsx` 이고, 못 받으면 `fonts.sans` 의 뒤 후보(시스템 한글 글꼴)로 보인다.
- 글꼴 정본은 `tokens.json` 의 `fonts`(웹 CSS 글꼴 목록, 쉼표로 후보를 잇는다)다.
- 버튼·입력창·카드 같은 반복 부품은 `web/components/` 것을 재사용한다.
- 새 부품·새 토큰이 필요하면 만들기 전에 먼저 물어본다.

## 웹 부품 — shadcn (`web/components/ui/`)

shadcn 부품은 라이브러리가 아니라 **복사해 온 우리 코드**다. 스타일은 `base-nova`(Base UI 기반),
설정은 `web/components.json`. 지금 있는 것: button·input·textarea·label·field·card·dialog·dropdown-menu·select·separator·skeleton·sonner·
sidebar(딸려 온 sheet·tooltip)·avatar·table.

- 방향 2번에 없는 크기: `textarea` 최소 80px, `card` 는 `rounded-xl`·안쪽 여백 24px(`size="sm"` 16px), `dialog` 는 `rounded-xl`,
  `dropdown-menu` 는 `rounded-lg`·항목 32px, `select` 는 트리거 40px(입력칸과 같다)·`rounded-lg`, `sidebar` 는 폭 256px·항목 32px, `table` 머리 줄 40px.
- 더 필요하면 `web` 폴더에서 `pnpm dlx shadcn@latest add <이름>` 으로 넣는다.
- 넣은 뒤 다섯 가지를 확인한다. CLI 는 이 저장소의 규칙을 모른다.
  1. `git diff web/package.json` — 원치 않는 의존성이 붙었는지 본다(예: sonner 를 넣으면 `next-themes` 가 따라온다).
  2. `pnpm check:tokens` — CLI 가 `globals.css` 를 고쳤으면 루트에서 `pnpm tokens` 로 되돌리고, 필요한 색은 `tokens.json` 으로 옮긴다.
  3. `pnpm check:colors` — 새 파일에 `bg-black`·`text-white`·`bg-red-500` 같은 기본 팔레트 클래스나 `oklch(...)` 값이 있으면 여기서 걸린다.
     토큰 클래스로 바꾼다(예: dialog 배경 `bg-black/10` → `bg-foreground/10`).
  4. 원본의 `text-sm`·`text-xs` 는 눈금 클래스(`type-body`·`type-label`·`type-caption`)로 바꾸고, 높이·모서리를 위 크기에 맞춘다.
  5. 딸려 온 훅은 `web/lib/` 로 옮긴다(계층에 `hooks` 가 없다. 예: `sidebar` 의 `web/lib/use-mobile.ts`). 원본이 effect 안에서 `setState` 를 하면 린트가 막으니 고쳐 쓴다.
- `shadcn init` 은 다시 돌리지 않는다. `globals.css` 를 통째로 덮고 layout 에 글꼴을 끼워 넣는다.
- 폼은 `field` 부품 + react-hook-form + zod 로 만든다. 알림은 `sonner` 의 `toast()` 를 쓴다(`<Toaster />` 는 `components/providers.tsx` 에 이미 있다).
- `Link` 를 버튼 모양으로 만들 때 `outline` 이거나 클래스를 덧붙이면 `cn(buttonVariants({ variant: "outline" }), "w-full")` 처럼 `cn` 으로 감싼다.
  그냥 이어 붙이면 바탕의 투명 테두리가 `outline` 의 테두리를 이긴다.

## 웹 틀 — 화면은 넷 중 하나에 넣는다

| 틀 | 파일 | 쓰는 화면 |
|---|---|---|
| 마케팅 | `web/components/site-header.tsx`·`web/components/site-footer.tsx` | 첫 화면 `web/app/page.tsx`. 단 폭 `max-w-320` + `px-10`(글줄 1200px). 머리말 72px 단색 흰 바탕. 본문 바탕 흰색, 제품 화면 무대·권유 띠만 `bg-muted`. 글자는 첫 화면 눈금(`*-lg`·`subhead`·`wordmark`)을 쓰고 13px 미만을 쓰지 않는다. 바닥글은 어두운 바탕(`bg-foreground`·`text-background`, 로고는 `<Logo inverted />`) |
| 인증 | `web/components/auth-frame.tsx` (`AuthFrame`·`AuthHeader`) | 로그인·가입·비밀번호(`web/app/auth/`, 주소 `/auth/login` 등), 팀 만들기(`web/app/teams/new/`)·받은 초대(`web/app/invitations/`), 로그인 필요·연결 없음 안내, 없는 주소·오류. 단 폭 `max-w-100`(400px), 가운데 정렬한 제목 아래에 폼·버튼. 비밀번호 칸은 `web/components/password-input.tsx`(보기·숨기기 버튼) |
| 앱 | `web/app/(app)/[slug]/layout.tsx` + `web/components/app-shell.tsx` | `web/app/(app)/[slug]/` 아래의 로그인 뒤 조직 화면(대시보드·작업·설정·멤버) |
| 관리자 | `web/app/admin/layout.tsx` | 서비스 운영자(`profiles.is_admin`)만 여는 화면. 조직과 상관없어 사이드바 없이 머리 막대(로고·"앱으로 돌아가기") 하나다. 본문은 `AppPage`. 운영자가 아니면 틀이 404 를 낸다 |

- 로그인 뒤 화면은 `web/app/(app)/[slug]/` 아래에 두고 본문을 `AppPage`(`web/components/app-page.tsx` — 제목·설명·동작 자리, 단 폭 `max-w-5xl`)로 감싼다.
  메뉴에는 `app-shell.tsx` 의 `NAV` 에 한 줄 더한다(주소는 지금 조직의 `/<slug>/...`). 로그인 전·DB 없음 안내는 앱 틀의 `layout.tsx` 가 그린다.
- `web/app/(app)/[slug]/` 아래 화면은 `requireWorkspace`(`web/app/(app)/[slug]/workspace.ts`)로 지금 조직을 다시 확인한다 — 내 조직이 아니면 404, 로그인 전·DB 없음은 `redirect("/auth/login")`.
  틀이 안내를 그려도 화면은 서버에서 실행된다 — 틀은 화면 실행을 막지 못한다.
- 앱 틀의 사이드바 맨 위(로고 자리, `SidebarHeader`)는 **조직 전환기**다. 지금 조직의 이름과 둘째 줄("개인" 또는 "팀 · 소유자/멤버")을 보이고,
  메뉴에서 다른 조직·새 팀 만들기·받은 초대로 간다. 받은 초대가 있으면 그 아래 "받은 초대" 줄(`SidebarMenuBadge` 로 개수)을 둔다.
- `main` 은 `AuthFrame`·`AppPage` 가 그린다. 그 안의 화면에서 다시 그리지 않는다.
  건너뛰기 링크(루트 `layout.tsx`)가 가는 `id="main-content"` 도 이 `main` 이 갖는다. 틀(머리말·사이드바)은 `main` 밖에 둔다.
- 버튼 모양이 아닌 링크(로고·문장 속 링크)의 초점 표시는 버튼과 같다: `outline-none focus-visible:ring-3 focus-visible:ring-ring/50`.
  사이드바 안에서는 항목과 같은 `ring-sidebar-ring outline-hidden focus-visible:ring-2` 다.
- 표시 부품(`web/components/`): 로고는 `logo.tsx` 하나이고 마케팅 틀이 쓴다(앱 틀은 그 자리를 조직 전환기가 차지하고, 인증 틀에는 로고가 없다). 통계 카드 `stat-card.tsx` 와 CSS 막대 차트 `bar-chart.tsx` 는
  props 만 받고 데이터를 읽지 않는다. 첫 화면(랜딩) 전용 부품은 `web/components/landing/` 에 모으고, 분석 미리보기는 `product-preview.tsx` 다.
- 견본: 통계·차트·표·활동 피드·빈 상태는 `web/app/(app)/[slug]/dashboard/`, 거르기·정렬·쪽이 있는 데이터 표와 추가·편집 대화상자·상태 메뉴·삭제 확인은 `web/app/(app)/[slug]/tasks/`,
  가는 선으로 나눈 구역 폼은 `web/app/(app)/[slug]/settings/`, 멤버 표와 초대 폼(역할 고르기는 `select`)은 `web/app/(app)/[slug]/settings/members/`.
- 화면 안의 하위 메뉴(설정의 "계정"·"멤버")는 `SettingsNav`(`web/app/(app)/[slug]/settings/`)의 모양을 따른다. 링크 줄(`border-b`) 아래 지금 화면에만 2px 밑줄 막대(`foreground`)를 긋는다.
  경로 이동이라 ARIA 탭(`role="tablist"`)이 아니라 링크 + `aria-current="page"` 이고, Tabs 부품을 쓰지 않는다. 사이드바 `NAV` 에는 더하지 않는다.

## 화면 폭 — 데스크톱 전용

- 최소 폭 1280px, 기준 설계 폭 1440px 이고 1280~1920px 구간만 유동 레이아웃이다(`docs/06-UI-UX.md` §1, ADR-007).
  모바일·태블릿 레이아웃(1280px 미만 breakpoint)은 만들지 않는다. 1280px 미만에서는 가로 스크롤을 허용하고 "데스크톱 화면에서 이용하세요" 안내만 띄운다.
- 화면은 1440px·1280px 두 폭에서 확인한다. 1280px 에서 가로로 넘치면 결함이다.
- 오버레이(대화상자·메뉴)는 화면 안에 들어오고, 넘치는 내용은 그 안에서 스크롤한다. 열리면 바깥 스크롤이 잠겨서
  화면 밖으로 나간 부분에는 닿을 수 없다. `dialog`(높이 `100dvh` 안 + 내부 스크롤)·`dropdown-menu`(`--available-height`)가
  이미 그렇게 되어 있으니 높이 제한을 지우지 않는다. shadcn 으로 새 오버레이를 넣으면 같은 기준으로 확인한다(원본 `dialog` 에는 높이 제한이 없었다).
- 입력칸 글자는 14px 이다(`input`·`textarea` 부품의 `md:type-body`).
- 틀 안의 칸 수는 화면 폭(`md:`)이 아니라 단의 폭(`@container` 와 `@2xl:` 같은 변형)으로 정한다.
  사이드바를 접고 펴면 같은 화면 폭에서도 단의 폭이 달라진다.
- 템플릿에서 온 화면(인증·조직·작업·관리자)에는 좁은 폭 레이아웃과 `web/e2e/responsive.spec.ts` 의 320·375·768·1280px 넘침 검사가 남아 있다.
  새 화면은 이 목록에 더하지 않고 1280·1440px 에서 넘침을 본다(본보기: 첫 화면의 `web/e2e/landing.spec.ts`).
- 부품 레이아웃은 `pnpm -C web test:browser`(`*.browser.test.tsx`)가 진짜 브라우저로 잰다. 오버레이 부품을 고치면 같이 돌린다.

## 절대 금지

- **생성물을 직접 고치기.** `web/app/globals.css` 는 다음 `pnpm tokens`
  에서 덮인다. 손으로 고친 생성물은 `check:tokens` 가 검증·커밋 게이트·CI 에서 잡는다.
- 화면 코드에 색을 직접 적기(`#fff`·`#RRGGBBAA`·`rgba(...)`·`hsl(...)`·`oklch(...)` 등). `scripts/check-colors.sh` 가
  커밋 게이트와 CI 에서 막는다. 앵커는 `href="#이름"` 이나 `"/경로#이름"` 처럼 링크로, SVG 요소 참조는 `url(#이름)` 으로 적으면 색으로 보지 않는다.
- Tailwind 기본 팔레트(`bg-red-500`·`text-white`·`bg-black/50`). 생성된 CSS 가 팔레트를 지워 두어서(`--color-*: initial`)
  이런 클래스는 색이 빠진다. `scripts/check-colors.sh` 가 웹 코드에서 이 클래스를 찾아 커밋 게이트와 CI 에서 막는다
  (변형 접두 `hover:`·`dark:`, 투명도 `/50`, `!` 도 포함). 토큰 클래스로 바꾼다: `bg-black/10` → `bg-foreground/10`,
  `text-white` → `text-primary-foreground`, `bg-red-500` → `bg-destructive`. `tokens.json` 에 같은 이름(예: `white`)을 두면 토큰 클래스라서 통과한다.
- 색 검사는 `web/` 아래 소스 전부(`.ts`·`.tsx`·`.js`·`.jsx`·`.mjs`·`.css`)를 본다. 새 폴더(`web/features` 등)도 등록 없이 본다.
  빼는 것은 의존성·빌드 폴더, 생성물(`globals.css`·`database.types.ts`), 프로젝트 바로 아래 도구 설정(`*.config.*`),
  시험 파일(`*.test.*`·`*.spec.*`·`e2e/`)뿐이다. 안쪽의 `web/lib/theme.config.ts` 같은 파일은 화면 코드로 본다.
- 다크 모드 클래스(`dark:`)에 기대기. 지금 토큰은 라이트뿐이라 `dark:` 는 `.dark` 클래스 아래에서만 켜지게 잠가 두었다.
- 그라데이션 배경.
- 강조색을 여럿 두기. 강조는 토큰 하나로 정하고 그것만 쓴다. 상태색(경고·위험)은 '상태'용이지 장식이 아니다.
- 글꼴을 지정하지 않고 두기.

## 판단

- 처음부터 완벽하게 만들지 않는다. 부품은 **두 번 이상 쓴 것만** 만든다.
- 색을 장식으로 늘리지 않는다. 상태 색은 의미가 있을 때만.
- 브랜드 색을 바꿀 땐 `tokens.json` 의 `brand` 와, 같은 값을 적어 둔 `ring`·`sidebar-ring` 을 고친다. 웹과 앱이 같이 따라온다.
  이게 이 구조를 쓰는 이유다 — 한 번 고치면 두 화면이 같이 바뀐다.
