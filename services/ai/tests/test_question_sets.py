"""Kev 질문 세트 v0.2 초안(03 §5.10, v0.2 명세 §0). 이 단계는 동작 불변이다(local 지원 집합은 v0.1 뿐).

- 파일 모양: v0.2.json(영어 원문, 초안 표기)과 v0.2.ko.json(평가 전용 한국어판)
- 로더: version 과 language(없으면 en)로 구분해 읽고, ko 파일이 en 세트를 덮지 않는다.
  v0.2(en)의 질문 id·type 이 03 §5.10 과 다르면 로드(기동)가 실패한다.
  공개 수단으로는 v0.2 세트를 볼 수 없어(local 은 아직 v0.1 만 보낸다) 로더 sol_ai.question_sets.load_question_sets 를
  직접 부른다. 이름이 바뀌면 AttributeError 로 실패한다. 결과[버전] 이 en 세트라는 것은 이 시험의 가정이다.
"""

import importlib
import json
import shutil

import pytest
from support import AI_ROOT, HANGUL, load_json

QUESTION_SETS_DIR = AI_ROOT / "kev" / "question-sets"
V0_1_FILE = QUESTION_SETS_DIR / "v0.1.json"
V0_2_FILE = QUESTION_SETS_DIR / "v0.2.json"
V0_2_KO_FILE = QUESTION_SETS_DIR / "v0.2.ko.json"
V0_2 = "kev-qs/v0.2"
GRADES = ["Very poor", "Poor", "Moderate", "Good", "Very good"]
REQ_STATUS = "req.{itemId}.status"

# 03 §5.10 표: v0.1 네 질문 + 추가 질문
V0_2_TYPES = {
    "recommendation": "choice",
    "mandatoryRisk": "noul",
    "needsHumanReview": "noul",
    "fit": "score",
    REQ_STATUS: "choice",
    "techFit": "score",
    "perfRelevance": "score",
    "risk.schedule": "noul",
    "risk.staffing": "noul",
    "risk.scale": "noul",
    "risk.techGap": "noul",
    "risk.scopeAmbiguity": "noul",
}


def questions(path) -> dict:
    return load_json(path)["questions"]


def strings(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in strings(v)]
    return []


def loader():
    return importlib.import_module("sol_ai.question_sets").load_question_sets


# ---------------------------------------------------------------- 파일 모양(고정용)


def test_v0_2_question_ids_and_types_match_03_5_10():
    assert {qid: q["type"] for qid, q in questions(V0_2_FILE).items()} == V0_2_TYPES


@pytest.mark.parametrize("qid", ["recommendation", "mandatoryRisk", "needsHumanReview", "fit"])
def test_v0_2_keeps_v0_1_question_verbatim(qid):
    assert questions(V0_2_FILE)[qid] == questions(V0_1_FILE)[qid]


def test_v0_2_requirement_status_is_three_way_choice():
    criteria = questions(V0_2_FILE)[REQ_STATUS]["criteria"]
    assert set(criteria) == {"SATISFIED", "NOT_SATISFIED", "NEEDS_REVIEW"}


def test_v0_2_requirement_instructions_have_item_placeholder():
    assert "{itemId}" in questions(V0_2_FILE)[REQ_STATUS]["instructions"]


@pytest.mark.parametrize("qid", ["techFit", "perfRelevance"])
def test_v0_2_score_questions_have_five_grades(qid):
    assert questions(V0_2_FILE)[qid]["criteria"] == GRADES


def test_v0_2_is_marked_final():
    # 2026-10-20 사용자가 질문 원문을 그대로 확정했다. 초안 표기가 남으면 안 된다
    data = load_json(V0_2_FILE)
    assert (data["version"], data["status"].startswith("확정"), "초안" in data["status"]) == (
        V0_2,
        True,
        False,
    )


def test_v0_2_english_questions_have_no_hangul():
    # status(확정 표기)는 한국어다. 한글 0자는 질문 문자열(instructions·criteria)에 대한 요구로 본다
    assert HANGUL.findall(" ".join(strings(questions(V0_2_FILE)))) == []


def test_v0_2_english_file_has_no_language_or_en():
    assert load_json(V0_2_FILE).get("language", "en") == "en"


def test_v0_2_korean_file_is_marked_korean():
    data = load_json(V0_2_KO_FILE)
    assert (data["version"], data["language"]) == (V0_2, "ko")


def test_v0_2_korean_file_has_same_question_ids_and_types():
    ko = {qid: q["type"] for qid, q in questions(V0_2_KO_FILE).items()}
    assert ko == V0_2_TYPES


# ---------------------------------------------------------------- 로더


def test_loader_keeps_english_v0_2_set_when_korean_file_exists():
    sets = loader()(QUESTION_SETS_DIR)
    english = sets[V0_2]
    text = " ".join(q.instructions for q in english.questions.values())
    assert HANGUL.findall(text) == []


def test_loader_v0_2_english_set_is_the_english_file():
    sets = loader()(QUESTION_SETS_DIR)
    loaded = {qid: q.instructions for qid, q in sets[V0_2].questions.items()}
    assert loaded == {qid: q["instructions"] for qid, q in questions(V0_2_FILE).items()}


def copy_with_v0_2(tmp_path, change) -> object:
    directory = tmp_path / "question-sets"
    shutil.copytree(QUESTION_SETS_DIR, directory)
    data = json.loads((directory / "v0.2.json").read_text(encoding="utf-8"))
    change(data["questions"])
    (directory / "v0.2.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return directory


def test_loader_accepts_unchanged_copy(tmp_path):
    sets = loader()(copy_with_v0_2(tmp_path, lambda q: None))
    assert V0_2 in sets


def _drop(qid):
    return lambda q: q.pop(qid)


def _retype(qid, kind):
    return lambda q: q[qid].update({"type": kind})


def _rename(old, new):
    return lambda q: q.update({new: q.pop(old)})


def _add(qid):
    return lambda q: q.update({qid: {"type": "noul", "instructions": "Is the budget too small?"}})


V0_2_SHAPE_CHANGES = {
    "missing_risk_scale": _drop("risk.scale"),
    "techFit_as_noul": _retype("techFit", "noul"),
    "req_status_renamed": _rename(REQ_STATUS, "req.status"),
    "extra_question": _add("risk.budget"),
    "missing_v0_1_fit": _drop("fit"),
}


@pytest.mark.parametrize("case", sorted(V0_2_SHAPE_CHANGES))
def test_loader_refuses_v0_2_with_wrong_ids_or_types(tmp_path, case):
    from sol_ai.errors import StartupRefused

    directory = copy_with_v0_2(tmp_path, V0_2_SHAPE_CHANGES[case])
    with pytest.raises((ValueError, StartupRefused)):
        loader()(directory)
