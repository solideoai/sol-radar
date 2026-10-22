# F09 — 시간 경과로 생기는 외부 공고 Revision 제거

## 기준과 작업 경계

- 브랜치 `fix/f09-time-independent-revisions`, 시작 HEAD/로컬 origin/main `9b21ced8d76ea33ecb9646464d611bfdda2b27e0`.
- `gh pr view 11 --json number,state,mergeCommit,mergedAt,url`: `MERGED`, mergeCommit `9b21ced8d76ea33ecb9646464d611bfdda2b27e0`, mergedAt `2026-10-22T10:26:21Z`. [PR #11](https://github.com/gwanghui97/sol-radar/pull/11).
- 실제 계획 문서의 F09/P0-C와 F08 최초 구현 증거를 읽었다. 반영된 F08 예약·HTTP hook·Lua 구현은 수정하지 않았다.
- 기존 격리 worktree의 detached HEAD에서 기능 브랜치만 만들었다. 기존 미추적 F08 출력 3개와 계획 문서 1개는 SHA-256 대조로 보존했고 인덱스는 비어 있다. main worktree는 수정하지 않았다.
- 실제 외부 API·운영 Redis/Supabase·Worker·Docker·AI 서비스에 접속하거나 변경하지 않았다. GitHub 조회는 병합 상태를 읽는 작업뿐이다. 커밋·push·PR 생성·merge는 하지 않았다.

## 원인과 수정 전 재현

`external-normalize.ts`의 `participation()`은 공식 날짜와 `context.fetchedAt`으로 `sourceMetadata.participationStatus`를 계산한다. 동일 합성 KEPCO 원본을 KST 08:59와 09:01에 정규화하면 `NOT_STARTED`에서 `APPLICATION_OPEN`으로 바뀐다. 기존 checksum은 최상위 `fetchedAt`만 제외하고 중첩 파생 상태는 포함했다. `decideRevision()`이 새 checksum으로 판단하는 한편 `diffRevisions()`는 sourceMetadata를 보지 않아 `CHANGED / changes=[]`가 발생했다. 공식 신청 마감·원문 금액·사업 장소 변경도 hash에는 반영되지만 변경 상세가 비었다.

기존 revision/idempotent/external-adapter/external-ingestion 4개 파일 78개 테스트는 통과했다. 새 단위 회귀 8개 중 7개가 실제 결함으로 실패했다. 최초 통합 fixture는 필수 capture가 빠져 기존 원본 증거 방어에서 거절되어 제품 코드 수정 전에 보완했다. 보완한 fixture로 아래 명령을 다시 실행해 결함에 의한 실패를 확인했다(exit 1).

```sh
pnpm -C web exec vitest run server/ingestion/external-revision.test.ts server/ingestion/external-ingestion.test.ts
```

```text
external-revision.test.ts (8 tests | 7 failed)
external-ingestion.test.ts (6 tests | 1 failed)
Test Files  2 failed (2)
Tests  8 failed | 6 passed (14)
```

- A: 기대 `DUPLICATE / revision 3`, 실제 `CHANGED / revision 4 / changes=[]`.
- B: 공급자 OPEN 내 공식 상태, 신청 마감, 원문 금액, 장소를 각각 변경했을 때 `CHANGED`이나 전후 근거가 없었다.
- C: 구 v0.3 hash를 가진 revision 7도 시간이 지나면 revision 8을 만들었다. 동일 시각 재수집은 기존 코드에서도 통과했다.
- 통합: 두 번째 수집에서 기대 `changed:0, skippedDuplicate:1`, 실제 `changed:1, skippedDuplicate:0`.

## 새 규칙과 기존 저장 데이터 호환성

1. **v0.2 불변:** canonical JSON·최상위 fetchedAt/checksum 제외·revision 번호 포함 규칙과 저장 checksum 대조를 유지한다. 변경 전 알고리즘으로 별도 계산한 fixture FX-09와 G2B v0.2 checksum 고정값도 테스트한다. 기존 golden을 수정하지 않았다.
2. **v0.3:** 추가로 sourceMetadata의 participationStatus만 제외한다. 공식 providerStatus/providerEvent, 날짜 raw/precision/utc, 원문 금액/단위/VAT, ID namespace와 사업 속성은 계속 hash에 포함한다. 사업 변경을 무시하거나 CHANGED를 강제로 DUPLICATE로 바꾸지 않는다.
3. **기존 v0.3 행:** 이전 normalized 스냅샷을 같은 새 규칙으로 메모리에서 재계산해 같은 revision 번호의 새 후보와 비교한다. 구 hash와 신 hash의 정책 차이만으로 Revision을 만들지 않는다. 이전 checksum/원문/normalized/revision 번호를 덮어쓰거나 backfill하지 않는다. 실제 변경은 revision+1, 새 정책 hash로 저장하며 이후 재수집은 중복이다.
4. **변경 근거:** 기존 `{field,before,after}` 구조에 v0.3의 `field:"sourceMetadata"`를 사용한다. 전후 값은 checksum과 같은 projection이므로 파생 참여 상태가 변경 사유에 섞이지 않는다. v0.2 TRACKED_FIELDS 목록과 diff는 유지한다.
5. **저장·조회:** schemaVersion·NormalizedBid JSON 구조·StoredRevision·RPC 인자·DB 스키마는 불변이다. 실제 `toStoredRevision()`으로 구 스냅샷을 읽고 `toSaveRevisionParams()`의 normalized/raw_payload/changed_fields 및 이벤트 changedFields를 검증한다. 기존 bids revision 호환성 시험도 통과한다. SQL changed_fields는 기존 text[]여서 migration이 필요 없다.

## 참여 상태의 조회 경계

저장된 participationStatus는 fetchedAt 당시 스냅샷이다. 중복 공고는 저장을 생략하므로 이 값은 현재 상태로 갱신되지 않는다. 코드 검색상 제품에서 이 값을 소비하는 계산/화면은 없으며 normalizer와 schema에만 있다. 이를 현재 참여 가능 여부의 판단 근거로 새로 사용하면 안 된다.

향후 현재 상태를 제공할 때는 공식 providerStatus, dates의 확인된 정밀도, 조회 시각을 받아 순수 계산하고 응답에서 별도로 제공한다. revision hash/저장/이벤트와 연결하지 않는다. 기존 participation()의 공식 종료 상태 우선·DATE 제외·신청 마감 후 UNKNOWN 규칙을 유지해야 한다. 이번에는 조회 API에 이 계산을 추가하지 않았다. 기존 bids 비교 화면은 알려진 표시 필드만 렌더링하므로 sourceMetadata 전용 표시는 미구현이다. 수집 판단 changes의 전후 값과 저장/이벤트의 changed_fields에는 근거가 남는다.

## 검증 명령과 결과

신규 테스트 총 11개: 외부 revision 9개, 수집 통합 1개, fixture checksum 고정값 1개.

```sh
pnpm -C web exec vitest run server/ingestion/external-revision.test.ts server/ingestion/external-ingestion.test.ts server/ingestion/revision-diff.test.ts server/ingestion/idempotent-upsert.test.ts server/ingestion/external-adapters.test.ts server/bids/revision-compatibility.test.ts
```

```text
Test Files  6 passed (6)
Tests  91 passed (91)
```

시간 경과 시 저장 revision 1개/BID_CREATED 1개가 유지되고, 실제 장소 변경 시 revision 2와 근거가 있는 BID_CHANGED 1개가 추가됨을 메모리 저장소로 확인했다. 네트워크 transport는 사용하지 않았다. 원문과 입력 draft 불변, 구 v0.3 행 비변경, 실제 변경 후 새 hash 재수집 중복도 검증한다.

```sh
pnpm verify:changed --base origin/main
```

첫 정적 검사에서는 hash 입력 객체의 추론 타입에 projection 반환값 unknown을 대입하는 TS2322가 발생했다. 입력을 `Record<string, unknown>`으로 명시해 JSON 입력과 완전한 NormalizedBid 모델을 구분한 뒤 전체 검사를 통과했다. 최종 결과:

```text
Prettier: all matched files use Prettier code style
TypeScript: next typegen && tsc --noEmit, exit 0
ESLint / lint guards: exit 0
Test Files  59 passed (59)
Tests  501 passed (501)
Lodestar: 2 rules passed, 0 errors, 0 warnings
tokens / colors: exit 0
web: pnpm verify:quick, exit 0
```

전체 웹 시험에 기존 나라장터·fixture/mock·Revision·API 계약·worked-examples golden 회귀가 포함된다. 프로덕션 빌드·브라우저 E2E·실제 DB/Redis 검증은 이번에 실행하지 않았다. 운영 실행 결과로 해석하지 않는다.

## 수정 파일

- `web/server/ingestion/checksum.ts`: v0.3 시간 파생 상태 제외 projection.
- `web/server/ingestion/revision.ts`: 구 v0.3 비교와 공급자 변경 근거.
- `web/server/ingestion/normalized-bid.model.ts`: 참여 상태의 스냅샷 의미 주석.
- `web/server/ingestion/external-revision.test.ts`: A/B/C 및 G2B checksum·RPC 호환성.
- `web/server/ingestion/external-ingestion.test.ts`: 시간 경과 시 저장·이벤트 없음, 실제 변경 저장.
- `web/server/ingestion/revision-diff.test.ts`: v0.2 fixture checksum 고정값.
- `docs/15-DATA-CONTRACTS.md`: v0.3 예외·저장 호환성·조회 경계.
- `docs/PROGRESS.md`: F09 작업 로그.
- 이 증거 문서.

## 남은 위험과 운영 적용 전 주의

- 새/옛 checksum 정책 수집기를 혼합하면 옛 코드가 새 hash를 보고 가짜 Revision을 다시 만들 수 있다. 옛 수집기를 모두 멈추고 같은 버전으로 교체해야 한다. 이번에는 배포하지 않았다. 구 코드로 rollback할 때도 같은 주의가 필요하다.
- 기존 가짜 Revision/이벤트는 삭제하지 않는다. 저장 hash는 기존 정책 값일 수 있으므로 직접 검증하는 외부 도구도 위 호환 비교 규칙을 따라야 한다.
- DATE/MONTH 정밀도(F10), KEPCO 부분 수집(F06), F07/F13/F14, 신규 API 6종 실검증·활성화는 미수정이다. 단위/VAT 미검증 금액의 budgetKrw=null, 공식 상태/날짜/namespace 정책을 유지한다.

## 후속 커밋 전 재검토 (2026-10-22, 사용자 추가 요청)

위의 커밋 미수행 기록은 최초 구현 종료 시점이다. 이번 후속 요청에서는 F09의 로컬 커밋만 승인되었으며 push·PR·merge·운영 접속/변경은 계속 금지한다.

- 시작 브랜치/HEAD는 위 기록과 같고 인덱스는 비어 있었다. 다른 작업자의 스테이징 변경은 없었다. 기존 미추적 출력 3개와 계획 문서의 SHA-256을 다시 대조해 보존했다.
- 독립 읽기 전용 코드 리뷰에서 커밋을 막을 결함은 발견하지 못했다. v0.3 파생 상태만 제외, 실제 공급자 변경과 근거 유지, 기존 저장 행 비변경, v0.2 hash/RPC/DB 호환성을 확인했다. 조회 시점 참여 상태와 전용 UI 확장은 기존 미구현 범위 그대로다.
- F09 관련 6개 파일 91개 테스트를 재실행해 통과했다. `pnpm verify:changed --base origin/main`도 재실행해 웹 59개 파일 501개 테스트·타입·린트·서식·아키텍처 검사를 통과했다.
- 커밋 범위는 위 수정 목록의 9개 파일뿐이며 계획 문서와 기존 미추적 F08 출력은 제외한다. 메시지 첫 줄은 `fix(ingestion): stabilize external revisions`로 정했다. 기존 커밋 훅과 메시지 검사를 우회하지 않는다.
- `git ls-remote origin refs/heads/main`은 기준점과 같은 `9b21ced8d76ea33ecb9646464d611bfdda2b27e0`이었다. 이 조회 시점에는 main 분기가 없어 확인된 텍스트 충돌이 없으며, 향후 PR 생성 전에 최신 main을 다시 확인해야 한다.
