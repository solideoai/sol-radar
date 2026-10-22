# 커밋 작업 통합 — 로컬 브라우저 검증

2026-10-22, `integration/committed-work-20261022`의 통합 프로덕션 빌드로 확인했다. 결과는 **PASS**이며 [기계 판정 기록](browser.json)에 18개 결과와 스크린샷 14장을 남겼다.

대상은 `/Users/leegwanghui/.codex/worktrees/3938/sol-radar`의 Next.js 프로덕션 서버(`http://localhost:3281`)와 기존 43f8 격리 Supabase(API `127.0.0.1:59981`, DB `127.0.0.1:59982`)뿐이다. 런타임 파일은 승인된 loader로 내부에서 읽었고 비밀 값·세션 상태·요청 헤더를 증거에 저장하지 않았다. 오래된 기존 로그인 상태는 갱신 토큰을 찾지 못해 로그인 화면으로 이동했으며, 기존 로컬 계정의 정상 비밀번호 로그인으로만 해결했다.

## 확인 결과

두 화면 크기는 1440×900과 1280×800이다. 모든 캡처에서 문서 가로 너비가 viewport와 같았고 브라우저 콘솔 오류·미처리 예외·외부 요청·업무 데이터 변경 요청은 각각 0건이었다.

| 흐름 | 1440 / 1280 결과 | 확인 내용 |
| --- | --- | --- |
| N2 ADMIN 조직 설정 | PASS / PASS | 구성원 4명, 초대·대기 초대·최근 변경 기록, 마지막 ADMIN 보호 안내 |
| N2 SALES 직접 접근 | PASS / PASS | ADMIN 전용 안내와 현재 역할 표시 |
| S5 변경 이력 | PASS / PASS | 첫 revision과 비교할 이전 기록이 없다는 안내, r1 목록 |
| P08 상세 단계 연결 | PASS / PASS | 단계 이력·접힌 연결 후보 1건, 확정 연결 0건 유지 |
| C9 상세 고지 | PASS / PASS | mock 실행 표시, 결정 모델 분포는 충족·수주확률이 아니라는 고지 |
| 카카오 개인 설정 | PASS / PASS | 연결 전 안내·꺼진 비활성 스위치·연결 링크. 링크 이동이나 발송은 하지 않음 |
| 부처 지원사업 공고 | PASS / PASS | 수집 0건 빈 상태, SOL Score·권고 계산 제외 안내, DEMO·mock 구분 |
| 부처 공고 필터 | PASS / PASS | 기업마당·중기부 출처, 소관기관 검색, 마감 포함, 필터 초기화와 URL 동기화 |
| 부처 공고 API | PASS | SALES·VIEWER는 200, 익명은 401 |

대표 이미지: [조직 설정 1280](organization-admin-1280.png), [권한 제한 1280](organization-forbidden-1280.png), [첫 revision 1280](revision-first-1280.png), [상세 단계 연결 1280](stage-links-detail-1280.png), [카카오 설정 1280](kakao-settings-1280.png), [부처 공고 필터 1280](programs-filtered-1280.png). 위 1280 이미지의 텍스트 배치·줄바꿈·필터 간격과 표·카드의 겹침 여부를 시각적으로도 확인했다.

## 로컬 DB 적용과 범위

허용한 forward SQL 8개만 파일별 트랜잭션과 `supabase_migrations.schema_migrations` 기록으로 적용했다. localhost·API·DB 포트와 pending allowlist를 확인했고 `verifyDatabase`는 전체 마이그레이션 49개, RLS·열 권한·공개 함수 경계 검증을 통과했다. 공고·revision·첨부·분석·결정·회사 프로필·인력 7종의 기존 행 수와 전체 행 지문이 적용 전후 일치한다. 세부 적용 목록과 지문은 `browser.json`의 `localDatabase`에 있다.

시드·리셋·시험 데이터 삽입·역할 변경·초대·분석 요청·사람 결정·운영 DB 접근은 하지 않았다. 실 카카오 연결·발송, 실 API 수집, 외부 AI 호출도 하지 않았다.

기존 데이터의 공고 19건은 모두 첫 revision이라 실제 전후 비교 화면은 이번 브라우저 범위에 없다. 요청 revision 선택, 예산·본문 diff와 nullable/JSON 자격 요건은 앞서 통과한 최소 단위/API 시험으로 확인했다. 부처 공고 행이 없어 상세 서랍·데이터가 있는 목록·실제 자동 수집은 확인하지 않았다. N2 감사 목록도 기존 0건 상태이며 실제 감사 쓰기는 PGlite 핵심 시험에서 확인했다. 카카오는 연결 전 상태만 확인했고, 연결됨·만료·실발송 상태는 이 검증의 통과 주장에 포함하지 않는다.
