-- 번역 누락으로 Bosun을 사용하지 못한 결과도 검토 대상으로 저장한다.
-- 기존 허용 목록과 알 수 없는 플래그 거절은 유지한다(append-only).
alter table public.score_runs
  drop constraint if exists score_runs_review_flags_check;

alter table public.score_runs
  add constraint score_runs_review_flags_check check (review_flags <@ array[
    'MODEL_RULE_DISAGREEMENT', 'KEV_MANDATORY_RISK', 'KEV_NEEDS_REVIEW', 'KEV_REQUIREMENT_DISAGREEMENT',
    'KEV_DELIVERY_RISK', 'CITATION_FAILED', 'EXTRACTION_FAILED', 'EXTRACTION_LOW_CONFIDENCE', 'AI_UNAVAILABLE',
    'QWEN_UNAVAILABLE', 'KEV_UNAVAILABLE', 'MOCK_FALLBACK', 'PARSE_UNSUPPORTED', 'DOCUMENT_DOWNLOAD_FAILED',
    'INSUFFICIENT_DATA', 'INJECTION_SUSPECTED', 'SCALE_LIMIT_EXCEEDED', 'TRANSLATION_INCOMPLETE'
  ]::text[]);
