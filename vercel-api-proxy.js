const { Readable } = require("node:stream");
const handleReaderComments = require("./vercel-reader-comments");

const PRIMARY_BACKEND =
  process.env.COMIHUB_PRIMARY_BACKEND || "https://manga-scraper-tool-2.onrender.com";
const FALLBACK_BACKEND =
  process.env.COMIHUB_FALLBACK_BACKEND || "https://comihub-backend.onrender.com";
const BACKEND_TIMEOUT_MS = Number(process.env.COMIHUB_BACKEND_TIMEOUT_MS) || 12_000;

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
]);

function backendOrigin(value) {
  return value.replace(/\/+$/, "");
}

const SAFE_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const GATEWAY_FAILURE_STATUSES = new Set([502, 503, 504]);

function shouldTryFallback(response, method) {
  if (GATEWAY_FAILURE_STATUSES.has(response.status)) return true;
  return (
    SAFE_RETRY_METHODS.has(method) &&
    (response.status === 408 || (response.status >= 500 && response.status < 600))
  );
}

function isReaderCommentsRequest(req) {
  const path = (req.url || "").split("?", 1)[0];
  return path === "/api/reader-comments" || path.startsWith("/api/reader-comments/");
}

function copyRequestHeaders(req) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers || {})) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_REQUEST_HEADERS.has(lower)) continue;
    if (Array.isArray(value)) headers[name] = value.join(", ");
    else if (value != null) headers[name] = value;
  }
  return headers;
}

function copyResponseHeaders(res, response) {
  for (const [name, value] of response.headers.entries()) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(lower)) continue;
    if (lower === "set-cookie") continue;
    res.setHeader(name, value);
  }

  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) res.setHeader("set-cookie", cookies);
}

async function readRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD" || req.body == null) return undefined;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return req.body;
  return JSON.stringify(req.body);
}

async function fetchBackend(req, origin, body, signal) {
  return fetch(`${backendOrigin(origin)}${req.url}`, {
    method: req.method,
    headers: copyRequestHeaders(req),
    body,
    redirect: "manual",
    signal,
  });
}

async function streamResponse(res, response) {
  copyResponseHeaders(res, response);
  res.status(response.status);
  if (!response.body) {
    res.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const stream = Readable.fromWeb(response.body);
    stream.once("error", reject);
    res.once("finish", resolve);
    stream.pipe(res);
  });
}

module.exports = async function handler(req, res) {
  const requestController = new AbortController();
  const abortOnRequestClose = () => requestController.abort();
  const abortOnResponseClose = () => {
    if (!res.writableEnded) requestController.abort();
  };
  if (req.aborted || res.destroyed) requestController.abort();
  req.once("aborted", abortOnRequestClose);
  res.once("close", abortOnResponseClose);

  try {
    if (isReaderCommentsRequest(req)) {
      await handleReaderComments(req, res, requestController.signal);
      return;
    }
    const origins = [PRIMARY_BACKEND, FALLBACK_BACKEND].filter(Boolean);
    const body = await readRequestBody(req);
    if (requestController.signal.aborted) return;

    for (let index = 0; index < origins.length; index += 1) {
      const attemptController = new AbortController();
      const abortAttempt = () => attemptController.abort();
      const timeout = setTimeout(() => attemptController.abort(), BACKEND_TIMEOUT_MS);
      requestController.signal.addEventListener("abort", abortAttempt, { once: true });
      try {
        const response = await fetchBackend(req, origins[index], body, attemptController.signal);
        if (requestController.signal.aborted) {
          await response.body?.cancel().catch(() => undefined);
          return;
        }
        if (shouldTryFallback(response, req.method) && index < origins.length - 1) {
          await response.body?.cancel();
          continue;
        }
        await streamResponse(res, response);
        return;
      } catch (error) {
        if (requestController.signal.aborted) return;
      } finally {
        clearTimeout(timeout);
        requestController.signal.removeEventListener("abort", abortAttempt);
      }
    }

    if (!requestController.signal.aborted && !res.destroyed && !res.headersSent) {
      res.status(502).json({ error: "Backend services are temporarily unavailable." });
    }
  } finally {
    req.off("aborted", abortOnRequestClose);
    res.off("close", abortOnResponseClose);
  }
};
