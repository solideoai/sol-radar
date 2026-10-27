# 운영 DB migration 적용 기록 (2026-10-27)

사용자 승인("다음 2번 하자") 뒤 운영 Supabase(ref brtysdocxemrqhdezzqg)에 적용했다. 웹 코드(main 8cfaac31)는 먼저 Vercel 에 배포돼 있었다.

## 적용

- 명령: `NODE_EXTRA_CA_CERTS=$HOME/.supabase/prod-ca-2021.crt bash scripts/db-push.sh`
- 적용 전 `--check`: 이미 적용 60개, 미적용 2개(아래 둘뿐)
- 결과
  - `20261027000500_document_processing_lease.sql` ✓
  - `20261027000600_signup_consents.sql` ✓

## 적용 뒤 확인 (읽기 전용 조회)

| 항목 | 결과 |
|---|---|
| 이력 | 62개, 새 버전 `20261027000500`·`20261027000600` |
| 첨부 처리 함수 5개 | `claim_document_processing`·`document_processing_candidates`·`fail_document_download`·`fail_document_parse`·`release_document_processing`, 모두 security invoker, 실행 권한은 service_role 만 |
| `public.user_consents` | RLS 켬, 정책 `본인 동의 기록만 읽기`(select), authenticated·service_role 은 select 만, anon 권한 없음, 행 0 |
| `public.handle_new_user` | md5 9108156e… → b8385cda…, `consent_required` 검사 포함, 트리거 `on_auth_user_created` 켜짐 |
| `bash scripts/db-verify.sh` | ✓ DB 연결·마이그레이션 62개·RLS 활성화·화면 역할 권한·뷰·함수 확인 |

## 되돌리기

- 가입 트리거: [handle_new_user-before.sql](handle_new_user-before.sql) 로 `create or replace` 한다.
- `user_consents` 표와 첨부 처리 함수는 기존 데이터를 바꾸지 않으므로 남겨 두어도 동작에 영향이 없다.
