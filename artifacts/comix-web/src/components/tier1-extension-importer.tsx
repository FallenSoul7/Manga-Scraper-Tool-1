import { useState } from "react";
import { CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { storeActions, type InstalledSource } from "@/lib/storage";
import {
  APPROVED_GITHUB_OWNER,
  fetchTier1Manifest,
  removeImportedTier1Extension,
  saveImportedTier1Extension,
  tier1InstalledMetadata,
  useImportedTier1Extensions,
  type LoadedTier1Manifest,
} from "@/lib/imported-extensions";

export default function Tier1ExtensionImporter({
  installedMap,
}: {
  installedMap: Record<string, InstalledSource>;
}) {
  const { toast } = useToast();
  const imported = useImportedTier1Extensions();
  const [manifestUrl, setManifestUrl] = useState("");
  const [preview, setPreview] = useState<LoadedTier1Manifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadManifest = async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    const result = await fetchTier1Manifest(manifestUrl);
    if (result.ok) setPreview(result.loaded);
    else setError(result.error);
    setLoading(false);
  };

  const addSource = () => {
    if (!preview) return;
    const result = saveImportedTier1Extension(preview);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    storeActions.installSource(tier1InstalledMetadata(result.extension));
    toast({
      title: result.replaced ? `Updated ${result.extension.manifest.sourceName}` : `Added ${result.extension.manifest.sourceName}`,
      description: "Saved on this device. This source uses data-only selectors; no script or extension code is downloaded or run.",
    });
    setPreview(null);
    setManifestUrl("");
  };

  const addSavedSource = (extension: (typeof imported)[number]) => {
    storeActions.installSource(tier1InstalledMetadata(extension));
    toast({
      title: `Added ${extension.manifest.sourceName}`,
      description: "This manifest and source configuration are stored on this device only.",
    });
  };

  const removeSource = (extension: (typeof imported)[number]) => {
    if (!removeImportedTier1Extension(extension.sourceId)) {
      toast({ title: "Could not remove manifest", description: "Browser local storage is unavailable or full. The source remains installed." });
      return;
    }
    storeActions.uninstallSource(extension.sourceId);
    toast({ title: `Removed ${extension.manifest.sourceName}` });
  };

  const previewBaseHost = preview ? new URL(preview.manifest.baseUrl).hostname : "";
  const previewAssetHosts = preview
    ? preview.manifest.assetHosts.filter(host => host.toLowerCase() !== previewBaseHost.toLowerCase())
    : [];

  return (
    <section className="mx-4 mt-4 overflow-hidden rounded-xl border border-primary/20 bg-card">
      <div className="border-b border-border/60 px-4 py-3">
        <p className="text-sm font-semibold">Add a Tier 1 source</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Fetch a data-only JSON manifest from the approved <code>raw.githubusercontent.com/{APPROVED_GITHUB_OWNER}/…</code> path. The manifest is saved locally and never uploaded to ComiHub.
        </p>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={manifestUrl}
            onChange={event => {
              setManifestUrl(event.target.value);
              setPreview(null);
              setError(null);
            }}
            onKeyDown={event => { if (event.key === "Enter" && !loading) void loadManifest(); }}
            placeholder={`https://raw.githubusercontent.com/${APPROVED_GITHUB_OWNER}/<public-repo>/main/sources/example.json`}
            aria-label="Raw GitHub JSON manifest URL"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            className="min-w-0 text-xs"
          />
          <Button onClick={() => void loadManifest()} disabled={loading || manifestUrl.trim() === ""} className="shrink-0">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {loading ? "Fetching…" : "Fetch manifest"}
          </Button>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {preview && (
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{preview.manifest.sourceName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new URL(preview.manifest.baseUrl).hostname} · {preview.manifest.lang.toUpperCase()} · Tier 1 HTML
                </p>
              </div>
              <span className="rounded border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">Review before adding</span>
            </div>
            {preview.manifest.description && <p className="text-xs text-muted-foreground">{preview.manifest.description}</p>}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              When you browse this source, your browser connects directly to <strong>{new URL(preview.manifest.baseUrl).hostname}</strong>; the site can see your IP address. It works only if the site permits browser CORS requests. Confirm that you trust this domain before adding it.
            </p>
            {previewAssetHosts.length > 0 && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Additional media hosts: <strong>{previewAssetHosts.join(", ")}</strong>. These hosts can also receive direct image requests.
              </p>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={addSource} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add to Sources
              </Button>
            </div>
          </div>
        )}

        {imported.length > 0 && (
          <div className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your local Tier 1 sources</p>
            <div className="divide-y divide-border/50 rounded-lg border border-border/50">
              {imported.map(extension => {
                const installed = !!installedMap[extension.sourceId];
                return (
                  <div key={extension.sourceId} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{extension.manifest.sourceName}</span>
                        {extension.manifest.isNsfw && <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-600 dark:text-rose-400">18+</span>}
                        <span className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Local only</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {new URL(extension.manifest.baseUrl).hostname} · {extension.manifest.lang.toUpperCase()}
                      </p>
                    </div>
                    {installed ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-primary"><CheckCircle2 className="h-4 w-4" /> Added</span>
                    ) : (
                      <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={() => addSavedSource(extension)}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${extension.manifest.sourceName}`}
                      title="Remove from this device"
                      onClick={() => removeSource(extension)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Only public HTTPS JSON files under <code>raw.githubusercontent.com/{APPROVED_GITHUB_OWNER}/…</code> are accepted. Public manifests are readable by anyone, not secret. This Tier 1 parser supports ordinary static HTML only; it cannot run JavaScript, bypass Cloudflare, or override CORS.
        </p>
        <details className="rounded-lg border border-border/50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">Manifest JSON example</summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/40 p-3 text-[10px] leading-relaxed"><code>{`{
  "schemaVersion": 1,
  "sourceId": "sample-site",
  "sourceName": "Sample Manga",
  "baseUrl": "https://manga.example.com",
  "lang": "en",
  "isNsfw": false,
  "routes": {
    "popular": "/popular?page={page}",
    "latest": "/latest?page={page}",
    "search": "/search?q={query}&page={page}"
  },
  "selectors": {
    "mangaItems": ".manga-card",
    "mangaTitle": ".title",
    "mangaLink": "a",
    "mangaImage": "img",
    "detailImage": ".manga-cover img",
    "nextPage": "a.next",
    "detailTitle": "h1.entry-title",
    "detailAuthor": ".author",
    "detailSynopsis": ".summary",
    "detailGenres": ".genres a",
    "chapterList": ".chapter-list a",
    "chapterLink": "a",
    "chapterImages": ".chapter-content img"
  }
}`}</code></pre>
          <p className="mt-2 text-[10px] text-muted-foreground">Replace the example host and selectors with the real site's public HTML structure. Add third-party image/CDN hostnames to <code>assetHosts</code> only when needed.</p>
        </details>
      </div>
    </section>
  );
}
