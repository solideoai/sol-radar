---
name: architecture
description: 코드 구조와 아키텍처 의사결정 가이드. 어디에 코드를 둘지, 데이터를 어떻게 저장할지, 서버/클라이언트 중 무엇으로 할지, 컴포넌트를 언제 쪼갤지 등 "설계 판단"이 필요할 때 참조. 결정적/비결정적 의사결정 프레임을 포함한다.
---

# /architecture — 잘 자라는 구조로 짓는다

이 스킬은 **오래 가는 제품**을 만들기 위한 구조·의사결정 가이드다.

## 1. 의사결정 프레임 (모든 설계 판단의 첫 질문)

어떤 결정이든 먼저 둘로 나눈다.

- **결정적(기계가 채점 가능)** — 빌드 되나, 타입 맞나, 테스트 통과하나, 린트 지키나.
  → **자동 검증으로 강제**한다. 사람 판단에 맡기지 않는다. (`/verify`, `.husky/pre-commit`가 이 역할)
- **비결정적(판단이 필요)** — 어떤 구조로 갈지, 데이터를 어떻게 둘지, 무엇을 먼저 만들지.
  → **결정 전에 탐색 범위를 좁힌다.** 선택지를 2~3개로 줄이고, **가장 단순하고 되돌리기 쉬운 것**을 고른다.

> 황금률: **되돌리기 쉬운 결정은 빠르게, 되돌리기 어려운 결정은 늦게.**
> 비개발자일수록 "지금 가장 단순한 것"을 고르고, 정말 필요해질 때 키운다.

## 2. 코드는 어디에 두나 (폴더 구조)

`web/`(Next.js)은 루트와 따로 설치하는 독립 프로젝트다. 루트에서 가져다 쓰는 것은 `supabase/`(스키마)와 `design/tokens.json`(색·글꼴·글자 눈금)이다.

```
web/
  app/                      # 화면(라우트). 되도록 얇게 — 데이터를 받아 컴포넌트에 넘기는 정도
    page.tsx
    <기능>/page.tsx
    (app)/(work)/<기능>/page.tsx  # SOL RADAR 업무 화면(/dashboard·/bids·/notifications·/admin/ingestion). 주소에 조직이 없고 (work)/layout.tsx 의 업무 틀 안에서 열린다. 화면마다 requireWork
    (app)/[slug]/<기능>/page.tsx  # 템플릿에서 이어 쓰는 조직 화면(설정·작업). [slug] 는 주소의 조직, [slug]/layout.tsx 안에서 열린다(주소에 (app)·(work) 는 나오지 않는다)
    <기능>/actions.ts       # 서버 함수("use server"). 서버에서 돌아야 하는 저장·변경이 있을 때만
    api/<이름>/route.ts     # 라우트 핸들러. 바깥(웹훅·다른 서비스)이 부르는 HTTP 주소가 필요할 때만
  components/               # 재사용 UI 조각. shadcn 부품은 components/ui/
  lib/                      # 브라우저에서도 쓰는 도구(브라우저용 Supabase 클라이언트·cn). server/shared 만 import
  server/<도메인>/          # 도메인 로직과 저장 — 아래 "서버 코드라면"
  server/supabase/          # 서버 쪽 DB 접속(인프라). 도메인이 부른다
  server/shared/            # 도메인 여럿이 같이 쓰는 순수 함수(이름 규칙 nameOf 등). 아무것도 import 하지 않는다
```

**배치 원칙: 코드는 자신이 다루는 관심사를 소유한 곳에 둔다.**
- 도메인 규칙·계산·변환 → `web/server/<도메인>/`
- 화면 없이 브라우저에서도 쓰는 작은 도구 → `web/lib/` (도메인 로직은 두지 않는다 — `server/shared` 밖을 import 할 수 없다)
- 보이는 것 → `web/components/`
- 라우트(`web/app/`)는 조립만. 로직을 라우트에 욱여넣지 않는다.

**의존 방향(한 방향으로만, 웹은 `web/lodestar.config.ts` 가 커밋에서 강제):**

| 층 | 경로 | 부를 수 있는 것 |
|---|---|---|
| 화면 | `web/app/**` | components · 도메인 · shared · lib |
| 부품 | `web/components/**` | 도메인 · shared · lib |
| 도구 | `web/lib/**` | shared |
| 도메인 | `web/server/<도메인>/**` | infra(`server/supabase`) · shared |
| infra | `web/server/supabase/**` | shared |
| 공통 | `web/server/shared/**` | 없음 |

