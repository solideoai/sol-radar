---
title: "P0-0 외부 의존성 점검 체크리스트"
status: draft
tags:
  - sol-radar
  - ops
  - hackathon
updated: 2026-10-19
---

# P0-0 외부 의존성 점검

규칙은 [[11-TESTING|11 테스트]] §3.3, 순서는 [[12-ROADMAP|12 로드맵]] C1. 항목마다 날짜·실행한 명령·결과(통과 / 막힘 / 대기)·막힌 이유·보고 시각을 적는다. 막힌 항목은 즉시 사용자에게 보고하고 "막힘"으로 남긴다. 통과한 것처럼 적지 않는다.

**2026-10-19 현재 모든 항목이 "대기"다. 외부 호출·GPU 접속·모델 기동은 아직 하나도 실행하지 않았다.**

보호 규칙: 서비스키 4개 값, GPU 서버 주소·계정, 터널 설정 값, vLLM·Kev API 키는 이 파일·로그·증거·요청 URL에 적지 않는다. 실제 응답을 저장할 때는 담당자 이름·전화·이메일을 마스킹하고 `serviceKey`가 든 URL은 남기지 않는다. 실제 RFP 원문은 저장소에 넣지 않는다.

## 선행 조건 (사용자)

| # | 조건 | 상태 |
|---|---|---|
| P1 | `infra/.env`에 `G2B_BID_NOTICE_SERVICE_KEY`·`G2B_PRE_SPEC_SERVICE_KEY`·`G2B_ORDER_PLAN_SERVICE_KEY`·`G2B_INDUSTRY_MASTER_SERVICE_KEY`(Decoding 키) 입력. 2026-10-19 기준 `infra/.env` 파일 없음 | 대기 |
| P2 | 회사 GPU 서버 SSH 접속 정보, 허용된 자원 사용 범위(VRAM 한도·점유 가능 시간·기존 프로세스 보호 규칙) | 대기 |
| P3 | 모델 기동(vLLM·`kev.serve`)·GPU 메모리 점유 명시 승인 | 대기 |

## ① data.go.kr 공식 API (읽기 전용 GET, 키만 있으면 안전)

| # | 확인할 것 | 방법 | 상태 | 결과 | 날짜 |
|---|---|---|---|---|---|
| A1 | 서비스키 환경변수 4개 존재(값은 출력하지 않음) | `pnpm check:env`(이름·placeholder 여부만 출력) | 대기 | — | — |
| A2 | 입찰공고정보서비스 15129394 `getBidPblancListInfoServc` 호출 성공(`resultCode`, HTTP 상태) | `inqryDiv=1`, 최근 1일, `numOfRows=10`, `type=json`. 응답 3건 저장(마스킹) | 대기 | — | — |
| A3 | 응답 스키마가 [[07-DATA-PIPELINE\|07]] §3.1 매핑표와 일치하는지(`bidNtceNo`·`bidNtceOrd`·`bidNtceNm`·`dminsttNm`·`asignBdgtAmt`·`presmptPrce`·`bidClseDt`·`bidNtceDtlUrl`·`infoBizYn`·`ntceSpecDocUrl1~10`) | 필드 이름 대조표. 다르면 07·15 갱신 항목으로 보고 | 대기 | — | — |
| A4 | 정보화사업(`infoBizYn=Y`) 공고 1건 조회 가능 여부, 요청 파라미터 필터 가능 여부(미결정 1번) | A2 응답에서 선별 | 대기 | — | — |
| A5 | 보조 조회 3종(면허제한·참가가능지역·e발주 첨부) `bidNtceNo`+`bidNtceOrd`로 1건씩, 면허제한 여러 행의 의미(미결정 19번) | 각 1회 | 대기 | — | — |
| A6 | 사전규격 15129437·발주계획 15129462 각 1페이지, `bidNtceNoList`·`orderPlanUntyNo`·`bfSpecRgstNo` 연결 가능 여부 | 각 1회 | 대기 | — | — |
| A7 | 업종 및 근거법규 15129467 전체 1회 수신(사전 저장용) | 1회 | 대기 | — | — |
| A8 | 오류 응답·호출 제한: 잘못된 파라미터 응답 형식, `Retry-After`, 에러코드 22 형식(의도적으로 한도를 소진하지 않는다), 개발계정 1,000건/일 카운트 | 응답 헤더·본문 기록 | 대기 | — | — |
| A9 | 저장한 응답을 `RecordedApiConnector` fixture로 쓸 수 있는지(`fixtures/recorded/<serviceId>/<op>.masked.json`), 출처·수집 시각(`fetchedAt`)·`rawPayload` 해시 추적 | 파일 생성 + 검증기 | 대기 | — | — |

호출 예산: 이 점검 전체에 서비스당 30회 이하. 리허설 전 `quotaUsedToday`를 기록한다.

## ② g2b 첨부 다운로드 (읽기 전용 GET)

