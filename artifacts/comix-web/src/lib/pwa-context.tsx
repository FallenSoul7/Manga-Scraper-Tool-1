import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface PwaContextValue {
  deferredPrompt: any;
  isInstalled: boolean;
  isStandalone: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

const PwaContext = createContext<PwaContextValue>({
  deferredPrompt: null,
  isInstalled: false,
  isStandalone: false,
  isIOS: false,
  isAndroid: false,
  promptInstall: async () => "unavailable",
});

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if ((window.navigator as any).standalone === true) return true;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return false;
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(() => detectStandalone());

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);

  useEffect(() => {
    if (detectStandalone()) {
      setIsInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler as EventListener);
    window.addEventListener("appinstalled", () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    });
    return () => {
      window.removeEventListener("beforeinstallprompt", handler as EventListener);
    };
  }, []);

  // ── Service-worker auto-update ───────────────────────────────────────────────
  // When a new SW activates (skipWaiting fires), reload the page so the
  // app immediately picks up the new JS/CSS bundles.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reloading = false;
    const handleControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    // Poll for SW updates every 60 s so long-lived PWA sessions pick up new
    // versions without requiring the user to close and reopen the app.
    let interval: ReturnType<typeof setInterval>;
    navigator.serviceWorker.ready.then((reg) => {
      interval = setInterval(() => {
        reg.update().catch(() => {});
      }, 60_000);
    }).catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      clearInterval(interval);
    };
  }, []);

  const promptInstall = async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!deferredPrompt) return "unavailable";
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }
    return outcome as "accepted" | "dismissed";
  };

  return (
    <PwaContext.Provider
      value={{
        deferredPrompt,
        isInstalled,
        isStandalone: isInstalled,
        isIOS,
        isAndroid,
        promptInstall,
      }}
    >
      {children}
    </PwaContext.Provider>
  );
}

export function usePwa() {
  return useContext(PwaContext);
}
