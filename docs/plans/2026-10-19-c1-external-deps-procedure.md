---
title: "C1 P0-0 외부 의존성 검증 절차 (공공 API·첨부·GPU)"
status: review
tags:
  - sol-radar
  - ops
  - hackathon
  - plan
updated: 2026-10-19
---

# C1 P0-0 외부 의존성 검증 절차

[[12-ROADMAP|12 로드맵]] C1과 [[11-TESTING|11 테스트]] §3.3의 "방법" 열을 구체화한 절차다. 체크리스트와 결과 기록은 `docs/evidence/phase-0/external-deps.md`이고, 이 문서는 그 항목(A1~A9, B1~B4, G1~G6, D1~D3)을 어떻게 실행하는지 적는다. G 항목은 [[16-DECISIONS|ADR-025]](사용자 결정 2026-10-19)로 재정의했다: 회사 GPU 서버 직접 접속·터널·기동 절차 대신 회사가 제공하는 HTTPS 추론 엔드포인트를 점검한다(§7·§8). 2026-10-19 기준 어느 항목도 실행하지 않았다. 아래 응답 구조·필드 이름·오류 코드는 **실측 전 가정**이고, 실제 응답을 받은 뒤 이 문서와 [[07-DATA-PIPELINE|07 수집]] §3.1·[[15-DATA-CONTRACTS|15 데이터 계약]] §8을 고친다.

> [!warning] 비밀값 보호
> 서비스키 4개 값, Supabase 키, 모델 엔드포인트 인증 키(`QWEN_API_KEY`·`KEV_API_KEY`) 값과 `Authorization` 헤더는 이 문서·체크리스트·로그·증거·요청 URL·커밋에 적지 않는다. 엔드포인트 URL(`https://acropolissg.com/sol-radar`)은 비밀이 아니다. 검증 명령은 `$G2B_...` 같은 변수 참조만 쓴다. `set -x`, `echo "$G2B_..."`, `env | grep G2B`, `curl -v`(URL이 찍힌다)는 금지다. 응답을 저장할 때 `serviceKey`가 든 URL은 남기지 않고 담당자 이름·전화·이메일은 마스킹한다([[09-SECURITY|09 보안]]).

## 1. 환경변수 이름과 로딩 계약

| env 이름 | 서비스 (ID) | 읽는 쪽 | 두는 곳 |
|---|---|---|---|
| `G2B_BID_NOTICE_SERVICE_KEY` | 입찰공고정보서비스 (15129394) | worker `OfficialApiConnector` | `infra/.env` |
| `G2B_PRE_SPEC_SERVICE_KEY` | 사전규격정보서비스 (15129437) | 같음 | `infra/.env` |
| `G2B_ORDER_PLAN_SERVICE_KEY` | 발주계획현황서비스 (15129462) | 같음 | `infra/.env` |
| `G2B_INDUSTRY_MASTER_SERVICE_KEY` | 업종 및 근거법규 (15129467) | 같음 | `infra/.env` |

- 규칙 원천은 `infra/run-modes.json`이다. `modes.live.requiredSecrets`에 네 이름이 있고, `pnpm check:env`(`scripts/check-env.mjs`)는 `infra/.env`의 `SOL_RUN_MODE=live`일 때만 네 키를 `MISSING_KEY`로 요구한다. `fixture`·`mock`에서는 요구하지 않는다. `web/.env.local`에 네 키가 있으면 `FORBIDDEN_KEY`로 실패한다(`NEXT_PUBLIC_`로 시작하며 `G2B`가 든 이름도 금지).
- `pnpm check:env`는 파일 내용만 보고 값은 출력하지 않는다. 출력은 `FAIL <파일> <키> <코드>` 줄과 요약 한 줄이다. 셸 환경변수는 보지 않으므로, 수동 검증에서 셸 `export`만 했다면 `check:env`는 여전히 `MISSING_FILE`·`MISSING_KEY`를 낼 수 있다. 이것은 오류가 아니라 "파일에 없다"는 뜻이다.
- 값은 data.go.kr 일반 인증키 중 **Decoding 키**(인코딩 전 원문)다. Connector와 아래 curl 모두 URL 인코딩을 한 번만 한다(`--data-urlencode`). Encoding 키를 넣으면 두 번 인코딩돼 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`(30)가 나올 수 있다(실측 전 가정).
- 루트 `.env.local`은 `pnpm db:push`·`pnpm demo:reset`용이고 서비스키 자리가 아니다. 컨테이너 밖 수동 호출용으로는 다음 둘 중 하나를 쓴다. 둘 다 값은 셸 세션 메모리에만 있다.

```bash
# 방법 1: 이 세션에만 넣는다(값은 사람이 직접 친다. 히스토리에 남지 않게 앞에 공백을 두거나 HISTCONTROL=ignorespace).
 export G2B_BID_NOTICE_SERVICE_KEY='...'

