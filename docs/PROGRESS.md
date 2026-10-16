---
title: "진행 상황"
status: draft
tags:
  - sol-radar
  - progress
updated: 2026-10-16
---

# 진행 상황

## 구현 Phase

해커톤 컷(데모 필수 / 있으면 좋음 / 이후)은 [[12-ROADMAP|12 로드맵]]을 따른다.

- [ ] Phase 0 monorepo/Compose/CI
- [ ] Phase 1 DB/Auth/RBAC
- [ ] Phase 2 ingestion/normalization (fixture 20건)
- [ ] Phase 3 Next.js UI (데스크톱 전용)
- [ ] Phase 4 eligibility/SOL Score
- [ ] Phase 5 Kev/Qwen adapters (mock 먼저, 실모델은 feature flag)
- [ ] Phase 6 review/notifications (인앱)
- [ ] Phase 7 QA/deployment (demo 프로필)

## 문서 개선 (2026-10-16, 해커톤 심사 관점 감사)

심사(사람 5인 + Claude Fable 5.1) 관점에서 격차 20건을 찾아 4개 세션이 파일을 나눠 수정했다. 격차 목록과 배정은 세션 핸드오프 문서에 있고, 결과는 아래 로그에 적는다.

- [x] 해커톤 전략 문서 신설 ([[18-HACKATHON]])
- [x] 용어집 신설 ([[20-GLOSSARY]])
- [x] 인덱스를 MOC로 전환, 주장·근거 표 추가 ([[00-README]])
- [x] 데모 시나리오 신설, 07 fixture ID(FX-01~20)와 대조 ([[19-DEMO-SCENARIO]])
- [x] 03/04/05/15 계약 구체화 (Qwen `RequirementExtraction` 스키마·프롬프트, Kev 질문 세트 `kev-qs/v0.1`, gateway `POST /extract`·`POST /kev`, ENUM 19종, DTO·오류 코드, 인용 검증 알고리즘) — 세션 c6
- [x] 06/07/08/11 데모 표면 (데스크톱 화면 명세·토큰·와이어프레임, fixture `FX-01`~`FX-20`·mock 추출·mock Kev, SOL테크 프로필·worked example 3건, 골든 `G1`~`G10` 매핑·데모 체크리스트) — 세션 a3
- [x] 01/02/09/10/12/13/14/16/17 제품 정의·운영·ADR (모바일·결제 제외, 차별점·가설 지표, 책임 있는 AI·고지 문구, `demo`/`ai-local`/`ai-hosted` 프로필·기동 12단계·장애 주입, 해커톤 컷, ADR-007~014) — 세션 5d
- [x] 전 문서 frontmatter·위키링크·관련 문서 절 적용, 깨진 링크 0건, 표 안 파이프 이스케이프 0건, 용어·숫자 교차 검사(FX-02 72점 분해, Kev 분포, seed 집계, 계정 5개, `@v1.0`) 통과
- [ ] 해커톤 공식 심사 기준·마감일 입력 ([[18-HACKATHON]] §4, [[12-ROADMAP]])

## hosted 모델 API 사용 승인 기록

[[16-DECISIONS|ADR-010]]에 따라 유료 hosted 모델 API(`AI_PROVIDER=hosted`, `AI_HOSTED_APPROVED=true`)는 사용자 승인 후에만 켠다. 승인마다 아래에 기록한다.

| 날짜 | 승인자 | 공급자·모델 | 목적 | 예상 비용 | 결과 |
|---|---|---|---|---|---|
| — | — | — | 아직 승인 없음 | — | — |

## 작업 로그

