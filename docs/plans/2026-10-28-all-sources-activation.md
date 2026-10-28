---
title: "10-28 공공데이터 서비스 10종 전부 수집 계획"
doc: "plan-20261028-all-sources-activation"
status: active
tags:
  - sol-radar
  - ops
  - ingestion
updated: 2026-10-28
---

# 10-28 공공데이터 서비스 10종 전부 수집 계획

> [!todo] 한눈에 (기준 2026-10-28, 사용자 승인 "1 진행")
> 회사 ingest Worker 의 서비스키 10개를 모두 쓰도록 서비스마다 녹음 → 정규화 → registry → 회사 반영을 밟는다. 제출 2026-11-03 전에 1·2순위(공고 4종·사전 단계 4종)를 끝내고, 3순위(조달요청·업종 마스터)는 시간이 남으면 한다. 나라장터 3시간 정기 수집(`g2b-scheduled`)이 가장 먼저다. 실호출 묶음·push·회사 ff·재생성·`db:push`·redis-api 재빌드는 단계마다 **사용자 승인 뒤에만** 한다.

## 1. 출발 상태 (2026-10-28 10:35 KST 실측, 값 출력 없음)

- 회사 `/data/www/ai_workspace/sol-radar-app/infra/.env.worker.local`(10:33 수정)을 일회용 컨테이너로 읽으면 키 10개 중 9개가 SET 이다. `KWATER_PROCUREMENT_PLAN_SERVICE_KEY` 는 비어 있다(사용자에게 다시 넣기 요청).
- data.go.kr 키 8개는 나라장터 입찰공고 키와 같은 값이다(계정당 키 하나). 수집 가능 여부는 서비스별 활용신청 승인이 정한다.
- KEPCO 키는 40자(`external-request.ts` 규칙과 맞음). `KEPCO_EBID_CONTRACT_API_URL` 은 코드가 읽지 않는다(주소는 코드 고정).
- Vercel 의 서비스키는 쓰이지 않는다. 외부 API 는 회사 Worker 만 부른다(ADR-049). 지우기를 권했다(사용자 결정).
- DB 는 9개 출처(`bid_notices_source_check`)와 PLAN·PROCUREMENT_REQUEST·PRE_SPEC·NOTICE 단계를 이미 받는다(`20261023000100_procurement_opportunities.sql`). 새 마이그레이션은 업종 마스터만 필요하다.
- 돌고 있는 ingest Worker(`1646e7d033a1`, 09:15 생성)는 옛 env 다. 새 키는 다음 재생성 때 들어간다.

## 2. 서비스별 남은 일

| 순위 | 서비스 | 단계 | 지금 | 남은 일 |
|---|---|---|---|---|
| 완료 | 나라장터 입찰공고 15129394 | NOTICE | 수집 중 | — |
| 0 | LH 입찰공고 15159012 | NOTICE | registry 켬 main `c5c88510` | 회사 B2~B4([[2026-10-27-lh-bid-notice-activation\|LH 계획]] §4.2) |
| 1 | KEPCO 전자입찰계약 15148223 | NOTICE | 10-28 녹음 1회(71행, 정규화 71/71) | 금액 매핑 결정, registry(한도 자체 상한 100/일, 사용자 결정), fixture·재생 시험 |
| 1 | K-water 입찰공고 15101635 | NOTICE | 정규화 없음 | `servcList`(용역) 녹음 1회, 정규화 새로, 월 단위 조회(`searchDt=YYYYMM`) 재조회 비용 확인 |
| 2 | 나라장터 사전규격 15129437 | PRE_SPEC | 10-19 녹음, 수집 경로 없음 | 외부 서비스 목록(`source-keys.ts`) 확장, 정규화, 확인 호출 1회 |
| 2 | 나라장터 발주계획 15129462 | PLAN | 위와 같음 | 위와 같음 |
| 2 | LH 사전규격 15159011 | PRE_SPEC | 정규화 없음 | 녹음 1회, 안정 ID 확인(명세에 공고번호 칸 없음), 정규화 |
| 2 | K-water 발주계획 15102588 | PLAN | 키 없음, 정규화 없음 | 키, `servc` 녹음 1회, 정규화(금액 백만원, 명세에 ID 칸 없음) |
| 3 | 나라장터 조달요청 15129468 | PROCUREMENT_REQUEST | 상세 조회만 | 명세의 목록 조회(`getPrcrmntReqInfoListGnrlServc`·`TechServc`, `inqryDiv`+기간) 녹음 1회, 공고 연결 |
| 3 | 업종 및 근거법규 15129467 | 참조 데이터 | 10-19 녹음 | 새 표 마이그레이션(`db:push` 승인), 주 1회 적재, 면허제한 업종 코드 풀이 |

서비스마다 같은 순서: 녹음 1~3회 → 실제 파서·정규화로 비교 → 정규화·시험 → registry → 전체 `pnpm verify` → push → 회사 ff → 일회용 `--check` → ingest Worker 재생성(KST 정각 +15분 ~ 다음 정각 −30분) → 다음 정각 지켜보기.

## 3. 녹음 규칙

- 녹음 스크립트는 `scripts/recorded/` 에 커밋한 파일만 회사로 옮기고 해시를 맞춘다.
- 회사 쪽 임시 폴더는 `/data/www/ai_workspace/sol-<서비스>-rec` 다. **`/data/www/ai_workspace` 밖에 파일을 만들거나 cd 하지 않는다**(사용자 지시 2026-10-28). `/tmp` 를 쓰지 않는다.
- 실행은 운영 ingest Worker 이미지의 일회용 컨테이너(`compose run --rm --no-deps`)로 한다. 운영 컨테이너는 `up`·`restart`·`exec` 하지 않는다.
- 한 번 실행에 1회만 부르고, 시도 표식이 재호출을 막는다. 키·요청 URL 은 출력하지 않는다. 명세 칸(공식 Swagger) 값만 남기고 담당자 칸은 가린다.
- 나라장터 정각 앞뒤 10분은 피한다.

## 4. 일정

| 날짜 | 할 일 | 회사 재생성 |
|---|---|---|
| 10-28 | LH 반영(B2~B4). KEPCO 녹음(끝). data.go.kr 녹음 5회(K-water 입찰·LH 사전규격·K-water 계획·조달요청 목록·나라장터 사전규격 확인) | 1번: LH. KEPCO 가 준비되면 15:15 이후 2번 |
| 10-29 | K-water 입찰 정규화, KEPCO 마무리, 전체 검증, push | 2번(또는 3번): 공고 4종 |
| 10-30 | 사전 단계 4종 정규화, 화면 단계 표시 확인 | 3번 |
| 10-31 | 조달요청 연결, 업종 마스터 표·적재, redis-api 재빌드(화면 수동 수집) | 4번 |
| 11-01~02 | 하루 수집 지켜보기, 1440·1280 화면, 전체 verify, 발표 자료 | — |

늦어지면 3순위를 "연결 준비"까지만 하고 1·2순위를 지킨다.

## 5. 되돌리기

서비스마다 registry 커밋을 revert 하고 회사 ff → 같은 이미지로 재생성한다. registry 를 켠 채 옛 이미지로 기동하지 않는다. `--unschedule` 은 쓰지 않는다(나라장터 일정까지 지운다). 저장된 공고는 지우지 않는다(지우려면 별도 승인).

## 관련 문서

- [[2026-10-27-lh-bid-notice-activation|LH 입찰공고 활성화 계획]]
- [[2026-10-22-external-ingestion-completion-plan|외부 수집 완성 계획(10-22 분석)]]
- [[../PROGRESS|진행 상황]]