# 방법 2: 사용자 전용 env 파일(저장소 밖, 예: ~/.config/sol-radar/g2b.env, 권한 600)을 읽는다.
set -a; source "$HOME/.config/sol-radar/g2b.env"; set +a
```

- 호출 뒤에는 `unset G2B_BID_NOTICE_SERVICE_KEY G2B_PRE_SPEC_SERVICE_KEY G2B_ORDER_PLAN_SERVICE_KEY G2B_INDUSTRY_MASTER_SERVICE_KEY`로 지운다.
- A1(키 존재 확인)은 값을 보지 않고 길이만 본다: `for k in G2B_BID_NOTICE_SERVICE_KEY G2B_PRE_SPEC_SERVICE_KEY G2B_ORDER_PLAN_SERVICE_KEY G2B_INDUSTRY_MASTER_SERVICE_KEY; do printf '%s %s\n' "$k" "${!k:+set(${#!k}자)}"; done`. `set(…)`이 네 줄 다 나오면 통과. 길이만 기록한다.

## 2. 오퍼레이션별 요청 파라미터 (실측 전 가정)

근거는 [[07-DATA-PIPELINE|07 수집]] §1.1·§2.2와 [[15-DATA-CONTRACTS|15 데이터 계약]] §8(2026-10-16 data.go.kr 서비스 페이지 명세). 공통 파라미터는 `serviceKey`, `type=json`, `pageNo`, `numOfRows`다. 기본 URL은 `http://apis.data.go.kr`이며 명세가 http로 적혀 있다. https가 되는지는 첫 호출에서 함께 확인한다(되면 https를 쓴다).

| registry `key` | 서비스 (ID) | 경로 + 오퍼레이션 | 필수 파라미터(공통 외) | 검증 호출 범위 |
|---|---|---|---|---|
| `g2b-bid-notice` | 입찰공고 (15129394) | `/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc` | `inqryDiv=1`(등록일시) 또는 `3`(변경일시), `inqryBgnDt`·`inqryEndDt`(`YYYYMMDDHHMM`) | 최근 1일, `numOfRows=10`, 1회(+ https 확인 1회) |
| `g2b-bid-notice` | 같음 | `.../getBidPblancListInfoChgHstryServc` | `inqryBgnDt`·`inqryEndDt` | 최근 1일, 1회 |
| `g2b-bid-license-limit` | 같음 | `.../getBidPblancListInfoLicenseLimit` | `bidNtceNo`, `bidNtceOrd` | 공고 3건 × 1회 |
| `g2b-bid-region` | 같음 | `.../getBidPblancListInfoPrtcptPsblRgn` | `bidNtceNo`, `bidNtceOrd` | 공고 3건 × 1회 |
| `g2b-bid-eorder-attach` | 같음 | `.../getBidPblancListInfoEorderAtchFileInfo` | `bidNtceNo`, `bidNtceOrd` | 공고 3건 × 1회 |
| `g2b-pre-spec` | 사전규격 (15129437) | `/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServc` | `inqryDiv`, `inqryBgnDt`·`inqryEndDt`(가정) | 최근 1일, 1회 |
| `g2b-pre-spec` | 같음 | `.../getPublicPrcureThngInfoServcPPSSrch` | 위 + `swBizObjYn`(가정) | 1회(선택) |
| `g2b-order-plan` | 발주계획 (15129462) | `/1230000/ao/OrderPlanSttusService/getOrderPlanSttusListServc` | 조회 연도·기간 파라미터(명세 확인 필요) | 1회 |
| `g2b-industry-master` | 업종 및 근거법규 (15129467) | `/1230000/ao/IndstrytyBaseLawrgltInfoService/getIndstrytyBaseLawrgltInfoList` | 없음(가정), `numOfRows` 최대값은 명세 확인 | 전체 수신 1~3회(페이지) |

검증 호출 예(입찰공고 목록, 최근 1일). 날짜는 KST 기준이고 호출 시각에 맞춰 바꾼다.

```bash
BASE='http://apis.data.go.kr/1230000/ad/BidPublicInfoService'
OUT="$SCRATCH/g2b-bid-notice.getBidPblancListInfoServc.raw.json"   # SCRATCH = 세션 스크래치 폴더, 저장소 밖
curl -sS --get "$BASE/getBidPblancListInfoServc" \
  --data-urlencode "serviceKey=$G2B_BID_NOTICE_SERVICE_KEY" \
  --data-urlencode "type=json" \
  --data-urlencode "pageNo=1" \
  --data-urlencode "numOfRows=10" \
  --data-urlencode "inqryDiv=1" \
  --data-urlencode "inqryBgnDt=$(date -v-1d +%Y%m%d)0000" \
  --data-urlencode "inqryEndDt=$(date +%Y%m%d)2359" \
  --max-time 15 -o "$OUT" -w 'http=%{http_code} size=%{size_download} time=%{time_total}\n'
```

