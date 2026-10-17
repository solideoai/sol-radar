---
title: "진행 상황"
status: draft
tags:
  - sol-radar
  - progress
updated: 2026-10-17
---

# 진행 상황

## 구현 Phase

해커톤 컷(데모 필수 / 있으면 좋음 / 이후)은 [[12-ROADMAP|12 로드맵]]을 따른다.

- [ ] Phase 0 템플릿 정리/Compose(redis·minio·qdrant·ai-gateway·worker)/CI/Supabase 연결
- [ ] Phase 1 Supabase migrations·RLS·`sol_role`/seed/Supabase Auth·RBAC
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

## 솔리데오 인력·가입 정보 (ADR-019)

- [x] 인터뷰·대화 설계 최종 승인: 회사 솔리데오 고정, 가상 명부 200명, 동일 팀명 합산·원본 비율·팀별 최소 1명, 한글 세 글자 자연스러운 이름·원본 일치 0, 남녀 100/100, 고유 정장 사진 200장, 부서·직급/직책 필수 가입·간편 가입 보완.
- [x] 승인 스펙·정본 문서에 저장 경로·DB/가입 계약·가상 데이터 경계·PPL-01~07 검증 기준 반영.
- [x] 구현 계획 초안·자체 검토: [명부·카탈로그](plans/2026-10-16-solideo-people-data.md), [정장 사진 200장](plans/2026-10-16-solideo-people-portraits.md), [DB·가입·검증](plans/2026-10-16-solideo-people-signup.md). 사용자가 에이전트 분담·작업별 독립 검토 방식으로 실행을 승인했다. 구현 진행 중이며 전체 완료를 뜻하지 않는다.
- [x] 조직도 추출·부서/직급 카탈로그: 원본 250행을 배분 가중치 175행·비팀 구역 제외 75행으로 분류, 정확한 표시명 38개·직급 12개. 미분류·중복·원본 이름 유출 0, 작업별 독립 검토 통과.
- [x] `fixtures/people/solideo.{departments,job-titles,people,portraits}.json` 및 최소 공개 가입 카탈로그 생성·원본 대조. 가상 200명·남녀 100/100·계산 대상 27명·가용 20 FTE 보존, 데이터 단계 `pnpm verify` 및 명부·카탈로그 작업별 독립 검토 통과.
- [x] imagegen 고유 정장 프로필200장 생성·AI 품질 검사 완료(별도9663 worktree, 남녀100/100, GENERATED200).
- [x] 위200명 이름·얼굴의 실제 사람 최종 승인·READY200 전환·코드 worktree 통합·release 검사. 승인 snapshot과 원본 PNG SHA-256 200개를 재대조했고 기존 AI 검수는 별도 보존했다.
- [x] 카탈로그·가입 신고 필드·가상 인력 seed/RLS migration 및 생성 타입. Task1/2 독립 리뷰 통과; 실제 로컬 최종 재검증은 별도.
- [x] 가입 폼·프로필 보완·업무 화면/Server Action 가드·계정 관리 호환 구현 및 Task3 독립 리뷰 통과. 현재 v1 업무 REST 엔드포인트는 없으며 재사용 API 가드 계약만 단위 검증.
- [x] 전체200명→계산27명 snapshot, 고정 창20FTE·배정 경계와 별도 worked-example 요소94/72/68 순수 회귀 구현. 전체 점수 엔진 골든은 Phase4 미완료.
- [x] 기존 계획 코드의 가입/보완 로컬 E2E·verify/browser/E2E/authE2E·seed멱등·1440/1280 독립 QA. 공개130·브라우저89·인증92 PASS; QA-01/02 수정·별도 리뷰 후 관련 검사 재실행. [실행/미실행 기록](evidence/people/20261016-people-integration.md).

- [x] 최신 정본 04·05·06·09·16과 ADR-021의 이번 가입·DB 범위 정합화 및 격리 실제 코드 QA. 인력 표 분리·부서 계층·가입 개인 조직 생성 중단·멤버십 기반 조직 결정. 공유 DB 충돌 migration 적용/main 병합 금지, 기존 작업·다른 세션 파일 보존.
- Task 7 저장 변경(격리 worktree): 새 가입은 프로필만 생성하고 TEAM/기존 null kind만 신고 허용. 이전 개인 조직·소유권·작업과 카탈로그 삭제 SET NULL 보존을 PGlite 141개, 개인 공간 없는 seed 호환을 HTTP mock 12개, 프로필·세션 API 계약을 60개 테스트로 확인했다. 후속 Task 8 라우팅과 함께 독립 검토·격리 실제 Supabase 코드 QA를 완료했다(아래2026-10-17 기록). 사진 release와 전체 ADR-021 완료를 뜻하지 않는다. 공유 DB 적용·seed 실행·main 병합은 하지 않았다.

