---
title: "첫 구현 묶음 — 운영 DB·Storage·Vercel 적용"
status: partial
updated: 2026-10-22
---

# 운영 적용 결과

사용자가 push와 운영 DB·서버 적용을 명시적으로 승인했다. 기존 [적용 계획](20261021-release-plan.md)에 따라 추가형 마이그레이션과 private Storage를 적용하고 Vercel 운영 배포를 완료했다. **회사 Gateway/Worker는 접속 경로가 없어 미적용이며, 통합 readiness는 아직 503이다.**

## 배포 소스와 검증

- `origin/main`: `1432aa9` push 후 Qwen 실제 served model ID 정정 `31d6d11`과 업로드 제외 규칙을 포함한 `3fded9990f56fb311be37ee39a558f5f7cb466f0`까지 push했다.
- `3fded99`에서 전체 `pnpm verify` 종료 코드 0: 루트183 + 웹365 + AI101 + decision57 = **706개**. 타입·린트·계층·생성물 검사와 Next.js 빌드 포함. 다른 작업의 미커밋 변경은 배포에 포함하지 않았다.
- 같은 커밋의 [GitHub CI](https://github.com/gwanghui97/sol-radar/actions/runs/39623895645)도 common·web·AI·decision·audit·커밋 형식·required 모두 성공했다.
- `.vercelignore` 추가 전 CLI dry-run은 `.superpowers/` 내부 작업 기록과 로컬 운영 파일을 업로드 대상으로 포함했다. 실제 업로드 전에 제외 규칙을 추가했다. 변경 후 dry-run에서 비밀·작업 기록 파일 0개, `vercel.json`·web·AI·run modes·fixture 입력 보존을 확인했다. 이것이 이번 설정 수정의 재현·확인 근거다.
- [predeploy-review](../../../.claude/skills/predeploy-review/SKILL.md)의 code·infra 기준을 적용했다. 로컬 묶음의 독립 리뷰에서 지적된 삭제 경합 보강은00702에 포함돼 있다. 이번 업로드 대상 문제는 배포 전에 해결했다. 회사 runtime 연결은 아래 미완료 항목으로 남긴다.

## 운영 DB

대상은 `brtysdocxemrqhdezzqg.supabase.co`다. 기존 CA를 통한 TLS 인증서 검증을 유지했다. 사전 확인에서 예상한 세 파일만 미적용이었다.

1. `20261021000700_document_storage.sql`
2. `20261021000701_document_storage_access.sql`
3. `20261021000702_document_storage_incarnations.sql`

세 파일의 `pnpm db:push`가 성공했고, `pnpm db:verify`가 이력34개·RLS·화면 역할 권한·뷰·함수를 확인했다. 기존00600 인력 보강은 재적재하지 않았다. 전후 행 수와 기존 열의 정렬된 JSON 지문을 비교했다.

| 보존 대상 | 전후 행 수 | 기존 값 일치 |
|---|---:|---|
| Auth 사용자 | 5 | 일치(id·email) |
| profiles | 5 | 일치 |
| team_members | 200 | 일치 |
| team_member_scoring | 200 | 일치 |
| score_runs | 18 | 일치 |
| bid_documents | 18 | 일치(추가 열 제외) |

## Supabase Storage

`ensure-storage-buckets.mjs --apply --smoke --large`로 `bid-documents`·`bid-parsed`를 생성했다. 두 버킷 모두 **private·50MiB**, 소유 marker와 MIME 제한을 설정했다. 각각52,428,800바이트 업로드·다운로드 byte 비교·삭제가 성공했다.

실제 VIEWER JWT로 두 버킷의 미참조 파일 읽기·소유 marker 읽기·쓰기 거부, anon 읽기 거부를 확인했다. 서비스 자격의 signed URL 다운로드와 별도1초 URL의 만료 거부도 확인했다. 다운로드 확인에는60초 URL을 썼다. 처음1초 URL로 즉시 다운로드를 검사했을 때 네트워크 왕복이 만료 경계를 넘어 실패했으므로 다운로드와 만료 검사를 분리했다. CLI가 만든 smoke 파일은 정리했다.

기존 문서의 Storage 참조는0건이다. 실제 업무 문서의 사용자 signed URL 발급과 documents 소비자 처리를 완료했다고 주장하지 않는다.

## Vercel

- 프로젝트: `gwanghui97s-projects/sol-radar` (`prj_i1QhzEUmo98jdaNx829YIVEVTVug`).
- 프로젝트 root를 저장소 루트, framework를 `services`로 맞췄다. web/AI 각각의 빌드와 내부 `AI_GATEWAY_URL` 바인딩은 기존 `vercel.json`을 따른다. [공식 Services 설정](https://vercel.com/kb/guide/vercel-services)을 대조했다.
- 운영 환경은 `frontend`, `SOL_RUN_MODE=mock`, 회사 HTTPS Gateway 주소, 공유 service token, private 버킷 이름을 사용한다. 파인튜닝이나 live 모드 전환은 하지 않았다.
- Worker 전용 DB URI와 수집 키는 로컬 운영 원본 보존을 확인한 뒤 Vercel Production/Preview에서 제거했다. Vercel 프로젝트에 Redis TCP URL·DB URI·Storage service role·수집 키가 없음을 재확인했다. 값은 로그·문서에 기록하지 않았다.
- CLI 배포 [`dpl_FdYbW4HriSfVWT2HEC81ouauxhj6`](https://vercel.com/gwanghui97s-projects/sol-radar/FdYbW4HriSfVWT2HEC81ouauxhj6)는 **READY**이며 Next.js와 Python AI 빌드가 모두 성공했다. 최종 확인 시 운영 alias는 같은 커밋의 재배포 [`dpl_6ZZZyhgF17v8VQ1QZPjkjfE6jDTH`](https://vercel.com/gwanghui97s-projects/sol-radar/6ZZZyhgF17v8VQ1QZPjkjfE6jDTH)로 이동했다. API의 `gitCommitSha=3fded9990f56fb311be37ee39a558f5f7cb466f0`·Services 설정·web/AI 바인딩·READY를 대조해 같은 release임을 확인했다.
- 운영 주소: **https://www.solideos-radar.com**. apex는www로308 이동한다.
- 실제 VIEWER 로그인 → `/dashboard`, `/bids` 200, `/people` 200을 브라우저에서 확인했다. 인력 화면에 전체200명·점수 계산 대상200명이 표시된다.
- [인력 화면 증거](20261022-production-people.png)와 [운영 검증 요약](20261022-production-results.json)을 함께 보존했다.
- `/health/live` 200. `/health/ready` 503. 준비 상태의 의존성 unavailable은 회사 Gateway에 연결하지 못한 결과이며, 별도 DB 직접 검증은 위와 같이 성공했다.
- `/parse`·`/extract`·`/kev` GET은 Next의 `/[slug]` HTML 경로로 처리됐다. Python API로 공개 라우팅되지 않았다.

## 회사 서버 — 남은 작업과 필요한 접속 정보

`https://acropolissg.com/redis/health`는 이번 확인에서도502였다. `bim@acropolissg.com:22`는 접속 시간 초과였다. 로컬 SSH 별칭이 없고 Docker context는 로컬 Docker Desktop뿐이며, 저장소의 self-hosted GitHub runner도0개다. 기존 Redis·Nginx·MinIO·회사 모델 서버는 변경하지 않았다.

추가 승인이 아니라 **회사 내부에서 명령을 실행할 실제 경로**가 필요하다. SSH host/port·내부 터미널·runner 중 하나가 제공되면 기존 Redis의 network·인증·실행 중 Worker/AI gateway를 먼저 대조하고, 같은 release의 Gateway(loopback6380)와 Worker를 적용한다. 실제 정보 없이 Redis TCP URL이나 AI gateway 주소를 추정하지 않았다.

이어가기 위한 `gateway.env`·`worker.env`와 read-only `company-inventory.sh`를 main의 git 제외 경로 `.superpowers/sdd/2026-10-22-production/`에 보존했다. 환경 파일 권한은0600이고, 회사 Redis/AI 주소는 교체가 필요한 placeholder다. 비밀 파일은 Vercel 업로드에서 제외된다.

회사 적용 후 service token health, Worker Storage/AI 보고, 접수202 → DB polling → Worker 완료를 검증하고 통합 readiness를 확인해야 한다. 새 schema·bucket은 보존하며 기존 데이터를 reset/seed하거나 기존 Redis를 재생성하지 않는다.
