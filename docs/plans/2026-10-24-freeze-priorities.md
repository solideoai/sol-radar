---
title: "10-24 freeze 전 우선순위"
doc: "plan-20261024-freeze-priorities"
status: draft
tags:
  - sol-radar
  - hackathon
  - ops
updated: 2026-10-24
---

# 10-24 freeze 전 우선순위

> [!todo] 한눈에 (기준 2026-10-24 토 10:00 KST)
> 기능 freeze는 오늘 22:00이다([[16-DECISIONS|ADR-042]]). 남은 시간은 약 12시간이다.
> 처리 순서: ① 운영(Vercel)에서 발표 장면이 깨지지 않게 → ② 시연 필수 기능(프로필 사진·N4b) → ③ freeze 체크 → ④ 문서·제출물.
> 회사 GPU 학습(X6)은 사용자 지시로 **10-25(일) 오후**로 미루고 후순위에 둔다.

## 0. 지금 상태 (10:00 확인)

| 항목 | 상태 | 근거 |
|---|---|---|
| 운영 웹 | `https://www.solideos-radar.com` `/health/live` 200, `/health/ready` 200(`db`·`redis`·`storage` ok, `ai: local`). Vercel 운영 전환은 사용자 보고 | 10:00 `curl` |
| 운영 DB migration | **완료(10:00)**. 처음 확인 때 미적용 14개였다(N3·N6·카카오·부처 공고·번역 플래그·역할 감사·회사 메일 등). sol-radar-6c가 사용자 승인으로 적용해(`e7f12f3b` 기록) 이력 50개·미적용 0이다. `db-verify`(연결·이력·RLS·화면 역할 권한·뷰·함수) 통과. TLS 검증은 `NODE_EXTRA_CA_CERTS=~/.supabase/prod-ca-2021.crt` 로 켜 둔다 | `db-push.sh --check`, `db-verify.sh` |
| main | `1fd58ff3`(회사 메일 추가, 다른 세션 커밋) = `origin/main` | `git log` |
| 프로필 사진·명부 연결 | sol-radar-81 담당. 스펙·계획만 있고 코드는 시작 전이다 | `git status`, [스펙](../../polaris/specs/in-progress/2026-10-24-profile-photo-member-link.md) |
| N4b 조직·인력 편집 | 시작 전이다. `web/app/api/v1/team-members` 에 `GET` 만 있다 | 코드 |
| 메일 알림(ADR-041) | 구현 커밋 없음 | `git log` |
| S-LIVE 사전 run | 발표용 Supabase에 없다(10-21 기준). 격리 로컬 1건(`PARTIAL`·`RULES_ONLY`)만 있다 | [[18-HACKATHON]] §7 |
| 회사 GPU 학습 | `sol_decision` 서버·preflight 미완(문서 기준). `bosun-train-feasibility.md` 없음 | [[12-ROADMAP]] X6 |
| **운영 분석 처리(차단)** | 10:05 9b 점검: FX-02 분석 요청은 202를 받았지만 5분 넘게 `QUEUED` 다(`startedAt` null, 오류 없음). 회사 Worker가 job을 가져가지 않는다. 코드 진단: 회사 redis-api는 `SOL_RUN_MODE=live` 이고 웹은 `mock` 이다. 옛 컨테이너가 섞였을 가능성이 가장 크다. 확인 명령과 고치는 순서는 [진단](../evidence/deployment/20261024-company-queue-diagnosis.md)에 있고, 사용자가 회사 터미널에서 실행한다. `GET /api/v1/admin/ai/status` 는 503 `redis-api` 다(Gateway 허용 경로 밖, 알려진 차이) | 9b 중간 보고, run `6a90acc4` |
| 운영 smoke(P0-2·P0-3) | **분석 완료 단계만 실패**(11:00, 9b). 통과: dashboard·bids(1280 넘침 0)·FX-01 94 BID·근거 서랍·FX-03 68 NO-BID·가정 재계산 WATCH·FX-02 요청 202·결정 기록·다른 조직 404·비로그인 401·CSRF 403·멱등(같은 run·409)·429(30건 수락·1건 거절, 새 run 0)·회사 포트 비공개·새 화면 6개·인력 200·적재 19+격리 1. 실패: FX-02 완료 72(정체). 미실행: 다른 역할 403(비ADMIN 계정 비밀번호 없음), 알림 벨(Worker 몫). 데이터: FX-15 저장 점수 58(ADR-043 뒤 68, reset·사전 분석으로 다시 계산), FX-14 마감 지남(`+2d` 상대 날짜라 reset이 다시 잡는다). 관리자 AI 상태 503 `redis-api`(회사 정렬 뒤 재확인). 운영 쓰기: run 1건·결정 1건·멱등 확인 POST 33건(새 run 0), 리허설 전 reset 대상 | [smoke 결과](../evidence/deployment/20261024-prod-smoke/results.json) |
| `docs/PROGRESS.md` | 마지막 기록은 10-22다 | 파일 |

