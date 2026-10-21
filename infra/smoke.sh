#!/usr/bin/env bash
# SOL RADAR 기동 검사. 비밀값을 출력하지 않는다(set -x 금지).
# 사용: REDIS_URL=redis://:<비밀번호>@127.0.0.1:6380 infra/smoke.sh
# 호스트 포트는 compose 와 같은 *_HOST_PORT 변수를 읽는다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/infra/compose.yaml")
WEB_URL="${WEB_URL:-http://127.0.0.1:3000}"
REDIS_PORT="${REDIS_HOST_PORT:-6380}"
STEP="시작"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
trap 'echo "smoke 실패: ${STEP}" >&2; exit 1' ERR

STEP="1 서비스 4개 healthy"
HEALTH="$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}')"
for svc in redis qdrant ai-gateway worker; do
  echo "$HEALTH" | grep -qx "$svc healthy"
done
echo "ok 1 서비스 4개 healthy"

STEP="2 web /health/live"
curl -fsS "$WEB_URL/health/live" >/dev/null
echo "ok 2 web live"

STEP="3 web /health/ready"
CODE="$(curl -s -o "$TMP" -w '%{http_code}' "$WEB_URL/health/ready")"
[ "$CODE" = "200" ]
node -e '
const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).checks ?? {};
process.exit(["db", "redis", "storage"].every((k) => c[k] === "ok") ? 0 : 1);
' "$TMP"
echo "ok 3 web ready (db·redis·storage)"

STEP="4 worker:ping (REDIS_URL 은 호출한 셸이 준다)"
[ -n "${REDIS_URL:-}" ]
pnpm -C "$ROOT/web" worker:ping >/dev/null
echo "ok 4 worker ping"

STEP="5 redis volume 유지"
VALUE="$(date +%s)"
"${COMPOSE[@]}" exec -T redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli SET sol:smoke '"$VALUE" >/dev/null
"${COMPOSE[@]}" restart redis >/dev/null
for _ in $(seq 1 30); do
  "${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | grep -qx 'redis healthy' && break
  sleep 2
done
GOT="$("${COMPOSE[@]}" exec -T redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli GET sol:smoke')"
[ "$GOT" = "$VALUE" ]
echo "ok 5 redis 재시작 뒤 값 유지 (호스트 포트 ${REDIS_PORT})"

echo "smoke 통과"