원본은 저장소 밖 `sol-radar-inputs/people.xlsx`. 명부는 생성·원본 대조했으며 로그인 5계정과 별개다. 이 worktree의 사진 manifest는 READY200이며 승인된 원본 PNG 200장을 고정 공개 경로에 통합했다. [사람 승인 기록](evidence/people/20261017-portraits-approval.json)과 [기존 AI 검수 이력](evidence/people/20261016-portraits-review.json)은 구분해 보존한다. [데이터 검증 증거](evidence/people/20261016-people-data.json)의 로컬 원본 대조와 CI의 `sourceComparison: "not-run"`을 구분한다. 기존 계획과 ADR-021의 이번 DB·가입 정합화 코드 QA는 통과했다. 전체 N1/N2 등 후속 범위는 남아 있다. 전체 점수 파이프라인은 미완료다. 스펙: [솔리데오 인력·가입](../polaris/specs/planned/2026-10-16-solideo-people-signup.md).

## 실데이터 파이프라인·모델 평가 (ADR-020)

- [x] 설계 승인: [실데이터 AI 파이프라인 v0.2](plans/2026-10-16-ai-pipeline-finetune-design.md)(사용자 결정 U1~U15, 메인 세션 결정 M1~M23).
- [x] 정본 반영: 00~12·15~20, 새 문서 [[21-MODEL-TRAINING]], [[16-DECISIONS|ADR-020]](ADR-004·008·012 개정, 미결정 1·2·3·4 갱신, 16~20 추가).
- [ ] P0-0 외부 의존성 조기 점검: data.go.kr 서비스키 발급(사용자 작업)·오퍼레이션별 실제 응답 3건, 공고 3건 첨부 실제 다운로드, 회사 GPU 터널·vLLM·`kev.serve` 기동·VRAM, 실제 RFP 샘플로 파서 후보 비교.
- [ ] P0-1~P0-8 실데이터 파이프라인(실행 모드 3종, 나라장터 수집, 첨부·파싱, Qwen 실추출, 규칙, Kev-9B v0.2 참고 지표, 점수·설명·대시보드, 사전규격·발주계획).
- [ ] P0-9~P0-11 평가 트랙(평가셋 test 20·dev 10 사업, E0·E1·E2 리포트와 오류 분석, 학습셋 번들·LoRA 메모리 검증 스크립트).
- 해커톤 이후: Kev-9B LoRA(F1~F3, 오류 분석에서 모델 판단 오류가 주된 원인일 때), `sol-v0.2.x` Kev 반영 검토, Qwen 파인튜닝(조건부).

## 사이드바·업무 확장 (ADR-021)

- [x] 설계 승인(사용자 4차): [사이드바 정보 구조와 입찰 업무 확장](plans/2026-10-16-sidebar-ia-design.md). 입력은 사용자 계획서 [[SIDEBAR-PLAN]].
- [x] 정본 반영(기준 커밋 `22b788e`): 12·16·06·05·04·01·11·19·09·02·20·08·13·07·14·10, [솔리데오 인력 스펙](../polaris/specs/planned/2026-10-16-solideo-people-signup.md). [[16-DECISIONS|ADR-021]] 채택(설계 승인, 구현 전), ADR-018·019 개정, 미결정 11·12번 종결. 부록 B 보완 G1~G19는 설계 문서 §8.
- [ ] 데모 필수 N1 앱 셸: 사이드바 정보 구조(구현·검증된 메뉴만), 조직 주소 없는 경로·서버 조직 결정, 사용자 메뉴, `/ops` 분리.
- [ ] 데모 필수 N2 설정: 개인 탭, 조직 탭(ADMIN).
- [ ] 데모 필수 N4a 조직·인력 조회(`/people`): 200명 조직도·명부·개인 상세·사진.
- [ ] 데모 필수 N8 데이터 수집 관리(`/admin/ingestion`).
- [ ] 데모 필수 N9 대시보드 카드 5개(다섯 번째 "분석 현황").
- [ ] P1(데모 필수 완료·핵심 시험 통과 뒤, 이 순서): N3 관심 공고 → N5 분석 결과 비교 → N6 입찰 프로젝트 → N7 인력 배치 시뮬레이션 → N4b 조직·인력 편집.

> 2026-10-16 ADR-021 동기화 당시 기록(아래 후속 구현/통합 QA로 해소):
>
> 남은 일: Codex 가입 작업(`5ece7c0`, main 미병합)의 마이그레이션은 동기화 전 04를 따라 `team_members` 한 표·`target_count` 필수·부서 계층 없음·개인 조직 생성 유지다. 새 마이그레이션으로 ADR-021에 맞춰야 한다(설계 문서 §8 G17). 명부 JSON에는 부서 계층(설계 문서 부록 A)이 아직 없다.

