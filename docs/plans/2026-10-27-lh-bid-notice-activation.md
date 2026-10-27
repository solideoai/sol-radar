---
title: "10-27 LH 입찰공고(15159012) 첫 실호출·운영 활성화 계획"
doc: "plan-20261027-lh-bid-notice-activation"
status: active
tags:
  - sol-radar
  - ops
  - ingestion
  - lh
updated: 2026-10-27
---

# 10-27 LH 입찰공고(15159012) 첫 실호출·운영 활성화 계획

> [!todo] 한눈에 (기준 2026-10-27, 브랜치 feat/lh-bid-notice)
> 로컬 구현·합성 응답 시험은 끝났다([증거](../evidence/ingestion/20261027-lh-bid-notice/summary.md)). 2026-10-27 15:13 KST 첫 실호출 1회를 했고(HTTP 200·`00`·10건), 그 응답으로 EUC-KR 읽기·`YYYY/MM/DD HH:mm` 일시·금액 단위를 고쳤다([첫 실호출 증거](../evidence/ingestion/20261027-lh-bid-notice/first-call.md)). 다음은 §3 "다시 녹음"이다. 이 문서는 실행 기록이 아니다. `[승인]` 단계는 **사용자 승인 뒤에만** 한다. 나라장터 3시간 정기 수집(`g2b-scheduled`)이 계속 도는 것이 가장 먼저다. 어느 단계든 나라장터 회차가 `FAILED` 가 되면 멈추고 §5 로 되돌린다.

## 0. 하지 않는 것

- 승인 없이 LH API 를 부르지 않는다. `--dry-run` 은 부르지 않는다.
- 실응답을 녹음하고 매핑을 맞추기 전에는 registry 를 `VERIFIED`·`APPROVED`·`enabled: true` 로 바꾸지 않는다.
- 하루 한도(개발계정 1,000)를 올려 적지 않는다. 다른 서비스의 한도를 빌려 쓰지 않는다(카운터가 서비스 ID 별이다).
- 운영 ingest Worker·redis-api 를 녹음 단계에서 재시작하지 않는다. 녹음은 일회용 컨테이너(`run --rm`)로 한다.

## 1. 실호출 전 확인 — 사람이 data.go.kr 에서

| 확인 | 어디서 | 기대 |
|---|---|---|
| 활용신청 상태 | data.go.kr 마이페이지 → 데이터활용 → Open API → 활용신청 현황 → "한국토지주택공사_입찰공고정보" | 승인. 명세상 자동 승인이지만 신청 자체는 해야 한다. 미신청이면 신청 뒤 승인까지 기다린다 |
| 서비스·오퍼레이션 | 같은 화면의 상세 | 15159012, `B552555/OpenBidInfoList`, `getOpenBidInfo` |
| 인증 방식 | 같은 화면 | 일반 인증키(`serviceKey` 쿼리). Encoding·Decoding 어느 쪽이든 된다(코드가 한 번 풀어 다시 인코딩) |
| 하루 한도 | 같은 화면의 트래픽 | 개발계정 1,000. registry `quota.daily: 1000` 과 같다. 다르면 registry 를 그 값으로 고친다(올려 적지 않는다) |
| 활용 기간 | 같은 화면 | 발표(11-04) 뒤까지 |

## 2. 키 확인 — 회사 서버, 값 출력 없음

키는 `infra/.env.worker.local` 에 `LH_BID_NOTICE_SERVICE_KEY=` 로 넣는다(예시: `infra/env/company-worker.env.example`). 넣어도 운영 Worker 는 재시작 전까지 읽지 않고, registry 가 `enabled: false` 라 재시작해도 부르지 않는다.

```bash
cd <회사 sol-radar 저장소>
export INGEST_WORKER_TAG=<지금 기동 중인 태그>   # docker ps 의 Image 콜론 뒤
W() { docker compose -f infra/compose.ingest-only.company.yaml "$@"; }   # 변수 대신 함수(zsh 에서도 된다)
W run --rm --no-deps ingest-worker node -e '
const k = (process.env.LH_BID_NOTICE_SERVICE_KEY ?? "").trim();
const g = (process.env.G2B_BID_NOTICE_SERVICE_KEY ?? "").trim();
const dec = (s) => { try { return decodeURIComponent(s); } catch { return null; } };
console.log(JSON.stringify({
  lh: k ? "SET" : "UNSET",
  form: k ? (/%[0-9A-Fa-f]{2}/.test(k) ? "ENCODED" : "DECODED") : null,
  length: k.length,
  decodable: k ? dec(k) !== null : null,
  sameAsG2b: k !== "" && g !== "" && dec(k) === dec(g),
}));'
```

