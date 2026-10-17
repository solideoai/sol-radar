# main 병합 독립 QA

검증 소스는 `42a4eaddf4b21256b0a69a816371815ea2a8f779`로 고정했다. b3ef·9663은 읽기 전용으로 유지했고 소스·시험·설정을 수정하지 않았다. `pnpm verify`는 root가 이 QA의 격리 대상 wrapper로 실행했으며, 이 보고서는 실제 로그를 확인했다. 나머지 실행과 결과 확인은 독립 QA가 수행했다.

## 최종 실행 결과

| 검증 | 결과 | 근거 |
|---|---|---|
| 전체 `pnpm verify` | PASS: 루트350·웹881(50파일)·DB정책141·새 프로덕션 빌드 | `verify.log` |
| 정상 인증 E2E | PASS95/95 | `auth.log` |
| 정상 공개 E2E + 포함 브라우저 | 한 번의 환경 재시도 후 PASS138/138 +108/108(14파일) | `public-warm-cache-retry.log` |
| Next 실제 정적 URL | HTTP200·PNG MIME·승인 SHA 일치200 | `next-200-get.json` |
| 실제 Chromium 이미지 해독 | 1254×1254 정상200 | `next-200-browser-decode.json` |
| 가입 폼1440/1280 | 부서·직급 선택 유지, 가로 넘침0, pageerror0 | `next-browser-ui.json`, `public-signup-{1440,1280}.png` |
| 실제 별도 DB | 직원200·평가27·부서48·직급12·Auth5 | `seed-after-auth.json` |
| 조직 제약 | 본부6·그룹4·팀38, 상위target NULL·팀합200·직원TEAM만 | 같은 JSON |
| 평가 입력/승인 매핑 | 실제 DB 필드와 fixture 정확 일치, 승인200 binding·평가27·고정창20FTE | 같은 JSON |
| 정상 seed2회/인증 후 | 기존5계정 ID 불변·200/27/48/12 유지 | `seed-{before-auth,after-second-seed,after-auth}.json` |
| 병합 조합 | 467파일(3rename), 양쪽 날짜 로그22행·정본·보호 소스 보존 | `merge-composition-audit.json` |

인증95에는 실제 이메일 가입·확인·재로그인, 필수 신고 정보 보완, 우회 Server Action 차단, 조직 멤버십0/1/복수·격리·권한 시험이 포함된다. 템플릿의 기존 작은 화면 시험은 수정 없이 실행했으며 모바일 제품 지원을 추가했다는 뜻이 아니다.

## 최초 실패와 한정 재검증

처음 정상 공개 묶음은 Playwright138을 통과한 뒤 Vite가 `next/image`·`nodemailer`를 늦게 최적화하면서 chunk 해시를 바꿨다. 브라우저는 사라진 이전 해시 URL을 요청해 여러 파일이0test로 실패하고 실행이 멈췄다. 실제 main의 일반 디렉터리인 `web/node_modules/.vite/vitest/.../deps`와 새 metadata를 확인했다. 해당 실행의 전용 프로세스 그룹만 SIGINT로 종료해 exit130을 보존했다(`public.log`, `browser-optimizer-diagnostic.json`, `public-first-attempt-termination.json`). 캐시 삭제나 설정 수정 없이 이미 생성된 metadata로 정상 공개 명령을 딱 한 번 재실행해138+108·exit0을 확인했다. cold optimizer 재현 가능성은 실행 도구의 잔여 한계이며 영구 수정했다고 주장하지 않는다.

Next 복합 임시 probe는200 GET·SHA·decode를 모두 저장한 뒤 스크린샷 정착용 locator가 닫히는 부서·직급 portal2개에 동시에 맞아 strict 오류(exit1)를 냈다. 원본 실행과 스크립트를 보존하고 UI 부분만 별도 외부 probe에서 의미 있는 role 상태와 선택값을 확인해 통과했다. 이미지200 검사를 반복하지 않았다. 제품 코드 결함이나 테스트 단언 변경은 없었다.

## 격리와 정리

새 전용 프로젝트 `sol-radar-main-merge-20261017-qa`(API58621·DB58622·메일58624/SMTP58625)에 변경 없는 migration12개를 실제 적용했다. 공유543xx·클라우드에는 접근/적용하지 않았다. 전용 컨테이너7개와 그 볼륨·네트워크만 `supabase stop --workdir /tmp/sol-radar-main-merge-20261017-qa --no-backup`으로 정리했다. 전용 Next 프로세스와 생성 Auth 상태5개를 제거했다. 기존22개 컨테이너의 ID·이름·상태·이미지·라벨/연결/마운트 집합, 기존 볼륨·네트워크를 보존했고 전용 모든 포트가 비었다. main은 소스 SHA 그대로 clean이다(`owned-cleanup.json`). 키는 메모리로만 전달했고 로그는 redaction했으며 새 증거의 JWT/secret-key 패턴 검사는0건이다.

## 미검증

부모 연결29건(TEAM25·GROUP4), 완전 연결된 본부→그룹→팀 조직도, 제품 조직도·직원 목록·상세 화면, 전체 G1~G10과 점수 파이프라인 골든94/72/68, 운영 편집 후 기존 `score_runs` 불변, 실제 외부 OAuth, 전체 후속 N1/N2·ops·sidebar/P1은 완료 처리하지 않는다. 순수 worked-example 점수 회귀와 일반 RLS 통과가 전체 골든을 대신하지 않는다. 공유 DB 적용·운영 변경·push·배포는 실행하지 않았다.
