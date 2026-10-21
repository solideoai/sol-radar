---
title: "ADR-044·045 병합 조건과 지침 문안"
status: approved
updated: 2026-10-21
---

# Redis Gateway·Vercel 병합 조건

2026-10-21 사용자 추가 지시와 문서 검토 세션45의 조건을 기록한다. 병합 담당은3e이며 main 직접 병합·push는 하지 않는다. Gateway·Vercel은 해커톤 안에 완료한다. **10-24(토)22:00 freeze 전 `pnpm verify`와 선택 경로의 수용 시험이 green이어야 10-25 리허설에 포함한다.** 현재 Phase 1은 로컬 검증만 완료했다.

## 1. 3e에서 사용자가 승인할 지침 문안

> [!success] 승인
> 2026-10-21 사용자가 이 절의 문안을 승인했다(9a 창, 3e 세션 종료 뒤 게이트 대행). 루트 `CLAUDE.md`·`AGENTS.md`·`docs/CLAUDE.md`에 적용했다.

아래는 승인된 문안이다. 승인 전에는 루트 `CLAUDE.md`·`AGENTS.md`의 기술 스택 문장을 바꾸지 않았고, 승인 뒤 세 파일에 함께 적용했다. 승인 없이 MinIO를 현재 스택에서 삭제하거나 기본 배포 경로를 바꾸지 않는다.

공통 기술 스택 문안:

> 기술 스택은 Next.js16 + Supabase(Postgres·RLS·Auth) + Redis/BullMQ + MinIO + Qdrant + Python AI(Qwen3.8-Flash-Next·Bosun 결정 모델, `KEV_*`·`/kev` 호환 유지)다. 데모 기본 실행은 기존 Docker Compose다. ADR-044·045에 따라 Vercel frontend와 회사 Redis HTTPS Gateway를 env로 선택하는 경로를 해커톤 안에 완성한다. 회사 Redis6379는 유지하고 HTTP는127.0.0.1:6380에만 게시하며 기존 Nginx `/redis/`를 사용한다. Supabase Storage는 별도 전환 검증·승인 후 적용하고 그 전까지 MinIO를 유지한다. 상시 Worker·문서 처리·GPU 추론은 회사 서버에 둔다. API·Worker의 NestJS 이전은 해커톤 뒤다(ADR-028).

| 파일 | 추가 교체 문안 |
| --- | --- |
| 루트 `CLAUDE.md` §지침 우선순위1 | 위 공통 문안으로 기술 스택 문장을 교체한다. |
| 루트 `CLAUDE.md` §지침 우선순위3 | “템플릿의 Expo·EAS 전제는 적용하지 않는다. Vercel 배포는 SOL RADAR 정본 ADR-044·045와 검증된 env 선택 경로를 따른다. 데모 기본 Compose와 운영 변경 승인 원칙은 유지한다.” |
| `AGENTS.md` 첫 기술 스택 문장 | 위 공통 문안으로 교체한다. |
| `AGENTS.md`의 “Vercel 배포(배포처 미결정)는 템플릿 기준” | “웹 배포처는 Vercel로 결정했다(ADR-044·045). 데모 기본은 Compose이며 검증된 새 경로는 env로 선택한다. 실제 배포·운영 변경은 별도 사용자 승인을 받는다.” |
| `docs/CLAUDE.md` 기술 스택 첫 항목 | 위 공통 문안을 적용한다. |
| `docs/CLAUDE.md`의 “Supabase가 맡는 것은 DB와 Auth뿐” | “현재 Supabase는 DB·Auth를 맡는다. 파일은 현행 MinIO를 유지하며 Supabase Storage 전환은 별도 단계의 검증·승인 뒤 적용한다. 큐는 Redis/BullMQ, 검색은 Qdrant, 모델 호출은 회사 AI gateway다.” |

미결정8의 **배포처 결정은 Vercel로 닫는다**. 지침 문안 승인·요금제·실제 운영 배포·Storage 전환 완료 여부는 별개다.

## 2. ADR-037·039·042 조건②의 좁은 예외

사용자가 승인한 예외는 Next.js의 접수 **전송/배포 경로**를 Vercel HTTPS → 회사의 기존 업무 API → 같은 Redis/BullMQ로 나누는 것이다. 같은 Next.js handler와 기존 analysis job·수집 저장 RPC 계약을 재사용한다. `analysis` job payload/jobId·processor 의미, `ingest_save_revision` signature·원자성, 규칙 엔진·골든94/72/68은 바꾸지 않는다. RPC/큐 의미나 기존 함수 signature 변경이 필요하면 먼저 사용자에게 알리고 별도 승인·검증한다. 후속 durable dispatch·quota 예약 보강은 이 예외로 자동 승인되지 않는다.

ADR-044·045에 이 예외와 freeze 조건을 함께 적는다. Gateway/Vercel은 해커톤 이후로 미루지 않으며 green 전에는 기본 경로를 바꾸지 않는다. `web/worker/main.ts`, `web/server/notifications/*`, `web/server/bids/*`, `web/server/ingestion/*`, app-nav·대시보드 카드는 다른 담당과 공유하므로 기존 함수 모양을 유지한 추가형을 따른다.

## 3. 요금제와 함수·대역폭 한도

2026-10-21 공식 페이지 확인값이며 실제 팀의 계약·Fluid Compute 설정은 배포 전에 다시 확인한다.

