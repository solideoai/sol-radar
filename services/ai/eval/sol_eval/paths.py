"""sol_eval 이 읽고 쓰는 기본 위치. 코드는 services/ai/eval, 데이터는 저장소 루트 아래."""

from pathlib import Path

from sol_ai.paths import (
    QUALIFICATION_CODES_FILE,
    QUESTION_SETS_DIR,
    REPO_ROOT,
    SCHEMA_FILE,
    STATE_TEMPLATES_DIR,
)

QUESTION_SET_VERSION = "kev-qs/v0.2"
QUESTION_SET_FILE = QUESTION_SETS_DIR / "v0.2.json"
STATE_TEMPLATE_FILES = {
    "en": STATE_TEMPLATES_DIR / "en.v0.2.txt",
    "ko": STATE_TEMPLATES_DIR / "ko.v0.2.txt",
}

# 입력 기본값. x6a/recording·x6a/companies 가 만드는 파일이 없으면 C1 녹음·솔리데오 프로필로 개발한다
DEFAULT_RECORDED_DIR = REPO_ROOT / "fixtures" / "recorded" / "train"
FALLBACK_RECORDED_DIR = REPO_ROOT / "fixtures" / "recorded" / "15129394"
DEFAULT_INDUSTRY_DIR = REPO_ROOT / "fixtures" / "recorded" / "15129467"
DEFAULT_COMPANIES_DIR = REPO_ROOT / "fixtures" / "eval" / "companies"
FALLBACK_COMPANY_FILE = REPO_ROOT / "fixtures" / "company" / "solideo-profile.json"
DEFAULT_SPLITS_FILE = REPO_ROOT / "fixtures" / "eval" / "splits.v0.1.json"
DEFAULT_OUT_DIR = REPO_ROOT / "datasets" / "sol-eval"

__all__ = [
    "DEFAULT_COMPANIES_DIR",
    "DEFAULT_INDUSTRY_DIR",
    "DEFAULT_OUT_DIR",
    "DEFAULT_RECORDED_DIR",
    "DEFAULT_SPLITS_FILE",
    "FALLBACK_COMPANY_FILE",
    "FALLBACK_RECORDED_DIR",
    "QUALIFICATION_CODES_FILE",
    "QUESTION_SET_FILE",
    "QUESTION_SET_VERSION",
    "REPO_ROOT",
    "SCHEMA_FILE",
    "STATE_TEMPLATE_FILES",
    "resolve",
]


def resolve(path: str | Path) -> Path:
    """상대 경로는 cwd 기준으로 있으면 그것을, 없으면 저장소 루트 기준으로 푼다."""
    candidate = Path(path)
    if candidate.is_absolute() or candidate.exists():
        return candidate.resolve()
    return (REPO_ROOT / candidate).resolve()
