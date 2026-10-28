---
title: "10-27 문서 정리 계획: 마감 연기 반영·사실 정정·낡은 문서 삭제"
doc: "plan-20261027-docs-cleanup"
status: done
tags:
  - sol-radar
  - decision
  - hackathon
updated: 2026-10-28
---

# 10-27 문서 정리 계획: 마감 연기 반영·사실 정정·낡은 문서 삭제

> [!note] 실행 방식
> 과제 단위로 실행한다(superpowers:subagent-driven-development 또는 executing-plans). 과제마다 한 작업자가 맡고, 커밋은 메인 세션이 한다. 체크박스로 진행을 적는다.

**목표**: `docs/` 정본을 제출 2026-11-03(화)·발표 2026-11-04(수) 기준과 지금의 코드·운영 사실에 맞춘다. 지난 일정, 끝난 계획, 퇴역 내용은 지운다.

**방식**: 10-27에 8개 묶음을 읽기 전용으로 점검했다. 그 결과를 파일 묶음별 과제로 나눈다. 별도 worktree에서 고치고 메인 세션이 커밋한다. 운영 DB·회사 서버·코드는 바꾸지 않는다. 코드 주석·코드 잔재는 §3으로 넘긴다.

**근거**: 점검 결과 표(파일:줄 단위 약 850행)는 이 계획을 쓴 세션의 scratchpad `audit/G1~G8-*.md`에 있다. scratchpad는 세션이 끝나면 사라진다. 다른 세션이 실행하면 같은 폴더의 `BRIEF.md` 기준으로 해당 묶음을 다시 점검한 뒤 고친다.

## 1. 점검 결과

| 묶음 | 파일 | 건수(A 일정/B 사실/C 문서 간/D 낡음) | 파일 판단 |
|---|---|---|---|
| G1 해커톤·로드맵 | 00·01·12·17·18·CLAUDE·루트 지침 | 37/37/32/29 | 12는 230줄 → 120줄 안팎, 나머지는 고침 |
| G2 데모·제출물 | 19·submission 9개 | 27/46/22/26 | 19는 D1 기준으로 다시 씀, slides-outline 삭제, video-storyboard는 slides-spec으로 합침 |
| G3 결정 기록 | 16 | 18/21/17/21 | 322KB → 150KB 안팎 |
| G4 진행·알림·용어 | PROGRESS·13·14·20 | 14/25/13/41 | PROGRESS는 253KB → 30KB 이하, 13은 35% 줄임 |
| G5 AI·모델 | 03·21·22·23·루트 BOSUN 2개 | 23/35/8/46 | 23 삭제, 21·22 줄임 |
| G6 데이터·API·점수 | 04·05·07·08·15 | 2/46/6/36 | 04·05 크게 고침, 08은 코드와 맞음 |
| G7 구조·화면·보안·배포·시험 | 02·06·09·10·11 | 14/60/18/72 | 10은 40%, 11은 45% 삭제 후보 |
| G8 하위 폴더 | plans·polaris·boilerplate·evidence | 5/14/7/7 | plans 68개 중 41개 삭제 |

여러 문서에 걸친 주요 문제:

1. **첨부 처리 상태가 낡았다.** 02·03·10·18·19·20·submission이 첨부 처리를 "미구현·운영 미적용"으로 쓴다. 실제로는 첨부 처리 코드(다운로더·documents worker·`/parse`)가 main `8cfaac31`에 들어갔다. migration 000500·000600도 10-27 운영에 적용됐다. 남은 일은 회사 반영뿐이다.
2. **ADR-044(Vercel 내부 ai 서비스)를 현재처럼 쓴다.** 00 표, 10의 두 절, `boilerplate/first-deployment.md`, 루트 지침이 해당한다. 실제 `vercel.json`은 web 하나다(ADR-049).
3. **MinIO가 남아 있다.** 02·09·10·11·18·19·22에 MinIO 서술이 있다. 어느 compose 파일에도 MinIO는 없다(ADR-048).
4. **인력 숫자가 옛 값이다.** 18·20·slides-outline이 "27명·20 FTE"로 쓴다. ADR-043 이후 200명·95.5 FTE다.
5. **수집 주기가 옛 값이다.** 07:87·12:131이 "30분"으로 쓴다. 코드는 3시간 cron이다(`ingest-schedule.ts:9`, `0 */3 * * *`).
6. **FX-02 66점의 원인 설명이 틀렸을 수 있다.** 문서는 66점을 "실모델이라 72와 다르다"로 설명한다. 증거는 일정 계수(마감 영업일 5 미만 → 0.4)를 원인으로 본다(추정, `evidence/demo-deadline/20261027/README.md:199-212`). 마감을 옮긴 뒤 재분석하면 결과가 달라질 것으로 예상된다.
   - 10-28~11-02에 재분석: 78 BID
   - 11-03·04에 재분석: 72 WATCH
7. **DEMO 마감 이동 상태가 낡았다.** 19·submission은 "준비 중·10-29 적용"으로 쓴다. 실제로는 10-27 12:57 운영 적용을 마쳤다.
8. **스키마·API 서술이 코드와 다르다.**
   - 04: 표 15개·뷰 3개·함수 다수가 빠졌다. 값 집합 3개(`bid_stage`·`bid_source`·`ingest_source`)가 옛 값이다.
   - 05: 코드에 있는 경로 6개가 빠졌다. 문서의 `…/download`와 달리 코드는 `…/download-url`이다.
