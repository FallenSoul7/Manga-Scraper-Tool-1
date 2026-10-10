# ComiHub manga-page translation

**Status:** implementation is complete and validated locally, but has not yet been pushed or deployed. The user opts in from Reader Settings, then uses a floating action slightly below screen center on the right to translate the current page. Translation overlays are drawn over the original text without modifying the page image.

## Reader behavior

The persistent **AI page translation** setting is off by default. When enabled, an `IntersectionObserver` checks IndexedDB and then the shared cache only for visible pages and one page ahead; a cache miss never starts AI work in the background. The floating **Translate** action and the toolbar's language/provider sheet translate the current page only after an explicit tap, including pages in chapters automatically appended in continuous vertical/webtoon reading. The browser fetches the page through normal CORS or ComiHub's already-approved same-origin media proxy, preserves the whole page while resizing/compressing it to WebP, and caps the binary image at 1.75 MB before posting it to `POST /api/ai/translate-page`.

The app-shell service-worker cache is bumped from `comihub-static-v20` to `comihub-static-v21` so installed readers discard stale shell assets when this change is eventually released.

The server asks a vision model for translated text plus per-region coordinates in a normalized `0..1000` image coordinate space. The reader maps those coordinates back to the displayed image and draws white boxes with dark translated text. Double-clicking or long-pressing a translation opens actions to copy the original text or translation. Cache identity uses SHA-256 of the exact compressed image sent to the backend, source and target languages, and the `page-overlay-v1` translation revision. The browser keeps up to 1,000 results in IndexedDB; a narrowly scoped Supabase RPC can retrieve a shared result by cache key, while only the backend can access the table directly. Shared entries store text/coordinates and bounded source metadata, never page images or source URLs, and expire after 180 days. Expired rows are pruned in bounded batches. This content-based identity also allows an identical page image to be reused across chapters or sources without trusting their URLs.

Image recognition and box placement are model-generated, so lettering, unusual page layouts, low-resolution images, or very long webtoon strips may produce inaccurate or incomplete results. One whole-page request is the simplest initial control and can translate all visible text in one pass.

### Interaction choice: page vs. bubble

The current-page button is the better default: it is predictable, easy to use, translates every bubble in one request, and is fully covered by shared caching. A one-tap bubble-only option could reduce vision input and output when the reader needs just one bubble, but a point tap alone does not provide reliable bubble bounds. The robust low-cost follow-up would be an optional **select-region** mode (drag a box around one bubble, crop locally, translate only that crop, and map the returned coordinates back to the page). It should be an additional mode, not replace page translation; it was not included in this pass.

The translator does **not** bypass a source's access controls. If a source blocks CORS and is not covered by an existing approved ComiHub media proxy, translation reports that the image cannot be read. Image recognition and box placement are model-generated, so lettering, unusual page layouts, low-resolution images, or very long webtoon strips may produce inaccurate or incomplete results.

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

Request JSON fields: `imageDataUrl` (WebP/JPEG/PNG data URL, capped server-side), `sourceLanguage`, `targetLanguage`, `providerMode` (`auto`, `gemini`, or `openrouter`), and optional source/chapter/page metadata. The API validates the image, computes the authoritative digest/cache key, checks the shared cache before invoking a provider, and returns translated regions, provider label, cache key, image digest, and cache-hit state. It never returns or logs API-key values. Chat remains capped at 20 requests per hour per client IP; page translation has a separate 60-request hourly limit and shares the existing concurrency queue.

## Official references

- [Google Gemini models](https://ai.google.dev/gemini-api/docs/models) — model availability and supported input modalities.
- [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) — current free-tier and paid-tier terms.
- [Google's OpenAI-compatible API](https://ai.google.dev/gemini-api/docs/openai) — chat-completions compatibility.
- [OpenRouter Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router) — free model selection and capability filtering, including image understanding.
- [OpenRouter multimodal inputs](https://openrouter.ai/docs/guides/overview/multimodal/overview) — base64 image content support.
