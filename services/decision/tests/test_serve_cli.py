"""serve CLI: 기본값(127.0.0.1:8009), 키 없으면 exit 78, 패키지 위반 exit 78, fake 기동은 uvicorn.run 호출."""

import json

from test_package import make_package

from sol_decision import serve


def test_parser_defaults():
    args = serve.build_parser().parse_args([])
    assert args.host == "127.0.0.1"
    assert args.port == 8009
    assert args.alias == "bosun-v3.1-0.6b"
    assert args.backend == "bosun"
    assert args.device == "auto" and args.dtype == "bf16" and args.seed == 0


def test_missing_api_key_refuses_startup(capsys):
    assert serve.main(["--backend", "fake"]) == 78
    assert "DECISION_API_KEY(MISSING)" in capsys.readouterr().err


def test_bosun_backend_requires_package(monkeypatch, capsys):
    monkeypatch.setenv("DECISION_API_KEY", "k")
    assert serve.main(["--backend", "bosun"]) == 78
    assert "PACKAGE_REQUIRED" in capsys.readouterr().err


def test_tampered_package_refuses_startup(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("DECISION_API_KEY", "k")
    root = make_package(tmp_path)
    (root / "decision_embeddings.safetensors").write_bytes(b"changed")
    assert serve.main(["--backend", "fake", "--package", str(root)]) == 78
    err = capsys.readouterr().err
    assert "SHA256_MISMATCH(decision_embeddings.safetensors)" in err
    assert "k" != err.strip()


def test_fake_backend_with_valid_package_runs_uvicorn(monkeypatch, tmp_path):
    monkeypatch.setenv("DECISION_API_KEY", "k")
    monkeypatch.setenv("DECISION_RUN", "bosun-sol-lora-v0.1")
    captured = {}

    def fake_run(app, host, port):
        captured["app"], captured["host"], captured["port"] = app, host, port

    monkeypatch.setattr(serve.uvicorn, "run", fake_run)
    root = make_package(tmp_path)
    assert serve.main(["--backend", "fake", "--package", str(root), "--port", "8010"]) == 0
    assert captured["host"] == "127.0.0.1" and captured["port"] == 8010
    from fastapi.testclient import TestClient

    client = TestClient(captured["app"])
    model = client.get("/v1/models", headers={"Authorization": "Bearer k"}).json()["data"][0]
    assert model["run"] == "bosun-sol-lora-v0.1"
    assert (
        model["lora"]
        == json.loads((root / "manifest.json").read_text())["files"][
            "adapter/adapter_model.safetensors"
        ]
    )


def test_explicit_host_flag_only(monkeypatch, capsys):
    monkeypatch.setenv("DECISION_API_KEY", "k")
    monkeypatch.setenv("DECISION_HOST", "0.0.0.0")
    captured = {}
    monkeypatch.setattr(serve.uvicorn, "run", lambda app, host, port: captured.update(host=host))
    assert serve.main(["--backend", "fake"]) == 0
    # env 로는 바인딩을 바꾸지 못한다. --host 로만
    assert captured["host"] == "127.0.0.1"
    monkeypatch.setattr(serve.uvicorn, "run", lambda app, host, port: captured.update(host=host))
    assert serve.main(["--backend", "fake", "--host", "0.0.0.0"]) == 0
    assert captured["host"] == "0.0.0.0"


def test_bosun_without_model_dependencies_refuses(monkeypatch, tmp_path, capsys):
    """torch 가 없는 환경(노트북·CI)에서 --backend bosun 은 MODEL_DEPENDENCIES_MISSING 으로 거부한다."""
    import builtins

    monkeypatch.setenv("DECISION_API_KEY", "k")
    real_import = builtins.__import__

    def no_torch(name, *args, **kwargs):
        if name.split(".")[0] in {"torch", "transformers"}:
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_torch)
    assert serve.main(["--backend", "bosun", "--package", str(make_package(tmp_path))]) == 78
    assert "MODEL_DEPENDENCIES_MISSING" in capsys.readouterr().err


def test_queue_and_ko_state_settings_reach_server_config(monkeypatch, tmp_path):
    monkeypatch.setenv("DECISION_API_KEY", "k")
    monkeypatch.setenv("DECISION_MAX_QUEUE", "2")
    monkeypatch.setenv("DECISION_ALLOW_KO_STATE", "true")
    captured = {}

    def fake_create_app(backend, config, **_):
        captured["config"] = config
        return object()

    monkeypatch.setattr(serve, "create_app", fake_create_app)
    monkeypatch.setattr(serve.uvicorn, "run", lambda app, **kwargs: None)
    assert serve.main(["--backend", "fake", "--package", str(make_package(tmp_path))]) == 0
    assert (captured["config"].max_queue, captured["config"].allow_ko_state) == (2, True)


def test_queue_and_ko_state_defaults_are_safe(monkeypatch, tmp_path):
    monkeypatch.setenv("DECISION_API_KEY", "k")
    captured = {}
    monkeypatch.setattr(
        serve, "create_app", lambda backend, config, **_: captured.setdefault("config", config)
    )
    monkeypatch.setattr(serve.uvicorn, "run", lambda app, **kwargs: None)
    assert serve.main(["--backend", "fake", "--package", str(make_package(tmp_path))]) == 0
    assert (captured["config"].max_queue, captured["config"].allow_ko_state) == (4, False)
