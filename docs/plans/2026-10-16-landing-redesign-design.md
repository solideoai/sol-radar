---
title: "아트 디렉션 — SOL RADAR 첫 화면 재설계"
doc: "design-landing-redesign"
status: done
tags:
  - sol-radar
  - ui
  - hackathon
updated: 2026-10-19
---

# 아트 디렉션: SOL RADAR 첫 화면(랜딩)·머리말·바닥글·로고

> [!success] 보관 (2026-10-19)
> 이 설계안은 정본에 반영됐다(근거: 구현 계획 [[2026-10-16-landing-redesign|랜딩 재설계 구현 계획]]으로 구현됨 — 커밋 `fdd57b0` 아트 디렉션·계획 추가, `6e7cac3`~`1a6a575` 구현, [[PROGRESS|진행 상황]] 작업 로그 2026-10-16 "랜딩 재설계" 행, 증거 `evidence/landing/20261016-redesign-*`). 수정하지 않고 보관한다.

> [!success] 승인됨 (2026-10-16)
> 사용자가 이 문서 전체를 승인했다. 사용자 결정 U1~U4 와 메인 세션 결정 M1~M7 을 반영했다. 구현은 별도 구현 계획을 따른다.

작성: `landing-art-director` 에이전트(2026-10-16). 사용자에게 직접 물을 수단이 없어 사용자 요청 원문과 설계 문서에서만 추론했고, 추론한 것은 "(가정)"으로 적었다. 제품 요약은 저장소 루트 `PRODUCT.md`(impeccable 용, `docs/` 를 요약·링크만 한다).

시안 파일(저장소 밖, 이 세션의 임시 폴더 `…/scratchpad/art/`):

| 무엇 | 경로 |
|---|---|
| 방향 목업(1440·1280, 전체 페이지) | `art/mockup/landing.html`, `landing-1440-view.png`, `landing-1440-full.png`, `landing-1280-view.png`, `landing-1280-full.png`, `board.png`, `board-1280.png` |
| 로고 시안 3안 | `art/logo/{a,b,c}-mark.svg`·`-mark-mono.svg`·`-mark-white.svg`·`-lockup.svg`·`-lockup-mono.svg`·`-lockup-white.svg`, `a-favicon.svg` |
| 로고 비교 한 장 | `art/logo/preview.html`, `preview.png`(1440), `preview@2x.png`, `zoom-a.png` |
| 레퍼런스 실측 | `art/ref/ramp-full.png`, `art/ref/airtable-full.png`, 측정 스크립트 `art/probe/measure.cjs` |

임시 폴더는 세션이 끝나면 사라질 수 있다. 구현에 꼭 필요한 값(눈금·색·로고 좌표)은 모두 이 문서 안에 옮겨 적었다.

## 의도와 이유

2026-10-16 첫 랜딩은 "AI 로 만든 티가 나고 밋밋하다"는 평가를 받았다. 회사 해커톤 대상이 목표라 AI 티는 실격 사유다. 사람 심사위원은 연령대가 있어 화려함보다 **큰 글자**와 공공 SI 회사의 **누구나 쓸 수 있는** 화면을 기대한다. 로고와 로고 옆 글자도 고친다.

이번 재설계는 "다듬기"가 아니라 "갈아 끼우기"다. 제품의 사실·문구 원칙·기능·정직성 규칙([[2026-10-16-landing-page|이전 랜딩 계획]] Global Constraints)은 그대로 두고, 지금의 생김새(회색 바탕 + 흰 카드 + 아이콘 칩 + 작은 머리글)는 근거로만 쓰고 버린다.

## 목표 · 하지 않을 것 · 실패로 보는 것

**목표**

1. 첫 화면 한 장으로 "무엇을 하는 제품인지"와 "어떻게 판단하는지(근거가 붙은 판단, 담당자 결정)"가 읽힌다. 1440×900 첫 화면 안에 제목·설명·버튼과 함께 제품 화면의 SOL Score 와 "수주 확률이 아닙니다"가 보인다.
2. 랜딩의 모든 글자가 가독성 바닥을 넘는다: 본문 16px·설명 18px 이상, 라벨·메뉴 15px 이상(메뉴 17px), 캡션·배지 13px 이상(12px 0개), 버튼 높이 44~56px·글자 17px.
3. 구역마다 구성의 이유가 다르다(표, 줄, 단계 띠, 원칙 격자, 질문 목록, 권유 띠). 같은 상자 반복이 페이지 뼈대가 아니다.
4. 로고가 이 제품만의 이유를 담고, 16px 파비콘부터 바닥글 흰색까지 한 벌로 성립한다.

**하지 않을 것**

- 결제·요금제·모바일(1280px 미만) 화면, 새 의존성, 스크롤 연출 추가(기존 `reveal.tsx` 는 유지), 사진·일러스트·3D·그라데이션·유리 효과.
- 지어낸 수치·고객 로고·후기·성과, 구현되지 않은 기능을 쓸 수 있는 것처럼 쓰기.
- 레퍼런스의 문구·배치·로고 복사. 강조색은 Ramp 의 형광 노랑이 아니라 우리 `brand` 파랑.

**실패로 보는 것**

- 제목 위 작은 머리글(eyebrow)이 하나라도 남는다.
- 판 안의 글자가 읽히지 않아 "그림"이 된다(13px 미만, 대비 4.5:1 미만).
- 한글이 낱말 중간에서 줄바꿈된다("요구사/항").
- 첫 화면에 "수주 확률"로 읽힐 표현이 있거나, 권고가 "결정"처럼 보인다.
- 아이콘 칩 + 제목 + 설명 카드가 다시 생긴다.

## 제약 (설계 문서·토큰·데스크톱 전용·문구 원칙)

| 출처 | 제약 |
|---|---|
| [[16-DECISIONS\|ADR-007]], [[06-UI-UX\|06]] §1 | 데스크톱 1280~1920px. 확인 폭 1440·1280. 1280 미만은 `DesktopNotice` 한 줄만 |
| [[06-UI-UX\|06]] §3.2·§10 | 상태는 아이콘 + 글자 + 색. WCAG 2.1 AA, 키보드, `prefers-reduced-motion` |
| [[09-SECURITY\|09]] 책임 있는 AI | 점수 옆 "수주 확률이 아닙니다", BID·WATCH·NO-BID 는 "권고", 최종 결정은 "담당자". DEMO(예시 데이터) 표시 |
| [[2026-10-16-landing-page\|이전 계획]] Global Constraints | "예시 데이터" 배지, 기관 이름 `가상 ` 시작, 원문 자리는 링크 아님, 기능마다 "개발 예정", 히어로·기능·CTA 의 "MVP 개발 중" 안내, `href="#"` 금지, 반응 없는 버튼 금지 |
| `design-system` 스킬 | 색·글꼴·눈금은 `design/tokens.json` 만. 화면 코드에 hex·rgba·기본 팔레트 금지(`check:colors`). `globals.css` 는 생성물. 주요 버튼(`default`)은 화면에 하나 |
| 사용자 결정(2026-10-16) | 레퍼런스 주 Ramp·글자 크기 Airtable. `reveal.tsx` 유지. 가독성 바닥(에이전트 정의 표) |

## 진단 (현재 화면 — 근거)

> [!warning] 진단 방식
> impeccable `critique` 의 기준(설계 특이성, Nielsen 휴리스틱, 인지 부하, AI 티 목록)으로 한 맥락에서 평가했다. 설계 평가(A)와 검출기(B)를 별도 하위 에이전트로 나누지 않았다(단일 맥락). 검출기 `impeccable detect` 는 현재 랜딩 코드(`web/components/landing`·`logo.tsx`·`site-header.tsx`·`site-footer.tsx`)에서 **0건**이다 — 정적 규칙에 걸리지 않고, 문제는 구성·위계·크기다.

근거 스크린샷: `docs/evidence/landing/20261016-landing-reveal-scrolled-1440.png`(전체, 1440×5792), `…-1280.png`, `20261016-landing-loaded-1440.png`. 아래 y 값은 1440 전체 스크린샷 기준이다.

**설계 특이성 판정**: 낮음. 제품 미리보기(가상 공고 3건 + 분석)는 이 제품만의 것이지만, 나머지 구역은 제목만 바꾸면 어느 B2B SaaS 에도 들어간다(머리글 + 제목 + 오른쪽 카드).

| 휴리스틱(0~4) | 점수 | 근거 |
|---|---|---|
| 현실과 맞는 말 | 3 | 문구는 공공 SI 말투를 따른다 |
| 일관성 | 3 | 토큰·부품은 일관된다 |
| 미니멀·심미 | 1 | 같은 구성(머리글·제목·카드)이 5번 반복, 판 안 상자 7개 |
| 인식(기억 부담) | 2 | FAQ 답이 닫혀 있어 핵심 고지("수주 확률 아님")를 눌러야 본다 |
| 그 밖(상태 표시·오류 예방 등) | n/a | 랜딩은 Persuade 화면 |

