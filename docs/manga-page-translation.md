# ComiHub manga-page translation

**Status:** The reader translation feature is deployed and has passed a synthetic production smoke test. The user opts in from Reader Settings, then uses a floating action slightly below screen center on the right to translate the current page. Translation overlays are drawn over the original text without modifying the page image.

## Reader behavior

The persistent **AI page translation** setting is off by default. When enabled, an `IntersectionObserver` checks IndexedDB and then the shared cache only for visible pages and one page ahead; a cache miss never starts AI work in the background. The floating **Translate** action and the toolbar's language/provider sheet translate the current page only after an explicit tap, including pages in chapters automatically appended in continuous vertical/webtoon reading. The browser first tries ComiHub's approved same-origin media route for its explicitly supported image hosts, then normal CORS-enabled image URLs. It preserves the whole page while resizing/compressing it to WebP, and caps the binary image at 1.75 MB before posting it to `POST /api/ai/translate-page`.

The app-shell service-worker cache is `comihub-static-v22` (bumped from v21 for this reader reliability update); the worker keeps downloaded chapter image caches intact across shell updates.

The server asks a vision model for translated text plus per-region coordinates in a normalized `0..1000` image coordinate space. The reader maps those coordinates back to the displayed image and draws white boxes with dark translated text. Double-clicking or long-pressing a translation opens actions to copy the original text or translation. Cache identity uses SHA-256 of the exact compressed image sent to the backend, source and target languages, and the `page-overlay-v1` translation revision. The browser keeps up to 1,000 results in IndexedDB; a narrowly scoped Supabase RPC can retrieve a shared result by cache key, while only the backend can access the table directly. Shared entries store text/coordinates and bounded source metadata, never page images or source URLs, and expire after 180 days. Expired rows are pruned in bounded batches. This content-based identity also allows an identical page image to be reused across chapters or sources without trusting their URLs.

Image recognition and box placement are model-generated, so lettering, unusual page layouts, low-resolution images, or very long webtoon strips may produce inaccurate or incomplete results. One whole-page request is the simplest initial control and can translate all visible text in one pass.

### Interaction choice: page vs. bubble

The current-page button is the better default: it is predictable, easy to use, translates every bubble in one request, and is fully covered by shared caching. A one-tap bubble-only option could reduce vision input and output when the reader needs just one bubble, but a point tap alone does not provide reliable bubble bounds. The robust low-cost follow-up would be an optional **select-region** mode (drag a box around one bubble, crop locally, translate only that crop, and map the returned coordinates back to the page). It should be an additional mode, not replace page translation; it was not included in this pass.

The translator does **not** bypass a source's access controls. If a source blocks CORS and is not covered by an existing approved ComiHub media proxy, translation reports that the image cannot be read. The source-media proxy revalidates every redirect against the same source-specific allowlist and requires HTTPS, the default port, no URL credentials, and no more than five redirects; automatic redirect following is disabled. It does not fetch an unapproved redirect destination.

## Searchable language preferences and image-read fix

- Source and target language choices are searchable. The target list contains 95 supported languages; source language includes **Auto-detect** plus the same list. Translation quality still depends on the selected provider's actual language capabilities.
- The source and target choices persist in local storage. Changing the target clears only the currently displayed overlays so that the selected language is shown; it does **not** delete local IndexedDB records or shared Supabase cache entries. Cache identity remains language-specific, and the `page-overlay-v1` revision is unchanged, preserving valid translations already cached for each language.
- The reader now tries the ComiHub same-origin route first for image URLs on exact hosts already authorized in `SOURCE_MEDIA_HOSTS`. Unknown source hosts remain direct and require normal CORS; the proxy allowlist was not broadened. If a response is labeled `application/octet-stream`, the browser's decoder must still successfully decode the bytes before translation can continue.
- The user's message “The page image could not be read for translation” is emitted before a page-image request reaches a model provider. A prior live synthetic-image test returned a successful Gemini translation, so this specific reader error points to image access, not by itself to a Gemini/API outage. The UI now distinguishes browser CORS/network failures from HTTP errors returned by the source or approved media route.
- The service-media redirect predicate was tested against approved exact/subdomain hosts and rejected unapproved hosts, suffix lookalikes, HTTP downgrades, nonstandard ports, URL credentials, and loopback addresses. Frontend and backend language allowlists match exactly.

## Provider allocation

