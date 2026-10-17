---
title: "승인 사진 통합 독립 QA"
status: final
tags:
  - sol-radar
  - evidence
updated: 2026-10-17
---

# 승인 사진 통합 독립 QA

검증 담당은 Task 1 구현자와 다르다. 검토된 고정 b3ef HEAD `a05217a05f0fb9adb3553c02978f0e2d531e9610`에서 실행했다. 제품·테스트·설정·index·HEAD 수정과 커밋은 하지 않았다. 결과는 이 보고서, 인접 `task-2-evidence/`, 전용 외부 작업 폴더에만 썼다. 검증 범위에서 제품 결함은 발견하지 않았다. 전체 골든 및 미구현 제품 화면은 아래와 같이 미검증이다.

## 대상과 안전 경계

- main: `114a10aa245b76909c4952c3c82a473337ba0cbd`, 시작/끝 clean, 모든 tracked 파일 SHA 그대로.
- b3ef: `a05217a05f0fb9adb3553c02978f0e2d531e9610`, 시작/끝 clean, 모든 tracked 파일 SHA 그대로.
- 9663 승인 커밋: `8ba281060d1cb27c6e3cb06da22b5d4ab3ca801e`. 끝 HEAD `694b6fac5caaaf02681a1af70a4e1d928c8a7cca`, clean. 승인 후 허가된 문서 2개(PROGRESS·사진 계획)만 바뀌었으며 manifest/PNG/승인 기록은 불변이다.
- 전용 외부 workdir: `/tmp/sol-radar-portraits-20261017-qa`(0700), project `sol-radar-portraits-20261017-qa`.
- 정확한 CLI 대상: 모든 기동·상태·정지에 `--workdir /tmp/sol-radar-portraits-20261017-qa`. API `http://127.0.0.1:57621`, DB 57622, Mailpit 57624, SMTP 57625, Next `http://localhost:3762`.
- 기존 `local-test-target.mjs`로 `SOL_RADAR_TEST_SUPABASE_WORKDIR`와 `SOL_RADAR_TEST_SUPABASE_API_URL`의 실제 CLI API 일치를 확인했다. 격리 anon/API/SMTP/site/provider/mock 환경을 빌드와 모든 자식 프로세스에 명시 전달했다. shell로 `.env`를 읽거나 복사하지 않았다. Next가 기존 `.env.local` 파일명을 출력하지만 관련 값은 프로세스 환경으로 모두 재정의했다.
- 공유 543xx DB/API는 접근하지 않았다. main 병합·push·공유 DB 적용·다른 세션 정리는 하지 않았다. 기존 22개 컨테이너 전체의 ID·이름·상태를 시작과 끝에 비교했다.

## 실제 실행과 결과

아래 명령은 전용 `run.mjs`가 대상 검증 후 환경을 넣어 실행했다. 전체 명령·시작/종료 시각·exit는 각각의 로그에 있다. 성공한 전체 suite를 반복하지 않았다.

| 명령/검사 | 실제 결과 | 증거 |
| --- | --- | --- |
| `supabase start --workdir /tmp/sol-radar-portraits-20261017-qa` | exit 0, 불변 SQL 12개 적용 | `supabase-start.sanitized.log`, `target-identity.json` |
| `pnpm verify` 최종 실행 | exit 0; 루트 349/349, 웹 879/879(50 files); format/type/lint/guards/lodestar/tokens/colors/DB types/build 통과 | `verify.log` |
| `pnpm db:seed` | exit 0; 200 운영/27 평가/48 부서/12 직급/Auth 5 | `seed.log`, `seed-before-auth.json` |
| `pnpm -C web test:e2e:auth` | 정상 명령 그대로 exit 0, **95/95**, retries/skips 0; 내부 정상 seed로 두 번째 적용 | `auth.log` |
| `node .../counts.mjs after-auth` | 200/27/48/12/Auth 5 유지, 기존 시험 계정 5개 ID 동일 | `seed-after-auth.json` |
| `pnpm -C web test:browser` | exit 0, **106/106**(14 files), 신규 Avatar 4개 포함 | `browser.log` |
| `pnpm -C web start --hostname localhost --port 3762` | 같은 격리 빌드의 실제 Next 운영 서버 Ready | `next-server.log` |
| 외부 `next-probe.mjs`의 GET 단계 | 동시 최대 8, 실제 200 URL 모두 status 200/MIME image/png/승인 body SHA 일치; 총 444,095,216 bytes | `next-200-get.json` |
| 같은 probe의 Chromium decode 단계 | 동시 최대 4, 200/200 decode 성공, 전부 1254×1254 | `next-200-browser-decode.json` |
| 외부 exact-option UI probe | 실제 공개 가입 페이지 1440/1280에서 부서·직급 선택; overflow 0, pageerror 0 | `next-ui-probe-exact-options.log`, `next-browser-ui.json` |

