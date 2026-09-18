import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { ArrowLeft, Trash2, RefreshCw, Database, HardDrive, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type CacheSizes = Record<string, number>;
type CacheTier = "important" | "images" | "chapterImages";

const CACHE_TIERS: Array<{ id: CacheTier; label: string; description: string; icon: typeof Database; caches: string[] }> = [
  {
    id: "important",
    label: "Important app data",
    description: "App assets, extension icons, catalog data, manga details, and category information.",
    icon: HardDrive,
    caches: ["comihub-static-v10", "comihub-api-v4"],
  },
  {
    id: "images",
    label: "Manga and cover images",
    description: "Cover art, extension artwork, thumbnails, and images used throughout your library.",
    icon: ImageIcon,
    caches: ["comihub-images-v1"],
  },
  {
    id: "chapterImages",
    label: "Chapter images",
    description: "Reader pages and downloaded chapter images. These remain stored permanently until you delete them.",
    icon: Database,
    caches: ["comihub-chapter-images-v1", "comihub-offline-v1", "comihub-offline-pages-v1"],
  },
];

function toMB(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function tierSize(sizes: CacheSizes, tier: typeof CACHE_TIERS[number]) {
  return tier.caches.reduce((total, name) => total + (sizes[name] ?? 0), 0);
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

async function clearAllCaches(): Promise<void> {
  if (!hasSW()) {
    if ("caches" in window) await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
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

async function clearCacheTier(tier: CacheTier): Promise<void> {
  const definition = CACHE_TIERS.find((entry) => entry.id === tier)!;
  if (!hasSW()) {
    if ("caches" in window) await Promise.all(definition.caches.map((key) => caches.delete(key)));
    return;
  }
  return new Promise((resolve) => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "CACHE_TIER_CLEARED" && event.data.tier === tier) {
        navigator.serviceWorker.removeEventListener("message", handler);
        resolve();
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    navigator.serviceWorker.controller!.postMessage({ type: "CLEAR_CACHE_TIER", tier });
    setTimeout(() => { navigator.serviceWorker.removeEventListener("message", handler); resolve(); }, 8000);
  });
}

export default function CachePage() {
  const { toast } = useToast();
  const [sizes, setSizes] = useState<CacheSizes | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState<CacheTier | "all" | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await fetchSizesFromSW();
    setSizes(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    const onReady = async () => { await navigator.serviceWorker.ready; refresh(); };
    if ("serviceWorker" in navigator) onReady();
    else setLoading(false);
  }, [refresh]);

  const totalBytes = sizes ? Object.values(sizes).reduce((a, b) => a + b, 0) : 0;
  const hasData = sizes ? totalBytes > 0 : false;

  const handleClearTier = async (tier: typeof CACHE_TIERS[number]) => {
    setClearing(tier.id);
    await clearCacheTier(tier.id);
    await refresh();
    setClearing(null);
    toast({ title: `${tier.label} cleared`, description: "The other cache tiers were left untouched." });
  };

  const handleClearAll = async () => {
    setClearing("all");
    await clearAllCaches();
    await refresh();
    setClearing(null);
    toast({ title: "All cache cleared", description: "All locally stored app, image, and chapter data was removed." });
  };

  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl animate-in fade-in duration-500">
      <Link href="/system" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary mb-3 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to System
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Cache</h1>
        <p className="text-muted-foreground">Persistent data stored on this device. Nothing expires automatically; delete a tier whenever you want to reclaim space.</p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Database className="h-5 w-5" /></div>
            <div>
              <p className="font-semibold text-foreground">Total local cache</p>
              <p className="text-sm text-muted-foreground">{loading ? "Calculating…" : sizes ? `${toMB(totalBytes)} MB` : "Service worker not active yet"}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>

        {!loading && sizes && <div className="space-y-3">
          {CACHE_TIERS.map((tier) => {
            const Icon = tier.icon;
            const bytes = tierSize(sizes, tier);
            return <div key={tier.id} className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0"><Icon className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3"><p className="font-semibold text-foreground">{tier.label}</p><p className="text-sm text-muted-foreground whitespace-nowrap">{toMB(bytes)} MB</p></div>
                  <p className="text-sm text-muted-foreground mt-1">{tier.description}</p>
                </div>
                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive shrink-0" onClick={() => handleClearTier(tier)} disabled={clearing !== null || bytes === 0} title={`Delete ${tier.label}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>;
          })}
        </div>}

        {!loading && !sizes && <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">Service worker not active. Visit a few pages first, then come back.</div>}

        <div className="pt-2 border-t border-border">
          <Button variant="destructive" className="w-full sm:w-auto" onClick={handleClearAll} disabled={clearing !== null || loading || !hasData}>
            <Trash2 className="mr-2 h-4 w-4" />{clearing === "all" ? "Clearing…" : "Clear All Cache"}
          </Button>
        </div>
      </div>
    </main>
  );
}