9. **11에 없는 시험 파일이 적혀 있다.** 11이 이름으로 적은 시험 파일 약 45개가 지금 저장소에 없다(10-21 시험 정리, `pruned-tests.json`).
10. **16의 구조가 흐트러졌다.**
    - 정렬 방식이 3가지로 섞였다.
    - 결정이 아닌 가짜 ADR 절(129-132)이 있다.
    - 미결정 항목 30개 가운데 13개는 이미 결정되거나 해소됐다.
    - 대체 관계를 한쪽 ADR에만 적었다(044↔049 등).
11. **PROGRESS가 너무 크고 낡았다.** 파일의 57%가 작업 로그다. main에 병합된 X5·P1·N1·N2·N9의 체크가 비어 있다.
12. **모델 id가 다르다.** 21·22·23·HANDOFF의 15곳 넘게 `Qwen/Qwen3.8-Flash-Next`로 쓴다. 실제 served id는 `Qwen3.8-Flash-Next-AWQ-INT4`다(`registry.yaml:40`).

## 2. 먼저 정할 것

> [!success] 사용자 결정 (2026-10-27)
> 네 가지를 물었고, 모두 추천안을 골랐다. 선택지 이름을 그대로 옮긴다.
> - 지난 일정·끝난 계획 47개·PROGRESS 작업 로그 → "지우고 git에 맡김". Q1·Q2·Q4가 여기서 정해졌고, Q3도 이 원칙을 따른다.
> - 사용자 제공 파일 → "3개 삭제·2개 유지"(Q5).
> - 발표 형식 → "덱 20분 + 녹화 클립"(Q6).
> - S4 FX-02 → "재분석하고 화면 점수로 설명"(Q7).
>
> Q8~Q11은 묻지 않았다. 추천안을 기본으로 진행하고, 사용자가 다르게 정하면 해당 과제를 바꾼다.

| # | 정할 것 | 추천 | 영향 과제 |
|---|---|---|---|
| Q1 | 지난 일정(10-24 freeze·10-25 리허설·10-26 완료·10-27 제출) 처리 | **정본에서 지운다.** 날짜 이력은 16 ADR-042·054에 한 줄씩만 남긴다. 이 원칙은 ADR-054 §1("지우지 않고 표시만")을 바꾸므로 새 ADR-057로 적는다 | 전부 |
| Q2 | 끝난 계획 41개(처음 47개, 코드가 가리키는 7개를 남김)(`docs/plans/`) | **지운다.** 보관 폴더는 만들지 않고 git 이력에 맡긴다. 다음은 남긴다: 정본·코드가 절 단위로 인용하는 계획, 사용자 제공 원문, 진행 중인 실행서(목록은 과제 8) | 8 |
| Q3 | 16의 큰 덩어리(ADR-027 폐기, ADR-029~036 정본 반영 기록, ADR-042 일정표·담당 배정) | **16 안에서 ADR마다 한 줄 요약과 원문 커밋 해시로 줄인다.** 보관 파일은 만들지 않는다 | 7 |
| Q4 | PROGRESS 작업 로그 120행과 옛 절 | **지운다.** 현재 상태 요약과 기능 상태 표 하나만 남긴다 | 9 |
| Q5 | 사용자가 넣었을 수 있는 파일 | `docs/error/image.png`(10-21 Vercel 503 로그 캡처, 링크 0)는 지운다. `SOL_RADAR_BOSUN_QWEN4B_MIGRATION_BRIEF.md`(퇴역)와 `BOSUN_FINETUNING_GPT_HANDOFF.md`(X6을 하면 git에서 복원)도 지운다. `plans/SIDEBAR-PLAN.md`(ADR-021 원 요구서)와 `design/references` 2장은 남긴다 | 3·8 |
| Q6 | 발표 형식 | 덱 20분 안에 녹화 클립을 넣는 것을 본편으로 한다(10-21 사용자 입력, slides-spec·submission README). D1 운영 사이트(`?origin=demo`)는 촬영 경로이자 질의응답 때 라이브로 쓴다 | 2 |
| Q7 | S4 FX-02 | 촬영·발표 때 [재분석]하고 화면의 점수로 설명한다. 10-28~11-02에는 78 BID, 11-03 이후에는 72 WATCH가 예상된다. 66점은 "옛 마감 기준 일정 계수"로 설명한다. 골든 72는 mock 시험 기준으로만 쓴다. 리허설 중 불필요한 재분석은 하지 않는다 | 1·2 |
| Q8 | ADR-055·056·024·050의 상태 | 이번 정리에서는 바꾸지 않는다(결정은 사용자 몫). 관련 ADR에 "055 제안, 코드는 055대로"처럼 표시만 단다 | 7 |
| Q9 | X6 파인튜닝·실험 E0~E3·X2·B2 | "미결정"으로 통일하고 날짜만 지운다. `x2-impact-kit`·`bosun-b2-runbook` 계획은 남긴다 | 3·5·8 |
| Q10 | `/bids` 11열·표 안 가로 스크롤 | 지금 코드를 정본으로 인정하고 06을 코드에 맞춘다 | 5 |
| Q11 | 증거 중복(약 20MB: `evidence.zip`, n4b 루트 스크린샷 14장, screens-4~7) | 이번에는 지우지 않는다. `evidence/README.md` 색인만 고친다 | 8 |

