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

## 현재 상태 요약 (2026-11-03)

- 화면 동결은 2026-11-03이다(2026-10-30 사용자 결정으로 11-01에서 연기. 제출 11-03은 그대로, [[16-DECISIONS|ADR-073]]).
- 입찰 일정(`/calendar`)의 `.ics` 내려받기를 빼고 구글 캘린더 연동을 만들었다([[16-DECISIONS|ADR-073]], 스펙 `polaris/specs/planned/2026-10-30-google-calendar-sync.md`). 코드는 main(`652741e2`)과 함께 운영 web(Vercel)에 배포됐다. 그래서 운영 `/calendar`에도 `.ics` 버튼이 없다. 운영에는 구글 연동 env가 없어 구글 캘린더 버튼은 그리지 않는다. 마이그레이션 `20261030002000`은 운영 DB에 넣지 않았다([운영 읽기](evidence/ingestion/20261101-ops-reads.md)). 그래서 설정의 구글 칸도 숨고, 볼 때마다 서버 로그 `google_calendar.load_failed`가 한 줄 남는다(기능 영향 없음). 운영 연결(Vercel 구글 env·재배포·마이그레이션)과 실계정 왕복은 사용자 결정(2026-11-02 "일단 구글 캘린더는 미룰게. 문서로 정리해놔")으로 발표 뒤로 미뤘다([[2026-11-02-google-calendar-prod-rollout|운영 반영 계획]]). 모바일 웹([[16-DECISIONS|ADR-072]])은 main `07a307f8`로 운영에 배포됐다(증거 [기록](evidence/mobile-web/20261030/README.md)).
- 공식 제출은 2026-11-03, 발표는 2026-11-05다([[16-DECISIONS|ADR-054]]. 발표일은 2026-11-02 사용자 결정으로 11-04에서 연기, [[16-DECISIONS|ADR-076]]). 발표는 장표 20분 + 녹화 클립이고, 장표는 HTML `docs/submission/slides/index.html`이다(2026-11-03 사용자 결정, 같은 날 `d6ecbb47` 로 git 에 넣음, pptx 덱은 쓰지 않는다). D1 운영 사이트(`https://www.solideos-radar.com` + `?origin=demo`)는 녹화 촬영 경로이자 질의응답 라이브다. 발표 전 `pnpm demo:reset`은 하지 않는다.
- 핵심 컷 C0~C9에서 남은 것은 C8 S-LIVE 녹화(동국대 공고 최신 run `2c69dc11` 49 비추천, [[16-DECISIONS|ADR-068]] 5번), C9 D1 리허설·촬영이다. C1 ④ 파서 "지원" 판정은 해커톤 뒤 벤치마크 뒤로 미뤘다(ADR-068 1번). 제출물(X4)은 초안이다.
- 운영에서 실공고를 수집·첨부 파싱·분석한다. 수집 출처는 나라장터·LH·KEPCO·K-water 입찰공고와 기업마당·과기정통부 부처 공고다. 실공고 분석과 추천 분석(ADR-066)이 운영에서 돈다(아래 운영 상태).
- SOL Score `sol-v0.2.2`(자격 판정 개정: 공고 인용이 없어도 회사가 보유한 자격은 충족, [[16-DECISIONS|ADR-071]])를 2026-11-03 운영에 반영했다(단계마다 사용자 승인. 회사 Analysis Worker·redis-api 11:26 재생성, main push 11:36, 재채점 쓰기 11:40, 회사 일회용 컨테이너, AI 재호출 없음). 새 run 72건·실패 0·권고 변화 3. 화면에 보이는 run 382건은 실공고 364건(추천 9·보류 344·비추천 11)과 DEMO 18건(추천 10·보류 8, 그대로)이다. 목록·대시보드 보류 배지 아래에 '자격 확인'이 보인다. 운영 회사 프로필은 revision 6(공개 자료 + 회사 확인 자격 3건: 소프트웨어사업자·직접생산·중소기업)이다. 발표 대본은 ADR-059 2026-10-30 2차 개정을 따른다. S3는 FX-01 저장 추천 92, 가정 재계산은 FX-16(방산업체 지정 가정 → 70 보류), S4는 FX-02 재분석(예상 59 보류) → 사람 비추천이다([기록](evidence/sol-score-v022/20261103/rollout.md)).
- 카카오 "나에게 보내기"([[16-DECISIONS|ADR-038]])는 2026-10-30 운영 연결·실발송(시험 2통·추천 23통)에 이어 2026-11-01 17:16~18:15 실수신 녹화를 마쳤다(사용자 승인, 실공고 `90c955ea` 재분석 → 추천 카톡 1통 SENT). 녹화 뒤 회사 알림 Worker의 카카오 발송은 다시 꺼졌고(18:15:48) 연결 행은 17:44:44부터 `enabled=false`다. 카톡 [분석 보기]가 회사 홈페이지로 열리던 결함은 Worker `SITE_URL`을 `https://www.solideos-radar.com`으로 고치고(사용자) 로그인 뒤 보던 화면으로 돌아오게 해서(`92ca1882`, 운영 배포) 고쳤다. 고친 링크로 실제 카톡을 받아 누르는 확인은 아직 안 했다([기록](evidence/kakao-notify/20261101-recording.md)). 2026-11-03 사용자 보고(카톡 버튼이 첫 화면을 로그인 없이 열고, Safari 로그인을 못 씀)로 카톡 안 창이면 기본 브라우저로 넘기는 안내 화면을 만들었다([[16-DECISIONS|ADR-079]], 브랜치 `fix/kakao-inapp-browser`, 운영 반영·실기기 확인 전, [기록](evidence/kakao-notify/20261103-inapp-browser.md)). 사용자가 누른 카톡은 `SITE_URL` 수정 전에 나간 것이라 녹화에는 새 카톡 한 통이 필요하다.
- 나라장터 정기 수집이 10-30 21:00~11-01 12:00 회차에서 7번 실패했다(원인 미확인). 11-01 15:00부터 정기 회차가 다시 성공했고, 16:17 수동 수집이 빈 구간(10-30 18:00~10-31 15:00)을 받았다. 실패 사유를 남기는 수정은 main에만 있고 회사 ingest Worker에는 반영하지 않았다([기록](evidence/ingestion/20261101-ops-reads.md)).
- X6 파인튜닝과 실험 E0~E3·X1·X2는 발표 뒤 진행 예정([[16-DECISIONS|ADR-067]])이다.

