"""데이터 파일 경로. 코드는 패키지(src/sol_ai) 안에, 데이터는 services/ai 아래 03 이 정한 자리에 둔다."""

from pathlib import Path

# src/sol_ai/paths.py -> services/ai
AI_ROOT = Path(__file__).resolve().parents[2]
# src/sol_ai/paths.py -> 저장소 루트
REPO_ROOT = Path(__file__).resolve().parents[4]
DEPLOYMENT_DATA_DIR = AI_ROOT / "_vercel_data"

SCHEMA_FILE = AI_ROOT / "schemas" / "requirement-extraction.v0.1.json"
PROMPT_FILE = AI_ROOT / "prompts" / "req-extract.v0.1.md"
INJECTION_PATTERNS_FILE = AI_ROOT / "guards" / "injection-patterns.yaml"
QUALIFICATION_CODES_FILE = AI_ROOT / "dictionaries" / "qualification-codes.yaml"
QUESTION_SETS_DIR = AI_ROOT / "kev" / "question-sets"
REGISTRY_FILE = AI_ROOT / "models" / "registry.yaml"
STATE_TEMPLATES_DIR = AI_ROOT / "kev" / "state-templates"
THRESHOLDS_FILE = AI_ROOT / "kev" / "thresholds.v0.1.json"


def fixtures_dir(override: str | None) -> Path:
    """명시 경로 → 저장소 정본 → 독립 배포 번들. 개발 때 오래된 빌드 복사본을 읽지 않는다."""
    if override:
        return Path(override)
    source = REPO_ROOT / "fixtures"
    return source if source.is_dir() else DEPLOYMENT_DATA_DIR / "fixtures"