정상 Auth 95개에는 기존 인증·인가·조직 격리·운영자·계정·로그아웃·가입 확인 메일·재로그인과 필수 신고 정보 보완/업무 우회 방지가 포함된다. 가입 키보드 및 긴 부서명은 1440/1280으로 기존 단언 그대로 실행했다. 정상 Auth에 이미 있는 작은 viewport 단언도 바꾸거나 제외하지 않았다. 새 탐색 QA의 viewport는 데스크톱 두 폭만 사용했다. OAuth 외부 제공자 자체의 실연결은 검증하지 않았다.

브라우저 106개에는 PersonAvatar의 정상 사진·ID 없음·미지 ID·깨진 PNG fallback 4개와 기존 가입 폼 검사가 포함된다. 실제 사용자 avatar_url과 데모 사진의 혼합을 추가하지 않았다.

## 독립 데이터/승인 검사

`independent-static-summary.json`, `independent-200-bindings.json`, `frozen-baseline.json`에 실제 결과를 기록했다.

- 승인 snapshot SHA `19cbd9408e9672273db9405073dde5f9133d7715fa40041e51b91c824e8ff0e1`, APPROVED 200/manifest READY 200. SOL-P0001~0200 ID·이름·성별·부서·직급·portraitPath가 승인 snapshot과 일치한다. 공개 PNG 200개의 실제 SHA가 snapshot/manifest/human review와 전부 일치한다. 남녀 100/100이다.
- 12개 SQL 및 보호 대상 7개(명부·부서·직급·가입 옵션·scoring 구현/시험·DB types)의 기준 SHA를 기동 전·고정 HEAD·검증 후 대조했다. 평가 입력 27명, 기존 배정 7개와 해당 원본 전체 bytes가 유지됐다.
- 부서 48개 = DIVISION 6/GROUP 4/TEAM 38. 직원은 모두 TEAM이고 팀별 실제 인원=target, 각 팀 1명 이상, 팀 목표 합 200, 상위 target NULL이다.
- 확인된 TEAM→DIVISION 부모 연결 13개. TEAM 25개와 root GROUP 4개의 부모는 미확정이다. 기준 파일 bytes를 보존하여 미확정 사유도 그대로다. 모델의 계층·TEAM 전용 배치 제약 통과와 완성된 DIVISION→GROUP→TEAM 연결은 별개다. **완전 연결된 3단계 조직도는 미검증/권위 있는 부모 정보 대기**다.
- 과거 audit 디렉터리의 `approval-scope.json`과 `review-data.json` SHA를 승인 기록의 역사적 SHA와 재비교했다. 원래 PENDING/자동 PASS 200 FAIL 0 기록은 변경하지 않았다. 자동 검수 PASS와 새 명시적 사람 승인 APPROVED를 구분한다. 새 이미지 생성/교체/품질 재심사는 수행하지 않았다.
- 원본 workbook은 열지 않았다. 기준 명부·카탈로그 및 기존 원본 필수 checker/구현자의 release 증거와 별도 SHA 대조를 사용했다. 이 QA가 원본 workbook 대조를 새로 실행한 것으로 주장하지 않는다.

