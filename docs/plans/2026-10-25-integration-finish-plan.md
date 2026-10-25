---
title: "10-25 통합 마무리·운영 전환 계획"
doc: "plan-20261025-integration-finish"
status: draft
tags:
  - sol-radar
  - hackathon
  - ops
updated: 2026-10-25
---

# 10-25 통합 마무리·운영 전환 계획

> [!todo] 한눈에 (기준 2026-10-25 일 15:10 KST)
> 사용자 결정(15:00): ① 프로필 사진·N4b를 오늘 병합한다. ② 리허설은 격리 로컬 Supabase + Compose `mock`으로 한다.
> 추가 지시: 회사 서버 작업이 거의 끝났다. 회사가 준비되면 로컬 `mock` 리허설을 줄이고 운영 경로(Vercel + 회사)로 바로 간다.
> 순서: 병합 → 검증 → 운영 DB·버킷 → main push(Vercel 자동 배포) → **회사 게이트** → 운영 reset·smoke·리허설 → live(S-LIVE·카카오) → `mock` 복귀.
> 회사 GPU 학습(X6)은 이 계획에 없다.

## 0. 출발점 (15:10 확인)

| 항목 | 상태 |
|---|---|
| main | `4e84e084` = `origin/main`. 미추적 `web/public/naver-login-button.png` 1개(출처 미확인, 건드리지 않는다) |
| `integration/freeze-1024` | main + 12커밋. N4b(`a542e4da`)와 사진 1~6단계(`df7db275`). 전체 `pnpm verify` 기록 없음 |
| `feat/profile-photo` 나머지 | `0c73043a` 관리자 사진 변경, `9618e169` 퇴사 직원 신청 표시, `1ca32f47` e2e, `40300db2` ADR-051·기록. migration 없음. `git merge-tree` 충돌 없음. ADR-051은 main의 ADR-050과 겹치지 않는다 |
| 운영 DB | 이력 50개. 미적용 예정 5개: `20261024000200`·`000210`·`000300`(사진·가입 신청), `000400`·`000410`(N4b). 모두 추가형 |
| 운영 Storage | `profile-photos` 버킷 없음(private, 2MB, jpeg·png·webp) |
| Vercel | main push 때 자동 배포(`4e84e084` commit status `Vercel success`) |
| 회사 runtime | `/health/ready` 200, `ai:"local"`(live 또는 fixture로 추정). 10-24 분석 job 미소비(D1). 사용자가 지금 작업 중 |
| 슬롯 | `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/58e415e2-c7a2-4d61-a765-5bb0183b1d8c/scratchpad/verify-slot.sh <명령>`. 지금 빈 슬롯 2 |

## 1. 지키는 것

- 골든 94/72/68과 S3 "규칙이 결정 모델을 이긴다"는 **`mock`에서만** 보장된다([[19-DEMO-SCENARIO|19]] §2.1, [[03-AI-PIPELINE|03]] §5). 그래서 발표 본편 시각에는 회사가 `mock`이어야 한다. live는 S-LIVE·카카오 녹화에만 쓴다.
- `pnpm demo:reset`은 데모 조직의 `score_runs`·결정·알림을 지운다. 그래서 순서는 **마지막 reset·사전 분석 → S-LIVE·카카오(live) → `mock` 복귀**이고, 그 뒤 운영에서는 reset을 하지 않는다. 10-26 리허설은 격리 로컬 스택에서 한다(10-24 결정 §2-7).
- 운영 migration을 **먼저** 적용하고 main을 push한다. 새 코드가 새 열·함수를 읽는다.
- 무거운 검증(`pnpm verify`·`test:e2e*`·`next build`·`git commit`)은 슬롯 스크립트로 감싼다. 쓰기 git은 `git -C <절대경로> ... &&` 로만 쓴다. `.env*`는 어떤 도구로도 읽지 않는다. 가드·훅은 우회하지 않는다.
- 격리 스택 E2E는 `COMPOSE_PROJECT_NAME`을 반드시 준다. 이름 없이 `infra/compose.yaml exec worker`를 부르면 클라우드에 쓸 수 있다.
- 검증이 **제품 결함**으로 실패하면 고치지 않고 멈춘다. 빼기(브랜치 보존)를 추천해 보고한다. 환경·불안정 실패는 원인을 확인한 뒤 한 번만 다시 돌린다.

