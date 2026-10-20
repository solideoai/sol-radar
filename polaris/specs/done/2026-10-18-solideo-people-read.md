# 솔리데오 조직·인력 조회 구현 스펙

상태: done(2026-10-20 정본 6차에서 done/ 으로 옮김. 구현은 PR #6 98101e8·7641ee4 로 main 에 병합). 착수 당시: 기준 main89b2b5e, 사용자 2026-10-18 승인 요청과 docs04·05·06·09·16 ADR020/021. 실행 승인은 이미 받았으며 추가 기능·공유DB·main병합·push·배포는 제외한다. UI 상세는 [디자인 스펙](2026-10-18-solideo-people-ui.md)을 따른다.

## 불변 조건

- 직원200명·사진200장/승인 SHA, 기존ID/이름/팀/직급, 남녀100/100, 평가27/비대상173, 7배정/고정20FTE와 순수94/72/68 계산 입력은 변경하지 않는다. fixtures/people 전체와 web/public/demo/people, 기존scoring.model/test 및 기존SQL12개는 바이트 보존한다.
- 본부6/그룹4/팀38, 팀target합200, 상위targetNULL, 확정13연결81명·미확정29(팀25/119명+그룹4) 유지. DIVISION null은 정상루트, GROUP/TEAM null은 종류별 상위미지정이다. 가짜부서/직원이동/추정연결/상위집계저장은 없다.
- 조회만. 직원 추가/편집/퇴사·재배분·시뮬레이션·전체N1/N2/ops 전환·P1·G1~G10 완료처리는 제외. 1280px 이상,1440/1280 QA. 기존토큰/부품/패키지만 사용한다.
- main과b3ef/9663는 읽기만 한다. main의 기존 .claude/settings.json 미커밋 변경을 보존하며 어떤 설정/훅/검사도 우회하지 않는다. 별도5b0c/feat/people-read에서만 쓴다. DB는 PGlite/새 전용 Supabase만. 기존공유543xx/이전다른QA프로젝트/클라우드에 접근/적용하지 않는다.

## 1. 역할과 현재 조직

새 append-only migration20261018000001_people_business_roles.sql에서 memberships.sol_role text NOT NULL DEFAULT 'VIEWER', CHECK VIEWER/ANALYST/SALES/ADMIN을 추가한다. 기존 owner/member와 독립이며 org_role/기존정책·가입RPC·개인조직bootstrap·계정ID는 바꾸지 않는다. owner→ADMIN 자동 승격은 하지 않는다. 이 마이그레이션은 화면 역할의 memberships.sol_role INSERT/UPDATE 권한을 거둔다. 그 뒤 20261019000001이 UPDATE(sol_role)만 다시 열고 정책 "ADMIN 은 역할 변경"(그 조직 sol_role=ADMIN만)과 보호 트리거 protect_sol_role로 권한 상승을 막는다(docs/04-DATABASE.md §3.1 sol_role 변경 잠금, 2026-10-20 ADR-033 E7 정정). INSERT 권한은 계속 없다(초대 수락 트리거가 채운다). 네 업무역할 모두 명부 SELECT 가능, 기존 RLS조직격리를 유지한다. 새 직원 쓰기 정책은 없다. 생성DB타입은 pnpm db:types로 만든다.

organization 도메인에 getMyBusinessAccess()를 더한다. 기존 getCurrentOrganization()의 업무0/1/복수 판정을 재사용하고 ready일 때 세션userId+현재orgId의 sol_role을 사용자 RLS연결로 읽는다. 기존 CurrentOrg와 기존서비스 인터페이스를 불필요하게 바꾸지 않는다. 결과는 기존비ready상태 또는 forbidden 또는 ready{userId,current:CurrentOrg & {solRole:SolRole}}이다. runtime검증으로 유효하지않은역할을 거절한다. API는 기존 requireCompleteUser로 인증/활성/프로필완료를 먼저검사한다. 유효하지않은Bearer가 쿠키로대체되지않는다.

API: 미인증401, 정지403ACCOUNT_DISABLED, 미완료403PROFILE_INCOMPLETE, 업무0개403FORBIDDEN(details.reason=ORGANIZATION_REQUIRED 및 organizationStatePath), 복수403UNSUPPORTED_ACCOUNT_STATE, 역할없음403FORBIDDEN, 남의조직자원/없는직원404NOT_FOUND. orgId를 쿼리로 받으면400VALIDATION_ERROR; 조직ID헤더는 조직결정에 쓰지않는다. 화면은 기존로그인/보완/조직안내 흐름으로 연결한다. 레이아웃 외 page/API/service도 독립가드한다.

기존5개 템플릿시드계정은 seed-team에 속하고 org-01 200명 카탈로그와 자동합류하지 않는다. 일반 db-seed 동작·회원가입 정책을 바꾸거나 기존계정에 업무조직을 추가하지 않는다. 실제 QA는 전용스택에서 별도 임시계정4개를 org-01에 명시적멤버십/역할로 생성해 검증·제거한다. 새기존멤버역할기본값은VIEWER이며 조직owner와독립이다.

## 2. API·직급 계약

도메인 web/server/people/에 model/repo/service/index를 둔다. 서버파일은 server-only, 외부는배럴만, 요청마다anon+사용자세션 DB클라이언트, 서비스롤금지. 저장기본id는 UUID, personCode=SOL-Pxxxx, department.code=SOL-Dxxx, jobTitle.code=SOL-Jxxx이며 서로혼용하지않는다.

GET /api/v1/departments → docs05 Department[] + additive code:string. memberCount는 전체조직의 하위팀 직원ID중복제거 합, 본부/그룹targetCount=null. 현재employment_status 열은없으며 현재명부는모두재직이다. 조회때해당열을 추가/요구하지않는다.
GET /api/v1/job-titles → {id(UUID),code(SOL-J),label}[] (인증된현재조직 직급카탈로그; 계약보완).
GET /api/v1/team-members → docs05 TeamMemberListItem[]를 담은 Page. query q(trim,최대40),departmentId/team UUID,jobTitleId UUID,scoring=1|0,cursor,limit(default20,1..100). 알수없는/중복쿼리는400. 잘형성된다른조직/없는부서·직급필터는404. 부서가상위조직이면400. 정렬personCode ASC,id ASC 고정. 목록에는 상세scoring속성을 넣지않는다. leftjoin/멤버ID존재로scoringEligible를계산해173명이사라지지않는다.
Page={items,pageInfo:{cursor,nextCursor,previousCursor,hasNext,startIndex(0-based)},totalCount(필터결과수),summary:{totalCount(전체조직),scoringCount(전체조직)}}. 서버집계만쓰며200/27을하드코딩하지않는다. 필터변경때cursor리셋.
GET /api/v1/team-members/[id] → docs05 TeamMemberDetail. id는UUID;27명만scoring객체,173명null. 역할/등급/스킬/가용성은 기존계산입력형태로검증. 사진portraitUrl은안전한기존portrait_path만(없음/잘못된경로는null). 공개연락처/실명원본/계정연결추정없다.

커서는 docs05§3의API_CURSOR_SECRET(서버전용32자이상) HMAC/base64url이다. 인코딩값에는version,마지막sort키+id,orgId,정규화필터/limit결속,issuedAt를 넣는다. TTL24시간이며다른조직/필터/변조/만료는400INVALID_CURSOR. timingSafeEqual,개인정보/키로그금지. 필요키누락은503SERVICE_UNAVAILABLE(component=cursor)이며추측키/anon키대체없다. web/.env.example에빈placeholder+주석만,실제키파일은쓰지않는다.

서비스는200명규모에서전체정본행을한번읽어안전한모델로투영/집계/필터/커서페이지를계산할수있다. 상세조회는현재orgId+id로한정한다. 조직도는전체명부투영을쓰며현재목록20명을재사용하지않는다. 같은가드/모델을SSR과API가공유한다. getDepartments/listTeamMembers/getTeamMember/getJobTitles/getPeopleDirectory API는배럴에서노출한다. 정확한함수타입은Task2 모델이정하고UI에인계한다. 불필요한새상태관리/DB캐시/외부패키지는없다.

## 3. UI

새 /people scopedlayout/page에서기존AppShell/AppPage를재사용한다. 기존 slug레이아웃을전체이동/중복wrap하지않고모든기존routes/auth/settings/admin동작을보존한다. NAV에현재출시people링크하나만추가해 /people을연결한다. 상세는PersonDrawer/Sheet이며별도people/[id]페이지없다.
`/people`은 명부 전용이다. 모든 `view` 값은 무시하고(리다이렉트 없음) 실제 API 필터·cursor 검증은 유지한다. 목록은SSR가같은people서비스로초기데이터를읽고searchParams기반URLnavigation으로필터/페이지를유지할수있다. 상세는인증GET API로읽고서로다른직원선택/닫기/실패의오래된응답을막는다. 조회실패때다시시도가능. 필터에UUID를쓰고표시에는부서명·직급label을쓴다. 조직도는 별도 `/org-chart` 두 칸 탐색기다. 전체 guarded directory를 요청당 한 번 읽고 실제 parentId만 사용한다. 왼쪽 약300px 중첩 ul/li 부서 탐색기와 오른쪽 선택 팀 카드 격자를 둔다. 본부는 하위 고유 직원 수 내림차순·코드순, 그룹/팀은 코드순, 카드는 직급 카탈로그 배열순·한글 이름순이다. 처음 첫 본부의 첫 비어 있지 않은 팀(현재 AX사업본부 AI플랫폼운영팀14명)을 선택한다. `?team=UUID`는 선택·새로고침·뒤로 가기에 동기화하며 잘못된 값/누락은 기본 팀으로 안전하게 정규화한다. 이름 combobox 최대8개 후보 선택은 팀/조상을 펼치고 카드에 초점·잠깐 강조하며 Drawer는 열지 않는다. 팀 카드44px Avatar와 공유 Drawer를 재사용한다. 전체200DTO는 팀 선택 전체를 순회할 때 각자 정확히 한 번 나타난다. 루트본부와미지정그룹/팀을분리한다. 데이터null을오류화하지않는다.
PersonAvatar에는personCode를전달하고nullableportraitUrl을존중한다. 사진없음/404/decode오류는이름이니셜. 기존PNG는변경하지않는다. drawer는Esc/닫기/초점복귀/포커스트랩/접근가능이름/상세로딩·오류·재시도. UI스펙을구체기준으로쓴다.

## 4. 완료 검증

TDD 단계별 실패/통과 증거. 데이터/사진/기존SQL·스코어입력SHA 불변. PGlite4역할SELECT/다른조직0행/자기역할승격·직원쓰기거부/owner-member기존기능보존. 서비스/API 쿠키Bearer·0/1/복수·정지/미완료·다른조직404·검색/필터/HMAC/cursor페이지200/27/173·직급코드UUID. 전체계층/목표/실제/29unknown/81+119/인원중복제거. 실제전용Supabase13마이그레이션/시드2회/기존5ID보존. 실제브라우저1440/1280 UI전체상태,키보드/axe0、이미지200HTTP/MIME/SHA/decode/fallback. 전체pnpm verify와정상기존Auth/public/browser회귀. 실행못한검사는미검증이며G1~G10은미완료상태유지. 일반문서진행·계약은갱신하되ADR020/021결정을고치지않는다.


2026-10-18 Task3A 개정 근거: 사용자가 승인한 `docs/plans/2026-10-18-org-chart-sidebar-design.md` §5·§7·부록A. 기존 Task3의 보기 탭 구현·검증 기록은 당시 c178 기준 역사이며 이번 개정으로 대체한다. API·역할·RLS·불변 데이터 계약은 변경하지 않는다.
