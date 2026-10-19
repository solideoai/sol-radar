---
name: testing
description: 무엇을 테스트하고 무엇을 테스트하지 않을지의 기준과 작성법. 웹은 Vitest. 테스트 추가·수정, "테스트 어떻게 짜지", 계산 로직 검증 시 사용.
---

# testing — 로직·권한·사용자 흐름을 검증한다

## 무엇을 테스트하나

| 대상 | 테스트 | 이유 |
|---|---|---|
| 계산·변환·검증 (순수 함수) | **한다** | 정답이 하나라 기계가 채점할 수 있다 |
| 도메인 서비스 (`server/<도메인>`) | **한다** | 서비스의 규칙이 여기 있다 |
| 화면 동작 | 핵심 흐름은 E2E | 화면 진입·상호작용·오류·접근성을 검증한다 |
| 외부 서비스 연결 경계 | 한다 | 키 선택·입력·에러 매핑은 우리 코드의 책임이다 |

**AI가 만든 계산은 특히 테스트한다.** 그럴듯한 숫자를 자신 있게 내놓는 것이 AI의 실패 방식이라,
사람이 눈으로 검사하기 가장 어려운 자리다.

## 절대 규칙

> **테스트가 실패하면 테스트를 고치지 말고 코드를 고친다.**

테스트를 지우거나 기대값을 결과에 맞추면 검사가 사라진다. 기대값이 정말 틀렸다면 왜 틀렸는지
먼저 말로 설명하고, 그 다음에 고친다.

그리고 **테스트가 진짜 도는지 한 번은 확인한다.** 코드를 일부러 망가뜨렸을 때 빨간불이 뜨지
않으면, 그 테스트는 아무것도 지키지 않고 있다.

## 웹 — Vitest

```bash
pnpm -C web test
```

파일은 대상 옆에 둔다: `server/<도메인>/<도메인>.model.ts` → `server/<도메인>/<도메인>.model.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { monthlyTotal } from "./billing";

describe("monthlyTotal", () => {
  it("연간 구독을 12로 나눠 월 환산한다", () => {
    expect(monthlyTotal([{ price: 120000, cycle: "yearly" }])).toBe(10000);
  });

  it("빈 목록은 0", () => {
    expect(monthlyTotal([])).toBe(0);
  });
});
```

## 어떤 경우를 쓰나

- **평범한 경우** 하나. 이게 없으면 나머지는 의미가 없다.
- **경계**: 빈 목록, 0, 하루 차이, 월말.
- **틀린 입력**: 음수, 없는 값. 어떻게 실패해야 하는지도 규칙이다.

한 테스트는 한 가지만 본다. 이름은 무엇을 기대하는지 그대로 쓴다 —
`it("연간 구독을 12로 나눠 월 환산한다")` 처럼.

## 타입이 계약인 자리는 타입 시험으로 고정한다

생성된 DB 타입이 붙은 Supabase 클라이언트처럼 타입이 빠지면(`any`) 조용히 무너지는 자리는 타입 시험을 둔다.
웹은 Vitest 의 `expectTypeOf` 와 `// @ts-expect-error`(없는 표·열은 오류여야 한다)를 쓴다(`web/lib/supabase-browser.test.ts`).
이 단언은 실행이 아니라 `type-check`(tsc, `pnpm -C web type-check`)가 잡는다.

## 같은 에러가 두 번 나오면

고치기 전에 **재현하는 테스트를 먼저 남긴다.** 그래야 세 번째가 없다.

## 커밋 게이트와의 관계

`server/`·`lib/` 아래 파일을 만들었는데 테스트가 없으면 커밋할 때 경고가 뜬다.
**막지는 않는다** — 화면 코드나 설정 파일일 수도 있어서다. 계산이라면 그 자리에서 추가한다.
배럴(`index`)·저장소(`*.repo*.ts`)·타입만 담는 파일(`*.types.ts`, 생성물 `database.types.ts` 포함)은 경고에서 뺀다.

바뀐 곳마다 커밋 게이트와 CI 가 어떤 시험을 돌리는지는 `docs/boilerplate/guardrails.md` 의 "커밋 게이트가 보는 것" 표가 정본이다.

## 기본 검증 기반

- 웹 단위 테스트는 `**/*.{test,spec}.{ts,tsx}`를 찾는다. `e2e/`는 Playwright가, `*.browser.test.tsx`(부품 레이아웃)는 `pnpm -C web test:browser`(Vitest 브라우저 모드)가 담당한다.
- 웹 테스트가 0개이면 실패한다. 테스트를 추가할 때 실제로 탐색되는지 확인한다.
- `pnpm test`는 `scripts/` 아래의 `*.test.mjs` 전부를 실행한다(무엇이 있는지와 템플릿 원본에만 있는 `scripts/template/` 의 시험은 `docs/boilerplate/guardrails.md`).
  DB 정책 시험(`scripts/database.test.mjs`)만 돌리려면 `pnpm test:db`.
- DB 정책 시험은 PGlite 에 실제 마이그레이션을 적용한다. Supabase Auth HTTP 서비스 자체를 재현하지는 않는다. 흉내의 범위와 넓히는 법은 `database` 스킬에 있다.
- 새 표의 정책을 만들었으면 "남의 행이 안 보인다"는 시험을 `scripts/database.test.mjs` 에 함께 더한다.
- `pnpm -C web build && pnpm -C web test:e2e`: 프로덕션 서버의 첫 화면·404와 공개 경로의 가로 넘침(`e2e/responsive.spec.ts`, 1280·1440px. 새 공개 경로는 그 목록에 더한다)을 데스크톱(chromium) 프로젝트로 검사하고, 이어서 부품 레이아웃 시험(`test:browser`)을 돌린다. 첫 실행은 `pnpm -C web exec playwright install chromium`이 필요하다.
- `pnpm -C web build && pnpm -C web test:e2e:auth`: 로그인 뒤 E2E(`web/e2e-auth/`, 설정 `web/playwright.auth.config.ts`). 로컬 Supabase 에 시드(`pnpm db:seed`)를 다시 넣고 시드 계정으로 로그인해 돈다.
  로컬 Supabase 가 있어야 해서 `verify`·커밋 게이트·CI 에는 없다. 로그인 뒤 화면을 바꿨으면 직접 돌린다. 시험은 한 번의 시드 위에서 서로의 단언을 깨지 않게 쓴다.
- 화면에 시험용 경로를 만들지 않는다. 부품 하나의 레이아웃(위치·크기·스크롤)을 재야 하면 부품 옆에 `<부품>.browser.test.tsx` 를 둔다(`components/ui/dialog.browser.test.tsx`).
- 시각적 완성도는 QA에서 확인한다. 자동 테스트 통과가 실기기·실서비스 검증을 대신하지 않는다.