| 항목 | Hobby | Pro |
| --- | --- | --- |
| 기본 비용 | $0/월 | $20/월 플랫폼 비용, 배포 좌석1개·사용량 credit $20 포함. 추가 배포 좌석 $20/월/명, 세금·추가 사용량 별도 |
| 사용 조건 | 개인·비상업 용도 | 회사·팀 사용을 위한 유료 플랜 |
| 함수 시간(Fluid Compute) | 기본/최대300초 | 기본300초·일반 최대800초 |
| 전송량 | 월100GB 포함 | 현재 Pro 기본 Flat Rate CDN 월1TB·CDN 요청100만 용량 포함. capacity tier·추가 제품 비용은 실제 계약 확인 |
| 함수 요청/응답 | 4.5MB | 4.5MB |

근거: [Hobby 사용 조건](https://vercel.com/docs/plans/hobby), [Pro 플랫폼·좌석·CDN](https://vercel.com/docs/plans/pro-plan), [현재 가격표](https://vercel.com/pricing), [Functions 제한](https://vercel.com/docs/functions/limitations). 800초 초과의 beta 확장은 사용하지 않는다. 기존 프로젝트의 non-Fluid 설정에 위 수치를 적용했다고 가정하지 않는다.

Gateway 접수는 자체15초 상한, 현재 AI 서비스 `maxDuration`은120초이며 장시간 Worker/파싱은 회사 서버에서 실행한다. 50MiB 첨부를 Vercel 함수 본문으로 보내지 않는다. 회사 업무 서비스를 Hobby 비상업 조건에 자동으로 맞는 것으로 처리하지 않는다. **유료 Pro가 필요하면 사용자에게 비용과 예산 상한을 확인한 뒤 진행한다. 현재 결제·업그레이드·유료 배포 승인이나 실행은 없다.** 이미 회사 Pro 계약이 있으면 사용 범위·좌석·추가 과금을 먼저 확인한다.

## 4. 회사 Gateway 인증·호스트·노출 범위

- 운영 설정 허용 주소: `https://acropolissg.com:443/redis/`. frontend의 `REDIS_API_BASE_URL`은 이 회사 주소로 관리한다. 다른 호스트/포트로 바꾸려면 별도 운영 승인을 받는다. 현재 앱은 서버 설정 HTTPS URL·고정 method/path를 검사하며 hostname을 하드코딩한 allowlist는 아니다. 임의 사용자 URL은 받지 않는다.
- `X-Sol-Service-Token`은 서버 전용이며 업무 API에는 Supabase 사용자 Bearer를 추가한다. 회사 handler는 현재 계정·조직·RBAC/RLS를 다시 검사한다. health만 서비스 token 단독이다.
- 외부 공개는 기존443의 `/redis/`와 허용5개 업무/health 경로뿐이다. 회사 Redis6379와 Gateway6380은 외부에 게시하지 않는다. 다른 Next 화면·Server Action·구형 API·정적 파일은 차단한다. 기존 별칭/정규화308도 목적지에서 재검증한다.
- 브라우저는 Vercel의 기존 API를 호출한다. 서비스 Secret·refresh token·쿠키를 회사 API에 노출하지 않으며 CORS로 브라우저의 Gateway 직접 호출을 열지 않는다. TLS 검증을 끄지 않는다. Vercel web에 service role·GPU/G2B 키를 넣지 않는다.

## 5. 기동·S0·수용 조건

정본은 [[10-DEPLOYMENT|10 배포]] 기동 절차, [[19-DEMO-SCENARIO|19]] S0, [[11-TESTING|11]] §5다. 세 곳에 다음 분기를 같이 둔다.

1. 기본은 기존 Compose Redis/BullMQ·MinIO + standalone web이다. 운영 빌드를 로컬에서 띄울 때 `SOL_DEPLOYMENT_ROLE=standalone`을 명시한다. 새 경로를 자동 선택하지 않는다.
2. 선택 경로는 회사 Gateway의 실제 loopback6380와 기존 Nginx443를 운영 승인 후 먼저 검증하고 Vercel frontend를 연결한다. 회사 컨테이너 생성/재시작·Nginx·클라우드 DB·Vercel production 변경은 각각 승인 대상이다. 이번 정리에서 실행하지 않는다.
3. 허용 host/TLS·무토큰/오토큰401·정상 token health·잘못된 JWT401·권한403·타 조직404·같은 키 접수/응답 유실·429 헤더·202→DB polling→Worker 결과를 실제 배포 경로에서 확인한다. 회사6379/6380 미공개와 기존 운영 서비스 상태도 확인한다. 공유 서버에 장애 주입하지 않는다.
4. 선택 경로의 웹/회사 API/Worker 소스 버전·실행 모드·사용하는 AI gateway를 기록한다. 요약 health와 기존 상세 AI 화면이 다른 gateway를 검사할 수 있는 현행 차이를 통합 성공으로 표시하지 않는다.
5. 10-24 22:00 전 위 검사와 슬롯으로 감싼 `pnpm verify`가 green이어야10-25 리허설에서 선택한다. 실패/미검증이면 Compose로 수동 복귀하고 사실대로 기록한다. 문서만으로 새 경로를 green 처리하지 않는다.

무거운 검증·E2E·build·git commit은 사용자가 지정한 `/private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/d905c94c-1dd3-4207-a362-5fb3bd476efc/scratchpad/verify-slot.sh`로 감싼다. `.env`는 도구로 읽거나 출력하지 않는다. 새 migration은 작업 시점 `origin/main` 최대보다 큰 번호·같은 커밋의 `pnpm db:types`가 필수이며 `db:push`와 운영 변경은 먼저 사용자 확인을 받는다. ADR-044·045 번호를 유지하며 다음 번호는046부터다.
