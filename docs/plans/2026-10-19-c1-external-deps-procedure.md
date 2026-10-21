---
title: "C1 P0-0 외부 의존성 검증 절차 (공공 API·첨부·GPU)"
status: review
tags:
  - sol-radar
  - ops
  - hackathon
  - plan
updated: 2026-10-21
---

# C1 P0-0 외부 의존성 검증 절차

> [!note] 현재 적용 범위 (2026-10-21)
> §1~6은 2026-10-19 공공 API·첨부 점검 당시 절차다. 실행 결과는 `docs/evidence/phase-0/external-deps-api-20261019.md`와 `external-deps.md`가 정본이다. 모델 점검은 아래 §7~8을 ADR-034 개정과 [[03-AI-PIPELINE|03]] §5.9에 맞췄다. 서버 준비·Qwen probe 실행은 [[2026-10-21-bosun-b2-runbook|B2 런북]]을 먼저 따른다. 이 수정은 실접속·모델 기동·성능 측정 완료를 뜻하지 않는다.

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

[[16-DECISIONS|ADR-025·034]]: Qwen3.8-Flash-Next는 회사 운영 vLLM API `https://acropolissg.com/vllm/v1`, Bosun v3.1 0.6B는 회사 서버의 `sol_decision.serve`를 `/sol-radar/kev`로 호출한다. `KEV_*`·`/kev`는 호환 이름이다. 모델 기동·GPU 배분은 회사 운영이며 Bosun 기동은 사용자 승인 뒤다. 노트북에서는 HTTPS 접속·레지스트리 대조·지연을 점검한다. 실제 served id·응답·품질은 B2 증거 확보 전 미확인이다. Worker → gateway → 모델 경계와 `AI_PROVIDER=local`은 유지한다.

선행 조건:

- **P2** 회사가 경로·인증 방식을 전달한다. 현재 설정은 `QWEN_BASE_URL=https://acropolissg.com/vllm/v1`, `KEV_BASE_URL=https://acropolissg.com/sol-radar/kev`다. 키는 서버 전용 `infra/.env`에만 둔다(`QWEN_API_KEY`·`KEV_API_KEY`). Qwen의 실제 `GET /v1/models` id는 B2 probe로 확인한다. `/sol-radar/qwen`→8001은 백업이며 사용하지 않는다.
- **P3** 회사 측 모델 기동 완료 통보. 통보 전에는 G1만 할 수 있다(401/403 또는 연결 실패를 그대로 적는다).

호출 수: G3는 state 두 종류에 각각 10회, 총 20회 결정 모델 요청이다. G1·G2·G4·G6 요청은 별도이므로 실호출 전에 합계와 승인 범위를 확인한다. Qwen probe는 B2 런북 §8의 3회 요청과 중복 실행하지 않는다. 키 값·`Authorization` 헤더를 로그·증거·터미널 출력에 남기지 않는다. `curl -v`·`set -x`·`curl -k` 금지.

1. **G1 HTTPS 접속·TLS**: 인증 없이 각 1회.

```bash
QWEN_API_ROOT="${QWEN_BASE_URL%/}"
case "$QWEN_API_ROOT" in
  */v1) ;;
  *) QWEN_API_ROOT="$QWEN_API_ROOT/v1" ;;
esac
curl -sS -o /dev/null -w 'http=%{http_code} ssl_verify=%{ssl_verify_result} time=%{time_total}\n' \
  --max-time 15 "$KEV_BASE_URL/v1/models"
curl -sS -o /dev/null -w 'http=%{http_code} ssl_verify=%{ssl_verify_result} time=%{time_total}\n' \
  --max-time 15 "$QWEN_API_ROOT/models"
```

   기대: 결정 모델 서버는 무인증 401, 회사 Qwen API는 회사 인증 정책대로 결과를 기록한다. `ssl_verify=0`은 인증서 유효다. `http=000`·인증서 오류는 "미접속"으로 기록하고 회사에 알린다. `curl -k`로 우회하지 않는다.

2. **G2 `/v1/models` 레지스트리 대조**(Bearer, Bosun·Qwen 각 1회. Qwen은 B2 probe 결과를 재사용):

```bash
curl -sS --max-time 15 -H "Authorization: Bearer $KEV_API_KEY" "$KEV_BASE_URL/v1/models" > "$SCRATCH/kev-models.json"
curl -sS --max-time 15 -H "Authorization: Bearer $QWEN_API_KEY" "$QWEN_API_ROOT/models" > "$SCRATCH/qwen-models.json"
grep -i -E 'key|token|secret' "$SCRATCH/kev-models.json" "$SCRATCH/qwen-models.json" && echo "비밀 의심 필드 있음: 저장 전 확인" || echo "비밀 의심 필드 없음"
```

   - 두 응답을 `docs/evidence/phase-0/endpoint-models.json`에 `{ "kev": …, "qwen": …, "fetchedAt": "…" }`로 저장한다. 저장 전에 위 `grep`으로 키·토큰 값이 응답에 없는지 본다(있으면 그 필드를 지우고 지웠다고 적는다).
   - Bosun 응답의 `id`·`run`·`base`·`lora`·`decision_embeddings_sha256`·`revision`을 `services/ai/models/registry.yaml`의 `bosun-v3.1-0.6b`와 대조한다([[03-AI-PIPELINE|03]] §11). 불일치를 성공으로 처리하지 않는다.
   - vLLM `data[].id`를 레지스트리의 `Qwen/Qwen3.8-Flash-Next`와 대조한다. 실제 id는 아직 미확인이다. 다르면 B2 런북 §8대로 실제 값을 기록하고 레지스트리·`QWEN_MODEL` 수정 대상으로 보고한다.