### 운영 상태

값은 증거에 적힌 것이고, 시각은 그 기록의 시각이다.

| 항목 | 현재 값 | 마지막 확인 |
|---|---|---|
| web(Vercel) | main `8b59b58e` Vercel production READY(11-03 12:30 생성). `sol-v0.2.2` 목록 '자격 확인' 표시(`dd63e6a1`, 11:38 READY)와 입찰 일정 분야 색(`8b59b58e`)까지 들어 있다. 구글 캘린더 연동 코드는 env 없어 버튼을 그리지 않는다. 함수 지역 `syd1`([지역 기록](evidence/deployment/20261028-region-latency.md)). [기록](evidence/sol-score-v022/20261103/rollout.md) | 2026-11-03 12:4x KST |
| `/health/ready` | 200 `{"db":"ok","redis":"ok","storage":"ok","ai":"local"}`(운영 웹 `dd63e6a1` 배포 직후, `06a578c0` 배포 뒤에도 같음). `ai`는 회사 AI gateway가 보고한 provider 값이다. [기록](evidence/sol-score-v022/20261103/rollout.md) | 2026-11-03 12:0x KST |
| 운영 DB | migration 73개, 마지막 `20261030001100`(가상 직원 등급·수행 이력 직급 정합). 저장소에는 구글 캘린더 `20261030002000`(운영 미적용)과 과기정통부 `20261101000050`이 더 있다. `20261101000050`은 같은 SQL을 2026-11-02 운영에 직접 실행했고 기록은 하지 않았다([기록](evidence/program-notices/20261102-msit-rollout.md)). [기록](evidence/ingestion/20261101-ops-reads.md) | 2026-11-01 20:1x KST |
| 회사 반영 | Analysis Worker는 `a7ba50830419`(`deploy/sv022-20261103` = `dd63e6a1` + 회사 carry, 11-03 11:26), redis-api는 `e1095030d1fd`(11-03 11:27, 되돌리기 태그 `rollback-20261103`). AI gateway는 `384e469857f0` 그대로이고 같은 호스트 Bosun `127.0.0.1:8009`를 부른다. 알림 Worker는 `7b5a79dc9054`(11-01 17:16 `memo` → 18:15:48 카카오 꺼짐으로 재생성, `SITE_URL` `https://www.solideos-radar.com`). `sol-radar-app` checkout은 2026-11-02 `478531c7`로 옮겼다(부처 공고 Worker 재생성, 되돌리기 태그 `rollback-program-notices-20261102` = `cbb3831e`). ingest·documents 이미지는 `cbb3831e86da` 그대로이고 redis-api 빌드 context만 배포 checkout이다. 나라장터 실패 사유 기록 수정(main `e2223bdc`)은 회사에 반영하지 않았다. [기록](evidence/sol-score-v022/20261103/rollout.md) | 2026-11-03 11:27 KST |
| 나라장터 정기 수집 | KST 3시간 정각. ingest Worker `cbb3831e86da`. 10-30 21:00 회차가 10-31 18:00까지 21시간 열린 채 `FAILED`로 닫혔고 그동안 나라장터 회차가 생기지 않았다. 이어 10-31 21:00~11-01 12:00 6회가 0초 만에 `FAILED`(원인 미확인, 사유 기록 없음). 11-01 15·18·21시는 `SUCCEEDED` 0건(일요일). 빈 구간 10-30 18:00~10-31 15:00은 11-01 16:17 수동 수집이 받았다(52건). 보조 조회(면허·지역·첨부)는 기능별 한도 각 1,000회다. [기록](evidence/demo-day/20261102-preflight.md) | 2026-11-01 22:4x KST |
| 외부 입찰공고(LH·KEPCO·K-water) | 같은 ingest Worker가 3시간 정각에 받는다. 10-30 18:00 이후 LH `SUCCEEDED`, K-water는 11-01 00:00까지 `PARTIAL`이고 03:00부터 `SUCCEEDED`, KEPCO는 `PARTIAL`(첨부 주소는 해커톤 동안 막아 둔다, [[16-DECISIONS\|ADR-068]] 3번). 남은 외부 3종(K-water 발주계획·LH 사전규격·조달요청)은 꺼짐. [기록](evidence/ingestion/20261101-ops-reads.md) | 2026-11-01 20:1x KST |
| 부처 공고(기업마당·과기정통부) | 전용 Worker(`sol-radar-program-notices-worker:478531c783eb`, 2026-11-02 15:16 재생성)가 3시간 정각에 기업마당 다음 과기정통부를 받는다. 15:16 `--once`: 기업마당 100/100, 과기정통부 받음 10·저장 4(결과 발표 6 제외). `program_notices` 기업마당 125·과기정통부 4행. [기록](evidence/program-notices/20261102-msit-rollout.md) | 2026-11-02 15:16 KST |
| 첨부 처리(Documents Worker) | 운영 중. 처리 상태 `PARSED` 10,373·`PARTIAL` 153·`UNSUPPORTED` 79·`FAILED` 7·`PENDING` 40·처리 상태 없음 4,553(다운로드 상태는 이번에 읽지 않았다). [기록](evidence/sol-score-v022/20261103/rollout.md) | 2026-11-03 12:40 KST |
| 분석 | `sol-v0.2.2` 재채점 쓰기 2026-11-03 11:40(사용자 승인, 회사 일회용 컨테이너 `a7ba50830419`, AI 재호출 없음). 새 run 72건·그대로 310·실패 0·권고 변화 3. 화면 run 382건: 실공고 364(추천 9 = 79~85점·보류 344 = 43~88·비추천 11 = 49점), DEMO 18(추천 10·보류 8). 화면 run 버전은 `sol-v0.2.0`·`sol-v0.2.1`·`sol-v0.2.2`가 섞여 있다. 새 공고는 자동 분석하지 않는다. DEMO는 FX-02만 옛 분석(66 보류, `sol-v0.1.0`, 프로필 revision 2, 재채점 대상 아님). [기록](evidence/sol-score-v022/20261103/rollout.md) | 2026-11-03 11:4x KST |
| 추천 분석 | 운영 반영. DEMO FX-01 추천 분석 `91b8a6e5`(`DONE`·`MODEL`, run `dfac87db` 92 추천)는 `sol-v0.2.1`·`sol-v0.2.2` 재채점 뒤에도 그대로다(11-03 재채점 72건에 추천 분석이 붙은 run은 없었다). 재채점으로 run이 바뀐 공고에 붙어 있던 결과는 보이지 않는다. [기록](evidence/sol-score-v022/20261103/rollout.md) | 2026-11-03 11:4x KST |
| DEMO 공고 | 19건 그대로, 16건 마감 +15일. 운영 DEMO 삭제는 발표 뒤다. FX-02는 촬영 때만 재분석한다([[16-DECISIONS\|ADR-059]], 예상 11-02까지 59 보류·11-03부터 53). DEMO 추천 10(FX-01 92·FX-03 90 등)·보류 8(FX-16 70 포함)은 `sol-v0.2.1`·`sol-v0.2.2` 재채점에서 바뀌지 않았다. [기록](evidence/sol-score-v022/20261103/rollout.md) | 2026-11-03 11:4x KST |
| 알림 처리 | 회사 알림 전용 Worker(`sol-radar-notify-worker:7b5a79dc9054`, 10-30 12:45 첫 기동)가 인앱 알림 2종(`ANALYSIS_COMPLETE`·`REVIEW_ASSIGNED`)과 마감 D-3·D-1 알림(5분마다)을 처리한다. 카카오 발송은 10-30 14:05~15:47과 11-01 17:16~18:15만 `memo`(실발송)였고 지금은 꺼짐(`notify.kakao.disabled`, 아래 카카오 행). 첫 기동 때 쌓인 인앱 28건은 admin 계정 1명에게 갔다("모두 읽음" 기능 없음). 마감 알림을 실제로 넣은 회차는 아직 못 봤다. 전체 Worker(`worker/main.ts`)는 띄우지 않는다. [기록](evidence/kakao-notify/20261101-recording.md) | 2026-11-01 18:15 KST |
| 카카오 | 운영 연결 1건 CONNECTED(admin@solideos.com, 10-30 14:13), 연결 행 `enabled=false`(11-01 17:44:44부터). 실발송: 시험 2통(10-30 SENT)·1회(11-01, 이벤트 PROCESSED), 추천 카톡 24통 SENT(10-30 23통, 11-01 녹화 1통). 같은 공고·같은 사람에게는 다시 보내지 않는다(claim). 실수신 녹화 끝. [분석 보기] 링크 결함은 고쳤고 실수신 확인은 남았다. 카카오 개발자 콘솔 Web 도메인 등록은 사용자 확인 남음. [기록](evidence/kakao-notify/20261101-recording.md) | 2026-11-01 18:15 KST |
| CI | GitHub Actions job이 2026-10-24부터 계정 결제 문제로 시작되지 않는다. 검사는 로컬 pre-push 게이트와 직접 돌린 `pnpm verify`다 | 2026-10-27 |
| hosted 모델 API | 승인 0건, 쓰지 않는다([[16-DECISIONS\|ADR-010]]) | — |

