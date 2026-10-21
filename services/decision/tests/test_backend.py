"""백엔드: FakeBackend 결정성, row_id, 지연 import(코어 모듈이 torch·transformers 를 들이지 않는다)."""

import importlib
import sys

from sol_decision import backend

CANDIDATES = [{"id": "a", "label": "a"}, {"id": "b", "label": "b"}, {"id": "c", "label": "c"}]


def _predict(fake: backend.FakeBackend, row_id: str = "r", seed: int = 0) -> list[float]:
    return fake.predict(
        state="s",
        instructions="i",
        candidates=CANDIDATES,
        decision_type="choice",
        seed=seed,
        row_id=row_id,
    )


def test_fake_backend_is_deterministic_and_normalized():
    fake = backend.FakeBackend()
    first, second = _predict(fake), _predict(fake)
    assert first == second
    assert len(first) == len(CANDIDATES)
    assert abs(sum(first) - 1) < 1e-9
    assert all(p > 0 for p in first)
    assert _predict(fake, row_id="other") != first
    assert _predict(fake, seed=1) != first


def test_row_id_is_sha256_of_qid_and_state_hash():
    row = backend.row_id_for("fit", "state text")
    assert len(row) == 64 and int(row, 16) >= 0
    assert row == backend.row_id_for("fit", "state text")
    assert row != backend.row_id_for("techFit", "state text")
    assert row != backend.row_id_for("fit", "state text!")
    # 객체 state 는 canonical JSON 으로 해시한다(키 순서 무관)
    assert backend.row_id_for("fit", {"b": 1, "a": 2}) == backend.row_id_for(
        "fit", {"a": 2, "b": 1}
    )


def test_core_modules_do_not_import_model_libraries():
    for name in ("wire", "contract", "backend", "package", "app", "settings", "serve", "logsafe"):
        importlib.import_module(f"sol_decision.{name}")
    loaded = {m.split(".")[0] for m in sys.modules}
    assert not loaded & {"torch", "transformers", "peft", "accelerate", "safetensors"}


def test_bosun_backend_rejects_unknown_dtype(tmp_path):
    import pytest

    with pytest.raises(ValueError):
        backend.BosunBackend(tmp_path, backend.FakeBackend().identity(), dtype="fp8")


def test_bosun_backend_predict_before_load_fails(tmp_path):
    import pytest

    bosun = backend.BosunBackend(tmp_path, backend.FakeBackend().identity())
    with pytest.raises(backend.BackendUnavailable, match="MODEL_NOT_LOADED"):
        bosun.predict(
            state="s",
            instructions="i",
            candidates=CANDIDATES,
            decision_type="choice",
            seed=0,
            row_id="r",
        )