| Purpose | Key selection | Model / behavior |
|---|---|---|
| Comi AI chat | `GEMINI_CHAT_API_KEY`, falling back to `GEMINI_API_KEY_1` | Existing Gemini chat model (`GEMINI_CHAT_MODEL`, default `gemini-2.5-flash`). Chat no longer consumes the dedicated Gemini translation key. |
| Page translation | `GEMINI_TRANSLATION_API_KEY`, falling back to `GEMINI_API_KEY_2` | `gemini-3.5-flash-lite`, chosen for low-latency multimodal OCR/translation. |
| Translation fallback | `OPENROUTER_TRANSLATION_API_KEY`, falling back to the first configured `OPENROUTER_API_KEY` / numbered OpenRouter key | `openrouter/free`, not the chat route's `openrouter/auto`. OpenRouter's free router filters for required capabilities such as image understanding before choosing an available free model. |

The reader's default route tries Gemini first, then OpenRouter Free, then any configured compatible free vision providers. Users may also select Gemini-only or OpenRouter-Free-only. Free-tier quotas and service availability still apply; this is **not** unlimited inference and the code does not rotate API keys to evade provider limits. Google's current Gemini pricing page says free-tier submissions may be used to improve Google products; the reader discloses that before sending a page. A Gemini project on a paid billing tier may incur charges according to Google's current pricing, so keep the API project on the intended free tier and monitor provider usage.

## Adding compatible providers

To support other providers without changing the reader UI, set `COMIHUB_TRANSLATION_COMPAT_PROVIDERS` on the backend to a JSON array of OpenAI-compatible **multimodal vision** endpoints. Keep each API key in its own secret environment variable and reference only the variable name:

```json
[
  {
    "name": "Provider display name",
    "baseUrl": "https://api.provider.example/v1",
    "model": "organization/vision-model:free",
    "apiKeyEnv": "PROVIDER_VISION_API_KEY",
    "free": true,
    "vision": true
  }
]
```

Each entry must explicitly set `free` and `vision` to `true`, use HTTPS, and support the OpenAI-compatible `/chat/completions` image content format. Entries marked paid or text-only are ignored. The server accepts up to 100 entries and tries at most the first three compatible entries after the built-in free providers to keep fallback latency bounded. Providers with proprietary APIs or incompatible image formats need a server adapter; an API key alone does not make an arbitrary provider compatible.

## API contract

`POST /api/ai/translate-page`

Request JSON fields: `imageDataUrl` (WebP/JPEG/PNG data URL, capped server-side), `sourceLanguage`, `targetLanguage`, `providerMode` (`auto`, `gemini`, or `openrouter`), and optional source/chapter/page metadata. The API validates the image and source/target languages, computes the authoritative digest/cache key, checks the shared cache before invoking a provider, and returns translated regions, provider label, cache key, image digest, and cache-hit state. It never returns or logs API-key values. Chat remains capped at 20 requests per hour per client IP; page translation has a separate 60-request hourly limit and shares the existing concurrency queue.

## Production verification (2026-10-11)

- Render fallback `comihub-backend.onrender.com` was manually deployed from `main` at commit `c2e7ed4` (deploy `dep-db5c39nlot8c73eeclo0`, status `live`). The primary Render service remains suspended; Vercel's production proxy reaches this fallback.
- Direct backend `/api/healthz` returned HTTP `200`. An empty-image POST to `/api/ai/translate-page` returned the expected HTTP `400` before any model call.
- A one-off synthetic speech-bubble image was sent through the production Vercel route using Gemini Flash-Lite. It returned HTTP `200`, one positioned region, and translated `HELLO WORLD!` to `¡HOLA MUNDO!`. No manga/source image or user data was sent.
- The result was persisted in the shared Supabase translation cache. It stores only the text/coordinates and cache metadata, not the test image. The synthetic test row expires after 180 days.
- Vercel deployment `dpl_5ExSmCHA9qCfHUrTpWeA57Atz2mN` for proxy commit `c2e7ed4` is `READY`. Fallback auto-deploy is disabled, so manually deploy it after future backend commits.
- Follow-up changes to source-image access, redirect validation, and language selection were built and type-checked on 2026-10-11. The frontend production build and backend typecheck/build passed; the full frontend typecheck still reports unrelated existing errors only in `source-browse.tsx`. Current deployment status is recorded in the shared Craft project memory.

## Official references

- [Google Gemini models](https://ai.google.dev/gemini-api/docs/models) — model availability and supported input modalities.
- [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) — current free-tier and paid-tier terms.
- [Google's OpenAI-compatible API](https://ai.google.dev/gemini-api/docs/openai) — chat-completions compatibility.
- [OpenRouter Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router) — free model selection and capability filtering, including image understanding.
- [OpenRouter multimodal inputs](https://openrouter.ai/docs/guides/overview/multimodal/overview) — base64 image content support.