## 1. 우선순위

### P0 — 오전~13:00: 운영에서 데모 경로가 도는지

| # | 작업 | 완료 기준 | 사용자 몫 |
|---|---|---|---|
| P0-1 | 운영 DB migration 상태 확인 → 미적용분 적용 | **완료**. 미적용 0, `db-verify` 통과 | 승인 받음(10-24) |
| P0-2 | 운영 smoke(발표 장면 순서) | 로그인 → `/dashboard` → `/bids` → FX-01 상세 94 → FX-03 68·가정 재계산 → FX-02 분석 요청 202 → polling → 완료 72 → 결정 기록 → 알림 → 다른 조직 404. [[10-DEPLOYMENT]] 조건(HTTPS 401/403/404, 202→polling→Worker 완료, 멱등/429, 비공개 포트). 1440·1280 스크린샷을 `docs/evidence/deployment/20261024-*` 에 저장 | 시험 계정 사용 확인 |
| P0-3 | 운영 DB 데모 데이터 확인 | FX 공고 20건(19 적재 + FX-12 격리), 인력 200명, 골든 94/72/68 표시. `pnpm demo:reset` 은 S-LIVE run을 지우므로 reset이 먼저, S-LIVE가 나중이다 | reset 필요 시 승인 |
| P0-4 | S-LIVE 사전 점검(오늘) → 최종 run(마지막 `demo:reset` 뒤) | 오늘: 운영에 실제 공고가 있는지, Worker가 분석을 처리하는지, 4갈래 중 무엇인지 확인한다. 최종 run은 10-25 리허설의 마지막 reset 뒤에 만든다. reset이 데모 조직 `score_runs` 를 지우기 때문이다. 실공고 상세에 "분석 실행 모드: live" 띠가 나와야 한다. 회사 GPU 실추론이 안 되면 `PARTIAL`·`RULES_ONLY` 갈래로 기록하고 그렇게 말한다. 새 수집은 공공 API 약 260회를 쓴다(서비스당 1,000건/일) | 새 수집 실행 승인 |

### P1 — 13:00~20:00: 시연 필수 기능

| # | 작업 | 완료 기준 | 빼는 순서 |
|---|---|---|---|
| P1-1 | 프로필 사진·명부 연결(81 진행 중) | 스펙 §5.4 순서: 본인 사진 → 조직도 표시 → 관리자 사진 변경 → 신규 입사자 가입 승인 → 기존 직원 연결. 시연은 간편 로그인 경로(U9) | 22:00까지 안 되면 **기존 직원 연결부터** 뺀다(U8). 클라우드 migration `20261024000100` 적용은 사용자 승인 |
| P1-2 | N4b 조직·인력 ADMIN 편집 | `POST /team-members`, `PATCH /team-members/:id`(ADMIN만, 다른 역할 403·RLS 거부). `team_members.employment_status`(`ACTIVE`·`LEFT`) 새 migration `20261024000200_*`. 변경마다 `audit_logs`. `/people` 에서 추가·부서/직급 이동·퇴사. 점수 속성은 받지 않는다. 회귀: 골든 94/72/68, 기존 `score_runs` 불변([사이드바 설계](2026-10-16-sidebar-ia-design.md) §3.2 P1-5) | 22:00까지 안 되면 편집 버튼을 노출하지 않는다. 조회(N4a)는 그대로 |

