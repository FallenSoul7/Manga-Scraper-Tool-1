/* global browser, chrome */

const extensionApi = globalThis.browser ?? globalThis.chrome;
const ALLOWED_ORIGINS = new Set([
  "https://www.comihub.top",
  "https://comihub.top",
]);

function isAllowedSender(sender) {
  const raw = sender?.origin || sender?.url || "";
  try {
    const url = new URL(raw);
    return ALLOWED_ORIGINS.has(url.origin) ||
      (url.protocol === "http:" && url.hostname === "localhost");
  } catch {
    return false;
  }
}

function headerRecord(headers) {
  const result = {};
  for (const [name, value] of headers.entries()) result[name] = value;
  return result;
}

async function directFetch(message) {
  if (!message || typeof message.url !== "string") {
    throw new Error("ComiHub helper requires a URL.");
  }
  const target = new URL(message.url);
  if (target.protocol !== "https:" && !(target.protocol === "http:" && target.hostname === "localhost")) {
    throw new Error("ComiHub helper only fetches HTTPS URLs.");
  }
  const method = String(message.method || "GET").toUpperCase();
  const response = await fetch(target.href, {
    method,
    headers: message.headers || {},
    body: message.body == null || method === "GET" || method === "HEAD" ? undefined : message.body,
    credentials: "omit",
    redirect: "follow",
  });
  return {
    ok: response.ok,
    status: response.status,
    url: response.url || target.href,
    headers: headerRecord(response.headers),
    body: await response.text(),
  };
}

extensionApi.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isAllowedSender(sender)) {
    sendResponse({ ok: false, error: "Origin is not allowed." });
    return false;
  }
  if (message?.type === "COMIHUB_PING") {
    sendResponse({ ok: true, type: "COMIHUB_PONG", version: "1.0.0" });
    return false;
  }
  if (message?.type !== "COMIHUB_DIRECT_FETCH") {
    sendResponse({ ok: false, error: "Unknown ComiHub helper message." });
    return false;
  }
  directFetch(message)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Direct fetch failed." }));
  return true;
});
