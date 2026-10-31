import { Capacitor, CapacitorHttp } from "@capacitor/core";

/**
 * All extension/source-site requests go through this boundary. In Android/iOS,
 * CapacitorHttp sends them through the native OS networking stack; on the web,
 * ordinary fetch remains subject to browser CORS.
 */
function toNativeResponse(response: {
  data: unknown;
  status: number;
  headers: Record<string, string>;
  url: string;
}): Response {
  const status = response.status;
  const body = [204, 205, 304].includes(status)
    ? null
    : typeof response.data === "string"
      ? response.data
      : response.data == null
        ? ""
        : JSON.stringify(response.data);
  const result = new Response(body, {
    status,
    headers: new Headers(response.headers),
  });
  if (response.url) Object.defineProperty(result, "url", { value: response.url });
  return result;
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      value => { signal.removeEventListener("abort", onAbort); resolve(value); },
      error => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

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
  // Never forward a caller-supplied Referer, even if a source helper provided one.
  headers.delete("referer");

  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const redirect = init.redirect ?? (input instanceof Request ? input.redirect : "follow");
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);

  // Source HTML/JSON and manifest reads are GETs. Use the plugin directly on
  // native platforms so those requests never depend on WebView CORS behavior.
  // Other request shapes still use fetch, which is patched by CapacitorHttp in
  // the native app because CapacitorHttp.enabled is set in capacitor.config.ts.
  if (Capacitor.isNativePlatform() && (method === "GET" || method === "HEAD") && init.body == null) {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const nativeHeaders: Record<string, string> = {};
    headers.forEach((value, key) => { nativeHeaders[key] = value; });
    const pending = CapacitorHttp.request({
      url: url.href,
      method,
      headers: nativeHeaders,
      responseType: "text",
      connectTimeout: 15_000,
      readTimeout: 15_000,
      disableRedirects: redirect !== "follow",
    });
    return toNativeResponse(await withAbort(pending, signal));
  }

  return fetch(input, {
    ...init,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers,
  });
}
