"""Configurable Web Research & Verification Service (Phase D).

Responsibilities:
- Provide a clean search-provider abstraction (`WebSearchProvider`) with implementations for:
  - DuckDuckGo Search (`JOBPILOT_SEARCH_PROVIDER=duckduckgo` via `ddgs`, no API key required)
  - Tavily Search API (`TAVILY_API_KEY`)
  - Serper Google Search API (`SERPER_API_KEY`)
  - Brave Search API (`BRAVE_SEARCH_API_KEY`)
- When a provider is configured:
  - Search for the original vacancy & official company career page.
  - Search for publicly available recruiter details relevant to the vacancy.
  - Compare extracted company name, job title, and location against public search evidence.
  - Classify evidence and comparisons into Verified Facts, Conflicting Information, or Unverified Claims.
  - NEVER label a company or recruiter as verified without supporting search evidence.
- When no provider is configured or a provider fails/times out/is rate-limited:
  - Report the limitation honestly without fabricating search results or verification badges.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

import httpx

try:
    from ddgs import DDGS
    from ddgs.exceptions import DDGSException, RatelimitException, TimeoutException as DDGSTimeoutException
except ImportError:  # pragma: no cover - optional dependency fallback
    DDGS = None  # type: ignore[assignment,misc]
    DDGSException = Exception  # type: ignore[assignment,misc]
    RatelimitException = Exception  # type: ignore[assignment,misc]
    DDGSTimeoutException = TimeoutError  # type: ignore[assignment,misc]

from app.config import BackendSettings
from app.schemas import (
    ExtractedJobFields,
    FieldComparisonResult,
    ResearchEvidenceItem,
    ResearchVerificationLiteral,
    WebResearchReport,
)


class SearchProviderError(RuntimeError):
    """Raised when a configured web search provider fails, times out, or returns invalid data."""


class RawSearchResult:
    def __init__(self, title: str, url: str, snippet: str) -> None:
        self.title = title.strip()
        self.url = url.strip()
        self.snippet = snippet.strip()


class WebSearchProvider(ABC):
    """Abstract interface for configurable web search APIs."""

    name: str

    @abstractmethod
    def search(
        self,
        query: str,
        max_results: int = 5,
        client: httpx.Client | None = None,
    ) -> list[RawSearchResult]:
        """Execute a public web search query and return normalized results."""


class TavilySearchProvider(WebSearchProvider):
    name = "tavily"

    def __init__(self, api_key: str, timeout_seconds: float = 10.0) -> None:
        self._api_key = api_key
        self._timeout = timeout_seconds

    def search(
        self,
        query: str,
        max_results: int = 5,
        client: httpx.Client | None = None,
    ) -> list[RawSearchResult]:
        should_close = client is None
        http_client = client or httpx.Client(timeout=self._timeout)
        try:
            resp = http_client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": self._api_key,
                    "query": query,
                    "max_results": max_results,
                    "include_answer": False,
                },
            )
            if resp.status_code >= 400:
                raise SearchProviderError(
                    f"Tavily Search API returned HTTP {resp.status_code}."
                )
            data = resp.json()
            if not isinstance(data, dict) or not isinstance(data.get("results"), list):
                raise SearchProviderError(
                    "Tavily Search API returned malformed JSON structure."
                )
            results: list[RawSearchResult] = []
            for item in data["results"]:
                if isinstance(item, dict) and item.get("url"):
                    results.append(
                        RawSearchResult(
                            title=str(item.get("title") or "Search Result"),
                            url=str(item.get("url")),
                            snippet=str(item.get("content") or ""),
                        )
                    )
            return results
        except httpx.TimeoutException as exc:
            raise SearchProviderError(
                f"Tavily Search API timed out after {self._timeout}s."
            ) from exc
        except httpx.RequestError as exc:
            raise SearchProviderError(
                f"Tavily Search API network error: {exc.__class__.__name__}."
            ) from exc
        except ValueError as exc:
            raise SearchProviderError(
                "Tavily Search API returned invalid JSON."
            ) from exc
        finally:
            if should_close:
                http_client.close()


class SerperSearchProvider(WebSearchProvider):
    name = "serper"

    def __init__(self, api_key: str, timeout_seconds: float = 10.0) -> None:
        self._api_key = api_key
        self._timeout = timeout_seconds

    def search(
        self,
        query: str,
        max_results: int = 5,
        client: httpx.Client | None = None,
    ) -> list[RawSearchResult]:
        should_close = client is None
        http_client = client or httpx.Client(timeout=self._timeout)
        try:
            resp = http_client.post(
                "https://google.serper.dev/search",
                headers={
                    "X-API-KEY": self._api_key,
                    "Content-Type": "application/json",
                },
                json={"q": query, "num": max_results},
            )
            if resp.status_code >= 400:
                raise SearchProviderError(
                    f"Serper Search API returned HTTP {resp.status_code}."
                )
            data = resp.json()
            if not isinstance(data, dict) or not isinstance(data.get("organic"), list):
                raise SearchProviderError(
                    "Serper Search API returned malformed JSON structure."
                )
            results: list[RawSearchResult] = []
            for item in data["organic"]:
                if isinstance(item, dict) and item.get("link"):
                    results.append(
                        RawSearchResult(
                            title=str(item.get("title") or "Search Result"),
                            url=str(item.get("link")),
                            snippet=str(item.get("snippet") or ""),
                        )
                    )
            return results
        except httpx.TimeoutException as exc:
            raise SearchProviderError(
                f"Serper Search API timed out after {self._timeout}s."
            ) from exc
        except httpx.RequestError as exc:
            raise SearchProviderError(
                f"Serper Search API network error: {exc.__class__.__name__}."
            ) from exc
        except ValueError as exc:
            raise SearchProviderError(
                "Serper Search API returned invalid JSON."
            ) from exc
        finally:
            if should_close:
                http_client.close()


class BraveSearchProvider(WebSearchProvider):
    name = "brave"

    def __init__(self, api_key: str, timeout_seconds: float = 10.0) -> None:
        self._api_key = api_key
        self._timeout = timeout_seconds

    def search(
        self,
        query: str,
        max_results: int = 5,
        client: httpx.Client | None = None,
    ) -> list[RawSearchResult]:
        should_close = client is None
        http_client = client or httpx.Client(timeout=self._timeout)
        try:
            resp = http_client.get(
                "https://api.search.brave.com/res/v1/web/search",
                headers={
                    "X-Subscription-Token": self._api_key,
                    "Accept": "application/json",
                },
                params={"q": query, "count": max_results},
            )
            if resp.status_code >= 400:
                raise SearchProviderError(
                    f"Brave Search API returned HTTP {resp.status_code}."
                )
            data = resp.json()
            web_block = data.get("web", {}) if isinstance(data, dict) else {}
            raw_list = web_block.get("results")
            if not isinstance(raw_list, list):
                raise SearchProviderError(
                    "Brave Search API returned malformed JSON structure."
                )
            results: list[RawSearchResult] = []
            for item in raw_list:
                if isinstance(item, dict) and item.get("url"):
                    results.append(
                        RawSearchResult(
                            title=str(item.get("title") or "Search Result"),
                            url=str(item.get("url")),
                            snippet=str(item.get("description") or ""),
                        )
                    )
            return results
        except httpx.TimeoutException as exc:
            raise SearchProviderError(
                f"Brave Search API timed out after {self._timeout}s."
            ) from exc
        except httpx.RequestError as exc:
            raise SearchProviderError(
                f"Brave Search API network error: {exc.__class__.__name__}."
            ) from exc
        except ValueError as exc:
            raise SearchProviderError(
                "Brave Search API returned invalid JSON."
            ) from exc
        finally:
            if should_close:
                http_client.close()


class DuckDuckGoSearchProvider(WebSearchProvider):
    """Free public web search provider using the maintained `ddgs` package (`DDGS().text()`).

    Requires no API keys. Normalizes results to `RawSearchResult(title, url, snippet)`.
    Respects provider throttling using bounded retries with exponential backoff and honest
    error reporting rather than switching search engines to evade rate limits.
    """

    name = "duckduckgo"

    def __init__(
        self,
        timeout_seconds: float = 10.0,
        max_retries: int = 0,
        retry_backoff_seconds: float = 0.75,
        sleep_fn: Callable[[float], None] = time.sleep,
        ddgs_cls: Any = None,
    ) -> None:
        self._timeout = timeout_seconds
        self._max_retries = max(0, min(max_retries, 3))
        self._retry_backoff = max(0.0, retry_backoff_seconds)
        self._sleep_fn = sleep_fn
        self._ddgs_cls = ddgs_cls

    def search(
        self,
        query: str,
        max_results: int = 5,
        client: httpx.Client | None = None,
    ) -> list[RawSearchResult]:
        cleaned_query = query.strip()
        if not cleaned_query:
            return []

        ddgs_factory = self._ddgs_cls or DDGS
        if ddgs_factory is None:
            raise SearchProviderError(
                "DuckDuckGo search requires the optional 'ddgs' package, which is not installed."
            )

        timeout_int = max(1, int(round(self._timeout)))
        raw_items: Any = None
        last_exc: Exception | None = None

        for attempt in range(self._max_retries + 1):
            try:
                ddgs_instance = ddgs_factory(timeout=timeout_int)
                if hasattr(ddgs_instance, "__enter__"):
                    with ddgs_instance as active_ddgs:
                        raw_items = active_ddgs.text(
                            cleaned_query,
                            max_results=max_results,
                            safesearch="moderate",
                            backend="duckduckgo",
                        )
                else:
                    raw_items = ddgs_instance.text(
                        cleaned_query,
                        max_results=max_results,
                        safesearch="moderate",
                        backend="duckduckgo",
                    )
                last_exc = None
                break
            except Exception as exc:
                err_msg = str(exc)
                err_lower = err_msg.lower()

                # `ddgs` raises DDGSException("No results found.") when a valid search matches 0 items
                if (
                    isinstance(exc, DDGSException)
                    and not isinstance(exc, (RatelimitException, DDGSTimeoutException))
                    and "no results" in err_lower
                ):
                    return []

                last_exc = exc
                if attempt < self._max_retries and self._retry_backoff > 0:
                    backoff_delay = self._retry_backoff * (2**attempt)
                    self._sleep_fn(backoff_delay)
                    continue

        if last_exc is not None:
            err_msg = str(last_exc)
            err_lower = err_msg.lower()

            if isinstance(last_exc, RatelimitException) or any(
                token in err_lower
                for token in ("ratelimit", "rate limit", "429", "202 ratelimit")
            ):
                raise SearchProviderError(
                    f"DuckDuckGo search rate limit exceeded: {err_msg or last_exc.__class__.__name__}."
                ) from last_exc

            if isinstance(
                last_exc, (DDGSTimeoutException, TimeoutError, httpx.TimeoutException)
            ) or ("timed out" in err_lower or "timeout" in err_lower):
                raise SearchProviderError(
                    f"DuckDuckGo search timed out after {self._timeout}s."
                ) from last_exc

            raise SearchProviderError(
                f"DuckDuckGo search error: {err_msg or last_exc.__class__.__name__}."
            ) from last_exc

        if not raw_items:
            return []
        if not isinstance(raw_items, list):
            raise SearchProviderError(
                "DuckDuckGo search returned unexpected non-list payload."
            )

        results: list[RawSearchResult] = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            url = str(item.get("href") or item.get("url") or item.get("link") or "").strip()
            if not url:
                continue
            title = str(item.get("title") or "Search Result").strip()
            snippet = str(
                item.get("body") or item.get("snippet") or item.get("description") or ""
            ).strip()
            results.append(RawSearchResult(title=title, url=url, snippet=snippet))
            if max_results and len(results) >= max_results:
                break
        return results


def create_search_provider(settings: BackendSettings) -> WebSearchProvider | None:
    if settings.search_provider in ("duckduckgo", "ddgs", "ddg"):
        return DuckDuckGoSearchProvider(
            timeout_seconds=settings.http_timeout_seconds,
            max_retries=settings.ddgs_max_retries,
            retry_backoff_seconds=settings.ddgs_retry_backoff_seconds,
        )
    if settings.search_provider == "tavily" and settings.tavily_api_key:
        return TavilySearchProvider(
            api_key=settings.tavily_api_key,
            timeout_seconds=settings.http_timeout_seconds,
        )
    if settings.search_provider == "serper" and settings.serper_api_key:
        return SerperSearchProvider(
            api_key=settings.serper_api_key,
            timeout_seconds=settings.http_timeout_seconds,
        )
    if settings.search_provider == "brave" and settings.brave_search_api_key:
        return BraveSearchProvider(
            api_key=settings.brave_search_api_key,
            timeout_seconds=settings.http_timeout_seconds,
        )
    return None


def conduct_web_research(
    extracted: ExtractedJobFields,
    settings: BackendSettings,
    provider_override: WebSearchProvider | None = None,
    client: httpx.Client | None = None,
) -> WebResearchReport:
    """Execute vacancy, company career page, and recruiter verification research.

    Never labels a company or recruiter as verified without supporting evidence.
    """
    provider = provider_override or create_search_provider(settings)

    # Record user-supplied URL if available, even when search is unconfigured
    baseline_evidence: list[ResearchEvidenceItem] = []
    if extracted.application_url:
        baseline_evidence.append(
            ResearchEvidenceItem(
                category="vacancy",
                title="User-Provided Application URL",
                url=extracted.application_url,
                snippet="Application link provided in job input; not independently verified via web search.",
                classification="unverified_claim",
            )
        )

    if provider is None:
        return WebResearchReport(
            provider_used="unconfigured",
            search_performed=False,
            verification_status="Search Not Configured",
            company_verified=False,
            recruiter_verified=False,
            summary_note=(
                "Live web search is not configured (set JOBPILOT_SEARCH_PROVIDER=duckduckgo "
                "or provide TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY on the backend). "
                "Company and recruiter claims remain unverified."
            ),
            evidence_items=baseline_evidence,
            comparisons=[
                FieldComparisonResult(
                    field_name="company",
                    extracted_value=extracted.company,
                    research_finding="Web search not configured; company identity not externally verified.",
                    status="unverified",
                ),
                FieldComparisonResult(
                    field_name="title",
                    extracted_value=extracted.title,
                    research_finding="Web search not configured; vacancy listing not cross-checked.",
                    status="unverified",
                ),
            ],
            limitations=[
                "No web search provider configured on backend.",
                "Company and recruiter identity cannot be verified without external search evidence.",
            ],
        )

    if not extracted.company and not extracted.title:
        return WebResearchReport(
            provider_used=provider.name,
            search_performed=False,
            verification_status="Unverified Claims",
            company_verified=False,
            recruiter_verified=False,
            summary_note=(
                "Insufficient job identifying details (both company and job title are null) "
                "to run targeted vacancy or recruiter web research."
            ),
            evidence_items=baseline_evidence,
            comparisons=[],
            limitations=["Both company name and job title were missing from extraction."],
        )

    evidence_items: list[ResearchEvidenceItem] = []
    limitations: list[str] = []

    company_q = extracted.company or ""
    title_q = extracted.title or ""
    location_q = extracted.location or ""

    # 1. Search for original vacancy & official company career page
    vacancy_query = f"{company_q} {title_q} {location_q} careers job".strip()
    vacancy_results: list[RawSearchResult] = []
    try:
        vacancy_results = provider.search(vacancy_query, max_results=4, client=client)
    except SearchProviderError as exc:
        limitations.append(f"Vacancy search failed ({provider.name}): {exc}")

    # 2. Search for publicly available recruiter info relevant to the vacancy
    recruiter_results: list[RawSearchResult] = []
    if company_q:
        recruiter_name_hint = extracted.contact.recruiter_name or ""
        recruiter_query = (
            f"{company_q} {recruiter_name_hint} technical recruiter talent acquisition".strip()
        )
        try:
            recruiter_results = provider.search(
                recruiter_query, max_results=3, client=client
            )
        except SearchProviderError as exc:
            limitations.append(f"Recruiter search failed ({provider.name}): {exc}")

    # Evaluate evidence & compare fields
    company_matched_in_official_source = False
    title_matched_in_results = False
    location_conflict_detected = False
    recruiter_verified = False

    company_tokens = _significant_tokens(company_q)
    title_tokens = _significant_tokens(title_q)

    for res in vacancy_results:
        combined_text = f"{res.title} {res.snippet} {res.url}".lower()
        host = urlparse(res.url).netloc.lower()

        has_company = bool(company_tokens) and all(
            tok in combined_text for tok in company_tokens[:2]
        )
        has_title = bool(title_tokens) and any(
            tok in combined_text for tok in title_tokens[:2]
        )

        # Check if location conflicts (e.g., extracted says Remote/Bengaluru, snippet explicitly says "On-site only in New York")
        is_conflict = _detect_location_conflict(extracted.location, res.snippet)
        if is_conflict:
            location_conflict_detected = True

        is_career_domain = any(
            tok in host for tok in company_tokens
        ) or any(
            portal in host
            for portal in ("linkedin.com", "naukri.com", "greenhouse.io", "lever.co", "ashbyhq.com", "workday.com")
        )

        if has_company and is_career_domain:
            company_matched_in_official_source = True
        if has_title:
            title_matched_in_results = True

        classification: Any = "unverified_claim"
        if is_conflict:
            classification = "conflicting_info"
        elif has_company and (has_title or is_career_domain):
            classification = "verified_fact"

        category: Any = (
            "company_careers"
            if ("careers" in res.url.lower() or "jobs" in res.url.lower())
            else "vacancy"
        )
        evidence_items.append(
            ResearchEvidenceItem(
                category=category,
                title=res.title,
                url=res.url,
                snippet=res.snippet[:350],
                classification=classification,
            )
        )

    for res in recruiter_results:
        combined_text = f"{res.title} {res.snippet}".lower()
        has_company = bool(company_tokens) and any(
            tok in combined_text for tok in company_tokens
        )
        has_recruiter_role = any(
            kw in combined_text
            for kw in ("recruiter", "talent acquisition", "hiring", "hr", "people")
        )
        recruiter_name_matched = False
        if extracted.contact.recruiter_name:
            rec_tokens = _significant_tokens(extracted.contact.recruiter_name)
            recruiter_name_matched = bool(rec_tokens) and all(
                t in combined_text for t in rec_tokens
            )

        if has_company and has_recruiter_role and (
            recruiter_name_matched or not extracted.contact.recruiter_name
        ):
            if recruiter_name_matched:
                recruiter_verified = True
            classification = "verified_fact" if recruiter_name_matched else "unverified_claim"
        else:
            classification = "unverified_claim"

        evidence_items.append(
            ResearchEvidenceItem(
                category="recruiter",
                title=res.title,
                url=res.url,
                snippet=res.snippet[:350],
                classification=classification,
            )
        )

    comparisons: list[FieldComparisonResult] = []
    if extracted.company:
        comparisons.append(
            FieldComparisonResult(
                field_name="company",
                extracted_value=extracted.company,
                research_finding=(
                    f"Confirmed company '{extracted.company}' in public job/career search results."
                    if company_matched_in_official_source
                    else f"Could not independently verify official career domain for '{extracted.company}'."
                ),
                status="matched" if company_matched_in_official_source else "unverified",
            )
        )

    if extracted.title:
        comparisons.append(
            FieldComparisonResult(
                field_name="title",
                extracted_value=extracted.title,
                research_finding=(
                    f"Found matching vacancy references for '{extracted.title}'."
                    if title_matched_in_results
                    else f"No exact public listing match found for title '{extracted.title}'."
                ),
                status="matched" if title_matched_in_results else "unverified",
            )
        )

    if extracted.location:
        comparisons.append(
            FieldComparisonResult(
                field_name="location",
                extracted_value=extracted.location,
                research_finding=(
                    "Detected conflicting location details in public search snippet."
                    if location_conflict_detected
                    else f"Checked location '{extracted.location}' against public snippets."
                ),
                status="conflicting"
                if location_conflict_detected
                else ("matched" if company_matched_in_official_source else "unverified"),
            )
        )

    # Determine overall verification status strictly from evidence
    overall_status: ResearchVerificationLiteral = "Unverified Claims"
    if location_conflict_detected:
        overall_status = "Conflicting Information"
    elif company_matched_in_official_source and title_matched_in_results:
        overall_status = "Verified Facts"

    search_performed = bool(vacancy_results or recruiter_results)
    if not search_performed and not limitations:
        limitations.append("Search provider returned zero matching public results.")

    summary_note = _build_research_summary(
        provider_name=provider.name,
        overall_status=overall_status,
        company_verified=company_matched_in_official_source,
        recruiter_verified=recruiter_verified,
        evidence_count=len(evidence_items),
        limitations=limitations,
    )

    return WebResearchReport(
        provider_used=provider.name,
        search_performed=search_performed,
        verification_status=overall_status,
        company_verified=company_matched_in_official_source,
        recruiter_verified=recruiter_verified,
        summary_note=summary_note,
        evidence_items=evidence_items or baseline_evidence,
        comparisons=comparisons,
        limitations=limitations,
    )


def _significant_tokens(text: str) -> list[str]:
    stop = {"inc", "llc", "ltd", "pvt", "private", "limited", "the", "and", "for", "senior", "junior"}
    tokens = [
         "".join(ch for ch in word.lower() if ch.isalnum())
        for word in text.split()
    ]
    return [t for t in tokens if len(t) >= 3 and t not in stop]


def _detect_location_conflict(extracted_loc: str | None, snippet: str) -> bool:
    if not extracted_loc or not snippet:
        return False
    ext_lower = extracted_loc.lower()
    snip_lower = snippet.lower()
    if "remote" in ext_lower and ("no remote" in snip_lower or "onsite only" in snip_lower or "on-site only" in snip_lower):
        return True
    return False


def _build_research_summary(
    provider_name: str,
    overall_status: ResearchVerificationLiteral,
    company_verified: bool,
    recruiter_verified: bool,
    evidence_count: int,
    limitations: list[str],
) -> str:
    parts = [
        f"Web research via '{provider_name}' completed with status '{overall_status}' ({evidence_count} evidence item(s))."
    ]
    if company_verified:
        parts.append("Company presence matched in public career/job sources.")
    else:
        parts.append("Company remains unverified due to lack of corroborating official domain evidence.")
    if recruiter_verified:
        parts.append("Public recruiter profile reference corroborated.")
    if limitations:
        parts.append("Limitations: " + "; ".join(limitations))
    return " ".join(parts)
