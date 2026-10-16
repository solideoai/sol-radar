---
title: "20. 용어집"
doc: "20"
status: draft
tags:
  - sol-radar
  - glossary
updated: 2026-10-16
---

# 20. 용어집

문서 전체에서 같은 뜻으로 쓰는 용어. 코드 식별자는 영어 그대로 쓴다. 정의가 바뀌면 이 문서를 먼저 고치고 다른 문서를 맞춘다.

## 제품·도메인

| 용어 | 정의 | 주 문서 |
|---|---|---|
| SOL RADAR | 공공 SI·AX 기업용 입찰 참여 의사결정 지원 플랫폼. 자동 투찰은 하지 않는다 | [[01-PRD]] |
| 공공 SI | 공공기관 발주 시스템 통합 사업을 수행하는 IT 기업 | [[01-PRD]] |
| AX | AI Transformation. AI를 적용한 업무·서비스 전환 사업 | [[01-PRD]] |
| 조달청 (PPS) | 대한민국 공공조달 주관 기관 | [[07-DATA-PIPELINE]] |
| 나라장터 (KONEPS) | 조달청이 운영하는 국가종합전자조달 시스템. 공고·입찰·계약이 공개된다 | [[07-DATA-PIPELINE]] |
| 공공데이터포털 (data.go.kr) | 공공 API를 신청·사용하는 포털. 조달 공고 API의 출처 | [[07-DATA-PIPELINE]] |
| 발주계획 | 기관이 연간·분기 발주 예정 사업을 미리 공개하는 단계 (`stage=PLAN`) | [[07-DATA-PIPELINE]] |
| 사전규격 | 입찰공고 전 규격서를 공개하고 의견을 받는 단계 (`stage=PRE_SPEC`) | [[07-DATA-PIPELINE]] |
| 입찰공고 | 실제 입찰 참가를 받는 공고 (`stage=NOTICE`) | [[07-DATA-PIPELINE]] |
| 정정공고 / 차수 | 같은 공고의 내용(예산·마감·자격)이 바뀐 재공고. 같은 bid의 새 revision으로 관리 | [[07-DATA-PIPELINE]] |
| 입찰참가자격 (필수 자격) | 공고가 요구하는 업종·면허·실적·인증 등. 하나라도 미충족이면 참여 불가 | [[08-SCORING]] |
| 회사 프로필 | 우리 회사의 기술·자격·실적·인력 정보. revision으로 버전화 | [[04-DATABASE]] |
| 데모 기업 "SOL테크" | 데모용 가상 공공 SI 중견기업. 실제 기업 아님 | [[19-DEMO-SCENARIO]] |

## 판정·점수·결정

| 용어 | 정의 | 주 문서 |
|---|---|---|
| 자격 판정 (`qualification_checks`) | 필수 항목별 `SATISFIED` / `NOT_SATISFIED` / `NEEDS_REVIEW`. 증빙 없으면 `NEEDS_REVIEW`. 법적 자격 자동 확정 안 함 | [[08-SCORING]] |
| SOL Score | 우리 회사와 특정 공고의 내부 적합도 0~100. **낙찰 확률이 아니다.** 결정론적 규칙으로 계산 | [[08-SCORING]] |
| 점수 요소 (`score_factors`) | 기술 스택 적합 30, 유사 실적 25, 인력 가용성 20, 규모 적합성 15, 전략 선호 10 | [[08-SCORING]] |
| `missingFactors` | 데이터가 없어 중립·보수 정책으로 처리한 요소 목록 | [[08-SCORING]] |
| 권고 (recommendation) | 시스템이 내는 `BID` / `WATCH` / `NO_BID`. 결정이 아니다 | [[08-SCORING]] |
| 결정 (decision, `bid_reviews`) | 사람이 사유와 함께 기록하는 최종 참여 판단 | [[08-SCORING]] |
| BID / WATCH / NO-BID | 참여 / 관망·추가 검토 / 불참 | [[08-SCORING]] |
| `MODEL_RULE_DISAGREEMENT` | Kev 보조 의견과 규칙 판정이 상충할 때 발생. 사람 검토 필수 | [[08-SCORING]] |
| `INSUFFICIENT_DATA` | 근거가 없어 값을 표시하지 않는 상태. 임의 값으로 채우지 않는다 | [[00-README]] |
| 분석 상태 | `NOT_ANALYZED → QUEUED → PROCESSING → COMPLETED / PARTIAL / FAILED`. `PARTIAL`은 AI 없이 규칙만으로 완결한 결과 | [[06-UI-UX]] |
| 골든셋 / 골든 시나리오 | 기대 결과가 사람에 의해 확정된 테스트 입력. 회귀 기준 | [[11-TESTING]] |
| precision@K | 추천 상위 K개 중 실제 적합 공고 비율 | [[01-PRD]] |
| 백테스트 / 시점 일치 | 과거 데이터로 검증할 때 의사결정 시점 이후 정보(낙찰 결과 등)를 쓰지 않는 원칙 | [[15-DATA-CONTRACTS]] |

