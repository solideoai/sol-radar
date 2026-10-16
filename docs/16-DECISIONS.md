---
title: "16. 아키텍처 결정 기록 (ADR)"
doc: "16"
status: draft
tags:
  - sol-radar
  - decision
updated: 2026-10-16
---

# 16. 아키텍처 결정 기록 (ADR)

상태 값: `제안` → `채택` → `검증됨`(근거 URL·날짜 필수). 외부 사실 확인 전이면 `미검증`, 철회는 `폐기`. 검증 결과는 날짜·근거 URL·결정자와 함께 이 문서에 갱신한다.

## 결정 사항
|ID|결정|상태|날짜|근거|
|---|---|---|---|---|
|ADR-001|Next.js App Router(UI)와 NestJS(API·Worker) 역할 분리|채택|2026-10-14|UI/도메인 로직 분리, OpenAPI 단일 원천 ([[02-ARCHITECTURE\|02 아키텍처]])|
|ADR-002|self-managed PostgreSQL + Prisma. Supabase 서비스 미사용|채택|2026-10-14|테넌트 격리·감사 로그를 스키마로 통제, Compose 단일 배포|
|ADR-003|Docker Compose 배포. Kubernetes는 MVP 대상 아님|채택|2026-10-14|노트북 1대 데모와 GPU 호스트를 같은 Compose 프로필로 커버 ([[10-DEPLOYMENT\|10 배포]])|
|ADR-004|Kev는 의사결정 보조, Qwen은 추출·설명, 점수는 규칙 엔진이 최종|채택|2026-10-14|설명 가능성·감사 가능성. Kev는 텍스트 생성 없이 확률만 반환하므로 보조 신호에 적합 ([[03-AI-PIPELINE\|03 AI 파이프라인]], [[08-SCORING\|08 스코어링]])|
|ADR-005|MinIO 사설 객체 저장소, Qdrant는 재생성 가능한 검색 보조|채택|2026-10-14|원본 보존과 파생 인덱스 분리|
|ADR-006|인앱 알림 P0, 카카오톡 P1 (승인 전 mock)|채택|2026-10-14|비즈메시지 계약·템플릿 승인 미확보 ([[13-NOTIFICATIONS\|13 알림]])|
|ADR-007|모바일(레이아웃·네이티브 앱)·결제/구독 기능을 구현하지 않는다(해커톤 이후 포함). 데스크톱 1280~1920 전용|채택|2026-10-16|사용자 제약(해커톤 이후도 제외, 2026-10-16 사용자 확인). 5분 데모는 데스크톱 1대. 범위를 줄여 자격·점수·결정 기록 완성도에 집중 ([[01-PRD\|01 PRD]])|
|ADR-008|데모 기본 실행은 `AI_PROVIDER=mock`. 실모델은 `ai-local` / `ai-hosted` 선택 프로필|채택|2026-10-16|데모 노트북에 GPU 없음. 네트워크 의존 제거. mock은 fixture 기반 결정적 응답으로 재현 가능 ([[10-DEPLOYMENT\|10 배포]], [[03-AI-PIPELINE\|03 AI 파이프라인]])|
|ADR-009|설계 문서는 Obsidian vault로 관리. YAML frontmatter, 위키링크, `## 관련 문서`, 콜아웃 규약|채택|2026-10-16|사람 심사위원 열람성·그래프 뷰. AI 심사가 주장→근거 위치를 따라갈 수 있다 ([[00-README\|00 인덱스]])|
|ADR-010|hosted 모델 API(공급자 미정) 호출은 사용자 명시 승인 후에만. 승인은 env `AI_HOSTED_APPROVED=true`로 표현. 기본 `false`|채택|2026-10-16|비용 발생. 승인 없는 과금 금지. `AI_PROVIDER=hosted`는 env로만 켜고 CI·테스트에서 금지 ([[03-AI-PIPELINE\|03 AI 파이프라인]] §3, [[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]])|
|ADR-011|요구조건 추출은 공고 **revision 단위**(조직 무관)로 1회 실행해 `requirement_extractions`에 저장·재사용. 자격 판정·점수·Kev는 **조직 × revision × 프로필 revision** 단위로 `score_runs`|채택|2026-10-16|추출은 공고 원문만 보므로 조직과 무관. 비용·지연 절감, 조직별 결과는 분리 ([[03-AI-PIPELINE\|03 AI 파이프라인]] §2, [[04-DATABASE\|04 DB]] §3.3·§3.4)|
|ADR-012|Kev 입력은 어댑터가 만든 **영어 템플릿 state**만. 한국어 원문 전체를 Kev에 넣지 않는다. Kev는 `review_flags` 추가만 가능|채택 (효과 미검증)|2026-10-16|모델 카드 `Languages: English`, 영어 외 언어는 잘 동작하지 않는다고 명시 (2026-10-16, docs/model-cards/kev-4b.md). 변환 효과는 미검증이라 `KEV_ENABLED` 기본 `false` ([[03-AI-PIPELINE\|03 AI 파이프라인]] §5.6, [[09-SECURITY\|09 보안]])|
|ADR-013|골든 시나리오는 `G1`~`G10`, 데모 장면은 `S0`~`S7` 번호 규약. 테스트·fixture·데모 문서가 같은 ID로 서로 참조|채택|2026-10-16|a3 제안. 11·19·07 간 교차 참조를 ID로 고정해 심사 중 "어디서 검증했나"에 바로 답한다 ([[11-TESTING\|11 테스트]], [[19-DEMO-SCENARIO\|19 데모 시나리오]])|
|ADR-014|fixture 날짜는 상대 표기(예: `+21d`), seed 시 KST 18:00 기준 절대값으로 변환|채택|2026-10-16|a3 제안. 데모 날짜가 바뀌어도 마감 D-3·D-1 장면이 유지된다 ([[07-DATA-PIPELINE\|07 수집 파이프라인]])|
|ADR-015|저장소 지침 우선순위: `docs/CLAUDE.md`와 설계 문서(00~20)가 출발 템플릿(agentic-boilerplate)의 `AGENTS.md`·`docs/boilerplate/`·`.claude/` 스킬보다 우선. 루트 `CLAUDE.md`가 `@docs/CLAUDE.md`를 먼저 불러온다|채택|2026-10-16|사용자 결정. 저장소가 Supabase·Expo 템플릿에서 시작해 ADR-001·002·007과 충돌. 스택은 NestJS + Prisma로 유지. 템플릿 코드(`web/`·`mobile/`·`supabase/`) 정리 시점은 별도로 정한다 ([[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]])|
|ADR-016|웹 클라이언트 공유 상태는 zustand, 입력 검증 스키마는 zod(4.x). 현재 Next.js 앱 `web/`에 설치(zustand 5.0.15, zod 4.6.5). Phase 0에서 `apps/web`을 만들 때 그대로 옮기고, `apps/api`·`packages/contracts`도 같은 zod 메이저를 쓴다|채택|2026-10-16|사용자 결정. zod는 DTO 단일 원천([[05-API-SPEC\|05 API]] §7)과 같은 라이브러리라 화면·API가 스키마 표현을 공유한다. zustand는 여러 클라이언트 컴포넌트가 함께 쓰는 UI 상태만 담고, 서버 데이터와 URL 쿼리 필터는 담지 않는다 ([[06-UI-UX\|06 UI]] §11)|

