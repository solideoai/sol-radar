# 첫 배포 안내

2026-10-21 승인된 SOL RADAR Vercel 구성의 정본은 [10 배포](../10-DEPLOYMENT.md)의 **Vercel 웹·AI 서비스 배포** 절입니다. 웹과 내부 AI를 함께 배포하는 루트 `vercel.json` 구성이며, Compose 데모는 별도로 유지합니다.

구성·로컬 서비스 smoke·웹 빌드는 확인됐지만 이 구성의 클라우드 배포 성공은 구성 검증 기록에서 확인되지 않습니다. 운영 사이트 관찰과 이 Vercel 구성의 배포 성공 증거는 구분합니다. 검증 범위와 최초 실패·재검증 기록은 [Vercel 구성 증거](../evidence/vercel/20261021-configuration.md)에 있습니다.

## 프로젝트 설정

- Root Directory는 **저장소 루트**(`.` 또는 기본 빈 값)입니다. `web/`를 지정하지 않습니다.
- 서비스별 framework·install·build 설정은 [루트 vercel.json](../../vercel.json)을 따릅니다. `web`은 공개 경로, `ai`는 내부 전용입니다.
- `AI_GATEWAY_URL`은 `web → ai` 서비스 바인딩으로 생성합니다. 수동 환경변수로 같은 값을 덮어쓰지 않습니다.
- worker·Redis·Qdrant·결정 모델은 외부 환경에 유지하며, 파일은 private Supabase Storage를 사용합니다(ADR-048). 웹과 외부 worker의 Supabase·Redis·실행 모드가 같아야 요청 처리가 이어집니다.
- 환경변수 목록과 외부 연결 조건은 [10 배포](../10-DEPLOYMENT.md)를 따릅니다. `SUPABASE_SERVICE_ROLE_KEY`·공공 API 서비스키·DDL용 DB 연결 문자열을 웹 배포 설정에 옮기지 않습니다. 웹 DB 접근은 anon 키와 사용자 세션·RLS를 사용합니다.

## 배포 전 확인

1. 통합 코드의 `pnpm verify`와 영향 흐름 검증 결과를 확인합니다(문서만 바꾼 경우는 [17 검증 정책](../17-CLAUDE-IMPLEMENTATION.md)의 문서 전용 기준).
2. `/predeploy-review`로 변경 관련 배포 검토를 합니다.
3. 실제 배포에 앞서 Vercel 프로젝트 환경변수·외부 인프라 접근과 Supabase Auth의 배포 URL 설정을 확인합니다.
4. 운영 DB 적용과 실제 배포는 사용자가 승인한 범위에서 별도로 진행하고 결과를 기록합니다. 구성 파일이 있다는 것만으로 배포 완료로 표시하지 않습니다.

## 과거 템플릿과 달라진 점

기존 웹 단독 배포의 Root Directory=`web`, `pnpm vercel-build`, `web/scripts/vercel-build.sh`, `web/scripts/verify-db.mjs`, 전용 DB 검사 역할 생성 절차는 현재 Vercel 서비스 구성에 적용하지 않습니다. 삭제된 wrapper를 복구하거나 이를 전제로 환경변수·DB 역할을 추가하지 않습니다. 과거 템플릿 내용은 Git 이력에 남아 있습니다.

## 관련 문서

- [10 배포](../10-DEPLOYMENT.md)
- [09 보안](../09-SECURITY.md)
- [17 구현·검증 정책](../17-CLAUDE-IMPLEMENTATION.md)
- [Vercel 구성 검증 기록](../evidence/vercel/20261021-configuration.md)
