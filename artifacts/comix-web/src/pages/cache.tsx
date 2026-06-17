import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, Trash2, RefreshCw, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

async function getCacheSize(): Promise<{ name: string; sizeMB: number }[]> {
  if (!("caches" in window)) return [];
  const cacheNames = await caches.keys();
  const results: { name: string; sizeMB: number }[] = [];
  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    let totalBytes = 0;
    for (const req of keys) {
      const res = await cache.match(req);
      if (res) {
        const blob = await res.clone().blob();
        totalBytes += blob.size;
      }
    }
    results.push({ name, sizeMB: totalBytes / (1024 * 1024) });
  }
  return results;
}

async function clearAllCaches(): Promise<void> {
  if (!("caches" in window)) return;
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((name) => caches.delete(name)));
}

export default function CachePage() {
  const { toast } = useToast();
  const [cacheEntries, setCacheEntries] = useState<{ name: string; sizeMB: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const entries = await getCacheSize();
    setCacheEntries(entries);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const totalMB = cacheEntries.reduce((s, e) => s + e.sizeMB, 0);

  const handleClear = async () => {
    setClearing(true);
    await clearAllCaches();
    await refresh();
    setClearing(false);
    toast({ title: "Cache cleared", description: "All cached data has been removed." });
  };

  return (
    <main className="container mx-auto px-4 py-12 max-w-2xl animate-in fade-in duration-500">
      <Link href="/system" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary mb-3 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to System
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Cache</h1>
        <p className="text-muted-foreground">View and clear data stored by the app in your browser.</p>
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
                {loading ? "Calculating…" : `${totalMB.toFixed(2)} MB`}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {!loading && cacheEntries.length > 0 && (
          <div className="space-y-2">
            {cacheEntries.map((entry) => (
              <div key={entry.name} className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm">
                <span className="text-foreground font-medium truncate max-w-[60%]">{entry.name}</span>
                <span className="text-muted-foreground">{entry.sizeMB.toFixed(2)} MB</span>
              </div>
            ))}
          </div>
        )}

        {!loading && cacheEntries.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
            No cache data found.
          </div>
        )}

        <div className="pt-2">
          <Button
            variant="destructive"
            className="w-full sm:w-auto"
            onClick={handleClear}
            disabled={clearing || loading || cacheEntries.length === 0}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {clearing ? "Clearing…" : "Clear All Cache"}
          </Button>
        </div>
      </div>
    </main>
  );
}
