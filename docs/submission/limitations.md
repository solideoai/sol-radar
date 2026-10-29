---
title: "기술적 한계·미완성 항목·실행 모드 구분"
doc: "submission-limitations"
status: draft
tags:
  - sol-radar
  - hackathon
  - submission
updated: 2026-10-29
---

# 기술적 한계·미완성 항목·실행 모드 구분

심사위원이 "어디까지가 실제이고 어디까지가 mock인가"를 묻기 전에 먼저 답하는 문서다. 정본은 [[18-HACKATHON|18 해커톤]] §7 정직성 표와 [[16-DECISIONS|16 ADR]] 미결정 표다. §4 S-LIVE 갈래는 A(실제 공고·실제 추론)로 정했다([[16-DECISIONS|ADR-068]]). 모델은 [[16-DECISIONS|ADR-034]]를 따른다. 결정 모델은 Bosun v3.1 0.6B(`Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`)다. 추출·설명 모델은 회사 vLLM API(`https://acropolissg.com/vllm/v1`)의 Qwen3.8-Flash-Next다(served id `Qwen3.8-Flash-Next-AWQ-INT4`, 2026-10-21 probe에서 레지스트리 run id와 일치). 이 문서에서 "Kev"는 식별자(`/kev`·`KEV_*`·`kev-qs/*` 등)로만 남는다.

## 1. 정직성 표 요약 (18 §7)

실모델 열은 연결 성공 시 역할 계약이다. 회사 Qwen 엔드포인트 probe는 통과했다(2026-10-21). 운영 앱 경로의 실모델 분석은 DEMO 가상 공고 19건과 실공고 3건이다(`Qwen3.8-Flash-Next-AWQ-INT4` + `bosun-v3.1-0.6b`, 대체 없음). 2026-10-24 FX-02 1건은 가상 프로필로 66점 보류(`WATCH`)를 받았다. 66이 골든 72와 다른 까닭은 당시 마감이 가까워 일정 계수가 낮았기 때문으로 본다(추정, [마감 이동 점검](../evidence/demo-deadline/20261027/README.md) S4 절). 2026-10-27 17건은 공개 자료 프로필 revision 5로 다시 분석해 43~75점, 모두 보류다([기록](../evidence/company-public-profile/20261027/prod-rollout.md)). 2026-10-28 FX-03 1건도 같은 프로필로 53점 보류다. 공개로 확인된 자격이 1건뿐이라 운영에는 추천(`BID`) 권고가 없다([[16-DECISIONS|ADR-059]]). 실제 나라장터 공고는 2026-10-29 회사 AI gateway 교체([[16-DECISIONS|ADR-064]] 첨부 조립 v0.2·인용 길이·[[16-DECISIONS|ADR-065]] 번역 비교 표현) 뒤 3건을 분석했다([기록](../evidence/company-rollout/20261029/ai-gateway-rollout.md)). 부경대 38 보류(`WATCH`) `RULES_ONLY`(번역 거부로 Bosun 생략), 동국대 44 보류 `RULES_WITH_KEV_ASSIST`·`MODEL_RULE_DISAGREEMENT`, 국가 재난 정신건강 전산시스템 45 보류 `RULES_WITH_KEV_ASSIST`(`CITATION_FAILED:restrictions`)다. 그 전 2026-10-28 첫 실공고 분석은 추출이 전 항목 `UNKNOWN`이었다(ADR-064의 계기). 부경대의 남은 번역 거부는 사용자 결정("여기서 멈추기")으로 더 고치지 않는다. 판정은 규칙 엔진이 하므로 빠지는 것은 Bosun 참고 의견뿐이다. 실공고 S-LIVE 녹화(C8)는 남았다. 분석 job의 설명은 모든 모드가 템플릿이다. Qwen 설명은 공고 상세의 [추천 분석] 버튼을 눌렀을 때만 만든다([[16-DECISIONS|ADR-066]]). 2026-10-29 운영에 반영했고 실공고·DEMO 각 1건이 모델 응답(`MODEL`)으로 끝났다(기록 `docs/evidence/company-rollout/20261029/rec-insight-rollout.md`, [[PROGRESS|진행 상황]]). 출력 검증에 걸리면 규칙 결과 문장(`TEMPLATE`)으로 대체하고 화면에 표시한다.