## 2. 단계

### T0. 인계 (15:10~15:15)

- [ ] sol-radar-78에 알린다: 통합 마무리는 sol-radar-40이 `sol-radar-worktrees/integration-freeze-1024`에서 맡는다. 78은 이 worktree의 git 상태를 바꾸지 않는다.

완료 기준: 메시지 전송.

### T1. 사진 나머지 병합 (15:15~15:30)

- [ ] `git -C <wt> status --short`가 비어 있는지 본다.
- [ ] 슬롯 안에서 `git -C <wt> merge --no-ff feat/profile-photo -m "feat: 프로필 사진 7~10단계 병합"`를 한다. 커밋 게이트가 돈다.

완료 기준: 병합 커밋이 생기고 게이트가 `[통과]`한다. `supabase/migrations`는 위 5개만 새로 생긴다.

### T2. 전체 검증 + 독립 리뷰 (15:30~16:20, 병렬)

- [ ] 슬롯 안에서 `pnpm verify`(worktree 루트)를 돌린다. 출력은 `docs/evidence/integration/20261025-verify.txt`에 남긴다.
- [ ] 같은 시간에 `security-auditor`로 독립 리뷰를 한 번 받는다(읽기 전용). 범위는 `main..integration/freeze-1024`이고, 중점은 migration 5개(RLS·`security definer`·Storage 정책)와 `POST`·`PATCH /team-members`·사진 업로드 경로다.

완료 기준: verify exit 0(루트·웹 시험·타입·린트·계층·생성물·빌드), 리뷰 상·중 0건. 중 이상이 나오면 멈추고 보고한다.

### T3. 격리 스택 E2E — 리허설 스택 겸용 (16:00~17:00)

- [ ] 격리 로컬 Supabase(scratchpad 사본, 사용 중이 아닌 포트)와 Compose(`COMPOSE_PROJECT_NAME=sol-radar-rh1025`, `SOL_RUN_MODE=mock`)를 띄운다. 절차는 세션 메모 "E2E 격리 스택"(scratchpad `supabase/` 사본, 포트 변경, 끝나면 자기 프로젝트만 정리)과 같다. 위 5개 migration이 들어간 스키마다.
- [ ] 알려진 결함이 있다. worker는 Supabase에 `host.docker.internal:<포트>`로 붙고 웹은 `127.0.0.1:<포트>`로 붙어 health 보고가 버려진다(머리말 "AI: 확인 중"). 웹 `NEXT_PUBLIC_SUPABASE_URL`도 `http://host.docker.internal:<포트>`로 맞춰 두 주소를 같게 한다. 이렇게 하려면 `/etc/hosts`에 `127.0.0.1 host.docker.internal`이 있어야 한다(사용자 sudo). 미검증이고, 안 되면 쓰기 E2E만 돌리고 읽기 화면은 직접 본다.
- [ ] `pnpm demo:reset -- --env-file <격리 env>` → 격리 worker로 사전 분석 → `pnpm -C web build`(슬롯).
- [ ] 슬롯 안에서 `pnpm -C web test:e2e:work`(사진 `profile-photo.write` 포함)를 돌린다.
- [ ] `/people` 추가·이동·퇴사(ADMIN), 비ADMIN 진입점 0, `/org-chart` 사진, 설정 사진, 관리자 사진 변경을 1440·1280에서 본다. 스크린샷은 `docs/evidence/integration/20261025-e2e/`에 둔다.