## AI

| 용어 | 정의 | 주 문서 |
|---|---|---|
| Qwen | 오픈 가중치 LLM 계열. 공고문에서 요구조건을 JSON으로 추출하고 한국어 설명을 생성 | [[03-AI-PIPELINE]] |
| Kev | Jared Palmer의 Apache-2.0 소형 결정 모델(Qwen3.5 기반 0.8B/4B/9B, Qwen3.8 기반 27B). 타입이 정해진 질문에 텍스트 생성 없이 캘리브레이션된 확률을 돌려준다. 모델 카드 기준 영어 전용. 저장소 https://github.com/jaredpalmer/kev | [[03-AI-PIPELINE]] |
| System One (TypeSafe) | Kev 서버가 호환하는 API 프로토콜. 엔드포인트 `POST /v1/systemone` | [[03-AI-PIPELINE]] |
| `noul` / `choice` / `score` | Kev 질문 타입: yes/no, 다지선다, 등급 평가 | [[03-AI-PIPELINE]] |
| Kev 분포 | 선택지에 대한 모델 확률 분포. **수주확률이 아니다.** UI에 항상 고지 | [[06-UI-UX]] |
| 규칙 엔진 | 필수 자격·점수·결정 정책을 계산하는 결정론적 코드. 최종 권고의 주체 | [[08-SCORING]] |
| 임베딩 / Qdrant | 근거 문단을 벡터로 저장·검색. 재생성 가능한 파생 인덱스 | [[02-ARCHITECTURE]] |
| `EvidenceRef` | 근거 인용 구조 `{documentId, revisionId, page?, charStart?, charEnd?, quotedText?, sourceUrl?, fetchedAt}`. 원문과 매칭 검증 실패 시 무효 | [[15-DATA-CONTRACTS]] |
| `fieldState` | 필드 상태 `KNOWN / UNKNOWN / NOT_APPLICABLE / CONFLICTED` | [[15-DATA-CONTRACTS]] |
| 프롬프트 인젝션 | 외부 문서 안의 지시문이 모델을 조종하려는 공격. 외부 문서는 데이터로만 취급 | [[09-SECURITY]] |
| HITL (Human-in-the-loop) | 사람이 반드시 개입하는 지점. 최종 결정, `NEEDS_REVIEW`, `MODEL_RULE_DISAGREEMENT` | [[09-SECURITY]] |
| `AI_PROVIDER` | `mock` / `local` / `hosted`. 데모 기본은 `mock` | [[03-AI-PIPELINE]], [[10-DEPLOYMENT]] |
| `KEV_ENABLED` | Kev 실모델 사용 플래그. 한국어 도메인 검증 전 기본 `false` | [[03-AI-PIPELINE]] |

## 데이터·플랫폼