현재는 추가 migration00003/00004와 계층 카탈로그·운영/평가 분리·신규 가입 profile만 생성 정책이 b3ef에 구현·검증됐다. 공유 DB에는 적용하지 않았다. [최신 통합 결과](evidence/people/20261017-portraits-integration.md).

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
| 2026-10-16 | 문서 | 아키텍처 전환(ADR-017, 사용자 결정): NestJS·Prisma·자체 JWT → Next.js(`web/`, Route Handler `/api/v1`, `web/server/<도메인>`, worker `web/worker`) + Supabase(Postgres·RLS·Auth). MinIO·Qdrant·Redis/BullMQ·Python AI·Compose 유지. 개발 DB·Auth는 Supabase 클라우드(Pro). 00~20 전 문서·`docs/CLAUDE.md`·루트 `CLAUDE.md`·`AGENTS.md` 머리절·README·`docs/boilerplate/README.md` 갱신: `organization_id`→`org_id`, 업무 역할 `memberships.sol_role`, service role은 worker·seed만, 세션 쿠키는 `@supabase/ssr`(HttpOnly 아님, CSP nonce), `/health/ready` 503 규칙(db·redis·storage), 시험은 Vitest·PGlite 정책 시험·Playwright, seed는 `pnpm demo:reset`. ADR-001·002 폐기, ADR-015·016 경로 갱신, 미결정 8~15 추가 | 낡은 표현 grep(남은 것은 fixture 기술 목록·ADR 이력·용어 대응표·부정문), frontmatter·위키링크·표 파이프 검사, 로그인 경로·seed 줄·503 규칙 교차 확인 | 미결정 11~15(현재 조직 고르기·구성원 관리 권한 기준·가입 방식·로그인 감사 지점·`pg_trgm`), 05의 새 `DELETE /admin/users/:id`(비활성화→조직에서 내보내기) 확인 필요, mermaid 렌더 미확인, 미커밋 |
| 2026-10-16 | 화면 | 템플릿 랜딩을 SOL RADAR 첫 화면으로 교체(`web/app/page.tsx`, `web/components/landing/`). 히어로(시작하기 곁에 "MVP 개발 중" 안내)·분석 미리보기(가상 공고 3건, Base UI Tabs, 권고는 08 §5.2 규칙으로 계산: 82 WATCH·88 BID·64 NO-BID, "예시 데이터" 배지, 점수 옆 "수주 확률이 아닙니다")·문제 공감·주요 기능(모두 "개발 예정")·작동 방식·분석 원칙·FAQ(Base UI Accordion, `web/components/ui/accordion.tsx`)·마지막 CTA·바닥글. 상태 색 토큰 `success`·`warning`·`demo` 추가(06 §3.1 값, 흰 바탕 대비 5.0·5.0·5.7). `web/project.json` 이름·설명 교체. 데스크톱 전용이라 `responsive.spec.ts`에서 `/` 제외, 1280 미만은 안내 한 줄. 계획 `docs/plans/2026-10-16-landing-page.md`, 세 세션 병렬 구현 + 태스크별·최종 리뷰 | `pnpm verify` 통과(루트 173/173, 웹 Vitest 628/628, build), `pnpm -C web test:e2e` Playwright 123/123·브라우저 부품 54/54(`docs/evidence/landing/test-report.txt`), Playwright MCP 1440·1280 전체 화면(`docs/evidence/landing/20261016-landing-loaded-{1440,1280}.png`), 콘솔 오류·경고 0건, 미리보기 전환·방향키·초점 링 수동 확인 | 로그인 상태의 시작하기 → `/<slug>/dashboard`는 단위 시험만(로컬 Supabase 없어 `test:e2e:auth` 미실행). 로그인 사용자는 DB 오류 시 첫 화면도 오류(로그인 화면과 같은 동작, 유지). 템플릿 `web/components/dashboard-preview.tsx`는 쓰지 않게 됐지만 남겨 둠(삭제는 사용자 결정). 브라우저 시험은 Vite 의존성 캐시가 오래되면 첫 실행 1회 실패할 수 있음(캐시 갱신 뒤 통과). 증거 파일명에 phase 번호 없음(Phase 0 전 작업) |
| 2026-10-16 | 정리 | 랜딩 교체로 쓰이지 않게 된 템플릿 `web/components/dashboard-preview.tsx` 삭제(사용자 결정). `design-system` 스킬의 언급 2곳을 고침(사이드바 색 사용처에서 제외, 첫 화면 전용 부품 자리를 `web/components/landing/`으로) | `pnpm verify:quick` | 없음 |
| 2026-10-16 | 화면 | 랜딩 스크롤 등장 효과(사용자 요청, 레퍼런스 edgelink.me). 레퍼런스를 Playwright로 재 보니 라이브러리·스크롤 가로채기 없이 블록마다 20% 보이면 500ms 동안 24px 아래에서 떠오르고(easeOutExpo 근사) 한 번만 나타났다. 같은 값으로 `web/components/landing/reveal.tsx`(새 의존성 없음, 모듈 수준 ref 콜백이 `data-reveal`만 바꿈, 숨김·전환은 `motion-safe:` CSS)를 만들어 문제 공감·주요 기능·작동 방식·분석 원칙·FAQ·마지막 CTA의 블록 17개를 감쌌다. 히어로·미리보기는 그대로. 화면 안에서 시작하는 블록(새로고침 중간 위치·`/#faq`)은 숨기지 않는다. 계획 D9("스크롤 효과 쓰지 않음")를 사용자 결정으로 바꿨다고 계획 문서에 적음. 구현 중 ref 콜백이 `null`로 다시 불릴 때의 예외(오류 화면)를 찾아 고침 | `pnpm verify` 통과(루트 173/173, 웹 Vitest 628/628, build), 새 `web/e2e/landing-reveal.spec.ts` 7개(처음 숨김·떠오름·once·끝까지 숨은 블록 0·움직임 줄이기·`/#faq`·클라이언트 이동 회귀, 변형 확인으로 각 단언이 깨질 수 있음 확인), `pnpm -C web test:e2e` 130/130·브라우저 부품 54/54(e2e 에이전트 실행), 랜딩 3개 spec 29/29 재실행, 1440·1280 떠오르는 중간·끝까지 내린 전체 화면(`docs/evidence/landing/20261016-landing-reveal-{mid,scrolled}-{1440,1280}.png`), 콘솔 오류·경고 0건 | 메뉴 링크로 건너뛴 위쪽 블록은 위로 다시 올릴 때 나타난다(레퍼런스와 같음). 끝까지 스크롤하지 않고 인쇄하면 안 나타난 블록이 빠진다. 로컬 e2e는 Supabase 환경 변수가 없으면 `/`가 500이라 가짜 값을 줘서 돌렸다. 커밋 안 함 |
| 2026-10-16 | 문서 | 가입·로그인 방식 확정(ADR-018, 사용자 결정): 공개 가입(이메일 + 비밀번호·간편 로그인 구글·카카오·네이버) + 초대로 업무 조직 합류. 간편 로그인 제공자 설정은 해커톤 안 후순위(12 "있으면 좋음"의 맨 마지막). 16에 ADR-018 행·구현 결과를 더하고 미결정 13번을 닫고 ADR-017 Auth 줄을 고침. "초대 기반 가입"·"간편 로그인 범위 밖" 문구를 01·02·09·20에서 고치고, 06 §5.2 로그인 카드에 간편 로그인 버튼, 20에 "간편 로그인" 용어 추가 | 낡은 문구 grep("초대 기반 가입"·"범위 밖이며" 0건), 위키링크 대상 실재·표 열 수 확인 | 버튼·콜백 코드는 템플릿에 이미 있다(agentic-boilerplate와 같음). 로컬 `web/.env.local`에 버튼 플래그 3개를 켰지만 제공자를 설정하지 않아 누르면 `provider is not enabled`. 제공자 설정·키는 후순위 작업. 개인 조직 생성 유지 여부(미결정 11) 그대로. 커밋 안 함 |
| 2026-10-16 | 문서 | ADR-019 인터뷰 최종 승인 반영. 솔리데오 고정, 가상 명부/정장 사진 200명·200장(남녀 100/100), 동일 팀명 합산·비례 배분·원본 이름 제외, 가입 부서·직급/직책 필수·간편 가입 보완. 스펙을 `polaris/specs/planned/2026-10-16-solideo-people-signup.md`에 저장하고 정본·README 교차 반영. 기존 전체 120명·seed 6명 불일치를 200명으로 통일하고 점수 계산 하위 27명·20 FTE는 보존 | `pnpm verify` 통과(루트 173/173·웹 628/628·타입·린트·빌드), 문서 23개·위키링크 763·로컬 링크 30·표 128 검사 오류 0, 추가 문서 원본 이름 일치 0, 별도 에이전트 교차 리뷰 반영. 증거 `docs/evidence/people/`. 최초 샌드박스 실행은 로컬 포트 EPERM으로 실패해 제한 밖 동일 명령 재실행 성공 | 명부·사진 생성·가입 폼·DB는 후속 구현. 기존 다른 랜딩 작업은 유지 |
| 2026-10-16 | 계획 | ADR-019 구현을 명부·카탈로그, 정장 사진 200장, DB·가입의 3계획/9작업으로 분해. 파일·연결 규약·단계별 실패/통과 검사·커밋 경계 명시. 공개 카탈로그 생성물, 조직 합류 전 신고 FK 변환, RLS 유지, 원본 없는 CI와 로컬 대조 구분 | 계획 자체 검토·로컬 링크 17개·원본 이름 포함 0건, `pnpm verify` 통과(루트 173/173·웹 628/628·타입·린트·빌드). 샌드박스 로컬 포트 제한 후 동일 명령 제한 밖 성공. 증거 `docs/evidence/people/20261016-plans-*` | 계획 검토·실행 방식 선택 전. 명부/사진 생성·DB·가입 코드는 아직 미구현 |
| 2026-10-16 | 화면 | 랜딩 재설계(사용자 요청: "AI 티 나고 밋밋하다", 연령대 있는 심사위원 → 큰 글자·화려함 금지·공공 SI 톤). 레퍼런스 Ramp(구조)·Airtable(글자 크기)로 아트 디렉션 승인(`docs/plans/2026-10-16-landing-redesign-design.md`, U1~U4·M1~M7) 후 9단계 계획(`docs/plans/2026-10-16-landing-redesign.md`)을 서브에이전트 방식(구현 `frontend-developer`, 비평 새 에이전트 `landing-art-director`, 단계마다 검토)으로 구현. 첫 화면 전용 글자 눈금(본문 18·메뉴 17·라벨 15px, 13px 미만 0), 보조 글자색 #4E5968(앱 포함), 로고 A안(낫표 「•」 인라인 SVG, `design/brand/`, `app/icon.svg`), 72px 단색 머리말, 왼쪽 정렬 히어로 + 3단 판(공고문 인용·결재란), 비교표·기능 줄·단계 띠·원칙 격자·펼친 FAQ·권유 띠(카드·머리글·아이콘 칩 제거), `icon-chip.tsx`·`ui/accordion.tsx`·`favicon.ico` 삭제(사용자 결정). impeccable 스킬 도입(훅 없이) | `pnpm verify` 통과, `pnpm -C web test:e2e` Playwright 136·Vitest 630·브라우저 58 통과(`docs/evidence/landing/20261016-redesign-test-report.txt`), impeccable detect 0건, 1440 보이는 글자 228개 최솟값 14px, 1280·1265 넘침 0, 콘솔 오류·경고 0, 1440·1280 첫 화면·전체 화면(`docs/evidence/landing/20261016-redesign-{view,full}-{1440,1280}.png`), `landing-art-director` 비평 must 1·should 4 반영 | 1280×800 에서는 점수 고지가 접힘선 아래(정본은 1440×900 만 정함), 기능 제목만 마침표 없음, 히어로 "서비스"·바닥글 "플랫폼" 표기 차이 — 사용자 판단 대기. 로그인 뒤 화면은 로컬 DB 가 없어 보조 글자색 변화를 인증 화면으로만 확인. 커밋 6e7cac3 에 다른 세션 파일 6개가 섞임(사용자 결정으로 분리 시도 중 그 세션이 위에 커밋해 분리하지 않음) |
| 2026-10-16 | 설계 | 사용자 계획서 [[SIDEBAR-PLAN]]을 정본과 대조해 사이드바 정보 구조·입찰 업무 확장 설계 초안 작성([설계](plans/2026-10-16-sidebar-ia-design.md), status review). 현황: SOL 도메인 코드 0·사이드바 템플릿 그대로. 계획서 전제(NestJS·반응형·GO/NO-GO·신뢰도)는 정본대로 처리, 정본 간 어긋남 A1~A9, 범위 충돌 정리. 정본 문서·코드는 고치지 않음 | 문서 대조(코드 검증 대상 없음), 검토 에이전트 빈틈 점검 | 결정 D1~D12 사용자 승인 대기. 승인 뒤 정본 동기화(§4). 정본 19개 미커밋 수정 정리 필요 |
| 2026-10-16 | 문서 | 실데이터 MVP·AI 파이프라인 v0.2·Kev-9B 파인튜닝 전략 설계(브레인스토밍 → 승인, ADR-020). 실행 모드 `live`·`fixture`·`mock`, 나라장터 Open API(15129394·15129437·15129462·15129467) 수집·첨부 allowlist·형식별 `DocumentParser`(후보 라이선스 조사, AGPL·GPL 배제, 배포용 HWP 복호화 안 함), 실패 유형 4종 분리·mock 자동 대체 명시, Kev-9B@v1.0 `kev-qs/v0.2` 참고 지표(점수 미반영)·`KevStateTrace`·`CompanyEvidenceRef`, 판정 3값+사유 코드(정보 부족 ≠ 미충족), 실추론은 회사 GPU 서버(터널), 평가셋·지표·오류 분석·LoRA 메모리 검증·모델 레지스트리(21 신설). 00~12·15~20 반영, 평가 대상 이름 E0~E4, 목록 기본 출처 필터는 실행 모드를 따름 | Kev 저장소 main `1f04cfa`·data.go.kr 명세·파서 LICENSE 조사(에이전트 3), 설계 빌더 검토 1회, 정본 반영 작업자 4 + 메인, 독립 정합성 검토 1회(높음 14·낮음 17 수정), 스크립트 검사(frontmatter·위키링크·표 파이프 오류 0), `prettier --check docs/**/*.md` 통과. 코드 변경 없음이라 `pnpm verify` 대상 아님 | 미결정 1·3·4·16~20(실제 API 응답, GPU 모델·VRAM, 파서 선택, 첨부 다운로드 가능 여부, 첨부 저작권, 면허제한 행 의미). seed `technologiesComplete`·`industryCodes` 값 미정(08 §6.1). 해커톤 마감일 미정. 미커밋 |
| 2026-10-16 | 화면 | 랜딩 재설계 후속(사용자 결정 U5~U7): 1280×800 첫 화면에도 판의 점수 고지가 들어오게 히어로 여백을 줄임(`pt-10 pb-10`, 설명 `mt-5`, 버튼 `mt-8`, 안내 `mt-4`, 무대 `p-7` — 고지 아래 끝 778px, 여유 22px), 히어로 "지원 서비스입니다" → "지원 플랫폼입니다"(바닥글과 통일), 기능 제목 마침표는 그대로. 디자인 문서 §1·§2·사용자 결정 표 갱신 | 루트 `pnpm verify` 통과, 랜딩 e2e 42/42(1440×900·1280×800 고지 전체 보임 시험 추가, 바꾸기 전 RED 확인), 판 브라우저 시험 8/8, 1440·1280 증거 스크린샷 갱신(`docs/evidence/landing/20261016-redesign-{view,full}-{1440,1280}.png`, 콘솔 0) | 없음 |
| 2026-10-16 | 문서 | ADR-021 정본 동기화(사용자 승인, 기준 `22b788e`). 설계 문서 부록 B.1~B.17과 재대조·교차 검사·확인 요청 보완 G1~G19를 12·16·06·05·04·01·11·19·09·02·20·08·13·07·14·10·[솔리데오 인력 스펙](../polaris/specs/planned/2026-10-16-solideo-people-signup.md)에 적용. 16에 ADR-021 행·상세, ADR-018·019 개정 표시, 미결정 11·12번 종결. 06 §4 그림에 실행 모드 칸(ADR-020 누락분)을 넣으며 93칸으로 넓힘. 사전 검토 결정 1~4는 추천안대로 | 파일마다 diff로 삭제 줄이 지목 문장뿐인지 확인(ADR-020 줄 보존). vault 검사(위키링크 1,439·로컬 링크 102·표 280) 정본 오류 0, 남은 7건은 동기화 전부터 있던 설계 문서 항목. Codex 가입 커밋 `5ece7c0`과 3자 병합 시험: 07·11·polaris 스펙 충돌 0, PROGRESS는 동기화 전과 같은 작업 로그 끝 1곳. 루트 `pnpm test` 173/173 | 미커밋. `5ece7c0`의 마이그레이션이 ADR-021과 다름(설계 문서 §8 G17, 그 세션에 전달 필요). 17이 12의 없는 "결정 필요" 콜아웃을 가리키는 문제는 범위 밖으로 남김 |
| 2026-10-16 | 인력 데이터 | 200명 가상 명부·38부서/12직급·최소 공개 가입 카탈로그 생성, 단계별 검증기와 CLI 3종 추가. 익명 증거에 원본 해시·250행(가중치175/제외75)·정규화 원본 이름 일치0·AI 이름 검토 출처 기록 | 집중84/84, fixture 검사 `not-run`, 실제 원본 필수 대조 `passed`, release는 `PORTRAITS_INCOMPLETE`로 의도한 실패. `pnpm verify` 통과(루트257/257·웹628/628·빌드) | 데이터 Task 3 독립 검토 대기. 사진 READY0/200, DB·가입·94/72/68 점수 파이프라인 골든은 후속 작업. 사람의 얼굴/품질 검수 미수행 |

