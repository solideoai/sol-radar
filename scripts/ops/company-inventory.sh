#!/usr/bin/env bash
# 회사 내부에서 실행하는 읽기 전용 점검. 환경·컨테이너 인자·비밀값은 출력하지 않는다.
set -euo pipefail

if [ "$#" -ne 1 ] || [[ ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  echo '사용법: bash scripts/ops/company-inventory.sh <기존_Redis_컨테이너>' >&2
  exit 1
fi

hostname
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker inspect "$1" --format 'Redis network: {{range $name, $config := .NetworkSettings.Networks}}{{println $name}}{{end}}'
if command -v ss >/dev/null 2>&1; then
  ss -lnt '( sport = :6379 or sport = :6380 )'
fi
curl --silent --show-error --max-time 5 --output /dev/null --write-out 'loopback Gateway HTTP %{http_code}\n' http://127.0.0.1:6380/health || true
curl --silent --show-error --max-time 10 --output /dev/null --write-out 'public Gateway HTTP %{http_code}\n' https://acropolissg.com/redis/health || true
