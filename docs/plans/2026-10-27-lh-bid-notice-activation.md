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
W="docker compose -f infra/compose.ingest-only.company.yaml"
$W run --rm --no-deps ingest-worker node -e '
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

## 3. 첫 실호출 1~3회 — [승인]

`scripts/recorded/record-lh-bid-notice.mjs` 를 쓴다. 한 번 실행에 정확히 1회 부르고 재시도하지 않는다. 담당자 칸·이메일·전화를 가려 저장하고, 키의 어떤 형태도 남지 않는지 저장 전·뒤에 검사한다. 출력은 결과 코드·건수·필드 모양·상태 값 목록뿐이다.

시간: KST 정각을 피해 HH:20~HH:40(예: 13:20~13:40). 나라장터 회차와 겹치지 않게 한다.

```bash
mkdir -p /tmp/sol-lh-record && sudo chown 1000:1000 /tmp/sol-lh-record && chmod 700 /tmp/sol-lh-record
D=$(TZ=Asia/Seoul date -d yesterday +%Y%m%d)     # 어제 KST 하루
R="$W run --rm --no-deps -v $PWD/scripts/recorded:/rec:ro -v /tmp/sol-lh-record:/out ingest-worker node /rec/record-lh-bid-notice.mjs"

$R --date "$D" --page 1 --rows 10 --out /out --dry-run   # 0회. 키·저장 경로만 본다
$R --date "$D" --page 1 --rows 10 --out /out             # 1회차
```

- 스크립트는 `scripts/recorded/` 의 세 파일(`record-lh-bid-notice.mjs`·`program-notices-lib.mjs`·`masking.mjs`)과 Node 내장 모듈만 쓴다. npm 패키지·`.env` 파일을 읽지 않는다. 키는 컨테이너 env(`infra/.env.worker.local`)로만 받는다.
- 회사 저장소 파일이 다른 UID(예: 1001)·600 권한이라 컨테이너(UID 1000)가 못 읽으면, 세 파일만 `/tmp/sol-lh-rec-src` 에 644 로 복사해 그 폴더를 `/rec` 로 붙인다.

| 회 | 조건 | 명령 | 보는 것 |
|---|---|---|---|
| 1 | 항상 | 위 `--page 1 --rows 10` | `resultCode`, `totalCount`, `fieldShapes`(날짜 자릿수·금액 모양), `enumValues`(`bidKind`·`bidProgrsStatus`·`zoneHqCd` 등) |
| 2 | 1회가 `00` 이고 `totalCount` > 10 | `--date "$D" --page 2 --rows 10` | 둘째 쪽이 이어지는지, 같은 공고번호가 겹치지 않는지 |
| 3 | 선택. 1회가 `00` | `--date <미래 날짜, 예: 20261231> --page 1 --rows 10` | 빈 창이 `03` 인지 `00`·`totalCount 0` 인지 |

멈춤 조건(그 뒤 호출 없음):

- `20`: 활용신청 미승인·접근 거부. §1 을 다시 본다.
- `30`·`31`: 키 미등록·만료. 키를 다시 확인한다.
- `32`: 미등록 IP. 포털의 IP 설정을 본다.
- `22`·`23`: 한도·TPS. 다음 날 다시 한다.
- 리다이렉트·2 MiB 초과·10초 시간 초과: 스크립트가 저장하지 않고 멈춘다.

녹음 뒤:

1. `/tmp/sol-lh-record/getOpenBidInfo.<날짜>.p<쪽>.masked.json` 을 개발 PC 로 옮겨 `fixtures/recorded/15159012/` 에 둔다.
2. 파일을 열어 담당자 칸이 `***` 인지, 키 흔적이 없는지 사람이 한 번 더 본다.
3. 회사 서버의 `/tmp/sol-lh-record` 를 지운다.

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
