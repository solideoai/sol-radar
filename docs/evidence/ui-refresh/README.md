# 화면 UI 개편 (2026-10-28)

스펙: `polaris/specs/in-progress/2026-10-28-ui-refresh.md`. 계획: `docs/plans/2026-10-28-ui-refresh.md`. 결정: `docs/16-DECISIONS.md` ADR-061. 화면 규칙: `docs/06-UI-UX.md` §3.1·§3.4·§3.5·§4.1.

통합 branch `feat/ui-refresh`(main `c9319df3` 기준). 작업자 넷이 각자 worktree·branch 에서 화면을 나눠 고치고, 메인 세션(45)이 diff·스크린샷을 확인한 뒤 합쳤다.

| 작업자 | branch | 맡은 것 |
|---|---|---|
| W1 0f | `feat/ui-refresh-shell` | 토큰 `selected`, 사이드바, 화면 머리 경로, `ui/table`·`ui/chip`·`Card`, 설정·관리 화면, 입찰 일정·알림, 관심 공고·입찰 프로젝트 |
| W2 ac | `feat/ui-refresh-work` | 대시보드, 입찰 공고 목록·부처 공고, 공고 상세·변경 이력, 회사 역량 |
| W3 09 | `feat/ui-refresh-analysis` | 자격 갭 레이더, 발주 현황, 분석 결과 비교, 인력 배치 시뮬레이션(고칠 곳 없음) |
| W4 df | `feat/ui-refresh-landing` | 랜딩 흐르는 줄 둘·출처 로고, 조직·인력·조직도 |

## 스크린샷

화면 데이터는 작업자마다 격리 로컬 Supabase 의 가상 데이터(`db-seed`, `demo:reset`, 작업자가 넣은 "(가상)" 행)다. 운영 데이터 화면은 배포 뒤 따로 본다. 파일 이름 앞머리는 찍은 작업자(w1~w4)다.

- 앱 틀: `w1-sidebar-{1440,1280}`, `w1-sidebar-collapsed`, `w1-page-head-{bids,gaps,settings}-{1440,1280}`
- 업무: `w2-dashboard-*`, `w2-bids-*`, `w2-bids-table-1280`, `w2-bids-programs-*`(+`-drawer-1280`), `w2-bid-detail-long-*`(띄어쓰기 없는 긴 공고명 W05), `w2-bid-detail-history-*`, `w2-bid-revisions-*`, `w2-watchlist-*`, `w2-projects-*`, `w2-project-detail-*`, `w1-calendar-*`(+`-1280-full`), `w1-notifications-*`
- 분석: `w3-gaps-*`, `w3-gaps-1440-first`(1440×900 첫 화면, 관련 180건 데이터, 순위 3행 바닥 y 893), `w3-gaps-1440-assume`, `w3-market-*`, `w3-analysis-*`(+`-compare`), `w3-workforce-*`
- 회사: `w3-company-{tech,licenses,projects,history,people,preferences,financials}-1440`, `w3-company-projects-1280`, `w3-people-*`, `w3-org-chart-*`(팀 선택 파스텔)
- 로그인: `w3-auth-login-1440`
- 설정·관리: `w1-settings-{account,members,organization}-*`, `w1-tasks-*`, `w1-admin-ingestion-*`
- 랜딩: `w4-landing-{1440,1280}`, `w4-landing-services-1440`, `w4-landing-sources-1440`, `w4-landing-sources-hover-1440`(마우스를 올린 칸 원색), `w4-landing-sources-reduced-1440`(움직임 줄이기, 9곳 한눈에)

