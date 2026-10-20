# sol_eval — 평가셋 v0.1 빌더·라벨 검증·Kev JSONL 내보내기

`docs/21-MODEL-TRAINING.md` §3·§6, `docs/22-FINETUNE-RUNBOOK.md` §4.1, `docs/23-WEEKEND-FINETUNE.md` §4.4 **갈래 ①(구조화 필드만)**·§4.5,
`docs/plans/2026-10-19-e3-experiment-design.md` §5·§6 을 코드로 옮긴 것이다. DB·네트워크·실모델을 쓰지 않는다.
`services/ai` uv 프로젝트의 workspace 멤버(`services/ai/eval/pyproject.toml`)라 같은 가상환경에서 돈다.

```bash
cd services/ai
uv run python -m sol_eval labels check ../../fixtures/eval/labels/fixture.v0.1.jsonl
uv run python -m sol_eval build --as-of 2026-10-19            # → datasets/sol-eval/v0.1/items.{train,dev,test}.jsonl + build-report.json
uv run python -m sol_eval export                              # → datasets/sol-eval/v0.1/kev/{split}.{en,ko}.jsonl + export-report.json
uv run python -m sol_eval manifest                            # → datasets/sol-eval/v0.1/manifest.json
```

상대 경로는 cwd 기준으로 있으면 그것을, 없으면 저장소 루트 기준으로 푼다. 산출 폴더 `datasets/` 는 gitignore 다(21 §3.1).
실제 공고의 인용 텍스트·첨부 원문은 어느 산출물에도 들어가지 않는다(구조화 필드 값과 공고 제목만).

## 명령

| 명령 | 입력 | 출력 | 실패 |
|---|---|---|---|
| `labels check <file>` | EvalItem JSONL(축소판 가능) | 요약(라벨 출처·초안 출처·qid 묶음별 값 비율)과 `PROBLEM …` 줄 | 문제가 있으면 exit 1 |
| `build --as-of YYYY-MM-DD [--recorded DIR] [--industry DIR] [--companies DIR] [--company-file F] [--splits F \| --derive-splits] [--holdout-company 06] [--max-train-records N] [--include-missing-license-rows] [--version v0.1] [--out DIR]` | 녹음 응답·업종 마스터·원형·분할 | `items.{split}.jsonl`, `build-report.json`, (유도 분할이면 `splits.derived.json`) | 입력 형식 오류 exit 2 |
| `export [--languages en,ko] [--max-state 2048] [--version] [--out]` | `items.*.jsonl` | `kev/{split}.{lang}.jsonl`, `kev/{split}.{lang}.index.jsonl`(stateHash→itemIds), `export-report.json` | 같은 state 다른 라벨, 변형끼리 같은 state, en 한글 → exit 2 |
| `manifest [--version] [--out]` | `build-report.json`·`export-report.json`·`items.*.jsonl` | `manifest.json` | 누수(test·dev 클러스터/공고가 train 에, 홀드아웃 원형이 test 밖에) → exit 2 |

검사 항목(`labels check`): qid 가 `kev-qs/v0.2` 의 12개(또는 `req.<field>[i].status` 틀) 안인가, 값이 선택지 안인가(choice 선택지 /
noul `"true"`·`"false"` / score 등급 index `"0"`~`"4"`), `NEEDS_REVIEW` 에 사유 코드 6종 중 하나가 붙었는가(다른 값에는 없는가),
`req.*` 의 `SATISFIED`·`NOT_SATISFIED` 에 공고 근거(`noticeEvidence`, 15 §2 EvidenceRef 모양)와 회사 근거(`companyEvidence`)가 1개 이상인가,
같은 item 에 같은 qid 가 둘인가, `HUMAN` 에 `labeler`·`labeledAt` 가 있는가, `target` 의 키·합, `extraction` 이 있으면 항목 index 가 KNOWN 배열 안인가.

## 입력 파일 계약

### 1. 원형 `fixtures/eval/companies/NN-*.json` (x6a/companies)

스키마 `company-profile/v0.1`(`fixtures/company/solideo-profile.json` 과 같은 모양). 파일 이름 stem 이 `companyId` 다. 홀드아웃은
`--holdout-company` 접두(기본 `06`)로 고른다. 폴더가 없거나 비어 있으면 `--company-file`(기본 솔리데오 프로필) 하나로 돌고 경고를 남긴다.

빌더가 읽는 필드: `revision`, `technologies[].name`, `technologiesComplete`, `licenses[]{code,name,status}`, `industryCodes[]{code,name,status}`,
`pastProjects[]{amountKrw,evidenceRef?}`, `financials.maxContractKrw`, `staffAvailability?`. 요구: `industryCodes[].code` 는 나라장터 업종 코드
4자리(`"0036"`), `licenses[].name` 은 state 에 그대로 들어가므로 사전 코드가 없는 면허는 **한글 없는 이름**이어야 en state 에 보인다
(한글이면 `(untranslated)`). 회사 `technologies[].name` 도 같다(현재 솔리데오 프로필의 "전자정부 표준프레임워크"·"RAG/LLM 적용" 은 en 에서 `(untranslated)`).

