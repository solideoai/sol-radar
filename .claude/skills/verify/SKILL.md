---
name: verify
description: 코드 변경 후 검증(서식·타입·린트·테스트·구조·토큰·색·빌드)을 실행하고, 통과할 때까지 스스로 고친다. 기능을 추가/수정한 뒤 "다 됐다"고 말하기 전에 반드시 실행. 검증이 초록불이 되기 전에는 작업 완료라고 말하지 말 것.
---

# /verify — 통과할 때까지 스스로 돈다

## 핵심 규칙

**"다 됐어요"라고 말하려면 검증을 통과해야 한다.** 사람이 매번 끼어들어 확인해주지 않아도, AI가 스스로 검증을 돌리고 고친다.

## 어디를 고쳤는지 먼저 본다

이 저장소는 폴더 두 개가 각자 돌아간다. 고친 쪽을 검증한다.

| 고친 곳 | 실행할 것 |
|---|---|
| `web/**` | `pnpm -C web verify` |
| `mobile/**` | `pnpm -C mobile verify` |
| `design/tokens.json` | `pnpm tokens` 로 생성물 갱신 → 양쪽 verify |
| `supabase/migrations/**` | `pnpm db:types` 로 DB 타입 갱신 → 루트에서 `pnpm test:db`(PGlite 에 모든 마이그레이션을 적용해 RLS·권한·트리거 시험)·`pnpm check:db-types` → 쓰는 쪽 verify. 생성물은 마이그레이션과 같은 커밋에 넣는다 |
| `scripts/**`·`.husky/**`·`.claude/hooks/**`·`verify.config.json`·루트 `package.json` | 루트에서 `pnpm test` → `pnpm format:check` |
| `.claude/settings.json`·`.github/**` | 루트에서 `pnpm format:check` |
| 양쪽 다 | 루트에서 `pnpm verify` |

`supabase/` 가 바뀐 커밋에서는 커밋 게이트가 `pnpm test:db` 와 `pnpm check:db-types` 를 돈다. 여기서 먼저 돌려 두면 커밋에서 막히지 않는다.

`pnpm db:push` 는 검증이 아니라 **실제 DB 를 바꾸는 배포 단계**다. 검증 중에는 실행하지 않는다.
적용이 필요하면 사용자에게 어느 DB 에 적용할지 확인받은 뒤에만 실행한다.

## 절차

1. 위 표대로 실행한다.

   ```bash
   pnpm -C web verify      # 서식 → 타입 → 린트 → 테스트 → 구조(lodestar) → 토큰 → 색 → 빌드
   pnpm -C mobile verify   # 서식 → 타입 → 린트 → 테스트 → 토큰 → 색 → Expo 점검 → iOS·Android JS 번들
   ```

   앱의 Expo 점검(`check:expo`, expo-doctor)은 Expo API 연결이 필요하다. 연결이 없으면 통과시키지 않고 실패한다.
   SDK 권장 버전은 설치된 expo 의 목록으로 본다. Expo 가 새 패치를 내도 같은 커밋의 결과는 바뀌지 않는다.

2. **실패하면**:
   - 에러 메시지를 읽는다.
   - 원인을 고친다.
   - 다시 검증한다.
   - **통과(초록불)할 때까지 이 루프를 스스로 반복**한다. 사용자에게 떠넘기지 않는다.

3. **통과하면**: 그때 비로소 "검증 통과했습니다"라고 보고한다.

## 자주 나오는 실패와 뜻

