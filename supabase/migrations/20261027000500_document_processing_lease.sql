-- 20261027000500_document_processing_lease — documents job 의 문서별 처리 리스·실패 기록·처리 대상 찾기(첨부 처리, 2026-10-27).
--
-- 근거: docs/07-DATA-PIPELINE.md "documents 큐 소비자 계약", docs/plans/2026-10-21-redis-gateway-supabase-storage-migration.md §8.2
-- (문서별 attempt UUID·lease), ADR-048. 20261021000700 이 만든 bid_documents.processing_attempt_id·processing_lease_until 열을 처음 쓴다.
-- 표·열·제약은 바꾸지 않는다. 원본·텍스트 확정은 기존 finish_document_storage 가 그대로 한다.
--
-- 이 파일에 든 것(모두 security invoker, service_role 만 실행. anon·authenticated·public 은 실행할 수 없다):
--   1. claim_document_processing — 처리할 상태(다운로드 대기, 또는 다운로드 OK + 파싱 대기)인 행만, 리스가 없거나 끝났거나
--      같은 시도의 것일 때 리스를 잡는다(같은 시도면 기한을 늘린다). 못 잡으면 사유(MISSING·DONE·BUSY)를 돌려준다.
--   2. fail_document_download — 그 시도가 리스를 가진 다운로드 대기 행만 FAILED + 사유 코드로 닫고 리스를 푼다.
--   3. fail_document_parse — 그 시도가 리스를 가진 파싱 대기 행만 UNSUPPORTED·FAILED + 사유 코드로 닫고 리스를 푼다.
--   4. release_document_processing — 그 시도의 리스만 푼다(성공 뒤·일시 오류로 다음 시도에 넘길 때).
--   5. document_processing_candidates — 복구 회차가 job 을 넣을 revision. 최신 revision·접수 중(OPEN·AMENDED)·마감 전 공고이고,
--      파서 형식(.pdf·.hwp·.hwpx) 첨부 가운데 끝난 것이 공고당 상한보다 적고 처리할 것이 남은 revision 만 고른다.
--
-- 다운로드 사유 코드는 화면 계약(web/server/bids/bid.model.ts bidDocumentSchema.downloadErrorCode)의 일곱 값만 받는다.
-- 그 밖의 값을 쓰면 공고 상세가 응답 검증에서 깨진다. 파싱 사유 코드는 기존 check(bid_documents_parse_error_code_check)가 막는다.
--
-- 되돌리기(새 마이그레이션으로): 다섯 함수를 drop 한다. 열·행은 이 파일이 만들지 않았으므로 그대로 둔다
-- (processing_* 열은 null 로 남거나 끝난 리스 값이 남는다. 읽는 쪽이 없다). 이 파일은 고치지 않는다(append-only).

create function public.claim_document_processing(p_document_id uuid, p_attempt_id uuid, p_lease_seconds integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.bid_documents;
begin
  if p_attempt_id is null or p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'document_processing_invalid_lease';
  end if;
  select * into d from public.bid_documents where id = p_document_id for update;
  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'MISSING');
  end if;
  if not (d.download_status = 'PENDING' or (d.download_status = 'OK' and d.parse_status = 'PENDING')) then
    return jsonb_build_object('claimed', false, 'reason', 'DONE');
  end if;
  if d.processing_lease_until > now() and d.processing_attempt_id is distinct from p_attempt_id then
    return jsonb_build_object('claimed', false, 'reason', 'BUSY', 'leaseUntil', d.processing_lease_until);
  end if;
  update public.bid_documents
     set processing_attempt_id = p_attempt_id,
         processing_lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = d.id
   returning * into d;
  return jsonb_build_object(
    'claimed', true,
    'leaseUntil', d.processing_lease_until,
    'document', jsonb_build_object(
      'id', d.id,
      'bidId', d.bid_id,
      'revisionId', d.revision_id,
      'name', d.name,
      'originalUrl', d.original_url,
      'downloadStatus', d.download_status,
      'parseStatus', d.parse_status,
      'format', d.format,
      'sha256', d.sha256,
      'storageBucket', d.storage_bucket,
      'objectKey', d.object_key
    )
  );
