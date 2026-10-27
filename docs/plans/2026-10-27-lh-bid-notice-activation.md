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
> 로컬 구현·합성 응답 시험은 끝났다([증거](../evidence/ingestion/20261027-lh-bid-notice/summary.md)). 이 문서는 실행 기록이 아니다. `[승인]` 단계는 **사용자 승인 뒤에만** 한다. 나라장터 3시간 정기 수집(`g2b-scheduled`)이 계속 도는 것이 가장 먼저다. 어느 단계든 나라장터 회차가 `FAILED` 가 되면 멈추고 §5 로 되돌린다.

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

2026-10-27 사용자 확인: 활용신청 승인(활용기간 2026-10-21 ~ 2028-10-21), 엔드포인트 `https://apis.data.go.kr/B552555/OpenBidInfoList` 상세기능 `/getOpenBidInfo`, XML, 일일 1,000회, 회사 서버 `LH_BID_NOTICE_SERVICE_KEY` SET. 회사 서버 저장소는 `43e4e024` 라 녹음 스크립트가 없다. 저장소·브랜치를 바꾸지 않고 **임시 폴더에 세 파일만** 두고 Docker Compose 일회용 컨테이너(`run --rm --no-deps`)로 1회만 부른다. 실호출은 사용자가 회사 서버에서 직접 한다.

`scripts/recorded/record-lh-bid-notice.mjs` 가 지키는 것:

- 부르기 전에 저장 폴더에 시도 표식(`getOpenBidInfo.attempt.json`)을 원자적으로 만든다(`open(…, "wx")` = O_CREAT|O_EXCL, 내용 기록 뒤 fsync). 만들기·쓰기·fsync 중 무엇이든 실패하면 부르지 않고 멈춘다. 표식이 있으면 날짜·쪽이 달라도 부르지 않는다. 실패·재실행·컨테이너 재시작에도 추가 호출이 없다. 다시 부르려면 승인 뒤 사람이 표식을 지운다.
- `--dry-run` 은 부르지 않고 키가 있는지와 저장 폴더에 새 파일을 만들 수 있는지(임시 파일을 만들고 지움)만 본다. 표식은 만들지 않는다.
- 한 번 실행에 정확히 1회. 재시도·리다이렉트 따라가기 없음. 10초·2 MiB 상한.
- 키·요청 URL 은 출력하지 않는다. 오류는 이름·코드만 낸다. 표식에는 시각과 요청 변수(키 없음)만 쓴다.
- 응답에 키가 되돌아오면 어떤 형태든 `***` 로 지우고 `maskedFields` 에 `(secret)` 을 남긴다. 명세 값 칸이 아닌 글자(담당자 태그·명세 밖 태그·CDATA·속성·주석)는 `***`, 이메일·전화는 같은 길이 `*`. 저장 전·뒤 흔적 검사가 0이 아니면 저장하지 않는다.
- 출력: 결과 코드·`totalCount`·건수, 필수 칸(`bidNum`·`bidDegree`·`bidnmKor`) 채움 수, 매핑 확인 칸(`tndrbidRegDt`·`tndrdocAcptEndDtm`·`presmtPrc`), 정규화 가능 행 수, 명세 밖 태그 이름, 응답에 없던 명세 태그, 값 모양, 상태류 값 목록, 판정.
- Redis `quota:15159012` 를 쓰지 않는다. 포털 하루 한도(1,000)에서 1회만 빠진다. 나라장터(15129394) 한도와 따로다.