### 2. 녹음 `fixtures/recorded/train/15129394/<operation>.<YYYYMMDD>.<tag>.masked.json` (x6a/recording)

`sol-recorded/v0.1`(`web/server/ingestion/recorded-api.ts` `recordedResponseSchema`). 폴더 안 `*.masked.json` 을 재귀로 모두 읽고,
`operation` 으로 나눈다: `getBidPblancListInfoServc`(목록) · `getBidPblancListInfoLicenseLimit`(면허제한) · `getBidPblancListInfoPrtcptPsblRgn`(참가지역) ·
`getBidPblancListInfoEorderAtchFileInfo`(e발주). 공고는 `(bidNtceNo, bidNtceOrd)` 로 묶는다. 오류 봉투(`resultCode≠00`)는 건너뛴다.
업종 마스터는 `fixtures/recorded/15129467/*.masked.json`(`getIndstrytyBaseLawrgltInfoList`)에서 `indstrytyCd → indstrytyNm`.

읽는 필드: `bidNtceNo`·`bidNtceOrd`·`bidNtceNm`·`asignBdgtAmt`(없으면 `presmptPrce`)·`bidClseDt`·`cntrctCnclsMthdNm`·`indstrytyLmtYn`·
`bfSpecRgstNo`·`orderPlanUntyNo`·`befBidBbancNo`(유도 분할용), 면허제한 `lcnsLmtNm`("이름/코드")·`lmtGrpNo`·`lmtSno`, 참가지역 `prtcptPsblRgnNm`.
담당자 필드는 읽지 않는다. 폴더가 없으면 C1 녹음 `fixtures/recorded/15129394` 로 대체한다(개발용).

recording 담당에게 요구하는 것:
- `indstrytyLmtYn=Y` 인 공고마다 면허제한 행(`inqryDiv=2`+`bidNtceNo`)을 녹음한다. 행이 없는 Y 공고는 기본으로 **건너뛴다**(`skipped.licenseRowsMissingForY`).
  C1 녹음(목록 7일 100건, 면허제한 창 1시간)에서는 30건이 이렇게 빠졌다.
- 참가지역·e발주 행도 같은 공고 집합으로. 없으면 restrictions 는 `UNKNOWN`, 첨부 유무는 `attachmentsIncomplete=true` 로만 남는다.
- 같은 공고가 두 파일에 있으면 먼저 읽은 것을 쓴다(파일 이름순).

### 3. 분할 `fixtures/eval/splits.v0.1.json` (x6a/recording)

```json
{"schemaVersion":"sol-eval-split/v0.1","datasetVersion":"v0.1","createdAt":"<ISO>","sourceWindow":{"from":"2026-08-20","to":"2026-10-19"},
 "recordedRoot":"fixtures/recorded/train",
 "clusters":[{"clusterId":"c-0001","split":"test","noticeIds":["R26BK01756112"],"primaryNoticeId":"R26BK01756112","agency":"…","budgetKrw":"…",
              "deadlineAt":"… or null","hasLicenseLimit":true,"hasEorderAttachment":true,"selectionReason":"…"}],
 "counts":{"test":20,"dev":10,"train":123},"leakCheck":{"testDevInTrain":0}}
```

빌더가 쓰는 것은 `clusters[].clusterId`·`split`·`noticeIds` 뿐이다. 한 공고가 두 클러스터에 있으면 형식 오류. 분할 파일에 없는 공고는 건너뛴다
(`skipped.notInSplits`). 파일이 없거나 `--derive-splits` 면 `bidNtceNo`·`bfSpecRgstNo`·`orderPlanUntyNo`·`befBidBbancNo` union-find +
`sha256(clusterId) % 100`(test 20 / dev 10 / train 70)로 유도하고 `splits.derived.json` 을 같은 형식으로 남긴다(manifest `splitsSource=derived`).
유사 문서 MinHash 병합(21 §3.6)은 본문이 없는 갈래 ① 에서는 하지 않는다.

## 갈래 ① 레코드 구성

NOTICE 블록은 구조화 필드만: 예산·마감(`bidClseDt` 에 `+09:00` 을 붙인다, 가정)·계약 방법·면허제한 행(`qualifications[i]`, kind `LICENSE`,
`code` 는 gateway 와 같은 사전 `qualification-codes.yaml` 의 lookup)·참가지역(`restrictions`)·`attachmentsIncomplete=true`("첨부를 읽지 못했다" 한 줄).
`requiredSkills`·`preferredSkills`·`pastPerformance`·`staffing` 은 `UNKNOWN`(note "branch 1: attachment not read"). `summary` 는 공고 제목.
en state 용 `translations`: `qualifications[i].name` → `industry code <코드>`(원문 숫자 보존), `restrictions[i]` → `participation limited to <시도 영문>`.