완료 기준: E2E 전부 통과, 두 폭 가로 넘침 0, 골든 94/72/68 화면 일치. 이 스택은 내리지 않고 10-26 리허설에 쓴다.

### T4. 운영 적용 — 사용자 승인 3건 (17:00~17:30)

미리 할 일(사용자, 회사 서버 불필요): **push 전에** Vercel에 카카오 키 4개(`KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET`·`KAKAO_TOKEN_ENC_KEY`·`KAKAO_REDIRECT_URI`)를 넣는다. 그러면 이번 자동 배포가 그 키를 함께 싣고, 재배포가 따로 필요 없다. 카카오 앱 설정은 [10-25 절차서](../evidence/demo-day/20261024-slive-check/20261025-slive-kakao-runbook.md) §2를 따른다.

1. [ ] main을 fast-forward한다: `git -C <main> merge --ff-only integration/freeze-1024`. 아직 push하지 않는다. 그 사이 main에 새 커밋이 있으면 일반 병합으로 하고 T2를 다시 볼지 판단한다.
2. [ ] `NODE_EXTRA_CA_CERTS=$HOME/.supabase/prod-ca-2021.crt bash scripts/db-push.sh --check` → 미적용이 정확히 5개인지 본다. 다른 파일이 보이면 멈춘다.
3. [ ] **승인 A1** 뒤 같은 CA로 `bash scripts/db-push.sh` → `bash scripts/db-verify.sh`.
4. [ ] **승인 A2**: 사용자가 버킷을 직접 만든다. 먼저 목록만 보고, 그다음 만든다.
   - `! node --env-file=.env.local scripts/ops/ensure-storage-buckets.mjs` → `profile-photos` `missing`
   - `! node --env-file=.env.local scripts/ops/ensure-storage-buckets.mjs --apply` → `created`
5. [ ] **승인 A3** 뒤 `git -C <main> push origin main` → `gh api repos/gwanghui97/sol-radar/commits/<SHA>/status`가 `Vercel success`인지 본다.

완료 기준: 이력 55개·미적용 0, `db-verify` 통과, `profile-photos` `ready`, 새 SHA 배포 READY, `/health/live` 200.

### T5. 운영 확인 — 읽기만 (17:30~17:50)

- [ ] 사용자가 자동화 브라우저 창에서 admin으로 로그인한다. 비밀번호는 세션이 모른다.
- [ ] `/people`("직원 추가" 버튼, 200명), `/org-chart`, `/settings` 사진 영역, `/settings/organization` 승인 표를 1440·1280으로 찍는다. 저장 위치는 `docs/evidence/deployment/20261025-integration/`.
- [ ] 운영에서는 직원 추가·사진 올리기 같은 쓰기를 하지 않는다. 쓰기 확인은 T3 격리 스택이 맡았다.

완료 기준: 화면 200, 넘침 0, 콘솔 오류 0.

### G. 회사 게이트 (목표 18:00, 사용자 보고)

회사 runtime(redis-api·AI gateway·Worker)이 아래를 만족하면 운영 경로로 간다.

- [ ] **첫 기동은 `mock`으로**(추천). 처음부터 live로 띄우면 다음 T6의 사전 분석이 실추론으로 돌아 골든 수치가 깨진다. 이미 live로 떴다면 T6 전에 `mock`으로 바꾼다(절차서 §3 복귀, 약 10분).
- [ ] 새 main SHA로 빌드한다(권장). 옛 SHA여도 진행은 할 수 있다. 차이는 Worker가 퇴사(`LEFT`) 직원을 빼는 한 곳(`web/server/analysis/analysis.repo.ts`)뿐이다.
- [ ] 확인: `/health/ready`의 `checks.ai="mock"`, admin `GET /api/v1/admin/ai/status`가 200이고 `runMode=mock`.

**18:30까지 안 되면**: 오늘 저녁은 T3 격리 스택에서 리허설 2회와 영상 클립 녹화를 한다. T6~T8은 10-26 오전으로 옮긴다.

