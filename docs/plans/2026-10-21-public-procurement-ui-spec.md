---
title: "공공조달 확장 — 대시보드·입찰 공고 UI 구현 명세"
doc: "design-public-procurement-20261021"
status: review
tags:
  - sol-radar
  - ui
  - design
updated: 2026-10-21
---

# 디자인 스펙: 공공조달 대시보드·입찰 공고

## 1. 기준과 적용 범위

사용자가 승인한 [공공조달 확장 스펙](../../polaris/specs/in-progress/2026-10-21-public-procurement-expansion.md) §9~12와 후속 승인(11열 표 내부 가로 스크롤, 1280px 대시보드 세로 배치)을 구현 가능한 화면 규격으로 정리한다. 스펙이 `in-progress/`로 이동하면 링크도 그 위치로 갱신한다. 기존 스펙의 “승인 전” 문구는 이 문서를 작성하도록 한 후속 구현 승인을 취소하지 않는다. 이 문서는 설계 산출물이며 브라우저 구현·검증 완료 보고가 아니다. 카피는 아래 고정 면책 문구를 제외하면 구현용 초안이다.

참고한 정본은 [[CLAUDE]], [[00-README]], [[06-UI-UX]], [[17-CLAUDE-IMPLEMENTATION]]이며, `.claude/agents/web-designer.md`와 `.claude/skills/design-system/SKILL.md`를 적용했다. `polaris/mission.md`는 현재 없으므로 승인 스펙과 PRD의 목적·범위를 따른다. 레퍼런스 `docs/design/references/SOL RADAR 공공조달 대시보드.png`와 `SOL RADAR 입찰 공고 대시보드.png`를 로컬 이미지 도구로 직접 확인했다. 실제 화면은 브라우저 대신 현재 코드로 읽었다.

레퍼런스에서 흰 바탕, 얇은 구분선, 제목 위계, 촘촘한 표, 절제된 출처 배지를 가져온다. 이미지의 예시 통계·날짜·로고·출처별 임의 색·지방자치단체 출처·early 기본 노출은 복제하지 않는다. 기존 업무 셸·사이드바·Topbar·`/bids/[id]` 상세·사람의 결정 흐름을 유지한다. 새 내비게이션·모바일·결제·승률·자동 투찰·장식 애니메이션은 범위에 없다.

## 2. 공통 레이아웃과 토큰

| 항목 | 구현 규격 |
|---|---|
| 업무 틀 | `web/app/(app)/(work)/layout.tsx`와 `web/components/app-shell.tsx` 유지. 각 page는 `requireWork()` 후 사용자 세션/RLS로 읽는다 |
| 본문 | 기존 `AppPage`, `contentClassName="max-w-360"`. 페이지 전체는 `min-w-0`; 가로 넘침은 목록 표의 전용 영역 안에서만 허용 |
| 폭 계산 | 펼친 사이드바 256px, 본문 좌우 32px 기준: 1440에서 약 1120px, 1280에서 약 960px. 접은 64px 셸에서는 각각 약 1312/1152px. 최종 전환은 viewport 대신 실제 본문 container 폭으로 결정 |
| 간격 | 페이지 구역 `gap-6`, 2열 gutter 24px, KPI gutter 16px. 카드 `p-6`, 작은 KPI `p-4`, 표 셀 가로 12px·세로 8px |
| 바탕·선 | `bg-background`/`bg-card`, `border-border`, `rounded-xl` 카드. 카드 그림자 없음. 표 hover만 `bg-muted/50` |
| 글자 | `font-sans`, 금액·식별자 `font-mono`, 숫자 `tabular-nums`. 제목 `type-title`, 구역 `type-heading`, 본문 `type-body`, 라벨 `type-label`, 보조/배지 `type-caption` |
| 대시보드 확대 | `AppPage typeScale="dashboard"` 유지. title 33/39, heading 19/27, body 17/25, label 16/23, caption 15/19는 기존 토큰 범위 변형에서 가져온다. 글자를 줄여 2열을 맞추지 않는다 |
| 색 | 본문 `foreground`, 보조 `muted-foreground`, 주요 버튼 `primary`; 선택 표시만 `brand`/`ring`. BID=`success`, WATCH/부분/충돌=`warning`, NO-BID/실패=`destructive`, DEMO만 `demo`. 상태색은 흰 바탕의 글자·아이콘·테두리에만 사용 |
| 동작 부품 | 기존 Button·Field·Input·Select·Switch·DropdownMenu·Tooltip·Dialog·Skeleton·Card·Table 사용. 설치나 토큰 추가 없음. 주요 default 버튼은 화면당 최대 하나 |

## 3. 사용 흐름과 URL

1. `/dashboard`에서 현재 모드의 고유 NOTICE 현황과 수집 소스 상태를 읽는다. “데이터 새로고침”은 DB 읽기만 다시 수행한다.
2. “우선 검토할 입찰 전체 보기” 또는 early 전체 보기로 같은 origin·기준시각·조건의 `/bids`로 이동한다.
3. `/bids`에서 출처·기관·단계·분야와 정렬을 바꾸면 서버 첫 페이지를 다시 읽고 cursor를 지운다. SI·AI 우선은 정렬만 바꾸며 결과를 숨기지 않는다.
4. 제목은 `/bids/{representativeBidId}?list={검증된 목록 쿼리}`로 연결한다. opportunity ID를 기존 bid ID 자리에 넣지 않는다. “외 n”은 출처 사본 목록을 열며 각 사본의 기존 상세로 이동할 수 있다.
5. 상세의 분석/최종 결정 패널에서 기존 권한과 사유 입력으로 사람이 결정한다. 이 목록에 결정 쓰기 버튼을 추가하지 않는다. 상세의 “공고 목록”은 원래 필터·정렬로 돌아온다.

`origin=live|demo`는 데이터의 실제/예시 구분이고 `sourceFamily=G2B|KWATER|LH|KEPCO`는 수집 계열이다. 화면 라벨은 각각 **데이터 구분**, **출처**다. fixture는 Source family가 아니다. 현재 mode가 mock/fixture이면 origin 기본은 demo, live이면 live다. 대시보드 집계는 한 origin만 사용한다. 목록에서 기존 `origin=all`을 제공한다면 실제/데모 건수를 분리하고 모든 demo 행에 DEMO를 보인다.