- `-w`에 `%{url_effective}`를 넣지 않는다(키가 찍힌다). `--get`은 파라미터를 쿼리 문자열로 붙이므로 서버 로그와 프록시에 키가 남는 것은 data.go.kr 방식상 피할 수 없다. 우리 쪽 기록만 막는다.
- 보조 조회는 목록 응답에서 `bidNtceNo`·`bidNtceOrd`를 뽑아 같은 형식으로 부른다. 공고 3건은 `infoBizYn='Y'`인 것으로 고른다(§4.5).
- 예상 응답 최상위 구조(data.go.kr 공통 형식, 실측 전 가정): `response.header.resultCode`(`"00"`이 정상)·`response.header.resultMsg`, `response.body.items`(배열 또는 `items.item`), `response.body.totalCount`·`pageNo`·`numOfRows`. 실제 형식이 다르면 §6 fixture 스키마의 `items` 추출 규칙을 그 형식에 맞춘다.
- 사전규격·발주계획의 필수 파라미터 이름은 서비스 페이지 Swagger로 호출 직전에 다시 확인한다. 위 표의 "가정" 표시가 그 자리다.

## 3. 응답 저장 위치와 마스킹

| 종류 | 위치 | 커밋 |
|---|---|---|
| 원본 응답(`*.raw.json`) | 세션 스크래치 폴더. 사설 MinIO를 쓸 수 있으면 `raw/recorded/<serviceId>/`에만 | 안 한다 |
| 마스킹 사본 | `fixtures/recorded/<serviceId>/<operation>.<YYYYMMDD>.masked.json` | 한다 |
| 메타 | 같은 파일의 `meta` 블록 | 한다 |

마스킹 사본 형식(§6 `RecordedApiConnector` 입력과 같은 파일):

```json
{
  "schemaVersion": "sol-recorded/v0.1",
  "serviceId": "15129394",
  "registryKey": "g2b-bid-notice",
  "operation": "getBidPblancListInfoServc",
  "params": { "type": "json", "pageNo": "1", "numOfRows": "10", "inqryDiv": "1", "inqryBgnDt": "...", "inqryEndDt": "..." },
  "fetchedAt": "2026-10-2xT..Z",
  "httpStatus": 200,
  "resultCode": "00",
  "resultMsg": "...",
  "totalCount": 0,
  "items": [],
  "masked": true,
  "maskedFields": ["ntceInsttOfclNm", "ntceInsttOfclTelNo", "ntceInsttOfclEmailAdrs"],
  "rawSha256": "<원본 파일 sha256>"
}
```

- `params`에 `serviceKey`는 넣지 않는다. 요청 URL 전체도 넣지 않는다.
- 마스킹 대상 필드 후보. 입찰공고 명세에서 이름을 확인한 것은 `ntceInsttOfclNm`(공고기관 담당자명)·`ntceInsttOfclTelNo`(전화)·`ntceInsttOfclEmailAdrs`(이메일)이다. 집행관·수요기관 담당자 필드(`exctvNm` 등)는 **명세 확인 필요**이며, 첫 응답에서 이름에 `Ofcl`·`Nm`·`TelNo`·`Email`이 든 필드를 전부 나열해 마스킹 목록을 확정한다. 사전규격·발주계획·업종 마스터의 담당자 필드도 같은 방법으로 찾는다.
- 마스킹 값: 이름은 `"***"`, 전화·이메일은 같은 길이의 `*`(길이를 지켜 인용 오프셋이 흔들리지 않게 한다, [[21-MODEL-TRAINING|21 모델 학습]] §3.6과 같은 규칙).
- `rawSha256`은 마스킹 전 원본의 해시다. 원본은 저장소 밖에만 있으므로 해시로 출처를 잇는다.
- 저장 뒤 `infra/sources/registry.yaml`(C3에서 만든다)의 `sampleResponses`에 경로 3건을 적고 `lastVerifiedAt`을 실제 응답 확인일로, `approvalStatus`를 `APPROVED`로 바꾼다([[15-DATA-CONTRACTS|15 데이터 계약]] §8). registry 파일이 아직 없으면 `external-deps.md`에 경로만 적어 둔다.

## 4. 연결 상태 체크 절차 (A1~A9)

순서대로 한다. 한 단계가 막히면 그 단계를 "막힘"으로 적고 즉시 보고한다. 다음 단계는 막힌 단계에 기대지 않는 것만 한다.

