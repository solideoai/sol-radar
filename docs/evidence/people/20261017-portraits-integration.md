---
title: "승인 프로필 사진 200장 통합·검증 결과"
status: reviewed
tags:
  - sol-radar
  - evidence
  - people
updated: 2026-10-17
---

# 승인 프로필 사진 200장 통합·검증 결과

사진과 명부 통합·독립 QA·전체 브랜치 리뷰 및 지적 수정 검증을 완료했다. 최종 제품 코드 `ca719cf`에서 전체 verify를 새로 통과했다. **공유 DB 적용·main 병합·원격 push는 수행하지 않았다.**

## 승인과 원본 보존

사용자 원문 **“사진 200장 전체를 최종 승인합니다.”**에 따라 SOL-P0001~SOL-P0200 전체를 사람 검수 `APPROVED`로 기록했다. 기존 상태 계약은 `PLANNED / GENERATED / READY / FAILED`이므로 manifest에는 기존 API를 통해 `READY 200`을 기록했다. 자동 검사 PASS200/FAIL0과 실제 사람 승인은 별개다.

- [승인 기록](20261017-portraits-approval.json): 정확한 사용자 승인문·기록 시각·200명 ID/이름/성별/부서/직급/경로/SHA binding·이전 AI review 200개. 사용자 메시지의 시각을 추정하지 않고 기록 생성 시각임을 명시했다.
- 승인 snapshot SHA-256: `19cbd9408e9672273db9405073dde5f9133d7715fa40041e51b91c824e8ff0e1`.
- 200개 원본 PNG, 합계 444,095,216 bytes, 모두 1254×1254. 승인 전후 및 두 worktree의 원본 SHA가 모두 같다. 재생성·교체는 없었다.
- [이전 AI 검수](20261016-portraits-review.json)와 저장소 밖의 과거 PENDING audit는 보존했다. 새 승인이 과거 검수 결과를 소급 변경하지 않는다.
- [승인 완료 갤러리](/Users/leegwanghui/dev/hackathon/sol-radar-inputs/portrait-integration-20261017/approved-review.html)는 기존 갤러리의 별도 파생본이다. 이름·부서·직급·원본 사진과 APPROVED 상태를 표시한다. 과거 유사 후보 표시는 역사적 참고이며 미승인 판정이 아니다. [파생본 출처](20261017-portraits-integration/approved-gallery-provenance.json).

## 통합 파일과 커밋

| 대상 | 커밋 | 결과 |
| --- | --- | --- |
| 9663 승인 | `8ba281060d1cb27c6e3cb06da22b5d4ab3ca801e` | 해시를 재대조하고 APPROVED/READY200 기록. 원본 바이트 무변경 |
| 9663 문서 정정/현재 HEAD | `694b6fac5caaaf02681a1af70a4e1d928c8a7cca` | 승인 대기라는 현재 문구만 정정. 문서 2개 외 무변경 |
| b3ef 실제 통합/검증 코드 | `a05217a05f0fb9adb3553c02978f0e2d531e9610` | 승인 manifest·원본 PNG200·사람/AI 증거 선택 반입, 경로/helper/fallback과 회귀 검사 |
| b3ef 최종 제품 코드 | `ca719cfff0040e00ff8a3eac98558861d9cbc394` | 시드 팀의 비시드 회원 확인 후 변경 전 거절. 주석 3개 정정. 새 verify350/879 통과 |
| main | `114a10aa245b76909c4952c3c82a473337ba0cbd` | 읽기 전용 유지 |

주요 변경은 `fixtures/people/solideo.portraits.json`, `web/public/demo/people/SOL-P0001.png`~`SOL-P0200.png`, `web/lib/demo-portrait.ts`, `web/components/people/person-avatar.tsx`, 인접 시험, `scripts/people/approved-portraits.test.mjs`, 미완료 입력을 명시한 `scripts/demo-people.test.mjs`, 승인/검수 증거 및 해당 계획·진행/검증 문서다. [전체 변경 파일 목록](20261017-portraits-integration/changed-files.json)은 명부 worktree의 이전 HEAD `f695ef4`부터의 목록이다. 9663 전체 이력이나 구형 DB·가입 코드는 병합하지 않았다.

