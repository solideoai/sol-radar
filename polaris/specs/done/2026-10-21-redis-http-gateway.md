# Redis HTTP Gateway Phase 1

로컬 구현·검증 완료(2026-10-21). 운영 배포와 다음 단계는 별도 승인 대상이다. 결과: `docs/evidence/redis/20261021-phase1-redis-gateway.md`.

사용자가 승인한 계획: `docs/plans/2026-10-21-redis-gateway-supabase-storage-migration.md` Task 2와 최신 Phase 1 실행 지시. 로컬 코드·시험만 수행한다.

- 기존 Next.js API를 frontend/redis-api 역할로 재사용한다. 신규 범용 Redis 명령 서버·NestJS는 만들지 않는다.
- 회사 Redis6379 유지, HTTP host publish127.0.0.1:6380, Nginx /redis/ 기존 프록시 불변.
- frontend는 분석/수집 POST만 HTTPS로 전달하고 기존 Auth/CSRF/가입·조직 검증을 수행한다. backend는 서비스 token+사용자 JWT를 검증하고 기존 RBAC/RLS·limiter·멱등·BullMQ를 사용한다.
- 서비스 token은32바이트 이상 난수(hex64 또는 base64url43자 이상), 서버 env 전용. frontend에 Redis TCP URL·service role 금지.
- 요청16KiB·전체15초 상한, 고정 upstream·redirect 금지·정상 TLS 검증·응답 계약 검사·안전한503. 재시도는 최대1회, 동일 업무 키/본문. 정상 202/pollUrl·409·429/Retry-After·상태 조회 유지.
- Gateway는 allowlist5경로만 허용한다. /health는 서비스 token만, 나머지 업무 경로는 사용자 JWT 추가. 미인증401, 권한403, 타 조직404. 비허용 화면/구형API/Server Action/정적 파일 차단.
- Phase 1 readiness는 기존 MinIO/AI probe를 재사용한다. Storage/parser·durable dispatch·예산 원자적 예약은 후속 작업이다.
- 테스트: 실패→성공 계약 시험, 기존 인증/큐/예산 회귀, role/env/Compose 검사, 실제 로컬 Redis 큐·rate/idempotency 왕복, Next HTTP 바인딩/차단 smoke, 전체 pnpm verify, 독립 리뷰.
- 회사 서버·Docker 생성/삭제/재시작·Nginx·운영DB·데이터삭제·Vercel production 변경 금지. Phase 1 보고 후 다음 단계 승인 요청.