| 영역 | `live` | `fixture` | `mock` |
|---|---|---|---|
| 공고 | 실제 공고(나라장터 · LH · KEPCO · K-water 입찰공고, `is_demo=false`) | 가상 fixture 20건(`DEMO` 배지) | 가상 fixture 20건 |
| 첨부·파싱 | **회사 운영 중**(다운로드·파서·documents worker, ADR-054). 2026-10-28부터 회사 Documents Worker가 돈다([기록](../evidence/company-rollout/20261028/sources-rollout.md), 처리 건수는 [[PROGRESS\|진행 상황]]). 격리 스택에서 HWP·PDF·HWPX 3건 `PARSED`([증거](../evidence/attachment-pipeline/20261027-isolated-run.md)). 처리 범위 밖 첨부는 `PENDING`으로 남는다(ADR-055 채택). 첨부 일부만 반영된 추출이 재사용될 수 있다(ADR-056 A안 채택, 코드 구현·회사 반영 전). KEPCO 첨부 주소는 해커톤 동안 막아 둔다(ADR-068) | fixture 첨부 없음 | fixture 첨부 없음 |
| 회사 프로필 | **공개 자료 솔리데오**(운영, revision 5, "공개 자료 회사 프로필로 분석" 배지, [[16-DECISIONS\|ADR-052]]) | 가상 솔리데오("가상 회사 프로필로 분석" 배지) | 가상 솔리데오 |
| Qwen 추출 | 회사 API의 Qwen3.8-Flash-Next를 호출하는 어댑터 구현. 엔드포인트 probe 통과(2026-10-21, [증거](../evidence/phase-5/qwen-probe-20261021-2343.json)). 운영 앱 경로 실추론은 DEMO 가상 공고 19건(2026-10-24 FX-02 1건, 10-27 17건, 10-28 FX-03 1건)과 실공고 3건(2026-10-29) | 같은 실모델 경로, 앱 경로 실추론 미확인 | 고정 추출 응답 |
| 설명 | 분석 설명은 템플릿(`fallback=true`). [추천 분석] 버튼을 누르면 Qwen 설명(검증 실패 시 `TEMPLATE`, ADR-066) | 템플릿(`fallback=true`) | 템플릿(`fallback=true`) |
| 결정 모델(Bosun) | 회사 GPU 서버의 Bosun v3.1 0.6B 실추론(우리 `sol_decision` 서버. 운영 실추론은 DEMO 가상 공고 19건(2026-10-24·27·28)과 실공고 2건(2026-10-29)), 참고 지표만, `UNCALIBRATED` | 실추론 | 고정 응답(`kev-qs/v0.1`, 모델 식별자 `mock`) |
| mock 자동 대체 | 금지(켜면 기동 거부) | 금지(켜면 기동 거부. 해커톤 동안 미구현, ADR-030 B11) | 금지(처음부터 mock, 켜면 기동 거부) |

모드와 무관하게 실제 구현인 것(mock 응답이 아닌 것): 수집·정규화·revision·변경 감지, 자격 판정·SOL Score·결정 정책, 인앱 알림, 테넌트 격리(RLS). 어디까지 구현됐는지는 §3. 골든 94/72/68은 `mock` 시험 기준이다. 운영 FX-02의 66을 골든과 견주는 수치로 쓰지 않는다.

## 2. 미검증