사진 URL은 **`/demo/people/<personId>.png`**, 실제 파일은 `web/public/demo/people/<personId>.png`다. 기존 직원 ID·이름·부서·직급·portraitPath와 기존 명부 bytes를 보존했다. `demoPortraitPath`는 정확한 200개 ID만 고정 URL로 변환하며 `PersonAvatar`는 ID 없음·미지 ID·이미지 오류에 기존 Avatar와 중립 인물 아이콘/대체 설명을 사용한다. 실제 사용자 avatar_url에는 데모 사진을 넣지 않는다. 미출시 조직도/직원 상세는 향후 이 경로와 컴포넌트를 함께 소비한다.

## 데이터·조직 검증

| 검사 | 결과 |
| --- | --- |
| 명부 계약/인원 | PASS, 200명·남녀100/100·모든 승인 binding 일치 |
| 사진 매핑/누락/중복 | PASS, 직원200↔사진200, 중복 해시/경로·누락·고아 파일0 |
| 부서/직급 | PASS, 본부6·그룹4·팀38, 직급12. 기존 명부·카탈로그 bytes 유지 |
| 직원 팀 소속/목표 인원 | PASS, 직원은 TEAM만, 각 팀 실제 인원=targetCount, 팀 합200, 상위10개 targetCount NULL |
| 계층 제약 | PASS, 허용 관계·순환/잘못된 부모/상위 직원 배치 거부. ADR은 본부→팀 직접 연결도 허용 |
| 완전 연결된 본부→그룹→팀 | **UNVERIFIED**, 확인된 팀→본부13개 외 팀25·그룹4의 부모 미확정. 사유 보존, 임의 연결 없음 |
| 운영/평가 분리 | PASS, team_members200/team_member_scoring27, 배정7·고정 창20FTE·계산 입력/기존 ID 보존 |
| 골든 데이터 보호 | 기존 계산 입력/점수 구현/회귀 시험 bytes 유지. 순수 worked-example94/72/68 통과. 전체 파이프라인 및 score_runs 불변 수용 기준은 미검증 |

[독립 검사 결과](20261017-portraits-integration/independent-static-summary.json), [보호 대상 SHA](20261017-portraits-integration/protected-baseline.json). Task1의 원본 엑셀 필수 release 검사는 `sourceComparison: passed`, 오류0이었다. 독립 QA는 원본을 새로 열지 않고 동일 명부/카탈로그 SHA와 승인 binding을 재검증했다.

## 실제 통합 테스트

구현자와 다른 QA 담당자가 **고정 코드 a05217a**에서 실행했다. 기존 환경 파일을 읽거나 복사하지 않고 빌드·서버·시험의 API/anon/메일/site 값을 전용 Supabase로 명시했다. 전용 workdir `/tmp/sol-radar-portraits-20261017-qa`, API57621/DB57622, Next `localhost:3762`. 공유543xx 스택은 접근하지 않았다.

| 요청된 검사 | 실제 결과 |
| --- | --- |
| 명부 JSON 계약·200사진 매핑·조직 계층 | PASS. 완전한 상위 연결은 위 미검증 경계 적용 |
| 실제 Next 정적 경로 | PASS, 200 URL GET200/image/png/body SHA 일치, 444,095,216 bytes |
| 브라우저 실제 이미지 디코딩 | PASS, 200장 전부1254×1254 |
| 가입 부서·직급 | PASS, 실제 가입/메일 확인/재로그인 저장 및 1440·1280 선택·넘침0·pageerror0 |
| 조직도·운영 명부·직원 상세 제품 표시 | **미구현/미검증**, 해당 제품 route가 빌드에 없음. 준비된 사진/fallback을 화면 연동 완료로 표시하지 않음 |
| 인증·인가·RLS | PASS, PGlite/RLS 포함 루트349 및 실제 정상 Auth95. 개인 조직 자동 생성 제거/멤버십 정책 회귀 포함 |
| `pnpm verify` | PASS, 최종 ca719cf에서 루트350/350·웹879/879·서식/타입/린트/경계/토큰/DB types/프로덕션 빌드. 초기 a052 검증은349/879로 보존 |
| 브라우저 전체 | PASS, 106/106, 사진/fallback4 포함 |
| G1~G10 전체 | **미구현/미검증**, 현행 지정 시험 부재. G5는 일반 RLS만 통과, 공고/분석 격리 전체 시나리오는 없음 |

