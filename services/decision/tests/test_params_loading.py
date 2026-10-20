"""`trainer.params.load_bosun` 은 패키지 검증을 지난 뒤에만 `from_pretrained(trust_remote_code=True)` 를 부른다.

torch·transformers 는 노트북에 없다. 모듈 import 가 되게 빈 `torch` 와 호출을 기록하는 가짜 `transformers` 를
sys.modules 에 넣는다(params 는 모듈 수준에서 torch 의 속성을 쓰지 않는다. 주석의 타입은 `from __future__ import annotations`).
"""

import importlib
import sys
import types

import pytest
from test_package import make_package

from sol_decision.package import PackageError


class _Loaded:
    def __init__(self) -> None:
        self.device = None
        self.evaluated = False

    def to(self, device):
        self.device = device
        return self

    def eval(self) -> None:
        self.evaluated = True


@pytest.fixture
def params(monkeypatch):
    calls: list[dict] = []

    class AutoModelForCausalLM:
        @staticmethod
        def from_pretrained(path, **kwargs):
            calls.append({"path": path, **kwargs})
            return _Loaded()

    transformers = types.ModuleType("transformers")
    transformers.AutoModelForCausalLM = AutoModelForCausalLM
    monkeypatch.setitem(sys.modules, "torch", types.ModuleType("torch"))
    monkeypatch.setitem(sys.modules, "transformers", transformers)
    sys.modules.pop("sol_decision.trainer.params", None)
    module = importlib.import_module("sol_decision.trainer.params")
    module.calls = calls
    yield module
    sys.modules.pop("sol_decision.trainer.params", None)


def test_tampered_package_is_refused_before_remote_code_runs(params, tmp_path):
    root = make_package(tmp_path)
    (root / "modeling_bosun.py").write_bytes(b"# tampered")
    with pytest.raises(PackageError) as error:
        params.load_bosun(root, device="cpu", dtype="float32")
    assert error.value.summary == "SHA256_MISMATCH(modeling_bosun.py)"
    assert params.calls == []


def test_unlisted_python_file_is_refused_before_remote_code_runs(params, tmp_path):
    root = make_package(tmp_path)
    (root / "planted.py").write_bytes(b"# not in manifest")
    with pytest.raises(PackageError) as error:
        params.load_bosun(root, device="cpu", dtype="float32")
    assert error.value.summary == "REMOTE_CODE_NOT_IN_MANIFEST(planted.py)"
    assert params.calls == []


def test_missing_config_is_package_error(params, tmp_path):
    with pytest.raises(PackageError) as error:
        params.load_bosun(tmp_path / "nowhere", device="cpu", dtype="float32")
    assert error.value.summary == "PACKAGE_DIR_MISSING"
    assert params.calls == []


def test_verified_package_loads_locally_with_remote_code(params, tmp_path):
    root = make_package(tmp_path)
    model = params.load_bosun(root, device="cpu", dtype="float32")
    assert model.device == "cpu" and model.evaluated
    assert params.calls == [
        {
            "path": str(root),
            "trust_remote_code": True,
            "local_files_only": True,
            "dtype": "float32",
        }
    ]
