---
title: "운영 DB DEMO 백업 표 생성(02b)"
status: done
tags: [sol-radar, evidence, demo-cleanup, production]
updated: 2026-10-26
---

# 운영 DB DEMO 백업 표 생성(02b)

- 대상: 운영 Supabase `brtysdocxemrqhdezzqg`(MCP `get_project_url`), 접속 역할 `postgres`, PostgreSQL 17.11
- 실행: 2026-10-26, 사용자 승인("02b 진행해") 뒤 Supabase MCP `execute_sql` 로 `02b-backup-in-db.sql` 의 `begin`…`commit` 을 한 번에 보냈다. 오류 없음.
- 실행 전: 백업 스키마 없음, 이벤트 트리거 7개는 Supabase 기본(`ensure_rls` 등)

## 결과

- `demo_cleanup_20261026.backup` 26행(meta 1 + 표 25). 26행 모두 `sha_ok=true`.
- 표 25개의 행 수·sha256 이 [[prod-01-before|정리 전 조회]] Q2 B 절과 모두 같다. meta sha256 `c44864ced3bd6aa5a4f627b1fb1e58fd05f14738f9c7b74c23d7bd9b5057b391`(대상 19건).
- 권한: `public`·`anon`·`authenticated`·`service_role` 의 스키마 USAGE·CREATE·표 권한이 모두 false, RLS 켜짐.

## DB 밖 사본(pg_dump)

- 사용자가 로컬에서 실행: `pg_dump` 17.2(Homebrew), `--data-only --table=demo_cleanup_20261026.backup`, 2026-10-26 17:50 KST.
- 파일: 저장소 밖 `~/sol-radar-backups/demo-cleanup-20261026-backup.sql`, 671,137 bytes, sha256 `2332e5f1d5131cbfaba02346996b1d75134524ea3fcf650131dcdd6361472ceb`. 가상 직원 명부 스냅샷이 들어 있어 커밋하지 않는다.
- 확인: 격리 컨테이너(`supabase_db_sol-radar-live78`)에 임시 DB 를 만들어 실행서의 "pg_dump 사본 복원" 표에 넣었다. 26행 모두 `sha_ok`, 행 수·sha256 이 운영 백업 표와 26/26 같다. 임시 DB 는 지웠다.

정리(보존 기간 뒤, 사용자 확인 뒤): `drop schema demo_cleanup_20261026 cascade;`
