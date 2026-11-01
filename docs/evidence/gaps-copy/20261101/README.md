---
title: "회사 프로필 배지 툴팁 rev 6 문구 화면 확인 (2026-11-01)"
status: active
tags: [sol-radar, evidence, ui, company-profile]
updated: 2026-11-01
---

# 회사 프로필 배지 툴팁 rev 6 문구 화면 확인 (2026-11-01)

## 바꾼 것

운영 회사 프로필 revision 6은 공개 자료에 회사가 확인한 자격 3건(소프트웨어사업자·직접생산·중소기업, `COMPANY_CONFIRMED`)을 더했다([[16-DECISIONS|ADR-059]] 2차 개정, [기록](../../company-public-profile/20261030/prod-rollout.md)). 그런데 "공개 자료 회사 프로필로 분석" 배지 툴팁은 "공개되지 않은 실적·자격은 들어 있지 않습니다"였다. `/gaps` 메타 줄(`web/app/(app)/(work)/gaps/gaps-sections.tsx`)과 공고 상세 분석 띠(`web/app/(app)/(work)/bids/[id]/bid-detail-view.tsx`) 두 곳의 툴팁을 아래로 바꿨다. 배지 글자는 그대로다.

> 공개 자료(홈페이지·기사·채용공고·나라장터 계약·DART 공시·협회 등록 조회)로 만든 솔리데오 프로필과 대조한 결과입니다. 자격 중 소프트웨어사업자·직접생산·중소기업 3건은 회사가 확인해 더했습니다. 선호 분야는 회사가 정한 선택값입니다. 실적은 공개 자료에 있는 것만 들어 있습니다

## 확인 방법

부품 브라우저 시험(Vitest Browser Mode, chromium)에서 기존 시험의 화면 데이터로 `/gaps` 화면(`GapsView`)과 공고 상세(`BidDetailView`, `profileIsDemo=false`)를 그리고, 배지에 초점을 줘 툴팁을 연 뒤 폭마다 확인했다. 임시 시험 파일은 커밋하지 않았다.

- 폭: 360·390·768·1280·1440px (높이 900)
- 단언: 새 문구가 보인다, 옛 문구 "공개되지 않은 실적·자격"이 없다, 툴팁 왼쪽·오른쪽 끝이 창 안이다, 문서 가로 넘침이 없다(`scrollWidth ≤ clientWidth`)
- 결과: 10건 모두 통과. 툴팁은 `max-w-xs` 안에서 5줄로 꺾인다

## 사진

툴팁 주변만 잘랐다(시험 화면 배율 0.8).

| 폭 | `/gaps` | 공고 상세 |
|---|---|---|
| 360 | ![[gaps-360.png]] | ![[detail-360.png]] |
| 390 | ![[gaps-390.png]] | ![[detail-390.png]] |
| 768 | ![[gaps-768.png]] | ![[detail-768.png]] |
| 1280 | ![[gaps-1280.png]] | ![[detail-1280.png]] |
| 1440 | ![[gaps-1440.png]] | ![[detail-1440.png]] |

운영 화면은 보지 않았다(로그인 필요, 브랜치는 아직 main에 병합 전).

## 관련 문서

- [[06-UI-UX|06 화면]] §8 데모 친화 요소 표 "회사 프로필 배지"
- [[16-DECISIONS|16 ADR]] — ADR-052·059
