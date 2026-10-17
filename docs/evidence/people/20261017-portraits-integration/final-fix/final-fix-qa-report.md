---
title: "최종 시드 보존 수정 독립 QA"
status: final
tags:
  - sol-radar
  - evidence
updated: 2026-10-17
---

# 최종 시드 보존 수정 독립 QA

검토 지적 I1의 격리 실제 보존 검증과 새 전체 verify를 **`ca719cfff0040e00ff8a3eac98558861d9cbc394`**에서 통과했다. 새 제품 결함은 발견하지 않았다. 정상 시드는 두 번 성공하고 모든 식별자가 유지됐다. 비시드 회원이 참여한 `seed-team`에서는 실제 CLI가 명시적으로 거절했으며 팀 내용과 Auth/조직 식별자가 보존됐다.

## 범위와 경계

구현자와 다른 독립 QA다. 제품·테스트·설정·index·HEAD·기존 Task 2 보고서/증거를 수정하지 않았다. 새 쓰기는 이 보고서와 인접 `final-fix-qa-evidence/`, 소유 외부 폴더뿐이다. 별도 에이전트는 사용하지 않았다.

root가 동결한 이전 `406549b`→`ca719cf`의 실제 변경은 `scripts/db-seed.mjs`, `scripts/db-seed.test.mjs`, 웹 3개 파일의 주석이다. 마이그레이션·사진·명부·제품 동작 코드 확장은 없다. root의 재검토 승인을 받기 전 PREP 단계에서는 전용 스택만 재기동했고 빌드·시험·시드를 실행하지 않았다.

소유 workdir/project는 `/tmp/sol-radar-portraits-20261017-qa` / `sol-radar-portraits-20261017-qa`다. 포트와 실제 초기 컨테이너 22개를 확인한 후 모든 CLI 명령에 명시적 `--workdir`를 사용했다. 실제 API `http://127.0.0.1:57621`, DB 57622, Mailpit 57624, SMTP 57625다. 기존 `local-test-target.mjs`가 기대 API와 실제 CLI 상태의 일치를 확인했다. SQL 12개는 보호 기준/저장소와 바이트 동일하며 새 전용 DB에 적용했다. 공유 543xx DB/API에 접근하지 않았다.

새 실행도 기존 전용 runner의 격리 anon/API/SMTP/site/provider/mock 환경을 자식 프로세스에 명시했다. shell로 `.env`를 읽거나 복사하지 않았다. 키·JWT·cookie·실제 세션 자료를 보고/증거에 기록하지 않았다.

## 실제 명령과 결과

검증 순서는 root GO 지시대로 **실제 보존 probe → 소유 JSON/MJS parse·format → 새 전체 verify**다. 성공한 suite의 반복이나 실패 후 재실행은 없었다.

| 실행 | 결과 | 새 증거 |
| --- | --- | --- |
| `supabase start --workdir /tmp/sol-radar-portraits-20261017-qa` | exit 0, 불변 SQL 12개 적용 | `owned-start.sanitized.log` |
| `node .../final-fix-preservation.mjs ca719cfff0040e00ff8a3eac98558861d9cbc394` | exit 0, 아래 실제 정상/거절 보존 단언 통과 | `live-preservation.log`, 실행 script 원본/서식 사본 |
| 실제 `pnpm db:seed` 첫 번째 | exit 0; 200 운영/27 평가/48 부서/12 직급/Auth 5 | `seed-normal-first.log`, `normal-first.json` |
| 실제 `pnpm db:seed` 두 번째 | exit 0; 같은 수량, 모든 Auth/org/운영 인력/평가/부서/직급 식별자 동일 | `seed-normal-second.log`, `normal-second.json`, `normal-seed-stability.json` |
| 비시드 회원 fixture 후 실제 `pnpm db:seed` | **exit 1의 명시적 거절을 기대하여 통과**; 아래 전체 tuple 보존 | `seed-shared-team-refusal.log`, `shared-team-refusal-proof.json` |
| 정확한 소유 fixture 정리 | Auth 5/기존 Auth·조직 ID/200·27 복원 | `fixture-cleanup-proof.json`, `after-exact-fixture-cleanup.json` |
| `pnpm verify` | **첫 시도 exit 0**. 루트 **350/350**, 웹 **879/879**(50 files), format/type/lint/guards/lodestar/tokens/colors/DB types/운영 build 통과 | `verify.log` |
| verify 후 전용 API GET count | 200/27/48/12/Auth 5 | `final-live-counts.json` |

## 실제 I1 보존 proof

정상 시드 두 번으로 만들어진 전용 `seed-team`에 이 QA만의 임시 non-seed Auth 계정과 member membership을 넣었다. 해당 회원의 실제 인증으로 task 1개를 넣었으며, 기존 owner 인증으로 별도의 대기 invitation 1개를 만들었다. 실제 Supabase HTTP를 사용했고 백엔드를 mock하지 않았다.