정상 Auth95는 재시도/skip 없이 실행했다. seed 두 번 적용 전후 운영200/평가27/부서48/직급12/Auth5와 시험 계정 ID가 유지됐다. [QA 요약](20261017-portraits-integration/qa-summary.json), [독립 QA 원문](20261017-portraits-integration-qa.md), [G1~G10 개별 가용성](20261017-portraits-integration/golden-availability-current-docs.json), [증거 목록](20261017-portraits-integration/index.json).

이번 전체 공개 E2E 및 외부 OAuth 제공자 실연결은 실행하지 않았다. 이전 populated migration upgrade는 원래 `2d54801` 증거로 보존하며, 이번 새 격리 DB 적용을 기존 데이터 upgrade의 재실행으로 주장하지 않는다([이전 QA](20261017-adr021-qa-report.md)).

실패 기록도 남겼다. 최초 커밋 훅은 실제 manifest를 계속 PLANNED라고 가정한 기존 시험 때문에 실패했고, 명시적인 PLANNED 복사본으로 원래 거부 단언을 모두 유지해 수정했다. QA의 첫 verify는 새 증거 파일의 JSONL/JSON 형식 오류로 suite 전에 중단됐고 소유 증거만 정정한 뒤 통과했다. 추가 screenshot probe의 locator/닫힘 animation 오류도 원문에 분류했다. 전환 중 스크린샷은 시각 PASS 증거로 채택하지 않았다. 성공한 전체 suite/200 GET을 불필요하게 반복하지 않았다.

## 병합 충돌과 해결안

로컬 main HEAD는 기준 ADR-021 `114a10a` 그대로다. 읽기 전용 `git ls-remote`의 원격 main은 `22b788e`로 로컬 main보다 이전이다. 실제 두 worktree HEAD를 다시 확인했고 변경 내역과 QA 귀속을 구분했다. `git merge-tree`는 임시 Git 객체만 만들었으며 실제 branch/index/worktree merge는 하지 않았다.

- **docs/11-TESTING.md PPL-06/07**: main의 조직 자동 합류 금지·전체 골든/score_runs 불변 수용 기준과 b3ef의 write 시험·순수 계산 완료 범위를 함께 유지한다. 이번 b3ef 문서는 PPL-07의 후속 수용 기준을 명시해 요구가 사라지지 않게 했다. 실제로 구현한 순수 회귀만 PASS다.
- **docs/PROGRESS.md**: main의 랜딩·ADR-020/021 로그 및 모델 학습 링크와 b3ef 데이터·가입·사진·QA 이력을 모두 유지한다. 과거 대기 기록은 당시 상태로 남기고 최신 승인/통합 상태를 별도 표시한다. 어느 한쪽 파일을 통째로 선택하지 않는다.
- **ADR-021 SQL**: 파일 충돌 없음. main 기존8개 SQL bytes 동일, 새00001~00004 append-only. 00003의 계층/상위NULL/팀 전용 소속/평가분리·양방향EXCEPT backfill·RLS와 00004의 profile만 생성 정책을 보존했다. 사진 통합에서 SQL을 바꾸지 않았다.
- 9663 전체 병합은 불필요하다. 승인 manifest·PNG200·증거는 이미 선택 반입했다. 원래 두 worktree 전체를 합치면 PROGRESS 충돌이 있으며 구형 문서/코드를 선택할 위험이 있다.

상세 가상 병합 결과: [고정 HEAD 분석](20261017-portraits-integration/merge-preflight-frozen.json). 최종 문서 커밋 후 main HEAD와 충돌 목록을 다시 확인한다.

## 공유 DB 적용 전 필요한 작업

