-- 20261029000500_list_dataset_version — 목록 커서의 데이터 버전을 뷰 전체 해시에서 원본 표 해시로 바꾼다(ADR-070).
--
-- 근거: docs/plans/2026-10-29-list-latency.md "원인 측정값"·Task 1. 운영(사업기회 3,309건)에서 이 함수가
--   opportunity_list_items 를 행마다 계산해 authenticated 단독 921ms, 동시 부하 때 2.6초가 걸렸고, /bids 이동 한 번에
--   두 번 돈다(web/server/opportunities/repo.ts versionOf). 원본 표 해시 시제품은 18.6ms 였다.
-- 바꾸는 것: procurement_dataset_version(p_org_id) 본문만. 뷰가 읽는 원본 표에서 아래 아홉 값을 만들어 '|' 로 잇고 md5 한다.
--   값은 "행 수:열 묶음 해시의 XOR" 이다(열 묶음은 concat_ws(',', …), 해시는 hashtextextended(…, 0)).
--   1. bid_opportunities — id·대표 공고·대체·처음 본 시각. 연결 함수(link_bid_opportunity·refresh_bid_opportunity)가 바꾸는 열이다.
--   2. bid_notices — id·updated_at·상태·마감·최신 차수. updated_at 은 bid_notices_touch_updated_at 트리거가 모든 갱신에 바꾼다.
--      같은 revision 다시 채우기(ingestion.repo.ts refillAux)도 끝에 content_hash 를 갱신하므로 여기서 바뀐다.
--   3. 마감이 지난 OPEN·AMENDED 공고 수 — 뷰가 now() 로 CLOSED 를 만들기 때문이다.
--   4. bid_revisions — id. 5. bid_relevance_assessments — id(같은 입력은 저장하지 않고 늘 새 행으로 쌓인다).
--   6. opportunity_notice_links — 기회·공고·결정 시각.
--   7. 이 조직의 score_runs — id·상태·완료 시각·점수·권고. 8. 이 조직의 bid_reviews — id·결정·결정 시각.
--   9. 이 조직의 company_profiles — 행 수·최신 차수.
--   공용 표(1~6)는 조직과 무관하고, 조직 표(7~9)는 p_org_id 로만 거른다. 다른 조직의 분석·결정은 내 버전을 바꾸지 않는다.
--   security invoker 라 부른 사람의 RLS 를 통과한 행만 본다(이전과 같다).
-- 바꾸지 않는 것: 서명(uuid → text)·stable·search_path·security invoker·권한, 뷰·표·다른 함수, 웹 코드(커서는 값이 같은지만 본다).
--   값의 모양이 한 번 바뀌므로 적용 순간 열려 있던 "더 보기" 커서는 INVALID_CURSOR 로 첫 페이지부터 다시 연다.
--
-- 되돌리기(새 마이그레이션으로): 20261023000200_procurement_reads.sql 의 procurement_dataset_version 본문으로 다시 만든다.
-- 이 파일은 고치지 않는다(append-only).

create or replace function public.procurement_dataset_version(p_org_id uuid) returns text language sql stable set search_path='' as $$
select md5(concat_ws('|',
 (select count(*)||':'||coalesce(bit_xor(hashtextextended(concat_ws(',',id,canonical_notice_id,superseded_by,first_seen_at),0)),0)
  from public.bid_opportunities),
 (select count(*)||':'||coalesce(bit_xor(hashtextextended(concat_ws(',',id,updated_at,status,deadline_at,latest_revision),0)),0)
  from public.bid_notices),
 (select count(*) filter (where status in ('OPEN','AMENDED') and deadline_at<now()) from public.bid_notices),
 (select count(*)||':'||coalesce(bit_xor(hashtextextended(concat_ws(',',id),0)),0) from public.bid_revisions),
 (select count(*)||':'||coalesce(bit_xor(hashtextextended(concat_ws(',',id),0)),0) from public.bid_relevance_assessments),
 (select count(*)||':'||coalesce(bit_xor(hashtextextended(concat_ws(',',opportunity_id,bid_id,decided_at),0)),0)
  from public.opportunity_notice_links),
 (select count(*)||':'||coalesce(bit_xor(hashtextextended(concat_ws(',',id,status,finished_at,score,recommendation),0)),0)
  from public.score_runs where org_id=p_org_id),
 (select count(*)||':'||coalesce(bit_xor(hashtextextended(concat_ws(',',id,decision,decided_at),0)),0)
  from public.bid_reviews where org_id=p_org_id),
 (select count(*)||':'||coalesce(max(revision),0) from public.company_profiles where org_id=p_org_id)));
$$;
revoke all on function public.procurement_dataset_version(uuid) from public,anon,authenticated;
grant execute on function public.procurement_dataset_version(uuid) to authenticated;
