import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { appApiUrl } from "@/lib/api-url";

export type HelperStatus = "unknown" | "active" | "missing" | "disabled";

interface ExtensionRuntime {
  sendMessage(message: unknown, callback?: (response: unknown) => void): unknown;
}

interface ExtensionResponse {
  ok?: boolean;
  type?: string;
  status?: number;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
}

declare global {
  interface Window {
    chrome?: { runtime?: ExtensionRuntime };
    browser?: { runtime?: ExtensionRuntime };
  }
}

const HELPER_ENABLED_KEY = "comihub-helper-enabled";
const HELPER_STATUS_EVENT = "comihub-helper-status";
const PING_TIMEOUT_MS = 800;

let helperStatus: HelperStatus = "unknown";
let pingPromise: Promise<HelperStatus> | null = null;

function runtime(): ExtensionRuntime | null {
  if (typeof window === "undefined") return null;
  return window.chrome?.runtime ?? window.browser?.runtime ?? null;
}

export function isHelperEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(HELPER_ENABLED_KEY) !== "false";
}

export function setHelperEnabled(enabled: boolean): void {
  localStorage.setItem(HELPER_ENABLED_KEY, String(enabled));
  helperStatus = enabled ? "unknown" : "disabled";
  window.dispatchEvent(new CustomEvent(HELPER_STATUS_EVENT, { detail: helperStatus }));
}

export function getHelperStatus(): HelperStatus {
  return isHelperEnabled() ? helperStatus : "disabled";
}

export function subscribeHelperStatus(listener: (status: HelperStatus) => void): () => void {
  const onStatus = (event: Event) => listener((event as CustomEvent<HelperStatus>).detail);
  window.addEventListener(HELPER_STATUS_EVENT, onStatus);
  return () => window.removeEventListener(HELPER_STATUS_EVENT, onStatus);
}

function publishStatus(status: HelperStatus): HelperStatus {
  helperStatus = status;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(HELPER_STATUS_EVENT, { detail: status }));
  }
  return status;
}

function sendExtensionMessage(message: unknown): Promise<ExtensionResponse> {
  const api = runtime();
  if (!api) return Promise.reject(new Error("ComiHub helper extension is unavailable."));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      callback();
    };
    const timer = window.setTimeout(() => finish(() => reject(new Error("ComiHub helper extension timed out."))), PING_TIMEOUT_MS);
    const callback = (response: unknown) => finish(() => resolve((response ?? {}) as ExtensionResponse));
    try {
      const result = api.sendMessage(message, callback);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).then(
          response => finish(() => resolve((response ?? {}) as ExtensionResponse)),
          error => finish(() => reject(error)),
        );
      }
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export async function detectHelper(): Promise<HelperStatus> {
  if (!isHelperEnabled()) return publishStatus("disabled");
  if (!runtime()) return publishStatus("missing");
  if (helperStatus === "active") return helperStatus;
  if (pingPromise) return pingPromise;
  pingPromise = sendExtensionMessage({ type: "COMIHUB_PING" })
    .then(response => response.ok && response.type === "COMIHUB_PONG" ? publishStatus("active") : publishStatus("missing"))
    .catch(() => publishStatus("missing"))
    .finally(() => { pingPromise = null; });
  return pingPromise;
}

function responseFromExtension(payload: ExtensionResponse): Response {
  if (!payload.ok || typeof payload.status !== "number") {
    throw new Error(payload.error || "ComiHub helper direct fetch failed.");
  }
  const response = new Response(payload.body ?? "", {
    status: payload.status,
    headers: new Headers(payload.headers ?? {}),
  });
  if (payload.url) Object.defineProperty(response, "url", { value: payload.url });
  return response;
}

function toNativeResponse(response: { data: unknown; status: number; headers: Record<string, string>; url: string }): Response {
  const body = [204, 205, 304].includes(response.status)
    ? null
    : typeof response.data === "string" ? response.data : response.data == null ? "" : JSON.stringify(response.data);
  const result = new Response(body, { status: response.status, headers: new Headers(response.headers) });
  if (response.url) Object.defineProperty(result, "url", { value: response.url });
  return result;
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", onAbort); resolve(value); }, error => { signal.removeEventListener("abort", onAbort); reject(error); });
  });
}

function requestBody(init: RequestInit): string | undefined {
  if (init.body == null || typeof init.body === "string") return init.body ?? undefined;
  if (init.body instanceof URLSearchParams) return init.body.toString();
  return undefined;
}

function renderProxyUrl(url: URL): string {
  return appApiUrl(`/api/direct-fetch?url=${encodeURIComponent(url.href)}`);
}

export async function fetcher(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const requestUrl = input instanceof Request ? input.url : String(input);
  const baseUrl = typeof location !== "undefined" ? location.href : "https://www.comihub.top/";
  const url = new URL(requestUrl, baseUrl);
  const isLocalDevelopment = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalDevelopment) throw new TypeError("Source requests must use HTTPS.");

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.delete("referer");
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const redirect = init.redirect ?? (input instanceof Request ? input.redirect : "follow");
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);

  if (Capacitor.isNativePlatform() && (method === "GET" || method === "HEAD") && init.body == null) {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const nativeHeaders: Record<string, string> = {};
    headers.forEach((value, key) => { nativeHeaders[key] = value; });
    return toNativeResponse(await withAbort(CapacitorHttp.request({ url: url.href, method, headers: nativeHeaders, responseType: "text", connectTimeout: 15_000, readTimeout: 15_000, disableRedirects: redirect !== "follow" }), signal));
  }

  const sameOrigin = typeof location !== "undefined" && url.origin === location.origin;
  if (!sameOrigin && isHelperEnabled() && (await detectHelper()) === "active") {
    try {
      const nativeHeaders: Record<string, string> = {};
      headers.forEach((value, key) => { nativeHeaders[key] = value; });
      const response = responseFromExtension(await sendExtensionMessage({ type: "COMIHUB_DIRECT_FETCH", url: url.href, method, headers: nativeHeaders, body: requestBody(init) }));
      return response;
    } catch {
      publishStatus("missing");
    }
  }

  const fallbackUrl = sameOrigin ? url.href : renderProxyUrl(url);
  return fetch(fallbackUrl, { ...init, credentials: "omit", referrerPolicy: "no-referrer", headers });
}

export async function probeHelperOnLoad(): Promise<HelperStatus> {
  return detectHelper();
}

export const clientFetch = fetcher;