- 출력은 상태·형태·길이·나라장터 키와 같은지뿐이다. 값은 출력하지 않는다.
- 기대: `lh: "SET"`, `decodable: true`. `sameAsG2b: true` 는 정상일 수 있다(계정당 인증키 하나).
- 일회용 컨테이너라 운영 Worker 는 그대로다. 공공 API 를 부르지 않는다.

## 3. 첫 실호출 1회 — [승인]

2026-10-27 사용자 확인: 활용신청 승인(활용기간 2026-10-21 ~ 2028-10-21), 엔드포인트 `https://apis.data.go.kr/B552555/OpenBidInfoList` 상세기능 `/getOpenBidInfo`, XML, 일일 1,000회, 회사 서버 `LH_BID_NOTICE_SERVICE_KEY` SET. 회사 서버 저장소(`/data/www/ai_workspace/sol-radar-app`, 운영 ingest Worker 의 compose 작업 폴더. `sol-radar-deploy` 는 지난 배포 폴더다)에는 녹음 스크립트가 없다. 저장소·브랜치를 바꾸지 않고 **임시 폴더에 세 파일만** 두고 Docker Compose 일회용 컨테이너(`run --rm --no-deps`)로 1회만 부른다. 실호출은 사용자가 회사 서버에서 직접 하거나, 사용자 승인으로 개발 PC 에서 ssh 로 한다(1회차는 후자).

`scripts/recorded/record-lh-bid-notice.mjs` 가 지키는 것:

- 부르기 전에 저장 폴더에 시도 표식(`getOpenBidInfo.attempt.json`)을 원자적으로 만든다(`open(…, "wx")` = O_CREAT|O_EXCL, 내용 기록 뒤 fsync). 만들기·쓰기·fsync 중 무엇이든 실패하면 부르지 않고 멈춘다. 표식이 있으면 날짜·쪽이 달라도 부르지 않는다. 실패·재실행·컨테이너 재시작에도 추가 호출이 없다. 다시 부르려면 승인 뒤 사람이 표식을 지운다.
- `--dry-run` 은 부르지 않고 키가 있는지와 저장 폴더에 새 파일을 만들 수 있는지(임시 파일을 만들고 지움)만 본다. 표식은 만들지 않는다.
- 한 번 실행에 정확히 1회. 재시도·리다이렉트 따라가기 없음. 10초·2 MiB 상한.
- 응답은 `Content-Type` charset 대로 읽는다(LH 는 EUC-KR). Worker 와 같은 규칙이다. 읽지 못하면 깨진 글자로 저장하지 않고 멈춘다.
- 키·요청 URL 은 출력하지 않는다. 오류는 이름·코드만 낸다. 표식에는 시각과 요청 변수(키 없음)만 쓴다.
- 응답에 키가 되돌아오면 어떤 형태든 `***` 로 지우고 `maskedFields` 에 `(secret)` 을 남긴다. 명세 값 칸이 아닌 글자(담당자 태그·명세 밖 태그·CDATA·속성·주석)는 `***`, 이메일·전화는 같은 길이 `*`. 저장 전·뒤 흔적 검사가 0이 아니면 저장하지 않는다.
- 출력: 결과 코드·`totalCount`·건수, 필수 칸(`bidNum`·`bidDegree`·`bidnmKor`) 채움 수, 매핑 확인 칸(`tndrbidRegDt`·`tndrdocAcptEndDtm`·`presmtPrc`), 정규화 가능 행 수, 명세 밖 태그 이름, 응답에 없던 명세 태그, 값 모양, 상태류 값 목록, 판정.
- Redis `quota:15159012` 를 쓰지 않는다. 포털 하루 한도(1,000)에서 1회만 빠진다. 나라장터(15129394) 한도와 따로다.

시간: 나라장터 회차(KST 00·03·…·21시 정각) 앞뒤 10분을 피한다. 명령은 bash·zsh 모두 되게 변수 대신 함수를 쓴다(zsh 는 따옴표 없는 변수를 낱말로 나누지 않는다). 아래 블록을 `ssh … 'bash -s' < 파일` 로 넘길 때는 docker 명령마다 `</dev/null` 을 붙인다. 안 붙이면 `docker compose run` 이 남은 명령을 stdin 으로 먹는다(1회차에서 2-3 뒤가 이렇게 끊겼다).

### ① 파일 전송 — 개발 PC