## 3. 문서 밖 발견 (이번 범위가 아니라 따로 정할 것)

1. **운영에서 알림이 처리되지 않을 수 있다(추정, 발표 영향).** 회사 Worker는 수집·분석·첨부 전용 세 가지다(`infra/company/README.md:90·279`, `web/worker/analysis-only-main.ts`). 알림·마감 등록(`notifyWorkerRegistration`·`deadlineWorkerRegistration`)은 전체 Worker `web/worker/main.ts:857-914`에만 있다. 그래서 운영에서 인앱·카카오·마감 알림이 나가지 않을 수 있다. 카카오 실수신 녹화 전에 회사에서 확인해야 한다.
2. **D1 발표 중 데이터 출처가 바뀔 수 있다(코드 확인, 발표 영향).** 상단바 DEMO 배지는 URL의 `?origin=`만 읽는다(`web/components/topbar-demo-indicator.tsx:25`). 사이드바 "입찰 공고" 링크는 `/bids`라 출처 값이 없다(`web/components/app-nav.ts:52`). 발표 중 사이드바를 누르면 서버 기본 출처로 돌아간다. 기본값이 live면 DEMO 대신 실공고 목록이 보인다.
3. **리허설 중 FX-02를 재분석하면 운영 화면이 바뀐다.** 결과가 78 BID가 되어 대시보드 BID 수와 권고 알림이 달라진다.
4. **ADR-044 때 코드가 남아 있다.** `services/ai/app.py`·`services/ai/vercel_build.py`·`services/ai/tests/test_vercel.py`다.
5. **API 문서와 코드가 다르다.** 05의 `INVALID_SOURCE_DOCUMENT`(422)는 코드에 없다. `downloadPath`는 항상 null이다. 이번에는 문서를 코드에 맞춘다.
6. **없는 절을 가리키는 참조가 있다.** `AGENTS.md:46`·`web/server/organization/organization.mail.ts:117`·`web/lib/error-report.ts`가 `boilerplate/first-deployment.md`에서 사라진 절을 가리킨다. AGENTS.md는 과제 1에서 고친다. 코드 주석 2곳은 코드 작업으로 넘긴다.
7. **회사 AI 모드 서술이 운영과 다르다.** ADR-049·회사 실행서는 "mock 유지"라고 쓴다. 운영 readiness는 `ai: local`을 보고한다. 확인하려면 운영 조회 승인이 필요하다. 그 전까지는 "미확인"으로 쓴다.
8. **CI가 돌지 않는다.** GitHub Actions job이 10-24부터 결제 문제로 시작되지 않는다.

## 4. 순서와 충돌 대책

- **선행 조건**: 아래 두 작업이 main에 들어간 뒤에 해당 과제를 시작한다. 다른 과제는 먼저 시작할 수 있다.
  - `feat/company-public-profile`(미병합): 09·16·PROGRESS·계획 1개를 고친다. 이것이 병합된 뒤 과제 5(06·09)와 과제 7(16)을 시작한다.
  - `feat/lh-bid-notice`(PROGRESS 미커밋): 이것이 커밋된 뒤 과제 9를 시작한다.
- **작업 공간**: `git -C /Users/leegwanghui/dev/hackathon/sol-radar worktree add /Users/leegwanghui/dev/hackathon/sol-radar-worktrees/docs-cleanup-1027 -b docs/cleanup-1027 origin/main`
- **main은 지금도 바뀐다.** 10-27 13:13 `f0ad424a`가 PROGRESS를 고쳤다. 그래서 다음을 지킨다.
  - 과제마다 커밋을 나눈다.
  - 병합 직전에 main 위로 rebase한다.
  - 충돌이 나면 main 쪽 새 사실을 살리고, §5 규칙을 다시 적용한다.
- **작업자 지시문에 넣을 것**:
  - 같은 파일은 한 작업자만 맡는다. git 상태 변경은 하지 않는다.
  - `.env`·`.env.local`은 읽지 않는다.
  - 훅·가드·권한 거부에 막히면 돌아가지 말고 멈춰 보고한다.
  - 무거운 검증은 슬롯 스크립트로 감싼다.
- **커밋**: `docs: …`, 첫 줄 50자 이내. 병합·push는 사용자 승인 뒤에 한다.

## 5. 공통 규칙 (모든 과제에 적용)

- **날짜**: 날짜는 제출 11-03·발표 11-04 두 개다. 남은 일정은 12의 제안 표 한 곳에만 두고, 다른 문서는 날짜를 반복하지 않고 12를 링크한다.
- **현재 사실만 쓴다**:
  - 끝난 "구현 중·예정·승인 대기·검토 중"은 지금 상태로 바꾸거나 지운다.
  - 확인하지 못한 것은 "미확인"으로 쓴다.
  - 운영 사실(알림 Worker, `ai: local`)은 조회 없이 확인으로 바꾸지 않는다.