- 도메인은 배럴 `@/server/<도메인>` 으로만 부른다. 도메인·infra 파일은 `import "server-only"` 로 시작하므로 클라이언트 컴포넌트(`"use client"`)에서는
  부를 수 없다 — 서버 컴포넌트에서 받아 props 로 넘기거나 서버 함수를 쓴다. (`server/shared` 는 `web/lib/` 도 부르는 자리라 브라우저에서도 돌 수 있게 둔다.)
- 거꾸로(로직이 화면을 import) 가지 않는다. 그래야 안 엉킨다.

## 3. 자주 하는 결정 — 레시피

**데이터를 저장해야 하나?**
1. 한 브라우저 안에서만 남으면 되는 값(화면 설정·작성 중인 입력·최근 본 것) → `localStorage`. 서버·DB 가 필요 없다.
2. 여러 기기·여러 사람이 함께 봐야 하는 값 → **Supabase 표**. `supabase/migrations/` 에 새 파일로 만들고 RLS 정책으로 잠근다(`database` 스킬).
   이 프로젝트는 처음부터 Supabase 를 쓴다. **다른 DB 를 새로 들이지 않는다.**

**서버가 필요한가? (클라이언트 vs 서버)**
- 데이터 읽기·쓰기만이면 서버가 필요 없다. 화면에서 Supabase 를 직접 부르고(`getSupabaseBrowser()`), 권한은 RLS 정책이 지킨다.
  계산·검증이 얽히면 `web/server/<도메인>` 을 거친다(`database` 스킬 5절).
- 비밀키(외부 API 키·`service_role`)를 써야 하거나 남의 눈에 로직을 숨겨야 하면 서버에서 한다. Next 16 에서는 두 자리다
  (근거: `web/node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`·`15-route-handlers.md`):
  - **서버 함수**(`"use server"`, `web/app/<기능>/actions.ts`) — 우리 화면이 부르는 저장·변경. 직접 POST 로도 불릴 수 있으니 안에서 로그인을 확인한다.
    `web/components/` 의 클라이언트 컴포넌트에는 props 로 넘긴다(부품 층은 `app/` 을 import 할 수 없다).
  - **라우트 핸들러**(`web/app/api/<이름>/route.ts`) — 바깥(웹훅·다른 서비스)이 부르는 HTTP 주소.
  - 둘 다 얇게 두고 도메인 로직은 `@/server/<도메인>` 에 둔다. 데이터 접근 제어는 서버 코드가 아니라 RLS 정책이 한다.
- 그 외 화면 동작 대부분 → 클라이언트 컴포넌트로 충분.

**컴포넌트를 쪼갤 때**
- 한 파일이 화면에서 "두 가지 이상의 일"을 하면 분리.
- 같은 UI가 두 번 반복되면 `web/components/`로 추출.
- 너무 일찍 쪼개지 않는다 — 두 번째 등장할 때 추출(성급한 추상화 금지).

**새 기능을 추가할 때**
- 먼저 만들 범위를 한 줄로 좁힌다(스펙이 있으면 그것을 근거로).
- 저장이 필요하면 `supabase/migrations/` 새 파일 → 로직은 `web/server/<도메인>/` → UI 는 `web/components/` → 화면은 `web/app/`.
- 한 번에 하나씩, 매번 `/verify`. 여러 단계·여러 영역에 걸치면 스펙과 계획부터 세워 단계로 나눈다(`AGENTS.md` 표준 흐름).

## 4. 같은 문제 두 번 겪지 않기
- 같은 버그·실수가 반복되면, 다음에 또 안 나도록 **구조로 박는다**: 검증에 항목 추가, 또는 규칙을 `conventions`에 한 줄 추가.
- "조심하자"는 다짐(비결정적)을 "검사로 막기"(결정적)로 옮기는 것이 핵심.

## 함께 보기
`conventions`(코드 규칙) · `database`(저장·RLS) · `design-system`(디자인 시스템) · `verify`(검증) · `predeploy-review`(배포 전 점검)