```bash
WT=/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/ingest-source-isolation
git -C "$WT" status --short scripts/recorded         # 아무것도 나오지 않아야 한다(커밋된 파일 그대로)
ssh <회사서버> 'mkdir -p /tmp/sol-lh-rec/src /tmp/sol-lh-rec/out && chmod 755 /tmp/sol-lh-rec/src && chmod 700 /tmp/sol-lh-rec/out && ls -A /tmp/sol-lh-rec/src /tmp/sol-lh-rec/out'   # 둘 다 비어 있어야 한다
scp "$WT"/scripts/recorded/{record-lh-bid-notice.mjs,program-notices-lib.mjs,masking.mjs} <회사서버>:/tmp/sol-lh-rec/src/
```

### ② 사전 검증 — 회사 서버, 호출 0회

```bash
cd <회사 sol-radar 저장소>
W() { docker compose -f infra/compose.ingest-only.company.yaml "$@"; }

# 2-1 전송 파일: 세 파일만, 해시 일치
# (1회차 10-27 15:13 의 record-lh-bid-notice.mjs 는 6fa89295…, EUC-KR·CDATA 고치기 전이다)
chmod 644 /tmp/sol-lh-rec/src/*.mjs && ls -A /tmp/sol-lh-rec/src
cat > /tmp/sol-lh-rec/SHA256SUMS <<'SUMS'
c5cead2aa19ea0e683e15e4983ab01e1932677ef9007f7a8ff50a8aa0ce8fdbb  record-lh-bid-notice.mjs
c96b1c889e1048a980c71153d62f145507d12b6564814afd58209945b8a3766f  program-notices-lib.mjs
bb879d7b7a21349a178b7f1ad355f933ae2db47c5931be2dbd44834211a70a02  masking.mjs
SUMS
(cd /tmp/sol-lh-rec/src && sha256sum -c ../SHA256SUMS)    # 세 줄 모두 OK. 하나라도 FAILED 면 멈춘다

# 2-2 운영 Worker 이미지 — 지금 도는 태그를 그대로 쓴다(없으면 compose 가 빌드하므로 멈춘다)
IMG=$(docker ps --filter label=com.docker.compose.project=sol-radar-ingest --filter label=com.docker.compose.service=ingest-worker --filter label=com.docker.compose.oneoff=False --format '{{.Image}}')
echo "$IMG"                                          # 한 줄: sol-radar-ingest-worker:<태그>
export INGEST_WORKER_TAG=${IMG##*:}
docker image inspect "sol-radar-ingest-worker:$INGEST_WORKER_TAG" --format 'image ok'

# 2-3 운영 Worker·Scheduler 기준 상태(읽기만). ④에서 같은지 본다
docker inspect --format '{{.Id}} started={{.State.StartedAt}} restarts={{.RestartCount}} health={{.State.Health.Status}}' \
  $(docker ps -q --filter label=com.docker.compose.project=sol-radar-ingest --filter label=com.docker.compose.service=ingest-worker --filter label=com.docker.compose.oneoff=False) \
  | tee /tmp/sol-lh-rec/worker-before.txt
W run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --status \
  | tee /tmp/sol-lh-rec/status-before.txt             # Redis 읽기만. Job Scheduler 1개(g2b-scheduled)

# 2-4 LH 키 설정(값 출력 없음)
W run --rm --no-deps ingest-worker node -e '
const k = (process.env.LH_BID_NOTICE_SERVICE_KEY ?? "").trim();
let decodable = true; try { decodeURIComponent(k); } catch { decodable = false; }
console.log(JSON.stringify({ lh: k ? "SET" : "UNSET", form: /%[0-9A-Fa-f]{2}/.test(k) ? "ENCODED" : "DECODED", decodable }));'
                                                     # 기대 {"lh":"SET",…,"decodable":true}

# 2-5 녹음 함수와 dry-run(호출 0회)
lh_rec() {
  W run --rm --no-deps -u "$(id -u):$(id -g)" \
    -v /tmp/sol-lh-rec/src:/rec:ro -v /tmp/sol-lh-rec/out:/out \
    ingest-worker node /rec/record-lh-bid-notice.mjs --date 20261026 --page 1 --rows 10 --out /out "$@"
}
lh_rec --dry-run                                     # "calls": 0, "outWritable": true
ls -A /tmp/sol-lh-rec/out                            # 비어 있어야 한다(표식 없음)
```

### ③ LH API 1회 호출 — 회사 서버, [승인]

