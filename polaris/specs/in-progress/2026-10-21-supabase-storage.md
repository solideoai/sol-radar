# MinIO → Supabase Storage

2026-10-21 사용자가 전환 계획에 따른 구현을 승인했다. 근거는
`docs/plans/2026-10-21-redis-gateway-supabase-storage-migration.md` Task 3·4와 §5~7·12~13이다.

- 검증된 Redis Gateway 소스만 현재 main 위에 재사용한다. 다른 브랜치의 인력 데이터·폐기된 시험은 가져오지 않는다.
- 새 기본 파일 저장소는 private Supabase Storage다. raw=`bid-documents`, parsed=`bid-parsed`.
- web/redis-api는 사용자 JWT+anon으로 다운로드 URL만 발급한다(60초, no-store). service role은 Worker/운영 CLI만 사용한다.
- 기존 bid_documents를 확장한다. 물리 object 원장과 lease/CAS를 통해 중복 파일을 재사용하고 업로드/DB 확정 실패를 복구한다. 논리적 문서 두 행은 보존한다.
- 첫 묶음 통합은 ADR-043의 200명 변경을 선행으로 포함한다. 삭제 뒤 재업로드 경합을 막기 위해 논리 키는 유지하되 실제 파일명 앞에 원장 UUID 디렉터리를 넣는다. claim은 bucket+logical_path로 중복을 판정하고 실제 path를 반환하며, Worker는 그 세대별 path만 읽고 쓴다.
- 0바이트·50MiB 초과·checksum/path 불일치 거절, immutable upload, 기존 object 재사용 전 실제 바이트 검증.
- 삭제는 참조가 없고 24시간 이상 지난 SOL 원장 object만 lease로 확보한 후 Storage API로 수행한다. 새 참조와 삭제는 같은 row lock을 사용한다.
- Worker의 실제 Storage 읽기/쓰기 검사 결과를 30초마다 Redis에 보고하고 120초 후 만료한다. web은 Worker 비밀키를 받지 않는다. 보고가 없거나 오래되면 storage unavailable/503이다.
- Compose·env 검사·smoke·현행 설계 문서의 MinIO 의존성을 제거한다. 기존 컨테이너/볼륨/파일을 자동으로 삭제하지 않는다.
- DB migration은 새 파일만 추가하며 타입을 생성한다. DB 정책 시험과 실제 SDK HTTP 왕복, 업로드 성공/DB 실패·동시 참조/삭제를 검증한다.
- 클라우드 DB 적용·bucket 생성·회사 운영 변경은 구체적인 변경과 검사 결과를 준비한 다음 저장소의 운영 확인 규칙에 따른다. 이번 로컬 구현을 운영 전환 완료로 보고하지 않는다.
- parser/documents consumer·durable dispatch·quota 예약은 계획의 후속 Task 5·6이다. 이 작업의 완료 범위로 주장하지 않는다.