## 관련 문서

- [[00-README|문서 인덱스]]
- [[07-DATA-PIPELINE|공고·인력 fixture]]
- [[11-TESTING|검증 기준]]
- [[16-DECISIONS|결정 기록]]
- [[21-MODEL-TRAINING|모델 학습]]

- Task 8 구현(격리 worktree, 독립 검토 전): 실제 업무 멤버십 0/1/복수 판정, 모든 기존 조직 업무 page/action 경계의 현재 조직 고정, 조직 상태 안내·계정/초대 복귀, 템플릿 회사 생성 경로 폐기 및 명시적 격리 Supabase test-target harness를 추가했다. 모의 단위·1440/1280 브라우저 검증과 정상 커밋 게이트 증거는 `.superpowers/sdd/2026-10-16-solideo-people-signup/task-8-report.md`에 기록한다. 실제 별도 Supabase의 build/Auth/E2E는 Task9 대기이며 공유 스택·클라우드·main은 변경하지 않았다. 전체 N1/N2·/ops·sidebar/P1 완료를 뜻하지 않는다.


## ADR-021 가입·인력 코드 QA 완료 (2026-10-17)

Task5~8 및 각 수정의 독립 리뷰, Task9 실제 격리 QA 통과. 운영200/평가27 분리,48개 계층(본부6·그룹4·기존팀38), 상위 인원NULL, 신규 가입profile만 생성, 실제 업무 멤버십0/1/복수 판정을 확인했다. 원본 대조passed,200개 고유 세글자 이름·남녀100/100·기존 ID/계산 입력을 보존했다.

