"""Loads all configuration from .env. No hardcoded values, no other module touches os.environ."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


class Settings:
    APP_ENV = os.getenv("APP_ENV", "development")

    SUPABASE_URL = os.environ["SUPABASE_URL"]
    SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
    SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").strip().lower()
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
    RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
    RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "")
    DATABASE_URL = os.getenv("DATABASE_URL", "")


settings = Settings()
