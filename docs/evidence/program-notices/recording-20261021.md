---
title: "부처 지원사업 공고 — 중기부 사업공고 RSS 녹음 1회 (2026-10-21)"
status: done
tags:
  - sol-radar
  - evidence
  - program-notices
updated: 2026-10-21
---

# 중기부 사업공고 RSS 녹음 증거 (2026-10-21)

- 근거: [[16-DECISIONS|16]] ADR-040, 스펙 `polaris/specs/in-progress/2026-10-21-agency-program-notices.md` §7, 계획 `docs/plans/2026-10-21-program-notices-plan.md` Task 7(중기부 실호출 1회 승인).
- 브랜치 `feat/program-notices`(worktree `sol-radar-worktrees/program-notices`), 기점 main `09d4422` 병합 커밋 `efdd0cf`. 녹음 커밋 해시는 보고에 적는다.
- 명령(저장소 루트): `node scripts/recorded/record-program-notices.mjs --source mss --dry-run` → `node scripts/recorded/record-program-notices.mjs --source mss`. Node v24.16.0 내장 `fetch`, 패키지 설치 없음.
- 실행: 2026-10-21 13:09:33 KST(`fetchedAt` 2026-10-21T04:09:33.431Z). **호출 1회**(dry-run 은 부르지 않는다).
- 비밀값: 중기부 RSS 는 키가 없다. 기업마당(`BIZINFO_API_KEY`)은 부르지 않았다. 기업마당 녹음은 사용자가 자기 터미널에서 한 번 돌린다(`scripts/recorded/README.md` "부처 공고 녹음").
- 판정: HTTP 200, 리다이렉트 없음, 항목 20건, 저장 전·뒤 흔적 검사 0건, 도메인 해석기로 20건 모두 읽힘(버림 0). 가상 샘플과 다른 실제 모양 2가지는 §3(시험을 실제 모양에 맞췄다).

## 1. 녹음 파일

| 항목 | 값 |
|---|---|
| 파일 | `fixtures/recorded/program-notices/mss/rss-310.20261021.masked.json` |
| 형식 | `sol-program-recorded/v0.1`(`web/server/program-notices/recording.ts`) |
| 요청 | `https://mss.go.kr/rss/smba/board/310.do`, `params` `{}`, `redirect: "manual"`, 2 MiB·10초 상한 |
| 응답 | HTTP 200, `content-type` `text/xml;charset=UTF-8`, 본문 6,477 B(파일 7,479 B) |
| 항목 수 | `<item>` 20개, 등록일 `20260921093657` ~ `20261020182041`(KST) |
| 가림 | `maskedFields` `[]` — 본문에 전화·이메일·대표번호가 없어 바뀐 글자가 없다. `rawSha256` 이 저장 본문의 SHA-256 과 같다 |

CLI 출력(요약만 출력하는 설계, 키·요청 URL·본문 없음):

```json
{
  "file": "fixtures/recorded/program-notices/mss/rss-310.20261021.masked.json",
  "httpStatus": 200,
  "bytes": 6477,
  "items": 20,
  "maskedFields": [],
  "leaks": { "email": 0, "phone": 0, "representative": 0, "crtfcKey": 0, "secret": 0 }
}
```

## 2. 흔적 검사

| 검사 | 저장 전(CLI) | 저장 뒤(CLI) | 저장 뒤(파이썬으로 따로) |
|---|---:|---:|---:|
| 이메일 | 0 | 0 | 0 |
| 전화(`\d{2,4}-\d{3,4}-\d{4}`) | 0 | 0 | 0 |
| 대표번호(15xx·16xx·18xx) | 0 | 0 | 0 |
| `crtfcKey`(대소문자 무관) | 0 | 0 | 0 |
| 키 네 형태 | 해당 없음(키 없음) | 해당 없음 | — |

본문의 링크 호스트는 `www.mss.go.kr` 하나다.

## 3. 가상 샘플과 다른 실제 모양

| # | 실제 | 가상 샘플(`web/server/program-notices/test-data/mss-sample.xml`) | 조치 |
|---|---|---|---|
| 1 | `<link>`·`<pubDate>`·`<id>` 도 `<![CDATA[...]]>` 로 감싼다. CDATA 안의 `&` 는 풀어 쓰지 않는다 | 제목만 CDATA, 링크는 `&amp;` | 해석기(`mss-rss.ts` 의 `unwrap`)가 이미 처리한다. 고칠 코드 없음 |
| 2 | 항목 링크 호스트가 `www.mss.go.kr` 다(요청 호스트는 `mss.go.kr`) | `mss.go.kr` | 해석기 링크 허용(`MSS_SITE.hosts`)에 이미 둘 다 있다. 가상 샘플만으로는 `www` 를 빼도 시험이 통과했다 → 실제 녹음 재생 시험을 더했다 |

- 요청 호스트·리다이렉트는 명세와 같다(`mss.go.kr` https, 3xx 없음). 계획의 "다르면 멈추고 보고" 조건에 걸리지 않았다.
- 더한 시험: `web/server/program-notices/mss-rss.test.ts` "저장소의 중기부 녹음 재생" — 가장 최근 녹음을 `loadProgramRecordings` 로 읽어 버림 0·항목 수 일치·id 고유·링크 `https://www.mss.go.kr/`·등록일 있음을 단언한다. 변형 확인: `MSS_SITE.hosts` 에서 `www.mss.go.kr` 를 빼면 이 시험만 실패했다(1 failed | 6 passed).
- 함께 고친 시험: `web/server/ingestion/recorded-api.test.ts` "fixtures/recorded 에는 녹음 파일 14개가 있다" 는 `fixtures/recorded` 를 재귀로 센다. 부처 공고 녹음은 형식이 달라(`sol-program-recorded/v0.1`) `train/` 처럼 세지 않게 했다. 고치기 전 실패 1건, 고친 뒤 118개 통과.

## 4. 녹음 스크립트 시험

- `node --test scripts/recorded/program-notices-lib.test.mjs scripts/recorded/record-program-notices.test.mjs` → 16개 통과.
- 변형 확인(각각 되돌림): 문의처(`refrncNm`) 가림 제거 → 2건 실패, `redirect: "follow"` → 1건, 요청 예외 메시지에 원문 포함 → 1건, 키 없을 때 멈춤 제거 → 1건, 키 2회 인코딩 형태 제거 → 1건.

## 관련 문서

- [[16-DECISIONS|16 결정 기록]] — ADR-040
- `scripts/recorded/README.md` — "부처 공고 녹음"
- [[recording-20261020|X6a 나라장터 녹음 증거]] — 같은 가림·흔적 검사 관례