시간: 나라장터 회차(KST 00·03·…·21시 정각) 앞뒤 10분을 피한다. 명령은 bash·zsh 모두 되게 변수 대신 함수를 쓴다(zsh 는 따옴표 없는 변수를 낱말로 나누지 않는다).

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
chmod 644 /tmp/sol-lh-rec/src/*.mjs && ls -A /tmp/sol-lh-rec/src
cat > /tmp/sol-lh-rec/SHA256SUMS <<'SUMS'
6fa89295912236537d243b4bc38acc584a0f378a9b7bb2df1e83bc1e0c49a6f7  record-lh-bid-notice.mjs
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

## 4. 운영 활성화 — 단계마다 [승인]

| 단계 | 할 일 | 확인 |
|---|---|---|
| 4-1 | 녹음으로 정규화 맞추기(로컬): 날짜 자릿수·금액 단위·`statusOf` 표를 실값으로 고치고, 녹음 재생 시험을 더한다. registry `approvalStatus: APPROVED`, `keyIssuance: ISSUED`, `verification: VERIFIED`, `sampleResponses: [녹음 경로]`, `lastVerifiedAt` 을 바꾼다. **`enabled` 는 이 단계에서 `true` 로 바꾸되 4-5 전에는 회사에 반영되지 않는다** | 전체 `pnpm verify` |
| 4-2 | main 병합·GitHub push [승인] = Vercel 배포 | 화면은 Worker 상태를 따르므로 LH 단추는 4-5 전까지 비활성 |
| 4-3 | 회사 서버 Git 갱신 [승인] | 운영 Worker 는 기동 때만 registry 를 읽으므로 아직 바뀌지 않는다 |
| 4-4 | 새 ingest Worker 이미지 빌드 [승인] → `--check` | `외부 소스 lh-bid-notice: READY · 정기 수집`, 나머지 5종 `NOT_CALLABLE(DISABLED)` |
| 4-5 | 운영 Worker 만 재생성 [승인]. 시간 창은 [[2026-10-27-ingest-source-isolation-deploy|배포 실행서]] 단계 9 와 같다 | `--status` 에 Job Scheduler 2개(`g2b-scheduled`, `lh-bid-notice-scheduled`), healthy |
| 4-6 | 다음 정각 지켜보기 | 나라장터 회차가 먼저 `SUCCEEDED`, 그 뒤 LH 회차(우선순위 10). Redis `quota:15129394` 가 평소처럼 늘고 `quota:15159012` 는 LH 쪽 수만큼만 는다. 관리자 서비스 표에서 LH 상태·인증 `VERIFIED`·마지막 성공 시각 |
| 4-7 | 하루(8회차) 지켜보기 | LH 하루 호출 수, 격리 행 수, 나라장터 `quota_used` 변화 없음 |

이미지(4-4)와 registry(4-3)는 같은 커밋이어야 한다. 옛 이미지(`43e4e024`·`8cfaac31`)는 LH 정규화가 없어 `enabled: true` registry 로 기동하면 LH 행을 모두 `PROVIDER_STATUS_NOT_VERIFIED` 로 격리하면서 호출만 쓴다.

## 5. 되돌리기

1. registry 의 LH `enabled` 를 `false` 로 되돌린다(회사 저장소에서 해당 커밋 revert 또는 그 줄만 수정).
2. 운영 Worker 를 같은 이미지로 재생성한다. 기동 때 준비 안 된 서비스의 일정은 지운다(`lh-bid-notice-scheduled` 제거).
3. `--status` 로 Job Scheduler 가 `g2b-scheduled` 1개인지 본다.

- **이미지만 되돌리지 않는다.** registry 가 `enabled: true` 인 채로 옛 이미지로 기동하면 위의 격리·호출 낭비가 생긴다. registry 를 먼저 되돌린다.
- `--unschedule` 은 쓰지 않는다(나라장터 일정까지 지운다).
- 이미 저장된 LH 공고(`bid_notices.source = 'lh-bid-notice'`)는 지우지 않는다. 지우려면 별도 승인.
- LH 인증 실패는 자동으로 LH 만 `AUTH_FAILED` 로 막으므로 나라장터를 위해 급히 되돌릴 필요는 없다.

## 관련 문서

- [LH 로컬 구현 증거](../evidence/ingestion/20261027-lh-bid-notice/summary.md)
- [운영 적용 결과·사용량](../evidence/ingestion/20261027-ops-apply/summary.md)
- [[2026-10-27-ingest-source-isolation-deploy|10-27 배포 실행서]]
- [[../PROGRESS|진행 상황]]