최종 코드 `21c8b9785cc04fcd1d99eddd92e75cbe157bcedb`에서 새 빌드·관련 브라우저12·로그인 준비5·기존 실패Auth2·실제 초점/계정 화면 재검증 통과. 전체verify(루트347/웹865)/공개130/포함 브라우저99와 Auth93통과·2실패의 원래 기록은`e465438` 귀속으로 보존한다. [최종 실행 근거·한계](evidence/people/20261016-adr021-people-integration.md), [독립 QA 보고서](evidence/people/20261017-adr021-qa-report.md).

전용 임시 Supabase만 정리했으며 공유 DB의 새 migration/seed 적용·main 병합·다른 세션/소스 checkout 수정은 하지 않았다. 위의 Task7/Task8 구현 시점 메모에 적힌 검토/실제QA 대기는 이번 기록으로 종료한다.

사진은 2026-10-17 사람 최종 승인 뒤 READY200으로 전환해 원본 바이트 그대로 통합했다. 전체 ADR-021 N1/N2·/people·/ops·sidebar/P1, 전체 Phase4, 실제 외부 OAuth는 후속 범위다. 실제 REST 중단의 초기 조회 안내와 RSC 응답 보류 중 즉시 화면 이동의 검증 한계도 근거 문서에 남겼다. 전체 기능·배포 완료로 표시하지 않는다.