| 항목 | 상태 | 어디서 확인 |
|---|---|---|
| 결정 모델(Bosun v3.1 0.6B)의 한국어 입찰 도메인 성능. Bosun·DecisionBench 학습 데이터가 영어 | 미측정. 운영은 영어 템플릿 state만, 한국어 state는 평가 전용(E2). 영어 state zero-shot 기준선은 E1' | 16 미결정 24번, [[16-DECISIONS\|ADR-012]]·[[16-DECISIONS\|ADR-034]], [[03-AI-PIPELINE\|03 AI 파이프라인]] §5.6 · §5.11 |
| 나라장터 API의 조회 기간 상한·면허제한 여러 행의 의미·키 오류 응답(resultCode 30·31·22) 형식 | 미검증. 실제 응답 자체는 **검증됨**(2026-10-19 C1 ① A1~A9, 4 서비스 37회, 마스킹 응답 14건 `fixtures/recorded/`) | 16 미결정 1번, `evidence-list.md` 1번, [API 호출 증거](../evidence/phase-0/external-deps-api-20261019.md) |
| g2b 첨부 자동 다운로드의 이용약관상 허용 여부·HWP 5.0 표본 | 미검증. 익명 다운로드 자체는 **검증됨**(2026-10-19 C1 ② B1~B4, 3건 `www.g2b.go.kr` 익명 GET 200, 로그인·리다이렉트 0건) | 16 미결정 16 · 18번, `evidence-list.md` 2번 |
| 결정 모델 서버(`sol_decision` `:8009`)의 지연, 회사 vLLM의 `prompt_logprobs`(E3) 지원, 노트북 대체 경로에서 결정 모델에 닿는 공개 경로. 운영 gateway는 같은 호스트에서 `http://127.0.0.1:8009`로 붙는다. 설계한 공개 경로 `https://acropolissg.com/sol-radar/kev`(GPU 서버 안 모델 라우터 `infra/gpu/model-router.conf`)는 회사 nginx에 등록되지 않았다(2026-10-27) | 회사 Qwen API(`https://acropolissg.com/vllm/v1`)는 **probe 통과**(2026-10-21: `/v1/models` 200·125ms, served id `Qwen3.8-Flash-Next-AWQ-INT4`, chat completions 200·253ms·guided JSON 지원, 요청 2회, [증거](../evidence/phase-5/qwen-probe-20261021-2343.json)). 운영 앱 경로 실추론(Qwen·Bosun)은 2026-10-24 가상 공고 FX-02 1건(66 보류, 대체 없음)과 2026-10-27 DEMO 17건(대체 0), 2026-10-29 실공고 2건으로 확인. 결정 모델 `/v1/models` 200·레지스트리 대조 확인(2026-10-27, [기록](../evidence/company-public-profile/20261027/prod-rollout.md)). `prompt_logprobs`·지연 실측은 미확인. 노트북 대체 경로는 결정 모델 없이(`RULES_ONLY`) 끝난다 | 16 미결정 3 · 17 · 24번, [[16-DECISIONS\|ADR-025]]·[[16-DECISIONS\|ADR-034]], P0-0 ③ G1~G4 |
| 회사 GPU 하드웨어·VRAM 점유·가중치 대조. 우리가 물리 GPU 1에 올리는 것은 Bosun 서빙·학습뿐이다. 같은 GPU의 회사 컨테이너는 멈추거나 옮기지 않고, 학습·서빙 전에 메모리만 확인한다(Qwen3.8-Flash-Next는 회사 API라 GPU 1을 쓰지 않는다) | 직접 측정 불가(서버 외부 접근 불가, 회사 운영). 회사가 주는 값이 있으면 기록, 없으면 "회사 운영, 미제공" | [[16-DECISIONS\|ADR-025]]·[[16-DECISIONS\|ADR-034]] 10번·[[16-DECISIONS\|ADR-066]] 7번, P0-0 ③ G5 |
| HWP·HWPX·PDF 파서 선택과 품질 | 파서는 `pdfplumber`·`sol-hwpx`·`sol-hwp5`로 정했고 실표본 6건이 `PARSED`였다([파서 실표본 확인](../evidence/parser/20261027-parser-check.md)). [[03-AI-PIPELINE\|03]] §10.3 사람 작성 기준표(형식마다 10건 이상)와 운영 실공고 품질은 미측정 | 16 미결정 4 · 20번, `evidence-list.md` 4번 |
| 첨부 일부만 파싱된 때의 추출 재사용 | 추출 캐시 키에 입력 문서 집합이 없다. 첨부 일부만 파싱된 때 분석하면 그 추출이 다시 쓰여, 첨부에만 있는 조건이 빠질 수 있다. 코드 읽기로 확인했고 재현 기록은 없다. 첨부 처리가 운영에서 돌므로 실공고 분석에서는 "첨부 일부만 반영됐을 수 있다"고 밝힌다 | [[16-DECISIONS\|ADR-056]](A안 채택: 분석이 그 revision 문서 처리를 최대 300초 기다린다. 코드 구현·회사 반영 전) |
| 첨부 원문(공고문·제안요청서)의 저작권·학습 사용 권리 | 미확인. 내부 분석만, 원문은 증거에 넣지 않음 | 16 미결정 18번 |
| 면허제한 여러 행의 AND/OR | 미확인. 여러 행이면 `NEEDS_REVIEW`(`AMBIGUOUS_MATCH`) | 16 미결정 19번 |
| Supabase Auth 세부 설정값(토큰 만료·시도 제한) | 미확인. 값을 적지 않음 | 16 미결정 10번 |
| 점수 가중치 30/25/20/15/10과 임계값 75/50 | 초기 가정. 백테스트 전 | [[08-SCORING\|08 점수]] §2, 16 미결정 7번 |
| 시간 절감 30분 → 10분 | 가설. 측정 전 | [[01-PRD\|01 PRD]] 성공 측정, `experiment-tables.md` (b) |

