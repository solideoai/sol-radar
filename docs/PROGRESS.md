---
title: "진행 상황"
doc: "progress"
status: draft
tags:
  - sol-radar
  - progress
updated: 2026-11-03
---

# 진행 상황

이 문서는 지금 상태의 정본이다. 형식은 현재 상태 요약, 기능 상태 표, 최근 작업 로그다([[16-DECISIONS|ADR-057]]). 표의 칸에는 현재 값과 증거 링크 하나만 둔다. 일정 날짜는 [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표에만 둔다. 옛 작업 로그와 지난 값은 git 이력에 있다.

## 현재 상태 요약 (2026-11-01)

- 화면 동결은 2026-11-03이다(2026-10-30 사용자 결정으로 11-01에서 연기. 제출 11-03은 그대로, [[16-DECISIONS|ADR-073]]).
- 입찰 일정(`/calendar`)의 `.ics` 내려받기를 빼고 구글 캘린더 연동을 만들었다([[16-DECISIONS|ADR-073]], 스펙 `polaris/specs/planned/2026-10-30-google-calendar-sync.md`). 코드는 main(`652741e2`)과 함께 운영 web(Vercel)에 배포됐다. 그래서 운영 `/calendar`에도 `.ics` 버튼이 없다. 운영에는 구글 연동 env가 없어 구글 캘린더 버튼은 그리지 않는다. 마이그레이션 `20261030002000`은 운영 DB에 넣지 않았다([운영 읽기](evidence/ingestion/20261101-ops-reads.md)). 그래서 설정의 구글 칸도 숨고, 볼 때마다 서버 로그 `google_calendar.load_failed`가 한 줄 남는다(기능 영향 없음). 운영 연결(Vercel 구글 env·재배포·마이그레이션)과 실계정 왕복은 사용자 결정(2026-11-02 "일단 구글 캘린더는 미룰게. 문서로 정리해놔")으로 발표 뒤로 미뤘다([[2026-11-02-google-calendar-prod-rollout|운영 반영 계획]]). 모바일 웹([[16-DECISIONS|ADR-072]])은 main `07a307f8`로 운영에 배포됐다(증거 [기록](evidence/mobile-web/20261030/README.md)).
- 공식 제출은 2026-11-03, 발표는 2026-11-05다([[16-DECISIONS|ADR-054]]. 발표일은 2026-11-02 사용자 결정으로 11-04에서 연기, [[16-DECISIONS|ADR-076]]). 발표는 덱 20분 + 녹화 클립이다. D1 운영 사이트(`https://www.solideos-radar.com` + `?origin=demo`)는 녹화 촬영 경로이자 질의응답 라이브다. 발표 전 `pnpm demo:reset`은 하지 않는다.
- 핵심 컷 C0~C9에서 남은 것은 C8 S-LIVE 녹화(동국대 공고 최신 run `ed2e57d4` 49 보류, [[16-DECISIONS|ADR-068]] 5번), C9 D1 리허설·촬영이다. C1 ④ 파서 "지원" 판정은 해커톤 뒤 벤치마크 뒤로 미뤘다(ADR-068 1번). 제출물(X4)은 초안이다.
- 운영에서 실공고를 수집·첨부 파싱·분석한다. 수집 출처는 나라장터·LH·KEPCO·K-water 입찰공고와 기업마당·과기정통부 부처 공고다. 실공고 분석과 추천 분석(ADR-066)이 운영에서 돈다(아래 운영 상태).
- SOL Score `sol-v0.2.1`(자격 판정만 바꾼 개정: 사전 별칭·면허제한 여러 행, [[16-DECISIONS|ADR-071]])로 2026-11-01 16:04~16:06 운영 재채점을 썼다(사용자 승인, 회사 일회용 컨테이너, AI 재호출 없음). 새 run 225건·실패 0·권고 변화 12(보류 → 추천 5, 보류 → 비추천 7)·알림 0. 화면에 보이는 run 384건은 실공고 366건(추천 7·보류 349·비추천 10)과 DEMO 18건(추천 10·보류 8, 그대로)이다. 운영 회사 프로필은 revision 6(공개 자료 + 회사 확인 자격 3건: 소프트웨어사업자·직접생산·중소기업)이다. 발표 대본은 ADR-059 2026-10-30 2차 개정을 따른다. S3는 FX-01 저장 추천 92, 가정 재계산은 FX-16(방산업체 지정 가정 → 70 보류), S4는 FX-02 재분석(예상 59 보류) → 사람 비추천이다([기록](evidence/sol-score-v02/20261030/v021-rollout.md)).
- 카카오 "나에게 보내기"([[16-DECISIONS|ADR-038]])는 2026-10-30 운영 연결·실발송(시험 2통·추천 23통)에 이어 2026-11-01 17:16~18:15 실수신 녹화를 마쳤다(사용자 승인, 실공고 `90c955ea` 재분석 → 추천 카톡 1통 SENT). 녹화 뒤 회사 알림 Worker의 카카오 발송은 다시 꺼졌고(18:15:48) 연결 행은 17:44:44부터 `enabled=false`다. 카톡 [분석 보기]가 회사 홈페이지로 열리던 결함은 Worker `SITE_URL`을 `https://www.solideos-radar.com`으로 고치고(사용자) 로그인 뒤 보던 화면으로 돌아오게 해서(`92ca1882`, 운영 배포) 고쳤다. 고친 링크로 실제 카톡을 받아 누르는 확인은 아직 안 했다([기록](evidence/kakao-notify/20261101-recording.md)).
- 나라장터 정기 수집이 10-30 21:00~11-01 12:00 회차에서 7번 실패했다(원인 미확인). 11-01 15:00부터 정기 회차가 다시 성공했고, 16:17 수동 수집이 빈 구간(10-30 18:00~10-31 15:00)을 받았다. 실패 사유를 남기는 수정은 main에만 있고 회사 ingest Worker에는 반영하지 않았다([기록](evidence/ingestion/20261101-ops-reads.md)).
- X6 파인튜닝과 실험 E0~E3·X1·X2는 발표 뒤 진행 예정([[16-DECISIONS|ADR-067]])이다.

### 운영 상태

값은 증거에 적힌 것이고, 시각은 그 기록의 시각이다.

| 항목 | 현재 값 | 마지막 확인 |
|---|---|---|
| web(Vercel) | main `f9dd9e4d` Vercel production READY(11-01 20:47 생성). 구글 캘린더 연동 코드(env 없어 버튼 숨김, `.ics` 없음)·팀별 인력 배치 추천 팀 구성과 프로필 사진·로그인 뒤 보던 화면 복귀(`92ca1882`)를 포함한다. 함수 지역 `syd1`([지역 기록](evidence/deployment/20261028-region-latency.md)). [기록](evidence/ingestion/20261101-ops-reads.md) | 2026-11-01 20:1x KST |
| `/health/ready` | ok(운영 웹 `6604d975` 배포 직후). `ai`는 회사 AI gateway가 보고한 provider 값이고 마지막 기록은 `ai: local`(10-31 16:54)이다. [기록](evidence/kakao-notify/20261101-recording.md) | 2026-11-01 17:36 KST |
| 운영 DB | migration 73개, 마지막 `20261030001100`(가상 직원 등급·수행 이력 직급 정합). 저장소에는 구글 캘린더 `20261030002000`(운영 미적용)과 과기정통부 `20261101000050`이 더 있다. `20261101000050`은 같은 SQL을 2026-11-02 운영에 직접 실행했고 기록은 하지 않았다([기록](evidence/program-notices/20261102-msit-rollout.md)). [기록](evidence/ingestion/20261101-ops-reads.md) | 2026-11-01 20:1x KST |
| 회사 반영 | Analysis Worker·redis-api는 `efab8acc144b`(`deploy/sv021-20261030` = `3aeaff92` + 회사 carry, 10-30 16:15). AI gateway는 `384e469857f0` 그대로이고 같은 호스트 Bosun `127.0.0.1:8009`를 부른다. 알림 Worker는 `7b5a79dc9054`(11-01 17:16 `memo` → 18:15:48 카카오 꺼짐으로 재생성, `SITE_URL` `https://www.solideos-radar.com`). `sol-radar-app` checkout은 2026-11-02 `478531c7`로 옮겼다(부처 공고 Worker 재생성, 되돌리기 태그 `rollback-program-notices-20261102` = `cbb3831e`). ingest·documents 이미지는 `cbb3831e86da` 그대로이고 redis-api 빌드 context만 배포 checkout이다. 나라장터 실패 사유 기록 수정(main `e2223bdc`)은 회사에 반영하지 않았다. 되돌리기 태그 `sol-radar-gateway-redis-api:rollback-20261030b`. [기록](evidence/kakao-notify/20261101-recording.md) | 2026-11-01 18:15 KST |
| 나라장터 정기 수집 | KST 3시간 정각. ingest Worker `cbb3831e86da`. 10-30 21:00 회차가 10-31 18:00까지 21시간 열린 채 `FAILED`로 닫혔고 그동안 나라장터 회차가 생기지 않았다. 이어 10-31 21:00~11-01 12:00 6회가 0초 만에 `FAILED`(원인 미확인, 사유 기록 없음). 11-01 15·18·21시는 `SUCCEEDED` 0건(일요일). 빈 구간 10-30 18:00~10-31 15:00은 11-01 16:17 수동 수집이 받았다(52건). 보조 조회(면허·지역·첨부)는 기능별 한도 각 1,000회다. [기록](evidence/demo-day/20261102-preflight.md) | 2026-11-01 22:4x KST |
| 외부 입찰공고(LH·KEPCO·K-water) | 같은 ingest Worker가 3시간 정각에 받는다. 10-30 18:00 이후 LH `SUCCEEDED`, K-water는 11-01 00:00까지 `PARTIAL`이고 03:00부터 `SUCCEEDED`, KEPCO는 `PARTIAL`(첨부 주소는 해커톤 동안 막아 둔다, [[16-DECISIONS\|ADR-068]] 3번). 남은 외부 3종(K-water 발주계획·LH 사전규격·조달요청)은 꺼짐. [기록](evidence/ingestion/20261101-ops-reads.md) | 2026-11-01 20:1x KST |
| 부처 공고(기업마당·과기정통부) | 전용 Worker(`sol-radar-program-notices-worker:478531c783eb`, 2026-11-02 15:16 재생성)가 3시간 정각에 기업마당 다음 과기정통부를 받는다. 15:16 `--once`: 기업마당 100/100, 과기정통부 받음 10·저장 4(결과 발표 6 제외). `program_notices` 기업마당 125·과기정통부 4행. [기록](evidence/program-notices/20261102-msit-rollout.md) | 2026-11-02 15:16 KST |
| 첨부 처리(Documents Worker) | 운영 중. 처리 상태 `PARSED` 7,708·`PARTIAL` 122·`UNSUPPORTED` 56·`FAILED` 4·`PENDING` 30, 다운로드 `PENDING` 3,462. [기록](evidence/ingestion/20261101-ops-reads.md) | 2026-11-01 20:2x KST |
| 분석 | `sol-v0.2.1` 재채점 쓰기 2026-11-01 16:04~16:06(사용자 승인, 회사 일회용 컨테이너 `efab8acc144b`, AI 재호출 없음). 새 run 225건·그대로 159·실패 0·권고 변화 12·알림 0. 화면 run 384건: 실공고 366(추천 7 = 85점·보류 349 = 43~88·비추천 10 = 49점), DEMO 18(추천 10·보류 8). 17:43 카카오 녹화 때 실공고 `90c955ea`를 다시 분석했다(85 추천, 점수·권고 같음). 새 공고는 자동 분석하지 않는다. DEMO는 FX-02만 옛 분석(66 보류, `sol-v0.1.0`, 프로필 revision 2, 재채점 대상 아님). [기록](evidence/sol-score-v02/20261030/v021-rollout.md) | 2026-11-01 16:1x KST |
| 추천 분석 | 운영 반영. DEMO FX-01 추천 분석 `91b8a6e5`(`DONE`·`MODEL`, run `dfac87db` 92 추천)는 `sol-v0.2.1` 재채점 뒤에도 그대로다. 재채점으로 run이 바뀐 공고에 붙어 있던 결과는 보이지 않는다. [기록](evidence/sol-score-v02/20261030/v021-rollout.md) | 2026-11-01 16:1x KST |
| DEMO 공고 | 19건 그대로, 16건 마감 +15일. 운영 DEMO 삭제는 발표 뒤다. FX-02는 촬영 때만 재분석한다([[16-DECISIONS\|ADR-059]], 예상 11-02까지 59 보류·11-03부터 53). DEMO 추천 10(FX-01 92·FX-03 90 등)·보류 8(FX-16 70 포함)은 `sol-v0.2.1` 재채점에서 바뀌지 않았다. [기록](evidence/sol-score-v02/20261030/v021-rollout.md) | 2026-11-01 16:1x KST |
| 알림 처리 | 회사 알림 전용 Worker(`sol-radar-notify-worker:7b5a79dc9054`, 10-30 12:45 첫 기동)가 인앱 알림 2종(`ANALYSIS_COMPLETE`·`REVIEW_ASSIGNED`)과 마감 D-3·D-1 알림(5분마다)을 처리한다. 카카오 발송은 10-30 14:05~15:47과 11-01 17:16~18:15만 `memo`(실발송)였고 지금은 꺼짐(`notify.kakao.disabled`, 아래 카카오 행). 첫 기동 때 쌓인 인앱 28건은 admin 계정 1명에게 갔다("모두 읽음" 기능 없음). 마감 알림을 실제로 넣은 회차는 아직 못 봤다. 전체 Worker(`worker/main.ts`)는 띄우지 않는다. [기록](evidence/kakao-notify/20261101-recording.md) | 2026-11-01 18:15 KST |
| 카카오 | 운영 연결 1건 CONNECTED(admin@solideos.com, 10-30 14:13), 연결 행 `enabled=false`(11-01 17:44:44부터). 실발송: 시험 2통(10-30 SENT)·1회(11-01, 이벤트 PROCESSED), 추천 카톡 24통 SENT(10-30 23통, 11-01 녹화 1통). 같은 공고·같은 사람에게는 다시 보내지 않는다(claim). 실수신 녹화 끝. [분석 보기] 링크 결함은 고쳤고 실수신 확인은 남았다. 카카오 개발자 콘솔 Web 도메인 등록은 사용자 확인 남음. [기록](evidence/kakao-notify/20261101-recording.md) | 2026-11-01 18:15 KST |
| CI | GitHub Actions job이 2026-10-24부터 계정 결제 문제로 시작되지 않는다. 검사는 로컬 pre-push 게이트와 직접 돌린 `pnpm verify`다 | 2026-10-27 |
| hosted 모델 API | 승인 0건, 쓰지 않는다([[16-DECISIONS\|ADR-010]]) | — |

### 사용자 결정 대기

1. [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표 확인.
2. 구글 캘린더 운영 연결은 사용자 결정(2026-11-02)으로 발표 뒤로 미뤘다. 다시 시작할 때의 순서(Vercel env·재배포 → `pnpm db:push` `20261030002000`, 각각 승인)와 사용자 준비물(기존 구글 로그인 클라이언트에 Calendar API·`calendar.events` 범위·로컬 redirect URI, 게시 상태 확인)은 [[2026-11-02-google-calendar-prod-rollout|운영 반영 계획]]에 있다. 운영 Production에는 `NEXT_PUBLIC_AUTH_GOOGLE`이 이미 있고 로그인 화면에 구글 버튼이 보인다(2026-11-01 마스터 세션 확인, 값은 미확인). 2026-10-31 기록의 "끈 채 둔다"와 다르므로 그대로 둘지 사용자 확인이 필요하다. 구글 캘린더 코드는 이 값을 읽지 않는다. 같은 날 뒤의 결정으로 덱에 구글 캘린더 장·클립 9가 들어갔다([[16-DECISIONS|ADR-060]] 발표 개정). 버튼 장면은 실계정 왕복이 필요해, 찍으려면 이 연기를 풀지(로컬 왕복 또는 운영 반영) 사용자가 정해야 한다. 풀지 않으면 덱은 자동 시험 캡처로 둔다([[19-DEMO-SCENARIO|19]] S-GCAL).
3. 운영 반영 승인(각각 따로): 카카오 고친 [분석 보기] 링크 실수신 확인(다른 추천 공고, 알림 Worker `memo`·연결 다시 켜기). 회사 ingest Worker에 나라장터 실패 사유 기록 수정 반영 여부.
4. 카카오 아침 묶음(평일 09:00 추천 공고 카톡, [설계](plans/2026-10-30-kakao-morning-digest-design.md))은 사용자 결정(2026-11-01)으로 main 병합·운영 반영을 발표 뒤로 미뤘다. 반영 때 최신 main을 다시 합치고 전체 검증을 다시 돌린다.

### 남은 일

- [[16-DECISIONS|ADR-056]] 대안 A(분석이 그 revision 문서 처리를 최대 300초 기다린다)는 2026-10-30 회사 Analysis Worker에 들어갔다(지금 `efab8acc144b`). 대기 동작을 운영 로그로 아직 보지 않았다.
- 날짜는 [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표(사용자 확인 전)에 있다. `sol-v0.2.1` 재채점과 카카오 실수신 녹화는 2026-11-01에 끝났다. 남은 순서는 D1 리허설·촬영(S-LIVE·S-GAPS, 로컬 Compose의 S5·S6) → 덱·녹화 클립 완성 → 제출(11-03) → 발표(11-05)다. 구글 캘린더 실계정 왕복·운영 연결은 발표 뒤다(사용자 결정 2026-11-02). 덱 구글 캘린더 클립 9는 촬영 환경이 정해지지 않았다(위 결정 대기 2).
- 리허설 중 FX-02를 재분석하지 않는다. 촬영 때 "이전 분석 66(가상 프로필) → 새 분석 59(공개 자료 프로필, 예상)"이 보여야 한다([[16-DECISIONS|ADR-059]]).
- 덱 pptx(`docs/submission/deck/`, git 밖. `sol-radar-deck.pptx`·`sol-radar-deck-mac.pptx`·`sol-radar-deck-win.pptx` 3개, 파일 수정 11-01 17:50)는 [[slides-spec|덱 제작 명세]]의 11-01 19:46 개정(`sol-v0.2.1` 권고 수·카카오 녹화)보다 앞선다. 루트 `sol-radar-deck.pptx`는 10-21 옛 초안이다. 그림·포스터는 촬영 뒤 바꾼다. 10-30에는 덱 글꼴(Apple SD Gothic Neo)과 캡션 크기(11~13pt)가 명세와 달랐다. 명세가 정본이다([[submission/README|제출물 색인]]).
- 화면 동결 뒤 덱 클립을 찍는다([[16-DECISIONS|ADR-061]]). 사용자 승인 뒤 운영 읽기로 랜딩 출처 9곳 수집을 확인하고, 연결 안 된 곳의 로고를 뺄지 사용자가 정한다([출처 연결 목록](plans/2026-10-28-landing-sources-to-connect.md)).
- 나라장터 정기 수집 실패(10-30 21:00~11-01 12:00)의 원인을 아직 모른다. 10-30 21:00 회차가 21시간 열려 있는 동안 다음 회차가 생기지 않았고, 닫힌 뒤 6회는 0초 만에 실패했다. 평일 첫 확인은 11-02 09:00·12:00 회차의 받은 건수다. 실패 사유 기록 수정이 회사에 들어가면 다음 실패 때 `summary.failure`에 남는다([기록](evidence/demo-day/20261102-preflight.md)).
- 열린 확인: 운영 로그인 화면(`/gaps`·`/market`·`/calendar` 실숫자, 부처 지원사업 탭, `/workforce` 사진), 로그인 뒤 E2E(`test:e2e:work`·`test:e2e:auth`, Compose 필요), 배포 뒤 사진 1장 올리기·지우기([릴리스 실행서](evidence/integration/20261025-release-runbook.md) §4), 나라장터 보조 정보 다시 채우기(10-30 22:15 회차는 보조 조회 `API_HTTP_ERROR`로 채운 공고 0건이었다고 11-01 회사 실행 로그에서 확인했다. 증거 파일 없음. 다음 회차는 사용자 확인 뒤).

**16에서 넘어온 할 일**(번호는 [[16-DECISIONS|16]]의 미결정·닫힌 미결정 번호):

- 해커톤 전
  - 회사 vLLM 장문 guided JSON·지연 실측(미결정 17), Bosun 질문당 지연 p95(미결정 24). `prompt_logprobs` 확인은 E3(X1)용이고 E3는 발표 뒤 진행 예정([[16-DECISIONS|ADR-067]])이다.
  - P1 화면을 어느 데모 장면에서 보일지 정한다([[18-HACKATHON|18]]·[[19-DEMO-SCENARIO|19]], [[16-DECISIONS|ADR-042]]).
- 발표 뒤 X6 실행 때([[16-DECISIONS|ADR-067]])
  - F1 전 필수: 후보 목록 교차 시험. `services/ai/eval/sol_eval/bosun_records.py:70`과 `services/decision/src/sol_decision/contract.py:45`의 `candidates_for`가 따로 구현돼 있다(닫힌 미결정 26-12).
  - F1 전 필수: `infra/gpu/bosun-f1.sh` 결과 파서 키. 로그 `s/step`(214행)과 `training_metrics.json` snake_case 키(236행 등)가 학습기 출력(`metrics` 아래 camelCase)과 다르다(닫힌 미결정 26-15).
  - 채점 `--data` 파일 sha256을 번들 manifest와 대조한다(닫힌 미결정 26-17).
  - 회사 GPU 서버에 `sol_eval`을 설치한다. 절차 초안은 [[22-FINETUNE-RUNBOOK|22]] §3.2다(닫힌 미결정 29-2).
  - E2 한국어 내보내기(`--language ko`)와 언어 짝 비교를 만든다(닫힌 미결정 29-6).
- 해커톤 뒤·NestJS 전환 때
  - `X-Request-Id`를 이어 받는다. `web/app/api/v1/_lib/http.ts:45·47·55`가 응답마다 새 UUID를 만든다(닫힌 미결정 26-4, [[16-DECISIONS|ADR-028]]).
  - 오래 남은 g2b `RUNNING` 행의 시간 기준 자동 `FAILED` 전환(닫힌 미결정 25). 지금은 `pnpm ops:close-stale-runs`로 푼다.
  - `stateTemplate` 대조(닫힌 미결정 26-13 (b))와 결정 모델 `manifest.json` sha256 identity 대조(닫힌 미결정 28 ②).
  - 나라장터 목록과 부처 공고 섞기. 사용자가 원하면 다시 정한다([[16-DECISIONS|ADR-040]]).
  - 간편 로그인 제공자(구글·카카오·네이버) 설정. 상태는 미확인이다([[16-DECISIONS|ADR-018]] 후순위).
  - Supabase 서울(`ap-northeast-2`) 이전과 함수 지역 `icn1` 전환(사용자 결정으로 발표 뒤, [기록](evidence/deployment/20261028-region-latency.md)).
  - 추천 분석 연 1회 재학습 구현([[16-DECISIONS|ADR-066]]).

**문서 밖 발견**(따로 정할 것):

1. ADR-044 때 코드가 남아 있다: `services/ai/app.py`·`services/ai/vercel_build.py`·`services/ai/tests/test_vercel.py`.
2. 회사 실행서(`infra/company/README.md`) 머리말(3행)은 "모델 학습/반입 전 현재 실행 모드는 `mock`이다"라고 쓴다. 운영 readiness는 `ai: local`을 보고하고, 운영 AI gateway는 회사 전용 `sol-radar-ai-worker` 프로젝트의 `infra/.env.ai-local`을 쓴다([[10-DEPLOYMENT|10 배포]] "회사 Compose 프로젝트"). §2 표(33행)는 이미 이 내용으로 고쳐져 있다.

## 기능 상태 표

해커톤 컷의 정의는 [[12-ROADMAP|12 로드맵]]이다. 이 표가 각 항목의 현재 상태다. "main"은 main에 병합됐다는 뜻이다.

| ID | 기능 | 상태 | 근거 |
|---|---|---|---|
| C0 | Phase 0 마감: Compose·gateway 골격·health | 완료 | [통합 기동](evidence/phase-0/c0-integration-20261019.md) |
| C1 | P0-0 외부 의존성 ①~④ | ①②③ 완료(운영 실모델 분석). ④ 파서 구현·운영 반영. "지원" 판정은 해커톤 뒤 벤치마크 뒤 적용([[16-DECISIONS\|ADR-068]] 1번) | [점검표](evidence/phase-0/external-deps.md) |
| C2 | DB·RLS·`sol_role`·`pnpm demo:reset` | 완료. 운영 DB migration 73개(2026-10-30, 위 운영 상태 표) | [[04-DATABASE\|04]] |
| C3 | 수집·정규화·revision·documents job·첨부 다운로드 | 완료. 운영 3시간 정기 수집, Documents Worker 운영 중 | [회사 반영](evidence/company-rollout/20261028/sources-rollout.md) |
| C4 | 규칙 엔진·골든 94/72/68·인력 200명 입력 | 완료. FX-15 68, 가용 95.5 FTE([[16-DECISIONS\|ADR-043]]) | [골든](evidence/phase-4/goldens-report.txt) |
| C5 | gateway `/extract`·`/kev`·`/explain`·`/parse`·`/insight`, worker 분석·`PARTIAL`, `local` 어댑터 | 완료. 운영 gateway에 파서 3종 | [회사 반영](evidence/company-rollout/20261029/ai-gateway-rollout.md) |
| C6 | `/dashboard`·`/bids`·`/bids/[id]`·`/notifications`, Route Handler | 완료 | [[06-UI-UX\|06]] |
| C7 | 결정 기록·audit·outbox·인앱 알림 2종 | 완료. 운영 인앱 알림 2종은 2026-10-30부터 회사 알림 Worker가 처리한다 | [[13-NOTIFICATIONS\|13]] |
| C8 | S-LIVE 실공고 `live` 분석·녹화 | 운영 실공고 분석 run 있음. 촬영 공고는 동국대 최신 run `ed2e57d4` 49 보류(11-01 `sol-v0.2.1` 재채점, [[16-DECISIONS\|ADR-068]]). 녹화 남음 | [기록](evidence/sol-score-v02/20261030/v021-rollout.md) |
| C9 | 리허설·대체 경로·세 모드 | 로컬 `mock` 리허설 기록 있음. D1 리허설·촬영 남음 | [리허설 로그](evidence/demo-day/rehearsal-log.md) |
| X1 | E3 대조 실험(축소 규모) | 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]) | [[21-MODEL-TRAINING\|21]] |
| X2 | 임팩트 예비 실험 n=3 | 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]) | [[01-PRD\|01]] |
| X3 | 경쟁 서비스 비교 | 완료 | [비교](evidence/competitors/2026-10-19-competitors.md) |
| X4 | 제출물: 덱 20분·녹화 클립·기술 자료 | 초안. 완성 남음 | `docs/submission/` |
| X6 | Bosun LoRA 파인튜닝 트랙 | 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]). 도구는 main에 있고 회사 서버 실행 기록은 없다 | [[22-FINETUNE-RUNBOOK\|22]] |
| 평가 리포트 | E0·E2·E3 전체 평가셋 리포트, `/admin/ai/eval-runs` | 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]). `/admin/ai/eval-runs`는 코드 없음 | [[12-ROADMAP\|12]] |
| BOOST-2 | 가정 재계산 | 완료(main, E2E 통과) | [E2E](evidence/boost2/20261020-boost2-what-if-e2e.md) |
| KAKAO | 카카오 "나에게 보내기" | main·운영 migration·운영 실발송(2026-10-30 시험 2통·추천 23통)·실수신 녹화(2026-11-01 추천 1통). 알림 Worker 카카오는 11-01 18:15:48부터 꺼짐, 연결 행 `enabled=false`. 고친 [분석 보기] 링크 실수신 확인 남음 | [기록](evidence/kakao-notify/20261101-recording.md) |
| S5 | 변경 감지(revision diff·`BID_CHANGED`) | 완료(main). `BID_CHANGED`는 outbox에만 남고 조직 팬아웃은 남은 일이다(닫힌 미결정 30-4) | [기록](evidence/s5/summary.md) |
| N1 | 앱 셸·사이드바(ADR-021) | 완료(main). `/ops` 분리는 해커톤 뒤 | [[06-UI-UX\|06]] §4 |
| N2 | 설정 개인·조직 탭 | 완료(main) | [통합 기록](evidence/committed-integrations/integration.md) |
| N4a | `/people`·`/org-chart`, 본부·그룹 직속([[16-DECISIONS\|ADR-063]]) | 완료(main·운영) | [기록](evidence/people/20261019-people-read.md) |
| N8 | `/admin/ingestion` 데이터 수집 관리 | 완료(main·운영) | [보고](evidence/phase-3/admin-ingestion/20261020-n8-admin-ingestion-report.md) |
| N9 | 대시보드 카드 5개 | 완료(main) | [통합 기록](evidence/committed-integrations/integration.md) |
| P0-8 | 사전규격·발주계획 단계 연결 | 완료(main) | [기록](evidence/p08/README.md) |
| P1 | N3 관심 공고·N5 분석 결과 비교·N6 입찰 프로젝트·N7 인력 배치 시뮬레이션·N4b 조직·인력 ADMIN 편집([[16-DECISIONS\|ADR-042]]) | 완료(main·운영 배포) | [N3~N7](evidence/navigation/20261022-implementation.md) |
| 부처 공고 | 부처 지원사업 공고 수집·목록([[16-DECISIONS\|ADR-040]]) | 완료. 운영은 부처 공고 전용 Worker(기업마당·과기정통부). 과기정통부 출처(ADR-075)는 2026-11-02 운영 반영. 운영 화면 확인 남음 | [기업마당 정기 수집](evidence/program-notices/20261028-bizinfo-schedule.md) |
| 메일 알림 | [[16-DECISIONS\|ADR-041]] | 해커톤에서 뺐다(코드 없음) | [[13-NOTIFICATIONS\|13]] |
| 운영 구성 | Vercel web + 회사 redis-api·AI gateway·전용 Worker 5종(ingest·analysis·documents·부처 공고·알림), Storage `bid-documents`·`bid-parsed`([[16-DECISIONS\|ADR-045·048·049]]) | 운영 중. 알림 Worker는 2026-10-30부터(카카오 발송 꺼짐). 전체 Worker는 띄우지 않는다 | [[10-DEPLOYMENT\|10]] |
| 실운영 전환 | 3시간 정기 수집·수동 수집 gate·본문 없는 공고 분석 차단·상단바 실행 모드 표시 제거 | 운영 중. 운영 DEMO 삭제는 발표 뒤 | [기록](evidence/live-ops/20261026/summary.md) |
| 첨부 처리 | 다운로더·Documents Worker·`/parse`·분석의 첨부 텍스트 읽기([[16-DECISIONS\|ADR-054]] 3번)·첨부 조립 v0.2([[16-DECISIONS\|ADR-064]]) | 운영 중. ADR-055·056 제안 | [회사 기동](evidence/attachment-pipeline/20261028-documents-worker.md) |
| live 가드 | live에서 카카오 발송 수단이 비면 발송 끔. 이메일 가입 약관 동의 저장(`user_consents`) | main·운영 DB·Vercel. 간편 가입(OAuth) 동의는 후속 | [검증](evidence/live-guards/20261027.md) |
| 수집 장애 격리 | 외부 서비스별 키·한도 상태, 준비된 서비스만 정기 수집 | 운영 중. 켠 외부 서비스는 LH·KEPCO·K-water 입찰공고 | [기록](evidence/ingestion/20261027-source-isolation/summary.md) |
| 공공 입찰 확장 | 사업기회 연결·11열 목록·수집 운영([[16-DECISIONS\|ADR-047]]) | main·운영. 남은 외부 3종은 서비스별 검증 뒤 켠다 | [[2026-10-28-all-sources-activation\|계획]] |
| LH 입찰공고 | 정규화, LH 한정 인증·데이터 없음 판정, EUC-KR 응답 읽기 | 운영 수집 중 | [정규화 검증](evidence/ingestion/20261027-lh-bid-notice/normalization-check.md) |
| KEPCO·K-water 입찰공고 | KEPCO 전자입찰 계약·K-water 입찰공고 정규화와 정기 수집 | 운영 수집 중. KEPCO 첨부 주소는 해커톤 동안 막아 둔다([[16-DECISIONS\|ADR-068]] 3번) | [회사 반영](evidence/company-rollout/20261028/sources-rollout.md) |
| 회사 공개 프로필 | 운영 DB 회사 프로필 revision 6(공개 자료 revision 5 + 회사 확인 자격 3건, 2026-10-30), `EXECUTIVE` 역할([[16-DECISIONS\|ADR-052]]) | 운영 반영. 화면에 보이던 분석 389건을 revision 6으로 다시 계산했다 | [revision 6 반영](evidence/company-public-profile/20261030/prod-rollout.md) · [revision 3~5 반영](evidence/company-public-profile/20261027/prod-rollout.md) |
| 프로필 사진 | 비공개 버킷 `profile-photos`, 가입 신청 승인([[16-DECISIONS\|ADR-051]]) | 운영 적용. 기존 직원 찾기(U8)·재신청 진입점(U10) 화면은 없다 | [기록](evidence/integration/20261025-prod-apply-db-storage.md) |
| 인력 200명 | 가상 명부·사진 200장·전원 계산 대상([[16-DECISIONS\|ADR-019·043]]). 인물 서랍 수행 이력·자격증, 이력 v2(1인당 3~5건·가상 발주기관) | 명부 완료·운영 DB 적용. 이력 v2 운영 DB `20261029001000` 적용(2026-10-29) | [[07-DATA-PIPELINE\|07]] · [수행 이력](evidence/people/20261029-project-history/README.md) |
| 화면 개편 | 파스텔 선택색·묶음 머리 아이콘 사이드바·업무 화면 공통 틀·랜딩 업무 데모([[16-DECISIONS\|ADR-061]]), 권고 표기 추천·보류·비추천([[16-DECISIONS\|ADR-062]]) | 운영 배포. 화면 동결 일정은 12 | [증거](evidence/ui-refresh/README.md) |
| 자격 갭 | `/gaps`: 실공고 구조화 필드 1차 선별·막는 자격 순위·보유 가정([[16-DECISIONS\|ADR-060]]) | 운영 배포. 회사 프로필 배지 툴팁을 revision 6(회사 확인 자격 3건) 문구로 고쳐 배포(11-01). 운영 화면 실숫자 미확인(로그인 필요). 11-01 운영 DB 계산값(대상 539건)은 촬영 참고용 | [증거](evidence/gaps/20261028/README.md) · [클립 7 계산](evidence/gaps-clip7/20261101/README.md) |
| 발주 현황 | `/market`: 기간·기관·분야·예산 구간·주별 집계, 자격 갭 묶음 겹쳐 보기([[16-DECISIONS\|ADR-060]]) | 운영 배포. 운영 실숫자 미확인 | [1440 스크린샷](evidence/market/20261028/market-overview-1440.png) |
| 입찰 일정 | `/calendar`: 관심·프로젝트·관련 실공고 마감과 나라장터 원본 일정 5종, 일정 종류 거르기([[16-DECISIONS\|ADR-060]]). 구글 캘린더 일정 링크(유지). 이 달 `.ics` 내려받기를 구글 캘린더 연동으로 교체(ADR-073, 스펙 `polaris/specs/planned/2026-10-30-google-calendar-sync.md`. [[2026-10-30-calendar-export\|옛 계획]]) | 운영 배포(main `2cdfd603`). `.ics`는 지웠다. 구글 연동 코드는 운영에 있지만 운영 env가 없어 버튼을 그리지 않는다. 운영 DB 마이그레이션(`20261030002000`)·Vercel env·실계정 왕복은 발표 뒤(사용자 결정 2026-11-02, [[2026-11-02-google-calendar-prod-rollout\|운영 반영 계획]]). 마감 D-3·D-1 알림은 2026-10-30부터 알림 Worker가 5분마다 돌린다(실제로 넣은 회차는 아직 못 봤다) | [증거](evidence/calendar/20261028/README.md) · [내보내기](evidence/calendar/20261030-export/README.md) |
| 팀별 인력 배치 | `/workforce`: [추천 공고 불러오기](추천순 3건), 공고마다 여러 팀에서 고른 추천 팀 구성(PM·개발자·디자이너 등 자리별 1명, 맞는 후보가 0명이어도 분석 스냅샷 인력으로 짠다)·역할별 필요 인력, 팀×공고 "팀별 지원 요청" 표. 인력 단위는 FTE 대신 "N명분"·"투입 가능 N%". 후보 이름 왼쪽 프로필 사진. 저장 없음([[2026-10-30-team-staffing\|계획]]) | 운영 배포(`f9dd9e4d`). 운영 로그인 화면 확인 미실행 | [증거](evidence/workforce/20261030-team-staffing/README.md), [추천 팀](evidence/workforce/20261101-team-proposal/README.md) |
| 추천 분석 | 공고 상세 [추천 분석]: 버튼을 누를 때만 Qwen이 판단 이유·강점·보완할 점을 근거 번호와 함께 쓴다. 판정은 규칙 엔진 그대로([[16-DECISIONS\|ADR-066]]) | 운영 반영. 연 1회 재학습 구현은 발표 뒤 | [운영 반영](evidence/company-rollout/20261029/rec-insight-rollout.md) |

