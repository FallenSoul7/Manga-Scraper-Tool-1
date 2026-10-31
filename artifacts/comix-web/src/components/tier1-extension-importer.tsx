import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { storeActions, useStore } from "@/lib/storage";
import {
  fetchTier1Manifest,
  saveImportedTier1Extension,
  tier1InstalledMetadata,
  type LoadedTier1Manifest,
} from "@/lib/imported-extensions";

export default function Tier1ExtensionImporter() {
  const { toast } = useToast();
  const installedMap = useStore(state => state.installedSources);
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState<LoadedTier1Manifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const addExtension = async () => {
    setLoading(true);
    setError("");
    const result = await fetchTier1Manifest(url);
    if (!result.ok) {
      setError("Could not add that extension. Check the URL and try again.");
      setLoading(false);
      return;
    }
    // A new source is saved as available immediately. An installed source is
    // left untouched until the user confirms the Update action in the dialog.
    if (!installedMap[result.loaded.sourceId]) {
      const saved = saveImportedTier1Extension(result.loaded);
      if (!saved.ok) {
        setError("Could not save this extension on the device.");
        setLoading(false);
        return;
      }
    }
    setPending(result.loaded);
    setUrl("");
    setLoading(false);
  };

  const installPending = () => {
    if (!pending) return;
    const saved = saveImportedTier1Extension(pending);
    if (!saved.ok) {
      toast({ title: "Could not save extension", variant: "destructive" });
      return;
    }
    storeActions.installSource(tier1InstalledMetadata(saved.extension));
    toast({ title: `${installedMap[pending.sourceId] ? "Updated" : "Installed"} ${pending.manifest.sourceName}` });
    setPending(null);
  };

  return (
    <>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={event => { event.preventDefault(); if (!loading) void addExtension(); }}
      >
        <Input
          value={url}
          onChange={event => { setUrl(event.target.value); setError(""); }}
          placeholder="Paste GitHub extension URL"
          aria-label="Extension URL"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          className="min-w-0"
        />
        <Button type="submit" disabled={loading || !url.trim()} className="shrink-0">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add Extension
        </Button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}

      <Dialog open={!!pending} onOpenChange={open => { if (!open) setPending(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{pending?.manifest.sourceName}</DialogTitle>
            <DialogDescription>
              {pending ? `${pending.manifest.lang.toUpperCase()} · ${new URL(pending.manifest.baseUrl).hostname}` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            <Button onClick={installPending}>
              {pending && installedMap[pending.sourceId] ? "Update" : "Install"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