## 2026-10-17 승인 사진 통합 — Task 1

사용자가 “사진 200장 전체를 최종 승인합니다.”라고 승인한 정확한 200명 ID·이름·성별·부서·직급·경로·해시 binding을 snapshot `19cbd9408e9672273db9405073dde5f9133d7715fa40041e51b91c824e8ff0e1` 및 실제 PNG와 다시 대조했다. 자동 PASS200/FAIL0과 사람 APPROVED200을 분리 기록하고, 이전 AI review200개를 승인 기록에 먼저 보존한 뒤 기존 API로 READY200으로 전환했다. 역사적 외부 audit의 PENDING 기록은 수정하지 않았다.

`/demo/people/SOL-P0001.png`~`SOL-P0200.png`와 제한된 ID 경로 helper, 기존 Avatar 기반 `PersonAvatar`를 추가했다. ID 없음·범위 밖·이미지 decode 오류는 중립 인물 아이콘과 접근 가능한 설명을 표시한다. 향후 조직도와 직원 상세 화면은 같은 컴포넌트를 사용한다. 조직도·직원 상세·메뉴·제품 화면은 이번에 만들지 않았다. 실제 사용자 `avatar_url`과도 연결하지 않았다.

실행 증거: [Task 1 검증](evidence/people/20261017-portraits-integration-task1.md). 사진·명부·조직 회귀99/99, helper14/14, Avatar Chromium4/4, 순수 점수10/10, 웹 타입 검사를 통과했다. 원본 엑셀 필수 release 검사는 `sourceComparison: passed`, 오류0이다. 명부·조직48개·직급·배정/평가27명·점수 입력·마이그레이션은 바꾸지 않았다. 전체 `pnpm verify`, 실제 Next HTTP200 URL 검사, 기존 인증/인가 회귀 및 전체 브랜치 리뷰는 독립 Task 2에서 수행한다. 전체 G1~G10·미출시 인력 화면·배포 완료를 주장하지 않는다. 공유 DB 적용·main 병합·push는 수행하지 않았다.

