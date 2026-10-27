---
title: "회사 공개 프로필 운영 반영 기록"
status: active
tags: [sol-radar, ops, company-profile]
updated: 2026-10-27
---

# 회사 공개 프로필 운영 반영 기록 (2026-10-27)

실행서: [[../../../plans/2026-10-27-company-public-profile-plan|계획]] Task 10. 단계마다 사용자 확인 뒤 실행했다.

| 순서 | 단계 | 결과 |
|---|---|---|
| 1 | 운영 DB migration `20261027000700_executive_role_company_sources.sql` (`bash scripts/db-push.sh`, `NODE_EXTRA_CA_CERTS`) | 적용. 이미 적용 62개 건너뜀. `db-verify` 통과(migration 63개·RLS·화면 역할 권한·뷰·함수), `--check` 미적용 0 |
| 2 | main push `f0ad424a..5261730f` (push 전 검사 통과) → Vercel 자동 배포 | Vercel `success`. `/health/ready` 200, `/company` 비로그인 307 → 로그인, `GET /api/v1/company-profile` 비로그인 401 |
| 3 | 회사 AI gateway·Analysis Worker 갱신 | 완료(17:05 KST 첫 분석 전, 사용자가 회사 터미널에서). 아래 "회사 반영" |
| 4 | CLI dry-run (`--created-by` 운영 org-01 ADMIN) | 아래 출력. 대상 `brtysdocxemrqhdezzqg.supabase.co`, org-01, 다음 revision 3 |
| 5 | CLI `--apply` | 적용(16:11 KST). 사용자 결정으로 3 보다 먼저 했다(아래 "순서 변경"). revision 3, id `3721b76f-355a-444e-ac4c-d1c0f5aa94e6`, 실적 33·기술 19·자격 1·출처 40·이력 43, `is_demo=false`. 직전 dry-run 결과는 위와 같았다 |
| 6 | 운영 `/company` 화면 확인(1440·1280px, 로그인 계정) | rev 3 표시 확인. 결함 2건 발견(아래 "화면 확인") |
| 6a | CLI `--apply` revision 4(실적 설명 5건의 내부 표기만 고침, 사용자 확인) | 적용(16:22 KST). id `22a79937-3be5-457b-add3-0ff4365b6805`. 기술·자격·실적 추가·삭제 0, 운영 DB 조회로 내부 표기 0건 확인 |
| 6b | CLI `--apply` revision 5(기술 1건 이름을 영어로, 사용자 확인) | 적용(17:15 KST). id `8d53f5e5-8bd3-47dd-b77e-c39f3d47126b`. 아래 "Bosun 이 빠진 원인" 1 |
| 7 | 발표 DEMO 공고 재분석 | 17건 완료(17:23~17:27 KST). FX-02·FX-03 은 사용자 결정으로 뺐다. 아래 "DEMO 재분석" |

## 순서 변경 (2026-10-27 사용자 결정)

회사 서버 갱신(3)이 시작되지 않은 상태에서(운영 첨부 3,094건 전부 `PENDING`, 24시간 분석 0건) 사용자가 "프로필 먼저 넣기"를 골랐다.

- 영향: 회사 Analysis Worker 가 갱신되기 전까지 org-01 의 새 분석은 실패한다. 옛 `companyProfileSchema` 가 실적 `amountKrw: null` 을 받지 않는다(`43e4e024` `web/server/scoring/analysis-input.model.ts:234`).
- 적용 직전 `score_runs` 의 `QUEUED`·`RUNNING` 은 0건이었다. 실공고 분석은 본문이 없어 이미 `409 ANALYSIS_SOURCE_MISSING` 로 막혀 있다.
- 수집(ingest Worker)은 회사 프로필을 읽지 않는다(`43e4e024` 의 `web/server/ingestion`·`web/worker` 수집 경로에 `company_profiles` 조회 없음).
- 분석 요청 경로(web·redis-api)는 최신 프로필의 id·revision 만 읽는다(`bids.supabase.ts`, `latestProfile`).
- **DEMO 화면 영향(적용 뒤 확인).** 옛 분석의 프로필 revision 이 최신과 달라져 운영 DEMO 공고 15건이 모두 "미분석"·"분석 대기"로 보인다(`/dashboard?origin=demo` 분석 대기 15·BID 권고 0·SOL Score —). 결정 전 안내에서 이 영향을 빠뜨렸다([[../../../PROGRESS|진행 상황]] 사용자 결정 대기 6 에는 적혀 있었다). 사용자는 되돌리지 않고 유지한 채 회사 반영(3)과 DEMO 재분석(7)으로 복구하기로 했다.