## 3. 미완성·범위 밖

**해커톤 안 미완성**: 실공고 S-LIVE 녹화(C8)는 남았다. 실공고 분석은 2026-10-29 3건이고 모두 보류다(§1). 평가 실험(X1, E0~E3)·Bosun 파인튜닝(X6)·임팩트 예비 실험(X2)은 발표(2026-11-04) 뒤 진행 예정이고 날짜는 정하지 않았다([[16-DECISIONS|ADR-067]], [`experiment-tables.md`](experiment-tables.md)). 분석 job의 설명은 템플릿이다(Qwen 설명은 [추천 분석] 버튼으로만, [[16-DECISIONS|ADR-066]]). 알림 전용 Worker(notify-only)는 준비만 했고 회사에서 기동하지 않았다(`infra/company/README.md` §9). 그래서 운영은 인앱·카카오·마감 알림을 처리하지 않는다. 구현 범위는 [[PROGRESS|진행 상황]]과 [[12-ROADMAP|12 로드맵]] Critical Path 표를 본다.

**확장 컷·P1**: 카카오톡 나에게 보내기(ADR-038), 변경 감지(S5), 부처 공고(ADR-040), P1 다섯 화면(관심 공고·분석 결과 비교·입찰 프로젝트·인력 배치 시뮬레이션·조직/인력 편집)은 main에 있다. P1 다섯 화면과 새 메뉴 세 개(자격 갭 레이더·발주 현황·입찰 일정, [[16-DECISIONS|ADR-060]])는 운영에 배포됐다. 이메일 알림(ADR-041)은 해커톤에서 뺐다(코드 없음). 평가셋·학습셋 번들(P0-9·P0-11)은 Bosun LoRA 트랙 X6로 옮겼다([[16-DECISIONS|ADR-034]]).

**범위 밖(해커톤 이후 포함)**: 결제·구독, 모바일 레이아웃·네이티브 앱, 자동 투찰, 승률·낙찰 확률 예측, 카카오 알림톡(운영 전환 경로. 사업자·비즈니스 채널·템플릿 검수가 필요하다), Qwen 파인튜닝(ADR-034 8번), hosted 모델 API·클라우드 GPU 임대(승인 전), ERP 실연동.