- **작업 이력을 뺀다**: 브랜치·세션 이름, 커밋 해시 나열, "N 세션이 …" 같은 서술을 정본에서 지운다. 근거는 링크 하나만 둔다.
- **퇴역 내용**: Kev·Qwen3.5-27B·Qwen 4B·ADR-044 Vercel ai·MinIO를 현재처럼 쓰지 않는다. 꼭 필요한 곳에만 "퇴역(ADR-034/049/048)" 한 줄을 둔다.
- **숫자 기준**:
  - 골든 94/72/68(mock), FX-15 68
  - 인력 200명·95.5 FTE
  - 수집 3시간마다(KST 00·03·…·21시)
  - 운영 migration 62개(10-27)
  - served id `Qwen3.8-Flash-Next-AWQ-INT4`
  - FX-02 66은 10-24 운영 run 결과다. 원인은 일정 계수(추정)다.
- **용어**: 발표 경로 "D1"과 겹치는 "결함 D1"은 "결함 W1(회사 Worker 미소비)"로 바꾼다.
- **Obsidian 규약**: frontmatter 5개 키를 지키고 `updated`를 갱신한다. `## 관련 문서` 절과 위키링크를 유지한다. 루트 `AGENTS.md`의 기술 스택 목록은 줄이지 않는다.
- **링크**: 지운 파일을 가리키는 링크는 같은 커밋에서 고친다.

## 6. 과제

### 과제 0: 작업 공간·기준선·ADR-057

**파일**: `docs/16-DECISIONS.md`(ADR-057 추가만), scratchpad 검사 스크립트

- [ ] §4 명령으로 worktree를 만든다. 두 선행 브랜치의 병합 상태를 적는다.
- [ ] 링크 검사 스크립트를 scratchpad에 만든다(저장소에 넣지 않는다). 검사 대상은 두 가지다.
  - 위키링크 `[[이름]]`·`[[경로|별칭]]`: vault 안 파일의 basename 또는 경로로 해석되는지
  - Markdown 상대 링크: 대상 파일이 있는지
  - 범위는 `docs/`·`polaris/`·루트 `*.md`·`.claude/**/*.md`다. 시작 전 깨진 링크 수를 기준선으로 적는다.
- [ ] 정리 전 크기를 적는다: 16·PROGRESS·10·11·12·19의 바이트·줄 수.
- [ ] 16에 ADR-057 "문서 정리 원칙(ADR-054 §1 개정)"을 추가한다. §2 Q1~Q5의 사용자 결정 원문을 그대로 옮긴다. ADR-054 §1에는 "057로 개정" 한 줄을 단다.
- 완료 기준: worktree가 있고, 기준선 숫자를 기록했고, ADR-057이 들어갔다.

### 과제 1: 해커톤·로드맵 (G1)

**파일**: `docs/00-README.md`, `docs/01-PRD.md`, `docs/12-ROADMAP.md`, `docs/17-CLAUDE-IMPLEMENTATION.md`, `docs/18-HACKATHON.md`, `docs/CLAUDE.md`, 루트 `CLAUDE.md`·`AGENTS.md`

- [ ] **12**: 230줄을 120줄 안팎으로 줄인다.
  - 남길 것: 새 마감 콜아웃, 남은 일정 제안 표, Phase·P0·해커톤 컷 표, Critical Path 상태 표, 수집 규칙.
  - 남은 일정 제안 표: 10-29 DEMO 행은 완료로, 첨부 행은 운영 적용 상태로 고친다.
  - 수집 규칙: 3시간으로 고친다.
  - 98행: revision diff 화면이 구현됐으므로 고친다.
  - 지난 일정 절은 지운다.
- [ ] **18**: 다음을 고친다.
  - §7 정직성 표: 각 칸을 "현재 사실 + 근거 링크"로 줄인다.
  - 167행: 148행과 같은 내용이라 지운다.
  - 129·178·197: 실공고 본문은 비어 있고 근거는 첨부다(`normalize-g2b.ts:146`).
  - 184: MinIO → Storage.
  - 75·169: 27명 → 200명.
  - 60·72·150·151·171·215·220: 실추론 서술을 하나로 맞춘다.
  - 119·127·198: FX-02 설명을 Q7대로 바꾼다.
- [ ] **00**: 다음을 고친다.
  - 문서 표의 10·12·13·23행을 현재 내용으로 고친다. 23은 지우면 행도 지운다.
  - 지울 것: Kev 콜아웃(111-113), "검토 중" 절(123-127), 끝 문단(140), 13행.
- [ ] **17**: 해커톤 모드 절의 2·4·8·9번을 고친다. 지난 일정을 지우고, ADR-041 메일과 ADR-027 서술을 정리한다.
- [ ] **01**: FR-09·FR-22, 비기능 데모 환경(88), X2 날짜(120), 확장 절(124-128·141)을 고친다.
- [ ] **docs/CLAUDE.md, 루트 CLAUDE.md·AGENTS.md**:
  - ADR-044를 049로 바꾼다.
  - `AGENTS.md:8`의 ADR-047 오기를 고친다.
  - `AGENTS.md:46`이 `first-deployment.md`의 사라진 절을 가리키므로, 이유를 직접 적는다.
  - docs/CLAUDE.md에 일정·D1 한 줄을 넣는다.
