from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List

from dotenv import load_dotenv


load_dotenv()

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
DEFAULT_DB_PATH = DATA_DIR / "finance.db"


@dataclass(frozen=True)
class Settings:
    api_title: str = "FinanceFlip API"
    api_version: str = "0.1.0"
    db_path: str = os.getenv("FINANCE_DB_PATH", str(DEFAULT_DB_PATH))
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-5")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    cors_origins: List[str] = field(
        default_factory=lambda: [
            origin.strip()
            for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
            if origin.strip()
        ]
    )


settings = Settings()