실제 시드 CLI 직전/직후 `organizations`의 해당 팀 row, 팀의 전체 `memberships`, `tasks`, `invitations`, 전체 Auth ID/email 및 조직 식별자/rows를 캡처하여 비교했다. Auth의 password/session/변경 시각 전체를 캡처하거나 불변이라고 주장하지 않는다. 거절 전 카탈로그/Auth 시드 준비가 실행될 수 있으며 이번 보호 경계는 seed-team 내용과 식별자 보존이다.

| 비교 | 거절 직전 | 거절 직후 | 결과 |
| --- | --- | --- | --- |
| seed-team 전체 row | 1 | 1 | 모든 필드 동일 |
| 전체 team memberships | 3 | 3 | 모든 필드 동일, non-seed 회원 유지 |
| 전체 team tasks | 12 | 12 | 모든 필드 동일, non-seed 회원 task 유지 |
| 전체 team invitations | 2 | 2 | 모든 필드 동일, unrelated pending invitation 유지 |
| Auth ID/email 목록 | 6 | 6 | 동일 |
| 전체 조직 ID/rows | 같은 2개 | 같은 2개 | 동일 |

CLI의 실제 메시지는 `시드 계정 외 회원이 있는 팀의 초기화를 거부합니다.`였다. 출력에는 fixture 이메일·사용자 ID·조직 ID가 없었다. CLI exit 1은 의도한 fail-closed 결과이며 제품 실패로 세지 않는다. 전체 외부 proof 프로세스는 해당 거절과 보존을 단언한 뒤 exit 0이었다.

`shared-team-before-refusal.json` / `shared-team-after-refusal.json`에는 실제 전체 비교 tuple이 있다. 임시 user/task/invitation/membership은 각각 생성 후 받은 정확한 ID로만 정리했다. 원래 seed 회원·작업·초대를 지우거나 정상 시드를 다시 실행하여 정리하지 않았다. 결과 Auth 5개와 그 ID, 조직 ID, 운영 200/평가 27이 복원됐다.

## 증거 보존과 재실행 범위

- 새 전체 verify에 I1 회귀 및 기존 DB/RLS·도메인·API 검사가 포함되어 루트 350/웹 879가 현재 SHA에서 실제 실행됐다. 구현자의 focused 13/13 및 정상 훅 보고와 독립 실행을 구분한다.
- 이전 **Auth 95/95, browser 106/106, 실제 Next 200 GET/hash/decode**는 여전히 **`a05217a05f0fb9adb3553c02978f0e2d531e9610`**에서 실행한 증거다. root가 이번 변경을 시드 보호와 3개 주석으로 한정했으므로 재실행하지 않았다. 현재 SHA에서 새로 실행했다고 표시하지 않는다.
- 과거 실제 populated migration upgrade도 이번에 재실행하지 않았다. 과거 SHA와 기록을 유지한다.
- 모든 기존 Task 2 raw 보고/증거는 그대로 뒀다. 새 실행의 외부 script 원본은 `*.mjs.executed.txt`, 검토용 서식 사본은 `*.mjs`다. `probe-provenance.json`에 실행 원본 해시를 기록했다. 새 JSON은 전부 parse하고 새 JSON/MJS는 Prettier로 서식을 확인했다.
- 이번 bounded QA에는 어댑터 오류·suite 실패·재시도가 없었다. 이전 Task 2의 어댑터 오류나 animation 중간 화면은 그 원래 보고서의 분류 그대로이며 이번 통과로 덮지 않는다.

## 최종 안전/정리와 한계

`initial-source-freeze.json` / `final-source-preservation.json`을 비교하여 b3ef tracked 948개, main 586개, 9663 800개 SHA가 모두 유지되고 세 worktree가 clean임을 확인했다. 끝 HEAD는 b3ef `ca719cf`, main `114a10a`, assets `694b6fa`다. 사진 승인/PNG/명부·SQL을 바꾸지 않았다.

전용 ID와 workdir를 함께 지정한 `supabase stop --project-id sol-radar-portraits-20261017-qa --workdir /tmp/sol-radar-portraits-20261017-qa --no-backup`은 exit 0이었다. 소유 컨테이너/볼륨 잔여 0개, 비밀을 포함할 수 있는 원시 기동 로그는 삭제했다. 새 Auth state 파일은 생성하지 않았다. 초기 unrelated 22개 컨테이너가 같은 ID·이름·상태로 전부 남았고 최종 전체도 22개다(`final-owned-cleanup.json`).

G1~G10 전체 골든, 미구현 조직도/명부/직원 상세 제품 화면, 완전히 연결된 3단계 조직 부모 관계, 외부 OAuth 제공자 실연결, 공유 DB 적용 안전성은 기존 미검증 상태를 유지한다. 이번에는 main 병합·push·공유 DB/시드/마이그레이션 적용·다른 세션 정리를 하지 않았다.

독립 QA는 여기서 QUIET. root가 이 새 증거와 수정 범위에 대한 마지막 scoped 재검토 및 문서 패키징을 맡는다.
