---
title: "Vercel 다중 서비스 구성·로컬 검증"
status: review
tags:
  - sol-radar
  - ops
  - test
updated: 2026-10-21
---

# Vercel 다중 서비스 구성·로컬 검증

서비스 이름·공개 경로·바인딩·외부 worker 운영 방식은 최종 구성 제시 뒤 사용자의 커밋·푸시 요청으로 승인되었다(2026-10-21). 클라우드 배포는 하지 않았다.

## 변경

- 루트 `vercel.json`: `ai`(FastAPI, 내부 전용)·`web`(Next.js, `/(.*)` 공개), 호출자 `web`에 `AI_GATEWAY_URL` 서비스 바인딩.
- `services/ai/app.py`: 기존 앱 팩토리를 ASGI `app`으로 내보낸다. 기존 웹 코드는 요청 시점에 이미 같은 바인딩 변수를 읽으므로 변경하지 않았다.
- `services/ai/vercel_build.py`: 정본 `infra/run-modes.json`·mock 추출/Kev fixture를 서비스 번들 내부 `runtime_data/`로 복사한다. `.gitignore`에 생성 경로를 추가했다.
- `services/ai/tests/test_vercel.py`: `_vendor/sol_ai` 패키지 배치와 서비스 데이터만 남기고 원래 저장소를 제거한 별도 프로세스에서 `/health`·mock `/extract` 성공 확인.
- `eval`은 HTTP 서버 없는 CLI, `decision`은 회사 GPU 모델 서버라 Vercel 서비스에서 제외했다. 외부 worker는 기존 Compose AI gateway를 사용한다.

## 검증

|검사|결과|증거|
|---|---|---|
|Vercel 공식 JSON Schema|오류 0|2026-10-21 `https://openapi.vercel.sh/vercel.json`을 받아 `jsonschema.Draft7Validator`로 루트 설정 검증|
|커밋 전 `pnpm verify` (`origin/main` `cb972ce` 기준)|exit 0. 루트 765·웹 6,830·AI 1,512·decision 152 tests 및 웹 프로덕션 빌드 통과|[로그](20261021-commit-verify.txt)|
|`pnpm verify:changed`|exit 0. 루트 163·웹 286·AI 101·decision 57 tests 통과. 서식·타입·린트·계층·토큰·DB 타입 검사 포함|[로그](20261021-verify-changed.txt)|
|Vercel CLI 65.0.0 `dev -L`|`ai`·`web` 인식·기동. 첫 화면 200, API 인증 401, `web → ai` 상태 확인 `checks.ai=mock`|[응답](20261021-local-smoke.json)|
|`pnpm -C web build`|별도 복사본에서 컴파일·TypeScript·정적 페이지 41개 생성 성공, exit 0|[로그](20261021-web-build-retry.txt)|
|루트 `node_modules` 없는 상태의 `pnpm -C web exec tsc --noEmit`|별도 복사본에서 exit 0. 루트 패키지 설치 없이 웹 타입 검사 가능|직접 실행 결과|
|`git diff --check`|exit 0|직접 실행 결과|

- 작업 폴더에는 기존 Next.js 개발 서버가 있어 `vercel dev` 웹 기동과 충돌했다. 기존 프로세스는 유지하고, 환경변수 파일을 제외한 별도 임시 복사본에서 재검증했다.
- 최초 임시 복사본의 `web/node_modules` 외부 symlink는 Turbopack root 제한으로 실패했다. 복사본의 `web/`에서 락파일로 의존성을 설치해 해결했다.
- 최초 임시 웹 빌드는 복사본에 루트 `scripts/`가 없어 `@test-harness/*` 타입 경로를 찾지 못했다([실패 로그](20261021-web-build.txt)). 실제 저장소처럼 `scripts/`를 포함한 뒤 통과했다. 제품의 타입 검사 설정은 변경하지 않았다.
- 로컬 smoke는 mock 모드와 가짜 Supabase 접속 설정을 사용했다. DB·Redis·MinIO를 연결하지 않아 `/health/ready`는 503, `checks.db/redis/storage=unavailable`이다. AI 바인딩은 성공했다. 공개 `/extract`는 웹의 HTML 응답이며 AI JSON endpoint로 전달되지 않았다.
- 작업 중 다른 테스트 정리 변경도 함께 존재했다. 변경 범위 검증 숫자는 해당 실행 시점의 작업 폴더 기준이다. 이번 변경은 다른 테스트 삭제나 검증 설정 변경을 포함하지 않는다.
- 기존 FastAPI TestClient의 `httpx` deprecation warning이 두 Python 검사에서 1개씩 있었다. 검사 실패는 없었다.
- 로그인 후 E2E, 실제 Vercel 클라우드 배포, 외부 worker·Redis·MinIO 연결은 이번 검증에 포함하지 않았다. 커밋 전에는 다른 작업의 미커밋 변경을 제외한 최신 원격 `main` 기준 별도 작업 폴더에서 전체 `pnpm verify`를 실행해 통과했다.

## 배포 전 코드·인프라 리뷰

`predeploy-review`의 code·infra 항목으로 이번 변경만 점검했다. 코드 내 비밀값·신규 공개 AI route·DB 변경·검증 약화 없음. 바인딩 값은 빌드나 middleware에서 사용하지 않는다. mock 데이터는 Dockerfile과 동일한 두 디렉터리만 복사하며 녹음 데이터·학습셋·환경변수 파일은 복사하지 않는다. 정본 API 경로와 회사 모델 레지스트리 검증을 유지한다.

실제 운영 준비는 외부 인프라 주소·실행 모드 정합성을 연결 환경에서 검증한다. Vercel `Root Directory`는 저장소 루트로 두고 `AI_GATEWAY_URL`은 수동 등록하지 않는다.

## 관련 문서

- [[10-DEPLOYMENT|배포·실행 구성]]
- [[PROGRESS|진행 상황]]
