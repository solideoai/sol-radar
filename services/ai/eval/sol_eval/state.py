"""EvalItem → Kev state. 서빙과 같은 빌더(sol_ai.kev_state_v02.build_state_v02)·같은 템플릿 파일을 그대로 쓴다.

train/serve skew 를 막는 유일한 길이다. 여기서 줄을 더하거나 바꾸지 않는다. 저장은 stateHash 만 한다.
"""

import hashlib
from functools import lru_cache

from sol_ai.contracts import KevRequest
from sol_ai.kev_state import HANGUL
from sol_ai.kev_state_v02 import StateDocument, StateTemplate, build_state_v02, load_state_templates
from sol_ai.qualifications import QualificationDictionary, default_dictionary
from sol_eval.dataset import EvalItem
from sol_eval.paths import QUESTION_SET_VERSION, STATE_TEMPLATES_DIR

LANGUAGES = ("en", "ko")


@lru_cache(maxsize=1)
def state_templates() -> dict[str, StateTemplate]:
    return load_state_templates(STATE_TEMPLATES_DIR)


def kev_request(item: EvalItem, language: str) -> KevRequest:
    """EvalItem 을 gateway /kev 본문(03 §5.7 KevAdapterInput)으로. 규칙 결과·라벨은 넣지 않는다."""
    if item.extraction is None or item.company is None:
        raise ValueError(f"{item.itemId}: extraction·company 가 있어야 state 를 만든다")
    org_id = item.company.companyId or "company"
    return KevRequest(
        requestId=item.itemId,
        fixtureId=None,
        bidId=item.bid.noticeId,
        orgId=org_id,
        revisionId=item.bid.revisionId,
        profileRevision=item.company.revision,
        extraction=item.extraction,
        translations=item.translations,
        profileSummary=item.company.model_dump(exclude_none=True),
        attachmentsIncomplete=item.attachmentsIncomplete,
        questionSetVersion=QUESTION_SET_VERSION,
        stateLanguage=language,  # type: ignore[arg-type]
    )


def build_state(
    item: EvalItem, language: str, dictionary: QualificationDictionary | None = None
) -> StateDocument:
    template = state_templates()[language]
    return build_state_v02(
        kev_request(item, language), template, dictionary or default_dictionary()
    )


def state_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def has_hangul(text: str) -> bool:
    return HANGUL.search(text) is not None