## 4. `/dashboard`

### 4.1 제목·기준시각·폭별 배치

제목은 **대시보드**, 설명은 **“공공조달 데이터와 수집 현황, 검토할 사업기회를 확인합니다.”**다. 오른쪽에 `<time>`으로 `YYYY. MM. DD. HH:mm 기준 · KST`, outline 작은 버튼 **데이터 새로고침**을 둔다. 버튼 접근성 이름도 동일하다. 좁으면 actions가 다음 줄로 내려가며 제목과 겹치지 않는다. 기존 `DashboardAiBanner`의 규칙만 분석·AI 상태 고지는 필요한 경우 계속 보인다.

KPI는 두 폭 모두 5개 한 줄이다. 본문 최소 960px에서 5칸은 각각 약 179px이므로 label 16px, value 33px, hint 15px을 유지한다. 긴 hint만 두 줄로 허용하고 다섯 카드 높이를 맞춘다. KPI는 기본 비상호작용 통계 카드이며 정의 설명이 필요한 곳에만 별도 키보드 접근 가능한 안내 버튼을 둔다.

본문 container가 **1120px 이상**이면 2×2로 배치한다. `grid-template-columns: minmax(0,7fr) minmax(320px,3fr)`, gap 24px이다. 1440px 펼친 셸에서 좌측 약 767px·우측 약 329px이다. 1120px 미만(1280px 펼친 셸 포함)은 다음 DOM 순서로 1열이다: 우선 검토 → 소스 상태 → 예정 사업 → 포트폴리오. 접은 셸에서는 실제 공간이 충분하면 같은 규칙으로 2열이 된다. viewport 1280px이라는 이유만으로 글자나 셸을 줄이지 않는다. 한 행의 두 카드는 높이를 맞추되 내용은 위에서 시작하며 내부 세로 스크롤은 두지 않는다.

```text
제목·설명                                      기준시각 [데이터 새로고침]
신규 발견 | 분석 대기 | BID 권고 | 마감 임박 (7일) | 수집 상태
우선 검토할 입찰                    | 수집 소스 상태 (4계열)
예정 사업 및 사전규격               | 입찰 포트폴리오 (권고 분포)
```

### 4.2 KPI 다섯 개

공통 기준은 서버의 한 `generatedAt/asOf`, 조직, origin, identity/분류 버전이다. 아래 개별 술어는 서로 다르며 “분석 대기”와 “사람 검토 대기”를 바꾸어 쓰지 않는다. 성공한 COUNT의 0은 **0**, 조회하지 못한 값은 **—**다.

| 순서·라벨 | 큰 값 | 보조 문구와 정의 |
|---|---|---|
| 1 신규 발견 | `N` | `최근 24시간 · 입찰공고`. NOTICE opportunity의 firstSeenAt이 `[asOf−24h, asOf]`. 정정·중복 수신 제외 |
| 2 분석 대기 | `N` | `현재 입력의 분석 결과 없음`. 같은 NOTICE 범위에서 현재 입력에 유효 COMPLETED/PARTIAL이 없음. 안내에 `미분석 N · 대기 N · 분석 중 N · 실패 N`을 구분 |
| 3 BID 권고 | `N` | `현재 유효 분석 · 진행 중`. 유효한 최신 org별 권고 BID, 진행/기한 유효, 출처 충돌·자격 확인 필요·early 제외 |
| 4 마감 임박 (7일) | `N` | `정확한 마감 확인 · 진행 중`. `[asOf, asOf+7일]`, 취소/종료 제외. 신청마감과 투찰마감 차이는 안내에 명시 |
| 5 수집 상태 | `n/m` | `신선한 서비스 / 활성·승인 서비스`. 별도 `연동 준비 N · 미검증 N`. 일부 오류면 warning 아이콘과 `일부 지연` 또는 `오류 N`을 붙임 |

수집 m이 0이면 `0/0 정상`으로 보이지 않고 **— / 활성 수집 서비스 없음**이다. mock/fixture에서는 **— / {mode} 모드 · 외부 수집 없음**이며 예시 데이터 적재의 최근 시각은 별도 보조 줄로 표시한다. live 서비스 인증 성공을 가상으로 만들지 않는다. firstSeenAt 없는 기존 데이터는 최근 24시간 신규에 임의 포함하지 않는다.

### 4.3 왼쪽 위: 우선 검토할 입찰

헤더 **우선 검토할 입찰**, outline 작은 **전체 보기**(접근성 이름 `우선 검토할 입찰 전체 보기`). 보조 문구 **공공 SI·AI 우선 · 최근 공고 순**. NOTICE·진행 중·선택 origin·siAiFirst=true·최근순 서버 결과 5건이다. “BID 권고 목록”이라는 이름이나 점수순 부제를 쓰지 않는다.

7개 고정 열 표 대신 동일 정보를 세 영역의 반복 행으로 보인다. +3px 글자로도 767px 카드에서 읽을 수 있게 하는 결정이다. 목록은 `<ul>`/`<li>`, 행 `px-6 py-4`, `grid-cols-[92px_minmax(0,1fr)_112px] gap-3`이다.

| 영역 | 내용 |
|---|---|
| 출처 92px | SourceBadge, 다중 출처면 `외 n` 버튼. DEMO는 배지와 별도 의미로 표시 |
| 본문 가변 | 제목 링크 최대 2줄 `type-body`; 다음 줄 `기관`(type-caption), 그 아래 `예산 {값} · 마감 {날짜/D-n}`(type-caption). 메타는 wrap 허용, 전체 기관명은 링크에 묶지 않음 |
| 점수·권고 112px | 오른쪽 정렬. `SOL Score` 보조 라벨 + 점수 `type-heading tabular-nums`, 아래 권고 `StatusBadge inline`. 미분석이면 점수 `—`, `분석 대기` 중립 표시 |

취소·출처 충돌이 포함될 경우 조용히 BID처럼 보이지 않도록 서버 조건/상태를 검증한다. 금액 미확인은 `예산 —`; 마감 정밀도가 부족하면 `마감 미확인`이며 D-n을 만들지 않는다. 전체 보기 URL은 같은 NOTICE·진행·origin·기준시각 조건을 사용한다.

### 4.4 오른쪽 위: 수집 소스 상태