### 사용자 결정 대기

1. [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표 확인.
2. 구글 캘린더 운영 연결은 사용자 결정(2026-11-02)으로 발표 뒤로 미뤘다. 다시 시작할 때의 순서(Vercel env·재배포 → `pnpm db:push` `20261030002000`, 각각 승인)와 사용자 준비물(기존 구글 로그인 클라이언트에 Calendar API·`calendar.events` 범위·로컬 redirect URI, 게시 상태 확인)은 [[2026-11-02-google-calendar-prod-rollout|운영 반영 계획]]에 있다. 운영 Production에는 `NEXT_PUBLIC_AUTH_GOOGLE`이 이미 있고 로그인 화면에 구글 버튼이 보인다(2026-11-01 마스터 세션 확인, 값은 미확인). 2026-10-31 기록의 "끈 채 둔다"와 다르므로 그대로 둘지 사용자 확인이 필요하다. 구글 캘린더 코드는 이 값을 읽지 않는다. 같은 날 뒤의 결정으로 덱에 구글 캘린더 장·클립 9가 들어갔다([[16-DECISIONS|ADR-060]] 발표 개정). 버튼 장면은 실계정 왕복이 필요해, 찍으려면 이 연기를 풀지(로컬 왕복 또는 운영 반영) 사용자가 정해야 한다. 풀지 않으면 덱은 자동 시험 캡처로 둔다([[19-DEMO-SCENARIO|19]] S-GCAL).
3. 운영 반영 승인(각각 따로): 카카오 고친 [분석 보기] 링크 실수신 확인(다른 추천 공고, 알림 Worker `memo`·연결 다시 켜기). 회사 ingest Worker에 나라장터 실패 사유 기록 수정 반영 여부.
4. 카카오 아침 묶음(평일 09:00 추천 공고 카톡, [설계](plans/2026-10-30-kakao-morning-digest-design.md))은 사용자 결정(2026-11-01)으로 main 병합·운영 반영을 발표 뒤로 미뤘다. 반영 때 최신 main을 다시 합치고 전체 검증을 다시 돌린다.
5. 추천 분석 팝업·3배 상세화([[16-DECISIONS|ADR-078]]) 남은 운영 단계: FX-01 추천 분석 다시 요청(회사 Qwen 1회). 11-03 사용자 승인, 사용자가 화면에서 [새 형식으로 다시 분석]을 누른다. 운영 DB SQL·회사 Worker·redis-api·main push(Vercel)·AI gateway는 11-03 13:24~13:37에 반영했다([기록](evidence/rec-insight-detail/rollout-20261103.md)). 그 뒤 글자 수(옛 결과 428자의 2.5~3.5배)·소요 시간(3분 안)을 재고 클립 2 추천 분석 장면을 고친다.

### 남은 일

- [[16-DECISIONS|ADR-056]] 대안 A(분석이 그 revision 문서 처리를 최대 300초 기다린다)는 2026-10-30 회사 Analysis Worker에 들어갔다(지금 `a7ba50830419`에도 있다). 대기 동작을 운영 로그로 아직 보지 않았다.
- 날짜는 [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표(사용자 확인 전)에 있다. `sol-v0.2.1` 재채점과 카카오 실수신 녹화는 2026-11-01에, `sol-v0.2.2` 운영 반영은 2026-11-03에 끝났다. 남은 순서는 D1 리허설·촬영(S-LIVE·S-GAPS, 로컬 Compose의 S5·S6) → 장표·녹화 클립 완성 → 제출(11-03) → 발표(11-05)다. 구글 캘린더 실계정 왕복·운영 연결은 발표 뒤다(사용자 결정 2026-11-02). 덱 구글 캘린더 클립 9는 촬영 환경이 정해지지 않았다(위 결정 대기 2).
- 리허설 중 FX-02를 재분석하지 않는다. 촬영 때 "이전 분석 66(가상 프로필) → 새 분석 59(공개 자료 프로필, 예상)"이 보여야 한다([[16-DECISIONS|ADR-059]]).
- 발표 장표는 HTML `docs/submission/slides/index.html`이다(2026-11-03 사용자 결정 "deck은 이제 안 쓸 거야", 같은 날 `d6ecbb47` 로 git 에 넣음). 2026-11-03 사용자 결정("파인튜닝에 대한 내용도 좋을 거 같아", 제안 1번)으로 '주요 기능' 끝에 결정 모델 학습 2장(32 · 33장, 명세 슬라이드 14b · 14c)을 더했다. 학습 결과는 없고 설계와 준비 상태만 보인다([[16-DECISIONS|ADR-067]]). 숫자는 11-03 `sol-v0.2.2` 재채점·운영 DB 읽기 값으로 고쳤다. 영상(`slides/clips/`)은 촬영 뒤 넣는다. pptx 덱(`docs/submission/deck/`)은 쓰지 않고 11-01 판 그대로 둔다. 내용 정본은 [[slides-spec|덱 제작 명세]]다([[submission/README|제출물 색인]]).
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
| C8 | S-LIVE 실공고 `live` 분석·녹화 | 운영 실공고 분석 run 있음. 촬영 공고는 동국대 최신 run `2c69dc11` 49 비추천(11-03 `sol-v0.2.2` 재채점, [[16-DECISIONS\|ADR-068]]). 녹화 남음 | [기록](evidence/sol-score-v022/20261103/rollout.md) |
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
| 추천 분석 | 공고 상세 [추천 분석]: 버튼을 누를 때만 Qwen이 판단 이유·강점·보완할 점을 근거 번호와 함께 쓴다. 판정은 규칙 엔진 그대로([[16-DECISIONS\|ADR-066]]) | 운영 반영. 팝업·3배 상세화([[16-DECISIONS\|ADR-078]])는 2026-11-03 운영 반영, FX-01 새 형식 결과 확인 전. 연 1회 재학습 구현은 발표 뒤 | [운영 반영](evidence/company-rollout/20261029/rec-insight-rollout.md) |

## 최근 작업 로그

형식: `날짜 · 변경 · 검증`. 검증에는 실제로 돌린 명령과 결과만 적는다. 이 절은 최근 10줄만 둔다.

- 2026-11-03 · 추천 분석 진행률을 고른 속도로(사용자 "1에서 5퍼센트까지 천천히 가다가 한번에 100으로 가는데 … 균일한 속도로 가게 수정해봐", 브랜치 `feat/insight-detail`, 운영 반영 전): 진행률 기준을 3분 대기 상한에서 예상 시간 10초로 바꿨다(운영 회사 Qwen `insight/v0.2` 생성 6.4초·8.9초에 묻기 간격 2초를 더함). 10초에 90%까지 고르게 오르고 3분 상한까지 99%를 향해 천천히 오르며, DONE 이면 그때 값에서 100%까지 이어 채운 뒤(최대 0.8초) 600ms 두고 내용으로 바꾼다. `web/components/bids/insight-progress.ts`·`recommendation-insight.tsx`, [[06-UI-UX|06]] 진행률·완료 순간, [[16-DECISIONS|ADR-078]] 2번, 스펙 4.6·미결정 1, [[2026-11-03-recommendation-insight-detail|계획]] Q4, [[2026-11-03-recommendation-insight-detail-design|디자인 스펙]] 7.2 · `insight-progress.test.ts` 5 통과, 브라우저 시험 2파일 26 통과(완료 때 바로 100%로 바꾸면 새 시험 실패 확인)
- 2026-11-03 · 공고 상세 '사람 검토 권장' 정리(사용자 "AI로 쓴 티가 너무 나는데 … 사람 검토 권장만 남기고 다 지워", "지우고 대본도 같이 고쳐"): 오른쪽 결정 패널 상자는 제목만 두고 이유 배지·플래그 코드를 지웠다. 결정 모델 패널의 '규칙 우선(결정 모델 의견 상이)' 배지도 지우고 '… 규칙 판정이 우선합니다' 문장만 남겼다. 촬영 대본([[18-HACKATHON|18]] 클립 2, [[19-DEMO-SCENARIO|19]] S3 4번, [[slides-spec|덱 제작 명세]] 슬라이드 10 캡션·노트·부록 A 클립 2·타임라인)과 [[06-UI-UX|06]] 표를 맞췄다. 장표 HTML(`docs/submission/slides/index.html`)의 같은 문구 3곳과 옛 캡처는 다른 세션이 장표를 고치는 중이라 남겼다. 검증: `decision.browser.test.tsx` 25 통과(옛 코드로 새 시험 2개 실패 확인), `pnpm verify:changed` 통과, 결정 패널 360·390·768·1280·1440px·결정 모델 패널 360·1280 캡처([증거](evidence/review-box-20261103/)), 결정 모델 패널 328px 넘침 0.
- 2026-11-03 · 카톡 안 창 → 기본 브라우저 넘김([[16-DECISIONS|ADR-079]], 사용자 "1", 브랜치 `fix/kakao-inapp-browser`, 운영 반영 전): user agent `KAKAOTALK`이면 업무 화면이 로그인 대신 `/auth/open-in-browser?next=`로 보내고, 그 화면이 `kakaotalk://web/openExternal?url=`로 Safari·기본 브라우저에 넘긴다(버튼·[이 창에서 로그인] 함께). 운영 curl로 링크가 공고 주소면 `307 /auth/login?next=`인 것을 확인했고, 사용자가 누른 카톡은 `SITE_URL` 수정 전 메시지다 · `pnpm verify:changed` exit 0(웹 시험 147파일 1,226건), 로컬 dev 카톡·Safari UA 리다이렉트 5종, Playwright 카톡 UA 360·390·768·1280·1440 넘침 0·콘솔 오류 0·스킴 요청 확인([기록](evidence/kakao-notify/20261103-inapp-browser.md))
- 2026-11-03 · 추천 분석 팝업·3배 상세화 운영 반영 a·b·c([[16-DECISIONS|ADR-078]], 항목마다 사용자 승인): 운영 DB SQL, 회사 Analysis Worker `6278768721eb`·redis-api `ba8048674a23` 재생성(13:24), main push `ebd2a7bb`(첫 push는 그 사이 원격 main이 움직여 거절, 병합 뒤 다시 올림)·Vercel READY·`/health/ready` 200(13:35), AI gateway `6278768721eb` 재생성·추출 promptHash 그대로(13:37). 반영 뒤 진행 중 run·대기 추천 분석 0. 검증: pre-push 게이트 두 번 통과. FX-01 다시 요청은 사용자가 누를 차례([기록](evidence/rec-insight-detail/rollout-20261103.md)).
- 2026-11-03 · 추천 분석 팝업·3배 상세화 구현([[16-DECISIONS|ADR-078]], 사용자 "그래 구현 시작해", 브랜치 `feat/insight-detail`, 운영 반영 전): gateway 출력 `insight/v0.2`(판단 이유 800자·점수 요소별 해설·자격 요건 해설·참여 전 확인할 것, 세부 항목만 빼기, `INSIGHT_MAX_TOKENS` 4096), 마이그레이션 `20261103000100`(`prompt_version`, 옛 버전 결과가 있는 run 도 다시 요청), worker 가 규칙 값 `staffing` 저장, 공고 상세 팝업·진행률(0~99%, DONE 때 100%)·옛 형식 안내. 사전 리뷰(보안·code·infra·design·customer-support·qa·product) Critical 0, Warning 6건 반영([다시 확인] 다시 기다림, 시계 차, POST 실패 뒤 팝업 버튼, 같은 이름 자격 짝, 롤백 단위, 출력 상한). 검증: 전체 `pnpm verify` exit 0(웹 1,214·gateway 290·결정 57), 그 뒤 수정은 브라우저 시험 2파일·gateway `test_insight.py` 통과, 격리 로컬 mock 실제 앱 a~e 통과([E2E 기록](evidence/rec-insight-detail/e2e-20261103.md), 스크린샷 53장)
- 2026-11-03 · `sol-v0.2.2` 운영 반영(사용자 "1" 오늘 반영, 단계마다 승인)과 발표 장표 숫자 갱신(사용자 "남은일 진행해", "deck은 이제 안 쓸 거야 … slides 로 할 거야"): 회사 Analysis Worker `a7ba50830419`·redis-api `e1095030d1fd` 재생성(11:26~11:27) → main `dd63e6a1` push·Vercel READY(11:38) → 재채점 쓰기(11:40) 새 run 72건·실패 0·권고 변화 3. 화면 run 382건: 실공고 364(추천 9·보류 344·비추천 11), DEMO 18 그대로, S-LIVE 동국대 최신 run `2c69dc11` 49 비추천(`KEV_MANDATORY_RISK`). HTML 장표(git 밖) #13 순서도 그림 `sol-v0.2.2`·#14 규칙 엔진·#16 운영 표(11-03 기준, 첨부 `PARSED` 10,373)·#30 실제 공고 장·노트 S-LIVE 문장, 정본의 S-LIVE 문장 "엇갈렸습니다" → "결정 모델도 규칙과 같은 비추천"(slides-spec·limitations·18), 12 로드맵 11-03 행, 제출물 색인·18·slides-spec·이 문서에 HTML 장표 결정, [[16-DECISIONS|ADR-071]] 운영 반영 결과. pptx 덱은 고쳤다가 쓰지 않는다고 해서 원래 파일로 되돌렸다 · 재채점 dry-run(10:25)과 쓰기 결과 같음(`CHANGED` 72줄), `/health/ready` 200, 운영 화면 `/bids?origin=live` 1440·390·동국대 상세 확인, 운영 DB SELECT(권고·버전 분포·첨부 처리 상태·카카오 claim), 장표 #13·#14·#16·#30 1440·390 렌더 넘침 없음, 장표 `prettier --check` 통과([기록](evidence/sol-score-v022/20261103/rollout.md))
- 2026-11-03 · 추천 분석 팝업·3배 상세화 설계와 촬영 전 반영 결정(사용자 "추천 분석 누르면 팝업이 띄워지고 … 지금의 3배 정도 길이", 결정 8건 "추천대로", "오늘 밤이나 내일 영상 찍으려고 하는데 그 전에 구현 다 하고 싶어"): 스펙 `polaris/specs/in-progress/2026-11-03-recommendation-insight-detail.md`, [[2026-11-03-recommendation-insight-detail|단계 계획]], [[2026-11-03-recommendation-insight-detail-design|디자인 스펙]], [[16-DECISIONS|ADR-078]] 신설(ADR-073 1번 예외, ADR-061 `%`·ADR-066 대체 정책 개정). 코드 변경 없음 · 바꾼 문서 `prettier --check` 통과
- 2026-11-03 · SOL Score `sol-v0.2.2` 자격 판정 개정과 목록 '자격 확인' 표시(사용자 "85점이 추천인데 89점이 보류야 … 기준에 맞춰", 선택 "규칙 유지+오판 제거", 회사 자격 4종은 "모르겠어"라 프로필 그대로): 운영 화면 run 384건 읽기 점검에서 75점 이상 보류 54건(실공고 50·DEMO 4)·50점 미만 보류 14건이 모두 필수 자격 `NEEDS_REVIEW` 때문이었다(보조 조회 호출 예산 실패·회사 보유 자격의 공고 인용 누락·지역·판단 어려운 자격). 규칙(필수 자격 확인 필요면 점수와 무관하게 보류)은 그대로 두고, 공고 인용이 없어도 회사가 보유한 자격은 충족으로 바꿨다(`web/server/scoring/qualification.ts`). 목록·대시보드 권고 배지 아래 '자격 확인'을 보인다(`web/components/work/opportunity-recommendation.tsx`, `qualification_checks` 읽기). 08·06·11·[[16-DECISIONS|ADR-071]] 개정 메모·`infra/company/README.md` §11.8. 운영 반영은 같은 날 끝났다(바로 위 줄). 반영 전 예상 효과는 run 72건 판정 변화·권고 변화 3(보류 → 추천 2, 보류 → 비추천 1) · `pnpm -C web verify:quick` 통과(서식·타입·린트·146파일 1,200 시험·lodestar·토큰·색), 새 시험 `v022-qualification.test.ts` RED 확인 뒤 GREEN, 임시 브라우저 시험으로 360·390·768·1280·1440 넘침 없음([스크린샷](evidence/sol-score-v022/20261103/)). `pnpm verify:changed`는 다른 세션의 미커밋 `.claude/settings.json`·`.mcp.json`·`docs/submission/slides/index.html` 서식으로 루트 `format:check` 실패(이 작업 파일 아님)
- 2026-11-03 · 공고 상세 '참고 낙찰가 범위'([[16-DECISIONS|ADR-077]]) 운영 반영 마무리: 운영 표(MCP 직접 SQL, `schema_migrations` 미기록)·낙찰 이력 48,269행(11-02 사용자가 `award:backfill --apply --months 8` 실행, 호출 상한 400에 닿아 가장 최근 며칠 공고는 못 이음)·카드(main `01392da4`)·랜딩 가격 줄 ✓(`78b8318b`)·증거(`9dd44870`). 11-03 사용자가 운영 카드 화면을 확인했다. 클립 8 촬영 공고는 사용자 요청으로 AI 공고 `R26BK01795021`. 덱 클립 번호가 겹쳐 사용자 결정으로 구글 캘린더를 클립 9로 바꾸고, 다른 세션이 main 폴더에 커밋하지 않고 둔 구글 캘린더 문서 변경 8개를 넘겨받아 함께 커밋했다 · `01392da4` push 전 `pnpm verify` 통과(web 1,198·루트 322·`next build`·AI 264·결정 57), 랜딩 E2E 17, 운영 랜딩 1440·390 확인, 운영 DB SELECT로 촬영 공고 값 계산([기록](evidence/award-reference/20261103-rollout.md))
- 2026-11-02 · 발표 덱에 구글 캘린더 장·클립 8 추가(사용자 "주요 기능 … 마지막에 캘린더 추가하고 시연 영상 이따 찍을 거니까 일단 임시 이미지만 넣어놔", "slides-spec 도 맞춰줘", "나머지 문서도 맞춰줘"): HTML 덱(`docs/submission/slides/`, 아직 git 에 없음) '주요 기능' 목차 12번·마지막 장, 임시 그림은 브라우저 시험 캡처. [[16-DECISIONS|ADR-060]] 발표 개정(`/calendar`를 클립 8로, `/market`은 그대로 질의응답만)·ADR-073 개정 메모에 연결 문장, [[slides-spec|덱 제작 명세]] 슬라이드 14a·부록 A 클립 8·부록 B 18번·부록 D 14a-1, 18 §6·§7, 19 S-GCAL·실패 대응, 12 촬영 행, [[2026-11-02-google-calendar-prod-rollout|운영 반영 계획]], 제출물 색인. 버튼 장면은 미뤄 둔 실계정 왕복이 필요해 촬영 환경 미정. 코드·운영 변경 없음 · HTML 덱 1920×1080 렌더 확인(18번 목차 12항목, 30번 캘린더 장), HTML 덱 `prettier --check` 통과(전부터 어긋나 있던 줄바꿈 1곳 포함 정리), 새 위키링크 대상 8개 존재 확인. md 는 `.prettierignore` 대상이라 서식 검사가 없다

## 관련 문서

- [[00-README|문서 인덱스]]
- [[10-DEPLOYMENT|10 배포]]
- [[12-ROADMAP|12 로드맵]] — 해커톤 컷·남은 일정 제안
- [[16-DECISIONS|결정 기록]]
- [[18-HACKATHON|18 해커톤]]
- [[07-DATA-PIPELINE|공고·인력 fixture]]