> [!warning] 파일 겹침
> 사진 스펙 §4는 "N4b와 겹치지 않는다"고 적었다. 하지만 둘 다 `web/server/people/*`, `web/components/people/person-drawer.tsx`, `org-chart.tsx` 를 고친다. 같은 파일은 한 작업자가 맡는다.
> 추천: N4b는 새 파일(migration·Route Handler·편집 service)부터 시작한다. `person-drawer.tsx` 연결은 81의 사진 작업이 브랜치에 커밋된 뒤 그 위에서 한다.

### P2 — 20:00~22:00: freeze 체크

- [ ] 병합을 마친 main에서 전체 `pnpm verify` 1회 green. 무거운 검증은 동시에 2개까지 돌린다.
- [ ] fixture·seed, `services/ai/models/registry.yaml`, 질문 세트, state 템플릿 버전 고정
- [ ] 공공 API 오늘 호출량 확인(서비스당 1,000건/일)
- [ ] green 판정: BOOST-2, 확장 컷, P1 화면, 사진, N4b. green이 아니면 데모에서 빼고 사이드바는 비링크로 둔다
- [ ] `docs/evidence/` 갱신
- [ ] 카카오 실수신 준비(§2-6): Vercel·회사 Worker env 키 이름 확인(값은 사용자가 넣는다), 카카오 앱 설정, 10-25 실행 절차서

### P3 — freeze 뒤: 문서·제출물 (기능 추가 아님)

- [ ] `docs/PROGRESS.md` 에 10-23·24 기록
- [ ] [[18-HACKATHON]] §7 정직성 표를 현재 상태로 고친다. P1 "구현 전", 카카오 "구현 중", Vercel "배포 미확인", S-LIVE 문장이 지난 정보다. AI 심사(Fable 5.1)는 문서와 코드가 맞는지 본다
- [ ] [[23-WEEKEND-FINETUNE]] §1 시간표와 [[12-ROADMAP]] X6 행을 GPU 10-25 오후 기준으로 고친다
- [ ] X4 제출물: 슬라이드(`docs/submission/deck/sol-radar-deck.pptx`), 3분 영상 촬영(10-25), `experiment-tables.md`(빈 템플릿), `limitations.md`

### 후순위·뺄 것

| 항목 | 처리 |
|---|---|
| 회사 GPU 학습 X6 | F1 → F2는 10-25(일) 오후(회사). F3 보정·E4·E1' 채점은 10-26(월) 오전, 제출물 반영은 10-26 오후. 선행 조건(`sol_decision` 서버, preflight)은 10-25 오전에 확인한다. F2를 못 끝내면 "회사 측 미실행"으로 적는다 |
| 메일 알림(ADR-041) | 구현이 없다. 해커톤에서 빼고 문서·ADR만 남긴다(추천) |
| 외부 수집 완성 계획서(`f20cd1e7`) | 해커톤 뒤에 한다 |

## 2. 결정 (2026-10-24 사용자 "추천안대로 진행")