| 날짜 | Phase | 변경 | 검증 | 남은 문제 |
|---|---|---|---|---|
| 2026-10-16 | 문서 | Kev 저장소 실재·라이선스·API·실행 명령 확인. 18/20 신설, 00·CLAUDE·PROGRESS 개편. 세 세션에 03~17 분배 | 웹 검색·README 확인 | 해커톤 공식 기준 미확인, 한국어 도메인 Kev 성능 미검증, 조달청 API 필드 미검증 |
| 2026-10-16 | 문서 | 4개 세션 병렬 수정 완료. 660줄 → 3,954줄. 충돌 정리: FX-12는 격리(조직 소유 아님), 계정 5개 `.invalid` 도메인, gateway 엔드포인트 `/extract`+`/kev`, Kev 임계 0.70, 배너 문구 09 verbatim, 골든 G1~G10 / 데모 S0~S7, FX-20은 SEED 배치, seed 리뷰 2건, mock Kev 파일 20건 명시 | 스크립트 검사(frontmatter·위키링크·표 파이프·이메일·폐기 용어·배너 문구) 0건, 핵심 숫자 교차 grep 일치 | Obsidian 실제 렌더 미확인(Mermaid 11블록), git 미초기화, 해커톤 공식 기준·마감 미입력, OpenRouter 등 hosted 공급자 미확인 |
| 2026-10-16 | 문서 | vault를 `sol-radar` 저장소 `docs/`로 이전(원본 `sol-radar-docs`에서 복사). 템플릿 문서 11개를 `docs/boilerplate/`로 옮기고 분류(`boilerplate/README.md`, 번호 문서 우선). 템플릿 문서를 가리키던 27개 파일의 경로 갱신(`polaris/specs/done`은 지난 기록이라 유지). `.gitignore`에 Obsidian 개인 상태, `.prettierignore`에 `docs/.obsidian/`, Obsidian 제외 목록에 `boilerplate/` 추가. 루트 README 문서 링크를 `docs/`로 변경 | 링크 검사(마크다운 링크·위키링크 573개·`docs/boilerplate` 경로 47개) 이동으로 깨진 것 0건, `pnpm format:check` 통과, `pnpm test` 177/177, `pnpm verify:quick` 통과 | 미커밋. 원본 `sol-radar-docs` 삭제 여부 미정. 루트 `AGENTS.md`·템플릿 코드(Supabase·Expo)와 번호 문서 스택(NestJS·Prisma, 모바일 범위 외) 충돌 미해결. `06-UI-UX` 버튼 표기 `[수집 실행](ADMIN만)` 등 4곳이 마크다운 링크로 렌더됨 |
| 2026-10-16 | 문서 | 루트 지침 우선순위 정리(ADR-015). 루트 `CLAUDE.md`가 `@docs/CLAUDE.md`를 먼저 불러오고 우선순위 절 추가. `AGENTS.md` 맨 앞에 설계 문서 우선 안내. `docs/CLAUDE.md` 경로를 저장소 루트 기준(`docs/…`)으로 통일. 스택은 NestJS + Prisma 유지(사용자 확인) | 링크 검사, `pnpm format:check`, `pnpm test` | 미커밋. `.claude/` 스킬·에이전트와 템플릿 코드는 여전히 Supabase·Expo 전제(우선순위 규칙으로만 덮음). 작업 중 외부에서 `polaris/`·`scripts/template/`·`.github/workflows/template.yml` 삭제됨(이 작업 아님) |
| 2026-10-16 | 문서 | `sol-radar-docs` → `docs/` 이전 후 남은 옛 위치 참조 점검. `00-README` PROGRESS 행의 "모노레포에서는" 표현을 저장소 경로로 수정 | 저장소 전체 `sol-radar-docs` 문자열 검색(작업 로그 외 0건), `docs/` 경로 실재 확인, 위키링크·`boilerplate/` 상대 링크 깨짐 0건 | 없음(남은 `docs/…` 미존재 경로는 외부 URL·Phase에서 만들 `docs/evidence/`·테스트 fixture) |
| 2026-10-16 | 문서 | 모바일·결제 제외 지침 보강. 기존 규칙(`docs/CLAUDE.md`, 17 절대 규칙, ADR-007)은 "모바일 레이아웃"·"해커톤 범위"로만 적혀 있어 `docs/CLAUDE.md`에 네이티브 앱(`mobile/` Expo)·모바일 에이전트 미사용·확인 폭(1440·1280)·결제 패키지 포함을 명시. ADR-007을 해커톤 이후 포함으로 확장(사용자 확인). 루트 `AGENTS.md` 머리에 한 줄 추가 | `pnpm format:check` | 템플릿 `mobile/` 폴더·`verify.config.json`의 mobile 등록·`.claude/agents/` 모바일 에이전트는 남아 있음(정리 여부 미정) |
| 2026-10-16 | 문서·web | 웹 상태·검증 라이브러리 확정(ADR-016). zod는 이미 `web/`에 있어(4.6.5) 그대로 두고 zustand 5.0.15를 `web/`에 설치. 16에 ADR-016, 06 §11에 사용 범위(공유 UI 상태만, 서버 데이터·URL 필터 제외) 추가. `AGENTS.md` 기술 스택, `conventions` 스킬 상태 표, `docs/boilerplate/setup.md`의 "필요할 때만 설치" 문구 갱신 | `pnpm verify` | `apps/web`(Phase 0) 생성 시 의존성 이전 필요. 아직 store 코드 없음 |
| 2026-10-16 | 정리 | 템플릿 모바일 앱 제거(ADR-007). `mobile/` 폴더(추적 24개 파일과 무시된 `node_modules`·`dist`·`.expo`), 모바일 에이전트 5개(`mobile-designer`·`qa-mobile`·`qa-mobile-device`·`e2e-mobile`·`test-mobile`) 삭제. `verify.config.json`에서 mobile 프로젝트 제거. 지운 에이전트를 가리키던 `AGENTS.md`·`e2e-healer`·`frontend-developer`·`test-deployment`·`test-server` 참조 정리. `docs/CLAUDE.md` 문구 갱신 | `pnpm verify` 통과(게이트 시험의 `mobile 검증`은 폴더가 없어 건너뜀) | 루트 `format:check`의 `"!mobile/**"`는 게이트 시험이 본문을 고정해 유지. 편집 금지 파일(`.claude/settings.json` 모바일 허용 규칙, `.husky/pre-commit`·`.github/dependabot.yml` 언급)과 템플릿 문서·스킬·스크립트의 mobile 분기는 폴더가 없으면 건너뛰므로 그대로 둠. 웹 Playwright의 `mobile`(Pixel 7) 프로젝트는 템플릿 웹 코드 정리 때 처리 |
| 2026-10-16 | 정리 | 웹 Playwright의 `mobile`(Pixel 7) 프로젝트 제거(ADR-007). `web/playwright.config.ts`·`web/playwright.auth.config.ts`에서 프로젝트와 `chromium-write`의 의존을 빼고, `e2e-auth/org-switcher.spec.ts`의 휴대폰 사이드바 분기 삭제. `e2e-web` 에이전트·`testing` 스킬 설명 갱신 | `pnpm verify` 통과(웹 Vitest 600/600, 빌드), `pnpm -C web test:e2e` 110/110·브라우저 시험 48/48, 로그인 뒤 E2E는 `--list`로 프로젝트가 `setup`·`chromium`·`chromium-write`만 남은 것 확인(로컬 Supabase가 없어 실행은 안 함) | 템플릿 시험의 320px 폭 검사(`e2e/responsive.spec.ts`, `site-header`·`team-settings`·`admin`·`settings-account`·`admin-status` 시험의 `setViewportSize`)는 남아 있음. 템플릿 웹 코드 정리 때 처리 |
