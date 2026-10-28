---
title: "자격 갭 레이더 운영 DB 읽기 확인 2회차 (2026-10-28)"
doc: "evidence-gaps-prod-readonly-check"
status: final
tags:
  - sol-radar
  - ops
  - scoring
updated: 2026-10-28
---

# 자격 갭 레이더 운영 DB 읽기 확인 2회차 (2026-10-28)

[[16-DECISIONS|ADR-060]] "남은 확인"과 [스펙](../../../../polaris/specs/in-progress/2026-10-28-gaps-market-calendar.md) §10의 값을 운영 DB에서 읽기로 센 기록이다. 1회차(전체 실공고 업종 분포)는 스펙 §3이다.

- 시각: 2026-10-28 11:3x KST. 사용자 승인 "지금 확인".
- 도구: Supabase MCP `execute_sql`, 읽기 SELECT 1문. 쓰기 0. 첫 시도는 `bid_notices.org_id` 열이 없어 오류로 끝났다(쓰기 없음). `org_id`를 뺀 두 번째 문이 아래 결과다.
- 대상 조건은 `/gaps` 서버(`web/server/gaps/gaps.repo.ts`)와 같다: `is_demo=false`, `source<>fixture`, `stage=NOTICE`, status `OPEN`·`AMENDED`, `deadline_at>now()`, 대표 공고(`bid_opportunities.canonical_notice_id`, `superseded_by is null`). revision은 `bid_notices.latest_revision`, 관련성은 그 revision의 최신 평가(`created_at desc`)다.

> [!warning] 화면 값의 근사치다
> 이 질의는 회사 프로필을 대조하지 않는다. "구조화 요건 0행"·"면허제한 1행"은 화면 묶음(참가 가능·회사 기록 없음)의 근사치이고 화면 값과 다를 수 있다. 발표 대본·캡션에는 이 숫자를 쓰지 않고 촬영 화면 값을 쓴다.

## 결과

| 항목 | 값 |
|---|---|
| 대상(마감 전 대표 live 입찰공고) | 987 |
| 관련성 RELEVANT·CANDIDATE | 179 |
| auxLookup OK / SKIPPED_QUOTA / FAILED / 없음 | 468 / 518 / 1 / 0 |
| 관련 + aux OK | 125 |
| 관련 + aux OK + 구조화 요건 0행 | 11건, 예산 합 25.7억 |
| 관련 + aux OK + 면허제한 1행 | 60 |
| 관련 + aux OK + 면허제한 2행 이상 | 53 |
| 관련 + aux OK + 참가가능지역 있음 | 9 |

관련 + aux OK + 면허제한 1행, API 업종 코드별:

| 코드 | 건수 | 지역·허용업종 없음 | 예산 합(억) |
|---|---|---|---|
| 1468 소프트웨어사업자 | 52 | 52 | 389.9 |
| 1470 | 3 | 2 | 11.6 |
| 0036 정보통신공사업 | 1 | 1 | 4.3 |
| 1169 학술·연구용역 | 1 | 1 | 1.1 |
| 1542 | 1 | 1 | 0.6 |
| 9901 | 1 | 0 | 1.0 |
| 9999 기타자유업종 | 1 | 1 | 1.7 |

## 읽는 법 (메인 세션 해석, 화면 확인 전 추정)

- 관련 179건 중 54건(aux가 OK가 아님, 대부분 `SKIPPED_QUOTA`)은 "사람 확인 필요"로 간다.
- "참가 가능(API 기준)"은 요건 없는 11건 + 정보통신공사업 1행 1건(revision 5에 HELD) 근처로 본다. 약 12건·약 30억.
- 소프트웨어사업자(1468) 1행 52건·389.9억이 막는 자격 1위로 보인다. 이 자격의 보유를 가정하면 약 12 → 64건으로 열린다(추정). 대본 숫자는 촬영 화면 값으로 쓴다.
- 전체 aux의 52%(518/987)가 한도 때문에 건너뛴 상태(`SKIPPED_QUOTA`)다. 이 비율이 줄면 "참가 가능"과 "회사 기록 없음"이 늘어난다.

## 아직 모르는 것

- "기타자유업종/9999"의 뜻(누구나 참가 가능인지). 이 확인으로 풀리지 않았다. 사전 밖·사람 확인 필요로 센다.
- 운영 `/gaps` 화면 실숫자(배포 뒤 로그인 확인).

## 관련 문서

- [[16-DECISIONS|16 ADR]] — ADR-060 남은 확인
- [[06-UI-UX|06 UI]] — §5.13 `/gaps`
- [[19-DEMO-SCENARIO|19 데모 시나리오]] — S-GAPS, §3.1 9번
