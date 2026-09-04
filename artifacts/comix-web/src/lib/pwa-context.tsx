import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { apiUrl } from "@/lib/api-url";

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

  // ── Keep-alive ping ──────────────────────────────────────────────────────────
  // Ping the Render API every 8 minutes while the app is open to prevent the
  // free-tier server from going to sleep. When no users are online, combine
  // this with an external monitor like UptimeRobot for full coverage.
  useEffect(() => {
    const ping = () =>
      fetch(apiUrl("/api/healthz"), { credentials: "omit" }).catch(() => {});
    ping(); // immediate ping on mount
    const id = setInterval(ping, 8 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // ── Service-worker auto-update ───────────────────────────────────────────────
  // Let a new SW activate without forcing a page reload. A controllerchange
  // reload creates a visible dark/blank flash in installed home-screen apps,
  // especially on first launch or when returning from the background.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Poll for SW updates every 60 s so long-lived PWA sessions pick up new
    // versions without requiring the user to close and reopen the app.
    let interval: ReturnType<typeof setInterval>;
    navigator.serviceWorker.ready.then((reg) => {
      interval = setInterval(() => {
        reg.update().catch(() => {});
      }, 60_000);
    }).catch(() => {});

    return () => {
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
