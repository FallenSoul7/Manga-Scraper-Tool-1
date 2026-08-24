# Scrapling Bypass Server

A dedicated Python microservice that uses [Scrapling](https://github.com/D4Vinci/Scrapling) to bypass Cloudflare and anti-bot protections for all manga source extensions.

## Why this exists

Several manga sources (ComickFan, AllManga video CDN, Utoon, etc.) are protected by Cloudflare or are fully JavaScript-rendered. Node.js HTTP requests get blocked. This service uses Scrapling's `StealthyFetcher` — a headless Chromium browser with fingerprint spoofing and automatic Cloudflare challenge solving — to fetch pages that normal requests cannot.

## Architecture

```
Node.js API Server  ──HTTP──>  Python Bypass Server  ──Scrapling──>  Target Website
     (port 3001)                   (port 3100)                        (Cloudflare-protected)
```

Every source extension can call this service. The Node.js side tries normal HTTP first; if that fails (Cloudflare challenge, 403, empty response), it automatically falls back to this bypass service.

## Setup

```bash
cd artifacts/bypass-server
pip install -r requirements.txt
python -m playwright install chromium
python -m playwright install-deps  # Linux: install system dependencies

# Start the server
python main.py
# or: uvicorn main:app --host 0.0.0.0 --port 3100
```

## API

### `POST /fetch`

Fetch a URL using Scrapling's StealthyFetcher (bypasses Cloudflare).

**Request body:**
```json
{
  "url": "https://comickfan.com/manga/slug/chapter-1-hashId",
  "wait_for": "network_idle",
  "timeout": 30,
  "referer": "https://comickfan.com/",
  "extract_images": false,
  "css_selector": null,
  "solve_cloudflare": true
}
```

**Response:**
```json
{
  "status": 200,
  "html": "<html>...",
  "url": "https://comickfan.com/manga/...",
  "images": [],
  "text": "...",
  "error": null
}
```

### `GET /health`

Health check — returns `{"status": "ok"}`.

## Concurrent requests

The server uses a semaphore to limit concurrent browser instances (default: 3). Requests are queued and processed in parallel up to the limit. This allows multiple extensions to bypass different websites simultaneously.

## Configuration

| env var          | default | description                                      |
|------------------|---------|--------------------------------------------------|
| `BYPASS_PORT`    | 3100    | Port the server listens on                        |
| `MAX_CONCURRENT` | 3       | Max concurrent browser instances                  |
| `BYPASS_TIMEOUT` | 60      | Default fetch timeout in seconds                  |
