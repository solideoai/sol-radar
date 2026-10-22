---
title: "Bosun 영어 State 번역"
status: draft
tags: [sol-radar, ai, security]
updated: 2026-10-22
---

# Bosun 영어 State 번역

사용자 요청(2026-10-22)의 10개 목표와 필수 테스트가 정본이다. 검증된 공고 KNOWN 값만 별도 Qwen 번역 호출로 영어화하며 원문 payload/evidence는 바꾸지 않는다. 추출 프롬프트/스키마/재시도 예산은 유지한다. translations는 dict[str, str]이다.

StateBuilder.text에서 수집한 경로를 번역 대상의 정본으로 삼는다. 기업 값은 profileSummary.* 경로를 추가하며 기존 공고 경로와 COMPANY evidence recordKey는 유지한다. 자격 detail도 포함한다. /extract에서는 추출과 번역이 같은 AI_TIMEOUT_MS Deadline을 공유한다. 기업 데이터는 /extract에 없으므로 /kev에서 그 요청의 기존 KEV_TIMEOUT_MS 안에서 번역한다(새 시간 예산 없음). 캐시 공고 누락을 /kev에서 재번역하지 않는다.

번역 검증은 엄격 JSON, 허용 경로, ASCII 영어, 숫자 다중집합, 원문 ASCII 식별자, 조건 표현, 인젝션 가드 및 크기 상한을 적용한다. 의미 동치 전체를 증명하지는 못하므로 사람 최종 결정 원칙을 유지한다. 오류/누락은 값 대신 경로 경고로 표시한다. /extract 번역 실패는 payload를 유지한 PENDING_REVIEW다. 실제 Bosun은 불완전한 영어 State에서 호출하지 않는다. mock은 결정적 기존 fixture 동작을 유지한다.

운영 연결/기동/배포/DB/환경변수 변경 없이 로컬 가짜 서버로 검증한다.

## 관련 문서

- [[03-AI-PIPELINE]]