**카카오톡 추천 공고(나에게 보내기, [[16-DECISIONS|ADR-038]])의 한계**: 해커톤에서는 개인 설정에서 켠 사람에게 추천 공고(추천·보류 권고)를 카카오 "나에게 보내기"로 보낸다. 기본은 `mock`이고, 실발송은 `NOTIFY_KAKAO_PROVIDER=memo`일 때만이다.
- 휴대폰 알림이 울리는지는 공식 문서에 없다. 운영 카카오 연결은 0건이고, 수신 시험·실수신은 아직 없다. `talk_message` 동의에 카카오 검수가 필요한지도 미확인이다. 추천 알림을 보낼 알림 전용 Worker는 회사에서 기동하지 않았다(§3).
- 시연 영상에서는 실제 나라장터 공고의 추천·보류 권고를 `memo`로 실발송해 휴대폰 수신을 녹화하고, 녹화 뒤 `mock`으로 되돌린다(2026-10-24 사용자 결정, [[16-DECISIONS|ADR-038]]). 녹화는 알림 전용 Worker 회사 기동과 S0 수신 시험 뒤, 실공고 S-LIVE와 함께 찍는다([[16-DECISIONS|ADR-054]], `infra/company/README.md` §9.6). 실수신은 녹화 뒤에만 확인으로 적는다. 알림 전용 Worker 첫 기동은 발송 꺼짐(기본)으로 해 쌓인 `BID_RECOMMENDED`를 `DEAD`로 정리한 뒤 `memo`로 바꾼다. 기동은 사용자 승인 뒤이고 아직 하지 않았다([[16-DECISIONS|ADR-068]]). 운영 회사 프로필은 공개 자료 프로필이다([[16-DECISIONS|ADR-052]]).
- 카카오는 서비스가 사용자에게 보내는 자동 안내에 알림톡을 안내한다. 나에게 보내기는 해커톤 시연용으로만 쓰고, 운영에서는 알림톡으로 바꾼다. 발표·영상에서 이렇게 말한다.
- 권고·점수·규칙 사유 한 줄이 카카오 서버를 거쳐 본인 카톡에 남는다([[09-SECURITY|09 보안]]).
- 코드는 main에 있고 운영 DB migration도 적용했다. 수신 장면은 영상 녹화 하나다. 본편 DEMO 데이터(FX-01·02)는 바꾸지 않는다([[19-DEMO-SCENARIO|19 데모]] §4 "녹화 전용", [[16-DECISIONS|ADR-038]]).

**하지 않는 것**: mock 자동 대체(기본), 원본 데이터 위조, 녹화·fixture 결과를 live로 표시, 정보 부족을 미충족으로 판정, 결정 모델이 자격·점수·권고를 바꾸는 경로, 개선 확인과 사용자 승인 없이 데모 모델을 학습본(Bosun LoRA)으로 바꾸기(ADR-034 9번).

## 4. 외부 의존성 컷 결과별 발표 문장 (하나만 쓴다)

외부 의존성 결과로 S-LIVE 장면이 네 갈래 중 하나로 정해진다. 갈래는 A로 정했다(2026-10-29 사용자 결정, [[16-DECISIONS|ADR-068]]). 촬영 공고는 동국대 44 보류(`RULES_WITH_KEV_ASSIST`·`MODEL_RULE_DISAGREEMENT`) run이고, 부경대 `RULES_ONLY`·국가 재난 정신건강 45 run은 촬영하지 않는다. G3 지연 실측이 없으므로 발표에서 지연 숫자를 말하지 않는다. 모델과 규칙이 엇갈리는 장면은 "판정은 규칙, 결정 모델은 참고, 결정은 사람"으로 말한다. "장면을 빼고 설명으로 대체"는 사용자가 고르지 않았다. 지금 있는 증거는 두 가지다. ① 2026-10-29 운영 실공고 3건 분석([기록](../evidence/company-rollout/20261029/ai-gateway-rollout.md)): 공공 API 수집과 Qwen 추출은 3건 모두 돌았고(부경대는 공고서 PDF·제안요청서 HWPX 인용), Bosun은 2건(동국대·국가 재난 정신건강)에서 응답했다. 부경대는 번역 거부로 Bosun을 건너뛰어 `RULES_ONLY`다. 화면 녹화와 지연 실측(G3)은 아직 없다. ② 2026-10-20 격리 로컬 live run 1건(실공고 `R26BK01774434`, `PARTIAL`·`RULES_ONLY`·`QWEN_UNAVAILABLE`, 보류 73, [run-modes](../evidence/demo-day/20261020-1434/run-modes.md)). ②만 쓰면 갈래 B 문장이고, 2026-10-20 격리 로컬 결과라고 밝힌다. 발표에서는 해당 문장 하나만 쓴다(`slides-spec.md` 슬라이드 14 · 부록 A 클립 5 · A.4 컷 5). "GPU 정상"은 회사 추론 엔드포인트 두 곳(결정 모델 `sol_decision` `127.0.0.1:8009`, Qwen API `/vllm/v1`) 점검 G2(`/v1/models` 레지스트리 대조)·G3(지연 실측) 통과를 뜻한다([[16-DECISIONS|ADR-025]]·[[16-DECISIONS|ADR-034]]).