## 최근 작업 로그

형식: `날짜 · 변경 · 검증`. 검증에는 실제로 돌린 명령과 결과만 적는다. 이 절은 최근 10줄만 둔다.

- 2026-11-03 · 공고 상세 '참고 낙찰가 범위'([[16-DECISIONS|ADR-077]]) 운영 반영 마무리: 운영 표(MCP 직접 SQL, `schema_migrations` 미기록)·낙찰 이력 48,269행(11-02 사용자가 `award:backfill --apply --months 8` 실행, 호출 상한 400에 닿아 가장 최근 며칠 공고는 못 이음)·카드(main `01392da4`)·랜딩 가격 줄 ✓(`78b8318b`)·증거(`9dd44870`). 11-03 사용자가 운영 카드 화면을 확인했다. 클립 8 촬영 공고는 사용자 요청으로 AI 공고 `R26BK01795021`. 덱 클립 번호가 겹쳐 사용자 결정으로 구글 캘린더를 클립 9로 바꾸고, 다른 세션이 main 폴더에 커밋하지 않고 둔 구글 캘린더 문서 변경 8개를 넘겨받아 함께 커밋했다 · `01392da4` push 전 `pnpm verify` 통과(web 1,198·루트 322·`next build`·AI 264·결정 57), 랜딩 E2E 17, 운영 랜딩 1440·390 확인, 운영 DB SELECT로 촬영 공고 값 계산([기록](evidence/award-reference/20261103-rollout.md))
- 2026-11-02 · 발표 덱에 구글 캘린더 장·클립 8 추가(사용자 "주요 기능 … 마지막에 캘린더 추가하고 시연 영상 이따 찍을 거니까 일단 임시 이미지만 넣어놔", "slides-spec 도 맞춰줘", "나머지 문서도 맞춰줘"): HTML 덱(`docs/submission/slides/`, 아직 git 에 없음) '주요 기능' 목차 12번·마지막 장, 임시 그림은 브라우저 시험 캡처. [[16-DECISIONS|ADR-060]] 발표 개정(`/calendar`를 클립 8로, `/market`은 그대로 질의응답만)·ADR-073 개정 메모에 연결 문장, [[slides-spec|덱 제작 명세]] 슬라이드 14a·부록 A 클립 8·부록 B 18번·부록 D 14a-1, 18 §6·§7, 19 S-GCAL·실패 대응, 12 촬영 행, [[2026-11-02-google-calendar-prod-rollout|운영 반영 계획]], 제출물 색인. 버튼 장면은 미뤄 둔 실계정 왕복이 필요해 촬영 환경 미정. 코드·운영 변경 없음 · HTML 덱 1920×1080 렌더 확인(18번 목차 12항목, 30번 캘린더 장), HTML 덱 `prettier --check` 통과(전부터 어긋나 있던 줄바꿈 1곳 포함 정리), 새 위키링크 대상 8개 존재 확인. md 는 `.prettierignore` 대상이라 서식 검사가 없다
- 2026-11-02 · 과기정통부 사업공고 운영 반영([[16-DECISIONS|ADR-075]], 단계마다 사용자 승인): 운영 DB source 제약에 `msit` 추가(`pnpm db:push` 대신 `20261101000050`과 같은 SQL 직접 실행, 미룬 구글 캘린더 표가 같이 들어가지 않게, `schema_migrations` 미기록) → 회사 부처 공고 Worker `478531c783eb` 재생성(15:16, `sol-radar-app` checkout `478531c7`, 되돌리기 태그 `rollback-program-notices-20261102`) → 최신 main 병합·push(Vercel) · 브랜치 push 게이트 통과, 회사 `--check` 키 SET, `--once` 기업마당 100/100·과기정통부 받음 10·저장 4·결과 발표 제외 6, 운영 DB SELECT(제약 정의, 기업마당 125·과기정통부 4행)([기록](evidence/program-notices/20261102-msit-rollout.md)). Vercel 배포·운영 화면 확인은 push 뒤
- 2026-11-02 · 발표일 2026-11-04 → 2026-11-05 연기(사용자 "발표 날짜 11월 5일", "발표일만 바뀌었어, 문서도 11-05로 고쳐"): [[16-DECISIONS|ADR-076]] 신설(ADR-054 1번 발표일 개정, 제출·화면 동결 11-03 그대로), docs/CLAUDE.md·00·12(남은 일정 표 11-05(목))·17·18·21·22·이 문서·docs/submission/ 4개·진행 중 계획 `2026-11-02-google-calendar-prod-rollout.md`의 발표일 수정. 지난 계획·증거의 11-04는 당시 기록이라 그대로. 코드·운영 변경 없음 · 고친 14파일 `prettier --check` 통과. `pnpm verify:changed`는 다른 세션의 미커밋 `.claude/settings.json`·`.mcp.json` 서식으로 `format:check` exit 1(이 작업 파일 아님)
- 2026-11-02 · 구글 캘린더 운영 연결을 발표 뒤로 미룬 결정(사용자 "일단 구글 캘린더는 미룰게. 문서로 정리해놔")을 문서로 정리: [[2026-11-02-google-calendar-prod-rollout|운영 반영 계획]](지금 운영 상태·다시 시작할 순서·사용자 할 일·로컬 왕복 계획·미확인 위험), ADR-073 개정 메모(상태 그대로), 12 남은 일정·해커톤 이후 행, 이 문서의 낡은 서술(`NEXT_PUBLIC_AUTH_GOOGLE`·남은 순서·승인 항목). 코드·운영 변경 없음 · `pnpm verify:changed` exit 0(변경 4개, 실행할 코드 검사 0개), 고친 4파일 `prettier --check` 통과, 위키링크 대상 파일 확인
- 2026-11-02 · 촬영 전 확인(사용자 지시): main 전체 검증, 운영 DB 읽기로 D1 촬영 값 확인(FX-01 92 추천·추천 분석 `DONE`, FX-16 70 보류, FX-02는 66 run 하나뿐, DEMO 추천 10·보류 8, 동국대 `ed2e57d4` 49 보류. 모두 19 §2.2와 같음), 나라장터 실패 회차 모양 정리(10-30 21:00 회차 21시간 열림 → 그동안 회차 없음 → 6회 0초 실패), 클립 4·6용 격리 로컬 스택(`sol-radar-film`, mock) 기동·S5·S6 리허설(변경 3·취소 1·중복 1, FX-07 diff, FX-01 PARTIAL 94) 뒤 시작 상태로 되돌림 · 새 worktree(origin/main `fbe42d5b`)에서 `pnpm verify` exit 0(루트 316·web 138파일 1,115·`next build`·AI 264·결정 57), 운영 DB SELECT만([기록](evidence/demo-day/20261102-preflight.md))
- 2026-11-01 · 과기정통부 사업공고를 부처 공고 세 번째 출처로 추가([[16-DECISIONS|ADR-075]], 사용자 결정): 녹음기·첫 실호출 녹음(10건 중 결과 발표 5건 제외), 응답 해석, 회사 부처 공고 Worker 회차에 추가(키 없으면 건너뜀), 마이그레이션 `20261101000050`, IT 필터 면제, `/bids/programs` 출처 필터·"공고문 확인", 랜딩 로고 10곳, 회사 실행서 §10. 브랜치 `feat/msit-rnd-notices`, 운영 미반영 · `pnpm verify` exit 0(루트 319·web 1,125 시험·빌드), 랜딩 E2E 10/10, 화면 360·390·768·1280·1440px([증거](evidence/program-notices/20261101-msit/)), 독립 리뷰 Critical 0
- 2026-11-01 · 문서 전체 점검(사용자 지시 "지금 기준으로 docs 다 검토해서 틀린 부분 수정"): git·Vercel·운영 DB 읽기로 지금 사실을 확정하고 00~21·PROGRESS·submission 5개를 고침. 고친 것은 카카오 "연결 0건·사용자 보고뿐" 서술(실발송 24통·11-01 녹화·지금 꺼짐), 운영 프로필 revision 5 → 6, 옛 가정 재계산 대본(FX-01 → FX-16), `sol-v0.2.0` → `sol-v0.2.1`, 결정 모델 반영 버전 `sol-v0.2.x` → `sol-v0.3.0` 이후, "회사 프로필은 모든 모드에서 가상"(ADR-052), 구글 캘린더 반영 상태(운영 배포·env 없어 버튼 숨김·migration 미적용), 나라장터 수집 장애·수동 수집, 04 표·함수·migration 목록, 05 IT 범위·정렬 5종, 06 로그인·`/gaps`·`/market`·`/calendar` 문구, 14 수집 정상 기준(60분 → 210분), 코드 줄 번호·깨진 증거 경로. ADR 결정 본문·상태는 바꾸지 않음. 22·`docs/CLAUDE.md`·`experiment-tables.md`는 맞아서 그대로 · 고친 파일 `prettier --check` 통과, 위키링크·증거 경로 검사, 운영 DB·Vercel 읽기만([기록](evidence/ingestion/20261101-ops-reads.md))
- 2026-11-01 · 인력 배치 공고별 추천 팀 구성(사용자 요청, 다른 세션): 요구 기술·역할이 맞는 직원이 0명이어도 분석 스냅샷 인력에서 직무 기준으로 3~12자리 추천 팀을 짜고, 팀별 지원 요청 표를 추천 팀 구성원의 소속 팀으로 묶음. FTE 표기를 "N명분"·"투입 가능 N%"로 바꿈. 코드 `f9dd9e4d`, 20:47 운영 배포 · web `verify:quick` 통과(단위 시험 1,115), 인력 배치 브라우저 시험 9/9. 루트 `verify:changed`는 이번 작업 밖 미커밋 파일의 서식 경고로 멈춤. 운영 로그인 화면 확인 미실행([기록](evidence/workforce/20261101-team-proposal/README.md))
- 2026-11-01 · 나라장터 정기 수집 실패(10-30 21:00~11-01 12:00, 7회) 조사: 실패로 닫을 때 `summary.failure`에 오류 코드를 남기고 Worker 로그 한 줄을 쓰며, 해석 못 한 응답은 본문 모양(HTML·XML 최상위 태그)을 남기게 고침. main 병합 `e2223bdc`, 회사 ingest Worker 미반영. 빈 구간은 16:17 수동 수집이 받음 · `vitest run worker/ingest-schedule-budget.test.ts` 34/34(문서 점검 때 다시 실행), 운영 DB `ingest_runs` 읽기([기록](evidence/ingestion/20261101-ops-reads.md))

## 관련 문서

- [[00-README|문서 인덱스]]
- [[10-DEPLOYMENT|10 배포]]
- [[12-ROADMAP|12 로드맵]] — 해커톤 컷·남은 일정 제안
- [[16-DECISIONS|결정 기록]]
- [[18-HACKATHON|18 해커톤]]
- [[07-DATA-PIPELINE|공고·인력 fixture]]