end;
$$;

create function public.fail_document_download(
  p_document_id uuid, p_attempt_id uuid, p_error_code text, p_error_message text
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_error_code is null or p_error_code not in (
    'AUTH_REQUIRED', 'HTTP_4XX', 'HTTP_5XX', 'REDIRECT_BLOCKED', 'HOST_NOT_ALLOWED', 'TOO_LARGE', 'TIMEOUT'
  ) then
    raise exception 'document_processing_invalid_code';
  end if;
  update public.bid_documents
     set download_status = 'FAILED',
         download_error_code = p_error_code,
         download_error_message = left(p_error_message, 500),
         processing_attempt_id = null,
         processing_lease_until = null
   where id = p_document_id
     and processing_attempt_id = p_attempt_id
     and download_status = 'PENDING';
  return found;
end;
$$;

create function public.fail_document_parse(
  p_document_id uuid, p_attempt_id uuid, p_parse_status text, p_error_code text, p_parser_id text, p_error_message text
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_parse_status is null or p_parse_status not in ('UNSUPPORTED', 'FAILED') or p_error_code is null then
    raise exception 'document_processing_invalid_parse';
  end if;
  update public.bid_documents
     set parse_status = p_parse_status,
         parse_error_code = p_error_code,
         parse_error_message = left(p_error_message, 500),
         parser_id = nullif(p_parser_id, ''),
         parsed_at = now(),
         processing_attempt_id = null,
         processing_lease_until = null
   where id = p_document_id
     and processing_attempt_id = p_attempt_id
     and download_status = 'OK'
     and parse_status = 'PENDING';
  return found;
end;
$$;

create function public.release_document_processing(p_document_id uuid, p_attempt_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.bid_documents
     set processing_attempt_id = null,
         processing_lease_until = null
   where id = p_document_id
     and processing_attempt_id = p_attempt_id;
  return found;
end;
$$;

-- 형식 판정은 이름의 확장자다(내려받기 전이라 내용을 볼 수 없다). 받은 뒤의 형식은 worker 가 매직 바이트로 다시 판정한다.
-- 같은 규칙이 web/server/documents/document-selection.model.ts(PARSER_EXTENSIONS)에 있다. 바꾸면 둘을 함께 바꾼다.
create function public.document_processing_candidates(
  p_is_demo boolean, p_after uuid, p_limit integer, p_max_per_bid integer
) returns table (revision_id uuid, bid_id uuid, revision_created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.bid_id, r.created_at
    from public.bid_revisions r
    join public.bid_notices n on n.id = r.bid_id and n.latest_revision = r.revision
   where n.is_demo = p_is_demo
     and n.status in ('OPEN', 'AMENDED')
     and (n.deadline_at is null or n.deadline_at > now())
     and (p_after is null or r.id > p_after)
     and exists (
       select 1 from public.bid_documents d
        where d.revision_id = r.id
          and d.name ~* '\.(pdf|hwp|hwpx)$'
          and (d.download_status = 'PENDING' or (d.download_status = 'OK' and d.parse_status = 'PENDING'))
     )
     and (
       select count(*) from public.bid_documents d
        where d.revision_id = r.id
          and d.name ~* '\.(pdf|hwp|hwpx)$'
          and not (d.download_status = 'PENDING' or (d.download_status = 'OK' and d.parse_status = 'PENDING'))
     ) < greatest(1, least(p_max_per_bid, 20))
   order by r.id
   limit greatest(1, least(p_limit, 100));
$$;

revoke all on function
  public.claim_document_processing(uuid, uuid, integer),
  public.fail_document_download(uuid, uuid, text, text),
  public.fail_document_parse(uuid, uuid, text, text, text, text),
  public.release_document_processing(uuid, uuid),
  public.document_processing_candidates(boolean, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.claim_document_processing(uuid, uuid, integer),
  public.fail_document_download(uuid, uuid, text, text),
  public.fail_document_parse(uuid, uuid, text, text, text, text),
  public.release_document_processing(uuid, uuid),
  public.document_processing_candidates(boolean, uuid, integer, integer)
  to service_role;