| 갈래 | C1 결과 | 발표에서 말할 문장 |
|---|---|---|
| A | 공공 API 정상, GPU 정상 | "이 화면은 나라장터에서 실제로 수집한 공고를, 회사가 운영하는 Qwen3.8-Flash-Next와 회사 GPU 서버에서 돌린 결정 모델 Bosun으로 분석한 결과입니다. 회사 프로필은 공개 자료로 만든 것이고, 실행 모드는 live입니다. 이 공고는 결정 모델과 규칙이 엇갈렸습니다. 판정은 규칙, 결정 모델은 참고, 결정은 사람입니다. 실행 로그는 증거 폴더에 있습니다." |
| B | 공공 API 정상, GPU 불가 | "이 화면은 나라장터에서 실제로 수집한 공고입니다. 모델 엔드포인트에 연결하지 못해 규칙 기반 자격 판정과 점수만 있는 PARTIAL 결과이고, AI 추출과 결정 모델 참고 지표는 비어 있습니다. mock으로 대체하지 않았습니다." |
| C | 공공 API 불가, GPU 정상 | "공공 API 호출이 막혀 실제 공고 대신 검증된 가상 공고(fixture)를 썼습니다. 분석은 회사 Qwen API와 결정 모델 서버의 실제 모델 추론이고, 실행 모드는 fixture입니다. 가상 공고라는 뜻으로 DEMO 배지가 붙어 있습니다." |
| D | 둘 다 불가 | "오늘 시연은 가상 공고와 고정 AI 응답(mock 모드)입니다. 실제 API 응답·모델 엔드포인트 연결은 확보하지 못했고, 그 사실과 시도 기록을 증거 폴더에 그대로 남겼습니다. 실제 결과를 보여 드리지 못한 것은 저희 한계입니다." |

어느 갈래든 공고 상세 분석 요약 띠의 "분석 실행 모드: …"와 "AI: …"가 화면에 보여야 하고(상단바의 실행 모드·AI 표시는 2026-10-26에 없앴다), 사전 녹화를 쓰면 "녹화"라고 밝힌다.

**Bosun LoRA(E4) 문장**: X6(회사 GPU 학습)은 **발표(2026-11-04) 뒤 진행 예정**이다([[16-DECISIONS|ADR-067]]). 발표 뒤 날짜는 정하지 않았고, 회사 서버에서 학습을 돌린 기록은 없다. 그래서 발표에서는 아래 "발표 때" 문장을 쓴다. "결과가 나온 뒤" 문장은 발표 뒤 학습과 채점(B5)이 끝나 결과가 있을 때만 쓴다([[16-DECISIONS|ADR-034]] 7 · 9 · 12번).