| 메시지 | 뜻 | 고치는 법 |
|---|---|---|
| `Code style issues found` (`format:check`) | 서식이 Prettier 정본(루트 `.prettierrc.json`)과 다르다 | 그 폴더에서 `pnpm format` 을 돌리고 다시 검증한다. 손으로 맞추지 않는다 |
| `디자인 토큰 생성물이 정본과 어긋납니다` | 생성물을 손으로 고쳤거나, `tokens.json` 을 고치고 반영을 안 했다 | 색은 `design/tokens.json` 에만 적고 `pnpm tokens` |
| `앱 글꼴(nativeFonts)이 어긋납니다` | `tokens.json` 의 `nativeFonts` 가 없거나, 키가 빠졌거나, 쉼표 목록을 넣었다(어긋난 곳은 생성물이 아니라 `tokens.json`) | `fonts` 의 키마다 `nativeFonts` 에 `{ "ios": 이름, "android": 이름 }` 을 하나씩 적고 `pnpm tokens` |
| `화면 코드에 색이 직접 적혀 있습니다` | `#fff`·`#RRGGBBAA`·`rgba(...)`·`oklch(...)` 를 화면에 박았다 | 토큰을 쓴다. 새 색이면 `tokens.json` 에 추가. 앵커라면 `href="#이름"` 이나 `"/경로#이름"` 처럼 링크로, SVG 요소 참조라면 `url(#이름)` 으로 적으면 통과한다 |
| `Tailwind 기본 팔레트 클래스가 있습니다` | `bg-red-500`·`text-white`·`bg-black/50` 같은 기본 팔레트 클래스를 썼다(`globals.css` 가 팔레트를 지워 두어 색이 빠진다) | 토큰 클래스로 바꾼다(`bg-black/10` → `bg-foreground/10`, `text-white` → `text-primary-foreground`). 새 색이면 `tokens.json` 에 추가하고 `pnpm tokens` |
| `DB 타입 생성물이 마이그레이션과 어긋납니다` | 마이그레이션을 더하고 `pnpm db:types` 를 안 돌렸거나, 생성물을 손으로 고쳤다 | `pnpm db:types` 로 다시 만들고 생성물을 함께 스테이징한다 |
| `DB 정책 테스트가 실패했습니다` | 새 마이그레이션이 RLS·권한을 깨뜨렸거나, PGlite 흉내에 없는 것(`create extension` 등)에 기댄다 | 실패한 시험을 읽고 마이그레이션을 고친다. 흉내가 모자라면 `database` 스킬의 PGlite 절을 따른다 |
| `[차단] Expo 점검(expo-doctor) 실패` + `should NOT have additional property` | `app.json` 에 지금 SDK 가 없앤 속성이 남아 있다 | 지적된 속성을 `mobile/app.json` 에서 지운다. 기본값이 된 설정이면 지워도 동작이 같다 |
| `[차단] Expo 점검(expo-doctor) 실패` + `Patch version mismatches` | 설치된 패키지가 설치된 expo 의 권장 목록과 다르다(패키지 하나만 올리거나 내렸다) | `pnpm -C mobile exec expo install --fix` 로 맞추고 `package.json`·`pnpm-lock.yaml` 을 함께 커밋한다 |
| `Expo API(...)에 닿지 않습니다` | Expo 점검은 네트워크가 필요한데 연결이 없다 | 연결을 확인하고 다시 돌린다. `EXPO_DOCTOR_WARN_ON_NETWORK_ERRORS` 같은 값으로 건너뛰지 않는다(점검이 걷어낸다) |
| `Layer "ui" cannot import from "infra"` | 화면이 DB 접속 코드를 직접 불렀다 | 도메인(`server/<이름>`)을 거친다 |
| `is never reassigned. Use 'const' instead` | 재할당 없는 변수에 `let`을 썼다 | `const`로 바꾼다. 실제 재할당이 필요하면 `let`을 쓴다 |
| `Unexpected any` · `@ts-ignore` · `'it.only' is restricted` · `has no effect because you have 'noInlineConfig'` | 검사를 끄거나 건너뛰는 길을 썼다 | 타입을 정확히 적고, 실패하는 시험은 원인을 고친다. 주석으로 끄는 길은 없다. 꼭 필요한 예외는 사용자에게 설정 변경을 요청한다 |
| `린트 가드레일이 약해졌습니다` | `eslint.config.mjs` 에서 검사 끄기를 막는 규칙이 빠졌다 | 빠진 규칙을 되돌린다. 예외를 직접 열지 않고 사용자에게 요청한다 |
| `도메인 내부 파일을 직접 import하지 마세요` | 배럴을 건너뛰고 안쪽 파일을 불렀다 | `@/server/<도메인>` 만 부른다 |

## 왜 이렇게 하나

빌드가 되는지, 타입이 맞는지, 린트를 지키는지는 **정답이 하나라 기계가 판별**할 수 있다(결정적 작업).
이런 건 AI 말을 믿지 말고 **자동 검사로 강제**한다.

커밋 시점에도 한 번 더 막는다(`.husky/pre-commit`). 다만 커밋 게이트는 **빌드를 뺀 빠른 검사**(`verify:quick`)와 바뀐 곳에 걸린 루트 검사만 돌고,
빌드와 앱의 Expo 점검은 CI 가 본다. 바뀐 곳마다 무엇을 도는지와 CI 구성은 `docs/guardrails.md` 가 정본이다.