- 완료 기준: 묶음 안에서 `10-2[4-7]|freeze|D-day|주말`이 지난 일정 뜻으로 0건이다. 27명·30분·MinIO·ADR-044 현재 서술도 0건이다.

### 과제 2: 데모·제출물 (G2, Q6·Q7 뒤)

**파일**: `docs/19-DEMO-SCENARIO.md`, `docs/submission/*.md`

- [ ] **19**: D1 기준으로 다시 쓴다.
  - 지울 것: §3.1 실행 경로 선택 문단(112-116, MinIO·freeze), S5의 `BID_CHANGED` 알림 기대(코드에 없음, `outbox.model.ts:15-20`).
  - S4: Q7대로 고친다. 버튼 이름은 분석이 있으면 "재분석", 없으면 "분석 실행"이다(`bid-detail-view.tsx:477-482`).
  - S3: 시작 URL에 출처(`?origin=demo`)를 붙인다. §3-2의 출처 위험을 대본 주의로 적는다.
  - 로컬 Compose 체크리스트는 "대체 경로" 한 절로 모은다.
  - DEMO 마감 이동은 "10-27 적용 완료"로 고친다.
- [ ] **slides-outline.md**: 캡처 매핑만 slides-spec 부록으로 옮기고 지운다.
- [ ] **video-storyboard.md**: slides-spec 부록 A로 합치고 지운다.
- [ ] **자리표시 19곳**(`〔10-25 결과 대기〕` 16곳, `〔10-26 B5 결과 대기〕` 3곳): 기다리는 결과별로 처리한다.
  - S-LIVE run·녹화·카카오를 기다리는 곳은 "촬영 뒤 채움"으로 바꾼다.
  - B5를 기다리는 곳은 X6 미결정이라 지운다.
  - README:39·evidence-list:26의 "운영 smoke 재확인"은 이미 풀렸으므로 고친다.
- [ ] **깨진 링크**: `slides-spec:478` ADR-052 → 054, `slides-spec:333` rehearsal-log 경로를 고친다.
- [ ] **limitations**: 커밋 해시 목록과 승인 경위를 줄이고, ADR-056 한계를 더한다.
- 완료 기준: 첨부 "구현 중"·DEMO "준비 중"·"27명"이 0건이다. 자리표시는 남은 결과 종류별로만 있다. 덱 pptx는 git 밖이라 다시 만드는 일은 따로 한다.

### 과제 3: AI·모델 (G5)

**파일**: `docs/03-AI-PIPELINE.md`, `docs/21-MODEL-TRAINING.md`, `docs/22-FINETUNE-RUNBOOK.md`, 삭제 `docs/23-WEEKEND-FINETUNE.md`·`docs/BOSUN_FINETUNING_GPT_HANDOFF.md`·`docs/SOL_RADAR_BOSUN_QWEN4B_MIGRATION_BRIEF.md`

- [ ] **03**: 다음을 고친다.
  - 24·62·72의 첨부 "미구현"과 66-67의 10-21 콜아웃.
  - 71·671: gateway 위치는 회사 Compose다.
  - 1000-1001: `decision_embeddings_sha256`는 이미 대조한다(`registry.py:36-37`).
  - 992: 레지스트리에 없는 `bosun-sol-lora-v0.1`.
  - 744: `PARSE_UNSUPPORTED`는 생긴다(`analyze.ts:85`).
  - 246·740: 상단바 표시 제거, 모델 중립 문구는 구현됨.
  - 554·1008: 지운 시험 인용.
  - Kev 이력 약 26줄과 "검토 중" 절을 지운다.
- [ ] **21**: 지난 일정과 "E4 먼저" 단정을 X6 미결정으로 바꾼다. Qwen id를 고친다. 23 §4.2·§4.4의 데이터 출처를 §3으로 옮긴다.
- [ ] **22**: 다음을 고친다.
  - 34·400·414의 날짜를 지운다.
  - Qwen id 7곳(57·209 포함)을 고친다.
  - MinIO와 지운 시험 인용을 고친다.
  - 21·23·03과 겹친 표 4종을 정리한다.
  - 미확인 표를 이 문서 하나로 모은다.
- [ ] **23과 루트 BOSUN 2개**: 지운다(Q5). 들어오는 링크를 같은 커밋에서 고친다.
  - 23을 가리키는 곳: 00:75, 03:1029, 10, 12:107·126, 16, 17:52, 21:335, 22:444, PROGRESS, plans.
  - BOSUN 2개를 가리키는 곳: 16:677, PROGRESS:306·484, plans 3곳, evidence/people 2곳.
  - 링크는 "원문은 git `<해시>`"로 바꾼다.
- 완료 기준: `Qwen/Qwen3.8-Flash-Next`(id 뜻)와 Kev 현재 서술이 0건이다. 지운 시험 파일 인용도 0건이다.

### 과제 4: 데이터·API·점수 (G6)

