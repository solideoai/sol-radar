---
title: 추천 공고 팀별 인력 배치 화면 확인
status: done
tags: [sol-radar, evidence, workforce, web]
updated: 2026-10-30
---

# 추천 공고 팀별 인력 배치 화면 확인 (2026-10-30)

계획: [[2026-10-30-team-staffing|추천 공고 팀별 인력 배치 구현 계획]] Task 3 Step 6. 스펙: [[2026-10-29-feature-backlog|기능 백로그]] "2 + 8", 결정 D2 1안(저장 없음).

> [!warning] 운영 화면이 아니다
> 격리 로컬 스택의 데모 데이터(`demo:reset` 가상 공고·가상 직원 200명, mock 사전 분석)로 찍었다. 운영 DB·회사 서버·공공 API·유료 모델은 부르지 않았다. 운영 화면은 배포 뒤 따로 본다.

## 환경

| 항목 | 값 |
|---|---|
| 코드 | `feat/team-staffing` worktree(기준 `b9db064b`) 작업 트리 |
| Supabase | `supabase start --workdir <scratchpad>/teamdb`, project_id `sol-radar-team-staffing`, API 59411·DB 59412, studio·realtime 끔. 마이그레이션 73개 적용 |
| 데이터 | `pnpm demo:reset -- --env-file <scratchpad 파일>` → `seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true` |
| 분석 | Compose 프로젝트 `sol-radar-team-staffing`(redis·ai-gateway·worker, `SOL_RUN_MODE=mock`, `AI_PROVIDER=mock`, worker 가 격리 Supabase 를 가리키는 것을 `docker inspect` 로 확인) 안에서 `worker/demo-preanalyze.ts` → `targets=18 completed=18 partial=0 failed=0` |
| 웹 | `next dev --port 3194`(anon 키만 둔 env, `SOL_DEFAULT_ORIGIN=demo`), 데모 관리자 계정으로 로그인 |
| 촬영 | `web/node_modules` 의 `@playwright/test` Chromium 단독 스크립트(저장소에 두지 않았다). `/workforce` 에서 [추천 공고 불러오기]를 누른 뒤 1440×900 으로 찍고, 1280×900 으로 바꿔 주소(`?bidIds=…`)를 다시 불러 찍었다. 이어 공고 3열을 보려고 추천순 앞 3건(`GET /api/v1/opportunities?origin=demo&status=OPEN&status=AMENDED&limit=3`)을 `?bidIds=` 로 열어 1280 에서 찍었다 |

## 결과

- [추천 공고 불러오기]가 `GET /api/v1/opportunities?origin=demo&recommendation=BID&status=OPEN&status=AMENDED&limit=3` 으로 추천 공고를 읽었다. 데모 데이터의 열린 BID 추천은 2건이라 2건이 선택되고 곧바로 조회됐다.
- 첫 공고(세종 차세대 행정정보시스템 고도화, 가상)는 추출 `staffing` 이 있어 역할별 필요 인력이 나왔다: `PM · 1명 필요 · 가용 후보 17명`, `PL · 1명 필요 · 가용 후보 17명`, `개발 · 10명 필요 · 가용 후보 34명`. "가용 후보"는 분석 당시 가용 FTE 가 0 보다 큰 사람 수이고, 가용이 없는 사람은 이름 뒤에 `가용 0` 이 붙는다(예: `정서윤(PM·초급·가용 0)`). 역할마다 팀 3개를 펼치고 나머지는 "나머지 n개 팀 보기"로 접는다.
- 둘째 공고(대전 스마트시티 유지보수, 가상)는 `staffing` 이 없어 "역할 정보 없음"과 "필요 인력은 예산 구간 추정입니다.", 팀별 후보 묶음이 나왔다.
- "팀별 지원 요청" 표: 머리 `팀` + 두 공고 제목, 37개 팀. 인원이 많은 팀 10줄만 그리고 표 아래 [나머지 27개 팀 보기]로 같은 표 안에 펼친다(누르면 [접기], `aria-expanded`). 공고 3건이면 38개 팀 중 10줄과 [나머지 28개 팀 보기]이고, 펼친 38줄도 1280 에서 넘치지 않는다. 같은 사람이 두 공고 칸에 함께 나오고, 첫 공고 칸에는 맡을 역할(`PM · PL · 개발`)이 붙는다. 둘째 공고는 역할 정보가 없어 역할 줄이 없다. 후보가 없는 칸은 "—".
- 공고 3건(인천 민원 챗봇·광주 AI 행정 비서·부산 지능형 CCTV, 모두 가상)을 1280 에서 열면 카드 3열과 팀 표(머리 `팀` + 공고 3열)가 넘치지 않는다.
- 역할·기술 요구조건이 없는 공고(`candidateBasisMissing`)는 팀 표에 사람을 채우지 않고 열 머리에 "요구조건 없음 · 사람이 확인"을 적는다(브라우저 시험으로 고정. 이번 데모 데이터에는 그런 추천 공고가 없어 화면에는 나오지 않았다).
- 가로 넘침: 1440·1280·1280(공고 3건) 모두 문서 `scrollWidth - clientWidth = 0`, 창 오른쪽을 넘는 본문 요소 0개(`check.json`). 넘침으로 잡힌 것은 `caption.sr-only` 3개(화면에 보이지 않는 1px 캡션)뿐이다.
- 콘솔 오류 1건은 `/health/ready` 503 이다. 격리 스택에 회사 redis-api 가 없어서이며 이 화면과 관계없다.

## 파일

| 파일 | 창 | 내용 |
|---|---|---|
| `workforce-1440.png` | 1440×900 | 첫 화면: [추천 공고 불러오기]·도움말, 선택된 추천 공고 2건 |
| `workforce-1280.png` | 1280×900 | 같은 화면 |
| `workforce-1440-bid-card.png` | 1440×900 | 첫 공고 카드 요소: 역할별 필요 인력·팀 묶음·팀별 후보 |
| `workforce-1280-bid-card.png` | 1280×900 | 같은 요소 |
| `workforce-1440-team-plan.png` | 1440×900 | "팀별 지원 요청" 절 요소(접힌 기본 상태, 10줄) |
| `workforce-1280-team-plan.png` | 1280×900 | 같은 요소(10줄) |
| `workforce-1280-three-bids.png` | 1280×900 | 공고 3건 카드 3열 |
| `workforce-1280-three-bids-team-plan.png` | 1280×900 | 공고 3건의 "팀별 지원 요청" 절 요소(10줄) |
| `check.json` | — | 두 폭과 공고 3건(접힘·펼침)의 넘침 측정, 선택 목록·역할 줄·팀 표 머리와 줄, 경고 문구 |

- 요소 스크린샷 위쪽·가운데의 머리 띠(DEMO·수집 시각)는 고정 상단 바가 요소를 이어 찍을 때 겹친 것이다. 화면 배치 결함이 아니다.
- 전체 화면 스크린샷은 용량 때문에 남기지 않았다. 남은 긴 부분은 공고 간 공유 후보 표다(기존 절, 이번 변경 없음).
- 팀 표 접기를 넣은 뒤 격리 스택을 같은 설정으로 다시 띄워 모든 장을 다시 찍었다. 데모 데이터와 분석 결과(18/18)는 처음과 같다.

## 관련 문서

- [[06-UI-UX|06 UI/UX]] §5.12 `/workforce`
- [[2026-10-30-team-staffing|구현 계획]]