## 화면 확인 (운영, 2026-10-27)

1. **인증·등록 이력 배치 깨짐.** 출처 링크가 긴 행에서 이름 칸이 0px 로 눌려 한 글자씩 세로로 쌓였다(1440·1280 둘 다, 43행 중 최소 폭 0px). 원인: 행의 출처 링크 목록이 flex 기본값(내용 전체 폭)으로 행을 차지한다. 수정: 다른 탭처럼 링크를 이름 아래에 둔다(`web/components/company/company-panels.tsx`). 운영 DOM 에 같은 구조를 적용해 최소 폭 926px(1440)·847px(1280), 가로 넘침 없음을 확인했다.
2. **실적 설명에 내부 표기 노출.** 실적 5건의 설명에 `pp-05`·`pp-14`·`pp-15`·`profile.json` 이 보였다. 수정: `profile.json` 의 해당 문구를 실적 이름으로 바꾸고 revision 4 로 넣었다(위 6a).

스크린샷: `prod/before-licenses-1280.png`(깨짐), `prod/after-history-dom-1440.png`(운영 DOM 에 수정 구조 적용), `prod/dashboard-demo-1280.png`(DEMO 분석 대기 15), `prod/dashboard-demo-after-*.png`(재분석 뒤 분석 대기 2).

## 회사 반영 (2026-10-27 오후, 사용자가 회사 터미널에서 실행)

실행서 [[../../../plans/2026-10-27-company-rollout-attachments|10-27 회사 반영]] 중 이 작업에 필요한 부분만 했다.

| 서비스 | Compose 프로젝트 | 결과 |
|---|---|---|
| redis-api | `sol-radar-gateway`(`/data/www/ai_workspace/sol-radar-app`) | main `aa0c9f9` 로 fast-forward, 이미지 `9458368e` 로 재생성. healthy, 토큰 없는 `/health` 401, `SOL_RUN_MODE=live`·`SOL_INGEST_MODE=live` |
| AI gateway | `sol-radar-ai-worker`(`/data/www/ai_workspace/sol-radar-deploy`) | 이미지 `f0ad424a63c3`(14:22 교체, 파서는 있으나 실적 금액 `null` 미지원) → `9bb24b002f9b`. 배포 checkout 은 `05f9572` + 회사 전용 carry 커밋(`4750a18` 을 cherry-pick 한 `9bb24b0`) |
| Analysis Worker | `sol-radar-analysis-only`(같은 checkout) | `9bb24b002f9b` 로 재생성 |
| ingest Worker | — | 이 작업에서는 하지 않았다(실행서 D0). 같은 날 18:09 에 `sol-radar-app` 에서 따로 재생성했다([[../../company-rollout/20261027/ingest-worker-recreate\|재생성 기록]]) |
| Documents Worker | — | 시작하지 않았다(실행서 §8 남음) |

배포 checkout 에 diff 목록을 pager 로 저장한 파일 `d` 가 생겨 브랜치 전환이 멈췄다. 사용자가 `~/sol-radar-deploy-stray-d-20261027` 로 옮긴 뒤 진행했다.

## Bosun 이 빠진 원인 2건 (2026-10-27)

갱신 뒤 첫 분석 2건이 `RULES_ONLY`(Bosun 없음)로 끝났다. 점수는 규칙 엔진이 냈고 실패는 없었다.

1. **기술 이름 번역 누락(17:05, revision 4).** Worker 로그 `"kevFailure":"TRANSLATION_INCOMPLETE","kevIssues":["TRANSLATION_MISSING:profileSummary.technologies[13].name"]`. 기술 `HWP·PDF 텍스트 추출` 의 Qwen 번역이 `valid_translation` 검사(ASCII 만)를 통과하지 못했다. 수정: `profile.json` 에서 이름을 `HWP/PDF text extraction` 으로 바꿔 revision 5 로 넣었다(사용자 결정, 6b).
2. **Bosun 주소 404(17:16, revision 5).** gateway 로그 `kev /v1/models unconfirmed: status=404`. 회사 `infra/.env.ai-local` 의 `KEV_BASE_URL=https://acropolissg.com/sol-radar/kev` 는 Nginx 에 없는 경로다(`/v1/models`·`/sol-radar/healthz` 모두 404). 사용자 확인: 이 경로를 Nginx 에 넣은 적 없다. Bosun 서버(`sol_decision.serve`)는 회사 호스트 `127.0.0.1:8009` 에서 10-22 부터 돌고 있다. 수정: 값을 `KEV_BASE_URL=http://127.0.0.1:8009` 로 바꾸고(백업 `infra/.env.ai-local.bak-20261027`) 같은 이미지로 gateway 를 재생성했다(사용자 결정 "루프백 직결"). gateway `/health` 에서 `registryMatch: true` 확인.