### ADR-007 ~ 014 구현 결과
- **ADR-007**: `apps/web`에 1280px 미만 breakpoint·결제 모듈·요금 화면 없음. UI 토큰·그리드는 1280~1920만 ([[06-UI-UX|06 UI]]). 17 절대 규칙으로 강제.
- **ADR-008**: `infra/env/demo.env.example` 기본값 `AI_PROVIDER=mock`, `KEV_ENABLED=false`, `DEMO_MODE=true`. mock adapter는 `services/ai/adapters/mock.py`, fixture ID별 고정 응답. 프로필 전환에 코드 변경 없음.
- **ADR-009**: 모든 md에 frontmatter. 파일 이름 변경 금지(링크가 파일명 기준). 00이 MOC. 모노레포 `docs/` 폴더가 이 vault.
- **ADR-010**: `AI_PROVIDER=hosted`인데 `AI_HOSTED_APPROVED=false`면 gateway가 기동을 거부한다(조용히 mock으로 바꾸지 않는다). API는 `/admin/ai/status`에서 `422 HOSTED_NOT_APPROVED`. 호출 시 provider·모델·토큰 수를 로그에 기록(키는 기록 금지). 승인 기록은 [[PROGRESS]] 작업 로그에 남긴다.
- **ADR-011**: ingest job이 `/extract`를 호출하고 `requirement_extractions`에 UNIQUE(`revision_id`, `model_name`, `prompt_hash`)로 저장. analysis job은 이것을 읽어 `/kev`와 규칙 엔진을 돈다 ([[02-ARCHITECTURE|02 아키텍처]] 흐름).
- **ADR-012**: state 템플릿은 `services/ai/adapters/kev.py`에만. 검증 절차(fixture 20건 영어 state 일치율, `permute` 순서 민감도)는 03 §5.9. 결과가 나오기 전까지 데모는 mock Kev.
- **ADR-013**: 11의 골든 시나리오 표, 07의 fixture 표, 19의 장면 표가 `G`·`S`·`FX` ID로 서로 가리킨다. 테스트 파일 이름에도 ID를 넣는다(예: `g03-mandatory-unmet.spec.ts`).
- **ADR-014**: `fixtures/*.json`의 날짜 필드는 `+Nd` 문자열. `seed-demo`가 실행 시각의 KST 18:00을 기준으로 절대 ISO8601로 바꿔 적재한다. 테스트는 기준 시각을 고정해 결정적으로 돈다.

