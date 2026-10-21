"""서비스 루트만 남긴 Vercel 번들에서도 공용 규칙·mock fixture를 읽어야 한다."""

import json
import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

from support import AI_ROOT, REPO_ROOT, extract_request


def test_vercel_bundle_runs_without_repository_root(tmp_path: Path):
    repository = tmp_path / "repository"
    service = repository / "services" / "ai"
    service.mkdir(parents=True)
    for filename in ("app.py", "vercel_build.py"):
        shutil.copy2(AI_ROOT / filename, service / filename)
    for directory in ("schemas", "prompts", "guards", "dictionaries", "kev", "models"):
        shutil.copytree(AI_ROOT / directory, service / directory)
    # Vercel은 설치한 패키지를 _vendor/에 둔다. src/만 있는 로컬 환경에 기대지 않는다.
    shutil.copytree(AI_ROOT / "src" / "sol_ai", service / "_vendor" / "sol_ai")
    for directory in ("extractions", "kev"):
        shutil.copytree(REPO_ROOT / "fixtures" / directory, repository / "fixtures" / directory)
    (repository / "infra").mkdir()
    shutil.copy2(REPO_ROOT / "infra" / "run-modes.json", repository / "infra" / "run-modes.json")

    subprocess.run([sys.executable, str(service / "vercel_build.py")], check=True, cwd=tmp_path)
    deployed = tmp_path / "deployed"
    service.rename(deployed)
    shutil.rmtree(repository)
    request_file = tmp_path / "request.json"
    request_file.write_text(json.dumps(extract_request("FX-01")), encoding="utf-8")
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            textwrap.dedent("""
                import json
                import sys
                from pathlib import Path
                from app import app
                from fastapi.testclient import TestClient

                with TestClient(app) as client:
                    health = client.get('/health')
                    assert health.status_code == 200
                    assert health.json()['provider'] == 'mock'
                    body = json.loads(Path(sys.argv[1]).read_text())
                    response = client.post('/extract', json=body)
                    assert response.status_code == 200
                    assert response.json()['status'] == 'COMPLETED', response.text
            """),
            str(request_file),
        ],
        env={
            "PATH": os.environ["PATH"],
            "PYTHONPATH": os.pathsep.join((str(deployed), str(deployed / "_vendor"))),
            "SOL_RUN_MODE": "mock",
        },
        cwd=tmp_path,
        capture_output=True,
        check=False,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
