---
title: "10-25 운영 적용 ①DB migration·②사진 버킷"
status: done
tags: [sol-radar, evidence, integration, production]
updated: 2026-10-26
---

# 10-25 운영 적용 ①DB migration·②사진 버킷

근거: [[20261025-release-runbook|10-25 릴리스 실행서]] §3·§4. 단계마다 사용자 승인을 따로 받았다(세션 sol-radar-40).
대상은 운영 Supabase 프로젝트 `sol-radar`(ref `brtysdocxemrqhdezzqg`, ap-southeast-2)다. 비밀번호·service role 키·접속 문자열은 이 문서에 적지 않는다.

> [!summary] 결론
> - ① migration 10개를 순서대로 적용했다. 실패 0. DB 이력 60개, 마지막 `20261025000310`, `storage.objects` 트리거 `enforce_own_photo_quota` 활성.
> - ② `profile-photos` 버킷(private·2097152 바이트·jpeg/png/webp)을 사용자가 대시보드에서 만들었다. 사후 검증 8개 PASS.
> - 부수 효과: Supabase CLI 임시 역할 `cli_login_postgres` 생성·갱신, CLI 연결 파일 생성 뒤 삭제, 버킷 크기 한도 첫 입력 오류(수정함). 아래 "부수 효과" 절.

## 사전 확인

- 대상 확인: 같은 Supabase 계정에 다른 앱 프로젝트(`janjanheyism`, ap-northeast-1)가 있다. `.env.local` 의 `SUPABASE_DB_URL` 사용자·호스트만 뽑는 명령을 사용자가 직접 실행했고 `postgres.brtysdocxemrqhdezzqg@aws-0-ap-southeast-2.pooler.supabase.com` 이었다(비밀번호는 출력하지 않는 명령).
- 사용자 SQL(Supabase SQL 편집기): 새 10개 `in_history` 모두 false, 확인 가능한 대표 객체 8개 모두 false, `can_trigger=true`, `rolbypassrls=true`.
- 복구 수단(`supabase backups list`): 매일 물리 백업, PITR 꺼짐. 적용 전 마지막 백업 2026-10-24T21:45:42Z(10-25 06:45 KST).
- 10개 파일의 최상위 문장에 표·열 삭제, `delete`·`update`·`truncate` 가 없다. 감사 action 제약은 `20261022000300` 목록에 값 2개를 더한 것이라 기존 행이 모두 통과한다. 1차 복구는 실행서 §3 의 되돌리기 migration 이다.
- 로컬 main 을 `5140feb9` 로 fast-forward 했다(2026-10-25 18:32:43 KST, push 하지 않음). `db-push.sh` 가 실행 폴더의 `supabase/migrations` 만 보기 때문이다.

## ① migration 적용(2026-10-25 18:40:01–18:40:11 KST)

명령(main 폴더): `NODE_EXTRA_CA_CERTS=$HOME/.supabase/prod-ca-2021.crt bash scripts/db-push.sh`. 적용 직전 `--check` 는 미적용 10개, 실행서 순서와 차이 없음.

```
▶ 마이그레이션 적용(직접 pg 연결, 대시보드 직접 SQL 아님)
  이미 적용된 50개는 건너뜁니다
  ✓ 20261024000200_profile_photos.sql
  ✓ 20261024000210_photo_rpc_defaults.sql
  ✓ 20261024000300_member_join_requests.sql
  ✓ 20261024000400_team_member_edit.sql
  ✓ 20261024000410_find_unlinked_member_active.sql
  ✓ 20261025000100_join_request_snapshot_on_approve.sql
  ✓ 20261025000110_profile_photo_quota.sql
  ✓ 20261025000200_procurement_live_metrics.sql
  ✓ 20261025000300_join_request_decide_version.sql
  ✓ 20261025000310_photo_quota_insert_guard.sql
✅ 적용 완료
```

`db-push.sh` 의 마지막 줄 "✅ 적용 완료"는 `--check` 에서도 찍히는 고정 문구다. 판단은 "✓ 파일명" 줄과 재 `--check` 로 한다.

### 적용 뒤 확인

- 재 `--check`: `새로 적용할 마이그레이션이 없습니다 (이미 적용 60개)`, `미적용 0개`.
- `db-verify.sh`: `✓ DB 연결·마이그레이션 60개·RLS 활성화·화면 역할 권한·뷰·함수 확인`(exit 0).
- 읽기 조회(`supabase db query --linked --project-ref brtysdocxemrqhdezzqg`):

| 버전 | 이력 | 대표 객체 |
|---|---|---|
| `20261024000200` profile_photos | true | true |
| `20261024000210` photo_rpc_defaults | true | true |
| `20261024000300` member_join_requests | true | true |
| `20261024000400` team_member_edit | true | true |
| `20261024000410` find_unlinked_member_active | true | 함수 재정의만(null) |
| `20261025000100` join_request_snapshot_on_approve | true | 함수 재정의만(null) |
| `20261025000110` profile_photo_quota | true | true |
| `20261025000200` procurement_live_metrics | true | true |
| `20261025000300` join_request_decide_version | true | true |
| `20261025000310` photo_quota_insert_guard | true | true |