문서 어긋남: [[../../../10-DEPLOYMENT|10 배포]]·`infra/gpu/README.md`·`infra/gpu/model-router.conf` 는 `/sol-radar/kev` Nginx 경로를 전제로 적혀 있었다. 운영에는 그 경로가 없다. 사용자 결정으로 세 곳에 운영 구성(루프백 직결, 경로 미등록)을 적었다. 02·03·09·11·16·21 과 `docs/submission/`·`infra/env/` 예시의 같은 전제는 고치지 않았다.

## DEMO 재분석 (2026-10-27 17:23~17:27 KST)

운영 화면에서 관리자 계정으로 [재분석]을 눌렀다. 대상은 운영 DEMO 공고 19건(`DEMO-2026-0012` 는 없다) 중 FX-02(`0002`)·FX-03(`0003`)을 뺀 17건이다. 사용자 결정으로 FX-02·FX-03 은 옛 분석(프로필 revision 2)으로 남겼다.

- 17건 모두 `COMPLETED`, 프로필 revision 5, `RULES_WITH_KEV_ASSIST`(`Qwen3.8-Flash-Next-AWQ-INT4` + `Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`), 대체(fallback) 0건.
- 권고는 17건 모두 WATCH, 점수 43~75. BID 는 0건이다. 보유 자격이 1건뿐이라 다른 자격을 요구하는 공고는 NEEDS_REVIEW 가 되어 WATCH 가 상한이다.

| 공고 | 점수 | 공고 | 점수 | 공고 | 점수 |
|---|---|---|---|---|---|
| DEMO-2026-0001 | 58 | DEMO-2026-0008 | 60 | DEMO-2026-0015 | 63 |
| DEMO-2026-0004 | 60 | DEMO-2026-0009 | 51 | DEMO-2026-0016 | 65 |
| DEMO-2026-0005 | 75 | DEMO-2026-0010 | 55 | DEMO-2026-0017 | 58 |
| DEMO-2026-0006 | 58 | DEMO-2026-0011 | 73 | DEMO-2026-0018 | 62 |
| DEMO-2026-0007 | 43 | DEMO-2026-0013 | 65 | DEMO-2026-0019 | 63 |
| | | DEMO-2026-0014 | 57 | DEMO-2026-0020 | 60 |

- 운영 `/dashboard?origin=demo`(1440·1280px): 분석 대기 15 → 2(FX-02·FX-03), BID 권고 0, 진행 중 WATCH 13. 스크린샷 `prod/dashboard-demo-after-1440.png`·`prod/dashboard-demo-after-1280.png`.
- 발표 시나리오 영향:
  - FX-03(S3)는 옛 분석이 NO_BID 68 이다. 새 프로필은 `ICT_CONSTRUCTION` 을 보유(HELD)하므로 FX-03 을 재분석하면 S3 장면이 달라진다.
  - FX-02(S4)는 옛 분석 66 WATCH 그대로다. 문서의 S4 예상(재분석 시 78 BID·72 WATCH)은 fixture 프로필 기준이라 지금 프로필에는 맞지 않는다. revision 5 로 재분석한 값은 확인하지 않았다.

참고: dry-run 이 재무를 바뀜(`financials: true`)으로 보고하지만 값은 같다. CLI 가 DB jsonb 와 파일 JSON 을 키 순서째 문자열로 비교한다(`scripts/ops/company-profile.mjs:199`).

## dry-run 출력 (2026-10-27)

키·비밀번호는 출력에 없다. `createdBy` 는 ADMIN 계정의 사용자 id 다.