헤더 **수집 소스 상태**, 설명 **저장된 수집 기록 기준**. G2B(라벨 나라장터), K-water, LH, KEPCO의 순서로 **항상 4행**을 그린다. 기관 유형·서비스 10개·KEPCO company 14개를 별도 Source 행으로 늘리지 않는다.

행은 `p-4 border-b`, 첫 줄 SourceBadge + 오른쪽 상태(아이콘+텍스트), 둘째 줄 `활성 서비스 n/m`, 셋째 줄 `마지막 성공 {상대시각}`이다. `m`의 정의(해당 계열에 등록된 서비스 수)와 KPI 분모(활성·승인 서비스 수)는 라벨로 구분한다. 소스 전체가 정상일 때만 **정상**으로 쓴다. API별 상태가 다르면 **일부 지연**, 실패는 **오류**, 활성/연결 없음은 **연동 준비**, 미검증이면 **확인 전**이다. 정상 0건 수집도 완전 성공 시각을 갖는다. 마지막 run 하나로 계열 전체를 판정하지 않는다.

각 행의 **서비스 n개 보기**는 native `<details>/<summary>`로 안전한 서비스명·일반 상태·마지막 완전 성공 시각만 펼친다. auth 원문·env 유무·키·요청 URL·내부 오류 상세·원본은 제공하지 않는다. 일반 구성원에게 관리자 API를 호출시키지 않는다. ADMIN에게만 카드 하단 outline 링크 **수집 관리**(`/admin/ingestion`)를 보인다. mock/fixture에서는 `외부 수집 없음`을 카드 설명에 덧붙이고 실제 연결이 성공한 것처럼 초록 상태를 만들지 않는다.

### 4.5 왼쪽 아래: 예정 사업 및 사전규격

헤더 **예정 사업 및 사전규격**, 설명 **발주계획·조달요청·사전규격 · 입찰공고와 별도 집계**. 전체 보기 URL은 `includeEarly=true`와 명시적 `stage=PLAN&stage=PROCUREMENT_REQUEST&stage=PRE_SPEC`를 전달한다. true만 보내 NOTICE까지 섞어 보이지 않는다.

서버 결과 최대 5개를 검토 목록과 같은 출처/본문/오른쪽 메타 구조로 보인다. 제목은 실제 연결 가능한 bidId 상세 링크, 본문 메타는 기관과 단계, 오른쪽은 예산·예정 일정이다. 월 정밀도는 `YYYY년 M월 예정`, 날짜는 `YYYY. MM. DD. 예정`, 의견마감은 **의견마감**으로 구분한다. 입찰 마감 D-n·BID 권고·현재 투찰 가능 표시를 붙이지 않는다. 확정 동일 opportunity에 NOTICE가 있으면 제외하지만 제목 유사 후보만으로 숨기지 않는다. 안정 ID가 미확보인 provisional 데이터는 `식별 확인 필요` 중립 안내를 보이고 임의 상세 ID/단계 연결을 만들지 않는다.

### 4.6 오른쪽 아래: 입찰 포트폴리오

헤더 **입찰 포트폴리오**, 부제 **권고 분포 · 입찰 프로젝트·수주 실적이 아닙니다**. 같은 origin의 NOTICE opportunity 전체를 BID/WATCH/NO-BID/분석 대기 4행으로 분할한다. 유효 PARTIAL 권고는 해당 권고에 포함하고 `부분 분석 N건`을 따로 알린다. 원본 사본 수를 합산하지 않는다.

각 행은 기존 상태 아이콘/라벨, 우측 `N건`, 그 아래 `확인 예산 {합계} · 예산 미확인 N건`이다. 예산 종류가 서로 비교 불가한 경우에는 한 금액으로 합치지 않고 종류별 합계 또는 `금액 기준 확인 필요`로 보인다. 금액 합계는 서버가 같은 종류로 정규화 가능한 대표 금액만 한 번 계산한다. 숫자만으로 충분하므로 도넛/새 차트·새 색을 추가하지 않는다. `분석 대기`를 WATCH나 사람의 미결정으로 분류하지 않는다. 사람의 최종 결정은 이 분포와 별개다.

## 5. `/bids`

### 5.1 제목과 검색·필터

제목 **입찰 공고**. 고정 설명 **SOL Score는 내부 적합도이며 낙찰 확률이 아닙니다. 최종 참여 결정은 사람이 합니다.** 기존 `bids-copy.ts`를 정본으로 page/loading/error에서 공유한다.

선택 영역은 border 카드 `p-4`, top quick controls → 필터 grid 순이다. 한 줄에 모든 필터를 밀어 넣지 않는다.

| 영역 | 순서·크기·동작 |
|---|---|
| 빠른 조건 | 왼쪽부터 **공공 SI·AI 우선** Switch(기본 ON, 최소 208px), **전체 / 나라장터 / K-water / LH / KEPCO** 버튼군(각 최소 80px, 높이 36px), 기관 선택 트리거(최소 160px), **Early Opportunity 포함** Switch(기본 OFF, 최소 224px). `flex-wrap gap-3`로 1280에서 자연스럽게 2행 허용 |
| 검색 | label **검색**, Input placeholder `제목·기관·공고번호`, 최소 240px·나머지 폭 확장. Enter 또는 명시 검색 버튼으로 제출; 입력 매 글자마다 서버 조회하지 않음 |
| 필터 1행 | 검색 → 출처(128px) → 기관(160px) → 단계(128px). 최소 필요 폭 합을 넘기면 다음 행 |
| 필터 2행 | 상태(160px) → 권고(128px) → 분야(144px) → 최종 결정(128px) → 데이터 구분(144px) → 정렬(160px). 각 라벨은 보이고 트리거 높이 40px. 1280에서는 wrap, 잘리거나 겹치지 않음 |
| 아래 설명 | `공공 SI·AI 우선은 표시 순서만 바꾸며 공고를 숨기지 않습니다.` 선택 조건이 있으면 ghost 작은 **필터 초기화** |

