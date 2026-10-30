-- 2026-10-30 리뷰 후속: 운영에서 직급이 fixture 와 다른 데모 직원도 운영 직급 기준으로 등급·수행 이력을 맞춘다.
-- 20261030001000 은 직급이 fixture 와 같은 행만 바꾼다. 운영 읽기(2026-10-30)에서 다른 직원은 SOL-P0065 한 명이었다
-- (운영 그룹장 SOL-J006, fixture 수석 SOL-J009). 값은 generateCapabilities("SOL-P0065", "SOL-J006")(synthetic-people/v3)이다.
-- 운영 직급이 아래 값과 같을 때만 바뀐다. 로컬·시드 DB 처럼 fixture 직급(수석)이면 아무 행도 바뀌지 않는다.
-- 조건(고정 데모 조직·is_demo·SYNTHETIC)은 20261030001000 과 같다. 다시 돌려도 결과가 같다.
-- 되돌리기(새 마이그레이션으로): 20261021000600 의 grade, 20261029001000 의 past_projects·capability_version 으로 같은 조건의 update 를 한다.
with people as (
  select * from jsonb_to_recordset($people$[{"person_code":"SOL-P0065","job_title_code":"SOL-J006","grade":"특급","past_projects":[{"projectId":"SYN-SOL-P0065-1","name":"한빛도시공사 정보화전략계획(ISP) 수립","client":"한빛도시공사","domain":"컨설팅","role":"BUSINESS_ANALYST","startsAt":"2007-09-01","endsAt":"2009-12-01","skills":["Requirements Analysis","BPMN","SQL"],"isDemo":true,"evidenceRef":"synthetic:SOL-P0065:project:1"},{"projectId":"SYN-SOL-P0065-2","name":"하늬도 통합 민원 시스템 고도화","client":"하늬도청","domain":"민원","role":"BUSINESS_ANALYST","startsAt":"2012-10-01","endsAt":"2014-09-01","skills":["Requirements Analysis","BPMN"],"isDemo":true,"evidenceRef":"synthetic:SOL-P0065:project:2"},{"projectId":"SYN-SOL-P0065-3","name":"다온복지재단 복지급여 통합관리 시스템 개편","client":"다온복지재단","domain":"복지","role":"BUSINESS_ANALYST","startsAt":"2016-08-01","endsAt":"2018-03-01","skills":["Requirements Analysis","BPMN","SQL"],"isDemo":true,"evidenceRef":"synthetic:SOL-P0065:project:3"},{"projectId":"SYN-SOL-P0065-4","name":"한빛시 차세대 재정관리시스템 구축","client":"한빛시청","domain":"행정","role":"PL","startsAt":"2021-01-01","endsAt":"2022-04-01","skills":["Requirements Analysis","SQL"],"isDemo":true,"evidenceRef":"synthetic:SOL-P0065:project:4"},{"projectId":"SYN-SOL-P0065-5","name":"윤슬데이터진흥원 전자문서 유통 시스템 재구축","client":"윤슬데이터진흥원","domain":"행정","role":"PM","startsAt":"2024-03-01","endsAt":"2026-07-01","skills":["Requirements Analysis","BPMN","SQL"],"isDemo":true,"evidenceRef":"synthetic:SOL-P0065:project:5"}],"capability_version":"synthetic-people/v3"}]$people$::jsonb)
    as p(person_code text, job_title_code text, grade text, past_projects jsonb, capability_version text)
)
update public.team_member_scoring s
set grade = p.grade, past_projects = p.past_projects, capability_version = p.capability_version
from people p
join public.team_members m on m.person_code = p.person_code and m.is_demo
join public.organizations o on o.id = m.org_id and o.id = 'db4c863c-cb6a-593d-93ff-709a17e0157a'::uuid
  and o.slug = 'org-01' and o.is_demo
join public.job_titles j on j.id = m.job_title_id and j.org_id = m.org_id and j.code = p.job_title_code
where s.member_id = m.id and s.org_id = m.org_id and s.capability_source = 'SYNTHETIC';
