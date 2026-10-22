"""State Builder가 실제 사용하는 한국어 값 수집과 번역 검증. 원문을 수정하지 않는다."""

import json
from dataclasses import dataclass

from jsonschema import Draft202012Validator

from sol_ai import strict_json
from sol_ai.adapters.base import ExtractionFailed, ModelUnavailable, TranslationAdapter
from sol_ai.citation import norm
from sol_ai.contracts import KevRequest, ProfileSummary
from sol_ai.deadline import Deadline
from sol_ai.guards import InjectionGuard
from sol_ai.kev_state import StateBuilder
from sol_ai.paths import AI_ROOT
from sol_ai.qualifications import QualificationDictionary
from sol_ai.translation_validation import MAX_VALUE_CHARS, valid_translation


def collect_notice_texts(extraction: dict, dictionary: QualificationDictionary) -> dict[str, str]:
    # 입력은 추출 검증 체인을 이미 통과했다. 불필요한 재검증이나 원문 복사/변형을 하지 않는다.
    request = KevRequest.model_construct(
        extraction=extraction,
        profileSummary=ProfileSummary(technologies=[], licenses=[], pastProjects=[]),
        translations=None,
        profileRevision=0,
        attachmentsIncomplete=False,
    )
    builder = StateBuilder(request, "en", dictionary)
    builder.notice_lines(builder.joined(builder.past_performance_items() or [], "; "))
    return builder.translation_sources


def collect_profile_texts(
    request: KevRequest, dictionary: QualificationDictionary
) -> dict[str, str]:
    builder = StateBuilder(request, "en", dictionary)
    builder.company_lines(with_amounts=True)
    return builder.translation_sources


MAX_ITEMS = 64
MAX_REQUEST_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 64 * 1024


@dataclass(frozen=True)
class TranslationResult:
    values: dict[str, str]
    warnings: list[str]


def _unique_object(pairs: list[tuple]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate translation key")
        result[key] = value
    return result


def checked_translations(
    sources: dict[str, str], candidates: dict[str, str], guard: InjectionGuard
) -> dict[str, str]:
    return {
        path: norm(candidates[path])
        for path, source in sources.items()
        if valid_translation(source, candidates.get(path), guard)
    }


def missing_warnings(sources: dict[str, str], accepted: dict[str, str]) -> list[str]:
    return [f"TRANSLATION_MISSING:{path}" for path in sources if path not in accepted]


def translate_texts(
    sources: dict[str, str],
    translator: TranslationAdapter,
    guard: InjectionGuard,
    *,
    deadline: Deadline,
) -> TranslationResult:
    if not sources:
        return TranslationResult({}, [])
    # 한 번의 제한된 호출만 한다. 넘는 항목은 누락으로 기록한다. 원문은 자르지 않는다.
    selected: dict[str, str] = {}
    for path, source in sources.items():
        if len(selected) >= MAX_ITEMS:
            break
        if len(source) <= MAX_VALUE_CHARS and not guard.matches(source):
            trial = {**selected, path: source}
            if len(json.dumps(trial, ensure_ascii=True).encode()) <= MAX_REQUEST_BYTES // 2:
                selected = trial
    accepted: dict[str, str] = {}
    warnings: list[str] = []
    if selected:
        if deadline.expired():
            warnings.append("TRANSLATION_TIMEOUT")
        else:
            try:
                text = translator.translate(selected, deadline=deadline)
                if deadline.expired():
                    raise ModelUnavailable("translation deadline exceeded")
                if len(text.encode("utf-8", "surrogatepass")) > MAX_RESPONSE_BYTES:
                    raise ValueError("translation too large")
                strict_json.loads(text)  # 표준 숫자/깊이 검사 + 중복 키 거부
                raw = json.loads(text, object_pairs_hook=_unique_object)
                schema = json.loads((AI_ROOT / "schemas/state-translation.v0.1.json").read_text())
                if not Draft202012Validator(schema).is_valid(raw):
                    raise ValueError("translation schema violation")
                candidates = raw["translations"]
                if not set(candidates) <= set(selected):
                    raise ValueError("unexpected translation path")
                accepted = checked_translations(selected, candidates, guard)
            except ModelUnavailable:
                warnings.append("TRANSLATION_UNAVAILABLE")
            except (ExtractionFailed, ValueError, UnicodeError):
                warnings.append("TRANSLATION_INVALID")
    return TranslationResult(accepted, warnings + missing_warnings(sources, accepted))