## 승인 사진과 명부 통합 QA (2026-10-17)

사용자가 SOL-P0001~SOL-P0200 전체를 최종 승인했다. 9663 승인 커밋 `8ba2810`, 현재 사진 worktree `694b6fa`(후속 문서 정정만)이며 b3ef 통합 커밋은 `a05217a`다. 사진200/명부200의 ID·이름·부서·직급·원본 SHA를 1:1로 보존했고, 별도 사람 APPROVED/manifest READY200·이전 AI 이력·과거 PENDING 검수 자료를 구분해 남겼다. `/demo/people/<personId>.png`와 공통 PersonAvatar/fallback을 준비했다.

독립 QA: 같은 b3ef 고정 HEAD에서 전체 verify 루트349/웹879/빌드, 정상 Auth95, 브라우저106, 실제 Next GET·SHA·decode200 통과. 격리 DB에서 운영200/평가27/부서48/직급12/Auth5와 시험 계정 ID 보존을 확인했다. 전용9개 컨테이너/볼륨·생성 세션만 정리했고 기존22개는 보존했다. [결과·미검증 경계·병합 준비](evidence/people/20261017-portraits-integration.md). 전체 브랜치 최종 리뷰는 이 QA 문서 패키징 후 진행한다.

상위 부모29건은 근거 부족으로 미확정이다. 조직도·직원 목록·상세 제품 화면, 전체 G1~G10, 외부 OAuth 실연결은 미검증이다. 위의 사진 승인·통합 대기 기록은 당시 상태이며 현재 사진 단계에는 적용되지 않는다. 공유 DB 적용·main 병합·push는 하지 않았다.

