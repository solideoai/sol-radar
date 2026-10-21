---
title: "가상 직원200명 전체 속성 확장과 클라우드 적용 검증"
doc: "evidence-all-people-capabilities"
status: final
tags:
  - sol-radar
  - test
  - db
updated: 2026-10-21
---

# 가상 직원200명 전체 속성 확장과 클라우드 적용 검증

사용자 요청에 따라 가상 직원200명 전원의 기술·자격증·개인 실적·가용성을 생성하고, 기존 점수 검증도200명 전체로 확장했다. Supabase 클라우드에 `20261021000600_enrich_all_demo_people.sql`을 적용하고 실제 데이터·점수 함수·보존 지문을 대조했다. 기준 HEAD는 `086ac1e`이며 변경은 작업 폴더에 있고 커밋은 하지 않았다.

## 데이터와 저장 구조

- `fixtures/people/solideo.people.json`: 계산 대상200명, 자격증200건, 개인 실적401건. 기술·가용성 누락0명.
- `scripts/people/capabilities.mjs`: 고정 직원ID를 입력으로 재현 가능한 가상 프로필을 생성한다. 실제 이름·성별·직위·사진에서 능력을 추론하지 않는다.
- 기존200명의 신원·소속·직급·사진, 기존27명의 role·grade·skills·availability와 배정7건을 보존했다.
- `team_member_scoring`: `certifications`, `past_projects`, `capability_source`, `capability_version`을 추가했다. 새 표나 RLS 우회 경로는 만들지 않았다.
- 자격증·실적에는 `isDemo=true`·`synthetic:` 증거 참조가 있고 출처는 `SYNTHETIC`, 버전은 `synthetic-people/v1`이다.
- 인력 상세 API가 추가 속성을 반환하며 목록의 계산 대상 수는200명이다. 로컬 seed도 같은200명 속성을 저장한다.

가용성은 fixture에서 배정 전 용량이며, seed·클라우드 보강은 기존7건을 availability에 한 번 접는다. DB의 별도 데모 배정2건은 기존대로 남는다. 2026-12-01 이상2027-07-01 미만의 보장 가용 합은95.5 FTE다. 고정 직원ID·이름·사진에 대한 승인 바인딩은 변경하지 않았다.

## 점수와 회귀 검증

산식은 바꾸지 않고 입력과 검증을200명 전체로 넓혔다. FX-01/02/03의94/72/68점은 인력 요소가 포화되어 유지된다. FX-15는 가용 인력 증가에 따라 인력10→20점, 총점58→68(WATCH)로 바뀌었다. 비활성 인력 제외, 기간 경계·겹침, 가용성 감소 시 비포화 점수 변화, 입력 스냅샷의 신원 제외·복사 격리 검증도 유지했다.

최종 `pnpm verify` exit0:

| 영역 | 결과 |
|---|---|
| 루트 | 770 PASS, 실패0 |
| 웹 | 219파일·6,830 PASS, 타입·린트·구조·프로덕션 빌드 PASS |
| AI | 1,511 PASS |
| 결정 모델 | 152 PASS |
| 생성물·서식 | DB 타입·토큰·색·서식 PASS |

독립 테스트 담당이200명 기준 기대값과 API·seed·가용성 검증을 갱신했고 독립 코드 리뷰를 수행했다. 잘못된 직원ID가 구조화 오류 대신 예외를 던지는 문제는 실패→수정→통과 회귀를 추가했다. 초기 전체 검증에서 발견한 마이그레이션 재실행 제약 충돌과 오래된27명 seed 기대값을 고친 뒤 전체 검증을 다시 실행했다. 최초 실패 로그도 보존했다. Python 시험에는 기존 Starlette 사용 중단 예정 경고가 각1건 있다.

실제 브라우저·인증 E2E 전체와 회사 GPU 학습은 실행하지 않았다. E2E의200명·추가 속성 계약은 갱신했고 웹 타입 검사를 통과했다.

## 클라우드 적용과 사후 확인

요청에서 클라우드 `db:push`가 명시적으로 승인됐다. 연결은 TLS 검증을 유지하고 [Supabase 공식 CA](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt)를 `NODE_EXTRA_CA_CERTS`로 제공했다. CA SHA-256 지문은 `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`다.

1. `pnpm db:push --check`: 기존30개 적용, 미적용은 이번 파일1개뿐이었다.
2. `pnpm db:push`: 이번 파일 적용, exit0.
3. `pnpm db:verify`: 연결·마이그레이션31개·RLS·화면 역할 권한·뷰·함수 확인, exit0.
4. 읽기 전용 조회: 대상 조직200행 전체의 role·grade·skills·certifications·past_projects·접힌availability·출처·버전이 fixture와 정확히 일치했다.
5. 실제 `web/server/scoring/scoring.model.ts`의 `availableFte`를 클라우드200명·DB 배정2건으로 호출해95.5 FTE를 확인했다.
6. 적용 전후 지문이 동일했다: 직원200명, Auth 사용자5개, 프로필5개, 기존 `score_runs`18건. 타 조직 점수 행0건도 그대로다. 별도 PGlite 시험에서는 같은person_code를 가진 외부 조직의 실제 행을 추가하고 그 행이 보존되는지 검증했다.

기존 저장된18개 분석의 입력 스냅샷을 덮어쓰지 않았다. 새 분석은 현재200명 데이터를 읽는다.

## 증거 파일

- [최종 전체 검증](20261021-all-people-verify.txt)
- [최초 실패 기록](20261021-all-people-verify-initial.txt)
- [적용 사전 확인](20261021-all-people-db-push-check.txt)
- [클라우드 적용](20261021-all-people-db-push.txt)
- [클라우드 DB 검증](20261021-all-people-db-verify.txt)
- [적용 전 지문](20261021-all-people-cloud-before.json)
- [적용 후200행·실제 점수 함수·보존 지문](20261021-all-people-cloud-after.json)

## 관련 문서

- [[16-DECISIONS|ADR-043]]
- [[04-DATABASE|인력 저장 구조]]
- [[08-SCORING|200명 점수 입력]]
- [[BOSUN_FINETUNING_GPT_HANDOFF|갱신한 GPT 전달 자료]]
- [[PROGRESS|진행 상황]]
