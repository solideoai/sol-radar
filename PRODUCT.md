# Product

<!-- impeccable:product-schema 1 -->

이 파일은 impeccable 스킬이 읽는 제품 요약이다. 정본은 `docs/` 설계 문서이고, 여기에는 요약과 링크만 둔다(정본을 두 벌 만들지 않는다 — 2026-10-16 사용자 결정). 내용이 어긋나면 `docs/` 를 따르고 이 파일을 고친다.

작성 방식: 2026-10-16 랜딩 재설계 작업에서 하위 에이전트가 사용자에게 직접 물을 수단 없이 썼다. 사용자 요청 원문과 설계 문서에서만 옮겼고, 추론한 것은 "(가정)"으로 표시했다.

## Platform

web

## Users

- **주 사용자**: 공공 SI·AX 기업의 영업·사업기획·입찰 담당자. 공고(발주계획·사전규격·입찰공고)를 훑어 "우리 회사가 이 입찰에 들어가야 하는가"를 정한다. 역할은 ADMIN·SALES·ANALYST·VIEWER 이고 최종 결정은 ADMIN·SALES 가 기록한다. → `docs/01-PRD.md` 사용자 및 권한
- **지금 가장 중요한 독자**: 회사 해커톤 심사위원(사람 5인 + AI 심사). 사람 심사위원은 연령대가 있고, 화려함보다 큰 글자와 공공 SI 회사의 누구나 쓸 수 있는 화면을 기대한다(2026-10-16 사용자 발언). 심사는 데스크톱 브라우저 한 대(프로젝터 가능성 있음)에서 본다. → `docs/18-HACKATHON.md`, `docs/19-DEMO-SCENARIO.md`

## Product Purpose

공고를 모으고 변경을 추적하며, 회사 프로필(기술·자격·실적·인력)과 공고 요구조건을 대조해 필수 자격 판정(충족·미충족·확인 필요)과 원문 근거, 결정론적 SOL Score(0~100), BID·WATCH·NO-BID **권고**를 낸다. 최종 참여 결정은 사람이 사유와 함께 기록한다. 성공은 담당자가 공고 1건 검토를 근거와 함께 빨리 끝내는 것이다(목표 수치는 가설). → `docs/00-README.md` 10줄 요약, `docs/01-PRD.md` 성공 측정

## Positioning

일반 입찰정보 서비스가 수집·검색·알림에서 멈추는 지점에서 시작한다: **우리 회사 기준 자격 판정 + 원문 인용 + 분해 가능한 점수 + 사람 결정 기록**. 수주 확률을 지어내지 않는 "정직한 AI"가 차별점이다. → `docs/18-HACKATHON.md` §3.2 D1~D5

## Operating Context

- 데스크톱 전용, 1280~1920px, 확인 폭 1440·1280px. 모바일 레이아웃·앱·결제는 영구 범위 외. → `docs/16-DECISIONS.md` ADR-007
- 사용 회사는 솔리데오로 고정한다. 회사명·부서·직급만 실제이고 직원 200명·사진·자격·실적·재무는 가상이다. 공고는 가상 fixture 20건이고 화면에 DEMO 표시를 단다. → `docs/16-DECISIONS.md` ADR-019, `docs/18-HACKATHON.md` §7, `docs/19-DEMO-SCENARIO.md`
- 2026-10-16 현재 제품 기능은 구현 전이다(Phase 0 전). 첫 화면은 계정 만들기·로그인만 실제로 동작한다. → `docs/PROGRESS.md`

## Capabilities and Constraints

- 용어: SOL Score(사업 적합도, 수주 확률 아님), 권고(BID·WATCH·NO-BID), 담당자 결정, 원문 인용, revision, PARTIAL. → `docs/20-GLOSSARY.md`
- 화면 문구 원칙: 점수 옆 "수주 확률이 아닙니다", 권고는 "권고", 최종 결정은 "담당자". 고지 문구 원문은 `docs/09-SECURITY.md` 책임 있는 AI 절.
- 상태는 아이콘 + 글자 + 색을 함께 쓴다. → `docs/06-UI-UX.md` §3.2
- 색·글꼴·글자 눈금의 정본은 `design/tokens.json` 하나다(`design-system` 스킬).

## Brand Commitments

- 제품 이름은 "SOL RADAR". "SOL" 의 뜻은 문서에 적혀 있지 않다(가정: 사용 회사 솔리데오에서 왔을 수 있다). 확인 전에는 뜻을 해석해 표지에 넣지 않는다. 특히 "해"로 읽어 빛살을 그리지 않는다 — 욱일기 연상 위험.
- 글꼴 Pretendard, 바탕 흰색, 주요 버튼 남색(`primary`), 브랜드 색 파랑(`brand`). → `design/tokens.json`
- 레퍼런스(사용자 승인, 2026-10-16): 구조와 태도는 Ramp, 글자 크기는 Airtable, 흑백 절제는 Midday 참고. Deel·Mercury·Apollo·Lightdash 같은 화려한 방향은 제외. 문구·배치·로고를 베끼지 않는다. → `.claude/agents/landing-art-director.md`
- 첫 랜딩이 "AI 로 만든 티가 나고 밋밋하다"는 평가를 받았다(2026-10-16). AI 티는 해커톤 실격 사유로 본다.

## Evidence on Hand

- 실제 고객·후기·사용자 수·성과 수치·보안 인증·수주 실적은 **없다**. 지어내지 않는다.
- 가진 것: 설계 문서 vault(`docs/`), 결정 정책과 점수 계산 규칙(`docs/08-SCORING.md`), 랜딩용 가상 공고 3건(`web/components/landing/demo-bids.ts`, 기관 이름이 "가상"으로 시작), 테스트·스크린샷 증거(`docs/evidence/`).
- 공공조달 규모 통계는 출처와 함께 검증돼 있다(`docs/18-HACKATHON.md` §2.1). 그 밖의 시장 수치는 미검증이다.

## Product Principles

1. 규칙이 판정하고 AI 는 돕는다. AI 의견이 규칙 판정을 뒤집지 않는다.
2. 근거 없는 값을 만들지 않는다. 모르면 "확인 필요"로 남긴다.
3. 점수는 적합도다. 수주 확률로 말하지 않는다.
4. 사람이 최종 결정하고 사유가 남는다.
5. 가상 데이터와 만들지 않은 기능을 실제처럼 보이지 않는다.

## Accessibility & Inclusion

- WCAG 2.1 AA, 키보드 조작, 색만으로 의미 전달 금지, `prefers-reduced-motion` 존중. → `docs/06-UI-UX.md` §10
- 랜딩은 연령대가 있는 심사위원 기준으로 본문 16px 이상·설명문 18px 이상·캡션 13px 이상, 본문 대비 7:1 목표(2026-10-16 사용자 결정, `.claude/agents/landing-art-director.md` 가독성 바닥). 로그인 뒤 앱 화면의 밀도 기준(`docs/06-UI-UX.md` §3.3)과는 따로 정한다(가정: 앱 화면까지 키울지는 사용자가 정한다).