**파일**: `docs/04-DATABASE.md`, `docs/05-API-SPEC.md`, `docs/07-DATA-PIPELINE.md`, `docs/08-SCORING.md`, `docs/15-DATA-CONTRACTS.md`

- [ ] **04**: 다음을 고친다.
  - 값 집합 3개(304·323·324)를 `20261023000100`에 맞춘다.
  - 빠진 표 15개·뷰 3개·주요 함수를 넣는다.
  - `bid_documents`의 UNIQUE를 지우고(`20261021000700:42`) 새 열 10개를 넣는다.
  - 적용 상태를 "운영 62개"로 고친다.
  - §6 migration 목록은 번호와 한 줄 설명만 남긴다.
- [ ] **05**: 다음을 고친다.
  - §2 표에 코드에만 있는 경로 6개를 넣는다(opportunities·program-notices·admin/ingestion/services 등).
  - `download-url`(200 `{url,expiresIn:60}`)로 고친다.
  - 오류 코드 `PROJECT_ALREADY_OPEN`·`INVALID_PROJECT_TRANSITION`을 넣는다.
  - Gateway 허용 경로를 7개로 고친다(`redis-api-path.ts:15-25`).
  - 날짜별 구현 상태 문단과 다운로드 부록을 지운다.
  - `INVALID_SOURCE_DOCUMENT`를 지운다.
  - `downloadPath`는 "항상 null"로 적는다.
- [ ] **07**: 다음을 고친다.
  - 87: 30분 → 3시간. env는 무시된다.
  - 21: 정보화 필터 모순을 정리한다. 실제로는 필터가 꺼져 있다(`worker/main.ts:565`).
  - §2에 서비스별 장애 격리 절을 넣는다(`162a09ab`, `ingest:source-readiness`).
  - 279·354: `DEADLINE_APPROACHING`은 D-3·D-1 알림으로 구현돼 있다.
  - "운영 미적용"을 고친다.
- [ ] **08**: 끝 절 제목·면책 문단·이력 문장만 정리한다.
- [ ] **15**: `NormalizedBid`의 값 집합과 registry 키 수(15개)를 고친다.
- [ ] **공통**: 다섯 파일 끝의 ADR-047 면책 문단과 "검토 중 확장" 절을 지운다. 내용은 ADR-047 한 곳에만 둔다.
- 완료 기준: 04 표 목록이 migration과 같고, 05 경로 표가 `web/app/api/v1/**/route.ts`와 같다. 대조 결과를 커밋 메시지 본문에 적는다.

### 과제 5: 구조·화면·보안·배포·시험 (G7, 06·09는 company-public-profile 병합 뒤)

**파일**: `docs/02-ARCHITECTURE.md`, `docs/06-UI-UX.md`, `docs/09-SECURITY.md`, `docs/10-DEPLOYMENT.md`, `docs/11-TESTING.md`

- [ ] **02**: 구성도 2개를 운영 기준으로 다시 그린다. 운영 구성은 Vercel web, 회사 redis-api·gateway·Worker 3종, 회사 모델이다. documents·파서 상태, MinIO, Kev 콜아웃도 고친다.
- [ ] **06**: 다음을 고친다.
  - 코드에만 있는 라우트 4개를 넣는다(`/settings/organization`·`/bids/programs`·`/bids/[id]/revisions`·`/projects/[id]`).
  - `/bids`를 11열·표 안 가로 스크롤로 고친다(Q10).
  - 30-1·30-2를 구현됨으로 바꾼다.
  - 10-22 상태 절과 Topbar 지표 행을 지운다.
- [ ] **09**: 다음을 고친다.
  - sol_role 감사는 구현돼 있다(`20261023000600_role_audit_triggers.sql`).
  - MinIO를 고친다.
  - service role 기동 거부(`deployment-role.ts:45`)를 넣는다.
  - 중복 절과 메일 절을 정리한다.
- [ ] **10**: 약 40%를 지운다.
  - 지울 것: ADR-044 절 2개(92-122·455-489), freeze 절(521-531), 중복 확장 절, 메일 절.
  - 옮길 것: GPU 세부(292-323)는 22와 `infra/gpu/README.md` 링크로 바꾼다.
  - 더할 것: 회사 Compose 프로젝트 4개 표, D1 당일 운영 확인 절. "B2에서 확인" 문장은 Q9대로 "미결정"으로 바꾼다.
- [ ] **11**: 약 45%를 지운다.
  - §3 표의 시험 파일 열을 지금 있는 파일 기준으로 다시 쓴다.
  - §8~§11 검증 경위를 지운다.
  - §5 체크리스트를 "D1 본선"과 "대체 경로"로 나눈다. S6 `docker compose stop`은 대체 경로에만 둔다.
  - CI가 멈춘 사실을 적는다.
- 완료 기준: 11이 적은 시험 파일이 모두 실제로 있다. 10·02에 ADR-044·MinIO 현재 서술이 0건이다.

### 과제 6: 알림·관측·용어 (G4)

**파일**: `docs/13-NOTIFICATIONS.md`, `docs/14-OBSERVABILITY.md`, `docs/20-GLOSSARY.md`

