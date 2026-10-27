"""금액을 모르는 회사 실적(amountKrw=null)을 결정 모델 입력에 허용한다."""

import copy

from support import PROFILE, kev_request

from sol_ai.contracts import KevRequest
from sol_ai.kev_state import StateBuilder
from sol_ai.qualifications import default_dictionary


def _past_performance(amounts: list[str | None]) -> str:
    profile = copy.deepcopy(PROFILE)
    profile["pastProjects"] = [{"amountKrw": amount} for amount in amounts]
    request = KevRequest.model_validate(kev_request(profile=profile))
    builder = StateBuilder(request, "en", default_dictionary())
    return builder.company_past_performance(True)


def test_unknown_amount_counts_project_but_not_amounts():
    line = _past_performance([None, "1000000000"])
    assert line.startswith("2 projects")
    assert "largest 1,000,000,000 KRW" in line
    assert "None" not in line
    assert line.count("1,000,000,000") == 2  # 금액 목록 1회 + 최대 1회


def test_all_unknown_amounts_omit_largest():
    line = _past_performance([None, None])
    assert line == "2 projects"
