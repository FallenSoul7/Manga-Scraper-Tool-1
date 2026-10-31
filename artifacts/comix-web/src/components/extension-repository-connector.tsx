import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { hasAdultAccessConsent } from "@/lib/compliance-consent";
import { storeActions, useStore } from "@/lib/storage";
import {
  loadOfficialSourceRegistry,
  useOfficialExtensionRegistry,
  type OfficialExtensionEntry,
} from "@/lib/extension-registry";

const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

function resolveIconUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/") && API_ORIGIN) return `${API_ORIGIN}${url}`;
  return url;
}

function SourceIcon({ extension }: { extension: OfficialExtensionEntry }) {
  const [errored, setErrored] = useState(false);
  const iconUrl = resolveIconUrl(extension.iconUrl);
  if (iconUrl && !errored) {
    return <img src={iconUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl bg-muted/60 object-contain" referrerPolicy="no-referrer" onError={() => setErrored(true)} />;
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-xs font-semibold text-muted-foreground">
      {extension.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function ExtensionRepositoryConnector() {
  const { toast } = useToast();
  const installedMap = useStore(state => state.installedSources);
  const registry = useOfficialExtensionRegistry();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");

  const visibleExtensions = useMemo(() => {
    const matureAllowed = hasAdultAccessConsent();
    const query = search.trim().toLowerCase();
    return (registry?.extensions ?? []).filter(extension => {
      if (extension.isNsfw && !matureAllowed) return false;
      if (!query) return true;
      return `${extension.name} ${extension.lang} ${extension.id}`.toLowerCase().includes(query);
    });
  }, [registry, search]);

  const browseSources = async () => {
    setLoading(true);
    setError("");
    const result = await loadOfficialSourceRegistry();
    setLoading(false);
    if (!result.ok) {
      if (!registry) {
        setError(result.error);
        return;
      }
      setSearch("");
      setDialogOpen(true);
      toast({ title: "Showing saved source list", description: "Go online to refresh it." });
      return;
    }
    setSearch("");
    setDialogOpen(true);
    toast({ title: `${result.registry.extensions.length} official sources loaded` });
  };

  const install = (extension: OfficialExtensionEntry) => {
    storeActions.installSource({
      id: extension.id,
      name: extension.name,
      lang: extension.lang,
      isNsfw: extension.isNsfw,
      iconUrl: extension.iconUrl,
      isPinned: false,
    });
    toast({ title: `Installed ${extension.name}` });
  };

  return (
    <section className="space-y-4">
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">Official sources</h2>
          <p className="text-xs text-muted-foreground">Install an official source to add it to this device. For simple custom sites, use the Tier 1 JSON option below.</p>
        </div>
        <Button type="button" onClick={() => void browseSources()} disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {loading ? "Loading sources…" : "Browse sources"}
        </Button>
      </div>
      {registry && (
        <p role="status" className="text-sm text-muted-foreground">
          Saved on this device · {registry.extensions.length} sources available
        </p>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-hidden p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle>Official sources</DialogTitle>
            <DialogDescription>{visibleExtensions.length} sources available to install on this device</DialogDescription>
          </DialogHeader>
          <div className="px-5">
            <Input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search sources"
              aria-label="Search official sources"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-5 pb-5">
            {visibleExtensions.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No matching sources.</p>
            ) : (
              <div className="divide-y divide-border/50">
                {visibleExtensions.map(extension => {
                  const installed = !!installedMap[extension.id];
                  return (
                    <div key={extension.id} className="flex items-center gap-3 py-3">
                      <SourceIcon extension={extension} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{extension.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {extension.lang.toUpperCase()}
                          {extension.compatibility === "experimental" ? " · Not working reliably" : ""}
                          {extension.isNsfw ? " · 18+" : ""}
                        </p>
                      </div>
                      {installed ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-primary">
                          <CheckCircle2 className="h-4 w-4" /> Installed
                        </span>
                      ) : (
                        <Button size="sm" className="h-8 shrink-0 text-xs" onClick={() => install(extension)}>
                          <Plus className="mr-1 h-3.5 w-3.5" /> Install
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
