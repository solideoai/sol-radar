---
title: "입찰 일정 원본 키 운영 DB 읽기 확인 3회차 (2026-10-28)"
doc: "evidence-calendar-prod-raw-check"
status: final
tags:
  - sol-radar
  - ops
  - evidence
updated: 2026-10-28
---

# 입찰 일정 원본 키 운영 DB 읽기 확인 3회차 (2026-10-28)

사용자 승인("1번으로 진행해")으로 sol-radar-45 가 운영 DB 를 읽었다. `/calendar` 가 관련 업종 공고의 원본 일정(`raw_payload`)을 싣기 전에, 어느 키가 얼마나 채워져 있는지 본 근거다.

- 도구: Supabase MCP `execute_sql`, 읽기 SELECT 1문. 쓰기 0.
- 대상: `is_demo=false`, `source<>fixture`, `stage=NOTICE`, `status` OPEN·AMENDED, `deadline_at>now()`, 대표 공고(`bid_opportunities.canonical_notice_id`, `superseded_by is null`), `revision = bid_notices.latest_revision` 인 revision 의 `raw_payload`.
- 결과: 대상 1,148건, 출처는 모두 `g2b-bid-notice`다. 대표 공고 가운데 LH·K-water·KEPCO 원본은 이 조건에서 0건이다. `raw_payload` 는 모두 객체다.

| 원본 키 | 뜻 | 값 있음 |
|---|---|---|
| bidBeginDt | 입찰서 제출 시작 | 1,148 |
| bidClseDt | 입찰 마감 | 1,148 |
| opengDt | 개찰 | 1,148 |
| bidQlfctRgstDt | 입찰참가자격 등록 마감 | 1,147 |
| cmmnSpldmdAgrmntClseDt | 공동수급협정서 마감 | 379 |
| dcmtgOprtnDt | 현장설명회(장소 dcmtgOprtnPlce) | 13 |

- 형식 예: opengDt `"2026-10-28 14:00:00"`(KST, 오프셋 없음). bidQlfctRgstDt 는 녹음 표본에서 `"2026-11-23 10:00"`(초 없음)이다. 빈 문자열이 섞일 수 있다.

## 화면에 쓴 방식

- 입찰 마감(`bidClseDt`)은 공고 마감(`deadline_at`)과 같은 값이라 읽지 않는다(중복 금지).
- 나머지 다섯 키와 장소 키만 `raw_payload->>키` 경로로 고른다(`web/server/calendar/calendar.repo.ts`).
- 시각은 Asia/Seoul 로 읽는다. 빈 값·형식 오류·날짜만 있는 값은 그 일정만 버리고 공고의 다른 일정은 남긴다(`parseScheduleTime`, `web/server/calendar/calendar.model.ts`).

## 관련 문서

- [[06-UI-UX|06 UI]] — `/calendar`
- [[07-DATA-PIPELINE|07 데이터 파이프라인]] — 나라장터 입찰공고 원본
- [[09-SECURITY|09 보안]] — 운영 읽기 승인
