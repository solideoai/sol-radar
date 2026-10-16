#!/usr/bin/env bash
set -euo pipefail

# DB가 연결된 운영 배포는 이력·RLS 확인을 통과해야 한다. 적용 자체는 별도 작업이다.
# DB 없는 사이트는 URL과 REQUIRE_DATABASE를 모두 설정하지 않는다.
if [ "${VERCEL_ENV:-}" = "production" ] && { [ "${REQUIRE_DATABASE:-}" = "1" ] || [ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; }; then
  echo "▶ 운영 배포: 마이그레이션·RLS 검증"
  node scripts/verify-db.mjs
fi

pnpm build