state 는 서빙 빌더 `sol_ai.kev_state_v02.build_state_v02` 와 템플릿 `kev/state-templates/{en,ko}.v0.2.txt` 를 그대로 쓴다(`state.py`).
질문 문구는 `kev/question-sets/v0.2.json` 원문(req 틀은 서빙과 같이 `{itemId}` 만 바꾼다).

### 변형(원형 하나 × 공고 하나)

| 변형 id | 자격 축 | 규모 축 | 인력 축 |
|---|---|---|---|
| `q-held` / `q-not-held` / `q-missing` | 업종 HELD / NOT_HELD / 기록 삭제 | — | — |
| `s-over` | held | 수행 상한 = 예산/2, 모든 실적 금액 ≤ 상한 | — |
| `s-within` | not_held | 수행 상한 = 예산×2, 최대 실적 ≥ 예산 | — |
| `f-none` | missing | — | `availableFte 0`(기간: 기준일 ~ 마감) |
| `f-ample` | held | — | `availableFte 12` / `eligibleStaff 20` |

자격 축은 "면허제한 **한 행** + 사전 코드 없음(Kev 담당) + 업종 코드 파싱됨" 일 때만 있다. 없으면 뒤 4개만. 예산이 없으면 규모 축 변형은 뺀다.
업종 보유 상태는 `industryCodes` 에 쓰고 **`licenses` 에 `INDUSTRY_<코드>`(이름 `industry code <코드>`)로 미러링**한다 — 서빙 state 빌더가
`industryCodes` 를 그리지 않아서다(아래 "설계와 다른 점" 1).

### 라벨 규칙

| 질문 | 출처 | 규칙 |
|---|---|---|
| `req.qualifications[i].status` (사전 코드 없음) | `CONSTRUCTED` | 회사 업종 기록 HELD → `SATISFIED`, NOT_HELD → `NOT_SATISFIED`, 없음 → `NEEDS_REVIEW`/`COMPANY_EVIDENCE_MISSING`. 면허제한이 **여러 행**이면 모두 `NEEDS_REVIEW`/`AMBIGUOUS_MATCH`(16 미결정 19), 첫 변형에만 붙인다 |
| `req.qualifications[i].status` (사전 코드 있음) | `RULE_SILVER`(train 만) | 회사 `licenses` 의 그 코드 HELD/NOT_HELD/없음. 여러 행이면 `AMBIGUOUS_MATCH`. state 에 `[qualifications[i]]` 표시가 없어 export 에서 빠진다(`droppedLabelsWithoutStateMarker`) |
| `risk.scale` | 변형이 상한을 바꿨으면 `CONSTRUCTED`, 아니면 `RULE_SILVER`(train 만) | over → `true`, within → `false`. 규칙: 예산 > 상한 이고 예산 > 최대 실적 → `true`; 예산 ≤ 상한 이고 최대 실적 ≥ 예산 → `false`; 그 밖은 없음 |
| `risk.staffing` | 변형이 FTE 를 바꿨으면 `CONSTRUCTED`, 아니면 `RULE_SILVER`(train 만) | FTE 0 → `true`, FTE ≥ 12 → `false` |
| `risk.schedule` | `RULE_SILVER`(train 만) | state 에 staff availability 줄(시작일 = `--as-of`)이 있는 변형에만. 마감 − 시작일 0~7일 → `true`, 30일 이상 → `false`, 사이·지난 마감 → 없음 |
| `techFit`·`perfRelevance`·`risk.techGap`·`risk.scopeAmbiguity`·v0.1 네 질문 | — | 갈래 ① 에서는 붙이지 않는다(사람 라벨 또는 갈래 ②) |

`draftedBy` 는 CONSTRUCTED 가 `NONE`(초안 없이 구성으로 확정), RULE_SILVER 가 `RULE`. test·dev 에는 CONSTRUCTED 만 둔다. 사람 라벨(`HUMAN`)은
사용자가 JSONL 로 뒤에 더한다. 홀드아웃 원형은 test 에만 들어간다.

### 내보내기 단언·경고

- 같은 state 에 다른 라벨 0건(위반이면 중단). 같은 state 에 같은 라벨이면 질문을 합친다(`mergedDuplicateStates`).
- 같은 공고×원형의 변형끼리 state 가 한 줄 이상 다름(위반이면 중단).
- en state 에 한글 0자(위반이면 중단).
- 경고: qid 묶음별 선택지 정답 비율 5% 미만, `--max-state`(글자/4 근사) 초과 레코드 수. 토크나이저는 쓰지 않는다(manifest `tokenizerComputed=false`).
- Kev JSONL 의 `label` 형: choice 문자열, noul boolean, score 정수 index(22 §4.1 예시 기준. Kev data-format 원문은 미확인).