1. **운영 DB migration 적용** — 승인. sol-radar-6c가 적용했고 78이 `db-verify` 로 다시 확인했다.
2. **freeze 22:00** — 유지한다. 사진·N4b가 22:00까지 green이 아니면 빼는 순서대로 뺀다.
3. **시연 환경** — P0-2를 통과하면 운영 Vercel(`www.solideos-radar.com`)을 쓴다. 로컬 Compose는 대체 경로로 둔다.
4. **메일 알림(ADR-041)** — 해커톤에서 뺀다. ADR 상태 갱신은 P3 문서 작업에서 한다.
5. **E4 채점** — 10-26 오전으로 확정한다.
6. **카카오 실수신 녹화** — 한다(2026-10-24 사용자 재결정: "실제 공고를 받아야 해. 시연 영상도 찍어야 하니까"). 실제 나라장터 공고를 분석해 BID·WATCH가 나오면 "나에게 보내기"로 실발송하고 휴대폰 수신을 영상에 담는다. 발표 본편(FX-01·02·03, 94/72/68)은 고정 데이터 그대로다. S0 수신 시험은 10-25 오전이고 오늘은 env·Worker만 준비한다. 앞선 "mock으로 둬" 결정은 이것으로 바뀐다.
   - Vercel에는 키 4개(`KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET`·`KAKAO_TOKEN_ENC_KEY`·`KAKAO_REDIRECT_URI`)를 넣고 재배포한다. 연결·콜백 라우트가 Vercel에서 돈다. Vercel env는 새 배포부터 적용된다.
   - 회사 Worker에는 `NOTIFY_KAKAO_PROVIDER=memo` 와 키 4개(`KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET`·`KAKAO_TOKEN_ENC_KEY`·`SITE_URL=https://www.solideos-radar.com`)를 넣는다. 하나라도 비면 Worker가 기동하지 않는다(`web/worker/notify-outbox.ts` `MEMO_REQUIRED_KEYS`). `KAKAO_TOKEN_ENC_KEY` 는 두 곳이 같은 값이어야 한다. 다르면 `KAKAO_TOKEN_KEY_MISMATCH` 로 발송이 실패한다.
   - `KAKAO_REDIRECT_URI` 는 `https://www.solideos-radar.com/api/v1/me/kakao-notify/callback` 이다. 카카오 개발자 앱에 이 주소, 사이트 도메인, `talk_message` 동의 항목, 클라이언트 시크릿을 등록한다(사용자). [공고 원문] 버튼의 `https://www.g2b.go.kr` 도메인 등록 가능 여부는 미확인이다.
   - **live 전환은 회사 쪽만 한다. Vercel은 `mock` 그대로 둔다.** 분석 run의 `run_mode` 는 회사 redis-api가 정하고, Vercel `SOL_RUN_MODE` 는 머리말 표시와 목록 기본 출처에만 쓰인다. S-LIVE 장면("머리말 mock, 분석 띠 live")과 맞고 Vercel 재배포 2회가 필요 없다.
   - **리허설 동안 개인 설정 "카카오톡 알림"을 끈다.** 리허설의 FX-02·FX-01 재분석이 실제로 발송되기 때문이다. 녹화 직전에 다시 켠다.
   - 녹화가 끝나면 회사 세 서비스를 `mock` 으로 되돌린다(`NOTIFY_KAKAO_PROVIDER=mock` 포함).
   - 실행 절차·후보 공고·호출 수 계산은 [10-25 절차서](../evidence/demo-day/20261024-slive-check/20261025-slive-kakao-runbook.md)를 따른다.
7. **10-27 발표 전 reset** — 10-25 S-LIVE run을 만든 뒤에는 `pnpm demo:reset` 을 돌리지 않는다(추천). reset은 데모 조직 `score_runs`·`outbox_events`·`notifications` 를 지워 S-LIVE run도 사라진다. 발표 전에 reset이 꼭 필요하면 S-LIVE는 녹화 화면으로 보여 준다.

## 3. 시간표

