import { useMemo, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { hasAdultAccessConsent } from "@/lib/compliance-consent";
import { cacheExtensionManifest } from "@/lib/extension-manifest-db";
import { useOfficialExtensionRegistry } from "@/lib/extension-registry";
import { storeActions, useStore } from "@/lib/storage";
import {
  removeImportedTier1Extension,
  tier1InstalledMetadata,
  useImportedTier1Extensions,
} from "@/lib/imported-extensions";

const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const REMOVED_SOURCE_IDS = new Set([
  "en.utoon", "local.koofr", "en.comix", "en.comickfan",
  "all.atsu", "en.ravenscans", "en.resetscans",
]);

function resolveIconUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/") && API_ORIGIN) return `${API_ORIGIN}${url}`;
  return url;
}

export default function Tier1ExtensionCatalog() {
  const registry = useOfficialExtensionRegistry();
  const localExtensions = useImportedTier1Extensions();
  const installedMap = useStore(state => state.installedSources);
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const adultAllowed = hasAdultAccessConsent();
  const query = search.trim().toLowerCase();

  const officialExtensions = useMemo(() => (registry?.extensions ?? []).filter(extension => {
    if (extension.isNsfw && !adultAllowed) return false;
    return !query || `${extension.name} ${extension.lang} ${extension.id}`.toLowerCase().includes(query);
  }), [registry, adultAllowed, query]);
  const visibleLocalExtensions = useMemo(() => localExtensions.filter(extension => {
    if (REMOVED_SOURCE_IDS.has(extension.sourceId)) return false;
    if (extension.manifest.isNsfw && !adultAllowed) return false;
    return !query || `${extension.manifest.sourceName} ${extension.manifest.lang} ${extension.sourceId}`.toLowerCase().includes(query);
  }), [localExtensions, adultAllowed, query]);

  const removeLocalExtension = (sourceId: string, name: string) => {
    if (!removeImportedTier1Extension(sourceId)) {
      toast({ title: "Could not remove extension", variant: "destructive" });
      return;
    }
    storeActions.uninstallSource(sourceId);
    toast({ title: `Removed ${name}` });
  };

  return (
    <div>
      <div className="border-b border-border/40 p-4">
        <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search extensions" aria-label="Search extensions" />
      </div>
      {!registry && (
        <div className="border-b border-border/40 px-4 py-5 text-center text-sm text-muted-foreground">
          <p>Official sources are not loaded on this device.</p>
          <Link href="/extension-settings" className="mt-2 inline-block text-primary hover:underline">Browse official sources</Link>
        </div>
      )}
      {registry && (
        <section aria-label="Official sources">
          <h2 className="px-4 pb-2 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Official sources</h2>
          {officialExtensions.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No matching sources.</p>
          ) : (
            <div className="divide-y divide-border/40">
              {officialExtensions.map(extension => {
                const installed = !!installedMap[extension.id];
                const iconUrl = resolveIconUrl(extension.iconUrl);
                return (
                  <div key={extension.id} className="flex items-center gap-3 px-4 py-3">
                    {iconUrl ? (
                      <img src={iconUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl bg-muted/60 object-contain" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-xs font-semibold text-muted-foreground">{extension.name.slice(0, 2).toUpperCase()}</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{extension.name}</p>
                        {extension.isNsfw && <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-600 dark:text-rose-400">18+</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {extension.lang.toUpperCase()}
                        {extension.runtime === "device-first" ? " · Device-first, service fallback" : " · Server adapter"}
                        {extension.compatibility === "experimental" ? " · Not working reliably" : ""}
                      </p>
                    </div>
                    {installed ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-primary"><CheckCircle2 className="h-4 w-4" /> Installed</span>
                    ) : (
                      <Button size="sm" className="h-8 shrink-0 text-xs" onClick={() => {
                        void cacheExtensionManifest(extension.id, extension).catch(() => {});
                        storeActions.installSource({
                          id: extension.id,
                          name: extension.name,
                          lang: extension.lang,
                          isNsfw: extension.isNsfw,
                          iconUrl: extension.iconUrl,
                          isPinned: false,
                        });
                        toast({ title: `Installed ${extension.name}` });
                      }}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Install
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {visibleLocalExtensions.length > 0 && (
        <section aria-label="Previously added local extensions">
          <h2 className="px-4 pb-2 pt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">On this device</h2>
          <div className="divide-y divide-border/40">
            {visibleLocalExtensions.map(extension => {
              const metadata = tier1InstalledMetadata(extension);
              const installed = !!installedMap[extension.sourceId];
              const name = extension.manifest.sourceName;
              const iconUrl = resolveIconUrl(metadata.iconUrl);
              return (
                <div key={extension.sourceId} className="flex items-center gap-3 px-4 py-3">
                  {iconUrl ? (
                    <img src={iconUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl bg-muted/60 object-contain" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-xs font-semibold text-muted-foreground">{name.slice(0, 2).toUpperCase()}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{name}</p>
                      {extension.manifest.isNsfw && <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-600 dark:text-rose-400">18+</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{extension.manifest.lang.toUpperCase()}</p>
                  </div>
                  {installed ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-primary"><CheckCircle2 className="h-4 w-4" /> Installed</span>
                  ) : (
                    <Button size="sm" className="h-8 shrink-0 text-xs" onClick={() => {
                      storeActions.installSource(metadata);
                      toast({ title: `Installed ${name}` });
                    }}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Install
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Remove ${name}`} title={`Remove ${name}`} onClick={() => removeLocalExtension(extension.sourceId, name)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {registry && officialExtensions.length === 0 && visibleLocalExtensions.length === 0 && (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">No extensions match this search.</p>
      )}
    </div>
  );
}