출처 빠른 버튼과 출처 필터는 동일한 반복 `sourceFamily` URL 값만 수정한다. 버튼은 `aria-pressed`를 사용하며 복수 선택 가능; **전체**는 배열을 비운다. 출처 DropdownMenuCheckboxItem도 같은 선택을 보여준다. 동시 선택 시 계열은 OR다. family 집계 수치는 선택 사항이며 서버가 동일 scope의 정확한 distinct facetCount를 줄 때만 표시한다. 여러 계열에 속한 동일 기회가 있으므로 버튼 건수를 더한 값이 전체 건수라고 쓰지 않는다.

기관은 검색 가능한 DropdownMenu 안 Input + CheckboxItem 목록을 재사용하고 선택 값은 agency ID다. 큰 기관 목록은 서버 검색하며 현재 20건 목록에서 기관을 추출하지 않는다. `지방자치단체`는 기관 필터 안 **기관 유형** 그룹에만 둔다. KEPCO company는 별도 그룹 **KEPCO 회사 구분**에 COM01 등 코드+공식명을 제공하고, 필요 시 실제 발주기관과 AND로 보낸다. `미확인`, `관측됨`, `조회기간 0건`, `오류`는 데이터 관측 상태이며 키 발급 여부/지원 불가로 해석하지 않는다. 상단 기관 트리거와 아래 기관 필터는 같은 URL 값을 사용한다.

분야는 AI·AX / SI·SW / 클라우드 / 데이터 / 보안 / 디지털트윈 / 기타이다. 분류 전부를 이 영역에서 숨기지 않는다. 미분류·확인 필요는 결과 행의 분류 상태로 보이고 관련성 점수는 SOL Score 열에 넣지 않는다. 필터 배열 내 OR·서로 다른 필터 간 AND를 적용한다.

상태 기본은 **진행 중 (기본)**(OPEN·AMENDED), 선택은 전체 / 진행 중 / 마감 / 취소 포함 / 취소됨이다. 초기화하면 SI·AI ON, early OFF, 진행 중, mode별 기본 origin, 최근 공고 순으로 돌아간다. `stage=PLAN|PROCUREMENT_REQUEST|PRE_SPEC` 선택은 includeEarly=true를 같은 URL 변경으로 함께 기록한다. 그 상태에서 early를 끄면 early stage 선택을 지우고 NOTICE 범위로 돌아가며 `예정 단계 선택이 해제되었습니다`를 결과 안내 한 곳에서 알린다. OPENING/AWARD/CONTRACT는 명시 stage를 선택했을 때만 제공하며 early ON만으로 섞지 않는다.

정렬은 **최근 공고 순 / 마감 빠른 순 / 점수 높은 순 / 예산 높은 순**이다. 기본은 SI·AI 우선 그룹 → 최근 공고 → 안정 ID. 명시 정렬을 선택하면 그것이 전체 1차, SI·AI 우선은 동률 보조 기준이다. 예: 점수순에서 낮은 관련성 90점이 높은 관련성 70점 아래로 강제 이동하지 않는다. null은 항상 마지막이다.

### 5.2 결과와 11열 표

필터 아래 `사업기회 {totalCount}건 · 현재 {loadedCount}건 표시`를 `role="status"` 한 곳에서 알린다. `totalCount`는 전체 서버 COUNT이며 내려받은 행 수가 아니다. 그 옆에 원본 사본 수/중복 후보가 있으면 `중복 후보 N건 포함` 안내를 별도 표시한다. 목록 기준시각을 보조 글자로 함께 보인다.

표는 `table-fixed w-full min-w-[1184px]`이며 다음 폭은 셀 padding을 포함한다. 합계 **1184px**다. 제목만 남는 폭만큼 확장하고 다른 열을 줄이거나 숨기지 않는다.

| 순서 | 열 | 최소 폭 | 정렬·표시 |
|---|---|---:|---|
| 1 | 출처 | 100px | SourceBadge. 다중 출처는 다음 줄의 `외 n` 버튼. origin은 DEMO와 별도 표기 |
| 2 | 기관 | 120px | 공식 기관명 최대 2줄. 긴 띄어쓰기 없는 이름도 break-words; 전체값은 상세 및 focus 가능한 설명에서 확인 |
| 3 | 단계 | 80px | 입찰공고/발주계획/조달요청/사전규격 등. 정정/취소는 다음 줄의 event/status 보조 표시 |
| 4 | 제목 | 228px + 잔여폭 | 제목 링크 최대 2줄. 첨부 경고 아이콘은 clamp 밖. DEMO 행은 독립 DEMO 배지로 식별 |
| 5 | 분야 | 96px | 최대 2개 세로 배치·type-caption·중립 테두리·px-1. 더 있으면 `외 n`; 미분류/확인 필요를 텍스트로 표시 |
| 6 | 예산 | 88px | 우측·font-mono·tabular-nums. 기존 compact 원 표시, 설명에 원 단위 전체 값·금액종류 |
| 7 | 마감 | 88px | 정확한 투찰마감은 D-n + KST 짧은 날짜. 날짜/월 정밀도는 원 정밀도 표시, 의견마감/신청마감은 명칭 구분 |
| 8 | SOL Score | 88px | 우측·tabular-nums. 현 입력 유효 점수만 정수 표시, 0은 0, 없음은 —. header/cell 좌우 padding 8px |
| 9 | 권고 | 88px | 기존 StatusBadge inline, BID/WATCH/NO-BID. 유효 권고 없음은 — |
| 10 | 분석 상태 | 112px | 미분석 / 대기 중 / 분석 중 / 완료 / 부분 완료 / 실패 / 재분석 필요. icon+text. 부분 완료 설명은 `규칙만` |
| 11 | 최종 결정 | 96px | 기존 StatusBadge decision inline. null은 미결정, 현재 입력에 해당하지 않는 이전 결정은 보조 `이전 결정 있음` |

헤더 높이 40px, 행 최소 64px·내용에 따라 자동 증가(긴 제목·DEMO·다중 출처가 3줄이면 자르지 않음), tbody `divide-border`, zebra 없음. stage/event·analysis·origin 모두 색 외 텍스트를 갖는다. 취소/마감 행은 상태를 표시하지만 현재 BID처럼 강조하지 않는다. 출처 간 금액/마감 충돌은 제목 옆 warning 아이콘과 **출처 간 확인 필요**, 해당 확정 불가 셀은 **확인 필요**로 보인다. 이전 revision 점수를 현재 SOL Score로 복사하지 않는다. 새 분석 진행 중 기존 유효 완료 점수 사용 여부는 서버의 currentResult 계약을 따르며 오래된 점수를 클라이언트가 선택하지 않는다.