### 4.1 A1 키 존재

§1 마지막 명령으로 네 키의 길이만 기록한다. `infra/.env`에 넣었다면 `pnpm check:env`도 돌리고 `MISSING_KEY`·`PLACEHOLDER`·`FORBIDDEN_KEY`가 0건인지 본다. 출력에 값은 없다.

### 4.2 A2 첫 호출 성공 판정

§2 예시로 입찰공고 목록 1회. 통과 기준: `http=200` 그리고 응답의 `resultCode`가 `"00"`. 응답 파일은 `jq '.response.header'`로 헤더만 먼저 본다(본문에 담당자 필드가 있으므로 전체를 터미널에 찍지 않는다).

실패 유형(앞 두 열은 data.go.kr 공통 명세 기준이며 실측 전):

| 신호 | 뜻 | 기록 |
|---|---|---|
| HTTP 4xx·5xx | 게이트웨이·서비스 오류 | `http`·`resultCode` 없음 |
| `resultCode` `01`·`02`·`04`·`05`·`99` | 제공기관 쪽 오류·timeout·알 수 없음 | 1회 재시도 뒤 막힘 |
| `10`·`11`·`12` | 파라미터 오류·필수 파라미터 누락·없는 오퍼레이션 | 우리 요청 문제. §2 표 수정 |
| `20`·`32`·`33` | 접근 거부·미등록 IP·서명 없는 호출 | 활용신청 상태·IP 등록 확인(사용자) |
| `22` | 일일 허용량 초과 | 그 서비스의 그날 호출 중단 |
| `30`·`31` | 미등록 키·기간 만료 | 키 종류(Decoding)·활용 기간 확인(사용자) |
| curl timeout(15 s) | 네트워크 | 1회 재시도 |

### 4.3 A3 응답 스키마 대조표

응답 1건의 키 목록을 뽑아 [[07-DATA-PIPELINE|07 수집]] §3.1 매핑표와 대조한다.

```bash
jq -r '.response.body.items[0] // .response.body.items.item[0] | keys[]' "$OUT" | sort > "$SCRATCH/keys.txt"
```

대조표(`external-deps.md` A3 행 아래에 붙인다):

| `NormalizedBid` 필드 | 기대 원본 필드 | 존재 | 비고 |
|---|---|---|---|
| `noticeId`·`amendmentNo` | `bidNtceNo`·`bidNtceOrd` | ✓/✗ | |
| `title` | `bidNtceNm` | | |
| `agency` | `dminsttNm`(수요기관), `ntceInsttNm`(공고기관) | | |
| `budgetKrw` | `asignBdgtAmt`, `presmptPrce` | | 둘 중 무엇이 채워지는지 |
| `deadlineAt` | `bidClseDt` | | 형식(`YYYY-MM-DD HH:mm` 등) 기록 |
| `sourceUrl` | `bidNtceDtlUrl`, `bidNtceUrl` | | |
| 상태·정정 | `ntceKindNm`, `chgNtceRsn`, `reNtceYn`, `befBidBbancNo` | | |
| `planRef`·`preSpecRef` | `orderPlanUntyNo`, `bfSpecRgstNo` | | |
| 첨부 | `ntceSpecDocUrl1~10`, `ntceSpecFileNm1~10` | | 실제로 몇 번째까지 채워지는지 |
| 구조화 자격 | `lcnsLmtNm`, `permsnIndstrytyList`, `prtcptPsblRgnNm`, `indstrytyLmtYn`, `bidPrtcptLmtYn`, `rgnDutyJntcontrctRt` | | 목록 응답에 있는지, 보조 조회에만 있는지 |
| 정보화사업 | `infoBizYn` | | |
| 계약 방식 | `cntrctCnclsMthdNm`, `sucsfbidMthdNm` | | |

✗인 필드는 `keys.txt`에서 비슷한 이름을 찾아 "실제 이름" 열에 적는다. 지어내지 않는다.

### 4.4 A4·A5·A6 공고 선별과 보조 조회

- A4: 목록에서 `infoBizYn == "Y"`인 공고를 센다. 1일 범위에 0건이면 범위를 7일까지 넓힌다(호출 1회 추가). 요청 파라미터로 `infoBizYn`을 거를 수 있는지는 파라미터를 붙여 1회 호출해 `resultCode`와 건수 변화로 본다(미결정 1번).
- A5: 고른 공고 3건에 보조 조회 3종을 각 1회. 면허제한 응답의 행 수와 행 사이 관계(AND/OR 표현 필드가 있는지)를 기록한다(미결정 19번). 없으면 "표현 필드 없음"으로 적고 규칙 엔진의 `AMBIGUOUS_MATCH` 처리가 그대로다.
- A6: 사전규격·발주계획 각 1페이지. 응답에 `bidNtceNoList`·`orderPlanUntyNo`·`bfSpecRgstNo`가 있는지, A2의 공고 3건 중 이 식별자로 이어지는 것이 있는지 본다. 없어도 실패가 아니다(단계 연결은 확장 컷 P0-8).

