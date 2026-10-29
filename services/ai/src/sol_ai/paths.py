"""데이터 파일 경로. 코드는 패키지(src/sol_ai) 안에, 데이터는 services/ai 아래 03 이 정한 자리에 둔다."""

from pathlib import Path

# src/sol_ai/paths.py -> services/ai
AI_ROOT = Path(__file__).resolve().parents[2]
# src/sol_ai/paths.py -> 저장소 루트
REPO_ROOT = Path(__file__).resolve().parents[4]

SCHEMA_FILE = AI_ROOT / "schemas" / "requirement-extraction.v0.1.json"
PROMPT_FILE = AI_ROOT / "prompts" / "req-extract.v0.1.md"
INJECTION_PATTERNS_FILE = AI_ROOT / "guards" / "injection-patterns.yaml"
QUALIFICATION_CODES_FILE = AI_ROOT / "dictionaries" / "qualification-codes.yaml"
QUESTION_SETS_DIR = AI_ROOT / "kev" / "question-sets"
REGISTRY_FILE = AI_ROOT / "models" / "registry.yaml"
STATE_TEMPLATES_DIR = AI_ROOT / "kev" / "state-templates"
THRESHOLDS_FILE = AI_ROOT / "kev" / "thresholds.v0.1.json"
INSIGHT_PROMPT_FILE = AI_ROOT / "prompts" / "insight.v0.1.md"
INSIGHT_SCHEMA_FILE = AI_ROOT / "schemas" / "insight.v0.1.json"


def fixtures_dir(override: str | None) -> Path:
    """mock 이 읽는 fixture 루트. env SOL_FIXTURES_DIR 이 우선이고, 없으면 저장소의 fixtures/."""
    return Path(override) if override else REPO_ROOT / "fixtures"