## 실패·미실행의 정확한 분류

1. 최초 `pnpm verify`는 QA가 추가한 Docker JSONL을 `.json` 확장자로 저장한 증거 파일 때문에 **root format:check에서 멈췄다**. 어떤 suite/build도 아직 돌지 않았다. `verify-attempt-1-artifact-format-failure.log`를 보존했다. 소유 증거만 JSON 배열로 변환하고 전체 소유 JSON parse/Prettier를 확인한 후 전체 verify를 한 번 재실행하여 위 결과를 얻었다. 제품 결함이나 기존 테스트 실패가 아니다.
2. 외부 추가 screenshot probe는 200 GET/decode 성공 후 `option.first()`가 이전 팝업의 닫히는 항목을 잡아 timeout했다(`next-probe.log`). 별도 keyboard/Home probe는 실제 값을 선택하지 못해 자체 계약 검사에서 실패했다(`next-ui-probe.log`). exact named option probe는 정상 통과했다. 이후 안정된 사진을 더 찍으려던 대기 probe는 닫히는 팝업 두 개를 단일 locator로 취급하여 strict-mode 오류를 냈다(`next-ui-stable-screenshots.log`). 모두 QA 어댑터 오류이며 제품·기존 시험을 수정하지 않았다. 성공한 GET/decode/전체 suite는 반복하지 않았고, 선택 동작 검증을 통과한 뒤 optional screenshot 재시도는 중단했다.
3. `public-signup-*-during-close-animation.png`는 직접 열어 확인한 **닫힘 animation 중간 화면**이다. 최종 시각 완성도 PASS용 스크린샷으로 사용하지 않는다. 실제 두 폭의 선택 동작/넘침/오류와 정상 Auth·부품 회귀는 위 실행 증거로 판단한다.
4. 과거 실제 populated migration upgrade는 이 SHA에서 재실행하지 않았다. `docs/evidence/people/20261017-adr021-qa-report.md`, `20261017-adr021/06-upgrade-proof.json`의 원래 `2d548015897ee6ab6fc583d348e26f3f01ff8a0b` 증거 및 `e465438` 앱 증거 귀속을 유지한다. SQL 12개 모두 bytes가 동일함을 이번에 확인했다. 이번 새 스택 전체 SQL 적용과 PGlite 정책 회귀를 과거 populated upgrade의 새 실행으로 오인하지 않는다.
5. 공개 전체 E2E `pnpm -C web test:e2e`는 이번 범위에서 실행하지 않았다. 이전 공개 130개 등의 기록은 역사적 SHA에 속한다. 새 전체 Auth 95와 browser 106, verify는 이번 frozen SHA에서 실제 실행했다.

## 골든/제품 UI 가용성

`golden-availability-current-docs.json`은 현행 docs/11 지정 경로를 직접 검사했다. 외부 초기 inventory의 G1/G2 파일명은 구형 이름이라 현행 `idempotent-upsert`, `revision-diff`, `outbox-dedupe`로 바로잡았다. 모든 행에 문서상 실행 명령은 있으나 대상 구현 부재 때문에 해당 전체 골든은 실행하지 못했다.

| 항목 | 구현/실행 상태 | 판정 |
| --- | --- | --- |
| G1 | 지정 ingestion idempotent-upsert 시험 없음 | UNVERIFIED |
| G2 | 지정 revision-diff/outbox-dedupe 시험 없음 | UNVERIFIED |
| G3 | decision-policy.golden/kev-no-override 시험 없음 | UNVERIFIED |
| G4 | needs-review/AI schema/no-evidence E2E 없음 | UNVERIFIED |
| G5 | 일반 RLS/PGlite 및 템플릿 조직 격리는 이번 통과; bid tenant handler/E2E 없음 | 전체 G5 UNVERIFIED |
| G6 | analysis fallback/AI gateway fallback/partial E2E 없음 | UNVERIFIED |
| G7 | rate-limit-retry 시험 없음 | UNVERIFIED |
| G8 | bids demo-flag/demo-badge 시험 없음 | UNVERIFIED |
| G9 | 지정 AI schema/citation/adapter/gateway 시험 없음 | UNVERIFIED |
| G10 | 지정 normalized-bid/evidence-ref 계약 시험 없음 | UNVERIFIED |

