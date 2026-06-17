import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { ArrowLeft, Trash2, RefreshCw, Database, HardDrive, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface CacheSizes {
  "comihub-static-v1": number;
  "comihub-api-v1": number;
  "comihub-images-v1": number;
}

const CACHE_LABELS: Record<string, { label: string; icon: typeof Database }> = {
  "comihub-static-v1": { label: "Static Assets", icon: HardDrive },
  "comihub-api-v1": { label: "API Responses", icon: Wifi },
  "comihub-images-v1": { label: "Images", icon: Database },
};

function toMB(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function hasSW() {
  return "serviceWorker" in navigator && navigator.serviceWorker.controller;
}

async function fetchSizesFromSW(): Promise<CacheSizes | null> {
  if (!hasSW()) return null;
  return new Promise((resolve) => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "CACHE_SIZES") {
        navigator.serviceWorker.removeEventListener("message", handler);
        resolve(event.data.sizes as CacheSizes);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    navigator.serviceWorker.controller!.postMessage("GET_CACHE_SIZES");
    setTimeout(() => { navigator.serviceWorker.removeEventListener("message", handler); resolve(null); }, 8000);
  });
}

async function clearCachesViaSW(): Promise<void> {
  if (!hasSW()) {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    return;
  }
  return new Promise((resolve) => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "CACHES_CLEARED") {
        navigator.serviceWorker.removeEventListener("message", handler);
        resolve();
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    navigator.serviceWorker.controller!.postMessage("CLEAR_ALL_CACHES");
    setTimeout(() => { navigator.serviceWorker.removeEventListener("message", handler); resolve(); }, 8000);
  });
}

export default function CachePage() {
  const { toast } = useToast();
  const [sizes, setSizes] = useState<CacheSizes | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await fetchSizesFromSW();
    setSizes(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    const onReady = async () => {
      await navigator.serviceWorker.ready;
      refresh();
    };
    if ("serviceWorker" in navigator) {
      onReady();
    } else {
      setLoading(false);
    }
  }, [refresh]);

  const totalBytes = sizes ? Object.values(sizes).reduce((a, b) => a + b, 0) : 0;

  const handleClear = async () => {
    setClearing(true);
    await clearCachesViaSW();
    await refresh();
    setClearing(false);
    toast({ title: "Cache cleared", description: "All cached data has been removed." });
  };

  const cacheKeys = sizes ? Object.keys(sizes) : [];
  const hasData = cacheKeys.some((k) => (sizes as any)[k] > 0);

  return (
    <main className="container mx-auto px-4 py-12 max-w-2xl animate-in fade-in duration-500">
      <Link href="/system" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary mb-3 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to System
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Cache</h1>
        <p className="text-muted-foreground">View and clear data stored by the service worker.</p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Total Cache</p>
              <p className="text-sm text-muted-foreground">
                {loading ? "Calculating…" : sizes ? `${toMB(totalBytes)} MB` : "Service worker not active yet"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {!loading && sizes && (
          <div className="space-y-2">
            {cacheKeys.map((key) => {
              const meta = CACHE_LABELS[key];
              const Icon = meta?.icon ?? Database;
              return (
                <div key={key} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
                  <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium text-foreground flex-1">
                    {meta?.label ?? key}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {toMB((sizes as any)[key])} MB
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {!loading && !sizes && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
            Service worker not active. Visit a few pages first, then come back.
          </div>
        )}

        <div className="pt-2">
          <Button
            variant="destructive"
            className="w-full sm:w-auto"
            onClick={handleClear}
            disabled={clearing || loading || !hasData}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {clearing ? "Clearing…" : "Clear All Cache"}
          </Button>
        </div>
      </div>
    </main>
  );
}