### 4.5 A7 업종 마스터

`numOfRows`를 명세 최대값으로 두고 `totalCount`만큼 페이지를 돈다. 전체를 받아 `fixtures/recorded/15129467/`에 저장한다. 담당자 필드가 없는 코드 표이므로 마스킹 대상이 없을 가능성이 크지만 §3 규칙으로 한 번 확인한다. 소프트웨어사업자 등 [[08-SCORING|08 점수]]가 쓰는 업종 코드의 실제 값을 찾아 적는다.

### 4.6 A8 오류·호출 제한

- 잘못된 파라미터 1회(예: `inqryDiv=9`)로 오류 응답 형식을 받는다. 의도적으로 한도를 소진하지 않는다.
- 응답 헤더의 `Retry-After`·rate limit 헤더 유무를 `curl -sS -D "$SCRATCH/headers.txt" -o /dev/null`로 본다. 헤더 파일에는 키가 없다.
- 이 점검의 총 호출 수를 서비스마다 센다. 상한은 서비스당 30회. 끝나면 `external-deps.md`의 호출 예산 줄에 적는다.

### 4.7 A9 fixture 변환

§3 형식으로 마스킹 사본을 만든다. 변환은 `jq`로 한다(스크립트 코드는 C3에서 만든다). 예:

```bash
jq --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg sha "$(shasum -a 256 "$OUT" | cut -d' ' -f1)" '
  {schemaVersion:"sol-recorded/v0.1", serviceId:"15129394", registryKey:"g2b-bid-notice",
   operation:"getBidPblancListInfoServc",
   params:{type:"json",pageNo:"1",numOfRows:"10",inqryDiv:"1"},
   fetchedAt:$at, httpStatus:200,
   resultCode:.response.header.resultCode, resultMsg:.response.header.resultMsg,
   totalCount:.response.body.totalCount,
   items:[(.response.body.items // .response.body.items.item // [])[]
     | .ntceInsttOfclNm="***" | .ntceInsttOfclTelNo="***" | .ntceInsttOfclEmailAdrs="***"],
   masked:true, maskedFields:["ntceInsttOfclNm","ntceInsttOfclTelNo","ntceInsttOfclEmailAdrs"],
   rawSha256:$sha}' "$OUT" > fixtures/recorded/15129394/getBidPblancListInfoServc.$(date +%Y%m%d).masked.json
```

저장 전에 `grep -c '@' <파일>`과 전화 패턴(`[0-9]{2,3}-[0-9]{3,4}-[0-9]{4}`)으로 남은 개인정보가 0건인지 확인한다. §3의 마스킹 목록이 확정되기 전에는 커밋하지 않는다.

## 5. 첨부 3건 검증 절차 (B1~B4)

1. **B1 URL 추출**: A2 응답(또는 e발주 첨부 응답)에서 `ntceSpecDocUrl1~10`과 e발주 첨부 URL을 뽑는다. 호스트가 `www.g2b.go.kr`(https)인지 본다. 다른 호스트면 그 URL은 쓰지 않고 호스트 이름만 기록한다(allowlist 정책, [[09-SECURITY|09 보안]] SSRF).
2. **B2 다운로드**: 공고 3건에서 각 1개, 총 3개.

```bash
curl -sS -o "$SCRATCH/att-1.bin" \
  -w 'http=%{http_code} type=%{content_type} size=%{size_download} redirect=%{redirect_url}\n' \
  --max-time 30 --max-filesize 52428800 --max-redirs 2 -L "$ATT_URL"
```

   - 리다이렉트는 `-L` 전에 한 번 `--max-redirs 0`으로 불러 `%{redirect_url}`의 호스트를 먼저 본다. allowlist 밖이면 `-L`을 쓰지 않고 `REDIRECT_BLOCKED`로 적는다.
   - 로그인 요구 판정: `http=302`이고 `redirect`에 `login`·`sso`가 들어가거나, `http=200`인데 `type`이 `text/html`이고 본문에 로그인 폼이 있으면 `AUTH_REQUIRED`다(미결정 16번).
   - `http=4xx`·`5xx` → `HTTP_4XX`·`HTTP_5XX`. `--max-filesize` 초과 → `TOO_LARGE`. 30 s 초과 → `TIMEOUT`.
3. **B3 형식 판정**: 확장자가 아니라 내용으로.

