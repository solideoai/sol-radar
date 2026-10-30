# 입찰 일정 내보내기: 구글 캘린더 링크·`.ics` (2026-10-30)

계획: `docs/plans/2026-10-30-calendar-export.md`. 스펙: `docs/plans/2026-10-29-feature-backlog.md` "7. Google Calendar integration", 결정 D3 1안(일정 링크 + `.ics` 내려받기, OAuth 없음). 브랜치 `feat/calendar-export`(기준 `b9db064b`).

## 무엇을 더했나

- 툴바 보기 전환 옆 [이 달 일정 내려받기(.ics)]. `GET /api/v1/calendar/ics?month=…&view=…&kinds=…` 가 지금 보는 달(KST)·보기·고른 종류 그대로의 일정을 RFC 5545 파일로 준다. 파일 이름은 `sol-radar-calendar-YYYY-MM.ics`, 내 일정 보기는 `-mine` 을 붙인다.
- "다가오는 14일" 항목마다 [구글 캘린더에 추가](새 창). 구글 캘린더 일정 만들기 주소(`action=TEMPLATE`)에 제목·30분 시각(UTC)·설명(기관·장소·SOL RADAR 주소)·장소를 채운다. 저장은 사용자가 구글 화면에서 한다.
- 조직 전체 보기에서 IT 공고를 못 읽으면 내려받기도 503 이다(일부만 담지 않는다). 그때 화면은 버튼을 끄고 실패 안내 뒤에 "IT 공고 일정이 빠진 파일은 내려주지 않습니다. 새로 고친 뒤 내려받으세요."를 붙인다(독립 리뷰 지적 반영).
- OAuth·Google API 호출·토큰 저장·새 표·마이그레이션·구독 주소는 없다. 읽기는 화면과 같은 사용자 세션 + RLS 이고 조직은 세션이 정한다.

## 시험