### T6. 운영 reset·사전 분석·smoke 재실행 (18:00~19:00, 승인 A4)

- [ ] **승인 A4** 뒤 `pnpm demo:reset`(운영)을 돌린다. 10-24 smoke가 남긴 run `6a90acc4`·결정과 FX-15 58·FX-14 마감 문제가 같이 정리된다.
- [ ] 사전 분석은 **회사 Worker 컨테이너에서** 돌린다. 운영 큐가 회사 Redis라 로컬 Compose로는 안 된다(사용자, 회사 터미널). 컨테이너에 `worker/demo-preanalyze.ts`가 있는 것은 Dockerfile로 확인했고, 실행 자체는 미검증이다.
  `docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml exec -T worker node --conditions=react-server --import tsx worker/demo-preanalyze.ts` → 18건 `COMPLETED`.
- [ ] 10-24 smoke에서 실패·차단된 항목만 다시 돈다: FX-02 분석 202 → `COMPLETED` **72**, 알림 벨 `REVIEW_ASSIGNED`, 관리자 AI 상태, 다른 역할 403(비ADMIN 비밀번호가 있을 때만). 결과는 `docs/evidence/deployment/20261025-prod-smoke/`에 둔다.

완료 기준: FX-02 72·알림 벨 통과 → **발표 경로 = 운영 Vercel**. 실패하면 발표 경로는 격리 로컬 스택이고, 운영은 S-LIVE 조회용으로만 쓴다.

### T7. 운영 리허설 + 영상 클립 (19:00~20:30)

- [ ] [[11-TESTING|11]] §5 순서로 리허설을 1회 한다(`mock`). 시작 전에 개인 설정 "카카오톡 알림"을 끈다.
- [ ] 2회차에 3분 영상 클립 1~4를 녹화한다. 대시보드, FX-01, FX-03과 가정 재계산, FX-02 분석·결정·알림이다. 장애 대체(`PARTIAL`)와 다른 조직 404 클립은 T3 격리 스택에서 찍는다. 운영 gateway는 회사에 있어서 멈출 수 없다.
- [ ] **마지막 reset**: `pnpm demo:reset` → 회사 Worker로 사전 분석(T6과 같은 명령). FX-02는 미분석 상태로 남는다.

완료 기준: 리허설 1회 끝까지 통과, 클립 4개, reset 뒤 FX-02 `미분석`·사전 분석 18건.

### T8. live — S-LIVE·카카오 실수신 녹화 (20:30~21:30, 승인 A5)

[10-25 절차서](../evidence/demo-day/20261024-slive-check/20261025-slive-kakao-runbook.md) §3·§5를 그대로 따른다. 사용자가 지시한 "mock 없이 바로"는 이 단계에 해당한다.

- [ ] **승인 A5**: 회사만 live로 바꾼다(Vercel은 `mock` 그대로). 공공 API를 약 50~300회 쓰고 카카오 실발송을 한다. 전환 전에 `/admin/ingestion`에서 수집 창 시작 시각을 본다. 2일이 넘으면 멈춘다.
- [ ] 카카오 S0 수신 시험 → 카카오톡 알림 켜기 → 실공고 1건 분석 → 휴대폰 수신 녹화.
- [ ] 갈래 판정은 admin AI 상태로 한다. GPU가 없으면 `KEV_ENABLED=false`(Qwen만)이나 `PARTIAL`·`RULES_ONLY`가 될 수 있다. 어느 쪽이든 `run-modes.md`에 적고 그대로 말한다.
- [ ] `mock`으로 복귀하고 `checks.ai="mock"`을 확인한다. **이후 운영에서는 reset도, 데모 공고 분석도 하지 않는다.**

완료 기준: S-LIVE run 1건(공고번호·`score_runs.id`·`run_mode`·갈래 기록), 카카오 수신 영상, 회사 `mock` 복귀.