```bash
head -c 8 "$SCRATCH/att-1.bin" | xxd
```

   | 서명 | 형식 |
   |---|---|
   | `25 50 44 46 2D`(`%PDF-`) | PDF |
   | `D0 CF 11 E0 A1 B1 1A E1` | OLE2 → HWP 5.0(또는 doc/xls, 내부 스트림으로 확정은 파서에서) |
   | `50 4B 03 04` | zip → HWPX·docx·xlsx·zip 중 하나. `unzip -l`로 `Contents/content.hpf`가 있으면 HWPX |
   | 그 외 | `UNSUPPORTED_FORMAT` 후보 |

4. **B4 결과 표**: `external-deps.md` B 절에 공고번호(마스킹 불필요)·URL 호스트·HTTP·`Content-Type`·크기·형식·사유 코드. 파일 자체는 저장소에 넣지 않는다(첨부 저작권 미확인, 미결정 18번). 파싱 비교(D2)용으로 스크래치에만 둔다.

## 6. 실데이터 fixture 생성 절차

- 입력: §3의 마스킹 사본. 저장 위치는 `fixtures/recorded/<serviceId>/<operation>.<YYYYMMDD>.masked.json`.
- `RecordedApiConnector`(C3에서 구현)는 이 파일을 읽어 `fetchPage`가 `items`를 그대로 돌려준다. 네트워크 호출은 없다. 시험 이름에 "실제 응답(마스킹)"이라고 적어 "공식 참고문서 예시"와 구분한다([[07-DATA-PIPELINE|07 수집]] §2.3).
- 검증기(C3에서 `scripts/recorded/check.mjs`로 만든다)가 볼 것: `schemaVersion`, `masked: true`, `maskedFields` 비어 있지 않음, `items`에 `@`·전화 패턴 0건, `params`에 `serviceKey` 없음, `rawSha256` 64자. 지금은 §4.7의 `grep`으로 손으로 본다.
- `external-deps.md`에 적을 것: A9 행의 결과에 파일 경로 3건 이상, 각 파일의 `resultCode`·`totalCount`·`items` 수, 마스킹 필드 목록, 원본 sha256.
- 이 fixture는 `fixture`·`mock` 실행 모드의 `FixtureConnector`(FX-01~FX-20)와 다르다. 실행 모드가 고르는 Connector가 아니라 시험·개발 전용이다.

## 7. 모델 엔드포인트 점검 절차 (G1~G4)

[[16-DECISIONS|ADR-025]](사용자 결정 2026-10-19): 회사 GPU 서버는 외부에서 접근할 수 없다(SSH·VPN 터널 불가). 회사가 모델 런타임(vLLM Qwen3.5-9B, `kev.serve` Kev-9B@v1.0)을 HTTPS 엔드포인트 `https://acropolissg.com/sol-radar` 아래로 제공하고, 노트북 ai-gateway가 거기에 HTTPS로 붙는다. 모델 기동·GPU 메모리·가중치 대조·`nvidia-smi`는 회사 측 운영이라 우리는 하지 않는다. 우리가 하는 것은 `GET /v1/models` 레지스트리 대조와 지연 실측뿐이다. 엔드포인트는 회사가 제공 예정이며 2026-10-19 기준 응답을 아직 확인하지 않았다. 아키텍처(Worker → gateway → 모델)·실행 모드·`AI_PROVIDER=local`은 그대로다.

선행 조건:

- **P2** 회사가 엔드포인트 경로·인증 방식을 전달한다. 전달 전까지 아래는 **가정**이다: `QWEN_BASE_URL=https://acropolissg.com/sol-radar/qwen`, `KEV_BASE_URL=https://acropolissg.com/sol-radar/kev`, 인증은 `Authorization: Bearer <키>`. 실제 값은 회사가 알려 주는 대로 `infra/.env`에만 적는다(`QWEN_API_KEY`·`KEV_API_KEY`). env 이름은 바꾸지 않는다.
- **P3** 회사 측 모델 기동 완료 통보. 통보 전에는 G1만 할 수 있다(401/403 또는 연결 실패를 그대로 적는다).

호출 예산: 이 점검 전체 Kev 20회·Qwen 5회 이하. 키는 셸 변수로만 둔다(§1 방법 1·2와 같은 방식, 변수 이름 `QWEN_API_KEY`·`KEV_API_KEY`). 값·`Authorization` 헤더를 로그·증거·터미널 출력에 남기지 않는다. `curl -v`·`set -x` 금지, `curl -k`(인증서 검증 끄기) 금지.

1. **G1 HTTPS 접속·TLS**: 인증 없이 각 1회.

