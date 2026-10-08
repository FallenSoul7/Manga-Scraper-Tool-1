import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, RefreshCw, WifiOff } from "lucide-react";
import { apiUrl } from "@/lib/api-url";

const SHOW_AFTER_MS = 350;
const RELEASE_SHELL_AFTER_MS = 3_500;
const GIVE_UP_AFTER_MS = 45_000;
const BACKEND_REFRESH_EVENT = "comihub:refresh-backend";

export function requestBackendRefresh() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BACKEND_REFRESH_EVENT));
}

export function BackendWarmup() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"warming" | "ready" | "timeout">("warming");
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const lastBackendReadyAt = useRef(0);
  const wasHidden = useRef(false);

  const warmBackend = useCallback(async (signal?: AbortSignal) => {
    let retryDelayMs = 2_000;
    while (!signal?.aborted) {
      try {
        const response = await fetch(`${apiUrl("/api/healthz")}?warmup=${Date.now()}`, {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          signal,
        });
        if (response.ok) {
          lastBackendReadyAt.current = Date.now();
          // Some page queries may have started during Render's cold start and
          // still be pending when health turns green. Cancel them first so the
          // invalidate below starts fresh requests against the awake service.
          await queryClient.cancelQueries();
          if (signal?.aborted) return;
          queryClient.setQueryData(["backend-ready"], true);
          // Don't hold the app shell while active pages refetch after the backend
          // wakes; those pages already show their own loading states.
          void queryClient.invalidateQueries();
          setState("ready");
          setVisible(false);
          return;
        }
      } catch {
        if (signal?.aborted) return;
      }

      if (signal?.aborted) return;
      await new Promise<void>((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          window.clearTimeout(timer);
          signal?.removeEventListener("abort", finish);
          resolve();
        };
        const timer = window.setTimeout(finish, retryDelayMs);
        if (signal?.aborted) finish();
        else signal?.addEventListener("abort", finish, { once: true });
      });
      retryDelayMs = Math.min(retryDelayMs * 2, 15_000);
    }
  }, [queryClient]);

  useEffect(() => {
    const refresh = () => {
      queryClient.setQueryData(["backend-ready"], false);
      setState("warming");
      setAttempt(value => value + 1);
    };
    const resume = () => {
      if (document.visibilityState === "hidden") {
        wasHidden.current = true;
        return;
      }
      if (!wasHidden.current) return;
      wasHidden.current = false;

      const backendReady = queryClient.getQueryData<boolean>(["backend-ready"]) === true;
      const recentlyHealthy = Date.now() - lastBackendReadyAt.current < 10 * 60 * 1000;
      if (!backendReady || !recentlyHealthy) refresh();
    };
    const markHidden = () => { wasHidden.current = true; };
    window.addEventListener(BACKEND_REFRESH_EVENT, refresh);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pagehide", markHidden);
    window.addEventListener("pageshow", resume);
    return () => {
      window.removeEventListener(BACKEND_REFRESH_EVENT, refresh);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pagehide", markHidden);
      window.removeEventListener("pageshow", resume);
    };
  }, [queryClient]);

  useEffect(() => {
    queryClient.setQueryData(["backend-ready"], false);
    // Make the Extensions tab usable immediately. The static catalog is part
    // of the Vercel bundle, so it does not depend on Render waking up.
    void fetch("/source-catalog.json", { cache: "force-cache" })
      .then(response => response.ok ? response.json() : null)
      .then(catalog => { if (catalog) queryClient.setQueryData(["sources-catalog"], catalog); })
      .catch(() => undefined);
    const controller = new AbortController();
    const showTimer = attempt === 0 ? window.setTimeout(() => setVisible(true), SHOW_AFTER_MS) : undefined;
    const releaseTimer = window.setTimeout(() => setVisible(false), RELEASE_SHELL_AFTER_MS);
    const timeoutTimer = window.setTimeout(() => {
      setState(current => current === "warming" ? "timeout" : current);
    }, GIVE_UP_AFTER_MS);
    void warmBackend(controller.signal);

    return () => {
      controller.abort();
      if (showTimer !== undefined) window.clearTimeout(showTimer);
      window.clearTimeout(releaseTimer);
      window.clearTimeout(timeoutTimer);
    };
  }, [attempt, warmBackend]);

  useEffect(() => {
    if (state !== "warming" || !visible) return;
    const timer = window.setInterval(() => {
      setMessageIndex((value) => (value + 1) % 3);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [state, visible]);

  if (state === "ready" || !visible) return null;

  const retry = () => {
    queryClient.setQueryData(["backend-ready"], false);
    setState("warming");
    setVisible(true);
    setAttempt((value) => value + 1);
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-background/95 px-6 backdrop-blur-sm">
      <div className="w-full max-w-sm text-center">
        {state === "warming" ? (
          <div className="mx-auto mb-5 flex h-16 items-end justify-center gap-1.5" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="w-10 rounded-t-xl bg-primary/20 p-2 text-primary animate-bounce"
                style={{ height: `${38 + index * 10}px`, animationDelay: `${index * 140}ms` }}
              >
                <BookOpen className="h-5 w-5" />
              </div>
            ))}
          </div>
        ) : (
          <WifiOff className="mx-auto mb-5 h-10 w-10 text-amber-500" aria-hidden="true" />
        )}
        <h1 className="font-serif text-2xl font-bold">
          {state === "warming" ? "Loading ComiHub…" : "The source service is taking longer than usual"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {state === "warming"
            ? [
                "The app is ready. We are waking the content service…",
                "Connecting to your manga sources and preparing your library…",
                "Almost there — the first visit can take a few extra seconds…",
              ][messageIndex]
            : "You can retry now, or continue to use cached library and downloaded chapters while the service is unavailable."}
        </p>
        {state === "warming" && (
          <div className="mx-auto mt-6 w-full max-w-xs" role="progressbar" aria-label="Waking the content service">
            <div className="h-1.5 overflow-hidden rounded-full bg-primary/15">
              <div className="h-full w-1/3 rounded-full bg-primary animate-[warmup-progress_1.8s_ease-in-out_infinite]" />
            </div>
            <div className="mt-2 flex justify-center gap-1.5" aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <span key={index} className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-pulse" style={{ animationDelay: `${index * 220}ms` }} />
              ))}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={retry}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </button>
        {state === "timeout" && (
          <p className="mt-3 text-xs text-muted-foreground">The app is open; only live source data is still connecting.</p>
        )}
        <p className="mt-6 text-xs text-muted-foreground/70">Your local library remains available on this device.</p>
      </div>
    </div>
  );
}
