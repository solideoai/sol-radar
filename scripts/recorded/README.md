# scripts/recorded — 나라장터 응답 녹음·평가셋 분할 (X6a, ADR-027)

`docs/23-WEEKEND-FINETUNE.md` §4.3 저장 2안("녹음 스크립트")의 구현이다. 입찰공고정보서비스(15129394) 응답을 담당자 정보만 가려
`fixtures/recorded/train/15129394/`에 저장하고, 그 녹음에서 사업 단위 분할(`fixtures/eval/splits.v0.1.json`)을 만든다.
녹음 파일 형식은 `web/server/ingestion/recorded-api.ts`의 `recordedResponseSchema`(`sol-recorded/v0.1`)와 같아서
`RecordedApiConnector`가 그대로 재생한다.

| 파일 | 역할 |
|---|---|
| `record-g2b.mjs` | 녹음 CLI(`pnpm record:g2b`). 목록(1일 창 × 999행) → 정보화 필터·표본 300 → 보조 조회 3종 |
| `split-eval.mjs` | 분할 CLI(`pnpm eval:split`). union-find 사업 클러스터 → test 20·dev 10·train, 누수 0건 단언 |
| `replay-check.mjs` | 녹음 전부를 정본 zod 스키마로 읽고 봉투로 되돌려 보는 검사(`pnpm record:check`) |
| `g2b-lib.mjs` | 창 분할·URL·env·봉투·재시도·필터·표본 — `web/server/ingestion/`에서 옮긴 규칙(출처는 파일 머리) |
| `masking.mjs` | 담당자 필드·전화·이메일 마스킹(같은 길이), 저장 뒤 흔적 검사 |
| `recording-file.mjs` | 녹음 객체 만들기·형식 검사·읽기 |
| `split-lib.mjs` | 클러스터·결정적 선택·누수 검사(순수 함수) |
| `record-program-notices.mjs` | 부처 지원사업 공고 녹음 CLI(`pnpm record:program-notices`, ADR-040). 아래 "부처 공고 녹음" |
| `program-notices-lib.mjs` | 부처 공고 요청 URL·가림·녹음 형식·흔적 검사(순수 함수) |
| `record-lh-bid-notice.mjs` | LH 입찰공고(15159012) 첫 실호출 녹음. 한 번 실행에 1회. 아래 "LH 입찰공고 녹음" |

## 서비스키

`infra/.env`의 `G2B_BID_NOTICE_SERVICE_KEY`를 `scripts/check-env.mjs`와 같은 방식(`node:util parseEnv`)으로 읽어 메모리에만 둔다.
값에 `%XX`가 있으면(data.go.kr Encoding 키) 1회 디코드한 뒤 `URLSearchParams`가 1회 인코딩한다(C1 ① 실측).
키 값은 출력·로그·녹음 파일·URL 기록 어디에도 쓰지 않는다. 저장 뒤 폴더 전체에서 키의 네 형태(원문·디코드·1회·2회 인코딩)를
찾아 0건을 확인한다. worktree에는 `infra/.env`가 없으므로 `--env-root <main 저장소 루트>`로 가리킨다. 셸에서 `.env`를 읽는 명령은
가드가 막으니 쓰지 않는다.

## 호출 예산

- 하루 예산 기본 500회(`--budget`), `x-ratelimit-remaining` 하한 150(`--stop-remaining`). 오류 응답·재시도도 1회로 센다.
- 같은 KST 날짜의 앞선 실행은 `fixtures/recorded/train/calllog.<YYYYMMDD>.jsonl`에서 더해 잇는다(이 파일에도 키·URL은 없다).
- 429 또는 `Retry-After`, resultCode 22·23·30·31은 즉시 멈춘다. timeout·5xx·네트워크 오류만 1·2·4초(+jitter) 최대 3회 재시도.
- 다른 서비스(15129437·15129462·15129467)와 첨부 다운로드는 부르지 않는다.

## 10-20 실행(완료)