```bash
lh_rec 2>&1 | tee /tmp/sol-lh-rec/run-output.txt     # 실호출 1회. 다시 실행해도 표식 때문에 부르지 않는다
ls -l /tmp/sol-lh-rec/out                            # getOpenBidInfo.attempt.json (+ getOpenBidInfo.20261026.p1.masked.json)
```

### ④ 결과 보안 검사 — 회사 서버, 호출 0회

```bash
# 4-1 키·원본 URL 흔적: 녹음·표식·실행 출력 전부. 값은 출력하지 않는다
W run --rm --no-deps -u "$(id -u):$(id -g)" -v /tmp/sol-lh-rec:/chk:ro ingest-worker node -e '
const fs = require("fs"), path = require("path");
const k = (process.env.LH_BID_NOTICE_SERVICE_KEY ?? "").trim();
let d = k; try { d = decodeURIComponent(k); } catch {}
const forms = [...new Set([k, d, encodeURIComponent(k), encodeURIComponent(d), encodeURIComponent(encodeURIComponent(d)), encodeURIComponent(d).toLowerCase()])].filter(Boolean);
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
for (const f of files("/chk")) {
  const t = fs.readFileSync(f, "utf8");
  console.log(f, JSON.stringify({ bytes: t.length, keyHits: forms.filter((x) => t.includes(x)).length,
    serviceKeyParam: (t.match(/serviceKey=(?!\*\*\*)/gi) ?? []).length,
    email: (t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).length }));
}'                                                   # 모든 파일 keyHits 0·serviceKeyParam 0·email 0

# 4-2 운영 Worker·Scheduler 그대로
docker inspect --format '{{.Id}} started={{.State.StartedAt}} restarts={{.RestartCount}} health={{.State.Health.Status}}' \
  $(docker ps -q --filter label=com.docker.compose.project=sol-radar-ingest --filter label=com.docker.compose.service=ingest-worker --filter label=com.docker.compose.oneoff=False) \
  | diff /tmp/sol-lh-rec/worker-before.txt - && echo "worker unchanged"   # health 가 starting↔healthy 로만 다르면 같은 컨테이너다
W run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --status \
  | diff /tmp/sol-lh-rec/status-before.txt - && echo "status unchanged"   # 회차가 지나 job 수가 바뀐 것은 정상. Job Scheduler 는 1개 그대로

# 4-3 일회용 컨테이너가 남지 않음
docker ps -a --filter label=com.docker.compose.project=sol-radar-ingest --filter label=com.docker.compose.oneoff=True --format '{{.Names}} {{.Status}}'   # 아무것도 없어야 한다
```

- `compose run --rm` 은 운영 `ingest-worker` 컨테이너를 다시 만들지 않고, 같은 `env_file`(`infra/.env.worker.local`)을 같은 규칙으로 읽는다. `up`·`restart`·`down`·`exec` 는 쓰지 않는다. 일회용 컨테이너에는 재시작 정책이 붙지 않는다(로컬 Docker Compose 2.31 확인). 붙더라도 표식이 추가 호출을 막는다.
- 일회용 컨테이너의 로그는 `--rm` 과 함께 지워진다. 운영 Worker 로그에는 이 실행이 남지 않는다.
- `/tmp` 는 재부팅·정리로 비워질 수 있다. 표식이 사라지면 재호출을 막지 못하므로 결과 보고 전에는 재부팅하지 않는다.
- 2026-10-27 로컬 리허설: 같은 Dockerfile 로 만든 Worker 이미지(Node 22.23.4)에 `--network none`·가짜 키로 실행했다. `--dry-run` 은 `calls 0`·`outWritable true`·표식 없음. 쓰기 금지 폴더에서는 dry-run 이 `저장 폴더에 쓸 수 없다(EACCES)`, 실행이 `시도 표식을 남기지 못해 부르지 않았다: EACCES` 로 멈췄다. 쓸 수 있는 폴더에서는 `요청 실패: TypeError` 뒤 표식(600)이 남았고, 재실행은 "이미 한 번 시도했다(부르지 않았다)" 로 멈췄다. 4-1 검사는 심은 키를 1건으로 잡고 정상 녹음은 0건이었다. 키 값은 어디에도 출력되지 않았다.

판정(출력 `verdict`). 어느 판정이든 추가 호출 없이 멈추고 보고한다(`next`):