```bash
curl -sS -o /dev/null -w 'http=%{http_code} ssl_verify=%{ssl_verify_result} time=%{time_total}\n' \
  --max-time 15 "$KEV_BASE_URL/v1/models"
curl -sS -o /dev/null -w 'http=%{http_code} ssl_verify=%{ssl_verify_result} time=%{time_total}\n' \
  --max-time 15 "$QWEN_BASE_URL/v1/models"
```

   기대: `http=401` 또는 `403`(인증 요구), `ssl_verify=0`(인증서 유효). `http=000`이거나 curl이 인증서 오류를 내면 "미접속"으로 적고 회사에 알린다. `curl -k`로 우회하지 않는다. 인증 없이 `200`이 나오면 그대로 기록하고 회사에 보고한다(API 키 필수, [[09-SECURITY|09 보안]]).

2. **G2 `/v1/models` 레지스트리 대조**(Bearer, Kev·Qwen 각 1회):

```bash
curl -sS --max-time 15 -H "Authorization: Bearer $KEV_API_KEY" "$KEV_BASE_URL/v1/models" > "$SCRATCH/kev-models.json"
curl -sS --max-time 15 -H "Authorization: Bearer $QWEN_API_KEY" "$QWEN_BASE_URL/v1/models" > "$SCRATCH/qwen-models.json"
grep -i -E 'key|token|secret' "$SCRATCH/kev-models.json" "$SCRATCH/qwen-models.json" && echo "비밀 의심 필드 있음: 저장 전 확인" || echo "비밀 의심 필드 없음"
```

   - 두 응답을 `docs/evidence/phase-0/endpoint-models.json`에 `{ "kev": …, "qwen": …, "fetchedAt": "…" }`로 저장한다. 저장 전에 위 `grep`으로 키·토큰 값이 응답에 없는지 본다(있으면 그 필드를 지우고 지웠다고 적는다).
   - Kev 응답의 `run`·`base`·`lora`·`temperature`를 `services/ai/models/registry.yaml`(C5에서 만든다. 2026-10-19 기준 파일 없음. 그때까지는 [[03-AI-PIPELINE|03 AI 파이프라인]] §11 표)과 대조한다. 필드 이름은 실측 전 가정이다. 다르면 실제 이름을 적고 §11 표를 고칠 항목으로 보고한다.
   - vLLM 응답 `data[].id`가 `Qwen/Qwen3.5-9B`인지 본다. 다르면 그 값을 적는다(레지스트리 `qwen` 항목 갱신 후보).

3. **G3 지연 실측**([[03-AI-PIPELINE|03 AI 파이프라인]] §5.9 2번):
   - Kev `POST /v1/systemone`에 §5.6 영어 템플릿 state(약 500 토큰)·질문 4종을 **10회**. 응답 `latency_ms`의 p50·p95와 curl `%{time_total}` 왕복 p50·p95를 적는다. state는 fixture(`FX-01`)로 만들고 실제 공고 원문은 쓰지 않는다.
   - vLLM `POST /v1/chat/completions`에 `/extract` 추출 프롬프트(fixture 본문 1건) **1회** 왕복 시간.
   - 결과로 `KEV_TIMEOUT_MS`(기본 `5000`)·`AI_TIMEOUT_MS`(기본 `60000`, Qwen) 권고값을 낸다. 왕복 p95에 여유를 둔 값을 권고로 적고, 적용은 [[03-AI-PIPELINE|03 AI 파이프라인]] §4 env 표 갱신으로 별도 보고한다.
   - Kev 10회 중 1회라도 10초를 넘으면 그 사실을 적는다(§5.9 "10초 초과면 쓰지 않는다").

4. **G4 vLLM guided JSON**: `response_format`(`json_schema`) 또는 vLLM `guided_json`으로 `RequirementExtraction` 축소 스키마 **1회** 요청. 응답이 스키마대로 파싱되는지 본다. 같은 요청에 `logprobs=true`를 넣어 E3 실험 전제(`logprobs`)도 함께 확인한다. 어느 파라미터가 통하는지 적는다(C5 gateway `local` 어댑터 구현 입력).

기록은 `docs/evidence/phase-0/endpoint-check.md`(G1~G6 결과, 지연 표)와 `endpoint-models.json`에 둔다. `external-deps.md` G1~G6 행에 통과/막힘과 날짜를 적는다.

## 8. 회사 제공 정보와 장애 경로 (G5~G6)

VRAM 추정·기동 절차·GPU 배분은 회사 측 운영으로 넘어갔다([[16-DECISIONS|ADR-025]]). "모델 기동·GPU 점유 사용자 승인"은 더 이상 없다. LoRA 메모리 검증은 회사 측 실행 요청 사항이다.