표 바로 위에 **“표를 좌우로 이동해 모든 열을 확인할 수 있습니다.”**를 실제 넘침이 있을 때 보인다. 표 전용 스크롤 영역에 `tabIndex=0`, `role="region"`, `aria-label="입찰 공고 표, 가로 스크롤 가능"`과 안내 연결을 둔다. `Table`은 이미 내부 overflow wrapper를 만들기 때문에 **포커스·이름도 실제 스크롤되는 같은 DOM에** 전달해야 한다. 외부에 별도 overflow wrapper를 겹쳐 두지 않는다. 공통 Table 변경이 필요하면 접근성 wrapper props를 추가하되 기본 동작을 유지한다. 페이지 자체에는 수평 스크롤이 생기지 않아야 한다.

1440px 펼친 셸의 1120px 본문에서는 64px, 1280px 펼친 셸의 960px에서는 224px가 표 안에서 이동한다. 1440px 접은 셸의 본문은 1184px보다 넓어 스크롤 없이 모든 열을 볼 수 있다. title·source를 별도 sticky 열로 고정하지 않아 포커스와 중첩을 단순하게 유지한다.

### 5.3 SourceBadge와 다중 출처

`web/components/bids/status-badge.tsx`에 sibling export **SourceBadge**를 추가한다. generic ui/badge 패키지·새 팔레트를 만들지 않는다. source family→label의 단일 대응은 G2B=나라장터, KWATER=K-water, LH=LH, KEPCO=KEPCO다.

기준 클래스는 `inline-flex h-7 min-w-[76px] items-center justify-center rounded-md border border-border bg-background px-2 type-caption font-medium whitespace-nowrap text-foreground`다. **고정 line-height를 h-7로 덮지 않고** type-caption의 기본 16px/대시보드 범위 19px을 flex 높이 28px 안에서 중앙 배치한다. LH만 별도 padding/translate/baseline 보정을 넣지 않는다. SourceBadge는 상태 배지가 아니므로 아이콘이나 출처별 의미색을 요구하지 않는다. 선택된 출처의 버튼/필터에만 brand를 쓴다. StatusBadge 자체의 모든 높이를 h-7로 일괄 변경하지 않는다.

origin이 demo이면 기존 DemoBadge도 반드시 보인다. family 정보가 없는 fixture는 neutral **미확인**(접근성 이름 `출처 미확인`)+DEMO로 표시하며 “fixture=G2B 실제”라고 채우지 않는다. SourceBadge와 DemoBadge는 서로 대체하지 않는다.

`외 n`의 n은 원본 source record 수−1이며 family 수−1이 아니다. Button ghost size sm, 접근성 이름 `{제목}의 원본 출처 {총수}개 보기`, 클릭하면 기존 Dialog를 사용한다. 제목 **원본 출처**, 설명 **같은 사업기회로 연결된 공고입니다. 분석과 최종 결정은 각 공고 입력에 연결됩니다.** 목록에 family·서비스명·기관·공고번호·단계/event·갱신시각, **공고 상세** 링크를 제공한다. 공식 원문 링크는 기존 `source-link.tsx`/`external-url.ts` 허용 규칙으로만 연다. 내부 run/raw payload·비밀 URL은 없다. 대표 출처에는 텍스트 **대표 공고**를 붙인다. 충돌은 위에 warning 안내로 보이고 이 대화상자에 병합/분리 쓰기 동작은 없다.

### 5.4 더 보기·cursor·복귀

기본 limit 20, 최대 100이다. 기존 `LoadMoreFooter`와 `useLoadMore`의 **더 보기** 흐름을 사용하고 endpoint만 새 `/api/v1/opportunities` 계약으로 연결한다. 클라이언트가 전체 목록을 받아 filter/sort하지 않는다. query·sort·origin·org·identity/classifier 버전·asOf에 바인딩된 서버 keyset cursor는 불투명 문자열로 취급한다. 필터 변경 시 첫 페이지로 재조회하고 붙인 행을 버린다. 더 보기는 행을 같은 tbody에 추가하며 성공 시 새 첫 제목 링크로 포커스를 옮긴다.

다음 페이지 오류는 기존 행을 유지하고 하단 **더 불러오지 못했습니다. 다시 시도**를 보인다. INVALID_CURSOR는 **목록 기준이 변경되었습니다. 처음부터 다시 불러오세요.**와 **처음부터 보기**를 보이고 같은 필터 첫 페이지로 돌아간다. 개수를 임의로 보정하거나 이전 snapshot 행과 섞지 않는다.

`bids/[id]/back-href.ts`는 현재 legacy `parseBidListQuery`만 검증하므로 새 source/category/early 조건이 붙은 list를 버린다. 안전한 복귀를 위해 **새 opportunity query의 허용 키·값으로 검증**하도록 함께 확장해야 한다. 복귀 경로는 `/bids` 고정, 외부 href는 받지 않는다. cursor/limit은 복귀 쿼리에서 제외하고 사용자가 본 조건·sort·origin·기준시각만 보존한다.

## 6. 상태 명세

### 6.1 대시보드

