import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { storeActions, useStore } from "@/lib/storage";
import {
  removeImportedTier1Extension,
  tier1InstalledMetadata,
  useImportedTier1Extensions,
} from "@/lib/imported-extensions";

export default function Tier1ExtensionCatalog() {
  const extensions = useImportedTier1Extensions();
  const installedMap = useStore(state => state.installedSources);
  const { toast } = useToast();

  const removeExtension = (sourceId: string, name: string) => {
    if (!removeImportedTier1Extension(sourceId)) {
      toast({ title: "Could not remove extension", variant: "destructive" });
      return;
    }
    storeActions.uninstallSource(sourceId);
    toast({ title: `Removed ${name}` });
  };

  if (extensions.length === 0) {
    return (
      <div className="px-4 py-16 text-center text-sm text-muted-foreground">
        <p>No extensions added yet.</p>
        <p className="mt-1">Add one from System → Extensions.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/40">
      {extensions.map(extension => {
        const metadata = tier1InstalledMetadata(extension);
        const installed = !!installedMap[extension.sourceId];
        const name = extension.manifest.sourceName;
        return (
          <div key={extension.sourceId} className="flex items-center gap-3 px-4 py-3">
            {metadata.iconUrl ? (
              <img src={metadata.iconUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-contain bg-muted/60" referrerPolicy="no-referrer" />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded-xl bg-muted/60 flex items-center justify-center text-xs font-semibold text-muted-foreground">
                {name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold">{name}</p>
                {extension.manifest.isNsfw && <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-600 dark:text-rose-400">18+</span>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{extension.manifest.lang.toUpperCase()}</p>
            </div>
            {installed ? (
              <span className="inline-flex items-center gap-1 text-xs text-primary"><CheckCircle2 className="h-4 w-4" /> Installed</span>
            ) : (
              <Button size="sm" className="h-8 shrink-0 text-xs" onClick={() => {
                storeActions.installSource(metadata);
                toast({ title: `Installed ${name}` });
              }}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Install
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${name}`}
              title={`Remove ${name}`}
              onClick={() => removeExtension(extension.sourceId, name)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