## 서버 코드라면
저장·외부연동이 필요한 웹 서버 코드는 `web/server/<도메인>/` 아래 도메인별로 둔다. **견본은 `web/server/profile/`** 이다
(로그인 견본 — 화면 `web/app/auth/`(로그인·가입·재설정)·`web/app/(app)/[slug]/settings/`(프로필)). 새 도메인은 이것을 따라 짓는다.
여러 행을 다루는 데이터 표(조직의 행 여러 개 — 거르기·정렬·쪽, 추가·편집·상태 바꾸기·삭제)는 **`web/server/task/`** 를 따른다(화면 `web/app/(app)/[slug]/tasks/`).
URL 쿼리는 모델의 `parseTaskListQuery` 가 조건으로 바꾸고(잘못된 값은 기본값), 쪽은 서버에서 나눈다(`TASK_PAGE_SIZE`).
요약 수치는 목록을 읽어 앱에서 세지 않는다: DB 집계 함수 `task_dashboard_stats` 하나 → 모델의 순수 함수 `toTaskDashboard` → `getTaskDashboard`(서비스) → 화면 `web/app/(app)/[slug]/dashboard/`. 화면은 세지 않고 조립만 한다.
DB 트리거가 남긴 기록을 읽어 문장으로 바꾸는 읽기 전용 도메인은 **`web/server/activity/`** 다(`getRecentActivities`, 쓰는 함수가 없다).
조직·멤버십·초대는 **`web/server/organization/`** 에 있다(화면 `web/app/(app)/[slug]/settings/members/`·`web/app/teams/new/`·`web/app/invitations/`).
서비스 운영자(`profiles.is_admin`)만 여는 화면의 도메인은 **`web/server/admin/`** 이다(화면 `web/app/admin/`, 운영자가 아니면 404).
업무 화면(`web/app/(app)/(work)/` 아래)은 저마다 `requireWork(next)`(`web/app/(app)/(work)/work.ts`)로 로그인·가입 완료·업무 조직 하나를 확인해 `orgId`·`role`(`sol_role`) 맥락을 받는다. 주소에 조직이 없다(ADR-021).
조직(템플릿) 틀(`web/app/(app)/[slug]/layout.tsx`)과 그 아래 화면은 `getMyWorkspace(slug)` 로 주소의 조직이 내 조직인지 확인한다(`web/app/(app)/[slug]/workspace.ts` 의 `requireWorkspace`, 아니면 404).
작업·활동 도메인은 조직 도메인도, 서로도 부르지 않는다 — 화면이 확인한 지금 조직을 `TaskScope`·`ActivityScope` 로 넘겨 잇고, 대시보드 화면이 두 도메인을 각각 불러 조립한다.
도메인 여럿이 같은 규칙을 쓰면 `web/server/shared/` 로 옮긴다(만든 사람·사용자 이름의 `nameOf`).
프로필에는 고치기(쓰기) 견본도 있다: 폼(`web/app/account/display-name-form.tsx`) → 서버 함수(`web/app/account/actions.ts`) → `updateMyDisplayName`(검증·로그인 확인) → repo.
예상한 실패(틀린 입력·로그인 안 함)는 던지지 않고 결과 값으로 돌려준다 — 운영에서 서버 함수가 던진 오류의 message 는 브라우저로 가지 않는다.

```
web/server/profile/
  profile.model.ts          # 순수 타입·규칙. 저장·화면을 모른다
  profile.model.test.ts     # 모델 옆에 테스트
  profile.repo.ts           # 저장. 요청마다 await getSupabase()(@/server/supabase). 규칙은 두지 않는다
  profile.service.ts        # 흐름. 모델과 저장을 잇는다. 저장은 인자로 받는다(기본값이 profileRepo)
  profile.service.test.ts   # 서비스 옆에 테스트. repo 와 같은 모양의 가짜 객체를 넘긴다
  index.ts                  # 배럴. 바깥에 공개할 것만 내보낸다
```

- 접근 통제는 RLS 가 한다. 그래서 저장을 갈아 끼우는 포트 인터페이스·메모리 어댑터·`wiring.ts` 는 두지 않는다 —
  가짜 저장으로는 RLS 를 시험할 수 없고, "누가 무엇을 읽는가"는 DB 정책 시험(`scripts/database.test.mjs`)이 본다.
  저장소가 정말 둘이 될 때(외부 API 를 갈아 끼우는 등) 그때 포트를 만든다.
- 규칙이 없으면 `service` 를 만들지 않고 `index.ts` 가 `repo` 의 함수를 내보내도 된다. 규칙이 생기면 그때 `service` 로 옮긴다.

파일 시스템 어댑터는 만들지 않는다. 컨테이너·서버리스 어디서든 요청 사이에 파일이 남는다고 가정하지 않는다(첨부는 MinIO, `docs/10-DEPLOYMENT.md`).
Supabase 클라이언트는 요청마다 부르고 모듈 변수에 담아 두지 않는다(다른 사람의 요청에 로그인이 섞인다 — `database` 스킬).

모든 파일은 `import "server-only";` 로 시작한다. 바깥(`web/app/`·`web/components/`)은 `index.ts` 만 import 한다.
경계를 넘는 import 는 lodestar 가 커밋에서 막는다 (`web/lodestar.config.ts`). 저장 규칙은 `database` 스킬.