| 용어 | 정의 | 주 문서 |
|---|---|---|
| revision (`bid_revisions`) | 공고 내용의 버전. `sha256(canonical normalized payload)` 변화로 생성 | [[07-DATA-PIPELINE]] |
| 입력 스냅샷 (`input_snapshot`) | 점수 계산 시점의 입력 전체 복사본. 재현용 | [[04-DATABASE]] |
| 알고리즘 버전 (`algorithm_version`) | 점수 규칙 버전 식별자 (예: `sol-v0.1.0`) | [[08-SCORING]] |
| outbox 패턴 | 도메인 변경과 알림 이벤트를 같은 트랜잭션에 기록하고 워커가 전달 | [[13-NOTIFICATIONS]] |
| 멱등키 (idempotency key) | 같은 요청·이벤트를 두 번 처리하지 않게 하는 고유 키 | [[05-API-SPEC]], [[13-NOTIFICATIONS]] |
| 커서 페이지네이션 | `{items, pageInfo:{cursor,nextCursor,hasNext}}` 형식의 목록 응답 | [[05-API-SPEC]] |
| fixture | 외부 API 없이 쓰는 가상 공고 데이터 `FX-01`~`FX-20` | [[07-DATA-PIPELINE]] |
| `DEMO_MODE` / DEMO 데이터 | 외부 호출 없이 fixture로 동작하는 모드. 화면에 가상임을 표시 | [[00-README]] |
| Connector | 수집 소스 어댑터 `fetchPage({from,to,cursor})` | [[07-DATA-PIPELINE]] |
| 격리 (quarantine) | 검증 실패 레코드를 적재하지 않고 따로 보관 | [[07-DATA-PIPELINE]] |
| DLQ | Dead-letter queue. 재시도 소진 작업 보관 | [[02-ARCHITECTURE]] |
| circuit breaker | 연속 실패 시 외부 호출을 잠시 끊는 보호 장치 | [[02-ARCHITECTURE]] |
| BullMQ | Redis 기반 작업 큐. 수집·분석·알림 job | [[02-ARCHITECTURE]] |
| MinIO | S3 호환 사설 객체 저장소. 첨부 원본 | [[02-ARCHITECTURE]] |
| presigned URL | 서버가 권한 검사 후 발급하는 짧은 수명의 파일 접근 URL | [[09-SECURITY]] |
| HWP / HWPX | 한국 공공 문서 형식. 파서 선택은 미결정 | [[16-DECISIONS]] |

## 권한·보안

| 용어 | 정의 | 주 문서 |
|---|---|---|
| ADMIN / SALES / ANALYST / VIEWER | 역할. 리소스별 정책으로 적용되며 단순 상하 관계가 아니다 | [[09-SECURITY]] |
| 테넌트 격리 | 모든 업무 데이터에 `organization_id`를 두고 토큰 컨텍스트로만 조회 | [[04-DATABASE]], [[09-SECURITY]] |
| IDOR | 다른 조직 자원을 ID만 바꿔 조회하는 공격. 조직 검사로 차단 | [[09-SECURITY]] |
| SSRF | 서버가 내부 자원으로 요청하게 유도하는 공격. 첨부 다운로드 allowlist로 차단 | [[09-SECURITY]] |
| 감사 로그 (`audit_logs`) | 누가 무엇을 바꿨는지 before/after와 함께 기록 | [[04-DATABASE]] |

## 문서 운영

| 용어 | 정의 | 주 문서 |
|---|---|---|
| ADR | Architecture Decision Record. 결정·상태·날짜·근거 기록 | [[16-DECISIONS]] |
| MOC | Map of Content. Obsidian에서 허브 역할을 하는 문서. 이 vault는 [[00-README]] | [[00-README]] |
| 콜아웃 | `> [!warning] 미검증 가정`, `> [!success] 검증됨`, `> [!todo]`, `> [!tip] 심사 포인트` | [[00-README]] |
| 해커톤 컷 | 데모 필수 / 있으면 좋음 / 해커톤 이후로 나눈 범위 | [[12-ROADMAP]] |
| `docs/evidence/` | 테스트 리포트·스크린샷·기동 로그를 두는 증거 폴더 | [[11-TESTING]], [[17-CLAUDE-IMPLEMENTATION]] |

## 관련 문서

- [[00-README|00 인덱스]]
- [[15-DATA-CONTRACTS|15 데이터 계약]]
- [[08-SCORING|08 SOL Score]]
- [[03-AI-PIPELINE|03 AI 파이프라인]]
- [[18-HACKATHON|18 해커톤 전략]]
