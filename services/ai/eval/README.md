# sol_eval — 평가셋 v0.1 빌더·라벨 검증·Bosun/Kev JSONL 내보내기·누수 검사·오프라인 채점

`docs/21-MODEL-TRAINING.md` §3·§4·§6, `docs/22-FINETUNE-RUNBOOK.md` §4.1·§4.4, `docs/15-DATA-CONTRACTS.md` §4.1, `docs/16-DECISIONS.md` ADR-034 7·9번,
`docs/23-WEEKEND-FINETUNE.md` §4.4 **갈래 ①(구조화 필드만)**·§4.5, `docs/plans/2026-10-19-e3-experiment-design.md` §5·§6 을 코드로 옮긴 것이다.
DB·네트워크를 쓰지 않는다. 실모델은 `bosun_score`(기본 backend `bosun`)만 로컬 패키지에서 올린다(회사 GPU 서버 안, 회사 측 실행).
`services/ai` uv 프로젝트의 workspace 멤버(`services/ai/eval/pyproject.toml`)라 같은 가상환경에서 돈다.

```bash
cd services/ai
uv run python -m sol_eval labels check ../../fixtures/eval/labels/fixture.v0.1.jsonl
uv run python -m sol_eval build --as-of 2026-10-19            # → datasets/sol-eval/v0.1/items.{train,dev,test}.jsonl + build-report.json
uv run python -m sol_eval export --format bosun               # → datasets/sol-eval/v0.1/bosun/{split}.en.jsonl + index + export-report.json + manifest.json
uv run python -m sol_eval leakage --bundle datasets/sol-eval/v0.1          # 누수 검사. 위반이면 exit 1 + JSON 리포트
uv run python -m sol_eval export                              # (Kev 형식, 퇴역 경로 보존) → kev/{split}.{en,ko}.jsonl + export-report.json
uv run python -m sol_eval manifest                            # (Kev 형식 번들의 manifest.json. bosun 형식은 export 가 manifest 를 직접 쓴다)
# 회사 서버 안(오프라인 채점, 22 §4.4). 모델은 한 번에 하나씩
python -m sol_eval bosun_score --package runs/bosun-sol-lora-v0.1 --data sol-dataset-v0.1/bosun/test.en.jsonl --seeds 0-5 --out runs/e4-test
python -m sol_eval bosun_score --package "$snap"                  --data sol-dataset-v0.1/bosun/test.en.jsonl --seeds 0-5 --out runs/e1p-test
# 노트북(출력 폴더를 돌려받은 뒤)
uv run python -m sol_eval compare --candidate runs/e4-test --reference runs/e1p-test --out runs/e4-vs-e1p
```

상대 경로는 cwd 기준으로 있으면 그것을, 없으면 저장소 루트 기준으로 푼다. 산출 폴더 `datasets/` 는 gitignore 다(21 §3.1).
실제 공고의 인용 텍스트·첨부 원문은 어느 산출물에도 들어가지 않는다(구조화 필드 값과 공고 제목만).

## 명령