| `verdict` | 조건 |
|---|---|
| `SUCCESS` | 결과 코드 `00`, HTTP 200, `totalCount` 숫자, 항목 1~10건, 모든 행의 공고번호·공고명·차수(숫자)가 정규화 조건에 맞다 |
| `EMPTY` | 결과 코드 `03`, 또는 `00` 이면서 `totalCount` 0·항목 0 |
| `FORMAT_ISSUE` | 결과 코드 없음(XML 아님 등), `totalCount` 가 숫자가 아님, 건수 불일치, 필수 칸이 빠진 행이 있음 |
| `FAILED` | `20` 활용신청·접근 거부, `22` 하루 한도, `23` 초당 한도, `30` 미등록 키, `31` 기한 만료, `32` 미등록 IP, 그 밖의 결과 코드, HTTP 오류. 리다이렉트·2 MiB 초과·10초 초과는 저장 없이 멈춘다 |

녹음 뒤(호출 없음):

1. ③ 출력·`ls -l`·④ 결과를 보고하고, `getOpenBidInfo.20261026.p1.masked.json` 을 개발 PC 로 옮긴다. 개발 PC 에서 실제 파서·정규화(`parseExternalPayload`·`normalizeExternalNotice`)에 넣어 행마다 정규화·격리 결과를 비교한다. `fixtures/recorded/15159012/` 에 넣는 것과 커밋은 결과 보고 뒤 승인으로 한다.
2. 회사 서버의 `/tmp/sol-lh-rec` 는 결과 보고가 끝날 때까지 둔다(표식이 재호출을 막는다). 끝나면 `rm -r /tmp/sol-lh-rec`.
3. 2회차(2쪽)·3회차(빈 날짜)는 이번 승인 범위가 아니다. 결과 보고 뒤 따로 승인받고, 승인되면 표식을 지운 뒤 같은 함수로 `--page`·`--date` 만 바꿔 1회씩 한다.

### 다시 녹음 — 1회차 결과 뒤 [승인]

1회차(10-27 15:13, HTTP 200·`00`·10건)는 응답이 EUC-KR 이라 녹음의 한글이 깨졌다([첫 실호출 증거](../evidence/ingestion/20261027-lh-bid-notice/first-call.md)). 고친 스크립트로 **같은 날짜·같은 쪽**(`--date 20261026 --page 1 --rows 10`)을 1회 다시 받아 한글 상태값과 정규화를 확인한다. 같은 공고 10건이 와야 1회차의 숫자·일시와 맞대 볼 수 있다.

1. 고친 스크립트를 커밋한다. 그래야 ①의 `git status --short scripts/recorded` 가 빈다.
2. ① 전송: 서버 `src` 의 세 파일을 덮어쓴다(폴더 만들기는 건너뛴다). ② 2-1 해시는 위 `SUMS`(새 해시)로 본다.
3. 1회차 결과를 지우지 않고 옮긴다. 이것이 표식 삭제다: `mv /tmp/sol-lh-rec/out /tmp/sol-lh-rec/out-1 && mkdir -m 700 /tmp/sol-lh-rec/out`.
4. ② 2-2~2-5(2-3 기준 상태는 다시 기록) → ③ 1회 → ④. 4-1 검사는 `out-1` 도 함께 본다.
5. 기대: 판정 `SUCCESS`, `bidnmKor 10/10`, `enumValues` 가 한글로 읽힌다, `maskedBody` 에 `U+FFFD` 가 없다. 개발 PC 에서 정규화 10/10, 마감(`deadlineAt`)이 10/10 채워진다.

## 4. 운영 활성화 — 단계마다 [승인]

10-27 실응답 녹음(`fixtures/recorded/15159012`, 10/10 정규화)과 코드 사전 검토로 다시 썼다. 이 절은 계획이고, 아래 명령은 아직 실행하지 않았다.

### 4.0 사전 검토 결과 (실행 없음)

