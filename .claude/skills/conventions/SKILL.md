---
name: conventions
description: 코드를 새로 짜거나 고치기 전에 읽는 공통 규칙. 함수·컴포넌트·유틸을 작성하거나 리팩터링·정리할 때, "코드 규칙", "컨벤션", "어떻게 짜야 해", "이 코드 고쳐줘" 같은 요청 시 사용. const·순수함수·선언형·작은 단위·TypeScript 타입·이름 짓기·ESLint 준수·Prettier 서식을 정한다.
---

# /conventions — 깨끗하고 오래 가는 코드

코드가 무너지지 않게 하는 공통 규칙. AI는 코드를 짤 때 항상 이걸 따른다.

## 1. 변수는 `const` 기본, 로직은 순수 함수
- 재할당하지 않는 변수는 `const`, 재할당이 필요한 변수는 `let`. `const`로 감싼 객체의 속성을 바꿔 `let`을 우회하지 않는다.
- 계산/변환 함수는 **순수 함수**로: 같은 입력 → 같은 출력, 바깥 상태를 바꾸지 않음, 인자를 변형하지 않음.

```ts
// ❌ 명령형 + 변형
const result = [];
data.forEach(x => { if (x.active) result.push(x.name); });

// ✅ 선언형 + 순수
const result = data.filter(x => x.active).map(x => x.name);
```

## 2. 선언형 우선
단순한 변환은 `map`/`filter`를 쓴다. 루프나 재할당이 흐름을 더 명확하게 표현하면 그대로 쓴다. 억지로 `reduce`에 상태를 숨기지 않는다.

## 3. 작게 나눈다
- 함수 하나 = 한 가지 일. 화면 컴포넌트 하나 = 한 가지 책임.
- 길어지면 쪼갠다. 깊게 중첩되면 함수로 빼낸다.

## 4. TypeScript는 안전벨트
- `any` 쓰지 않는다(타입 검사를 꺼버리는 것). 모르면 구체 타입을 만든다.
- 타입 에러는 "고쳐야 할 신호"지 우회 대상이 아니다.

## 5. 이름이 곧 문서
- 약어·모호한 이름 금지. `d`, `tmp` ❌ → `dueDate`, `filteredUsers` ✅
- 불리언은 `is/has/can`으로 시작: `isLoading`, `hasError`.

## 6. 주석은 "왜"만
- 무엇을 하는지는 코드가 말한다. 주석은 **왜 이렇게 했는지**(의도·함정)만 남긴다.

## 7. ESLint 룰은 법이다 — 끄지 말고 코드를 고친다
코드가 룰에 안 맞으면 **코드를 고친다.** 이게 "결정적 검증을 강제한다"의 실천이다(`/verify` 가 검사한다).

- **재할당 없는 `let` 금지** — 1절과 같다. (`prefer-const`)
- **딥임포트 금지** — 도메인은 배럴(`@/server/<도메인>`, `@/server/shared`)로만. (`no-restricted-imports`)
- **부모 상대경로(`../`) 금지** — `@/` 별칭 사용.
- **검사 끄기 금지** — `eslint-disable` 주석은 효과가 없다(`noInlineConfig`). `any`·`@ts-ignore` 금지, `@ts-expect-error` 는 이유를 붙일 때만.
  테스트 `.only`·`.skip`·`.fixme` 금지 — 실패하는 시험은 원인을 고친다.
- `eslint.config.mjs` 에서 규칙을 빼거나 약하게 만들지 않는다(`check:lint-guards` 가 잡는다).
  `web/lodestar.config.ts` 는 클로드가 고칠 수 없다(`.claude/settings.json`). 정말 예외가 필요하면 사용자에게 설정 변경을 요청한다.

## 8. 서식은 Prettier 가 정한다
- 들여쓰기·따옴표·세미콜론·줄 바꿈은 손으로 맞추지 않는다. 정본은 루트 `.prettierrc.json` 하나다.
- 고친 폴더에서 `pnpm format` 을 돌린다(루트·`web`·`mobile` 각자). 검증·커밋 게이트·CI 는 `pnpm format:check` 로 어긋남을 막는다.
- 마크다운(`.md`)·락파일·생성물(`globals.css`·`theme/tokens.ts`·`database.types.ts`)은 대상이 아니다. 빼는 목록은 루트 `.prettierignore` 하나다.
- 서식 설정을 폴더마다 따로 두지 않는다. 바꿀 일이 있으면 루트 `.prettierrc.json` 하나만 고친다.

## 9. 상태는 종류마다 정해진 자리에 (웹)
같은 데이터를 두 곳에 들고 있으면 반드시 어긋난다. 상태마다 둘 곳을 하나로 정해 둔다.

| 상태 | 도구 | 자리 |
|---|---|---|
| 한 컴포넌트 안에서만 쓰는 값 | `useState` | 그 컴포넌트 |
| 서버 데이터(목록·상세) | 서버 컴포넌트에서 가져와 props 로 내린다. 브라우저에서 다시 가져오고 캐시할 때만 TanStack Query를 설치한다 | 도입할 때 `QueryClient` 를 앱 최상단에 하나 둔다 |
| 여러 화면이 같이 쓰는 클라이언트 상태(장바구니, 필터, 패널 열림) | 먼저 props·context로 공유하고, 복잡해질 때만 zustand를 설치한다 | 도입할 때 `lib/stores/<이름>.ts` |
| 폼 입력과 검증 | react-hook-form + zod, 화면은 shadcn `field` | 스키마는 그 폼 옆 |
| 알림 | sonner `toast()` | `<Toaster />` 는 앱 최상단에 하나 |

- **서버 데이터를 zustand 에 복사하지 않는다.** 브라우저 데이터 캐시가 필요해지면 TanStack Query를 도입한다.
- **화면의 zod 검증은 편의, 서버의 검증은 보안이다.** 서버로 들어오는 입력은 서버에서 다시 검증한다.
  `server/<도메인>`·`server/supabase` 는 `server-only` 라서 화면에서 import 할 수 없다. 스키마를 억지로 하나로 합치려 하지 않는다.
- **store 는 서버 렌더 중에 채우지 않는다.** 모듈에 둔 store 는 서버에서 요청끼리 공유된다.
  `set` 은 이벤트 핸들러·effect 안에서만 부른다.
- store 의 계산(합계, 필터 결과 등)은 순수 함수로 빼서 테스트한다(`lib/**/*.test.ts`).