**문제 목록(심각도 P0 높음 → P3 낮음)**

| # | 문제 | 근거 | 레퍼런스는 어떻게 푸는가 |
|---|---|---|---|
| P0 | 글자가 심사위원 기준보다 작다. 판 안 라벨·기관명·점수 고지·figcaption 이 12px(`type-caption`), 메뉴 13px, 본문 14px | `product-preview.tsx:28,63,81,83,98,130,156,169,182,195,226`, `feature-previews.tsx` 12곳, `how-it-works-section.tsx:46,50`, `site-header.tsx:31`(sm 버튼 13px), 스크린샷 y 600~1440 | Airtable(이전 방문 `scratchpad/sites/airtable-0.png`) 메뉴 약 17px·버튼 54~56px. Ramp 히어로 버튼 52px·본문 16px |
| P0 | 제목 위 머리글(eyebrow) 6곳 — 금지 목록 1번 | `hero.tsx:15`, `section-heading.tsx:19` 를 쓰는 `problem:33`·`features:75`·`how-it-works:33`·`principles:37`·`faq:42`. 스크린샷 y 154·644·1205·1490·2143·2715 | Ramp·Airtable 모두 히어로 제목 위에 라벨이 없다(Ramp 의 실시간 숫자 띠는 제품 데이터이지 라벨이 아니다) |
| P1 | 아이콘 칩 + 제목 + 설명 카드가 뼈대. 구역마다 "왼쪽 제목 + 오른쪽 카드" 반복 | `icon-chip.tsx`, `problem-section.tsx:38-50`, `features-section.tsx:91-104`, `principles-section.tsx:45-53`, `faq-section.tsx:40-53`. 스크린샷 y 635·1420·2135·2700 에서 같은 좌우 구성 | Ramp 는 구역마다 구성이 다르다: 넓은 판, 중앙 문장, 제품 화면 격자, 인용 + 화면 |
| P1 | 판 안에 테두리 상자가 겹친다(창 → 사실 상자·점수 카드·권고 카드·자격 카드·근거 카드 2·원문 점선 상자) — 카드 속 카드 | `product-preview.tsx:103,139,165,179,206,224`. 스크린샷 y 727~1390 | Ramp·Airtable 의 제품 판은 선과 여백으로 나눈다. Airtable 표는 줄 구분선만 |
| P1 | 회색 바탕(`bg-muted/50`) 위 흰 카드라 첫인상이 흐리다. 대비가 낮은 회색 글자(`muted-foreground` #5E6978, 흰 바탕 5.57:1)가 설명문 전체에 쓰인다 | `page.tsx:39`, `hero.tsx:22`. 측정: #5E6978/#FFFFFF 5.57, /#F2F4F6 5.06 | Ramp 는 흰 바탕 + 회색 무대 + 흰 창. 본문 대비 목표 7:1(가독성 바닥) |
| P1 | 로고가 기성 아이콘(lucide `RadarIcon`) + 둥근 사각형 + 본문 글꼴 14px — 금지 목록 그대로 | `logo.tsx:15-28`, `art/logo/current-header.png` | Ramp 는 워드마크가 주인공, 기호는 작게. 둘 다 직접 그린 글자 |
| P2 | 히어로 버튼 아래 가운뎃점 약속 줄("공식 API 기반 수집 · …")은 히어로 템플릿의 배지 줄이고, 아직 없는 기능(공식 API 수집)을 첫 화면에서 약속한다 | `hero.tsx:40-47` | Ramp·Airtable 히어로는 제목·설명·버튼·판뿐이다 |
| P2 | 핵심 고지가 FAQ 아코디언 안에 닫혀 있다 | `faq-section.tsx:45-52` | Midday 는 문장으로 설명한 카드를 펼쳐 둔다 |
| P2 | 한글이 낱말 중간에서 줄바꿈될 수 있다(`word-break` 미지정). 목업에서 "요구사/항", "수주 확률/이" 재현 | 전역 CSS 에 `keep-all` 없음 | — |
| P3 | 머리말이 반투명 + 흐림(`bg-background/95 backdrop-blur-sm`) — 유리 효과의 약한 형태 | `site-header.tsx:10` | Ramp·Airtable 머리말은 단색 흰 바탕 |
| P3 | "1단계·2단계" 를 파란 글자로, 구역 머리글을 파란 글자로 써서 파랑이 장식이 됐다 | `how-it-works-section.tsx:42`, `section-heading.tsx:19` | Ramp 는 강조색을 행동(버튼)에만 쓴다 |

**레퍼런스 실측(2026-10-16, 1440×900, `art/probe/measure.cjs`)**

| 사이트 | 머리말 | 메뉴 | 머리말 버튼 | 히어로 제목 | 히어로 버튼 | 구역 제목 |
|---|---|---|---|---|---|---|
| Ramp | 띠 포함 102px | 14px/400 | 34px | 64/64px, 400(Lausanne), 왼쪽 정렬, 왼쪽 여백 64px | 52px, 16px | 28~48px |
| Airtable(오늘) | 띠 포함 103px | 14px/550 | 37px | 58.5px/550, 가운데 정렬 | 46~48px, 16px | 48px |
| Airtable(이전 방문 `scratchpad/sites/airtable-0.png`, 잉크 높이로 역산) | — | 약 17px(대문자 12px) | 55px | 약 43px(대문자 30px), 가운데 정렬 | 56px | — |

Airtable 은 오늘 다시 열었을 때 첫 화면이 바뀌어 있었다(A/B 시험으로 보인다). 사용자가 승인한 글자 크기 기준은 이전 방문 화면이고, 이 문서의 메뉴 17px·버튼 56px 도 그것을 따른다.

**잘하고 있는 것(유지)**: 가상 공고 3건과 목록 → 분석 전환(키보드 포함), 권고를 규칙 함수로 계산하는 구조(`analysis.ts`), 정직성 문구, 1280px 넘침 0, 움직임 줄이기 대응.

## 방향 선언

**"근거가 붙은 판단 화면을, 공공 문서처럼 정확하고 크게 보인다."** 흰 바탕, 굵은 검정 Pretendard 제목, 왼쪽 정렬. 제목 바로 아래 넓은 회색 무대 위에 실제 크기의 공고 분석 화면 한 장을 놓는다 — 자격 항목마다 공고문 인용(「…」), 점수 옆 "수주 확률이 아닙니다", 맨 끝 "담당자 결정 대기". 나머지 구역은 공공 SI 사람이 매일 읽는 형식(비교표, 단계 띠, 원칙 목록, 질문과 답)으로 짜고 카드를 쓰지 않는다. 화려함은 크기 대비(64px 제목 ↔ 18px 본문)와 내용의 구체성에서 나오고, 색은 상태 색과 파랑 하나만 쓴다. 로고는 공공 문서의 인용 부호 낫표 「 」 로 근거를 감싼 점이다 — 화면 속 인용 표시와 같은 모양이라 표지와 제품이 한 문법이 된다.

방향 계약(impeccable new-work 의 여섯 칸. 구현 코드·화면에 옮겨 적지 않는다):

| 칸 | 내용 |
|---|---|
| THESIS | 이 첫 화면은 "AI 가 판단해 준다"가 아니라 "판단마다 원문 근거가 붙고 결정은 사람이 한다"를 화면 한 장으로 증명한다. 거부하는 기본값: 머리글 + 제목 + 아이콘 카드 격자의 SaaS 랜딩 |
| OWN-WORLD | 흰 바탕(#FFFFFF), 글자 #191F28, 회색 단계 #4E5968(제안)·#E5E8EB 선, 무대 #F2F4F6, 강조 #1B64DA 하나, 상태 색 3개. Pretendard 700 제목(자간 -0.03em), 2px 검정 윗선으로 시작하는 표·띠, 낫표 「」 인용 강조(파랑 8% 바탕), 결재란 모양의 "권고 / 담당자 결정" 두 칸 |
| STORY | 심사위원은 첫 화면에서 무엇인지 알고(제목·설명), 판에서 근거·점수 고지·담당자 결정을 보고 믿고, 시작하기 또는 분석 예시 보기를 누른다. 아래로 내리면 지금 방식과의 비교 → 기능 → 흐름 → 원칙 → 질문 → 권유 순으로 같은 주장을 확인한다 |
| FIRST VIEWPORT | 1440×900: 72px 머리말 / 왼쪽 정렬 64px 두 줄 제목(머리말 아래 40px) / 20px 설명 두 줄 / 56px 버튼 둘(주요 하나) / 안내 한 줄 / 40px 아래 회색 무대 위 3단 창 — 왼쪽 예시 공고 목록, 가운데 공고 제목·자격 검토, 오른쪽 SOL Score 82 와 고지가 접힘선 위에 보인다(1280×800 에서도, U5) |
| FORM | 사용자가 고정한 형식(Ramp 구조 + Airtable 글자 크기)을 따른다. impeccable `concept-seed` 주사위는 돌리지 않았다 — `seed: none (unavailable)`, 사용자 지정 방향 |
| FINISH | 구현 끝에 impeccable `detect`(0건)와 `critique` 한 번으로 마감 검토를 한다. `DESIGN.md` 는 이번 작업에 넣지 않는다(아래 "메인 세션이 정한 것" M4) |

## 글자 눈금 (현재 → 제안, 앱 화면 영향)

**원칙**: 랜딩 전용 역할(`display`·`headline`·`lead`, 현재 랜딩에서만 쓴다 — `grep` 결과 랜딩 밖 사용 0)은 값을 키우고, 랜딩에 필요한 큰 역할 다섯을 **새 이름으로 더한다**. 앱이 쓰는 `title`·`heading`·`body`·`label`·`caption` 은 그대로 둔다 → 로그인 뒤 화면은 바뀌지 않는다.

| 이름 | 현재 | 제안(크기/줄높이 px, 굵기, 자간) | 랜딩에서 쓰는 곳 | 앱 화면 영향 |
|---|---|---|---|---|
| `display` | 56/62 700 | **64/76 700 −0.03em** | 히어로 `h1` | 없음(랜딩만 1곳) |
| `headline` | 36/44 700 | **44/56 700 −0.025em** | 구역 `h2`, 판의 점수 숫자 | 없음(랜딩만) |
| `subhead` 신규 | — | **28/38 700 −0.02em** | 주요 기능 줄의 `h3` | 없음 |
| `heading-lg` 신규 | — | **24/34 600 −0.015em** | 단계·원칙 `h3`, 판의 공고 제목 | 없음 |
| `lead` | 18/28 | **20/32 −0.005em** | 히어로·구역 설명, FAQ 질문(`font-bold`), 비교표 줄 머리(`font-bold`) | 없음(랜딩만) |
| `body-lg` 신규 | — | **18/30** | 랜딩 본문·비교표 칸·FAQ 답·단계 설명 | 없음 |
| `ui-lg` 신규 | — | **17/26** | 메뉴, `lg`·`xl` 버튼, 판 안 주요 글자(요건명·사실 값·탭 제목), 안내 문장, 바닥글 링크 | 없음 |
| `label-lg` 신규 | — | **15/22** | 판 라벨·표 머리·배지(md)·인용·figcaption | 없음 |
| `wordmark` 신규 | — | **20/20 800 +0.02em** | 로고 워드마크 "SOL RADAR"(머리말·바닥글) | 없음(앱 틀은 로고를 쓰지 않는다) |
| `body` | 14/22 | 그대로 | 랜딩의 가장 작은 글자(결재란 칸 이름, ©) — 14px ≥ 13px 바닥 | 그대로 |
| `title`·`heading`·`label`·`caption` | 30·16·13·12 | 그대로 | 랜딩에서 쓰지 않는다(`caption` 12px 은 랜딩 0개) | 그대로 |

- 전역 자간 `tracking: 0em` 은 그대로. 자간은 위 항목에만 `tracking` 으로 적는다.
- 한글 줄바꿈: 랜딩 루트(`main`·머리말·바닥글)에 `break-keep`(word-break: keep-all). 제목은 `text-balance`, 긴 문단은 `text-pretty`.
- 글줄 폭: 설명 `max-w-190`(760px, 20px 기준 한 줄 38~42자), 본문 칸은 칸 폭에 맡긴다(18px, 30~40자).
- 숫자: 점수·금액·날짜는 `tabular-nums`.
- `h2` 에 `<br>` 를 쓰지 않는다. 두 줄은 `max-w-220`(880px) + `text-balance` 로 만든다 — 접근 이름이 "정보를한"처럼 붙는 것을 막는다(시험이 제목 글자로 구역을 찾는다). 히어로 `h1` 의 `<br>` 는 지금처럼 둔다.

**앱(로그인 뒤) 화면에 미치는 영향**: 위 표대로면 없다. 다만 심사위원은 데모 5분 동안 앱 화면(대시보드·공고 상세)도 본다([[18-HACKATHON|18]] §6). 앱의 본문 14px·캡션 12px 은 [[06-UI-UX|06]] §3.3 의 밀도 기준(본문 14/20)과 맞지만 이번 가독성 바닥에는 못 미친다. 앱 글자 크기는 그대로 두고 보조 글자색만 앱에도 적용한다(U2).

## 색

색 전략: **절제(Restrained)** — 무채색 + 강조 하나. 장면: 회의실 프로젝터나 노트북 화면을 여러 사람이 함께 보는 밝은 실내 → 밝은 바탕.

| 쓰임 | 토큰 | 값 | 대비 | 규칙 |
|---|---|---|---|---|
| 페이지 바탕 | `background` | #FFFFFF | — | 랜딩 본문 바탕을 `bg-muted/50` 에서 **흰색으로**(변경 제안 4) |
| 제목·본문 주 글자 | `foreground` | #191F28 | 16.6:1 | 제목·요건명·표 값 |
| 보조 글자(설명·주석) | `muted-foreground` | #5E6978 → **#4E5968 제안** | 5.57 → **7.11:1**(흰), 6.45(무대) | 설명문·라벨·캡션. 바꾸지 않으면 랜딩 설명문은 `text-foreground/80`(약 8.5:1)로 대신한다 |
| 무대·권유 띠 | `muted` | #F2F4F6 | — | 제품 판 무대, 마지막 권유 띠, 판의 목록 칸(`bg-muted/50`) |
| 구분선 | `border` | #E5E8EB | — | 줄 구분. 표·띠의 시작선은 `border-foreground` 2px |
| 결재란·테두리 버튼 | `input` / `foreground` | #D1D6DB / #191F28 | — | 결재란 칸은 `border-input`. 랜딩의 테두리 버튼은 `border-foreground`(흰 바탕 위 1.46:1 인 `border` 대신) |
| 주요 버튼 | `primary` | #191F28 | 16.6:1 | 화면에 하나(히어로·권유의 시작하기) |
| 강조 | `brand` | #1B64DA | 5.41:1 | 아래 다섯 자리**에만**: 로고 점, 판의 선택 막대, 점수 막대, 인용 강조 바탕(`bg-brand/8`), 안내 아이콘(ⓘ)·포커스 링 |
| 상태 | `success`·`warning`·`destructive` | #15803D·#B45309·#A51926 | 5.0·5.0·7.6:1 | 권고·자격 상태만. 흰 바탕(배지 `bg-background`) 위에만 |
| 예시 표시 | `demo` | #7C3AED | 5.70:1 | "예시 데이터" 배지만 |
| 바닥글 | `foreground` 바탕 + `background` 글자 | — | 보조 글자 `text-background/72` 9.1:1 | 로고 흰색 한 벌 |

쓰지 않는 것: 파란 글자 머리글·단계 번호, 문장 속 색 강조, 회색 글자를 연한 바탕에 겹치기(무대 위 글자는 흰 창 안에만), 그라데이션.

## 구역별 구성 (구역마다: 목적 · 구성 · 버리는 것 · 레퍼런스 근거)

공통 틀: 바깥 폭 `max-w-320`(1280px) + 좌우 `px-10`(40px) → 글줄 폭 1200px(1440 기준 좌우 여백 120px, 1280 기준 약 1185px). 구역 사이 위 여백 144px(`pt-36`), 구역 제목 → 설명 20px, 설명 → 내용 48~64px. 제목 위 여백이 아래보다 늘 크다. 메뉴로 오는 구역은 `scroll-mt-24`.

글 순서(위 → 아래)와 메뉴 연결은 지금과 같다: `#demo`(히어로 판) → `#about` 서비스 소개 → `#features` 주요 기능 → `#analysis` 분석 방식 → `#principles` 분석 원칙 → `#faq` → `#get-started` → 바닥글. 구역 이름(`h2` 문구)은 지금 문구 그대로 둔다(시험이 이 문구로 찾는다).

### 0. 머리말 (`site-header.tsx`)

- **목적**: 어디서든 이름·메뉴·시작하기.
- **구성**: 높이 72px(`min-h-18`), 단색 `bg-background` + 아래 `border-b`. 3칸 격자는 유지(왼쪽 로고, 가운데 메뉴, 오른쪽 동작).
  - 로고: A안 가로형(글자 20px). 링크 이름은 `SOL RADAR`.
  - 메뉴 3개: 버튼 모양이 아닌 링크. `type-ui-lg font-medium text-foreground`, 안쪽 여백 `px-3.5 py-2.5`(누르는 높이 46px), hover `bg-muted`, 초점 `focus-visible:ring-3 ring-ring/50`, 모서리 `rounded-lg`.
  - 오른쪽: 로그인 = `ghost` `lg`, 시작하기 = `outline` `lg` + `border-foreground`. (주요 버튼은 히어로의 시작하기 하나 — M1)
- **버리는 것**: `bg-background/95 backdrop-blur-sm`, `sm` 버튼(13px·32px).
- **레퍼런스**: Ramp·Airtable 머리말은 단색 흰 바탕, 오른쪽에 로그인 글자 + 버튼. 크기는 Airtable(이전 방문) 쪽.

### 1. 히어로 (`hero.tsx`)

- **목적**: 무엇인지 한 번에, 행동 하나.
- **구성**: 위 여백 40px(`pt-10`), 아래 여백 40px(`pb-10`) — 13인치 노트북(1280×800) 첫 화면에도 판의 점수 고지가 들어오게 줄였다(U5).
  1. `h1` `type-display` 두 줄(문구·`<br>` 그대로): "수많은 공고 속, / 우리 회사가 검토할 사업부터."
  2. 설명 `mt-5 max-w-190 type-lead text-muted-foreground` — 지금의 머리글 문구를 첫 문장으로 옮긴다: "공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원 플랫폼입니다. 기업의 기술·자격·실적과 공고 요구사항을 비교해 참가 자격, 사업 적합도, 추가 확인 사항을 한눈에 확인하세요." (문구 변경 — U3 승인)
  3. 버튼 `mt-8 gap-3`: 시작하기 = `default` `xl`(56px), 분석 예시 보기 = `outline` `xl` + `border-foreground`.
  4. 안내 `mt-4 type-ui-lg text-muted-foreground`, 앞에 `InfoIcon size-5 text-brand`: "MVP 개발 중 · 지금은 계정 만들기와 로그인만 이용할 수 있습니다." (`role="note"` 유지)
- **버리는 것**: 머리글(`hero.tsx:15`), 약속 줄 `PROMISES`(`hero.tsx:40-47`) — 세 생각은 분석 원칙 구역이 말한다.
- **레퍼런스**: Ramp 첫 화면 — 왼쪽 정렬 64px 제목, 한 줄 설명, 행동, 곧바로 넓은 판(실측 h1 64px, 히어로 버튼 52px). Airtable 의 두 버튼(채움 + 검정 테두리).

### 2. 제품 화면 판 (`product-preview-section.tsx`, `product-preview.tsx`) — 첫 화면의 증거

- **목적**: "근거가 붙은 판단, 결정은 담당자"를 실제 화면 크기로 보인다.
- **구성**(1440 기준, 목업 `art/mockup/board.png`):
  - 무대: 히어로 아래 40px(히어로의 `pb-10`), `rounded-[20px] bg-muted p-7`. 아래 figcaption `mt-3.5 type-label-lg text-muted-foreground`: "가상의 공고와 기업 정보로 만든 예시 화면입니다. 실제 공고·기관과 관계없고, 인용문과 숫자는 화면 설명을 위한 값입니다." (인용문 문구를 더한다)
  - 창: `rounded-[14px] border bg-background shadow-sm overflow-hidden`.
  - 창 머리 52px: "공고 분석"(`type-ui-lg font-semibold`) | 세로선 | "분석 기준: 가상 기업 프로필"(`type-label-lg` 보조) … 오른쪽 `DemoBadge` md. **예시 데이터 배지는 판에 이 하나만**(공고 제목 위 배지는 뺀다).
  - 본문 3단 `grid-cols-[280px_minmax(0,1fr)_288px]`:
    - **왼쪽 목록**(`bg-muted/50 border-r p-3`): "예시 공고 3건"(`type-label-lg` 보조). 탭마다 `rounded-[10px] px-4 py-3.5`: 제목 `type-ui-lg font-semibold`, 기관 `type-label-lg` 보조, 줄 `SOL Score 82`(`type-label-lg`, 숫자 `font-semibold text-foreground tabular-nums`) + `RecommendationBadge` md. 선택된 탭은 흰 바탕 + `border` + `shadow-xs` + 왼쪽 3px `bg-brand` 막대(지금 구조 유지). Base UI Tabs(세로, `activateOnFocus`)·방향키 동작 유지.
    - **가운데**(`px-7 pt-6 pb-7`): 단계 "입찰공고"(`type-label-lg` 보조) → 제목 `h3 type-heading-lg mt-3` → 사실 `dl` 3칸 격자(`grid-cols-3 gap-6 mt-4`, 상자 없음): 이름(`type-label-lg` 보조) 위, 값(`type-ui-lg font-semibold tabular-nums`) 아래 — 이름은 지금 문구 "기관명·사업 예산·제안서 마감" 그대로. → **참가 자격 검토**: 위 선 `border-t border-foreground`, 머리 줄(`h4 type-ui-lg font-semibold` + "충족 2 · 확인 필요 1 · 미충족 0" `type-label-lg` 보조), 항목 줄마다 `grid-cols-[104px_minmax(0,1fr)] gap-3 py-3.5 border-t items-start`: 상태(`QualificationLabel`, `type-ui-lg font-semibold`, 아이콘 18px) | 요건명 `type-ui-lg font-semibold`, 설명 `type-label-lg` 보조, **인용 줄** `mt-2 type-label-lg`: "공고문 p.2"(`font-semibold text-foreground`) + 「인용문」(`rounded-sm bg-brand/8 px-0.5`, 낫표는 글자로 보인다). 목록 끝에 "추가 확인: 필수 증빙의 유효기간 확인 필요"(`TriangleAlertIcon size-5 text-warning` + `type-ui-lg`). **상자 안 상자를 만들지 않는다** — 자격 목록은 선으로만 나눈다.
    - **오른쪽 결정 레일**(`border-l px-6 pt-6 pb-7`, 칸 사이 22px): SOL Score 이름(`type-label-lg font-medium` 보조) → 숫자 `type-headline tabular-nums` + "/ 100"(`type-body-lg` 보조) → 막대 `h-2 rounded-full bg-muted`, 채움 `bg-brand`(`role="meter"` 유지) → 고지 "SOL Score는 사업 적합도이며 수주 확률이 아닙니다."(`type-label-lg` 보조, `aria-describedby` 유지). 가는 선. "권고와 결정" 이름 → **결재란 두 칸**(`grid grid-cols-2 rounded-[10px] border border-input`, 칸 사이 `border-l border-input`, 칸 `px-3 pt-2.5 pb-3`): 칸 이름 "시스템 권고" / "담당자 결정"(`type-body font-semibold` 보조) → 값: `RecommendationBadge` md / `ClockIcon` + "대기"(`type-ui-lg font-semibold` 보조). 의미 구조는 `dl`. 그 아래 권고 이유(`type-ui-lg`, 지금 `recommendationReason`)와 "권고는 참고 의견입니다. 최종 참여 여부는 담당자가 결정합니다."(`type-label-lg` 보조).
  - 판 안의 가장 작은 글자는 14px(결재란 칸 이름). 12px 0개.
- **버리는 것**: 사실 상자, 점수·권고 카드, 근거·확인 사항 두 카드("주요 판단 근거"는 주요 기능의 점수 조각으로 옮긴다), 원문 점선 상자(원문이 없다는 말은 figcaption 이 한다), 공고 제목 위 두 번째 예시 배지.
- **데이터**: `demo-bids.ts` 의 자격 항목에 예시 인용 `evidence: { page: number; quote: string }` 를 더한다(가상 문구, U3 승인). 제안 값 — demo-1: 소프트웨어사업자 신고 p.2 「소프트웨어사업자로 신고한 자」, 중소기업 제한경쟁 p.2 「중소기업자 간 제한경쟁입찰」, 필수 증빙 p.4 「입찰 마감일 기준 유효한 인증서 사본」. demo-2·3 도 같은 꼴로(예: 원격교육 실적 p.3 「원격교육 분야 수행 실적 1건 이상」). 법령 조항 번호는 쓰지 않는다(확인하지 않은 사실).
- **레퍼런스**: Ramp 판(제품 조각 + "Requires your approval" 승인 대기) → 우리는 결재란의 "담당자 결정 대기". Airtable 판(사이드 목록 + 표, 선으로만 구분).

### 3. 서비스 소개 `#about` (`problem-section.tsx`) — 비교표

- **목적**: 심사위원이 자기 일을 알아보게 한다. 문제와 해법을 짝지어 한눈에.
- **구성**: `h2` "공고 검색보다 오래 걸리는 건, 참여 여부를 판단하는 일입니다." → 설명(지금 맨 아래 문장을 위로): "SOL RADAR는 이 과정을 하나의 검토 흐름으로 묶습니다. …" → `table` 전체 폭 `mt-12`:
  - 머리 줄: 위 2px `border-foreground`, 열 이름 `type-label-lg font-semibold` 보조 — "검토 단계 | 지금은 | SOL RADAR에서는 (개발 중)".
  - 줄 3개(`th scope="row"` + `td` 2): 줄 머리 `type-lead font-bold`(22% 폭), 칸 `type-body-lg`(지금은: 보조 진한 회색, SOL RADAR: `foreground`), 칸 여백 `py-6 pr-6`, 줄 사이 `border-t`.
  - 줄 내용: 요구사항 파악 / 자격·실적 대조 / 판단 기록. "지금은" 칸은 지금 `PAINS` 본문 그대로, "SOL RADAR에서는" 칸은 새 문구(U3 승인):

    | 줄 머리 | SOL RADAR에서는 (개발 중) |
    |---|---|
    | 요구사항 파악 | 단계별 공고를 한 사업으로 이어 보고, 요구사항을 공고문의 해당 위치와 함께 정리합니다. |
    | 자격·실적 대조 | 한 번 등록한 기업 프로필과 대조해 충족·미충족·확인 필요로 나눠 보여 줍니다. |
    | 판단 기록 | 권고와 담당자의 결정, 결정 사유를 공고마다 남겨 팀이 같은 근거를 봅니다. |
- **버리는 것**: 머리글 "서비스 소개", 아이콘 칩, 카드, 왼쪽 제목/오른쪽 카드 배치. `h3` 3개 → 표의 줄 머리(시험 갱신 필요).
- **레퍼런스**: [[01-PRD|01 PRD]] 차별점 표, [[18-HACKATHON|18]] §2.2 표 — 공공 SI 의 제안서·평가표가 쓰는 형식. Ramp 의 "Systems that never spoke" 처럼 지금 방식과 대비하되, 그림 대신 표로.

### 4. 주요 기능 `#features` (`features-section.tsx`, `feature-previews.tsx`) — 큰 조각 네 줄

- **목적**: 무엇을 하게 될지 화면 조각으로 보인다(모두 개발 예정).
- **구성**: `h2` "검토에 필요한 정보를 한 흐름으로 모읍니다" → 설명 → 안내 `role="note"`(테두리 상자 없이 ⓘ + `type-ui-lg` 보조): "아래 기능은 모두 개발 예정이며 아직 이용할 수 없습니다. 화면은 예시 데이터로 그렸습니다." → 줄 4개(`mt-16`, 줄 사이 96px). 각 줄 `grid grid-cols-12 gap-14 items-start`:
  - 왼쪽 4칸: `h3 type-subhead`, 설명 `type-body-lg` 보조 `mt-3.5`, `PlannedBadge`(md 14px, `mt-5`).
  - 오른쪽 8칸: 제품 조각 — `rounded-[14px] border bg-background shadow-xs overflow-hidden`, 머리 띠 `bg-muted/50 border-b px-5 py-3.5`. 조각 안 글자는 판과 같은 눈금(15~17px).
  1. **공고 수집과 탐색**: 단계 칩 3(`type-label-lg`, 선택 "입찰공고" = `border-brand text-brand`) + 오른쪽 "마감 빠른 순" → 표 4열(공고명 `type-ui-lg font-semibold` · 기관 · 예산 · 마감, 숫자 오른쪽 정렬 `tabular-nums`) 3줄, 마감순.
  2. **기업 프로필 기반 자격 검토**: 세 상태 한 줄씩(지금 `SAMPLE_CHECKS`) — 판의 자격 줄과 같은 모양 + 인용 줄. 미충족 줄이 꼭 들어간다.
  3. **SOL Score와 판단 근거**: demo-3(원격 교육 플랫폼 구축, 64) — 요소 5줄(이름 150px · 막대 `h-2.5` · "18 / 30") + "주요 판단 근거" 두 줄(판에서 옮긴 `reasons`) + 고지 "적합도 지표입니다. 수주 확률이 아닙니다." 막대 길이가 서로 달라야 분해가 읽힌다(demo-1 은 다섯 중 넷이 80% 라 고르지 않는다).
  4. **검토 이력과 변경 알림**: demo-1 이력 두 줄 — 변경 알림(10. 16. 09:12, 첨부문서 1건이 추가되었습니다.) / 참여 결정(대기, 권고 WATCH · 담당자 결정 전). "검토 의견"은 뺀다(FR-13, 해커톤 범위 밖 P1).
- **버리는 것**: 아이콘 칩, 카드 모양 바깥 틀, 7·5/5·7 엇갈린 상자 격자, 12px 조각 글자.
- **레퍼런스**: Ramp 의 제품 조각(표·승인 대기)이 들어간 기능 판. 다만 같은 크기 상자 격자 대신 한 줄에 하나, 조각을 크게.

### 5. 분석 방식 `#analysis` (`how-it-works-section.tsx`) — 단계 띠

- **목적**: 쓰는 순서(1→2→3)를 한 줄로.
- **구성**: `h2` "기업 정보를 등록하면, 검토할 사업이 명확해집니다." → 설명 → `ol` 3칸 띠(`grid-cols-3 mt-14 border-t-2 border-foreground`), 칸 `pt-7 pr-8 pb-2`(세로선이 마지막 줄 아래로 8px 내려가 선 끝이 글자에 붙지 않는다), 2·3번째 칸 `pl-8 border-l`. 칸마다 "1단계"(`type-ui-lg font-bold text-foreground` — 파랑 아님), `h3 type-heading-lg mt-2`, `dl mt-5`: "하는 일"/"얻는 것"(`type-label-lg font-semibold` 보조) + 값 `type-body-lg`. 번호는 순서라는 정보가 있어 쓴다.
- **버리는 것**: 머리글, 카드 3개, 파란 단계 글자.
- **레퍼런스**: 공공 문서의 업무 흐름도(단계 띠). Ramp 의 무카드 텍스트 구역.

### 6. 분석 원칙 `#principles` (`principles-section.tsx`) — 원칙과 화면 증거

- **목적**: 책임 있는 AI 원칙을 말로만 하지 않고 화면의 실제 표시로 보인다.
- **구성**: `h2` "점수만 보여주지 않고, 판단의 근거를 함께 제공합니다."(지금 문구) → 2×2 선 격자(`grid-cols-2 mt-14 border-t`, 칸 `flex flex-col py-9 pr-10 border-b`, 오른쪽 칸 `pl-10 pr-0 border-l` — 두 칸 글줄 폭이 560px 로 같다). 칸마다 `h3 type-heading-lg`, 설명 `type-body-lg` 보조, **"화면에서"** 줄(`mt-auto pt-5` — 같은 줄의 칸끼리 높이를 맞춘다, 이름 `type-body font-semibold` 보조 + 실제 부품):
  1. 원문과 근거를 연결합니다 → 인용 표시 "공고문 p.2 「소프트웨어사업자로 신고한 자」"
  2. 확인된 정보와 확인이 필요한 정보를 나눕니다 → `QualificationLabel` 세 개(충족·확인 필요·미충족)
  3. 적합도와 수주 확률을 구분합니다 → "SOL Score **82** / 100 · 수주 확률이 아닙니다"
  4. AI 권고와 최종 결정을 구분합니다 → `RecommendationBadge` WATCH + "권고 · 담당자 결정 대기"
  - "화면에서" 줄은 그림이 아니라 글자다 — 화면 낭독기가 읽는다.
- **버리는 것**: 머리글, 아이콘 칩, 왼쪽 제목/오른쪽 격자 배치, 화살표 기호(→ 같은 유니코드 기호를 아이콘 대신 쓰지 않는다).
- **레퍼런스**: Midday 의 "숫자 대신 문장으로 설명하는 카드"(참고만). 원칙을 화면 표시와 짝지은 것은 우리 것.

### 7. 자주 묻는 질문 `#faq` (`faq-section.tsx`) — 펼쳐 둔 목록

- **목적**: 핵심 고지("수주 확률 아님", "담당자가 결정")를 누르지 않고 읽게.
- **구성**: `h2` "자주 묻는 질문" → `dl`(`mt-12 border-t-2 border-foreground`), 줄마다 `grid grid-cols-12 gap-10 py-7 border-b`: 질문 `dt` 5칸 `type-lead font-bold`, 답 `dd` 7칸 `type-body-lg` 보조. 질문·답 문구는 지금 그대로.
- **버리는 것**: 아코디언(U4 승인, `ui/accordion.tsx` 삭제), 카드 틀, 왼쪽 제목/오른쪽 목록 배치.
- **레퍼런스**: (가정) 공공기관 누리집에서 흔한 질문·답 목록 형식. 다섯 개뿐이라 접을 이유가 없다.

### 8. 마지막 권유 `#get-started` (`final-cta-section.tsx`) — 권유 띠

- **목적**: 페이지의 끝맺음, 행동 하나.
- **구성**: 화면 폭 띠 `bg-muted`(위 여백 144px 뒤), 안쪽 `py-24`: `h2 type-headline` "다음 사업 검토, 근거부터 확인하세요." → 설명 `type-lead text-foreground/80`(회색 바탕 위라 보조색 대신 진한 글자, 지금 문구, `<br>` 없이) → 버튼 `xl` 둘(시작하기 `default`, 분석 예시 보기 `outline` + `border-foreground hover:bg-foreground/5` — 띠와 같은 `bg-muted` hover 를 피한다) → 안내 `role="note"` `mt-6`(ⓘ + `type-ui-lg text-foreground/80`, 지금 문구).
- **버리는 것**: 흰 카드 틀, 카드 안 가는 선.
- **레퍼런스**: Ramp 끝의 한 줄 권유 + 행동. 회색 띠는 히어로 무대와 같은 재료라 처음과 끝이 맞물린다.

### 9. 바닥글 (`site-footer.tsx`)

- **구성**: `bg-foreground text-background`, 안쪽 `pt-16 pb-10`. 12칸: 왼쪽 5칸 = 로고 흰색 가로형(`<Logo inverted />`, 머리말과 같은 크기) + 설명 `type-ui-lg text-background/72 mt-4.5 max-w-110`; 오른쪽 6칸(7번째부터) = 묶음 2개(이름 `type-ui-lg font-semibold`, 링크 `type-ui-lg text-background/72`, 링크 사이 12px, hover `text-background underline underline-offset-4`). 아래 `mt-14 border-t border-background/15 pt-6` 저작권 `type-body text-background/72`.
- **버리는 것**: 13·12px 글자, 둥근 사각형 로고.
- **레퍼런스**: Ramp 의 어두운 바닥글(링크 묶음 + 법적 고지 줄). 우리는 약관·주소가 없어 링크 두 묶음만(지금 규칙 유지).

## 로고 시안 (안별 근거 · 크기별 렌더 · 추천)

세 안 모두 SVG 를 손으로 그렸고 아이콘 라이브러리를 쓰지 않았다. 워드마크는 Pretendard(OFL) 글자를 외곽선으로 바꿔 넣었다(파일이 글꼴 로딩에 기대지 않는다). 색은 `foreground` #191F28·`brand` #1B64DA 둘. 비교 한 장: `art/logo/preview.png`(16·24·32·48px 마크, 두 색·남색 한 색·흰색 한 색, 브라우저 탭, 64px 머리말, 어두운 바닥글, 큰 크기).

| 안 | 마크 | 근거 | 작은 크기(16·24px) | 바닥글 흰색 | 약점 |
|---|---|---|---|---|---|
| **A 인용 표식 「•」(추천)** | 낫표 「 」 두 모서리 안에 점 하나 | 공공 문서가 법령·문서를 인용할 때 쓰는 부호 안에, 레이더가 포착한 공고(점). "판단마다 원문 근거"라는 이 제품만의 이유가 모양에 있다. 판의 인용 표시 「…」 와 같은 문법 | 두 L 과 점이 분명히 갈린다. 파비콘은 여백을 줄인 `a-favicon.svg`(viewBox 1 1 22 22) | 한 색으로 성립 | 낫표를 모르면 "초점·스캔" 기호로 읽힐 수 있다. 이름의 RADAR 는 워드마크가 말한다 |
| B 부채꼴 선별 | 원에서 한 사분면을 걸러 내고 그 자리에 점 | 모든 공고(원) 중 걸러 낸 하나(점). 잘린 두 변이 레이더 스윕선. 동심원·눈금 없이 한 덩어리 | 덩어리가 커서 16px 에서도 보인다 | 성립 | 16~24px 에서 "C + 점"·한 입 베어 문 원으로 읽힌다. 레이더 그대로 그리기에 가깝다 |
| C 스코프 O | 워드마크 SOL 의 O 를 테두리 원 + 훑은 부채꼴로 | 따로 붙인 기호 없이 이름이 곧 표지. 가장 조용하다 | 파비콘(O 하나)은 시계·원그래프처럼 보인다 | 성립 | 머리말 20px 에서 부채꼴이 거의 안 보여 O 가 오타처럼 보인다 |

워드마크는 안마다 하나씩 보였다(A: SOL RADAR 800 한 무게 / B: SOL 800 + RADAR 600·자간 +0.04em / C: 800 한 무게). 마크와 워드마크는 서로 바꿔 짝지을 수 있다(예: A 마크 + B 워드마크) — A안 한 무게로 정했다(U1).

**추천: A안.** 이유: (1) 근거·인용이라는 제품의 차별점(D1·D3)이 표지에 들어 있고, (2) 판 안의 인용 표시와 같은 모양이라 브랜드와 제품이 한 문법이 되고, (3) 레이더 동심원이라는 가장 흔한 답을 피하면서 점(포착)으로 이름과 이어지고, (4) 단색 남색·흰색과 16px 에서 무너지지 않는다.

**A안 치수(구현 기준)**

- 마크(24칸 격자, 잉크 2..22):

```svg
<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M2 2H11.4V5.4H5.4V11.4H2Z" fill="currentColor"/>
  <path d="M22 22H12.6V18.6H18.6V12.6H22Z" fill="currentColor"/>
  <circle cx="12" cy="12" r="3.1" class="fill-brand"/>
</svg>
```

  획 두께 3.4칸(잉크 높이의 17%), 팔 길이 9.4칸, 점 지름 6.2칸. 흰색 한 벌은 세 도형 모두 `currentColor`(점도 흰색).
- 워드마크: "SOL RADAR", Pretendard 800, 자간 +0.02em, 대문자 그대로. Pretendard 대문자 높이 = 글자 크기 × 0.707.
- 마크 : 워드마크 = 마크 잉크 높이가 대문자 높이 × 1.52, 마크 가운데 = 대문자 가운데, 간격 = 마크 잉크 높이 × 0.34.
  - 머리말·바닥글 모두 글자 20px: 대문자 14.1px → 마크 잉크 21.5px → 마크 상자 25.8px(`size-6.5`, 26px), 보이는 간격 7.3px(마크 상자 안 여백 2.2px 를 빼면 `gap-1.25`, 5px). 가로형 전체 약 145×22px.
- 구현 방식(권장): `logo.tsx` 는 마크를 인라인 SVG(위 좌표, `currentColor` + `fill-brand`)로, 워드마크는 HTML 글자로 그린다. 워드마크의 크기·굵기·자간은 새 눈금 `wordmark`(20/20, 800, +0.02em — T1)로만 정한다. `type-lead` 에 `tracking-*` 을 덧붙이지 않는다 — 생성된 `type-*` 와 Tailwind 자간 클래스 중 어느 쪽이 이길지 순서가 보장되지 않는다. 링크 이름은 글자 "SOL RADAR" 가 준다(마크는 `aria-hidden`). 외곽선 가로형 SVG(`a-lockup*.svg`)는 발표 자료·문서용 정본 그림으로 쓴다.
- 파비콘: `web/app/icon.svg` 에 `a-favicon.svg`(두 색). 템플릿 `web/app/favicon.ico` 는 지운다(U4).

## 움직임 · 접근성

**움직임** — 사용자 결정대로 `web/components/landing/reveal.tsx`(20% 보이면 500ms 동안 24px 위로, 한 번, `motion-safe` 에서만)를 유지한다. 히어로·판의 열림 애니메이션(D9)도 유지.

- `Reveal` 은 **구역마다 큰 덩어리 하나 또는 둘**에만 건다: 구역 제목 묶음(h2 + 설명 + 안내) 하나, 내용 하나(비교표 전체 / 기능 줄 하나씩 / 단계 띠 전체 / 원칙 격자 전체 / 질문 목록 전체 / 권유 띠 안쪽). 칸·항목마다 따로 걸지 않는다. (impeccable craft-floor 는 "모든 구역에 같은 등장 효과"를 경계한다 — 사용자 결정이 우선이므로 유지하되 단위를 줄인다. M2)
- 그 밖의 움직임: 버튼·링크 hover 색 전환(150ms), 판 탭 전환 시 패널 `fade-in`(지금 그대로). 새 연출을 더하지 않는다.

**접근성**

- 제목 차례: `h1`(히어로) → `h2`(판의 화면 낭독기용 "공고 분석 예시" 유지, 구역 제목) → `h3`(판 공고 제목, 기능·단계·원칙 제목). 비교표는 `th scope`, 질문은 `dl/dt/dd`, 결재란은 `dl`.
- 키보드: 판 탭 방향키(유지), 메뉴 링크·버튼 모두 `focus-visible:ring-3 ring-ring/50`(바닥글은 `ring-background/60`). 누르는 높이 44px 이상(메뉴 46, `lg` 44, `xl` 56).
- 대비: 위 "색" 표의 값. 상태 색 글자는 흰 바탕 위에만(목록 칸의 배지는 `bg-background`).
- 색만으로 뜻을 전하지 않는다: 상태 = 아이콘 + 글자 + 색, 인용 = 낫표 글자 + 바탕, 선택 탭 = 흰 바탕 + 막대 + `aria-selected`.
- 브라우저 기본 표면: 랜딩 루트에 `selection:bg-brand/15`, 링크 밑줄 `underline-offset-4`, 숫자 `tabular-nums`.
- 움직임 줄이기: 숨김·이동 0(지금 시험 유지).

**스스로 점검(impeccable craft-floor · 가독성 바닥, 목업 기준)**

| 항목 | 결과 | 근거 |
|---|---|---|
| 13px 미만 글자 | 0개(1440·1280) | 목업 계산값 분포 14·15·16·17·18·20·22·24·28·44·64px, `art/probe/floor.cjs`. 목업의 16·22px 은 근사치이고 정본은 위 눈금(17·24px 로 맞춘다) |
| 가로 넘침 | 0px(1440·1280) | 같은 스크립트 |
| 대비 | 본문 16.6:1, 설명 7.11:1(T2 적용 시), 상태 색 5.0~7.6:1, 바닥글 보조 9.1:1 | 계산값("색" 표) |
| 머리글(eyebrow) | 0 | 목업 |
| 같은 크기 아이콘 카드 격자·카드 속 카드 | 0. 검출기의 "nested-cards" 1건(자격 목록 상자 안 상자)은 선으로 바꿔 없앴다 | `impeccable detect` 목업 실행 |
| 그라데이션·유리·네온·3D | 0. 머리말 흐림 제거 | 목업 |
| 유니코드 기호를 아이콘 대신 | 0(원칙 칸의 → 를 뺐다). 가운뎃점(·)은 문장 부호로만 | 목업 |
| 깊이 | 창 그림자는 아래 방향 + 흐림(`shadow-sm`) | 목업 |
| 여백 | 제목 위 144px > 제목 아래 20px | 목업 |
| 글줄 | 설명 760px(20px, 한 줄 약 40자), 표 칸 18px 30~40자, `keep-all` | 목업 |
| 숫자 | 점수·금액·날짜 `tabular-nums` | 목업 |
| 검출기 남은 경고 | "cramped-padding" 3건(창·창 머리·권유 띠) — 목업의 정적 HTML 에서 안쪽 여백을 부모가 준 탓에 생긴 오검출. 구현 뒤 `impeccable detect` 를 다시 돌려 0건을 확인한다 | `impeccable detect --json landing.html` |
| 움직임 | 등장 효과 하나(`reveal.tsx`, 사용자 결정)를 덩어리 단위로만 | 위 "움직임" |

## 토큰·부품 변경 제안 (승인 필요)

| # | 무엇 | 파일 | 앱(로그인 뒤) 영향 | 되돌리기 |
|---|---|---|---|---|
| T1 | 글자 눈금: `display`·`headline`·`lead` 값 변경, `subhead`·`heading-lg`·`body-lg`·`ui-lg`·`label-lg`·`wordmark` 추가(위 표) | `design/tokens.json` → `pnpm tokens` → `web/app/globals.css`(생성) | 없음(세 역할은 랜딩만 쓴다) | 쉬움 |
| T2 | `muted-foreground` #5E6978 → #4E5968(대비 5.57 → 7.11:1) | `design/tokens.json` | **있음**: 앱의 모든 보조 글자(표 머리·날짜·설명)가 조금 진해진다. 대비만 오르고 배치는 그대로 | 쉬움. 거절하면 랜딩 설명문만 `text-foreground/80` |
| T3 | 버튼 크기: `lg` 44px·15px → 44px·`type-ui-lg`(17px), 새 `xl` 56px·`px-7`·`type-ui-lg font-semibold` | `web/components/ui/button.tsx` | 없음(`lg` 는 랜딩만 쓴다 — `grep` 확인) | 쉬움 |
| T4 | 마케팅 틀 규칙: 본문 바탕 `bg-muted/50` → 흰색, 단 폭 `max-w-6xl`(1152) → 바깥 `max-w-320` + `px-10`(글줄 1200), 머리말 64 → 72px·단색 | `design-system` 스킬의 "웹 틀" 표, `web/app/page.tsx`, `site-header.tsx`, `site-footer.tsx` | 없음(마케팅 틀만) | 쉬움 |
| T5 | 로고 A안 | `web/components/logo.tsx`, `web/app/icon.svg`(새 파일) | 앱 틀은 로고 자리를 조직 전환기가 쓴다. 관리자 머리 막대(`web/app/admin/layout.tsx:34`)에는 새 로고가 그대로 쓰인다(M6) | 쉬움 |
| T6 | 랜딩 부품 정리: `SectionHeading` 의 `eyebrow` 제거, `icon-chip.tsx` 사용 0 → 삭제 후보, FAQ 정적화로 `ui/accordion.tsx` 사용 0 → 삭제 후보 | `web/components/landing/*`, `web/components/ui/accordion.tsx` | 없음 | 삭제는 사용자 확인 뒤(이번 작업에서 만든 파일이 아니다) |
| T7 | `demo-bids.ts` 자격 항목에 예시 인용 `evidence` 추가 | `web/components/landing/demo-bids.ts`(+ 시험) | 없음 | 쉬움 |

`DESIGN.md`(impeccable)는 지금 쓰지 않는다 — 구현이 끝난 뒤 실제 화면에서 정리한다(impeccable new-work §5, 내용은 `design/tokens.json` 과 `design-system` 스킬을 요약·링크만).

## 구현 순서 제안 (단계 · 고칠 파일 · 완료 기준)

단계마다 `pnpm verify:quick`(마지막에 `pnpm verify`), 1440·1280 두 폭 스크린샷. 시험 수정은 `e2e-web`, 확인은 `qa-web` 이 이 문서를 근거로 한다.

| 단계 | 고칠 파일 | 완료 기준 |
|---|---|---|
| 1 토큰·버튼 | `design/tokens.json`, `web/app/globals.css`(`pnpm tokens`), `web/components/ui/button.tsx`, `.claude/skills/design-system/SKILL.md`(눈금 표·웹 틀 표) | `pnpm check:tokens`·`check:colors` 통과, 앱 화면 스크린샷 차이는 T2 의 글자색뿐 |
| 2 로고·머리말·바닥글·틀 | `web/components/logo.tsx`, `web/app/icon.svg`, `site-header.tsx`, `site-footer.tsx`, `web/app/page.tsx`(흰 바탕·`break-keep`·`selection`) | 머리말 72px 한 줄(1280 포함), 로고가 시안 `a-lockup.svg` 와 겹쳐 같은 비율, `site-header.spec.ts`·바닥글 시험 통과 |
| 3 히어로·판 | `hero.tsx`, `product-preview-section.tsx`, `product-preview.tsx`, `status-badges.tsx`(배지 md 15px), `demo-bids.ts`(+`demo-bids.test.ts`) | 1440×900 첫 화면에 점수 82 와 고지가 보인다, 판 안 12px 0개, 1280 넘침 0, `product-preview.browser.test.tsx` 통과(방향키) |
| 4 서비스 소개·주요 기능 | `problem-section.tsx`, `features-section.tsx`, `feature-previews.tsx`, `section-heading.tsx` | 머리글 0, 아이콘 칩 0, 기능 "개발 예정" 4개, 조각 글자 15px 이상 |
| 5 분석 방식·원칙·FAQ·권유 | `how-it-works-section.tsx`, `principles-section.tsx`, `faq-section.tsx`, `final-cta-section.tsx` | 카드(`Card`) 사용 0, FAQ 답 다섯 개가 펼쳐져 보임 |
| 6 시험·증거 | `web/e2e/landing.spec.ts`, `landing-sections.spec.ts`, `landing-reveal.spec.ts`, `site-header.spec.ts` | 아래 "시험 갱신" 반영, `pnpm verify` 통과, `impeccable detect` 0건, axe 위반 0, `docs/evidence/landing/` 에 1440·1280 첫 화면·전체 스크린샷 |

**시험 갱신(무엇이 깨지는가)**

- `landing.spec.ts:29` 머리글 글자 → 설명 문단 안의 같은 글자로 찾는다. `:34-38` 약속 줄 → 지운다.
- `landing.spec.ts:83-84` 판의 "유사 사업 실적 보유"·"주요 기술 요구사항 부합" → 주요 기능 점수 조각(demo-3 문구)으로 옮기거나 지운다. 판에는 인용("공고문 p.2")과 결재란("담당자 결정", "대기") 확인을 더한다. 판의 링크 0개 확인은 그대로.
- `landing-sections.spec.ts:42` "서비스 소개" 머리글 → 지운다. `:43` `h3` 세 개 → 표의 줄 머리(`rowheader`) 세 개.
- `landing-sections.spec.ts:102-118` 아코디언 펼치기/접기 → 답 다섯 개가 처음부터 보이는지로 바꾼다.
- `landing-reveal.spec.ts` 의 "주요 기능 제목 묶음" 은 그대로 `data-reveal` 블록이면 통과. 블록 단위가 바뀌면 선택자만 맞춘다.
- 새 시험(제안): 랜딩 안 글자 중 계산된 `font-size` 가 13px 미만인 요소 0개(1440).

## 구현자에게 맡기는 것

- 위 치수의 ±2px 안 미세 조정, 줄바꿈 위치(실제 글자로 1440·1280 에서 확인), hover 색의 정도.
- 로고 마크와 워드마크의 세로 맞춤(마크 가운데 = 대문자 가운데). 시안 `a-lockup.svg` 를 같은 크기로 겹쳐 보아 1px 안이면 된다.
- 판의 그림자 세기(`shadow-sm` / `shadow-xs`), 무대 여백(28~32px).
- 기능 조각의 정확한 줄 수와 표 열 폭(글자 15px 이상, 넘침 0 이 조건).
- 상태 배지 md 의 아이콘 크기(16~18px).
- 시험 선택자 세부.

## 메인 세션이 정한 것 (구현자 검토 반영, 2026-10-16)

구현자 관점 검토에서 나온 질문 가운데, 만들 것을 바꾸지 않아 메인 세션이 정한 것이다. 사용자가 읽고 뒤집을 수 있다.

| # | 정한 것 | 이유 |
|---|---|---|
| M1 | 머리말의 시작하기는 테두리 버튼(`outline`)이다(열린 질문 6을 추천안으로 닫음) | `design-system` 의 "주요 버튼은 화면에 하나" 규칙. 히어로의 시작하기가 주요 버튼이다 |
| M2 | 스크롤 등장 효과는 새 구성의 덩어리마다 건다: 구역 제목 묶음 하나 + 내용 덩어리(비교표 / 기능 줄 하나씩 / 단계 띠 / 원칙 격자 / 질문 목록 / 권유 띠 안쪽)(열린 질문 9를 닫음) | 레퍼런스(edgelink.me)도 제목 묶음과 내용 블록마다 따로 떠오른다. 카드가 없어지면 블록이 자연히 커진다 |
| M3 | 문구는 이 문서에 적힌 것이 정본이다. 목업과 다르면 문서를 따른다. 주요 기능 설명은 지금 문구("요소별로 나누고 항목마다")를 그대로 두고, 분석 원칙 `h2` 도 지금 문구("…함께 제공합니다.")를 그대로 둔다 | 목업의 문구 변경은 문서에 근거가 없고, 시험이 제목 글자로 구역을 찾는다 |
| M4 | `DESIGN.md` 는 이번 작업에 넣지 않는다. 마감 검토는 impeccable `detect` 0건과 `critique` 한 번 | 디자인 정본은 `design/tokens.json`·`design-system` 스킬이다. 같은 내용을 두 곳에 쓰지 않는다 |
| M5 | 고른 로고의 외곽선 SVG(가로형·한 색·흰색·파비콘)는 `design/brand/` 에 둔다. 2단계 완료 기준의 비교 대상은 이 파일이다 | `design/` 은 웹이 아닌 디자인 정본(`tokens.json`)을 두는 자리다. 임시 폴더는 사라진다 |
| M6 | 관리자 화면(`web/app/admin/layout.tsx:34`, 48px 머리 막대)도 같은 크기의 새 로고를 쓴다. 크기 선택지는 만들지 않는다 | 가로형 높이가 약 26px 라 48px 막대에 들어간다. 2단계에서 관리자 화면 스크린샷으로 확인한다 |
| M7 | 재설계 전에 지금까지의 스크롤 등장 효과 작업을 따로 커밋해 기준선으로 둔다(사용자가 커밋을 승인하면) | 재설계가 같은 구역 파일 6개를 다시 쓴다. 섞이면 단계별 검토·되돌리기가 어렵다 |

## 사용자 결정 (2026-10-16)

처음 열린 질문 9개 가운데 6·9번은 메인 세션이 닫았고(M1·M2), 나머지는 사용자가 정했다.

| # | 질문 | 결정 | 계획에 미치는 것 |
|---|---|---|---|
| U1 | 로고 안·워드마크 무게 | **A안(인용 표식 「•」) + 한 무게**(SOL RADAR, Pretendard 800, +0.02em) | T5 는 A안 치수 그대로. 눈금은 `wordmark` 하나로 충분하다. "SOL" 의 뜻은 마크 설명에 넣지 않는다(묻지 않았다) |
| U2 | 로그인 뒤 앱 화면 | **보조 글자색(T2)만 앱에도 적용**. 앱 글자 크기(`title`·`heading`·`body`·`label`·`caption`)는 그대로 | T2 는 `design/tokens.json` 의 `muted-foreground` 를 #4E5968 로. 1단계에 앱 화면(대시보드·관리자) 스크린샷 비교를 더한다. 앱 눈금 키우기는 이번 범위 밖 |
| U3 | 문구 변경 묶음 | **전부 승인**: 히어로 머리글 문구를 설명 첫 문장으로, 약속 줄 삭제, 비교표 "SOL RADAR에서는 (개발 중)" 세 줄(3절 표), 판의 가상 공고문 인용과 figcaption 의 "인용문" 문구 | T7(`demo-bids.ts` 의 `evidence`) 포함. 인용문은 가상이며 법령 조항 번호를 쓰지 않는다 |
| U4 | 정리 | **모두 승인**: (가) 재설계 전에 스크롤 등장 효과 작업을 먼저 커밋(M7), (나) FAQ 를 펼쳐 두고 `web/components/ui/accordion.tsx` 삭제, (다) `web/components/landing/icon-chip.tsx` 삭제, (라) `web/app/favicon.ico` 를 지우고 `web/app/icon.svg`(A안 파비콘)로 교체 | 삭제는 사용처가 0이 된 단계에서 한다. `favicon.ico` 를 지우면 템플릿 시험·메타데이터가 이 파일을 찾는지 확인한다 |
| U5 | 1280×800 첫 화면에 점수 고지가 빠짐(비평) | **고친다**(비평의 방향대로 히어로 여백을 줄임): 히어로 `pt-10 pb-10`, 설명 `mt-5`, 버튼 `mt-8`, 안내 `mt-4`, 무대 `p-7`. 1280×800 에서 고지 아래 끝 778px(여유 22px) | e2e 가 1440×900·1280×800 둘 다 고지 전체(ratio 1)를 확인한다 |
| U6 | 주요 기능 제목에만 마침표가 없음 | **그대로 둔다** | 없음 |
| U7 | 히어로 "서비스" ↔ 바닥글 "플랫폼" | **히어로도 "플랫폼"**: "…의사결정 지원 플랫폼입니다." | 히어로 시험 문구 |

## 관련 문서

- [[2026-10-16-landing-page|이전 랜딩 계획]] — Global Constraints(정직성·문구), 결정 D1~D10
- [[06-UI-UX|06 UI]] — 데스크톱 원칙, 상태 표기, 접근성, 앱 밀도 기준
- [[09-SECURITY|09 보안]] — 책임 있는 AI 고지 문구
- [[16-DECISIONS|16 ADR]] — ADR-007(모바일·결제 없음), ADR-019(솔리데오)
- [[18-HACKATHON|18 해커톤]] — 심사 기준, 5분 데모
- [[19-DEMO-SCENARIO|19 데모 시나리오]] — 데모 화면 흐름
- [[01-PRD|01 PRD]] — 차별점 표(비교표의 근거)
