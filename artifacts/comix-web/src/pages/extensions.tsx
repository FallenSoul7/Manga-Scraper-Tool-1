import { useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Upload, FileJson, RotateCcw, Trash2, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  MAX_IMPORT_BYTES,
  importExtensionFromText,
  removeImportedExtension,
  resetImportedExtensions,
  useImportedExtensions,
} from "@/lib/imported-extensions";

const LANG_LABELS: Record<string, string> = {
  en: "English",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  ru: "Русский",
  it: "Italiano",
  ar: "العربية",
  id: "Bahasa Indonesia",
};

const langLabel = (code: string) => LANG_LABELS[code] ?? code.toUpperCase();

export default function ExtensionsPage() {
  const { toast } = useToast();
  const imported = useImportedExtensions();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const resetForm = () => {
    setText("");
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleImport = () => {
    const result = importExtensionFromText(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setError(null);
    setOpen(false);
    resetForm();
    toast({
      title: result.replaced ? `Updated ${result.extension.name}` : `Imported ${result.extension.name}`,
      description: "Saved on this device only. Declarative metadata only — no code is executed.",
    });
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setError(`That file is ${Math.round(file.size / 1024)} KB. The limit is ${Math.round(MAX_IMPORT_BYTES / 1024)} KB.`);
      return;
    }

    try {
      setText(await file.text());
      setError(null);
    } catch {
      setError("Could not read that file on this device.");
    }
  };

  return (
    <main className="container mx-auto px-4 pt-4 pb-8 max-w-4xl animate-in fade-in duration-300">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/system">
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label="Back to System">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Puzzle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-3xl font-serif font-bold tracking-tight">Extensions</h1>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Imported on this device{imported.length > 0 ? ` (${imported.length})` : ""}
          </p>
          {imported.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={() => {
                resetImportedExtensions();
                toast({ title: "Imported extensions reset", description: "Built-in extensions are untouched." });
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={() => {
              resetForm();
              setOpen(true);
            }}
          >
            <Upload className="h-3.5 w-3.5" /> Import
          </Button>
        </div>

        {imported.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No extensions installed yet.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {imported.map((ext) => (
              <div key={ext.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-muted/60 text-muted-foreground">
                  <FileJson className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-semibold text-sm">{ext.name}</span>
                    <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      Imported
                    </span>
                    {ext.isNsfw && (
                      <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                        18+
                      </span>
                    )}
                    <span className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      Local only
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    v{ext.version} · {ext.mediaType} · {ext.operations.length} operation{ext.operations.length === 1 ? "" : "s"}
                    {ext.lang ? ` · ${langLabel(ext.lang)}` : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
                  onClick={() => {
                    removeImportedExtension(ext.id);
                    toast({ title: `Removed ${ext.name}` });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Import extension</DialogTitle>
            <DialogDescription>
              Paste a JSON manifest or choose a file. Imported data is stored in this browser only and is not executed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="import-extension-file" className="text-xs font-medium">JSON file</Label>
              <Input
                id="import-extension-file"
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="text-xs"
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="import-extension-json" className="text-xs font-medium">Manifest JSON</Label>
              <Textarea
                id="import-extension-json"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={`{\n  "id": "demo.example",\n  "name": "Example",\n  "version": "1.0.0",\n  "mediaType": "image",\n  "operations": [{ "id": "search", "type": "search" }]\n}`}
                spellCheck={false}
                className="min-h-[180px] font-mono text-xs"
              />
            </div>

            <p className="text-[11px] text-muted-foreground">
              Required fields: id, name, version, mediaType, operations. Only http:// and https:// URLs are accepted.
              Executable fields and malformed content are rejected. Limit: {Math.round(MAX_IMPORT_BYTES / 1024)} KB.
            </p>

            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleImport} disabled={text.trim() === ""}>
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