| # | 확인할 것 | 방법 | 상태 | 결과 | 날짜 |
|---|---|---|---|---|---|
| B1 | A2에서 고른 공고 3건의 `ntceSpecDocUrl*` 호스트가 `www.g2b.go.kr`인지 | URL 검사 | 대기 | — | — |
| B2 | 다운로드 성공 여부: 로그인·세션 요구, HTTP 상태, 리다이렉트 호스트, `Content-Type`, 크기 | allowlist·30 s·50 MB 규칙으로 1건씩 | 대기 | — | — |
| B3 | 받은 파일의 실제 형식(매직 바이트: PDF·HWP 5.0·HWPX·zip·기타) | 파일 서명 검사 | 대기 | — | — |
| B4 | 막혔을 때: 사유 코드(`AUTH_REQUIRED`·`HTTP_4XX`·`REDIRECT_BLOCKED`·`TOO_LARGE`…)와 보고 시각 | — | 대기 | — | — |

## ③ 회사 GPU 서버 A40×2 (읽기 전용 확인 → 기동은 P3 승인 뒤)

| # | 확인할 것 | 방법 | 상태 | 결과 | 날짜 |
|---|---|---|---|---|---|
| G1 | SSH 연결 가능, 터널(`ssh -N -L 8001:127.0.0.1:8001 -L 8009:127.0.0.1:8009`) 허용 여부 | 접속만 | 대기 | — | — |
| G2 | GPU 상태·여유 VRAM·기존 프로세스 점유(`nvidia-smi`), 읽기만 | 출력 저장(프로세스 소유자 이름은 마스킹) | 대기 | — | — |
| G3 | Python 3.12/3.13·uv·CUDA 드라이버·디스크 여유(가중치 Qwen3.5-9B + Kev-9B) | 버전 확인 | 대기 | — | — |
| G4 | 기존 AI 서비스·gateway 유무와 포트 충돌(8001·8009) | 포트 확인 | 대기 | — | — |
| G5 | (P3 승인 뒤) vLLM `Qwen/Qwen3.5-9B` 기동, `--api-key`, `127.0.0.1:8001`, guided JSON 동작, `/v1/models` | 기동 로그 | 대기 | — | — |
| G6 | (P3 승인 뒤) `kev.serve --run jaredpalmer/kev-9b@v1.0` 기동, `KEV_API_KEY`, `127.0.0.1:8009`, `/v1/models`의 `run`·`base`·`lora`·`temperature`(레지스트리 대조 필드 확인, 미검증 가정) | 기동 로그 | 대기 | — | — |
| G7 | 실측: 모델별 `nvidia-smi` 최대 점유(Kev-9B 21.9 GB vs 약 17 GB), 가중치 다운로드 시간, 터널 포함 요청당 지연(Kev state 500 토큰 10회 p50·p95, Qwen 추출 1회), 실패 시 `PARTIAL` 경로 | [[03-AI-PIPELINE\|03]] §5.9 절차 | 대기 | — | — |
| G8 | A40×2 메모리 배분 결정(모델당 GPU 1장 전제) → [[10-DEPLOYMENT\|10 배포]] GPU 메모리 배분 절 갱신 | — | 대기 | — | — |

## ④ 첨부 파싱 (실제 공고 1건 기준)

| # | 확인할 것 | 방법 | 상태 | 결과 | 날짜 |
|---|---|---|---|---|---|
| D1 | 공고 API → 첨부 URL → 다운로드 → `/parse` → `ParseResult` 흐름 1건 | B2 파일 + gateway `/parse`(C5) | 대기 | — | — |
| D2 | 형식별 후보 비교 시작(PDF pdfplumber, HWPX python-hwpx, HWP kordoc/rhwp): 본문·표·금액·자격 조항·요구사항 번호 재현율 | [[03-AI-PIPELINE\|03]] §10.3 기준표. 결과는 `parser-benchmark.md` | 대기 | — | — |
| D3 | 실제로 검증한 형식만 "지원"으로 표시. 미검증 형식은 `PARTIAL`·`UNSUPPORTED` | — | 대기 | — | — |

## 상태표 (한눈에)

| 영역 | 상태 | 막힘 사유 | 보고 |
|---|---|---|---|
| ① 공공 API 4종 | 대기(선행 P1) | — | — |
| ② 첨부 다운로드 | 대기(① 뒤) | — | — |
| ③ GPU 서버 | 대기(선행 P2, 기동은 P3) | — | — |
| ④ 첨부 파싱 | 대기(②·C5 뒤) | — | — |

10-21 저녁 컷 규칙([[12-ROADMAP|12 로드맵]])은 이 표의 ①·③ 상태로 정한다.

## 관련 문서

- [[11-TESTING|11 테스트]] §3.3
- [[12-ROADMAP|12 로드맵]] — C1, 10-21 컷 규칙
- [[16-DECISIONS|16 ADR]] — 미결정 1·3·16·17·19·20, ADR-022·023
- [[07-DATA-PIPELINE|07 수집]] §2.2·§3.1
- [[10-DEPLOYMENT|10 배포]] — 회사 GPU 서버 구성
