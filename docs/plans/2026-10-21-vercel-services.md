---
title: "Vercel Services 구현 계획"
status: final
tags: [sol-radar, deployment, plan]
updated: 2026-10-21
---

# Vercel Services 구현 계획

**Goal:** web 공개 서비스와 ai 내부 서비스를 한 프로젝트로 구성하고 호출자 바인딩을 검증한다.
**Spec:** [정본 스펙](../../polaris/specs/done/2026-10-21-vercel-services.md).
**Architecture:** 기존 Next.js Route Handler와 Python gateway를 유지한다. 평가 CLI와 회사 GPU 모델은 외부에 둔다. AI의 저장소 공용 자료를 빌드 시 서비스 안으로 복사한다.
**Tech Stack:** Next.js 16, FastAPI, pnpm, uv, Vercel Services.

사용자가 요청한 최종 확인 순서에 따라 작업 폴더에 검토 가능한 변경을 준비한다. 기존 미커밋 변경과 겹치는 영역은 수정하지 않는다. 이 문서는 배포 승인을 의미하지 않는다.

## 단계와 완료 기준

- [x] AI 진입점·배포 자료: `services/ai/app.py`, `services/ai/prepare_vercel.py`, `services/ai/src/sol_ai/paths.py`, `services/ai/src/sol_ai/run_mode.py`, `services/ai/tests/test_vercel.py`. 서비스 루트만 있는 임시 디렉터리에서 기동·health·parse·mock fixture를 검사한다. import 시 네트워크 없음과 런타임 모드 검증을 확인한다.
- [x] 서비스 설정·웹 호출 확인: 루트 `vercel.json`, `.gitignore`, `web/.env.example`. web→ai 바인딩을 요청 시점에서 소비하는 기존 health 경로를 확인하고 바인딩 URL의 경로를 보존하는 시험을 추가한다.
- [x] 배포 안내: `docs/10-DEPLOYMENT.md`에 확인 대기 구성·env·외부 worker 경계를 기록한다. `docs/PROGRESS.md`에 결과를 추가한다.
- [x] 검증: 각 변경의 시험, 전체 `pnpm verify`, `vercel dev -L`로 로컬 서비스 기동을 확인한다. 독립 검토 후 수정한다. CLI·네트워크·외부 인프라로 확인하지 못한 내용은 결과에 명시한다.
- [x] 최종 확인: 2026-10-21 사용자가 최종 JSON의 서비스 이름·공개 여부·바인딩과 eval/decision/worker 제외를 승인했다. 실제 배포는 별도 작업이다.

## 검토 초점

- AI 서비스 경계 밖 파일이 없을 때의 실행, 개발용 파일·비밀이 번들에 섞이지 않는지.
- build import와 function runtime 설정 구분, 기존 hosted 승인 검사 유지.
- `/api/v1`이 Python으로 잘못 라우팅되지 않는지, AI가 공개되지 않는지.
- 내부 바인딩과 외부 worker의 연결 경계를 혼동하지 않는지.
- root와 service별 빌드 명령, Python workspace 설치가 실제 CLI에서 가능한지.
