"""Environment-based configuration for the JobPilot AI FastAPI backend.

All API keys remain strictly server-side and are never returned in responses or logs.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _clean_key(raw: str | None) -> str:
    if not raw:
        return ""
    val = raw.strip()
    # Treat placeholder values from .env.example as unconfigured
    placeholders = {
        "your_gemini_api_key_here",
        "your_openai_api_key_here",
        "your_tavily_api_key_here",
        "your_serper_api_key_here",
        "your_brave_search_api_key_here",
        "changeme",
        "none",
    }
    if val.lower() in placeholders:
        return ""
    return val


@dataclass(frozen=True)
class BackendSettings:
    ai_provider: str = "none"  # "gemini" | "openai" | "none"
    gemini_api_key: str = field(repr=False, default="")
    gemini_model: str = "gemini-2.5-flash"
    openai_api_key: str = field(repr=False, default="")
    openai_model: str = "gpt-4o-mini"

    search_provider: str = "none"  # "duckduckgo" | "tavily" | "serper" | "brave" | "none"
    tavily_api_key: str = field(repr=False, default="")
    serper_api_key: str = field(repr=False, default="")
    brave_search_api_key: str = field(repr=False, default="")

    # Authentication & API protection
    require_auth: bool = False
    api_auth_token: str = field(repr=False, default="")

    # Rate limiting & Request limits
    rate_limit_enabled: bool = True
    rate_limit_rpm: int = 60
    expensive_rate_limit_rpm: int = 15
    max_request_bytes: int = 15 * 1024 * 1024  # 15 MB

    # Request timeouts & limits
    http_timeout_seconds: float = 10.0
    assist_timeout_seconds: float = 15.0
    enable_browser_automation: bool = False  # Disabled by default in production
    max_image_bytes: int = 8 * 1024 * 1024  # 8 MB
    max_resume_bytes: int = 10 * 1024 * 1024  # 10 MB

    # DuckDuckGo search throttling / retry safeguards
    ddgs_max_retries: int = 1
    ddgs_retry_backoff_seconds: float = 0.75

    # Deterministic explainable job match weights (default sum = 1.0)
    match_weight_skills: float = 0.55
    match_weight_experience: float = 0.25
    match_weight_education_certs: float = 0.10
    match_weight_role_location: float = 0.10

    cors_origins: list[str] = field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )
    cors_origin_regex: str | None = None

    # SaaS Multi-Tenant Database, Auth & Billing Settings
    db_path: str = "backend/data/jobpilot.db"
    jwt_secret: str = field(repr=False, default="")
    pbkdf2_iterations: int = 100000
    stripe_secret_key: str = field(repr=False, default="")
    stripe_webhook_secret: str = field(repr=False, default="")

    @property
    def vision_ai_configured(self) -> bool:
        if self.ai_provider == "gemini":
            return bool(self.gemini_api_key)
        if self.ai_provider == "openai":
            return bool(self.openai_api_key)
        return False

    @property
    def active_ai_provider_name(self) -> str:
        if self.ai_provider == "gemini" and self.gemini_api_key:
            return f"gemini ({self.gemini_model})"
        if self.ai_provider == "openai" and self.openai_api_key:
            return f"openai ({self.openai_model})"
        return "unconfigured"

    @property
    def web_search_configured(self) -> bool:
        if self.search_provider in ("duckduckgo", "ddgs", "ddg"):
            return True
        if self.search_provider == "tavily":
            return bool(self.tavily_api_key)
        if self.search_provider == "serper":
            return bool(self.serper_api_key)
        if self.search_provider == "brave":
            return bool(self.brave_search_api_key)
        return False

    @property
    def active_search_provider_name(self) -> str:
        if self.search_provider in ("duckduckgo", "ddgs", "ddg"):
            return "duckduckgo"
        if self.search_provider == "tavily" and self.tavily_api_key:
            return "tavily"
        if self.search_provider == "serper" and self.serper_api_key:
            return "serper"
        if self.search_provider == "brave" and self.brave_search_api_key:
            return "brave"
        return "unconfigured"


def _normalize_search_provider(raw: str) -> str:
    val = raw.strip().lower()
    if val in ("duckduckgo", "ddgs", "ddg"):
        return "duckduckgo"
    return val


def load_settings() -> BackendSettings:
    ai_provider = os.getenv("JOBPILOT_AI_PROVIDER", "none").strip().lower()
    raw_search_provider = os.getenv(
        "JOBPILOT_SEARCH_PROVIDER",
        os.getenv("SEARCH_PROVIDER", "none"),
    )
    search_provider = _normalize_search_provider(raw_search_provider)

    gemini_key = _clean_key(os.getenv("GEMINI_API_KEY"))
    openai_key = _clean_key(os.getenv("OPENAI_API_KEY"))
    tavily_key = _clean_key(os.getenv("TAVILY_API_KEY"))
    serper_key = _clean_key(os.getenv("SERPER_API_KEY"))
    brave_key = _clean_key(os.getenv("BRAVE_SEARCH_API_KEY"))

    # Auto-detect if user set an API key without explicitly setting provider variable
    if ai_provider == "none":
        if gemini_key:
            ai_provider = "gemini"
        elif openai_key:
            ai_provider = "openai"

    if search_provider == "none":
        if tavily_key:
            search_provider = "tavily"
        elif serper_key:
            search_provider = "serper"
        elif brave_key:
            search_provider = "brave"

    try:
        timeout = float(os.getenv("JOBPILOT_HTTP_TIMEOUT_SECONDS", "10"))
    except ValueError:
        timeout = 10.0

    try:
        assist_timeout = float(os.getenv("JOBPILOT_ASSIST_TIMEOUT_SECONDS", "15"))
    except ValueError:
        assist_timeout = 15.0

    # Browser automation disabled by default in production; require explicit opt-in
    enable_automation = os.getenv("JOBPILOT_ENABLE_BROWSER_AUTOMATION", "false").lower() in (
        "true",
        "1",
        "yes",
        "on",
    )

    auth_token = _clean_key(os.getenv("JOBPILOT_API_AUTH_TOKEN") or os.getenv("JOBPILOT_AUTH_TOKEN"))
    require_auth_raw = os.getenv("JOBPILOT_REQUIRE_AUTH", "").strip().lower()
    if require_auth_raw in ("true", "1", "yes", "on"):
        require_auth = True
    elif require_auth_raw in ("false", "0", "no", "off"):
        require_auth = False
    else:
        require_auth = bool(auth_token)

    rate_limit_enabled = os.getenv("JOBPILOT_RATE_LIMIT_ENABLED", "true").lower() in (
        "true",
        "1",
        "yes",
        "on",
    )
    try:
        rate_limit_rpm = max(1, int(os.getenv("JOBPILOT_RATE_LIMIT_RPM", "60")))
    except ValueError:
        rate_limit_rpm = 60

    try:
        expensive_rate_limit_rpm = max(
            1, int(os.getenv("JOBPILOT_EXPENSIVE_RATE_LIMIT_RPM", "15"))
        )
    except ValueError:
        expensive_rate_limit_rpm = 15

    try:
        max_req_bytes = int(
            os.getenv("JOBPILOT_MAX_REQUEST_BYTES", str(15 * 1024 * 1024))
        )
    except ValueError:
        max_req_bytes = 15 * 1024 * 1024

    try:
        max_bytes = int(os.getenv("JOBPILOT_MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))
    except ValueError:
        max_bytes = 8 * 1024 * 1024

    try:
        max_resume = int(os.getenv("JOBPILOT_MAX_RESUME_BYTES", str(10 * 1024 * 1024)))
    except ValueError:
        max_resume = 10 * 1024 * 1024

    try:
        ddgs_retries = int(os.getenv("JOBPILOT_DDGS_MAX_RETRIES", "1"))
    except ValueError:
        ddgs_retries = 1

    try:
        ddgs_backoff = float(os.getenv("JOBPILOT_DDGS_RETRY_BACKOFF_SECONDS", "0.75"))
    except ValueError:
        ddgs_backoff = 0.75

    def _parse_weight(env_name: str, default: float) -> float:
        try:
            val = float(os.getenv(env_name, str(default)))
            return max(0.0, min(1.0, val))
        except ValueError:
            return default

    w_skills = _parse_weight("JOBPILOT_MATCH_WEIGHT_SKILLS", 0.55)
    w_exp = _parse_weight("JOBPILOT_MATCH_WEIGHT_EXPERIENCE", 0.25)
    w_edu = _parse_weight("JOBPILOT_MATCH_WEIGHT_EDUCATION_CERTS", 0.10)
    w_role = _parse_weight("JOBPILOT_MATCH_WEIGHT_ROLE_LOCATION", 0.10)

    raw_origins = os.getenv(
        "JOBPILOT_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    )
    origins = [o.strip() for o in raw_origins.split(",") if o.strip()]

    raw_regex = os.getenv("JOBPILOT_CORS_ORIGIN_REGEX", "").strip() or None

    return BackendSettings(
        require_auth=require_auth,
        api_auth_token=auth_token,
        rate_limit_enabled=rate_limit_enabled,
        rate_limit_rpm=rate_limit_rpm,
        expensive_rate_limit_rpm=expensive_rate_limit_rpm,
        max_request_bytes=max_req_bytes,
        ai_provider=ai_provider,
        gemini_api_key=gemini_key,
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip(),
        openai_api_key=openai_key,
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip(),
        search_provider=search_provider,
        tavily_api_key=tavily_key,
        serper_api_key=serper_key,
        brave_search_api_key=brave_key,
        http_timeout_seconds=max(1.0, min(timeout, 60.0)),
        assist_timeout_seconds=max(1.0, min(assist_timeout, 60.0)),
        enable_browser_automation=enable_automation,
        max_image_bytes=max(1024, max_bytes),
        max_resume_bytes=max(1024, max_resume),
        ddgs_max_retries=max(0, min(ddgs_retries, 3)),
        ddgs_retry_backoff_seconds=max(0.0, min(ddgs_backoff, 10.0)),
        match_weight_skills=w_skills,
        match_weight_experience=w_exp,
        match_weight_education_certs=w_edu,
        match_weight_role_location=w_role,
        cors_origins=origins,
        cors_origin_regex=raw_regex,
        db_path=os.getenv("JOBPILOT_DB_PATH", "backend/data/jobpilot.db").strip(),
        jwt_secret=os.getenv("JOBPILOT_JWT_SECRET", "").strip(),
        pbkdf2_iterations=int(os.getenv("JOBPILOT_PBKDF2_ITERATIONS", "100000")),
        stripe_secret_key=_clean_key(os.getenv("STRIPE_SECRET_KEY")),
        stripe_webhook_secret=_clean_key(os.getenv("STRIPE_WEBHOOK_SECRET")),
    )
