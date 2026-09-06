FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Keep the base image small; Playwright installs the complete Chromium
# dependency set below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt \
    && python -c "from scrapling.fetchers import StealthyFetcher; print('Scrapling StealthyFetcher is available')" \
    && python -m playwright install --with-deps chromium

COPY main.py .

EXPOSE 3100

# Render supplies PORT. Keep 3100 as a local/default fallback.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-3100}"]