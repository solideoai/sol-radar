# 공고 출처 배지 기관 색 (2026-10-27)

결정은 [ADR-058](../../../16-DECISIONS.md)이다. 로고 파일은 저장소에 넣지 않았다(세션 임시 폴더에서만 읽음).

## 로고 파일과 뽑은 색

Pillow로 불투명 픽셀 중 회색·흰색(채도 차 40 미만)을 빼고 가장 많은 색을 셌다.

| 기관 | 로고 파일(받은 곳) | 워드마크(글자) | 상징 |
|---|---|---|---|
| 나라장터 | `https://www.pps.go.kr/resource/site/kor/img/content/sub06/koneps_ko.png` (조달청 기관 상징 페이지 `content.do?key=00131`) | 회색 | 태극 남색 `#003669`, 빨강 `#E6002D` |
| K-water | `https://www.kwater.or.kr/web/images/water/kwater_mark1.gif` (CI 페이지 `explPage.do?s_mid=129`) | `#005098` | 물결 하늘색 `#1EB9EE`, 노랑 |
| LH | `https://www.lh.or.kr/main/img/sub/lh_mark1.png` (CI/브랜드 소개 `menu.es?mid=a10702040100`) | `#0055A2` | 연두 `#ADCE12` |
| KEPCO | `https://home.kepco.co.kr/kepco/front/img/common_r/img_common.png` (머리말 로고 sprite) | `#004098` | 빨강 `#E60012` |

네 기관 모두 웹 페이지에 HEX 값을 공개하지 않는다(검색·CI 페이지 확인). 워드마크는 세 기관이 파랑, 나라장터가 회색이라 상징 색을 쓴다.

## 대비(WCAG, 12px 글자 기준 4.5:1)

| 토큰 | 바탕 | 글자 | 대비 |
|---|---|---|---|
| `source-g2b` | `#003669` | `#FFFFFF` | 12.13:1 |
| `source-kwater` | `#1EB9EE` | `#191F28` | 7.28:1 |
| `source-lh` | `#ADCE12` | `#191F28` | 9.16:1 |
| `source-kepco` | `#E60012` | `#FFFFFF` | 4.80:1 |

## 파일

- `options-preview.png`: 사용자에게 보인 비교 그림. A 워드마크 색(파랑 셋이 겹침), B 상징 색 + 흰 글자 + 명도 낮춤, C 상징 색 그대로(채택).
- `bids-1440.png`·`bids-1280.png`: 공고 표(`OpportunityTable`)와 배지 다섯 개(네 기관 + 미확인)를 진짜 Chromium(Vitest 브라우저)으로 그린 화면. 가짜 행 4개이고 DB는 쓰지 않았다. 1440 화면은 시험 창에 맞춰 줄어 저장됐다.

## 검증

- `pnpm -C web verify:quick` exit 0(형식·타입·린트·시험 91파일 779건·구조·토큰·색).
- 루트 `pnpm test` 259 통과, `pnpm check:tokens`·`pnpm check:colors` 통과.
- `procurement.browser.test.tsx` 4건 통과(배지 높이 28px·폭 76px 이상·글자 가운데).
- `pnpm verify:changed`는 작업 전부터 있던 미추적 파일 `docs/evidence/live-default-origin/20261026/*.json` 3개의 prettier 경고로 첫 단계에서 멈췄다. 이번에 고친 파일은 prettier 통과다.
- 운영 사이트 확인은 배포 전이라 하지 않았다.
