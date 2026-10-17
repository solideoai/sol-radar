---
title: "승인 사진 통합 Task 1 실행 증거"
status: verified
tags:
  - sol-radar
  - people
  - evidence
updated: 2026-10-17
---

# 승인 사진 통합 Task 1

승인 snapshot SHA-256: `19cbd9408e9672273db9405073dde5f9133d7715fa40041e51b91c824e8ff0e1`. 200 ID·이름·성별·부서·직급·경로와 실제 PNG 바이트 SHA를 승인 전후 및 b3ef 반입 후 대조했다. 9663 승인 커밋: `8ba281060d1cb27c6e3cb06da22b5d4ab3ca801e`(정상 훅 통과). 원본 사진은 다시 생성하거나 교체하지 않았다.

[사람 승인](20261017-portraits-approval.json)의 `recordedAt`은 승인 기록 작성 시각이다. 사용자 발화 시각은 추정하지 않았다. 이전 AI review200개와 snapshot을 먼저 파일에 보존한 후 기존 `markPortraitReady`를 순차 호출했다. manifest의 `status`·`review`만 전환했으며 프롬프트·생성 시각·생성 도구·ID·성별·경로·해시는 유지했다. [원본 AI 검수 증거](20261016-portraits-review.json)의 내용과 SHA를 유지했다. 외부 audit의 과거 PENDING은 별도 역사 기록으로 남았다.

| 실행 명령 | 실제 결과 |
|---|---|
| `node --test scripts/people/portraits.test.mjs` (9663) | 23/23 PASS |
| `pnpm -C web exec vitest run lib/demo-portrait.test.ts` | RED: 반환값 null 때문에 유효 ID 실패 → GREEN14/14 |
| `pnpm -C web exec vitest run --config vitest.browser.config.ts components/people/person-avatar.browser.test.tsx` | RED: 빈 컴포넌트에서 접근 가능한 이미지/대체 표시 없음4개 실패 → GREEN4/4 |
| `node --test scripts/people/*.test.mjs` | 사진 승인/snapshot·고정경로·해시·누락·고아·명부·조직·원본 변환99/99 PASS |
| `pnpm people:check:release -- --input /Users/leegwanghui/dev/hackathon/sol-radar-inputs/people.xlsx` | `{"ok":true,"sourceComparison":"passed","errors":[]}` |
| `pnpm -C web exec vitest run server/scoring/scoring.model.test.ts` | 기존 순수 점수10/10 PASS |
| `pnpm -C web type-check` | `next typegen && tsc --noEmit` PASS |
| 루트·web `pnpm format` | 적용 완료 |

브라우저 검사는 원본 정적 PNG 로딩, 누락/범위 밖 ID, 이미지 decode 오류 때 중립 인물 아이콘과 설명을 확인했다. 오류 시험은 네트워크/이미지 경계에서만 잘못된 PNG 데이터로 바꾸고 실제 브라우저 decode 오류와 실제 기존 Avatar 동작을 사용한다. helper는 정확한 SOL-P0001~SOL-P0200만 반환한다.

웹 config가 필요한 명령에는 명시적 inert URL `http://127.0.0.1:1`과 가짜 키/DB URL, `AI_PROVIDER=mock`을 전달했다. 기존 `.env.local`을 shell로 읽지 않았고 공유 DB를 사용하지 않았다. 원본 엑셀의 내용은 출력하지 않았다.

200명 명부·48개 조직(본부6·그룹4·팀38)·직급·평가27명/배정·점수 입력·마이그레이션·가입 코드는 그대로 보존했다. 사진 public 자산과 helper/재사용 Avatar만 제공한다. 조직도/직원 상세 제품 화면·메뉴는 미구현이며 전체 골든 G1~G10 실행 완료를 뜻하지 않는다. 전체 `pnpm verify`·실제 Next 서버 HTTP200 URL·인증/인가 회귀·브랜치 리뷰·병합 준비는 독립 Task 2 범위다. 공유 DB 적용·main 병합·push는 수행하지 않았다.

관련: [[PROGRESS]], [[11-TESTING]], [통합 계획](../../plans/2026-10-17-approved-portraits-integration.md).