```bash
pnpm record:g2b -- --check-env --env-root /Users/leegwanghui/dev/hackathon/sol-radar   # 키 길이·형식만
pnpm record:g2b -- --phase list   --env-root /Users/leegwanghui/dev/hackathon/sol-radar   # 61회
pnpm record:g2b -- --phase sample --env-root /Users/leegwanghui/dev/hackathon/sol-radar   # 0회, sample.v0.1.json
pnpm record:g2b -- --phase aux    --env-root /Users/leegwanghui/dev/hackathon/sol-radar   # 예산 안에서 146건 × 3
pnpm eval:split
pnpm record:check
```

결과는 `docs/evidence/eval/recording-20261020.md`.

## 10-21 남은 일

표본 300건 중 10-20에 보조 조회를 하지 못한 나머지(156건 × 3 = 468회)를 받는다. 같은 명령이 이미 있는 파일을 건너뛰므로
`--aux-limit 300`으로 올리면 이어서 한다. 하루 예산 500 안이고 리허설 몫 100 이상이 남는다.

```bash
pnpm record:g2b -- --phase aux --aux-limit 300 --env-root /Users/leegwanghui/dev/hackathon/sol-radar
pnpm eval:split     # 이전 test·dev 배정은 지키고 새 후보만 더한다(--fresh 를 주면 다시 계산)
pnpm record:check
```

변경이력(`getBidPblancListInfoChgHstryServc`, 23 §4.3 약 10회)은 이 스크립트에 아직 없다. 필요하면 `LIST_OPERATION`과 같은
창 분할로 오퍼레이션만 바꿔 더한다.

## 재생

```ts
const recorded = await loadRecordedResponse("fixtures/recorded/train/15129394/<파일>");
const connector = createRecordedApiConnector({ recordings: [recorded] });
```

표본 순서·분할 결정은 seed(`sol-eval/v0.1`)와 `hash(clusterId)`로 정해져 같은 입력이면 같은 결과다. 분할 스크립트는 이전 출력의
test·dev 배정을 먼저 지켜 사람 라벨이 붙은 공고가 움직이지 않게 한다.

## 부처 공고 녹음 (ADR-040)

`record-program-notices.mjs`는 부처 지원사업 공고 응답을 한 번 부르고, 연락처를 가려 `fixtures/recorded/program-notices/<소스>/`에
저장한다. 형식은 `web/server/program-notices/recording.ts`의 `sol-program-recorded/v0.1`이고, worker 의 mock·fixture 모드가
네트워크 대신 이 파일을 재생한다. 파일 이름은 `rss-310.<KST YYYYMMDD>.masked.json`(중기부)·`api.<KST YYYYMMDD>.masked.json`(기업마당)이고,
같은 날 다시 돌리면 그 파일을 덮는다.

```bash
pnpm record:program-notices -- --source mss --dry-run   # 부르지 않고 params 만
pnpm record:program-notices -- --source mss             # 중기부 사업공고 RSS(키 없음)
```

기업마당(`--source bizinfo`)은 `BIZINFO_API_KEY`가 필요하다. 이 스크립트는 키를 `process.env`로만 받고 `.env` 파일을 읽지 않는다.
사용자가 자기 터미널에서 Node 의 `--env-file`로 한 번 돌린다(worktree 에는 `infra/.env`가 없으니 main 저장소의 절대경로를 준다).

```bash
node --env-file=/Users/leegwanghui/dev/hackathon/sol-radar/infra/.env scripts/recorded/record-program-notices.mjs --source bizinfo
```

- 가림: 기업마당 문의처(`refrncNm`)는 통째로 `***`, 다른 칸의 전화·이메일·대표번호(15xx·16xx·18xx)는 같은 길이 `*`. 중기부 RSS 는 원문 글자에서 패턴만 가린다.
- 저장 전·뒤 두 번 이메일·전화·대표번호·`crtfcKey`·키 네 형태(원문·1회·2회 인코딩·소문자 인코딩)를 세어 0건이 아니면 멈춘다. 녹음 `params`에는 키가 없다.
- 출력은 파일 경로·상태 코드·크기·항목 수·가린 필드뿐이다. 키·요청 URL·응답 본문은 출력하지 않는다. 요청 예외도 이름만 남긴다.
- `www.bizinfo.go.kr`·`mss.go.kr`의 https 만 부른다. 리다이렉트는 따르지 않고(3xx 면 멈춘다), 2 MiB·10초 상한이다.
- 기업마당 요청 값(분야 `02`, 최대 100건)은 `infra/sources/program-notices.yaml`의 기본값과 같다.