1. 실제 대상 migration 이력·스키마와 운영200/평가27·기존 회원/개인 조직·배정/기존 점수 snapshot을 읽기 전용으로 확인하고 백업/복구 절차를 준비한다.
2. 실제 대상의 격리 복제에서 backfill 양방향 동일성·created_at·기존 데이터 보존과 신규 가입/멤버십0·1·복수/RLS 회귀를 확인한다. 기존8개 및 추가4개 순서를 바꾸거나 기존 SQL을 덮어쓰지 않는다.
3. 새 서버 조직 가드와00004 적용 순서를 맞추고, seed가 기존 운영 편집을 덮어쓰지 않도록 적용 범위를 별도로 정한다. 미확정 부모29건의 원본 정보를 확인한다.
4. main 병합과 공유 DB 적용은 각각 사용자 승인을 받는다. 이번 승인 범위에는 둘 다 포함되지 않는다.

전용 테스트 서버/컨테이너9개·볼륨·생성한 시험 세션5개만 정리했다. 초기22개 컨테이너의 ID·이름·상태와 main 파일은 유지됐다([정리 증거](20261017-portraits-integration/final-owned-cleanup-inventory.json)). Worktree·기존 계획·과거 증거는 보존한다.

## 최종 리뷰와 보존 수정 완료

전체 분기점 `f6700e1`→`406549b`를 한 번 검토하여 시드 보존 Important I1과 개인 조직 관련 주석 Minor M1을 발견했다([전체 리뷰 원문](20261017-portraits-integration/final-fix/final-review.md)). 한 차례 수정 커밋 `ca719cf`와 범위 재검토로 **I1·M1 모두 해결, 새 문제 없음**을 확인했다([재검토](20261017-portraits-integration/final-fix/final-fix-review.md)).

시드 팀에 확인된 시험 계정5개 외의 회원이 있으면 초대 수락 복원·작업/초대 삭제 전에 명시적으로 중단한다. 기존 정상 시드2회와 식별자 보존은 유지했다. 새 집중 시험은 RED12/13→GREEN13/13, 정상 훅350/879 통과. 실제 격리 DB에서 비시드 회원·그 회원의 작업·별도 대기 초대를 넣고 실제 seed CLI의 의도한 exit1 거절과 모든 팀 row·멤버십3·작업12·초대2·Auth6/조직 식별자의 동일성을 확인했다. 해당 fixture만 정리해 운영200/평가27/부서48/직급12/Auth5를 복원했다.

최종 ca719cf의 새 전체 verify는 **첫 시도350/350·879/879·빌드 통과**다([독립 최종 QA](20261017-portraits-integration/final-fix/final-fix-qa-report.md), [새 결과](20261017-portraits-integration/final-fix/qa-summary.json)). 이전 Auth95·브라우저106·Next200 GET/디코딩은 **a05217a의 실제 실행**으로 보존하고 재실행했다고 표시하지 않는다. 이후 변경은 시드 보호와 웹 주석3개여서 해당 증거를 재사용했으며 새 시드 경계는 실제 DB로 별도 검증했다. 외부 승인 갤러리도200개의 APPROVED·이름/부서/직급과1440/1280 넘침0·pageerror0을 확인했다([갤러리 확인](20261017-portraits-integration/approved-gallery-browser-proof.json)).

서로 다른 작업자의 자료는 덮어쓰지 않았고 이전 실패·판정은 역사 증거로 남겼다. 최초 QA 뒤 새 소유 probe 사본5개의 서식 때문에 문서 커밋이 한 번 중단된 기록도 보존했다. 실행 원본을 외부 `qa-raw-preformat/`에 먼저 보관하고 사본만 포맷하여 검사 약화 없이 해결했다. 최종 검증 단계에서는 이런 오류나 재시도 없이 통과했다.

최종 테스트 환경도 소유 컨테이너/볼륨만 정리하고 기존22개와 모든 worktree를 보존했다. G1~G10·미출시 화면·부모29건·외부 OAuth 등 위 미검증 경계는 그대로다. [검토 가능한 두 문서 병합 해결안](/Users/leegwanghui/dev/hackathon/sol-radar-inputs/portrait-integration-20261017/prepared-merge-resolution)은 worktree 밖의 준비 자료이며 실제 main에는 적용하지 않았다. main 병합과 공유 DB 적용은 사용자 별도 승인 대기다.