3. **G3 지연 실측**([[03-AI-PIPELINE|03 AI 파이프라인]] §5.9 2번):
   - Bosun `POST /v1/systemone`에 §5.6 영어 템플릿 state **약 500토큰·6,000토큰 두 종류**, **24문항 묶음**을 각각 **10회** 보낸다. `latency_ms`와 왕복 시간의 p50·p95를 적는다. fixture로 만들고 실제 공고 원문은 쓰지 않는다.
   - vLLM `POST /v1/chat/completions`에 `/extract` 추출 프롬프트(fixture 본문 1건) **1회** 왕복 시간.
   - `(묶음 수 × 24문항 요청 p95 + GET /v1/models 시간)`을 `KEV_TIMEOUT_MS`(기본 `5000`)와 비교한다. 넘으면 gateway·worker timeout 동시 변경을 제안한다([[03-AI-PIPELINE|03]] §3·§5.9). Qwen은 `AI_TIMEOUT_MS`(기본 `60000`)와 비교한다. 이 점검에서 설정을 자동 변경하지 않는다.

4. **G4 vLLM guided JSON**: B2 런북 §8 probe의 `response_format: json_schema`·`prompt_logprobs` 결과를 재사용한다. `enable_thinking:false`와 추출 검증 계약은 [[03-AI-PIPELINE|03]] §4.3을 따른다. guided JSON 지원, E3용 prompt logprobs 지원, 추출 품질을 각각 기록한다.

기록은 `docs/evidence/phase-0/endpoint-check.md`(G1~G6 결과, 지연 표)와 `endpoint-models.json`에 둔다. `external-deps.md` G1~G6 행에 통과/막힘과 날짜를 적는다.

## 8. 회사 제공 정보와 장애 경로 (G5~G6)

GPU 배분은 회사 운영이며 물리 GPU 1은 PaddleOCR과 공유한다(ADR-034). Bosun 준비·기동·학습은 B2 런북과 [[22-FINETUNE-RUNBOOK|22]]의 승인·중단 조건을 따른다. 노트북 점검을 모델 기동 승인으로 간주하지 않는다.

1. **G5 회사 제공 GPU 정보**: GPU 1의 PaddleOCR·Bosun 점유와 패키지 sha256 등을 회사가 제공하면 날짜와 함께 기록한다. 없으면 "회사 운영, 미제공"으로 남긴다. 추정값을 실측으로 쓰지 않는다.
2. **G6 실패 대상별 상태 확인**: `local` 어댑터는 구현돼 있으며 실접속 검증은 별도다. 격리된 리허설 환경에서 아래를 나누어 확인하고 복구 후 G2 재접속을 확인한다([[03-AI-PIPELINE|03]] §8, `web/server/analysis/fallback.model.ts`).
   - **Bosun만 불가, Qwen 추출 정상·gateway 생존:** `KEV_UNAVAILABLE`, `COMPLETED`·`RULES_ONLY`. 결정 모델만 없다는 이유로 PARTIAL을 기대하지 않는다.
   - **Qwen 추출 불가:** 추출 캐시가 없는 검증용 revision을 사용한다. 재분석 `force=true`만으로 캐시가 우회됐다고 보지 않는다. `QWEN_UNAVAILABLE`, `PARTIAL`·`RULES_ONLY`와 정보 부족 표시를 확인한다.
   - **gateway 연결 불가:** `AI_UNAVAILABLE`, `PARTIAL`·`RULES_ONLY`. 위 모델 단독 장애와 원인을 구분한다.
   - 어느 경우도 mock으로 자동 대체하지 않는다. 캐시된 추출로 완료되는 경우는 별도 기록하고 Qwen 실패 검증 성공으로 세지 않는다.

운영 전제:

- TLS 필수. 인증서 검증을 끄지 않는다(`curl -k`, 클라이언트 `verify=False` 금지).
- API 키 필수. 값은 `infra/.env`에만 둔다(`QWEN_API_KEY`·`KEV_API_KEY`). `web/.env.local`·`NEXT_PUBLIC_`에 넣지 않는다.
- 엔드포인트 URL은 비밀이 아니다. 키 값은 어디에도 적지 않는다.
- env 이름은 그대로다(`QWEN_BASE_URL`·`KEV_BASE_URL`·`QWEN_API_KEY`·`KEV_API_KEY`). 노트북은 HTTPS를 사용하며 SSH 터널·`host.docker.internal`을 쓰지 않는다. 회사 서버 내부의 `sol_decision`은 `127.0.0.1:8009` 바인딩을 유지한다(ADR-034).
- 회사에 확인할 것은 Qwen 실제 모델 id·인증·guided JSON·`prompt_logprobs`, Bosun 승인 후 기동 완료·`GET /v1/models`·인증이다. `kev.serve`·Qwen 8001 신규 기동을 요청하지 않는다.

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
- [[12-ROADMAP|12 로드맵]] — C1, 외부 의존성 컷 규칙(ADR-027 전 이름 "10-21 컷 규칙", 판단 10-20 저녁)
- [[16-DECISIONS|16 ADR]] — ADR-022·023·025, 미결정 1·3·16·17·19