| 상태 | 언제 | 보이는 것 | 사용자가 할 수 있는 것 |
|---|---|---|---|
| 로딩 | 최초 서버 읽기 | 같은 제목/+3px 범위, KPI 5개·4개 패널과 같은 크기의 Skeleton. `대시보드를 불러오는 중…` status | 셸 메뉴 사용 |
| 정상 | 집계·목록 성공 | 한 generatedAt의 KPI/패널. 0은 0 | 새로고침·목록/상세 이동 |
| 공고 없음 | NOTICE 0건, 집계 성공 | KPI 0, 검토/포트폴리오 빈 문구. 소스 4행·early 결과는 유지. `아직 수집된 입찰공고가 없습니다` | ADMIN은 수집 관리 링크, 그 외 `관리자에게 수집을 요청하세요` |
| 해당 결과 없음 | 검토 또는 early만 0건 | `검토할 입찰공고가 없습니다` / `예정 사업 및 사전규격이 없습니다`. 패널 헤더 유지 | 전체 보기 |
| 연동 준비 | 활성 수집 없음/미검증 | `연동 준비`/`확인 전`, 시각 —, 임의 숫자 없음 | ADMIN 수집 관리, 구성원 안내 읽기 |
| 일부 조회 실패 | 소스 요약/early 등 한 블록 실패 | 해당 패널만 `현황을 불러오지 못했습니다`+읽기 재시도. 값 —, 나머지 데이터 유지 | 해당 조회 재시도 |
| 전체 조회 실패 | 업무 데이터 접근/주요 집계 실패 | 기존 WorkError, `대시보드를 불러오지 못했습니다`, requestId와 재시도 | 읽기 재시도 |
| 부분 분석 | 유효 PARTIAL 포함 | 기존 규칙만 분석 배너·부분 분석 건수. 권고/점수가 있으면 그대로 표시 | 상세에서 근거 확인 |
| 출처 충돌/중복 후보 | 서버가 미확정/충돌 반환 | `출처 간 확인 필요`/`중복 후보 N건`. 확정 중복 제거 보장 문구 없음 | 상세/출처 확인 |
| DEMO | origin demo | 기존 Topbar DEMO+mode+AI provider, 데이터 행 DEMO. 집계도 `예시 공고 기준` | 예시 데이터 흐름 사용 |
| null | 미확보 시각·금액·분류 | —와 원인 라벨. 미확인 금액 N건 따로 | 상세에서 확인 |

### 6.2 입찰 공고·출처 대화상자

| 상태 | 언제 | 보이는 것 | 사용자가 할 수 있는 것 |
|---|---|---|---|
| 최초 로딩 | 첫 페이지 대기 | 제목/필터 자리와 11열 머리·대표 행 Skeleton, 읽기 안내. 깜빡임 애니메이션 추가 없음 | 셸 메뉴 사용 |
| 필터 변경 | URL 변경 후 서버 재조회 | 고른 값은 optimistic 즉시 반영, 이전 결과는 busy 표시. 이전 count를 새 조건 count처럼 알리지 않음 | 필터 추가 변경; 결과 도착 대기 |
| 데이터 없음 | 기본 scope 0건 | `아직 수집된 공고가 없습니다`, 모드/연동 안내 | ADMIN 수집 관리, 구성원 요청 안내 |
| 필터 결과 없음 | 조건 있는 COUNT=0 | `조건에 맞는 공고가 없습니다`와 현재 조건 요약, `필터 초기화` | 초기화·조건 수정 |
| 조회 오류 | 첫 페이지 실패 | WorkError와 requestId, 입력한 URL 조건은 유지 | 다시 시도 |
| 더 보기 실패 | 다음 페이지 실패 | 기존 행 유지, footer 오류와 재시도 | 같은 cursor 재시도 |
| 커서 무효 | snapshot/version 변경 | 재시작 안내, 이전 행을 새 페이지와 혼합하지 않음 | 처음부터 보기 |
| 미분석/대기/실패 | 유효 현재 결과 없음 | score/권고 —, 분석 상태에 실제 상태. 미분석과 처리 실패를 구분 | 상세 분석 흐름 사용 |
| PARTIAL | 규칙만 유효 결과 | score/권고 표시+`부분 완료` 및 `규칙만` 설명 | 상세 근거 확인 |
| 이전 입력 | 대표 revision/company 입력 변경 | 현재 score —·`재분석 필요`; 현재 결정 미결정·`이전 결정 있음` | 기존 상세 이력 확인·권한에 따른 재분석/결정 |
| 취소/마감 | 명시 status 조회 결과 | 단계 유지+취소/정정 event, 기한과 실제 상태 표시 | 원문/상세 확인 |
| early | includeEarly true+early stage | 단계·예정/의견마감 정밀도. 입찰 참여 가능 BID로 포장하지 않음 | 상세 확인 |
| 미분류/낮은 관련성 | 관련성 상태가 미분류/낮음 | 행 보존. 미분류/확인 필요 라벨, SI·AI OFF로 숨겨진 행 복원 같은 표현 없음 | 검색·분야/정렬 변경 |
| demo/출처 미확인 | 가상 데이터 또는 family 결측 | 독립 DEMO와 필요한 경우 `출처 미확인` | 툴팁/상세 확인 |
| 출처 대화상자 로딩/오류/없음 | 안전한 사본 조회 | Skeleton / `출처 정보를 불러오지 못했습니다`+재시도 / `추가 출처가 없습니다` | 재시도·닫기; 기존 목록 유지 |
| 권한 없음 | 업무 context/관리자 접근 거부 | 기존 인증/조직 상태/403 흐름. 비ADMIN에게 수집 실행 버튼 없음 | 허용된 업무 화면 이동 |

## 7. 데이터 DTO와 구현 연결

API 계약의 zod 정본은 서버 도메인에 두고 클라이언트는 타입만 가져온다. 구현 중 확정한 최소 DTO를 우선 사용하고 아래 의미 모델을 명시적으로 매핑한다. 원본 객체를 클라이언트에 통째로 보내지 않는다.

**2026-10-21 구현 담당자의 최소 계약:** `OpportunityItem`은 `id`(opportunity), `bidId`, `revisionId`, `source`, `sourceFamily`, `sources:[{sourceFamily,source,url}]`, `noticeId`, `title`, `agency`, `agencyId`, `companyId`, `stage`, `status`, `budgetKrw`, `publishedAt`, `deadlineAt`, `isDemo`, `firstSeenAt`, `categories`, `relevanceState`, `relevanceScore`, `sourceCount`, `latestAnalysis`, `latestDecision`, `latestDecisionAt`을 제공한다. `latestAnalysis`는 null 또는 `{id,status,solScore,recommendation}`이다. summary는 `generatedAt,origin,isDemo,newlyDiscovered,pendingAnalysis,bidRecommended,closingSoon,portfolio:{BID,WATCH,NO_BID,PENDING},knownBudgetKrw,unknownBudgetCount,totalOpportunities,potentialDuplicateCount,earlyCount`다. safe source summary는 별도 API에서 10서비스/4계열을 제공한다.

