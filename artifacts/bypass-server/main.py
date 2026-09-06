"""
Scrapling Bypass Server
========================
A FastAPI microservice that uses Scrapling's StealthyFetcher to bypass
Cloudflare and anti-bot protections for all manga source extensions.

The Node.js API server calls this service when normal HTTP requests fail
(403, Cloudflare challenge, empty JS-rendered pages). This service launches
a headless Chromium browser with fingerprint spoofing and automatic
Cloudflare challenge solving, then returns the fully rendered page HTML.

Run:  python main.py
      uvicorn main:app --host 0.0.0.0 --port 3100
"""

import asyncio
import os
import logging
from typing import Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("bypass-server")

app = FastAPI(title="Scrapling Bypass Server", version="1.0.0")

MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "3"))
DEFAULT_TIMEOUT = int(os.environ.get("BYPASS_TIMEOUT", "60"))
_semaphore = asyncio.Semaphore(MAX_CONCURRENT)

# Track active browser sessions for graceful shutdown
_active_sessions = set()


class FetchRequest(BaseModel):
    """Request to fetch a URL through the Scrapling bypass service."""
    url: str = Field(..., description="The URL to fetch")
    wait_for: str = Field("network_idle", description="Wait condition: 'network_idle', 'dom_loaded', or 'none'")
    timeout: int = Field(DEFAULT_TIMEOUT, description="Fetch timeout in seconds")
    referer: Optional[str] = Field(None, description="Referer header to set")
    extract_images: bool = Field(False, description="Extract image URLs from the page")
    css_selector: Optional[str] = Field(None, description="Extract text from elements matching this CSS selector")
    solve_cloudflare: bool = Field(True, description="Automatically solve Cloudflare challenges")


class FetchResponse(BaseModel):
    """Response from a bypass fetch."""
    status: int = 200
    html: str = ""
    url: str = ""
    images: list[str] = Field(default_factory=list)
    text: str = ""
    error: Optional[str] = None


@app.get("/health")
async def health():
    try:
        from scrapling.fetchers import StealthyFetcher  # noqa: F401
        bypass_ready = True
    except Exception:
        bypass_ready = False
    return {
        "status": "ok" if bypass_ready else "degraded",
        "bypass_ready": bypass_ready,
        "concurrent_slots": MAX_CONCURRENT,
        "active": len(_active_sessions),
    }


@app.post("/fetch", response_model=FetchResponse)
async def fetch(req: FetchRequest):
    """
    Fetch a URL using Scrapling's StealthyFetcher.

    This bypasses Cloudflare Turnstile/Interstitial, renders JavaScript,
    and returns the full page HTML. Multiple concurrent requests are supported
    up to MAX_CONCURRENT (default 3) simultaneous browser instances.
    """
    async with _semaphore:
        session_id = id(asyncio.current_task())
        _active_sessions.add(session_id)
        try:
            return await _do_fetch(req)
        finally:
            _active_sessions.discard(session_id)


async def _do_fetch(req: FetchRequest) -> FetchResponse:
    """Execute the actual Scrapling fetch in a thread pool."""
    try:
        from scrapling.fetchers import StealthyFetcher
    except ImportError:
        return FetchResponse(
            status=500,
            error="Scrapling is not installed. Run: pip install -r requirements.txt && python -m playwright install chromium",
        )

    # Build Scrapling fetch kwargs
    kwargs = {
        "headless": True,
        "solve_cloudflare": req.solve_cloudflare,
        "network_idle": req.wait_for == "network_idle",
        "timeout": req.timeout * 1000,  # Scrapling uses milliseconds
    }

    if req.referer:
        kwargs["extra_headers"] = {"Referer": req.referer}

    # Run the blocking Scrapling fetch in a thread pool so it doesn't
    # block the asyncio event loop. This allows concurrent requests.
    loop = asyncio.get_event_loop()
    try:
        page = await loop.run_in_executor(
            None,
            lambda: StealthyFetcher.fetch(req.url, **kwargs),
        )
    except Exception as exc:
        logger.error(f"Fetch failed for {req.url}: {exc}")
        return FetchResponse(status=502, error=f"Scrapling fetch failed: {exc}")

    html_content = page.body.decode("utf-8", errors="replace") if isinstance(page.body, bytes) else str(page.body)
    final_url = str(page.url) if hasattr(page, "url") else req.url
    status_code = page.status if hasattr(page, "status") else 200

    images: list[str] = []
    if req.extract_images:
        try:
            for img in page.css("img"):
                for attr in ("src", "data-src", "data-original", "data-lazy-src"):
                    val = img.attrib.get(attr, "")
                    if val and not val.startswith("data:") and val not in images:
                        images.append(val)
                        break
        except Exception:
            pass

    extracted_text = ""
    if req.css_selector:
        try:
            elements = page.css(req.css_selector)
            extracted_text = "\n".join(el.text for el in elements if el.text)
        except Exception:
            pass

    return FetchResponse(
        status=status_code,
        html=html_content,
        url=final_url,
        images=images,
        text=extracted_text,
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("BYPASS_PORT", "3100"))
    logger.info(f"Starting Scrapling Bypass Server on port {port}")
    logger.info(f"  Max concurrent: {MAX_CONCURRENT}")
    logger.info(f"  Default timeout: {DEFAULT_TIMEOUT}s")
    uvicorn.run(app, host="0.0.0.0", port=port)