| 명령 | 입력 | 출력 | 실패 |
|---|---|---|---|
| `labels check <file>` | EvalItem JSONL(축소판 가능) | 요약(라벨 출처·초안 출처·qid 묶음별 값 비율)과 `PROBLEM …` 줄 | 문제가 있으면 exit 1 |
| `build --as-of YYYY-MM-DD [--recorded DIR] [--industry DIR] [--companies DIR] [--company-file F] [--splits F \| --derive-splits] [--holdout-company 06] [--max-train-records N] [--include-missing-license-rows] [--version v0.1] [--out DIR]` | 녹음 응답·업종 마스터·원형·분할 | `items.{split}.jsonl`, `build-report.json`, (유도 분할이면 `splits.derived.json`) | 입력 형식 오류 exit 2 |
| `export --format bosun [--version] [--out]` | `items.*.jsonl` | `bosun/{split}.en.jsonl`(한 줄 = 질문 하나, 15 §4.1), `bosun/{split}.en.index.jsonl`(rowId→itemId·qid·clusterId·companyId·stateHash), `export-report.json`, `manifest.json`. `kev/` 는 만들지 않는다 | 같은 (stateHash, qid) 다른 gold, 변형끼리 같은 state, en 한글 → exit 2 |
| `export [--languages en,ko] [--max-state 2048] [--version] [--out]` | `items.*.jsonl` | (Kev 형식, 기본값·퇴역 경로 보존) `kev/{split}.{lang}.jsonl`, `kev/{split}.{lang}.index.jsonl`(stateHash→itemIds), `export-report.json` | 같은 state 다른 라벨, 변형끼리 같은 state, en 한글 → exit 2 |
| `manifest [--version] [--out]` | `build-report.json`·`export-report.json`·`items.*.jsonl` | (Kev 형식 번들만) `manifest.json`. bosun 번들 뒤에 돌리면 bosun manifest 를 덮어쓰니 돌리지 않는다 | 누수(test·dev 클러스터/공고가 train 에, 홀드아웃 원형이 test 밖에) → exit 2 |
| `leakage --bundle <dir> [--similarity 0.9] [--fail-on-similarity] [--min-share 0.05] [--out report.json]` | `bosun/*.en.jsonl`·index·`manifest.json` | JSON 리포트(`checks`·`violations`·`warnings`) | 위반이 있으면 exit 1, 입력 형식 오류 exit 2 |
| `bosun_score --package <dir> --data bosun/{split}.en.jsonl --out <dir> [--seeds 0-5] [--backend bosun\|fake]` <br> `bosun_score --package <dir> --suite <jsonl> --suite-format decisionbench --out <dir>` | Bosun 패키지(HF 레이아웃)·레코드 JSONL | `predictions.jsonl`(rowId·qid·seed·probabilities[]·argmax), `rows.json`(gold·예측 요약·seed 별 분포), `report.json`(패키지 경로·`manifest.json` sha256·가중치 sha256·데이터 sha256·seed 목록·환경·지표) | 입력 형식 오류·패키지 없음 exit 2 |
| `compare --candidate <run> --reference <run> --out <dir> [--seed 0] [--iterations 2000] [--bootstrap-seed 0]` | 두 `bosun_score` 출력 폴더 | `report.json`(Δ Macro-F1·Accuracy·NEEDS_REVIEW recall·ECE 와 95% CI, 클러스터 단위 1차·레코드 단위 참고, `improvementClaimable`) | rowId 집합·데이터 sha256 불일치 exit 2 |

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

## Bosun 레코드 (`export --format bosun`, 15 §4.1)

한 줄 = 질문 하나. 필드는 15 §4.1 표 순서 그대로: `rowId=sha256(itemId+":"+qid)`, `itemId`·`clusterId`·`split`·`bid{source,noticeId,revisionId}`·
`companyVariantId`, `qid`·`questionType`, `instructions`(v0.2.json 원문. req 틀은 서빙과 같이 `{itemId}` 만 바꾼다), `candidates[]`, `state`(서빙 빌더의
`en.v0.2` 문자열 그대로)·`stateHash`·`stateTemplate:"en.v0.2"`·`questionSet:"kev-qs/v0.2"`, `gold{candidateId, probabilities[]}`(one-hot 또는 `Label.target` soft),
`labelSource`·`reason`·`noticeEvidence`·`companyEvidence`.

| 타입 | candidates | gold |
|---|---|---|
| choice | criteria 키 순서 `{id:key, label:key, description:criteria[key]}` | one-hot / soft |
| score | `{id:"0".."4", label:legend[i]}` | one-hot(사람 라벨만) |
| noul | `{id:"true", label:"true", description: criteria.true 또는 "yes"}`, `{id:"false", …, "no"}` | true → `[1,0]` |

제외 규칙(22 §4.1 표. `export-report.json`·`manifest.json` 의 `excluded` 에 사유별 건수): v0.1 4문항(`recommendation`·`fit`·`mandatoryRisk`·`needsHumanReview`)은
레코드를 만들지 않는다(`v01Question`), `RULE_SILVER` 는 train 만(`ruleSilverOutsideTrain`), `techFit`·`perfRelevance` 는 `HUMAN` 만(`scoreNotHuman`),
`risk.*` 는 `CONSTRUCTED` 만(`riskNotConstructed`), state 에 `[itemId]` 표시가 없는 `req.*`(`noStateMarker`).
단언: 같은 `(stateHash, qid)` 에 다른 gold 가 붙으면 export 실패(명확한 오류). 같은 gold 면 첫 행만 남긴다(`mergedDuplicateRows`).
변형끼리 state 가 같거나 en state 에 한글이 있어도 실패한다. **state 에는 공고 제목이 없다**. 구조화 필드가 같은 두 공고는 같은 state 가 되므로
분할을 넘는 같은 state 는 `leakage` ④ 가 잡는다.

