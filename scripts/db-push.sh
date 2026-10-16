#!/usr/bin/env bash
# 배포는 데이터부터. 마이그레이션을 '대시보드 직접 SQL'이 아니라 CLI로 적용한다.
#   - 대시보드에서 직접 실행하면 이력이 남지 않는다. 이 스크립트가 정식 경로다.
#   - 무료 티어에선 빌드(Vercel, IPv4)에서 DDL '적용'이 막힌다. vercel-build.sh 는 dry-run
#     '검증'만 하고(fail-closed), 실제 '적용'은 IPv4 Session pooler 로 이 스크립트가 out-of-band 로 한다.
# SUPABASE_DB_URL 은 .env.local 에 둔다(Supabase → Connect → Session pooler URI, 비밀번호 포함, gitignore).
set -euo pipefail

# .env.local 에서 SUPABASE_DB_URL 만 읽어온다(값 자체는 화면에 출력하지 않는다).
if [ -z "${SUPABASE_DB_URL:-}" ] && [ -f .env.local ]; then
  raw="$(grep -E '^SUPABASE_DB_URL=' .env.local | head -n1 | cut -d= -f2-)"
  raw="${raw%\"}"; raw="${raw#\"}"   # 양쪽 큰따옴표 제거
  raw="${raw%\'}"; raw="${raw#\'}"   # 양쪽 작은따옴표 제거
  export SUPABASE_DB_URL="$raw"
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "❌ SUPABASE_DB_URL 이 없습니다. .env.local 에 Session pooler URI 를 넣으세요 (Supabase → Connect → Session pooler)." >&2
  exit 1
fi

echo "▶ 마이그레이션 적용(직접 pg 연결, 대시보드 직접 SQL 아님)"
# supabase db push 는 무료 티어 Session pooler에서 인증이 완결 안 됨(db-verify.mjs 주석 참고).
# 그래서 직접 pg로 supabase/migrations/*.sql 중 아직 적용 안 된 것만 순서대로 적용하고 이력에 남긴다.
export SUPABASE_DB_URL
node scripts/db-push.mjs
echo "✅ 적용 완료"