이에 따라 `representativeBidId=bidId`, `representativeRevisionId=revisionId`, `primarySource=sourceFamily`, `sourceRecordCount=sourceCount`로 어댑터를 둔다. 숫자 KPI는 summary의 해당 count에 직접 매핑한다. reviewItems/earlyItems는 `/opportunities` 동일 필터·limit=5로 별도 읽는다. source-summary의 4계열에서 수집 KPI를 가져온다. 예산 합계가 전체 한 값만 있으면 포트폴리오 하단에 **확인 예산 {knownBudgetKrw} · 예산 미확인 {unknownBudgetCount}건**을 한 번만 보이고 권고별 금액은 만들지 않는다.

최소 계약에서 제공하지 않는 기능의 처리도 고정한다. `latestAnalysis`/`latestDecision`은 서버가 현재 대표 입력·org에 유효한 값만 반환해야 한다. stale 메타가 없으면 `이전 결정 있음`·`재분석 필요`를 추측하지 않는다. source 사본에 bidId가 없으면 추가 출처 Dialog는 안전한 공식 원문 링크만 제공하고 각 사본의 내부 상세 ID를 합성하지 않는다. 시각 정밀도/종류·예산 종류가 없으면 정규화 단계에서 확인된 `deadlineAt`/`budgetKrw`만 표시하고, 검증되지 않은 예정일을 timestamp로 만들지 않는다. 부분별 readStatus가 없으면 기존 route error boundary가 담당하며 임의의 0/null 성공 응답으로 바꾸지 않는다. 아래 확장 필드는 해당 상태를 구현할 때만 계약에 더하며 현재 DTO에 존재한다고 가정하지 않는다.

| DTO | 필요한 값·의미 |
|---|---|
| OpportunityListQuery | 기존 스펙 §9의 q, sourceFamily[], agencyId[], providerCompanyId[], stage[], status[], recommendation[], category[], decision[], siAiFirst, includeEarly, origin, sort, cursor, limit. 대시보드 링크에 필요한 deadlineFrom/deadlineTo와 asOf/snapshot 조건을 동일 query 정본에 추가/지원 |
| 목록 envelope | items, totalCount, loadedCount 또는 pageInfo, nextCursor/hasNext, generatedAt/asOf, origin, scope/scopeKey, identityVersion/classifierVersion. facetCount는 선택적 서버 집계. totalCount가 없으면 UI에서 전체 건수를 지어내지 않음 |
| opportunity 행 | opportunityId, representativeBidId/revisionId, analysisTargetBidId/revisionId, title, primarySource nullable, sourceFamilies[], sourceRecordCount, origin/isDemo, agency{id,name,type} nullable, providerCompany{id,name,observationStatus} nullable |
| 공고 내용 | stage, status, events[], categories[], relevanceState, budgetKrw nullable(숫자 문자열), budgetKind/unit, publishedAt/firstSeenAt, deadlineAt nullable, deadlinePrecision, deadlineKind, plannedDate/month, participationStatus. 원 데이터가 날짜/월이면 가짜 UTC timestamp로 바꾸지 않음 |
| 분석·결정 | currentAnalysis nullable, currentResult nullable, validity/currentInputMatch, staleReason, previousAnalysisExists, currentReview nullable, previousReviewExists, documentsStatus. 현재·이력 구분은 서버 판정이며 다른 org 분석은 포함하지 않음 |
| 정합성 | sourceConflict{fields[],reasonCode} nullable, duplicateCandidateCount/identityState. 후보를 확정 사본 수에 포함하지 않음 |
| 대시보드 envelope | generatedAt/asOf·origin·runMode·scope·정의별 count와 readStatus, 분석 대기 세부 상태 counts, source freshness n/m, reviewItems(최대5)+전체 count, earlyItems(최대5)+별도 scope, portfolio partition counts/부분분석/예산종류별 합계/미확인 수 |
| source summary | 4 family의 displayName, configured/active/approved/fresh/error/unverified service counts, lastCompleteSuccessAt nullable, publicState, 서비스별 안전한 name/status/lastSuccessAt. mode별 외부 호출 가능 여부와 예시 적재 상태 분리 |
| 출처 사본 (확장 시) | bidId/revisionId, family/service displayName, agency, noticeNo, stage/status/events, lastSyncedAt, isRepresentative, 안전한 official sourceUrl. 최소 계약에서는 sources[].source/url과 family만 표시. raw payload/인증/관리자 오류 제외 |

집계·검토목록·전체 보기의 scope와 snapshot을 서버가 함께 내려야 한다. UI는 20개 행으로 KPI/포트폴리오/출처 facet을 계산하지 않는다. source health summary GET은 외부 탐침·수집 enqueue를 하지 않는다. 같은 snapshot의 집계 일부가 실패한 경우 0으로 대체하지 않고 블록 단위 readStatus를 전달한다.

| 실제 파일 | 구현 책임 |
|---|---|
| `web/app/(app)/(work)/dashboard/page.tsx` | requireWork, 서버 단일 기준시각/집계 읽기, AppPage dashboard scale 유지, actions 전달 |
| `dashboard/dashboard-queries.ts` | review/early와 전체 보기의 동일 query 정본·scope. 기존 점수순 BID/마감 표 전용 조건을 새 패널 조건으로 교체 |
| `dashboard/dashboard-view.tsx` | KPI5, container 기반 2×2, 검토/early 반복 행, source4행, 포트폴리오. 화면에서 데이터 계산·요청하지 않음 |
| `dashboard/loading.tsx`, `dashboard/error.tsx` | 최종 패널4개 구조와 같은 로딩 크기/+3px, 기존 WorkError retry 유지 |
| `web/app/(app)/(work)/bids/page.tsx`, `list-query.ts` | opportunity query parsing·서버 첫 페이지/전체 count. legacy API DTO와 혼합하지 않음 |
| `bids/bid-list-view.tsx`, `bid-list-more.tsx` | URL/transition, total/loaded 상태 안내, 새 endpoint keyset 더 보기·포커스 |
| `web/components/bids/bid-filters.tsx` | 빠른 조건+상세 필터, 같은 URL 값, early 상호작용·origin 라벨·명시 정렬 |
| `web/components/bids/bid-table.tsx` | 11열 opportunity 표현과 전용 scroll region. 기존 BidListItem 소비자를 조용히 깨지 않도록 별도 OpportunityTable export 또는 명시적 row adapter 사용; 임의 legacy cast 금지 |
| `web/components/bids/status-badge.tsx`, `labels.ts` | sibling SourceBadge와 family label, 기존 StatusBadge/DemoBadge 재사용 |
| `web/components/bids/format.ts`, `source-link.tsx`, `external-url.ts` | 기존 금액/KST 재사용, 정밀도/금액 종류의 별도 표현, 새 공식 도메인의 검증된 allowlist 적용 |
| `web/components/bids/opportunity-sources-dialog.tsx` (신규, 도메인 UI) | dashboard와 목록 양쪽에서 사용하는 원본 출처 Dialog. generic ui primitive 생성 없음 |
| `web/components/ui/table.tsx` | 필요하면 실제 scroll wrapper에 focus/ARIA props 전달. 전역 typography/열폭 변경 없음 |
| `web/app/(app)/(work)/bids/[id]/back-href.ts` | 새 목록 조건을 검증하는 안전한 복귀. 상세 ID·분석·review 쓰기 계약은 유지 |
| `web/server/opportunities/`, `app/api/v1/opportunities/route.ts` | 서버 필터/순서/null/keyset/count·대표/분석 대상 계약. 컴포넌트가 repo를 import하지 않음 |
| `app/api/v1/dashboard/opportunity-summary/route.ts`, `app/api/v1/ingestion/source-summary/route.ts` | 안전한 summary 읽기; 전체 집계는 DB에서. RLS 사용자 세션 유지 |
| 기존 `/admin/ingestion` | ADMIN 연결 대상. 서비스 통계/실행 이력은 승인 스펙 §12 계약을 따르며 이 문서는 그 화면의 별도 상세 재설계나 권한 확대를 추가하지 않음 |