- 이력 60행, 마지막 `20261025000310`.
- `storage.objects` 트리거: `enforce_own_photo_quota`(enabled=O)·`protect_objects_delete`·`update_objects_updated_at`.
- `decide_join_request` 오버로드 1개(4인자). 옛 3인자 서명은 지워졌다.

## ② 사진 버킷

- 사전 조회: `profile-photos` 없음. `bid-documents`·`bid-parsed` 는 private·52428800·CLI 기대 MIME 과 일치하고 소유 표식(`_sol-radar/storage-owner.json`)이 객체 1개씩으로 있다.
- 운영자 CLI(`scripts/ops/ensure-storage-buckets.mjs`)는 service role 이 든 Worker env 가 로컬에 없어 쓰지 않았다. 실행서 §4 대체 절차대로 사용자가 대시보드에서 만들었다(생성 2026-10-25T10:01:10Z = 19:01:10 KST).
- 첫 사후 검증에서 `file_size_limit` 이 52428800(50MiB)이라 FAIL 이었다. 사용자가 2097152 로 고쳤다. 고친 뒤에도 버킷 `updated_at` 은 생성 시각 그대로였다.
- 최종 사후 검증: 읽기 전용 직접 접속(`.env.local` 의 postgres 계정, `begin read only`, 임시 역할 없음)으로 사용자가 실행했다.

```
target: postgres.brtysdocxemrqhdezzqg@aws-0-ap-southeast-2.pooler.supabase.com | transaction_read_only=on
{"id":"profile-photos","public":false,"file_size_limit":"2097152","allowed_mime_types":["image/jpeg","image/png","image/webp"],"created_at":"2026-10-25T10:01:10.067Z","updated_at":"2026-10-25T10:01:10.067Z","has_owner":false,"objects":0,"has_owner_sentinel":false}
policy: profile_photos_delete_own DELETE {authenticated} PERMISSIVE
policy: profile_photos_insert INSERT {authenticated} PERMISSIVE
policy: profile_photos_read SELECT {authenticated} PERMISSIVE
PASS 1 profile-photos 존재
PASS 2 public=false
PASS 3 file_size_limit=2097152
PASS 4 MIME 정확히 jpeg·png·webp
PASS 5 bid-documents 설정·객체 수 불변
PASS 5 bid-parsed 설정·객체 수 불변
PASS 5 버킷은 3개뿐
PASS 6 사진 정책 3개 유지
```

bid 두 버킷은 private·52428800·MIME 그대로, `updated_at` 2026-10-21 그대로, 객체 1개(표식)씩이다.

## 부수 효과

| 무엇 | 언제 | 상태 |
|---|---|---|
| 운영 DB 역할 `cli_login_postgres` 생성 또는 갱신(Supabase CLI `db query --linked` 가 Management API 로 만든다. 로그인 가능, 비밀번호 약 5분 유효) | ① 사후 조회(유효기한 10-25 18:46:45 KST), ② 사전 조회 때 다시 갱신 | 남아 있다. 지우는 것도 운영 변경이라 두었다. 원래 있던 역할인지는 모른다 |
| main 폴더 `supabase/.temp/linked-project.json` 생성(`supabase backups list`, ref·이름만, git 무시 경로) | 10-25 18:38:14 KST | CLI 가 운영을 연결 프로젝트로 보지 않게 지웠다 |
| 버킷 크기 한도 첫 입력 52428800 | 19:01 생성 때 | 2097152 로 고쳤다. 비어 있던 버킷이라 영향 받은 객체 없음 |
| 자리표시자 `<Worker env 절대경로>` 를 그대로 넣은 명령 1회 | ② 중 | 셸이 첫 `<Worker` 에서 멈췄다. CLI 파일 그대로(diff 없음)·엉뚱한 파일 없음·node 실행 안 됨 |

## 남은 위험

- PITR 이 꺼져 있다. 백업 복원은 하루 단위이고 그 뒤 데이터가 사라진다. 문제가 생기면 되돌리기 migration 을 새로 쌓는다.
- 운영 사진 업로드·삭제는 아직 실제로 해 보지 않았다. ③ 배포 뒤 확인 계획에 넣었다([[20261026-deploy-prep|③ 배포 준비]]).
- 버킷 `updated_at` 은 대시보드 수정 뒤에도 바뀌지 않았다. 설정 변경 감지는 값 비교로 한다.
- 동시 업로드 경합에서 진 요청은 HTTP 500(P0001)이다. 차례로 보낸 4번째는 HTTP 400(본문 403)이다(격리 스택 7차와 같은 설계).
- `cli_login_postgres` 역할이 운영 DB 에 남아 있다. 정리 여부는 사람이 정한다.

## 관련 문서

- [[20261025-release-runbook|10-25 릴리스 실행서]]
- [[20261026-deploy-prep|③ 배포 준비]]
- [[20261025-security-review|10-25 보안 검토]]
- [[PROGRESS|진행 상황]]
