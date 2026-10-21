---
title: "Vercel Services 구성 검증"
status: final
tags: [sol-radar, deployment, testing]
updated: 2026-10-21
---

# Vercel Services 구성 검증

확정 구성: `web` 공개 `/(.*)`, `ai` 내부, `web → ai`의 `AI_GATEWAY_URL` binding. 서비스 이름·공개 범위·binding 및 eval/decision/worker 제외는 2026-10-21 사용자가 최종 승인했다. 실제 Vercel 배포를 수행하지 않았다.

## 검증 기록

- `uv run --frozen --project services/ai pytest services/ai/tests/test_vercel.py -q`: 처음에는 진입점 미존재로 5건 실패. 구현 뒤 5건 통과. `_vendor` 배치 시험을 추가한 최종 실행은 **6 passed**. 기존 Starlette/httpx deprecation warning 1건.
- 분리된 임시 서비스 폴더에서 `src/sol_ai`와 Vercel의 `_vendor/sol_ai` 양쪽 배치를 확인했다. 실제 서비스 루트 계산, 공유 실행 규칙·mock fixture 로딩, `/health`와 `/parse`의 기존 응답, `/ai/health` 404, import 중 모델 접속 없음, 잘못된 런타임 모드 기동 거부, 명시 경로 우선을 검사했다.
- `uv run --frozen --project services/ai python services/ai/prepare_vercel.py`: **exit 0**. 생성물은 gitignored `_vercel_data/`다.
- `pnpm -C web exec vitest run server/health/health.service.test.ts server/health/ai-status.service.test.ts`: **2 files, 41 tests passed**. 함수 호출 때 binding URL을 다시 읽고 base path를 보존한다.
- `pnpm dlx vercel@65.0.0 dev -L --listen 127.0.0.1:3108`: CLI 65.0.0, `ai [FastAPI]`·`web [Next.js]` 감지, 두 서버 기동. 프로젝트 연결·클라우드 배포 없이 실행했다.
- `GET http://127.0.0.1:3108/health/ready`: **200**, 아래 응답. 같은 요청에 ai의 `GET /health 200 OK` 로그를 확인했다. web이 주입된 binding으로 내부 ai를 호출한 증거다.

```json
{"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok","ai":"mock"}}
```

- 공개 `POST http://127.0.0.1:3108/parse`: **200 HTML**, `<!DOCTYPE html><html lang="ko"...`로 시작하는 웹 응답. web의 `POST /parse` 로그만 발생하며 Python parse JSON 응답으로 라우팅되지 않는다. 로컬 프로세스는 확인 뒤 종료했다.
- `git diff --check`: **exit 0**.
- `pnpm verify`: **exit 0**. 루트 **770 passed**, 웹 **219 files / 6,831 tests passed**, AI **1,517 passed**, decision **152 passed**. 공통 서식·DB 타입·토큰·색 검사, 웹 타입·린트·계층 검사와 Next.js 프로덕션 빌드도 통과했다. [전체 실행 로그](20261021-vercel-services-verify.txt).

## 독립 검토

별도 읽기 전용 검토 에이전트가 필수 수정 결함 없음으로 보고했다. Python builder는 buildCommand 실행 뒤 파일을 다시 수집하므로 생성 자료가 포함된다. Vercel ASGI runtime은 lifespan을 실행하고, uv가 일반 설치한 패키지는 `_vendor`에 배치되어 경로 깊이가 유지된다. 관련 공식 소스: [Python builder](https://github.com/vercel/vercel/blob/main/packages/python/src/index.ts), [uv 설치](https://github.com/vercel/vercel/blob/main/packages/python/src/uv.ts), [FastAPI lifespan](https://vercel.com/docs/frameworks/backend/fastapi#startup-and-shutdown).

## 검증 범위

실행 모드는 **mock**이다. 회사 GPU/Qwen API 접속·실제 모델 추론·Vercel 클라우드 프로덕션 빌드/배포·대용량 요청 제한은 검증하지 않았다. 외부 worker는 기존 Compose gateway를 사용한다. 웹 AI 상태는 Vercel gateway의 상태를 보여 주며 외부 worker gateway의 상태를 보증하지 않는다. 기존 인력 데이터·DB·점수 관련 미커밋 변경은 이번 변경에 포함하지 않았다.

## 관련 문서

- [[../10-DEPLOYMENT|배포 설계]]
- [스펙](../../polaris/specs/done/2026-10-21-vercel-services.md)
- [계획](../plans/2026-10-21-vercel-services.md)