```json
{
  "host": "brtysdocxemrqhdezzqg.supabase.co",
  "org": "org-01",
  "orgId": "db4c863c-cb6a-593d-93ff-709a17e0157a",
  "nextRevision": 3,
  "createdBy": "25caa3c1-8b70-477f-a359-32905674f94a",
  "changes": {
    "technologies": {
      "added": [
        "HTML5",
        "JavaScript",
        "WebGL",
        "BIM",
        "IoT",
        "Nutanix HCI",
        "eGovFrame",
        "Spring",
        "LLM",
        "RAG",
        "AI 에이전트",
        "GPT-4o",
        "HWP·PDF 텍스트 추출",
        "IFC 2X3",
        "빅데이터",
        "클라우드",
        "마이데이터",
        "전자문서"
      ],
      "removed": [
        "Spring Boot",
        "전자정부 표준프레임워크",
        "NestJS",
        "Next.js",
        "PostgreSQL",
        "Kubernetes",
        "RAG/LLM 적용"
      ]
    },
    "licenses": {
      "added": [],
      "removed": [
        "소프트웨어사업자 신고확인서",
        "직접생산확인증명서(소프트웨어개발)",
        "중소기업확인서(중기업)",
        "ISO 27001",
        "CMMI L3",
        "방산업체 지정",
        "ISMS-P",
        "CSAP"
      ]
    },
    "industryCodes": {
      "added": [],
      "removed": []
    },
    "pastProjects": {
      "added": [
        "정부24",
        "건축행정시스템 세움터",
        "보조금24",
        "정부 전자문서지갑",
        "공공 마이데이터",
        "행정정보 공동이용시스템",
        "시도 행정정보시스템",
        "새올 행정시스템",
        "건축HUB포털",
        "렌트홈",
        "의약품안전나라",
        "마이홈",
        "식품안전나라",
        "소상공인24",
        "식의약품 종합정보시스템",
        "건축물 생애이력 관리시스템",
        "청주시 굿모닝행정포털",
        "혜택알리미(gov.kr)",
        "온마이데이터(onmydata.go.kr)",
        "소상공인 빅데이터 저장소(bigdata.sbiz.or.kr)",
        "수입식품안전나라(impfood.mfds.go.kr)",
        "식약처 대표 홈페이지·유관포털 통합관리(mfds.go.kr)",
        "차세대 지방행정공통시스템 구축 ISMP(삼성SDS 컨소시엄)",
        "Acropolis SG 일본 계약 3건(나리타 공항 제3활주로·후쿠시마 RTF·쿄토시 하수시설관리)",
        "건축행정정보시스템 유지관리(2005년 수주)",
        "두만강 광장 및 부속 시설물 관리 정보시스템 구축(중국 투먼시)",
        "강남구 종합정보화사업(STAR)",
        "국토교통부 초고층복합건물 연구개발(BIM·FMS)",
        "부동산행정정보일원화 사업(2013)",
        "2024년 마이데이터 종합기반 조성사업 중 부동산 임대차 안심거래 지원 서비스",
        "5차 공공 마이데이터 유통 체계 구축",
        "솔리데오 중개서비스 for NHN Cloud(IaaS) (조달청 디지털서비스몰 제3자단가계약)",
        "디지털서비스_솔리데오_지원서비스 (조달청 디지털서비스몰 제3자단가계약)"
      ],
      "removed": [
        "지자체 민원 시스템 고도화",
        "공공기관 데이터 플랫폼 구축",
        "교육기관 AI 챗봇 PoC"
      ]
    },
    "financials": true
  },
  "row": {
    "org_id": "db4c863c-cb6a-593d-93ff-709a17e0157a",
    "revision": 3,
    "name": "㈜솔리데오",
    "technologies": 19,
    "technologies_complete": false,
    "licenses": 1,
    "industry_codes": 0,
    "past_projects": 33,
    "financials": {
      "fiscalYear": 2025,
      "annualRevenueKrw": "60249901054",
      "capitalKrw": "3383500000",
      "employeeCount": 281,
      "note": "매출·자본금은 DART 2025 감사보고서(별도). 연결 매출 68,671,542,106원. 사원 수 281명은 잡코리아·캐치(NICE, 2025-12-31). 홈페이지 290명·회사소개서 300명은 기준일 없음.",
      "sourceIds": [
        "dart-audit-2025",
        "dart-audit-consol-2025",
        "src-jobkorea-co",
        "src-catch-co",
        "src-home-overview"
      ]
    },
    "preferences": {
      "agencies": [],
      "agencyTypes": [],
      "domains": [
        "민원",
        "데이터 플랫폼",
        "AX",
        "스마트시티"
      ],
      "excludedDomains": [],
      "excludedKeywords": []
    },
    "sources": 40,
    "public_history": 43,
    "is_demo": false,
    "created_by": "25caa3c1-8b70-477f-a359-32905674f94a",
    "note": "공개 자료 기준(2026-10-27 수집)"
  },
  "apply": false,
  "applied": null
}
```
