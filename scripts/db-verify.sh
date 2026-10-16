#!/usr/bin/env bash
# 운영 DB의 연결·마이그레이션 이력·RLS 활성화를 확인한다(적용은 db-push.sh).
# SUPABASE_DB_URL 은 루트 .env.local 에서 읽는다(값은 화면에 찍지 않는다).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "${SUPABASE_DB_URL:-}" ] && [ -f .env.local ]; then
  raw="$(grep -E '^SUPABASE_DB_URL=' .env.local | head -n1 | cut -d= -f2-)"
  raw="${raw%\"}"; raw="${raw#\"}"
  raw="${raw%\'}"; raw="${raw#\'}"
  export SUPABASE_DB_URL="$raw"
fi

node scripts/db-verify.mjs
