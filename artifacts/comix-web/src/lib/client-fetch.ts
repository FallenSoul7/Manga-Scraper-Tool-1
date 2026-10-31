/**
 * Network requests for source sites and declarative extension manifests.
 *
 * Capacitor 8's bundled CapacitorHttp bridge is enabled in capacitor.config.ts;
 * in Android/iOS WebViews it patches fetch/XMLHttpRequest to use the native
 * network stack. In an ordinary browser this intentionally falls back to normal
 * fetch, so browser CORS rules still apply.
 */
export async function clientFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const requestUrl = input instanceof Request ? input.url : String(input);
  const baseUrl = typeof location !== "undefined" ? location.href : "https://comihub.top/";
  const url = new URL(requestUrl, baseUrl);
  const isLocalDevelopment = url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalDevelopment) {
    throw new TypeError("Source requests must use HTTPS.");
  }

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  // Never forward a caller-supplied referrer, even if a source helper provided one.
  headers.delete("referer");

  return fetch(input, {
    ...init,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers,
  });
}