| 항목 | 결과 | 근거 |
|---|---|---|
| DB | 마이그레이션 필요 없음. `bid_notices.source` 에 `'lh-bid-notice'`, `ingest_runs.source` 에 `'lh'` 가 이미 허용된다. 운영 DB 적용 여부는 10-24 일괄 적용 기록 기준(이번에 직접 보지 않음) | `supabase/migrations/20261023000100_procurement_opportunities.sql:4-14` |
| EUC-KR | 운영 경로에서 쓰인다: `processIngestJob` → `connectorFor` → `createExternalSourceConnector` → `fetchPage` → `boundedText` → `charsetOf`(`text/xml;charset=EUC-KR` 인식) → `TextDecoder(…, { fatal: true })`. 헤더에 charset 이 없으면 UTF-8 로 읽다 실패한다(깨진 글자는 저장하지 않고 LH 회차만 FAILED) | `web/server/ingestion/external-api-connector.ts` `charsetOf`·`boundedText`, `web/worker/main.ts` `createExternalConnector` |
| 옛 이미지 | `43e4e024`·`8cfaac31` 은 UTF-8 fatal 로 읽어 LH 쪽이 정규화 전에 HTTP_ERROR 로 끝난다(회차 FAILED, 호출만 씀) | `git show 43e4e024:web/server/ingestion/external-api-connector.ts` |
| 정기 수집 조건 | `callableSource`(`enabled ≠ false`·`verification ≠ NOT_VERIFIED`·`approvalStatus = APPROVED`·endpoint·fieldMapping·serviceKeyEnv) + `quota.daily ≥ 1` + 키 env 값이 있고 디코드됨 + `verifiedOperations` 에 `getOpenBidInfo`. 모두 맞으면 `READY · 정기 수집` | `web/server/ingestion/source-registry.ts` `callableSource`, `web/worker/main.ts` |
| 호출 예산 | Redis `quota:15159012:<KST YYYYMMDD>`, 일 1,000, HTTP 시도마다 원자 예약(재시도 포함). 나라장터 `quota:15129394:…` 와 키가 달라 서로 줄이지 않는다. 정기 몫 200 보존은 나라장터만이고 LH 는 정기·수동이 1,000 을 함께 쓴다 | `web/server/ingestion/quota.ts`, `web/worker/quota-store.ts` |
| 일정 | `lh-bid-notice-scheduled` 를 나라장터와 같은 cron(`0 */3 * * *`, Asia/Seoul)·같은 `ingest` 큐에 우선순위 10 으로 건다. Worker concurrency 1 이라 같은 정각에는 나라장터가 먼저 돌고 LH 가 뒤에 돈다. LH 한 회차 최악 약 67초(15초 × 4회 + 대기) | `web/worker/main.ts`, `web/server/ingestion/ingest-schedule.ts` |
| 첫 회차·호출량 | 첫 창은 `[지금 − 24시간, 지금]`, 이후 `[직전 창 끝, 지금]`. 창을 KST 등록일로 바꿔 한 번에 묻고 `numOfRows` 100. 하루 12건 안팎이면 회차당 1회 → 하루 8회(재시도를 다 써도 32회) | `web/worker/ingest-queue.ts` `EXTERNAL_WINDOW_CAP_MS`, `web/server/ingestion/external-request.ts` |
| 중복 | `(source, notice_id)` 고유 키, `noticeId = bidNum`. 낮은 차수는 `STALE`, 같은 내용은 `DUPLICATE`. 같은 jobKey 로 끝난 run 은 다시 부르지 않는다 | `20261019000002_bid_notices.sql:65`, `web/server/ingestion/revision.ts` |
| 장애 격리 | 20·30·31·32·결과 코드 없는 401·403 → LH 만 `AUTH_FAILED`(다음 회차부터 호출 없음, Worker 재시작으로 풀림). 22 → LH 카운터만 소진. 23·XML 형식 오류·디코드 실패 → LH 회차만 FAILED. 나라장터 job 은 `createOfficialApiConnector` 라 이 경로를 타지 않는다 | `web/server/ingestion/external-connector.model.ts`, `web/worker/main.ts` `withAuthCircuit`, `web/worker/ingest-queue.ts` |

### 4.1 registry 에서 바꿀 칸 (B1 에서 한 커밋으로)

| 칸 | 지금 | 활성화 | 막는 것 |
|---|---|---|---|
| `approvalStatus` | `NOT_REQUESTED` | `APPROVED` | 아니면 `NOT_APPROVED` |
| `verification` | `NOT_VERIFIED` | `VERIFIED` | 아니면 `NOT_VERIFIED` |
| `enabled` | `false` | `true` | 아니면 `DISABLED` |
| `keyIssuance` | `UNKNOWN` | `ISSUED` | 표시용 |
| `lastVerifiedAt` | `"2026-10-21"` | `"2026-10-27"` | 날짜 꼴이 틀리면 registry 전체가 로드 실패 |
| `quota` | `{ "daily": 1000, "tps": null }` | 그대로 | `daily` 가 null·0 이면 `QUOTA_UNVERIFIED` |
| `sampleResponses` | 녹음 경로(`b59148f2`) | 그대로 | 코드가 읽지 않음 |

registry 는 strict 스키마라 오타 하나로 **Worker 전체가 기동하지 못한다**(나라장터 포함, `restart: on-failure:3` 뒤 멈춘 채). Vercel 빌드와 redis-api 이미지도 같은 파일을 읽는다. 그래서 재생성 전에 반드시 일회용 컨테이너 `--check` 를 본다.