## 반드시 검증할 미결정 사항
|#|항목|상태|검증일|근거 / 다음 행동|
|---|---|---|---|---|
|1|data.go.kr 사용 API별 서비스키·트래픽·페이지네이션·실제 응답 스키마|미검증|-|서비스 이름 수준만 기록. 승인 후 테스트 응답 3건을 registry에 저장 ([[07-DATA-PIPELINE\|07 수집 파이프라인]], [[15-DATA-CONTRACTS\|15 데이터 계약]])|
|2|Kev v1.0 체크포인트 가용성·추론 API·라이선스·메모리·한국어 성능|부분 검증|2026-10-16|**검증됨** (https://github.com/jaredpalmer/kev README 및 docs/model-cards/kev-4b.md): 체크포인트 4종(0.8B/4B/9B/27B) 공개, Hub 태그 `v1.0`로 가중치 고정(`--run jaredpalmer/kev-4b@v1.0`, README 명시), GitHub 태그 `kev-1.0`, API `POST /v1/systemone`(noul/choice/score) + `GET /v1/models`, Apache-2.0, Python 3.12/3.13 + uv 소스 설치, `--device cpu\|cuda\|mps\|auto`. 모델 카드 `Languages: English`, 영어 외 언어는 잘 동작하지 않음. **미검증**: 한국어 → 영어 state 변환의 효과(ADR-012), VRAM 요구량, Kev-0.8B CPU 실행, 자체 보고 수치의 독립 재현. hosted 공급자 존재·포맷·가격은 전부 미확인. 다음: [[03-AI-PIPELINE\|03 AI 파이프라인]] §5.9 절차로 `ai-local`에서 fixture 20건 측정|
|3|Qwen 런타임(vLLM 등) 선택 및 GPU 메모리 분배|미검증|-|후보만 03에 기록. `ai-local` 프로필에서 측정|
|4|HWP/HWPX parser 라이브러리·라이선스·안전성|미검증|-|데모 fixture는 PDF/텍스트만. HWP는 `PENDING_REVIEW` 경로 유지|
|5|카카오 비즈메시지 발신 계약과 승인된 템플릿|미검증|-|해커톤 범위 밖. mock provider ([[13-NOTIFICATIONS\|13 알림]])|
|6|한국어 검색 품질(Qdrant 임베딩과 PostgreSQL full text 병행)|미검증|-|데모 필수 아님. 키워드 검색 fallback이 기본|
|7|초기 스코어 가중치와 결정 임계값(75/50), 조직별 판정 기준|미검증|-|[[08-SCORING\|08 스코어링]] worked example로 fixture 3건 일치 확인. 조직별 config versioning|

검증 전에는 명세 가정으로 표시하고 기능 플래그·mock·fixture로 개발한다.

## 관련 문서
- [[00-README|00 인덱스]]
- [[01-PRD|01 PRD]]
- [[03-AI-PIPELINE|03 AI 파이프라인]]
- [[10-DEPLOYMENT|10 배포]]
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]
- [[PROGRESS]]