### T9. 기록 (21:30~22:00)

- [ ] [[PROGRESS]]에 10-24·25 기록을 남긴다.
- [ ] [[18-HACKATHON|18]] §7을 고친다. P1·N4b·사진은 병합, 카카오·S-LIVE는 실제 결과대로 적는다.
- [ ] [[2026-10-24-freeze-priorities|10-24 우선순위]]에 결과 한 줄을 적는다.
- [ ] 위 내용을 docs 커밋 하나로 남긴다.

## 3. 같이 진행 (위임, 회사 서버 불필요)

같은 파일을 두 작업자가 맡지 않도록 나눈다. 통합 세션은 docs를 T9에서만 고친다.

| 작업 | 파일 |
|---|---|
| 덱 정정(슬라이드 1·2·4·6·7·9·12·14~18)과 백업 PDF | `docs/submission/deck/sol-radar-deck.pptx`(git 제외) |
| 제출 문서 정정 | 루트 `README.md`, `docs/submission/*.md`(README·architecture·evidence-list·limitations·slides-spec·video-storyboard·experiment-tables) |

E1'~E4 숫자는 "회사 GPU 미가용으로 미측정"으로 둔다. E4 문장은 "회사 측 미실행"으로 미리 써 둔다.

## 4. 승인·사용자 몫

| # | 내용 | 단계 |
|---|---|---|
| A1 | 운영 DB migration 5개 적용 | T4 |
| A2 | `profile-photos` 버킷 생성(사용자가 직접 실행) | T4 |
| A3 | main push(Vercel 운영 자동 배포) | T4 |
| A4 | 운영 `demo:reset`(데모 조직 run·결정·알림 삭제) — T6·T7 두 번 | T6·T7 |
| A5 | 회사 live 전환, 공공 API 약 50~300회, 카카오 실발송 | T8 |
| 사용자 | `/etc/hosts` 한 줄(T3), Vercel 카카오 키 4개(T4 전), 카카오 앱 설정, 회사 `mock` 기동·사전 분석 명령(G·T6), 운영 로그인(T5) | — |

## 5. 시간표

| 시각 | 단계 | 회사 필요 |
|---|---|---|
| 15:10~15:30 | T0 인계, T1 병합 | 아니오 |
| 15:30~16:20 | T2 전체 verify ‖ 독립 리뷰 ‖ T3 스택 준비 | 아니오 |
| 16:20~17:00 | T3 격리 E2E·화면 | 아니오 |
| 17:00~17:30 | T4 운영 DB·버킷·push(A1~A3) | 아니오 |
| 17:30~17:50 | T5 운영 확인(읽기) | 아니오 |
| 18:00 | **G 회사 게이트**(`mock`, 새 SHA) | 예 |
| 18:00~19:00 | T6 reset·사전 분석·smoke(A4) | 예 |
| 19:00~20:30 | T7 리허설·클립·마지막 reset | 예 |
| 20:30~21:30 | T8 live S-LIVE·카카오(A5) → `mock` 복귀 | 예 |
| 21:30~22:00 | T9 기록 | 아니오 |
| 15:30~22:00 | 덱·문서 정정(위임) | 아니오 |

게이트가 18:30까지 안 되면 T3 스택에서 리허설·클립을 하고, T6~T8은 10-26 오전으로 옮긴다.

## 관련 문서

- [[2026-10-24-freeze-priorities|10-24 freeze 우선순위]] — 결정 §2, 세션 배정
- [[19-DEMO-SCENARIO|19 데모 시나리오]] — §2.1 모드, §3 S0
- [[11-TESTING|11 테스트]] — §5 데모 당일 체크리스트
- [[10-DEPLOYMENT|10 배포]] — 운영 경로·Vercel
- [[16-DECISIONS|16 ADR]] — ADR-042·049·051
- [[18-HACKATHON|18 해커톤]] — §7 정직성 표
- [[PROGRESS]]