한계:
- 스크린샷은 작업자가 자기 화면을 끝낸 시점의 코드다. `w2-dashboard`·`w3-gaps-1440`·`w3-market-*`은 머리 버튼을 제목 줄로 내린 `90267ef5` 전, `w2-projects-*`는 보드 열 바탕을 바꾼 `90267ef5` 전이다. 리뷰 후속 `b8aac468`(사이드바 눌림 색·카드 안 표 테두리 2곳·`/market` 알약 높이)은 어느 스크린샷에도 없다. 최종 코드의 전 화면은 아래 점검으로 확인했다.
- 인력 배치 시뮬레이션 표는 기간 충돌이 있어야 나오는데 시험 데이터에 충돌이 없어 표 모양을 화면으로 보지 못했다.
- 공고 상세 가정 띠는 격리 데이터에 가정 계산 입력 기록이 없어 찍지 못했다(`what-if.browser.test` 통과로만 확인).
- 영상 구역은 2차 배포에서 생긴다. 지금 랜딩에는 없다.

## 검증 (통합 branch)

- 전체 `pnpm verify` exit 0 (`83af32c6` + 정본 문서 수정 작업 폴더): 루트 286, web 99파일 885, `next build`, AI 170, 결정 57.
- 커밋 게이트(`verify:quick`)는 통합 병합 커밋마다 통과했다.
- 작업자 검증: 화면마다 관련 단위·브라우저 시험과 `pnpm verify:changed`, 1440·1280 가로 넘침 0·pageerror 0. 시험 단언은 랜딩 첫 화면 시험 하나만 스펙 §4.5 대로 바꿨다.
- 공개 E2E 51 통과(`83af32c6` 빌드, 랜딩·로그인 전 경로).
- 리뷰 후속 `b8aac468`: `pnpm verify:changed --base 83af32c6` 통과, 브라우저 시험 14 통과(경로 `aria-current` 시험 1개 추가, 변형 실패 확인).
- `test:e2e:work`(격리 로컬 Supabase + 격리 Compose, mock): 1회차(`83af32c6`) 6 통과·5 실패·7 미실행. 실패는 axe `label-content-name-mismatch` 4건(사이드바 로고 링크 `aria-label="대시보드로 이동"`이 보이는 글자 "SOL RADAR"를 담지 않음, main `e9224f46`부터 있던 결함)과 1280 페이지 열기 30초 초과 1건. 2회차(`b8aac468`, 로고 이름 "SOL RADAR 대시보드로 이동") 17 통과·1 실패. 실패 1건은 격리 스택에 Storage 버킷을 만들지 않은 환경 문제(`profile-photo.write` 업로드 400 `NoSuchBucket`)였고, `pnpm storage:local` 뒤 그 spec 만 다시 돌려 통과했다. 전체 3회차는 돌리지 않았다.
- 전 화면 점검(`83af32c6` `next start`, ADMIN 계정): 스펙 4.4 경로 21개와 `/auth/login`을 1440·1280에서 열어 모두 HTTP 200, 가로 넘침 0, pageerror 0. 콘솔 오류는 `/dashboard`의 `/health/ready` 503 하나(격리 환경에 Storage·AI 설정이 없어서, 화면은 AI 배너로 처리).
- 독립 리뷰 1회(`90267ef5` 기준). 상 1건(회사 역량 표 겹테두리)은 W2 회사 역량 커밋으로 이미 고쳐져 있었다. 중 2건(카드 안 표 겹테두리 2곳)과 하 2건(경로 `aria-current`, 사이드바 눌림·열림 색), 보기 전환 높이는 `b8aac468`에서 고쳤다. 기록만 한 것: 흐르는 줄 멈춤 버튼(지금은 마우스·초점 때 멈춤, 움직임 줄이기 때 멈춘 줄), 랜딩 분석 예시 탭이 색으로만 구분됨, 출처 줄 제목이 연결 전 기관까지 현재형으로 읽힘(U8 사용자 결정, 11-02 확인).
- 이번 개편 밖에서 본 것: 조직도 "상위 미지정" 묶음 제목이 회색 버튼 바탕 안에 있다(`org-chart.tsx:203-220`, 이번 diff 가 건드리지 않은 곳).
