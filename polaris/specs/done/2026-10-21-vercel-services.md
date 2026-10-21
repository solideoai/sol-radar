---
title: "Vercel Services 배포 설정"
status: done
tags: [sol-radar, deployment]
updated: 2026-10-21
---

# Vercel Services 배포 설정

사용자 요청: 저장소 루트의 `vercel.json`으로 여러 서비스를 한 Vercel 프로젝트에 배포한다. 호출자에 내부 바인딩을 선언하고 기존 URL 사용과 공개 경로를 맞춘다. 변경·검증 뒤 최종 JSON을 보여 주고 서비스 이름, 공개 경로, 바인딩을 사용자에게 확인받는다. 실제 배포는 이 작업에 포함하지 않는다.

## 확정 구성 (2026-10-21 사용자 승인)

- `web`: `web/`, Next.js. 공개 `/(.*)`는 기존 페이지·`/api/v1`·인증·health 경로를 그대로 전달한다.
- `ai`: `services/ai/`, FastAPI. 공개 rewrite 없이 내부로 둔다.
- `web → ai`: `AI_GATEWAY_URL` URL 바인딩. 웹의 함수는 요청 시 env를 읽는다. 빌드·proxy·브라우저에서 바인딩을 쓰지 않는다.
- `eval`: HTTP 진입점 없는 평가 CLI이므로 배포 서비스에서 제외한다.
- `decision`: 검증된 모델 패키지·회사 GPU를 쓰는 서버이므로 기존 외부 서버를 유지한다. AI는 기존 `QWEN_BASE_URL`·`KEV_BASE_URL`을 사용한다. 임의 mock 전환이나 새로운 공개 proxy는 만들지 않는다.
- 외부 BullMQ worker는 내부 Vercel URL에 접근할 수 없다. 기존 Compose gateway를 사용한다. 따라서 웹의 AI 상태 확인은 Vercel gateway 상태이며 외부 worker gateway의 상태 보증이 아니다. 모드·모델 설정을 맞춘다. 사용자가 서비스 이름·공개 범위·바인딩·외부 worker 유지 구성을 최종 승인했다.

## 수용 기준

1. 서비스별 root/framework/entrypoint/buildCommand, 호출자 바인딩 네 필드, web catch-all만 있는 구성.
2. AI 서비스만 복사한 환경에서 공유 실행 규칙·mock fixture가 포함되고 `/health`·`/parse`가 기존 계약대로 동작한다.
3. Python 앱을 빌드 중 import해도 런타임 설정 검증이나 외부 모델 접속을 시작하지 않는다. 실제 실행 시 기존 실행 모드·승인 검사를 유지한다.
4. URL 바인딩을 직접 설정하지 않는다는 안내, Vercel 프로젝트 Root Directory `.` 안내, 외부 서비스·환경 변수 안내.
5. `pnpm verify`, AI 패키징 시험, `vercel dev -L` 검증 시도와 실제 결과 기록. 검증은 구현과 다른 에이전트도 검토한다.

## 범위 밖

GPU/평가 CLI/worker의 Vercel 이전, DB 변경, 인증 우회, 신규 공개 AI API, 실제 모델 호출·배포.

## 관련 문서

- [배포 설계](../../../docs/10-DEPLOYMENT.md)
- [구현 계획](../../../docs/plans/2026-10-21-vercel-services.md)