1. **G5 회사 제공 GPU 정보**: 회사가 GPU 모델·VRAM·점유·가중치 sha256·가중치 다운로드 시간을 주면 `endpoint-check.md`에 "회사 제공(날짜)"으로 적는다. 주지 않으면 "회사 운영, 미제공"으로 적는다. 직접 측정하지 않고 추정값을 넣지 않는다. Kev-9B 추론 메모리의 문서 불일치(모델 카드 21.9 GB vs README 약 17 GB)는 회사 값이 오기 전까지 미검증으로 둔다.
2. **G6 엔드포인트 미접속 → `PARTIAL`**: `KEV_BASE_URL`(또는 `QWEN_BASE_URL`)을 잘못된 경로로 **1회** 바꿔 gateway가 `KEV_UNAVAILABLE`·`QWEN_UNAVAILABLE`을 내고 Worker 결과가 `PARTIAL`·`RULES_ONLY`로 끝나는지, 자동 mock 대체가 없는지 본다. **C5 gateway `local` 어댑터 구현 뒤에 한다**(대기 사유: 2026-10-19 기준 `local` 어댑터 미구현). 재접속 확인은 `GET /v1/models`(G2 명령) 1회다.

운영 전제:

- TLS 필수. 인증서 검증을 끄지 않는다(`curl -k`, 클라이언트 `verify=False` 금지).
- API 키 필수. 값은 `infra/.env`에만 둔다(`QWEN_API_KEY`·`KEV_API_KEY`). `web/.env.local`·`NEXT_PUBLIC_`에 넣지 않는다.
- 엔드포인트 URL은 비밀이 아니다. 키 값은 어디에도 적지 않는다.
- env 이름은 그대로다(`QWEN_BASE_URL`·`KEV_BASE_URL`·`QWEN_API_KEY`·`KEV_API_KEY`). SSH 포트포워딩·`127.0.0.1:8001`/`8009` 바인딩·`host.docker.internal` 전제는 폐기했다(이력: ADR-025 이전 §7·§8).
- `kev.serve`·vLLM 기동 명령·버전 고정은 회사 측 사항이다. 우리가 회사에 요청할 것: vLLM 모델 id `Qwen/Qwen3.5-9B`, guided JSON·`logprobs` 활성, Kev `--run jaredpalmer/kev-9b@v1.0`, 두 런타임의 `GET /v1/models` 노출, API 키 인증.

## 9. 산출물·보고 형식

| 산출물 | 위치 | 규칙 |
|---|---|---|
| 체크리스트 결과 | `docs/evidence/phase-0/external-deps.md` | 행마다 상태(통과/막힘/대기)·결과 요약·날짜. 막힘은 사유와 보고 시각. 값·URL·호스트 없음 |
| 마스킹 응답 | `fixtures/recorded/<serviceId>/*.masked.json` | §3 형식, 개인정보 0건 확인 뒤 커밋 |
| 스키마 대조표 | `external-deps.md` A3 아래 | §4.3 표 |
| 첨부 결과 표 | `external-deps.md` B 절 | 파일은 저장소 밖 |
| 엔드포인트 점검 | `docs/evidence/phase-0/endpoint-check.md` | G1~G6 결과·지연 표. 키 값·`Authorization` 헤더 없음. 옛 이름 `gpu-check.txt`는 쓰지 않는다 |
| `/v1/models` 응답 | `docs/evidence/phase-0/endpoint-models.json` | 비밀 의심 필드 0건 확인 뒤 저장 |
| 회사 제공 GPU 정보 | `endpoint-check.md` G5 절 | 없으면 "회사 운영, 미제공" |

10-21 저녁 컷 규칙([[12-ROADMAP|12 로드맵]]) 입력은 두 값이다: ① = A2·A3·B2 통과 여부(API 정상), ③ = G2·G3 통과 여부(GPU 정상, [[16-DECISIONS|ADR-025]]). 둘을 `external-deps.md` 상태표에 적고 네 갈래 중 하나를 [[19-DEMO-SCENARIO|19 데모 시나리오]] `run-modes.md`에 기록한다.

## 관련 문서

- [[07-DATA-PIPELINE|07 수집]] §1.1·§2.2~§2.4·§3.1
- [[15-DATA-CONTRACTS|15 데이터 계약]] §8
- [[10-DEPLOYMENT|10 배포]] — 회사 GPU 추론 엔드포인트 구성
- [[03-AI-PIPELINE|03 AI 파이프라인]] §5.1~§5.3·§5.9·§11
- [[09-SECURITY|09 보안]] — SSRF·비밀 관리·공공 API 개인정보
- [[11-TESTING|11 테스트]] §3.3
- [[12-ROADMAP|12 로드맵]] — C1, 10-21 컷 규칙
- [[16-DECISIONS|16 ADR]] — ADR-022·023·025, 미결정 1·3·16·17·19
