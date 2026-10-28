---
title: "새 SOL RADAR 로고 로컬 확인"
doc: "logo-replacement-20261028"
status: final
tags:
  - sol-radar
  - ui
  - test
updated: 2026-10-28
---

# 새 SOL RADAR 로고 로컬 확인

사용자가 제공한 `web/public/logo/a_clean_graphic_logo_image_on_a_transparent_backgr.png`의 형태·색·투명도를 유지해 웹용 128×128 lossless WebP(`sol-radar.webp`, 약 15KB)와 64×64 PNG 탭 아이콘(`web/app/icon.png`, 약 6.5KB)을 만들었다. 원본은 보존했다. 별도 가장자리 제거·심볼 재설계는 하지 않았다.

공통 `Logo` 심볼은 32×32px이고 `SOL RADAR` 글자와 링크 동작은 유지한다. 랜딩 머리말·바닥글, 업무 사이드바, 관리자 머리말이 같은 부품을 쓴다. 사이트의 색 토큰은 그대로다.

로컬 개발 서버는 `pnpm -C web dev --hostname 127.0.0.1 --port 3000`으로 실행하고 기본 브라우저에서 열었다. 운영 배포는 하지 않았다.

- [1440px 랜딩](landing-1440.png), [1280px 랜딩](landing-1280.png): 머리말·바닥글 로고 이미지 로드 성공, 가로 넘침 0.
- [브라우저 측정](browser-check.json): 두 폭의 HTTP 200, 로고 두 개 각각 32×32px, PNG 탭 아이콘 HTTP 200.
- 기존 사이드바 출처 브라우저 시험 1개 통과. Next 이미지 최적화 서버가 없는 Vitest 환경에서는 `next/image`를 원본 정적 이미지를 그리는 네이티브 요소로 대체했다. 실제 이미지 로드는 위 Next 개발 서버에서 별도로 확인했다.
- `pnpm verify:changed` 통과(웹 94개 파일·813개 시험, 타입·린트·계층·서식·토큰·색 검사). [검사 로그](verify.log), [사이드바 브라우저 시험 로그](sidebar-browser.log).
- 마지막에 수정한 `next.config.ts`는 ESLint·Prettier를 별도로 확인했다. `/favicon.ico`와 이전 `/icon.svg` 모두 `/icon.png`로 308 이동하며 목적지는 `200 image/png`다.
- 로그인 뒤 실제 업무 화면·관리자 화면과 전체 빌드는 이번 확인 범위에 포함하지 않았다.

## 관련 문서

- [[PROGRESS|진행 상황]]
- [[06-UI-UX|화면 설계]]