| 시각 | 할 일 |
|---|---|
| 10-24 10:00~11:00 | P0-1 확인. 승인을 기다리는 동안 P0-2 읽기 smoke |
| 11:00~13:00 | P0-2·P0-3 |
| 13:00~18:00 | P1-1·P1-2 병렬, P0-4 S-LIVE |
| 18:00 | 중간 점검: 사진·N4b를 22:00까지 green으로 만들 수 있는지 보고 빼기를 판단한다 |
| 18:00~20:00 | 병합, 운영 migration 적용(승인 뒤), 운영 재확인 |
| 20:00~22:00 | P2 freeze 체크 |
| **22:00** | **기능 freeze** |
| 10-24 저녁 | 회사 `mock` 정렬(정체 해결), Vercel 카카오 키 4개·재배포, 카카오 앱 설정(사용자) |
| 10-25(일) 오전 | 카카오 S0 수신 시험(사용자) → 카카오톡 알림 끄기 → C9 최종 리허설 2회(`mock`, reset 포함, 재부팅 1회 포함) |
| 10-25(일) 리허설 뒤 | 마지막 `demo:reset`·`demo:preanalyze` → 회사만 `live` 전환 → 카카오톡 알림 켜기 → S-LIVE 실공고 분석과 카카오 실수신 녹화 → 회사 `mock` 복귀(약 45~60분) → X4 영상 촬영 |
| 10-25(일) 오후 | 회사 GPU F1 → F2, P3 문서 정합화 |
| 10-26(월) 오전 | F3·E4·E1' 채점, 제출물 숫자 반영, 기동 절차 1~15, **완료 목표** |
| 10-27(화) | 발표자료 마무리·발표 연습·**공식 제출** |

## 4. 세션 배정안

10:00 배정을 보냈다. migration 번호는 81이 `20261024000200`~`000399`, a2가 `20261024000400`부터 쓴다.

| 세션 | 상태(10:05) | 맡을 일 |
|---|---|---|
| sol-radar-78(이 세션) | 조정 | 결과 확인(diff·시험), 병합, 운영 migration·bucket 적용, freeze 체크 총괄 |
| sol-radar-81 | 착수 | P1-1 사진. worktree `sol-radar-worktrees/profile-photo`, 브랜치 `feat/profile-photo`, 기준 `e7f12f3b`. migration `000200`(team_members 제약 완화·`user_id`·`photo_path`·`next_new_hire_person_code()`)을 먼저 커밋한다. 운영 적용 대상은 migration `000200`·`000300`, bucket `profile-photos`(private, 2MB, jpeg·png·webp). 18:00 중간 보고 |
| sol-radar-a2 | 배정 | P1-2 N4b. worktree `sol-radar-worktrees/n4b-team-edit`, 브랜치 `feat/n4b-team-members-edit`. 직원 추가는 81의 `000200` 위에 쌓는다. `people.model.ts`·`people.repo.ts`·`people.service.ts` 는 고치지 않는다. 18:00 중간 보고 |
| sol-radar-9b | 배정 | P0-2·P0-3 운영 smoke, 증거 `docs/evidence/deployment/20261024-prod-smoke/`, 13:00 목표 |
| integration-bosun-english-translations-03 | 배정 | P0-4 S-LIVE 사전 점검, 증거 `docs/evidence/demo-day/20261024-slive-check/`, 15:00 목표 |
| sol-radar-6c | 배정 | 회사 메일(`1fd58ff3`·`e7f12f3b`)과 운영 migration 14개 적용을 마쳤다. 이어서 P3 문서 정합화를 맡는다: 18 §7·§10, ADR-041 빼기 기록, GPU 일정 변경(23·12·ADR-034), PROGRESS 10-23·24 |

작업자 공통 규칙: 가드·훅 우회 금지, `.env*` 를 어떤 도구로도 읽지 않기, `pkill`·`killall` 금지, 무거운 검증 동시 2개, 쓰기 git은 `git -C <절대경로> ... &&` 로만, 클라우드 DB 적용은 사용자 승인 뒤.

## 관련 문서

- [[12-ROADMAP|12 로드맵]] — freeze ~ D-day, Critical Path
- [[18-HACKATHON|18 해커톤]] — 5분 데모, 정직성 표
- [[19-DEMO-SCENARIO|19 데모 시나리오]]
- [[10-DEPLOYMENT|10 배포]] — 운영 경로 조건
- [[16-DECISIONS|16 ADR]] — ADR-042(일정), ADR-041(메일), ADR-034(X6)
- [[23-WEEKEND-FINETUNE|23 주말 파인튜닝]]
- [[PROGRESS]]