## 8. 접근성과 구현 검증 기준

- AppPage가 그리는 `main#main-content`와 h1 하나를 유지한다. 카드 h2 → 필요한 하위 h3 순서, table caption/col scope를 제공한다. 새 main 중첩 없음.
- DOM/Tab 순서는 제목 actions → 빠른 조건 → 필터 → 결과 안내 → 스크롤 영역 → 제목/출처 버튼 → 더 보기다. 카드 전체 클릭·행 전체 클릭은 추가하지 않는다.
- 모든 Switch에 연결된 label, 필터의 보이는 FieldLabel, 복수 선택에 aria-pressed/checkbox 상태를 준다. Enter/Space로 조작 가능하며 마우스 hover tooltip만으로 필수 내용을 전달하지 않는다.
- 실제 표 스크롤 영역은 키보드로 가로 이동 가능하고, 내부 링크 focus가 보이도록 브라우저 scrollIntoView가 동작한다. 페이지 전체가 가로 이동하지 않는다. 초점 링을 overflow로 잘라내지 않는다.
- Dialog 열기 전 trigger를 기억하고 닫으면 복귀한다. Escape 닫기·focus trap·화면 내 높이/내부 스크롤은 기존 Dialog 규칙을 유지한다. 제목/설명 접근성 연결을 둔다.
- 결과 변경은 status 한 곳에서만 알린다. 중복 toast/live region 금지. 로딩은 aria-busy, Skeleton은 aria-hidden으로 묶는다. 더 보기 뒤 새 첫 제목으로 이동하고, 조회 실패 시 현재 focus/행을 보존한다.
- 상태는 icon+text+기존 상태색, 출처는 명시적 글자, DEMO는 별도 표시다. 금액·점수 0과 null을 구분한다. 긴 제목/기관·다중 출처·부분 분석·출처 충돌에서도 텍스트가 겹치지 않는다.
- 링크/버튼은 기존 `focus-visible:ring-3 focus-visible:ring-ring/50`을 사용한다. 흰 바탕에서 기존 토큰 WCAG AA 대비를 유지한다. 새 색·gradient·큰 그림자·장식 움직임 없음. 기존 spinner도 reduced-motion을 따른다.
- 구현 검증은 ADR-046에 맞춰 1440에서 변경 사용자 흐름, 1280에서 배치/넘침을 확인한다. 대표 데이터 한 화면에 LH/K-water/긴기관명/0/null/PARTIAL/DEMO/다중 출처를 배치해 배지 중앙 정렬·11열 스크롤을 확인한다. 새 전수 조합 시험을 만들지 않는다.

## 9. 계약상 확인할 항목

승인된 시각 방향·2열/세로 배치·표 스크롤에는 추가 디자인 승인이 필요하지 않다. 다음 항목은 구현자가 백엔드 계약과 함께 고정해야 하며, 없는 데이터를 UI가 추측해서 채우는 근거가 아니다.

1. **같은 scope의 전체 보기:** summary 기준시각을 목록이 재현할 asOf/snapshot 계약, 정확한 COUNT, early만 보는 stage 배열을 보장한다. API에 없는 필터로 가짜 링크를 만들지 않는다. KPI는 링크가 아니므로 신규발견/분석대기 전용 검색 파라미터를 이 UI를 위해 추가할 필요는 없다.
2. **현재 분석과 사람 결정:** 유효 currentResult와 latest run, 이전 review 존재를 DTO에서 분리한다. 대표 bid와 분석 대상 bid가 다를 때 목록 제목은 대표 상세, 분석/이력 링크는 서버가 준 정확한 대상이다. 타 출처의 점수·결정을 대표 공고에 복사하지 않는다.
3. **안전한 소스 상태:** 4행의 source-summary는 일반 업무 구성원용 필드만, API 상세 인증/오류는 ADMIN 서비스 API에만 둔다. 미확인 키를 `미발급`으로 표기하지 않는다. KEPCO 발급 사실만으로 `인증 완료`가 되지 않는다.
4. **수집 상태 및 예산 합계:** freshness의 서버 정책/활성·승인 분모와 금액 종류별 집계 정의를 먼저 확정한다. 정의가 없으면 수집 상태 `확인 전`, 예산 합계 `금액 기준 확인 필요`로 렌더링한다.

## 관련 문서

- [승인 스펙](../../polaris/specs/in-progress/2026-10-21-public-procurement-expansion.md)
- [[2026-10-21-public-procurement-expansion-plan|구현 계획 I6]]
- [[06-UI-UX|화면 정본]]
- [[05-API-SPEC|읽기·결정 API]]
- [[09-SECURITY|권한·고지]]
- [[17-CLAUDE-IMPLEMENTATION|검증 정책]]