### 4.2 순서 — 코드와 registry 를 두 단계로 나눈다

코드(이미지)와 registry 를 한 번에 바꾸면 되돌릴 때 둘을 같이 봐야 하고, 회사 Git 갱신과 재생성 사이에 옛 컨테이너가 재시작되면 새 registry 를 옛 이미지(UTF-8)가 읽는다. 먼저 LH 를 끈 채 코드만 반영하고, 그 뒤 registry 한 커밋으로 켠다.

**A단계 — LH 꺼진 채 코드 반영 (`enabled: false` 그대로)**

| 단계 | 할 일 | 확인 / 중단 |
|---|---|---|
| A1 | `feat/lh-bid-notice`(`7e4d55cd`…`b59148f2`) main 병합·push [승인] = Vercel 배포 | 화면 외부 서비스 6종 그대로 |
| A2 | 회사 Git 갱신 [승인]. 경로는 운영 Worker 의 compose 작업 폴더 라벨로 먼저 확인한다(10-27 기준 `/data/www/ai_workspace/sol-radar-app`). [[2026-10-27-ingest-source-isolation-deploy\|배포 실행서]]의 `sol-radar-deploy` 경로를 그대로 쓰지 않는다 | `docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' <ingest-worker>` 와 같은 폴더인지 |
| A3 | 새 ingest Worker 이미지 빌드(태그 `git rev-parse --short=12 HEAD`) → 일회용 `--check` | 외부 6종 모두 `NOT_CALLABLE(DISABLED)`, 나라장터 정상. 아니면 멈춤 |
| A4 | ingest Worker 만 재생성 [승인]. KST 정각 +15분 ~ 다음 정각 −30분, 직전 `--status` 의 waiting·active·prioritized 가 0 | Job Scheduler 1개(`g2b-scheduled`), healthy |
| A5 | 다음 정각 지켜보기 | 나라장터 회차 `SUCCEEDED`, `quota:15129394` 평소대로 |

회사 반영(첨부) 실행서도 ingest Worker·redis-api 를 재생성한다. A4 와 같은 재생성 한 번으로 묶을지, 어느 쪽을 먼저 할지 정한 뒤 진행한다.

**B단계 — registry 한 커밋으로 LH 켜기**

| 단계 | 할 일 | 확인 / 중단 |
|---|---|---|
| B1 | 4.1 표대로 registry 만 바꾼 커밋(로컬) → 전체 `pnpm verify` → main push [승인] | registry 외 변경 없음 |
| B2 | 회사 Git 갱신 [승인] (A2 와 같은 경로) | `git diff --stat` 이 `infra/sources/registry.yaml` 한 파일 |
| B3 | 같은 이미지로 일회용 `--check` | `외부 소스 lh-bid-notice: READY · 정기 수집`, 나머지 5종 `NOT_CALLABLE(DISABLED)`. registry 로드 오류면 멈춤. 배포 실행서 단계 8 의 "외부 READY 면 중단"은 이 한 줄만 예외 |
| B4 | ingest Worker 만 재생성 [승인] (A4 와 같은 시간 창 규칙) | Job Scheduler 2개(`g2b-scheduled`, `lh-bid-notice-scheduled`), healthy |
| B5 | redis-api 재빌드·재생성 [승인] | redis-api 이미지 안 registry 사본(`web/Dockerfile` `COPY infra/sources/`)이 바뀌어야 화면의 LH [증분 수집]이 503 `DISABLED` 가 아니다. 정기 수집과는 무관 |
| B6 | 다음 정각 지켜보기 | 나라장터 `SUCCEEDED` 먼저, 그 뒤 LH `SUCCEEDED`. `quota:15159012` 가 회차당 1 안팎 |
| B7 | 하루(8회차) 지켜보기 | LH 호출 ≈ 8회, 격리 행 수, 나라장터 `quota_used` 변화 없음 |

### 4.3 지켜볼 때 쓰는 읽기 명령

- Redis 카운터: [운영 적용 결과](../evidence/ingestion/20261027-ops-apply/summary.md) §3.1 명령 그대로(숫자 두 개만 출력).
- 운영 DB(읽기):

```sql
select status, count(*) as runs, sum(quota_used) as calls, max(started_at) as last_started
from public.ingest_runs
where source = 'lh' and service_key = 'lh-bid-notice' and started_at > now() - interval '1 day'
group by status;

select count(*) from public.bid_notices where source = 'lh-bid-notice';
```

