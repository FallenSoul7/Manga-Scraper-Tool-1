import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import { apiUrl } from "@/lib/api-url";

const SHOW_AFTER_MS = 350;
const GIVE_UP_AFTER_MS = 45_000;

export function BackendWarmup() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"warming" | "ready" | "timeout">("warming");
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const warmBackend = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${apiUrl("/api/healthz")}?warmup=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        signal,
      });
      if (response.ok) {
        // Requests made by the first render may have failed while Render was
        // asleep. Retry them immediately once the wake-up probe succeeds.
        await queryClient.invalidateQueries();
        setState("ready");
        setVisible(false);
      }
    } catch {
      // The page can still be used from the local cache while the backend wakes.
      // The timeout message is intentionally handled by the timer below.
    }
  }, [queryClient]);

  useEffect(() => {
    const controller = new AbortController();
    const showTimer = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    const timeoutTimer = window.setTimeout(() => setState("timeout"), GIVE_UP_AFTER_MS);
    void warmBackend(controller.signal);

    return () => {
      controller.abort();
      window.clearTimeout(showTimer);
      window.clearTimeout(timeoutTimer);
    };
  }, [attempt, warmBackend]);

  if (state === "ready" || !visible) return null;

  const retry = () => {
    setState("warming");
    setVisible(true);
    setAttempt((value) => value + 1);
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-background/95 px-6 backdrop-blur-sm">
      <div className="w-full max-w-sm text-center">
        {state === "warming" ? (
          <Loader2 className="mx-auto mb-5 h-10 w-10 animate-spin text-primary" aria-hidden="true" />
        ) : (
          <WifiOff className="mx-auto mb-5 h-10 w-10 text-amber-500" aria-hidden="true" />
        )}
        <h1 className="font-serif text-2xl font-bold">
          {state === "warming" ? "Loading ComiHub…" : "The source service is taking longer than usual"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {state === "warming"
            ? "The app is ready. We are waking the content service and loading your sources. This can take a few seconds on the first visit."
            : "You can retry now, or continue to use cached library and downloaded chapters while the service is unavailable."}
        </p>
        {state === "timeout" && (
          <button
            type="button"
            onClick={retry}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        )}
        <p className="mt-6 text-xs text-muted-foreground/70">Your local library remains available on this device.</p>
      </div>
    </div>
  );
}