## LH 입찰공고 녹음 (15159012, 2026-10-27)

`record-lh-bid-notice.mjs` 는 LH 입찰공고 `getOpenBidInfo` 를 **한 번 실행에 정확히 1회** 부르고 가려 저장한다. 첫 실호출 검증용이다.
실행은 사용자 승인 뒤에만 하고, 순서·횟수(1~3회)·멈춤 조건은 `docs/plans/2026-10-27-lh-bid-notice-activation.md` §3 을 따른다.
2026-10-27 15:13 KST 회사 서버에서 1회 실행했다(HTTP 200·`00`·10건). 응답이 EUC-KR 이라 그 녹음의 한글은 깨졌고, 스크립트를 고쳐 다시 녹음할 차례다(`docs/evidence/ingestion/20261027-lh-bid-notice/first-call.md`). `fixtures/recorded/15159012/` 는 아직 없다.

```bash
# 회사 서버, 일회용 컨테이너(운영 Worker 재시작 없음). 키는 infra/.env.worker.local 의 LH_BID_NOTICE_SERVICE_KEY
node scripts/recorded/record-lh-bid-notice.mjs --date 20261026 --page 1 --rows 10 --out <폴더> --dry-run   # 0회
node scripts/recorded/record-lh-bid-notice.mjs --date 20261026 --page 1 --rows 10 --out <폴더>             # 1회
```

- 키는 `process.env.LH_BID_NOTICE_SERVICE_KEY` 로만 받는다. 이 스크립트는 `.env` 파일을 읽지 않는다. Encoding·Decoding 키 모두 한 번 풀어 `URLSearchParams` 가 한 번 인코딩한다.
- 인자 범위: `--date` KST 하루(YYYYMMDD, 등록일 시작·끝을 같은 날로), `--page` 1~5, `--rows` 1~100. 모르는 인자는 멈춘다.
- 재시도하지 않는다. 결과 코드가 오류여도 그 응답을 가려 남기고 끝난다. 같은 이름의 녹음이 있으면 부르기 전에 멈춘다.
- 응답은 `Content-Type` charset 대로 읽는다(LH 는 `text/xml;charset=EUC-KR`). Worker(`external-api-connector.ts`)와 같은 규칙이다. 그 charset 으로 읽지 못하면 깨진 글자로 저장하지 않고 멈춘다.
- `https://apis.data.go.kr/B552555/OpenBidInfoList/getOpenBidInfo` 만 부른다. 리다이렉트는 따르지 않고, 2 MiB(받은 바이트를 세며 읽다 넘으면 끊음)·10초 상한이다.
- 가림: 담당자 계열 태그(`ofcl`·`charger`·`chpsn`·`email`·`telno` 등)와 공개 명세(Swagger 응답 필드 178개·게이트웨이 오류 태그)에 없는 태그는 값을 `***` 로, 본문의 이메일·전화는 같은 길이 `*`. 명세에는 담당자 칸이 없으므로 실응답에 이름·연락처 칸이 더 있어도 원문이 저장되지 않는다. 저장 전·뒤 흔적 검사(키 네 형태 포함)가 0건이 아니면 파일을 지우고 멈춘다.
- 출력은 결과 코드·`totalCount`·항목 수·필드 모양(`digits:N`·`text`·`empty`)·상태류 값 목록(`bidKind`·`bidProgrsStatus`·`zoneHqCd`·`cstrtnJobGbNm`·`tndrCtrctMedCd`)뿐이다. 키·요청 URL 은 출력하지 않는다.
- 녹음 형식은 `sol-external-recorded/v0.1`(`params`·`fetchedAt`·`httpStatus`·`rawSha256`·`maskedFields`·`maskedBody`). 시험용 합성 응답은 `fixtures/synthetic/15159012/` 에 따로 있고 녹음과 섞지 않는다.
- 시험: `node --test scripts/recorded/record-lh-bid-notice.test.mjs`(가짜 fetch, 호출 0회).
