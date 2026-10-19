---
name: help
description: 이 환경의 사용법을 상황에 맞게 안내한다. "뭐부터 해", "어떻게 해", "도움말", "모르겠어", "막혔어" 같은 요청 시 사용.
argument-hint: '[주제]'
---

# /help — 도움이 필요할 때

사용자의 **현재 상태**를 파악해서 맞춤형으로 안내한다. 매뉴얼을 덤프하지 않는다.

## 사용법

```
/help              → 현재 상태를 보고 다음에 할 일을 안내
/help 커맨드       → 커맨드 목록과 간단한 설명
/help review       → /predeploy-review 사용법 상세
/help 에러         → 에러 해결 도움
/help <아무 질문>  → 관련 안내
```

## 실행 흐름

### 1. 현재 상태 파악

다음을 조용히 확인한다 (결과를 나열하지 않는다). **가볍게 본다** — 빌드가 들어 있는 `pnpm verify` 같은 검증은 여기서 돌리지 않는다.
검증 결과가 궁금하면 사용자에게 `/verify` 를 권한다.

```bash
# 환경이 깔려 있는가? (읽기 전용, 없는 플랫폼은 건너뛴다)
pnpm run doctor

# 미션이 있는가?
test -f polaris/mission.md

# 스펙이 있는가? (진행 중 → 계획 순으로)
ls polaris/specs/in-progress/ polaris/specs/planned/ 2>/dev/null

# 변경사항이 있는가?
git status --short
```

doctor 가 보는 것과 종료 코드는 `docs/boilerplate/setup.md` 의 "1. 설치" 절이 정본이다. 실패(`✗`)는 결과의 해결 명령으로 안내하고,
경고(`!`, 예: Node 24 가 `.nvmrc` 22 와 다름)는 알려만 준다. `HUSKY=0` 의 훅 검사 건너뜀을 활성화 성공으로 읽지 않는다.
doctor 통과는 `/verify` 통과를 대신하지 않는다.

### 2. 상태별 맞춤 안내

#### 환경이 아직 안 깔렸음 (doctor 의 버전·의존성·훅·생성물 검사 실패)
> "먼저 `/setup`으로 환경을 확인하고 사용법을 훑어볼까요? 1~2분이면 끝납니다."

설치 순서(루트·`web` 두 곳에서 따로, ZIP 이면 `git init` 먼저)와 게이트 설치 실패의 처리는 `docs/boilerplate/setup.md` 의 "1. 설치" 절을 읽고 그대로 안내한다.
Supabase 설정은 선택이다. DB 설정 없이도 시작 화면은 열리므로 env 누락을 초기 설치 실패로 판단하지 않는다.
설치 후 `pnpm run doctor` → 있는 플랫폼의 개발 서버 → `/verify` 또는 `pnpm verify` 순서로 안내한다.

#### 환경은 깔렸고 미션·스펙이 없음

> "이제 만들고 싶은 것을 말씀해 주시면 바로 시작할 수 있어요. 작은 일은 바로 만들고, 큰 일은 `/interview` → `/spec`(`polaris/specs/planned/`) → 계획 순서로 나눠 만듭니다."

Polaris 플러그인은 같은 자리를 쓰는 선택 도구라서 설치를 권하거나 설치 여부를 확인하지 않는다.

#### 미션·스펙이 있음 (구현 전)
> "스펙까지 준비됐어요. 화면 하나·표 하나 같은 작은 일이면 바로 구현을 시작하고, 여러 단계에 걸친 일이면 단계별 계획부터 세울게요."

#### 구현 중 (변경사항 있음)
> "작업 중이시네요. 끝내기 전에 `/verify` 로 검증하고, 막히면 뭐가 막혔는지 말해주세요."

#### 변경사항 없음 (커밋까지 끝남)
> "작업이 정리돼 있어요. 배포하기 전이라면 `/predeploy-review` 로 점검하세요."

### 3. 항상 포함하는 정보

상태 안내 후에 아래를 **짧게** 덧붙인다:

> **핵심 흐름**: 작은 일은 구현 → `/verify` → `/predeploy-review`, 큰 일은 `/interview` → `/spec` → 계획 → 단계별 구현 → 검증 → `/predeploy-review`
>
> 더 궁금한 게 있으면 편하게 물어보세요. "이거 어떻게 해?", "에러가 나요", "뭐가 잘못된 거야?" 뭐든 좋습니다.

## 특정 주제 도움

### `/help 커맨드` 또는 `/help 명령어`

`docs/boilerplate/workflow.md` 의 "슬래시 명령" 절을 읽고, 이름을 불러 쓰는 명령의 표와 그 아래의 규칙 스킬·외부 스킬 안내를 그대로 보여준다.
표를 여기에 따로 적어 두지 않는다. 명령이 바뀌면 그 문서 한 곳만 고친다.

스펙의 정본 자리는 `polaris/specs/` 다(`/spec` 이 쓴다). Polaris 는 같은 자리를 쓰는 선택 플러그인이다(AGENTS.md "미션 & 스펙").

설치 상태 점검은 `pnpm run doctor`(기계 JSON: `pnpm --silent run doctor --json`)다. 데모 기동은 `docs/10-DEPLOYMENT.md` 를 안내한다. 배포처는 미결정이라(`docs/16-DECISIONS.md` 미결정 8번) `docs/boilerplate/first-deployment.md`(Vercel)는 안내하지 않는다.
템플릿 원본에만 있는 `pnpm bootstrap`·`pnpm smoke:template` 은 이 저장소에 없으니 안내하지 않는다.

### `/help review` 또는 `/help predeploy-review`

`predeploy-review` 스킬(`.claude/skills/predeploy-review/SKILL.md`)의 "사용법"과 프로필 표를 읽고 안내한다.
프로필마다 언제 쓰면 좋은지는 그 스킬의 파일 패턴 표로 설명한다. 이름이 `/review` 가 아닌 이유도 거기 있다.

### `/help 에러` 또는 에러 메시지를 포함한 질문

에러 메시지를 분석해서 해결 방법을 안내한다. 흔한 에러:

- **"pnpm: command not found" / 버전 불일치** → `docs/boilerplate/setup.md` 의 "준비물" 대로 Node·pnpm 을 맞추게 안내(`corepack enable`)
- **"타입 에러" / 커밋 차단** → 에러 위치를 찾아서 수정 방법 안내
- **"모듈을 찾을 수 없습니다"** → `pnpm run doctor` 의 결과를 보고 해당 폴더에서 `pnpm install --frozen-lockfile` 안내
- **"NEXT_PUBLIC_SUPABASE_URL" 가 없습니다** → DB 를 실제로 쓰는 기능이라면 `web/.env.example` 을 보고 `web/.env.local` 을 채우게 안내 (`database` 스킬). 시작 화면만 여는 데는 DB 설정이 필요 없다. 로컬 DB 면 루트에서 `pnpm db:start` 가 `web/.env.local` 을 채운다.

### 그 외 자유 질문

사용자가 "이거 어떻게 해?" 같은 자유 질문을 하면, 가장 관련 있는 스킬이나 가이드로 연결한다. 복잡한 설명 대신 "이렇게 하면 됩니다" + 1~2줄 예시.

## 톤

- **친절하되 간결하게.** 장문을 피하고, 핵심만.
- **"모르겠어도 괜찮아요"** 느낌. 비개발자가 부담 없이 물어볼 수 있게.
- **매뉴얼이 아니라 대화.** "다음은 이것입니다" 말고 "이거 해보시겠어요?"
- 사용자가 구체적으로 물어볼수록 구체적으로 답한다. 뭉뚱그려 물으면 큰 그림만.