- [ ] **13**: 약 35%를 줄인다.
  - 지울 것: 10-22 상태 절, 구현 상태 두 문단, 메일 상세, "10-25 녹화 예정".
  - `BID_*` 조직별 발송은 "구현 없음"으로 적는다.
  - 운영 알림 소비자가 없다는 점(§3-1)을 "미확인 위험"으로 적는다.
- [ ] **14**: `/health/ready`의 storage·ai 출처(Worker가 Redis에 남긴 보고)를 넣는다. 상단바 AI 표시와 MinIO 서술을 지운다.
- [ ] **20**: 약 15행을 고친다.
  - 27명 → 200명.
  - 파서·documents 소비자는 구현됨으로 바꾼다.
  - 코드에 없는 `review` 도메인을 지운다.
  - 새 용어를 넣는다: D1·S-LIVE·출처(origin)·redis-api·documents-only worker·결함 W1.
- 완료 기준: 20의 정의가 03·07·13과 같다.

### 과제 7: 16-DECISIONS 구조 정리 (G3, company-public-profile 병합 뒤)

**파일**: `docs/16-DECISIONS.md`

- [ ] **바로 지울 것**:
  - 가짜 ADR 절(129-132)
  - ADR-048 아래 콜아웃(146-147)
  - 겹친 번호 콜아웃
  - 미결정 표에서 해소된 13행. 남는 일은 PROGRESS 할 일로 옮긴다.
- [ ] **옮길 것**: 91-92의 served id 콜아웃을 ADR-034로 옮긴다. ADR-034 제목의 Qwen3.5-27B를 고친다.
- [ ] **색인 표**: 번호순 하나로 만들고 043·050 행을 넣는다. 본문은 최신이 위로 오게 정렬한다.
- [ ] **대체 표시를 양쪽에 단다**:
  - 044 ↔ 049
  - 003·017·028 ↔ 048
  - 019·021·042 ↔ 043
  - 038 ↔ 050·054
  - 023 ↔ 054
  - 034의 12·17번(지난 일정)
  - 033 E1 ↔ 055(제안)
- [ ] **한 줄로 줄일 것(Q3)**: ADR-027, ADR-029~036, ADR-042 일정표·배정. 형식은 "ID·제목·상태·결정 요지·원문 `<커밋 해시>`"다.
- [ ] **지난 일정을 현재처럼 쓴 조항**: ADR-038(825-829), ADR-044·045의 "10-24 freeze 전 green"에 054·057 대체 표시를 단다.
- [ ] **ADR 상태는 바꾸지 않는다**(Q8).
- 완료 기준: 크기가 150KB 안팎이다. ADR 번호 누락·중복이 없다. 다른 문서의 `[[16-DECISIONS|ADR-0NN]]` 링크가 모두 해석된다.

### 과제 8: 하위 폴더 정리 (G8)

**파일**: `docs/plans/`, `polaris/specs/`, `docs/boilerplate/README.md`·`first-deployment.md`·`setup.md`, `docs/evidence/README.md`, `docs/evidence/dev-server-20261021.txt`, `docs/error/`, `.claude/skills/{database,help,setup}/SKILL.md`, `.claude/agents/docs-keeper.md`

- [ ] **`docs/plans/`에서 남길 것(기존 27개와 이 계획. 나머지 41개는 지운다)**: 앞으로 병합될 10-27 계획(company-public-profile·lh-bid-notice-activation)도 남긴다.
  - 정본이 인용하는 것: sidebar-ia-design, kakao-memo-notify-design, public-procurement-expansion-plan, external-ingestion-completion-plan, 2026-10-26-live-ops-cutover
  - 운영 실행서: 2026-10-27-ingest-source-isolation-deploy, 2026-10-27-company-rollout-attachments
  - 코드 주석이 가리키는 디자인 스펙 7개: c6-screens-design, boost2-what-if-ui, n8-admin-ingestion-design, n2-org-settings-design, n6-bid-projects-ui-spec, p08-stage-links-ui-spec, s5-revisions-ui-spec
  - 코드·ADR-054 D1 정의가 가리키는 것: n8-admin-ingestion-plan, 2026-10-25-live-ingest-hourly-plan
  - 정본 25곳이 절 번호로 인용: bosun-qwen4b-migration-plan
  - 마이그레이션·design/tokens.json·services/ai/eval/README.md 주석이 가리키는 것(고칠 수 없거나 코드 검사가 돌아 남김, ledger R2): 2026-10-16-landing-redesign-design, 2026-10-19-e3-experiment-design, 2026-10-20-kakao-memo-notify-plan, 2026-10-21-n3-watchlist-plan, 2026-10-21-n6-bid-projects-plan, 2026-10-21-program-notices-plan, 2026-10-21-redis-gateway-supabase-storage-migration
  - 미결정 실험(Q9): x2-impact-kit, bosun-b2-runbook
  - 사용자 원 요구서: SIDEBAR-PLAN
  - 이 계획