`bosun/{split}.en.index.jsonl` 은 `rowId → itemId` 색인(+`qid`·`clusterId`·`companyId`·`stateHash`, state 원문 없음)이다. `leakage` 가 held-out 원형 검사에
`companyId` 를 쓴다(레코드 본문은 15 §4.1 표에 없는 필드를 더하지 않는다).

## 번들 구조 (`datasets/sol-eval/<version>/`)

```
items.train.jsonl · items.dev.jsonl · items.test.jsonl   # EvalItem(21 §3.7 + translations·attachmentsIncomplete)
bosun/{train,dev,test}.en.jsonl                          # Bosun 질문 단위 레코드(학습·E1'·E4). --format bosun
bosun/{split}.en.index.jsonl                             # rowId → itemId·qid·clusterId·companyId·stateHash
kev/{train,dev,test}.{en,ko}.jsonl · kev/*.index.jsonl    # (Kev 형식일 때만. bosun 번들에는 없다)
build-report.json · export-report.json · manifest.json   # 수치·경고·sha256·누수 확인
splits.derived.json                                      # 유도 분할일 때만
```

bosun `manifest.json`(`sol-bosun-manifest/v0.1`): 데이터셋 버전, git commit, 질문 세트·state 템플릿 sha256, 분할별 레코드·item·라벨·클러스터·제외 건수,
qid 가족별·후보별 분포(`count`·`share`. 5% 미만은 `warnings`), `companiesBySplit`·`heldOutCompanies`(train 에 없는 companyId), `leakCheck.clusterOverlap`
(train∩dev·train∩test·dev∩test·train∩(dev∪test). 0 이어야 한다), state 토큰 최대값(글자/4 근사, `tokenizerComputed=false`), 파일별 sha256.
Kev 형식 번들의 manifest 는 `manifest` 명령이 쓴다(`sol-dataset-manifest/v0.1`). tar 로 묶는 것은 B3 요청서 몫이다.

## 누수 검사 (`leakage`)

| # | 검사 | 판정 |
|---|---|---|
| ① | 클러스터 교차 train∩dev·train∩test·dev∩test | 0 아니면 위반 |
| ② | fixture 유래(`itemId`·`bid.noticeId` 에 `FX-01`~`FX-20`, `bid.source=fixture`) | 있으면 위반 |
| ③ | `manifest.heldOutCompanies` 가 train index 의 `companyId` 에 있음 | 있으면 위반. 비어 있으면 경고 |
| ④ | 같은 `stateHash` 가 다른 분할에 있음 | 있으면 위반 |
| ⑤ | 유사 state: 정규화(소문자·구두점 제거) 단어 5-gram Jaccard ≥ `--similarity`(기본 0.9) 가 분할을 넘음 | 경고. `--fail-on-similarity` 면 위반 |
| ⑥ | 분할별 qid 가족·후보 정답 비율 ≥ `--min-share`(기본 5%) | train 은 위반, dev·test 는 경고(표본이 작아 희소 후보가 흔하다) |
| ⑦ | `manifest.files` sha256 과 파일 일치, `bosun/*.jsonl` 전부 등록 | 불일치·누락·미등록이면 위반 |

임계 0.9 는 21 §3.6 의 MinHash 병합 기준 0.8 보다 보수적으로 잡은 출발값이다. 근거 데이터가 없어 실측 뒤 조정한다(미해결).

## 오프라인 채점 (`bosun_score`) 과 비교 (`compare`)