## 인력 통합 최종 리뷰 완료 (2026-10-17)

전체 브랜치 리뷰의 시드 보존 I1·옛 개인 조직 설명 M1을 `ca719cf` 한 차례 수정으로 해결하고 범위 재검토를 통과했다. 시드 팀의 비시드 회원은 변경 전에 명시적으로 거절하며 실제 격리 DB에서 해당 회원·작업·초대·식별자 보존을 검증했다. 정상 시드2회·운영200/평가27/부서48/직급12/Auth5도 유지했다. 최종 새 verify350/879/빌드 통과. Auth95·브라우저106·실제Next200의 원래 a052 SHA는 보존한다. [최종 결과](evidence/people/20261017-portraits-integration.md). 앞의 “최종 리뷰 진행 예정”은 당시 기록이며 이번 기록으로 종료한다.

사진 APPROVED200/READY200·원본 SHA·명부 ID/이름/부서/직급은 그대로다. 상위 부모29건, 제품 조직도/직원 목록/상세 및 전체G1~G10은 미검증이다. 공유 DB 적용·main 병합·push는 하지 않았다. 다음 단계는 두 문서 충돌의 준비된 해결안과 검증 결과를 보고한 뒤 별도 main 병합 승인을 받는 것이다.


## b3ef → main 병합 및 재검증 (2026-10-17)

사용자 승인 기준 main114a10a/b3efdf51f2f/9663의694b6fa와 clean 상태를 확인하고 b3ef만 merge commit `42a4ead`로 main에 병합했다. 고유41커밋·467파일(이름 변경3건)이며 TESTING/PROGRESS 두 충돌만 hunk별로 해결했다. PPL-06·07 최신 내용, 전체 점수/score_runs 불변 수용 조건, main 정본/ADR-020·021 및 양쪽 날짜 로그22행을 보존했다.

이 병합 코드에서 새 verify 루트350·웹881·프로덕션 빌드, 인증95, 공개138·브라우저108, 실제Next200 URL/MIME/승인 SHA/decode, 가입1440/1280·별도DB200/27/48/12/Auth5·seedID 보존 검증을 통과했다. 공개 첫 시도는 Vite 의존성 최적화 중 import실패/중단(exit130)했고 같은 코드·설정으로 한 번 재실행해 통과했다. 외부 UI probe 선택자 오류와 UI만 재검증한 기록도 보존했다. 기존 증거의 SHA 귀속은 바꾸지 않는다.

9663 전용3커밋은 병합하지 않았고 b3ef/9663 전체 추적 파일·HEAD·clean 상태를 보존했다. 전용 컨테이너7개/생성세션5개만 정리해 기존22개를 유지했다. 공유 DB migration·운영 데이터 변경·push·배포·추가 기능 구현은 하지 않았다. 부모29건·제품 조직도/직원 목록/상세·전체G1~G10·기존score_runs 불변·전체N1/N2 및 외부OAuth는 미검증이다. 위의 이전 “main 병합 승인 대기”는 당시 기록이며 이번 승인/병합으로 종료한다. [최종 병합 보고·다음 Phase 권장 순서](evidence/people/20261017-b3ef-main-merge.md).
