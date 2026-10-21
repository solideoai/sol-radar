---
title: "공공조달 업무 UI 부품 검증"
doc: "evidence-procurement-ui-20261021"
status: review
tags:
  - sol-radar
  - ui
  - test
updated: 2026-10-21
---

# 공공조달 업무 UI 부품 검증

승인한 [[2026-10-21-public-procurement-ui-spec|UI 명세]]를 대시보드·입찰 공고에 구현하고, 실제 Chromium에서 화면 부품을 확인했다. 캡처는 명시적인 DEMO props를 사용하며, 로그인·실제 API·DB·운영 수집의 실행 증거는 아니다. Next 라우터가 없는 Vitest 환경에서는 `next/link`만 URL을 유지하는 실제 앵커로 대체했다. 애플리케이션 코드는 대체하지 않았다.

| 검사 | 결과 |
|---|---|
| `pnpm -C web exec vitest run --config vitest.browser.config.ts 'app/(app)/(work)/dashboard/procurement.browser.test.tsx'` | 2개 통과. 1280px의 11열/내부 스크롤/방향키, LH 배지 가로·세로 중앙, 0/null, early 권고 제한, 최신 실행 표시, 출처 충돌의 금액·마감·권고 보류와 사람 결정 보존. 1440px 대시보드 2열→1280px 세로, KPI5와 제목 33px 확인 |
| `pnpm -C web exec vitest run 'app/(app)/(work)/bids/[id]/back-href.test.ts'` | 2개 통과. 새 필터 복귀와 지원하지 않는 출처 조건 거부 |
| `pnpm -C web exec tsc --noEmit --pretty false` | 통과 |
| 수정 UI·page·helper·시험 파일의 scoped ESLint | 통과 |
| `pnpm -C web check:colors`, `pnpm -C web check:tokens` | 통과 |
| `pnpm -C web lodestar` | UI→infra 직접 참조를 도메인 factory로 바꾼 뒤 2규칙·오류 0 통과. ingestion 순환은 담당 작업자가 해소 |
| `pnpm -C web format`, `git diff --check` | 통과 |

처음에는 독립 브라우저 하네스에서 Next Link가 요구하는 `process`가 없어 import가 실패했다. 시험 경계의 앵커 대체와 ESM 표기를 적용한 뒤 통과했다. 지원하지 않는 복귀 출처와 최신 실행 상태는 변경 전 실패를 확인하고 수정 후 통과했다. Vitest는 기존 core 4.1.11/browser 4.1.12 버전 차이 경고를 출력했다. 시험 통과와 별개로 이 경고는 통합 기록에 남긴다.

## 캡처

- [입찰 공고 1280px](20261021-bids-demo-1280.png)
- [대시보드 1440px](20261021-dashboard-demo-1440.png)
- [대시보드 1280px](20261021-dashboard-demo-1280.png)

부품 하네스는 펼친 사이드바의 256px 공간을 비우고 실제 AppPage·본문 부품을 그린다. 셸 자체나 실제 목록 필터 API 흐름을 검증하지 않는다. 전체 통합 `pnpm verify`, 실제 서버·로그인 E2E와 수집 권한 검증은 메인 통합 단계에서 수행한다.

## 관련 문서

- [[2026-10-21-public-procurement-ui-spec|UI 구현 명세]]
- [[17-CLAUDE-IMPLEMENTATION|검증 정책]]