| 명령 | 결과 |
|---|---|
| `pnpm -C web exec vitest run "app/(app)/(work)/calendar/calendar-export.test.ts"` | 8개 통과(리뷰 뒤 상수 복사 단언 하나를 뺐다). 구글 링크(TEMPLATE·UTC 30분·설명·장소), `.ics` CRLF·필수 칸·이스케이프(`\` `;` `,` 줄바꿈), 줄 순서 전체, 빈 달력, 한글·이모지 줄 접기(75옥텟·UTF-8 왕복), 취소 공고·호스트 헤더 |
| `pnpm -C web exec vitest run app/api/v1/calendar-ics-contract.test.ts` | 5개 통과. 미인증 401, 세션 조직만(쿼리 `orgId` 무시)·이 달만·고른 종류만, 헤더 4개, 쿠키 세션·`-mine`·내 일정은 IT 공고 안 읽음, IT 공고 읽기 실패 503 |
| `pnpm -C web exec vitest run --config vitest.browser.config.ts "app/(app)/(work)/calendar"` | 11개 통과(새 2개: 내려받기 링크, 구글 링크 새 창·주소, 칩에는 없음. 기존 IT 공고 실패 시험에 버튼 꺼짐·이유 문장을 더함. 단위 시험과 겹치는 주소 값·문구 고정 단언은 [11 테스트](../../../11-TESTING.md) 규칙대로 뺐다) |
| `pnpm verify:changed`(슬롯) | exit 0. 서식·tsc·eslint·린트 가드·vitest 1018개·lodestar·토큰·색 |

변형 확인(고친 코드를 일부러 망가뜨려 시험이 실패하는지 확인, 확인 뒤 모두 되돌림):

- 줄 상한 76 → 2개 실패
- 역슬래시 이스케이프 제거 → 1개 실패
- 이어진 줄 앞 공백 제거 → 3개 실패
- UTF-16 단위로 자르기 → 이모지 시험 실패
- Route Handler 의 달 거르기 제거 → 3개 실패
- 503 분기 제거 → 1개 실패
- 종류 거르기 제거 → 1개 실패

## 격리 로컬 스택 확인

격리 Supabase(`sol-radar-cal-export`, API 58621)에 `pnpm demo:reset -- --env-file <격리 env>` 로 데모 seed(공고 19)를 넣었다. `next dev`(3187)를 띄워 `sales@soltech.invalid` 로 로그인했다. 화면의 별과 같은 `PUT /api/v1/bids/:id/watch` 로 데모 공고 19건을 관심 표시한 뒤 Playwright 로 확인했다. 결과는 [check-result.json](check-result.json) 이다.

| 달·보기 | 폭 | 화면의 이 달 일정 | `.ics` VEVENT | 가장 긴 줄 | 가로 넘침 | 툴바 겹침 |
|---|---|---|---|---|---|---|
| 2026-11 조직 전체 | 1440 | 16 | 16 | 75옥텟 | 0px | 없음 |
| 2026-11 조직 전체 | 1280 | 16 | 16 | 75옥텟 | 0px | 없음 |
| 2026-11 내 일정 + 공고 마감만 | 1440 | 16 | 16 | — | — | — |
| 2026-10 조직 전체 | 1440·1280 | 0 | 0 | 38옥텟 | 0px | 없음 |

- 화면 건수는 이 달 칸의 칩 수와 "+n건 더" 건수의 합이다. 10월 격자의 마지막 칸(11월 1일)에 보이는 일정은 앞뒤 달 칸이라 10월 파일에 담지 않는다(계획대로 "이 달"만).
- 모든 줄이 CRLF 로 끝나고, 따로 떨어진 LF 는 없다.
- 로그인하지 않은 요청은 401 이다.
- 콘솔 오류 1건은 `/health/ready` 503 이다. 격리 스택에 Redis·AI gateway 가 없어서 나며 이 변경과 무관하다.

`.ics` 발췌(실제 파일은 줄 끝이 CRLF 다. 저장소 `.gitattributes` 가 `eol=lf` 라 원본 파일은 싣지 않았다):

```text
BEGIN:VEVENT
UID:BID_DEADLINE:29dc6ded-e564-5d29-82ec-ea9806ad48b1@sol-radar
DTSTAMP:20261030T013746Z
DTSTART:20261101T090000Z
DTEND:20261101T093000Z
SUMMARY:[공고 마감] 광주광역시 AI 행정 비서 시범사업 (가
 상)
DESCRIPTION:기관: 광주광역시\nSOL RADAR: http://localhost:3187/bids/
 29dc6ded-e564-5d29-82ec-ea9806ad48b1?origin=demo
URL:http://localhost:3187/bids/29dc6ded-e564-5d29-82ec-ea9806ad48b1?origin=
 demo
END:VEVENT
```

| 파일 | 내용 |
|---|---|
| [calendar-export-1440-2026-11.png](calendar-export-1440-2026-11.png) | 격리 스택 1440px: 툴바 내려받기 버튼, 다가오는 14일의 구글 링크 |
| [calendar-export-1280-2026-11.png](calendar-export-1280-2026-11.png) | 격리 스택 1280px: 같은 화면, 다가오는 14일이 달력 아래 |
| [component-1440-google-link.png](component-1440-google-link.png) | 부품 시험 1440px: 현장설명회 일정의 구글 링크 |
| [component-1280.png](component-1280.png) | 부품 시험 1280px: 툴바·다가오는 14일 |
| [component-1440-relevant-failed.png](component-1440-relevant-failed.png) | 부품 시험 1440px: IT 공고 읽기 실패 때 꺼진 내려받기 버튼과 안내 |

## 독립 리뷰 (1회)

Critical·Important 는 없었다. Minor 2건은 반영했다.

- 실패 때 버튼이 이유 없이 실패하는 문제: 버튼을 끄고 이유를 붙였다. 시험은 먼저 실패한 것을 확인했다.
- 시험 중복: 문구·상수 고정과 계층 중복 단언을 뺐다.

마스터 검토 뒤 설명의 "담당: <이름>" 줄을 뺐다. 링크·.ics 로 구성원 이름이 구글로 나가지 않게 하려는 것이다(최소 정보). 단위 시험이 담당자가 있는 일정의 링크·.ics 에 이름이 없음을 본다.

판단 보류는 계획대로 두었다.

- `METHOD:PUBLISH` 에 ORGANIZER 가 없다.
- 취소 공고도 "(공고 취소)"를 붙여 담는다.
- 같은 UID 를 다시 가져올 때 SEQUENCE 가 없다. 안내 문구가 "자동으로 갱신되지 않습니다"이다.
- `.ics` 의 URL 은 `request.url` 기준이다. web 을 `next start -H 0.0.0.0` 로 띄우는 배포는 없다. Vercel 과 `next dev` 는 영향이 없다.
- 공고 마감 종류만 골라도 IT 공고 실패면 503 이다.

## 미확인

- 내려받은 `.ics` 를 구글 캘린더·아웃룩에 실제로 가져오는 것은 확인하지 않았다(구글 계정 필요).
- 구글 링크를 눌러 구글 일정 만들기 화면이 채워지는 것도 확인하지 않았다. 주소 모양만 시험했다.
- 조직 전체 보기의 IT 공고(live) 일정은 격리 DB 에 live 공고가 없어 화면에서 보지 못했다. 같은 경로는 계약 시험(503 포함)이 본다.
- 운영(Vercel) 화면은 보지 않았다.