- [ ] **들어오는 링크 고치기**: 지운 계획을 가리키는 정본 링크를 같은 커밋에서 "원문은 git `<해시>`" 또는 대응 ADR 링크로 바꾼다. 대상은 G8 §9 표의 16 약 30곳, 05·06·11·12·19·21, submission 4곳이다.
- [ ] **남긴 계획의 frontmatter**: `status`를 실제 상태로 고친다(병합된 것은 `done`).
- [ ] **polaris/specs**: 다음을 정리한다.
  - `planned/2026-10-21-public-procurement-expansion.md`는 중복이라 지운다. `09:294` 링크는 in-progress 파일로 바꾼다.
  - in-progress profile-photo·agency-program-notices와 planned web-company-deployment는 `done/`으로 옮긴다.
- [ ] **boilerplate**: `first-deployment.md`를 ADR-049(web 단독) 기준으로 다시 쓴다. README:4·8·29·32(번호 00~23, 배포 구성)와 setup.md:49를 고친다.
- [ ] **`.claude`**: skills의 "배포처 미정"(database:288·help:87·setup:99)을 결정 완료(ADR-049)로 고친다. docs-keeper의 PROGRESS 작업 로그 규칙(17·31행)을 과제 9의 새 형식에 맞춘다.
- [ ] **evidence**: `evidence/README.md`의 폴더별 색인(10-20에서 멈춤)을 목적과 규칙만 남긴 짧은 안내로 바꾼다. `dev-server-20261021.txt`(5줄 로그)를 지운다.
- [ ] **`docs/error/image.png`**를 지운다(Q5).
- 완료 기준: 링크 검사의 깨진 링크가 기준선 이하이고, 이번에 새로 깨진 링크는 0건이다.

### 과제 9: PROGRESS 줄이기 (G4, 마지막, lh-bid-notice·company-public-profile 뒤)

**파일**: `docs/PROGRESS.md`

- [ ] **남길 것**:
  - 현재 상태 요약
  - 기능 상태 표 하나: 핵심 컷·확장·P1·X6 항목, 상태, 근거 링크
  - 남은 일: 12 제안 표 링크와 §3 문서 밖 발견
  - 운영 상태와 마지막 확인 시각
- [ ] **지울 것(Q4)**: 작업 로그 120행, "관련 문서" 뒤의 절 10개, 겹친 체크리스트 3곳. 새 작업 로그는 최근 항목만 한 줄씩 둔다.
- [ ] **바로잡을 것**: 병합된 X5·P1·N1·N2·N9는 완료로 바꾼다. 이미 끝난 "남은 것"(파서·실추론 1건)과 "운영 미적용·커밋 전" 제목도 고친다.
- 완료 기준: 30KB 이하. 상태가 12·18·16과 같다.

### 과제 10: 통합 검증·병합

- [ ] 링크 검사를 다시 돌린다. 이번에 새로 깨진 링크가 0건이어야 한다.
- [ ] frontmatter 검사: 남은 `docs/**/*.md`(boilerplate·evidence 제외)에 5개 키가 다 있어야 한다.
- [ ] 정본(00~22·CLAUDE·submission)에서 grep한다. 아래 결과를 표로 남긴다.
  - 지난 일정: `10-2[4-7]|freeze|D-day|주말|녹화 예정`. 허용 위치는 16 ADR-042·054·057 한 줄 요약뿐이다.
  - 옛 숫자·퇴역 서술: `27명|20 FTE|30분|MinIO|Qwen/Qwen3.8-Flash-Next|Kev-[049]B`. 허용 위치는 "퇴역" 한 줄뿐이다.
- [ ] 크기 표: 과제 0 기준선과 비교한 바이트·줄 수.
- [ ] `pnpm verify:changed --base <worktree 기준 커밋>`를 실행하고, 커밋 게이트를 통과한다.
- [ ] 독립 읽기 리뷰를 1회 한다(docs-keeper 또는 general-purpose, 읽기 전용). 문서 간 숫자·용어·날짜 일치를 본다.
- [ ] main 위로 rebase한다. 사용자 승인 뒤 main에 병합·push하고 커밋 해시를 보고한다.

## 7. 실수하기 쉬운 곳

1. **다른 세션의 새 사실을 지우는 경우.** rebase 충돌을 내 쪽으로 해결하면, main에 새로 들어온 운영 사실을 지운다. 충돌한 줄은 main 쪽 사실을 먼저 읽고 합친다.
2. **삭제 뒤 링크가 깨지는 경우.** Obsidian 위키링크는 basename으로 해석되므로, 같은 이름 파일이 다른 폴더에 있으면 검사가 놓친다. 지운 파일 이름으로 `grep -rn`을 한 번 더 돌린다.
3. **추정을 확인으로 바꿔 쓰는 경우.** 운영 알림 Worker, `ai: local`, FX-02 66 원인은 "미확인·추정"으로 둔다.
4. **ADR 축약이 결정 내용을 지우는 경우.** 한 줄 요약에 "무엇을 정했나"가 남아야 한다. 경위·검증 기록만 지운다.
5. **docs-keeper·스킬이 옛 형식을 계속 쓰는 경우.** PROGRESS 형식을 바꾸면 `.claude/agents/docs-keeper.md`도 같은 커밋에서 바꾼다(과제 8).

## 관련 문서

- [[16-DECISIONS|16 ADR]] ADR-042·054
- [[12-ROADMAP|12 로드맵]]
- [[PROGRESS|진행 상황]]
- [[00-README|문서 인덱스]]
