---
title: "10-25 통합 보안 검토(사진·N4b)"
status: done
tags: [sol-radar, evidence, security, integration]
updated: 2026-10-25
---

# 10-25 통합 보안 검토(사진·N4b)

근거: `docs/plans/2026-10-25-integration-finish-plan.md` T2. 대상은 `main...integration/freeze-1024`(@17c55609, 프로필 사진 + N4b)이다.
검토자는 security-auditor(읽기 전용)이고, 결과는 높음 0·중간 1·낮음 6이다. 운영 DB 에는 아직 적용하지 않았다.

## 중간 1건 — 수정 완료(0e956774)

- 문제: `decide_join_request`(20261024000300)가 신규 입사자 승인 때 승인 순간의 프로필 값(`display_name`·`declared_department_id`·`declared_job_title_id`)을 신청 스냅숏보다 먼저 썼다. 신청자가 ADMIN 이 신청을 본 뒤 프로필을 바꾸면 ADMIN 이 보지 않은 이름·부서·직급이 명부에 들어갔다.
- 수정: 새 migration `20261025000100_join_request_snapshot_on_approve.sql` 이 함수 본문을 다시 정의한다. 명부 행은 신청 스냅숏(`applicant_name`·`department_id`·`job_title_id`)만 쓰고, 승인 뒤 프로필 부서·직급을 명부 값으로 맞춘다(LINK 승인과 같은 U6 규칙). 서명·`security definer`·`search_path=''`·권한은 그대로다. 기존 migration 은 고치지 않았다.
- 회귀 시험: `scripts/database.test.mjs` "신청 뒤 신청자가 프로필을 바꿔도 승인하면 신청 당시 이름·부서·직급으로 명부에 등록된다". 수정 전 실패(`20261025-join-snapshot-red.txt`), 수정 후 통과(`20261025-join-snapshot-green.txt`).
- 영향 확인: 같은 묶음 8개 시험 통과 — 다른 조직 ADMIN·VIEWER·신청자 본인 결정 거부(조직 격리·ADMIN 전용), 결정된 신청 재결정 거부(`request_not_pending`), 같은 직원 두 번째 승인 거부(`member_taken`), 반려 뒤 멤버십·명부 없음과 재신청, 기존 멤버 연결 시 역할 불변.

## 낮음 6건 — L2 는 수정, 나머지는 해커톤 뒤 개선 과제

| # | 내용 | 개선 방향 |
|---|---|---|
| L1 | 계정 삭제 때 `team_members.user_id` 는 비워지지만 `photo_path` 는 남아 삭제한 계정의 사진이 명부에 계속 보인다 | 삭제 흐름에서 본인 경로(`users/<uid>/…`) 사진 참조를 비우고 객체를 지운다 |
| L2 | 활동 회원은 본인 경로에 사진(2MB 이하)을 개수 제한 없이 올릴 수 있고 DELETE 정책이 없다 | **수정 완료(466d2911)** — 아래 절. members/ 경로 상한은 해커톤 뒤 과제 |
| L3 | `find_unlinked_member` 로 부서·이름 조합을 반복 조회해 가상 명부를 열거할 수 있다(속도 제한 없음, 가상 데이터) | 호출 속도 제한 또는 신청 화면 단계에서만 허용 |
| L4 | 버킷의 형식 검사가 Content-Type 만 본다(XSS 경로는 없음) | 업로드 뒤 서버에서 이미지 머리 바이트 확인 |
| L5 | 서명 URL 유효 시간 1시간(ADR-051 에서 수용) | 화면 체류 시간에 맞춰 줄일지 재검토 |
| L6 | `docs/04-DATABASE.md` 에 `UNIQUE(org_id,name)` 이 남아 있다(실제 스키마와 다름) | 문서 정정 |

확인 필요(검토자 표시): 퇴사(LEFT) 직원의 멤버십이 남는 것이 의도인지, `storage.objects.owner` 외래키가 `delete_my_account` 를 막지 않는지.

## 즉시 악용 위험 — 사진 무제한 업로드(L2) → 수정 완료(466d2911)

- 경로: 공개 회원가입(`web/app/auth/sign-up`) → 이메일 확인 → `status='active'` 프로필 → `profile_photos_insert` 정책이 `users/<uid>/<uuid>.(jpg|png|webp)` 경로를 개수 제한 없이 허용했다. 데이터 노출은 없고 Storage 용량을 소모시킬 수 있었다. 사용자 결정(10-25): 운영 반영 전에 고친다.
- 수정: migration `20261025000110_profile_photo_quota.sql`(기존 migration 은 고치지 않음).
  - 상한: 본인 폴더(`users/<id>/`)마다 객체 3개. 근거: 화면은 사람마다 사진 1장만 보여 준다. 바꾸기는 새 객체를 올린 뒤 포인터를 옮겨 잠깐 2개가 되고, 포인터 저장 실패 1개의 여유를 더했다.
  - 강제 위치: Storage insert 정책(RLS). 브라우저가 사용자 JWT 로 Storage API 에 직접 올리므로 프론트 검사가 아니라 DB 가 막는다.
  - 동시 업로드: `claim_own_photo_slot` 이 폴더마다 `profile_photo_folders` 행 하나를 갱신해 같은 폴더 insert 를 줄 세운 뒤 센다. READ COMMITTED 는 기다린 뒤 새 스냅숏으로 다시 세서 거부하고, REPEATABLE READ 이상은 직렬화 오류로 실패한다. 함수 소유자 postgres 는 BYPASSRLS 라 객체를 RLS 없이 센다(격리 Supabase 에서 `rolbypassrls=t` 확인).
  - 삭제: `profile_photos_delete_own` 정책 — 본인 폴더이면서 계정 사진·조직도 사진·대기 신청 사진 어디에서도 쓰지 않는 객체만 지운다(`own_photo_deletable`). 남의 사진·members/ 사진·쓰는 사진은 0행.
  - 웹: 사진 고르기가 올리기 전과 저장·지우기 뒤에 쓰지 않는 본인 사진을 지운다(`web/components/photo/photo-picker.tsx`). 파일당 2MB·형식 제한은 버킷 설정 그대로다. 기존 객체를 지우는 migration 문장은 없다.
- 회귀 시험(`scripts/database.test.mjs`): "본인 폴더 사진은 3장까지만 …", "본인은 아무 데서도 쓰지 않는 자기 사진만 지우고 …". 수정 전 실패(`20261025-photo-quota-red.txt`), 수정 후 통과(`20261025-photo-quota-green.txt`, 사진·가입 묶음 15/15).
- 동시성 검증(`20261025-photo-quota-concurrency.txt`): 일회용 PostgreSQL 17 에 흉내 + migration 57개를 적용하고 연결 두 개로 경합. 두 격리 수준 모두 최종 3장, 잠금을 뺀 대조군은 4장(검증이 경합을 실제로 잡음).
- 권한 회귀: 기존 사진 경로·읽기·set_my_photo·set_member_photo·가입 신청 시험 그대로 통과. 허용 함수 목록(`scripts/db-verify.mjs`)에 두 함수를 근거와 함께 추가.

## 관련 문서

- [[PROGRESS|진행 상황]]
- [[09-SECURITY|09 보안]]