- LH 한도 오류(22)는 오류 기록의 `source_key` 가 `g2b:quota` 로 남는다(`web/server/ingestion/ingestion.service.ts` `QUOTA_SOURCE_KEY`). 나라장터 한도 문제로 읽지 않는다.

### 4.4 활성화 전 남은 위험

| 정도 | 위험 | 줄이는 방법 |
|---|---|---|
| 높음 | registry 형식 오류 → Worker 전체(나라장터 포함) 기동 실패 | B3 일회용 `--check` 필수, B1 은 registry 만 바꾼 커밋 |
| 높음 | 회사 checkout 경로 혼동(`sol-radar-app` 과 `sol-radar-deploy`) → 다른 registry·env 로 재생성 | A2 에서 compose 작업 폴더 라벨 확인 |
| 높음 | 회사 Git 갱신과 재생성 사이 옛 컨테이너 재시작 | 두 단계 순서(A 뒤 B), 같은 시간 창 안에서 B2~B4 |
| 중간 | `numOfRows` 100 은 실응답으로 확인하지 않았다(녹음은 10) | B6 에서 `fetched_count`·완결성(PARTIAL 반복 여부) 확인 |
| 중간 | 일시적인 20·401·403 도 LH 를 `AUTH_FAILED` 로 고정, 풀려면 Worker 재시작 | 재시작도 시간 창 규칙대로 |
| 중간 | 확인한 상태 값은 일반공고·정정공고·입찰진행중뿐. 취소·마감·유찰은 낱말 추정, 모르는 값은 OPEN + 메모 | B7 에서 메모 수 확인 |
| 중간 | 등록일 창이라 등록일 뒤 상태 변화(취소·마감)는 다시 받지 못한다 | 별도 과제 |
| 중간 | 빈 날짜 응답(03·totalCount 0)을 실제로 본 적 없음 | 주말 회차 결과 확인 |
| 낮음 | 헤더 charset 없음·다른 라벨·잘못된 바이트 → 그 쪽 전체 실패(fail-closed) | 회차 FAILED 수 확인 |
| 낮음 | 회사 Redis ACL 의 `~quota:*` 허용 여부 미확인. 막히면 LH 만 `QUOTA_STORE_UNAVAILABLE` | B6 |
| 낮음 | LH 수동 요청이 나라장터와 같은 전역 gate(하루 20회·10분 공유)를 쓴다 | 수동 백필은 승인 뒤 |
| 낮음 | 같은 정각 우선순위 순서는 실제 Redis 통합 시험이 없다(BullMQ lua 분석 기준) | B6 에서 순서 확인 |

## 5. 되돌리기

1. B1 커밋을 revert 하는 커밋으로 registry 의 LH 를 `enabled: false` 로 되돌린다. 회사 저장소에서 그 줄만 손으로 고치면 checkout 이 dirty 가 되어 다음 배포의 `git status` 조건에 걸린다.
2. 회사 Git 을 갱신하고 운영 Worker 를 같은 이미지로 재생성한다. 기동 때 준비 안 된 서비스의 일정은 지운다(`lh-bid-notice-scheduled` 제거).
3. `--status` 로 Job Scheduler 가 `g2b-scheduled` 1개인지 본다.
4. A단계(코드)까지 되돌릴 때만 이미지를 `sol-radar-ingest-worker:43e4e02465c2` 로 되돌린다. registry 가 먼저 `enabled: false` 여야 한다.

- **이미지만 되돌리지 않는다.** registry 가 `enabled: true` 인 채로 옛 이미지로 기동하면 LH 응답을 UTF-8 로 읽다 실패해 회차마다 호출만 쓴다. registry 를 먼저 되돌린다.
- `--unschedule` 은 쓰지 않는다(나라장터 일정까지 지운다).
- 이미 저장된 LH 공고(`bid_notices.source = 'lh-bid-notice'`)는 지우지 않는다. 지우려면 별도 승인.
- LH 인증 실패는 자동으로 LH 만 `AUTH_FAILED` 로 막으므로 나라장터를 위해 급히 되돌릴 필요는 없다.

## 관련 문서

- [LH 로컬 구현 증거](../evidence/ingestion/20261027-lh-bid-notice/summary.md)
- [운영 적용 결과·사용량](../evidence/ingestion/20261027-ops-apply/summary.md)
- [[2026-10-27-ingest-source-isolation-deploy|10-27 배포 실행서]]
- [[../PROGRESS|진행 상황]]
