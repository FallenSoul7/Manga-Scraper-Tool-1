const { Readable } = require("node:stream");

const PRIMARY_BACKEND =
  process.env.COMIHUB_PRIMARY_BACKEND || "https://manga-scraper-tool-2.onrender.com";
const FALLBACK_BACKEND =
  process.env.COMIHUB_FALLBACK_BACKEND || "https://comihub-backend.onrender.com";

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

function shouldTryFallback(response) {
  return response.status === 502 || response.status === 503 || response.status === 504;
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

async function fetchBackend(req, origin, body) {
  return fetch(`${backendOrigin(origin)}${req.url}`, {
    method: req.method,
    headers: copyRequestHeaders(req),
    body,
    redirect: "manual",
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
  const origins = [PRIMARY_BACKEND, FALLBACK_BACKEND].filter(Boolean);
  const body = await readRequestBody(req);

  for (let index = 0; index < origins.length; index += 1) {
    try {
      const response = await fetchBackend(req, origins[index], body);
      if (shouldTryFallback(response) && index < origins.length - 1) {
        await response.body?.cancel();
        continue;
      }
      await streamResponse(res, response);
      return;
    } catch (error) {
      // Try the next origin without exposing upstream connection details.
    }
  }

  if (!res.headersSent) {
    res.status(502).json({ error: "Backend services are temporarily unavailable." });
  }
};
