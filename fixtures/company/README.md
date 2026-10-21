# fixtures/company — 가상 솔리데오 회사 프로필 (revision 2)

`solideo-profile.json`은 `docs/08-SCORING.md` §6.1(단일 원천)의 값을 그대로 옮긴 가상 데모 프로필이다.
모든 실행 모드에서 회사 프로필은 이 가상 프로필 하나다(ADR-019·020). `isDemo=true`.
실제 회사 현황을 뜻하지 않으며, 원본 엑셀의 실명·실적을 재사용하지 않는다.

| 항목 | 값 | 출처 |
|---|---|---|
| 기술 8개 | Java, Spring Boot, 전자정부 표준프레임워크, NestJS, Next.js, PostgreSQL, Kubernetes, RAG/LLM 적용 | 08 §6.1 |
| 보유 자격(HELD) 5 | SW_BUSINESS_REG, DIRECT_PRODUCTION, SME_CONFIRMATION(중기업), ISO_27001, CMMI_L3 | 08 §6.1 |
| 미보유 자격(NOT_HELD) 4 | ICT_CONSTRUCTION, DEFENSE_CONTRACTOR, ISMS_P, CSAP — "없다"를 명시적으로 기록해야 `FX-03`이 `NOT_SATISFIED`가 된다 | 08 §5.1·§6.1 |
| 실적 P1·P2·P3 | 12억(2024-11-30)·28억(2024-03-31)·3억(2025-09-30), 증빙 있음 | 08 §6.1 |
| 재무 | 2025년, 매출 180억, 직원 200, 단일 사업 수행 상한 50억 | 08 §6.1 |
| 선호 | agencies [], agencyTypes [지자체, 교육청], domains [데이터 플랫폼, AX, 민원, 교육], excludedDomains [국방], excludedKeywords [무기체계] | 08 §6.1 |

## 08 §6.1 todo 에 대한 답 (C4 규칙 엔진 구현 시 결정, 2026-10-19)

- `technologiesComplete`: **true**. 가상 프로필이라 목록이 "회사가 쓰는 기술 전체"라고 둔다.
  그래서 요구기술이 목록에 없으면 기술 항목 판정(`requirement_assessments`)이 `NOT_SATISFIED`가 된다.
  점수·권고(94/72/68, BID/WATCH/NO-BID)에는 영향이 없다(08 §6.1 todo 와 같음).
- `industryCodes`: **빈 배열**. 나라장터 업종 마스터 코드를 아직 받지 않았다(ADR-020 P0-0). 비어 있으면 허용 업종 조건은
  `NEEDS_REVIEW`(`COMPANY_EVIDENCE_MISSING`)로 사람이 본다. 코드를 받으면 `{code, name, status}` 행을 채운다.
- 점수 계산 대상 인력(200명·고정 기간95.5 FTE)은 이 파일이 아니라 `fixtures/people/solideo.people.json`에서 `toScoringTeam`으로 만든다(08 §9).