- 발표 때(기본): "Bosun LoRA 학습과 채점(B5)은 발표 뒤 회사 GPU에서 한다. 그래서 E4 결과는 아직 없다. 학습 절차는 [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]에 있다. 데모는 공개 Bosun v3.1 0.6B 를 쓴다."
- 결과가 나온 뒤(B5 결과가 있을 때만): "공개 Bosun v3.1 0.6B 의 LoRA 를 이어 학습해, 공개 Bosun(E1')과 같은 test 20 사업에서 비교했다. Macro-F1 차이는 Δ=…(95% CI …)다. 데모는 공개 Bosun 을 쓴다."

학습본으로 바꾸는 것은 Δ의 95% CI가 0을 배제하고 회귀(내부 dev)가 안정적이며 사용자가 승인한 뒤에만이다(ADR-034 9번). 그때는 "결과가 나온 뒤" 문장의 끝을 "데모는 학습본을 쓴다"로 바꾼다.

## 5. 데모 장애 대체 경로 (요약, 정본은 [[19-DEMO-SCENARIO|19 데모 시나리오]] §5)

| 장애 | 대체 | 화면에 보이는 것 |
|---|---|---|
| 인터넷 연결 실패 | 로컬 Supabase CLI: `pnpm db:start` → `pnpm demo:reset` → 모드 확인(mock) → `pnpm demo:preanalyze` → web 재시작(reset이 사전 분석을 지운다), 리허설로 확인 | 실행 모드 그대로, 데이터 출처 로컬 |
| 공공 API 장애·일일 한도 | D1 S-LIVE는 저장된 run 조회라 영향 없다. 로컬 경로는 `fixture` 모드로 전환(env + 재시작) | 분석 요약 띠 "분석 실행 모드: fixture", `DEMO` 배지 |
| 회사 Qwen API·결정 모델 엔드포인트 미접속(`QWEN_UNAVAILABLE`·`KEV_UNAVAILABLE`) | D1은 모드를 바꾸지 않고 `PARTIAL` 화면을 그대로 보인다. 저장된 run 조회로 이어 간다. 로컬 경로는 `mock` 모드로 전환한다. 재접속 확인은 `GET /v1/models` | `PARTIAL` 배너, `RULES_ONLY`, 또는 저장된 run의 `run_mode` |
| Supabase 클라우드 장애 | 로컬 CLI 전환 | 위와 같음 |
| 첨부 다운로드·파싱 실패 | 그대로 보이고 원문 링크를 연다. AI가 첨부 내용을 추측하지 않는다고 말한다 | 배지 "첨부 원문 확인"·"첨부 원문 확인(내려받기 실패)"(`web/components/bids/labels.ts:179-180`), 관련 자격 "확인 필요" |
| 추론 시간 초과 | 그대로 시연 | `PARTIAL` 배너, `RULES_ONLY` |

자동 fallback은 없다. 전환은 사람이 하고 바꿨다고 말한다. 발표 시연 경로는 D1이다(운영 `https://www.solideos-radar.com` `?origin=demo`, `demo:reset` 안 함, ADR-054). 클립은 이 경로에서 찍고, 변경 감지(S5)와 장애 대체(S6)만 로컬 Compose에서 찍는다([[19-DEMO-SCENARIO|19]] §4). 위 표의 `pnpm demo:reset`은 로컬 Supabase CLI로 바꿨을 때만 쓴다. 운영 DEMO 19건 삭제(실운영 전환 A단계)는 발표 뒤로 미뤘다.

## 관련 문서

- [[18-HACKATHON|18 해커톤]] — §7 정직성 표, §8 예상 질문, §9 데모 당일 리스크
- [[16-DECISIONS|16 ADR]] — 미결정 표, ADR-007 · ADR-010 · ADR-020 · ADR-025 · ADR-034 · ADR-038 · ADR-054 · ADR-055 · ADR-056
- [[19-DEMO-SCENARIO|19 데모 시나리오]] — §2.1 실행 모드, §5 장면별 실패 대응
- [[09-SECURITY|09 보안]] — 책임 있는 AI, 고지 문구
- [[12-ROADMAP|12 로드맵]] — 외부 의존성 컷 규칙, Critical Path 표
