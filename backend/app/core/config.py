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
    api_title: str = "StockShock API"
    api_version: str = "0.1.0"
    db_path: str = os.getenv("FINANCE_DB_PATH", str(DEFAULT_DB_PATH))
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-5")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    cors_origins: List[str] = field(
        default_factory=lambda: [
            origin.strip()
            for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
            if origin.strip()
        ]
    )
    gradium_api_key: str = os.getenv("GRADIUM_API_KEY", "")
    gradium_region: str = os.getenv("GRADIUM_REGION", "eu")
    gradium_stt_model: str = os.getenv("GRADIUM_STT_MODEL", "default")
    gradium_tts_model: str = os.getenv("GRADIUM_TTS_MODEL", "default")
    gradium_tts_voice_id: str = os.getenv("GRADIUM_TTS_VOICE_ID", "b35yykvVppLXyw_l")
    gradium_tts_output_format: str = os.getenv("GRADIUM_TTS_OUTPUT_FORMAT", "wav")


settings = Settings()