- 백엔드 `bosun`(기본): `AutoModelForCausalLM.from_pretrained(package, trust_remote_code=True, local_files_only=True)` 뒤 Bosun 공개 API
  `model.predict(state=, instructions=, candidates=, decision_type=, seed=, row_id=)["probabilities"]`(후보 순서 리스트). torch·transformers 는 이 백엔드에서만
  지연 import 한다. **실모델 경로는 미검증(2026-10-20)** — `candidates` 에 `{id,label,description}` 목록을 그대로 넘기는 것과 `decision_type` 이 `questionType`
  (`choice`·`score`·`noul`)과 같다는 것은 가정이다(`DECISION_TYPE_BY_QUESTION_TYPE` 한 곳). B2 에서 패키지로 smoke 한다.
- 백엔드 `fake`: `sha256(rowId:seed)` 로 만드는 결정적 분포. 모델이 아니다. 파일 모양·지표 계산 시험에만 쓴다.
- 지표(21 §4.3, `report.json.metrics`): 기본 seed 0(서빙과 같다)으로 전체·qid 가족별·타입별 Accuracy·Macro-F1·Brier·ECE(10 구간)·NLL,
  `req.*` 는 `NEEDS_REVIEW` recall·NEEDS_REVIEW→NOT_SATISFIED·NOT_SATISFIED→NEEDS_REVIEW 혼동률, score 는 기대값 MAE, noul 은 Brier·정확도(P(true) ≥ 0.5).
  seed 별 지표(`bySeed`)와 seed 간 `argmaxStable`·`spreadMean`·`spreadMax`(최대 확률의 모표준편차). argmax 동률은 후보 순서의 뒤쪽을 고른다
  (req 후보 순서에서 서빙의 NEEDS_REVIEW > NOT_SATISFIED > SATISFIED 와 같다). Macro-F1 은 gold·예측에 한 번도 없는 후보를 평균에서 뺀다.
- `--suite <jsonl> --suite-format decisionbench`: 보조 회귀 평가 입력 자리(ADR-034 9번). 행 `instruction`·`state_json`·`candidates_json`·`gold_candidate_id`
  (+선택 `id`·`decision_type`·`cluster_id`)를 같은 predict 경로로 채점한다. **DecisionBench 는 라이선스(`other`)·우리 데이터와의 중복·재배포 조건을 확인한 뒤 별도 승인으로만
  실행한다.** 저장소에는 가짜 행 3개 시험만 있다.
- `compare`: 두 run 이 같은 rowId 집합·같은 데이터 sha256 이어야 한다. 클러스터 단위 paired bootstrap(기본 2,000회, `--bootstrap-seed 0`)으로
  Δ Macro-F1·Accuracy·NEEDS_REVIEW recall·ECE 와 95% CI 를 내고(1차), 레코드 단위 CI 를 참고로 함께 적는다. CI 가 0 을 포함하거나 Δ 가 나쁜 방향이면
  `improvementClaimable=false`("개선 주장 불가"). 1차 판정 지표는 Macro-F1. 클러스터가 적으면(해커톤 test 20) 구간이 넓다 — 탐색적 결과로 보고한다.

### 금지

- 회사 서버의 `datasets/decision/smoke.jsonl` 6건은 기능 검증 데이터다. `bosun_score` 의 성능 평가 입력으로 쓰지 않는다(ADR-034 7번).
- dev 분할만으로 "Bosun 의 일반 Decision 능력이 망각되지 않았다"고 주장하지 않는다. `report.json.notes` 에 같은 문장을 적는다(ADR-034 9번).
- test 로 온도를 맞추지 않는다(보정은 dev `rows.json` 으로, 22 §4.4). E4 는 E1' 과 같은 데이터 sha256·seed 집합에서만 비교한다.

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
8. **Bosun 레코드의 `RULE_SILVER` 처리**: Kev 형식은 train 밖 `RULE_SILVER` 를 오류로 막지만, bosun 형식은 22 §4.1 "제외 규칙" 대로 조용히 빼고 `excluded.ruleSilverOutsideTrain` 에 센다.
9. **bosun 번들 manifest 는 export 가 쓴다**: `build-report.json` 이 없어도 돌아가게 held-out 원형을 items 에서 유도한다(train 에 없는 companyId). `manifest` 명령은 Kev 번들 전용으로 남는다.
10. **`leakage` ⑥ 의 분할별 판정**(train 위반·dev/test 경고)과 **⑤ 임계 0.9** 는 제안이다. 실측 뒤 조정한다.