현재 Next 빌드 route manifest에도 조직도·운영 직원 명부·직원 상세 제품 화면이 없다(`built-routes.json`). 해당 화면은 미구현/미검증이다. fixture200/평가27/20FTE/순수 worked-example94·72·68 검사가 실제 전체 점수 파이프라인 골든이나 운영 편집 뒤 score_runs 불변 검사를 대신하지 않는다. 시험용 제품 경로를 추가하지 않았다.

## 읽기 전용 병합 분석

실제 merge/index/HEAD 변경 없이 `git merge-tree --write-tree --name-only <ours> <theirs>`를 실행했다. Git 임시 객체만 생성했다. `merge-preflight-frozen.json`과 두 `*-merge-tree.txt` 참조.

- main `114a10a` ↔ frozen code `a05217a`: exit 1, 충돌은 `docs/11-TESTING.md`, `docs/PROGRESS.md`.
- 최종 assets `694b6fa` ↔ frozen code `a05217a`: exit 1, 충돌은 `docs/PROGRESS.md`.
- 마이그레이션 파일 충돌은 없고 main 기존 8개 SQL bytes가 동일하다. 추가 4개는 append-only다. 공유 DB 적용 안전성 승인과는 별개다.
- root의 외부 `portrait-integration-20261017/merge-resolution-proposal.md` 분석을 확인했다. PPL-07은 main의 후속 전체 골든/score_runs 불변 수용 기준과 b3ef의 실제 순수 계산 완료 증거를 함께 보존해야 한다. PROGRESS는 main과 b3ef의 서로 다른 이력 모두 유지하며 최신 사람 승인 상태를 구분해야 한다. 양쪽 중 하나를 통째로 선택하면 안 된다.
- root가 문서 패키징 후 최종 HEAD로 병합 분석과 전체 브랜치 리뷰를 마무리한다. 이 QA는 병합하지 않았다.

## 정리와 인계

`source-freeze-after-qa.json`, `final-owned-cleanup-inventory.json`, `auth-state-cleanup.json`, `artifact-safety.json` 참조.

- 실제 Next 전용 프로세스를 종료했다. CLI 전용 project ID와 workdir를 함께 지정한 `supabase stop --no-backup`이 exit 0이었다. 전용 컨테이너·볼륨 잔여 0개.
- 시작에는 `.auth` 파일이 없었음을 기록했고, QA가 만든 정확한 owner/member/outsider/invitee/admin JSON 5개만 삭제했다. 원시 비밀 포함 가능 기동 로그도 삭제하고 정제 로그만 증거로 남겼다. CLI 키/JWT/cookie/.env 값은 보고/증거로 내보내지 않는다.
- 초기 unrelated 컨테이너 22개가 전부 같은 ID·이름·상태로 남았다. 최종 전체 22개다. broad stop/delete나 다른 세션 정리를 하지 않았다.
- 모든 소유 JSON은 parse 검사와 Prettier를 적용한다. core 요약은 `qa-summary.json`, 각 실제 증거는 인접 폴더에 있다.
- 공유 DB 적용 전에는 별도 실제 migration 이력·운영/평가/기존 회원·배정 snapshot·backup/복구·기존 데이터 backfill 동일성·새 조직 guard와 SQL00004 배포 순서를 점검하고 명시적 사용자 승인을 받아야 한다. 이번에는 공유 DB 접근·적용을 하지 않았다.

독립 QA는 여기서 QUIET. 컨트롤러가 정제 증거/문서를 패키징하고 전체 브랜치 리뷰를 마친 뒤 최종 상태를 보고한다. main 병합과 push는 수행하지 않는다.