## 번들 구조 (`datasets/sol-eval/<version>/`)

```
items.train.jsonl · items.dev.jsonl · items.test.jsonl   # EvalItem(21 §3.7 + translations·attachmentsIncomplete)
kev/{train,dev,test}.{en,ko}.jsonl                       # Kev JSONL. kev.train --data / kev.benchmark --data 용
kev/{split}.{lang}.index.jsonl                           # stateHash → itemIds (state 원문 없음)
build-report.json · export-report.json · manifest.json   # 수치·경고·sha256·누수 확인
splits.derived.json                                      # 유도 분할일 때만
```

`manifest.json`: 데이터셋 버전, git commit, 질문 세트·state 템플릿·추출 스키마·자격 사전 sha256, 마스킹 버전(`sol-recorded/v0.1`), 갈래, 기준일,
분할 출처·원형·홀드아웃, 분할별 item·클러스터·라벨(출처별)·레코드·질문 수, state 최대 글자·근사 토큰, 파일별 sha256, 누수 0 확인.
tar 로 묶는 것은 X6b(요청서) 몫이다.

## `fixtures/eval/labels/fixture.v0.1.jsonl`

e3 설계 §6 1번 초안. FX-01~FX-20 중 격리 `FX-12`·취소 `FX-08` 을 뺀 18건 + `FX-07` r1(`FX-07.r01`) = 19 item, 89 라벨, 전부
`labelSource=CONSTRUCTED`·`draftedBy=RULE`. `recommendation` 은 `fixtures/manifest.yaml` `expected.outcome`(07 §6.2, `FX-07` r1 은 WATCH),
`req.qualifications[i].status` 는 자격 사전 ↔ 솔리데오 `licenses`(`FX-13` 은 07 §6.2 인용 검증 실패라 `NEEDS_REVIEW`/`NOTICE_INFO_MISSING`),
`req.requiredSkills[i].status` 는 `web/server/scoring/skill-aliases.ts` 와 같은 별칭표 ↔ `technologies`(`technologiesComplete=true` 라 없으면 `NOT_SATISFIED`).
비워 둔 것(사람 라벨 몫): `mandatoryRisk`·`needsHumanReview`·`fit`·`risk.*`·`techFit`·`perfRelevance`, `req.staffing[*]`(역할 의미 대응은 Kev·사람,
인원 수는 `fixtures/people` 기준 규칙), `req.pastPerformance[*]`(fixture 전부 UNKNOWN). 자격 요건 자체가 `UNKNOWN` 인 `FX-04`·`05`·`11`·`17`·`19`·`20` 은
항목이 없어 qualification 라벨이 없다. mock Kev 값(07 §6.3)은 정답이 아니라 넣지 않았다. 동의어·상위개념 대응(21 §3.3)은 사람이 고친다.

## 설계와 다른 점 (제안)

1. **업종 코드의 state 노출**: 서빙 빌더 v0.2 는 `industryCodes` 를 그리지 않는다. 갈래 ① 의 핵심 신호라 `licenses` 에 `INDUSTRY_<코드>` 로 미러링했다.
   worker 가 `profileSummary` 를 만들 때 같은 미러링을 하지 않으면 train/serve skew 다 → 03 §5.6 state 에 업종 줄을 더하거나 worker 가 같은 변환을 하도록 결정 필요.
2. **사전 코드 자격의 RULE_SILVER**(22 §4.1): state 에 `[qualifications[i]]` 표시가 없어 질문을 만들 수 없다. EvalItem 에는 남기고 export 에서 센다.
3. **`risk.schedule` 기준일**: `--as-of` 를 manifest 에 적되, state 에 날짜 기준점이 있는 변형(staff availability 시작일 = `--as-of`)에만 붙인다.
   지난 마감은 라벨 없음.
4. **여러 행 면허제한의 변형**: 모두 `AMBIGUOUS_MATCH` 라 첫 변형에만 자격 라벨을 두고 나머지 변형은 risk 라벨만 둔다(NEEDS_REVIEW 과대 방지).
5. **EvalItem 추가 필드**: `translations`·`attachmentsIncomplete`(state 재구성용), `source`·`extractionId`·`profileRevision`·`companyVariantId`·`rulePredictions`(e3 §5 축소판).
6. **분할 유도**·**C1 녹음 대체**·**원형 1개 대체**는 개발 편의다. manifest 경고로 남는다.
7. `contracts.py` 에 `RequirementExtraction`·`EvidenceRef` pydantic 모델이 없어 gateway 와 같은 JSON Schema(`schemas/requirement-extraction.v0.1.json`)로 검증했다.
