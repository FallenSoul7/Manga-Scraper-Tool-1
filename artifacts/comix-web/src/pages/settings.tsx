import { useSettings } from "@/hooks/use-settings";
import { GetPopularPoster, GetMangaDetailsScore } from "@/hooks/use-settings";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { useStore, storeActions, THEME_OPTIONS, type Theme } from "@/lib/storage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Download, Upload, BarChart3, AlertTriangle, ArrowLeft, Check, CirclePlay, Trash2, Shield } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useMemo, useRef, useState } from "react";

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const theme = useStore(s => s.theme);
  const readerSettings = useStore(s => s.reader);
  const categories = useStore(s => s.categories);
  const library = useStore(s => s.library);
  const progress = useStore(s => s.progress);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── VPN proxy toggle ────────────────────────────────────────────────────
  const [isVpnEnabled, setIsVpnEnabled] = useState(
    () => localStorage.getItem("builtin_vpn_enabled") === "true"
  );
  const toggleVpn = (val: boolean) => {
    setIsVpnEnabled(val);
    localStorage.setItem("builtin_vpn_enabled", String(val));
  };

  const downloadedItems = useMemo(() => {
    return Object.values(library)
      .map(manga => {
        const chapters = Object.values(progress).filter(p => p.mangaId === manga.id && p.isRead);
        const latest = chapters.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (!latest && !manga.downloadedAt) return null;
        return {
          manga,
          latest,
          count: chapters.length,
          status: latest ? `Chapter ${latest.chapterNumber}` : "Downloaded",
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => (b.manga.downloadedAt ?? 0) - (a.manga.downloadedAt ?? 0));
  }, [library, progress]);

  const handleExport = () => {
    const data = storeActions.exportBackup();
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comix-lounge-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      const { ok, error } = storeActions.importBackup(result);
      if (ok) {
        toast({ title: "Backup restored", description: "Your library and settings have been restored successfully." });
      } else {
        toast({ title: "Restore failed", description: error || "Invalid backup file", variant: "destructive" });
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const handleReset = () => {
    storeActions.resetAll();
    window.location.reload();
  };

  return (
    <main className="container mx-auto px-4 py-12 max-w-2xl animate-in fade-in duration-500">
      <Link href="/system" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary mb-3 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to System
      </Link>
      <div className="mb-10 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Reading Lounge Settings</h1>
          <p className="text-muted-foreground">Customize your browsing and reading experience.</p>
        </div>
        <Link href="/stats">
          <Button variant="outline" className="hidden sm:flex">
            <BarChart3 className="mr-2 h-4 w-4" />
            View Statistics
          </Button>
        </Link>
      </div>

      <div className="space-y-8 bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm">
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Downloads</h2>
              <p className="text-sm text-muted-foreground">Saved manga and read chapters on this device.</p>
            </div>
            <Link href="/downloads">
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" /> Open Downloads
              </Button>
            </Link>
          </div>
          <div className="space-y-3">
            {downloadedItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
                No downloads yet
              </div>
            ) : downloadedItems.slice(0, 3).map(({ manga, status, count }) => (
              <div key={manga.id} className="flex items-center gap-3 rounded-2xl border border-border p-3">
                <img src={manga.thumbnail} alt={manga.title} className="h-16 w-12 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{manga.title}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <CirclePlay className="h-3 w-3" /> {status} • {count} chapters
                  </div>
                </div>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
          </div>
        </section>

        {/* Appearance Section */}
        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-foreground">Appearance</h2>
          <div className="space-y-3">
            <Label className="text-base font-medium">Theme</Label>
            <p className="text-sm text-muted-foreground -mt-1">
              Pick a palette. Color themes apply a vivid accent over a tinted dark background.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 pt-2">
              {THEME_OPTIONS.map((opt) => {
                const active = theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => storeActions.setTheme(opt.id as Theme)}
                    aria-pressed={active}
                    className={`group relative rounded-xl border p-3 text-left transition-all cursor-pointer flex items-center gap-3 ${
                      active
                        ? "border-primary ring-2 ring-primary/40 shadow-sm"
                        : "border-border hover:border-primary/50 hover:bg-muted/40"
                    }`}
                  >
                    <span
                      className="relative h-9 w-9 rounded-lg border shrink-0 overflow-hidden"
                      style={{ backgroundColor: opt.bg, borderColor: "rgba(0,0,0,0.15)" }}
                    >
                      <span
                        className="absolute inset-1 rounded-md"
                        style={{ backgroundColor: opt.swatch, boxShadow: opt.id === 'neon-green' ? `0 0 8px ${opt.swatch}` : undefined }}
                      />
                    </span>
                    <span className="flex flex-col min-w-0">
                      <span className="text-sm font-semibold truncate">{opt.label}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {opt.id === 'system' ? 'Follows OS' : opt.isDark ? 'Dark base' : 'Light base'}
                      </span>
                    </span>
                    {active && (
                      <span className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <Separator />

        {/* Reader Defaults */}
        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-foreground">Reader Defaults</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-3">
              <Label>Reading Direction</Label>
              <Select value={readerSettings.direction} onValueChange={(v: any) => storeActions.setReader({ direction: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="webtoon">Webtoon (Continuous)</SelectItem>
                  <SelectItem value="vertical">Vertical (Gaps)</SelectItem>
                  <SelectItem value="ltr">Left to Right</SelectItem>
                  <SelectItem value="rtl">Right to Left</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <Label>Image Fit</Label>
              <Select value={readerSettings.fit} onValueChange={(v: any) => storeActions.setReader({ fit: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="width">Fit Width</SelectItem>
                  <SelectItem value="height">Fit Height</SelectItem>
                  <SelectItem value="original">Original Size</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <Label>Background</Label>
              <Select value={readerSettings.background} onValueChange={(v: any) => storeActions.setReader({ background: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paper">Paper (Light)</SelectItem>
                  <SelectItem value="black">Black</SelectItem>
                  <SelectItem value="gray">Dark Gray</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <Label>Show Page Number</Label>
              <Switch checked={readerSettings.showPageNumber} onCheckedChange={(v) => storeActions.setReader({ showPageNumber: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Keep Screen On</Label>
                <p className="text-[10px] text-muted-foreground">Prevents device from sleeping while reading</p>
              </div>
              <Switch checked={readerSettings.keepScreenOn} onCheckedChange={(v) => storeActions.setReader({ keepScreenOn: v })} />
            </div>
          </div>
        </section>

        <Separator />

        {/* Content Section */}
        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-foreground">Content Preferences</h2>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="hide-nsfw" className="text-base font-medium">Hide Mature Content</Label>
              <p className="text-sm text-muted-foreground">Filter out 18+ titles from popular and latest feeds.</p>
            </div>
            <Switch
              id="hide-nsfw"
              checked={settings.hideNsfw}
              onCheckedChange={(checked) => updateSettings({ hideNsfw: checked })}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="show-nsfw-badge" className="text-base font-medium">Show 18+ Badge on Covers</Label>
              <p className="text-sm text-muted-foreground">Display a red 18+ label on adult manga thumbnails.</p>
            </div>
            <Switch
              id="show-nsfw-badge"
              checked={settings.showNsfwBadge}
              onCheckedChange={(checked) => updateSettings({ showNsfwBadge: checked })}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="show-alt" className="text-base font-medium">Show Alternative Titles</Label>
              <p className="text-sm text-muted-foreground">Display Japanese/Korean names on manga details.</p>
            </div>
            <Switch
              id="show-alt"
              checked={settings.showAltNames}
              onCheckedChange={(checked) => updateSettings({ showAltNames: checked })}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="dedupe" className="text-base font-medium">Deduplicate Chapters</Label>
              <p className="text-sm text-muted-foreground">Hide duplicate scanlations of the same chapter.</p>
            </div>
            <Switch
              id="dedupe"
              checked={settings.dedupeChapters}
              onCheckedChange={(checked) => updateSettings({ dedupeChapters: checked })}
            />
          </div>
        </section>

        <Separator />

        {/* Display & Network Section */}
        <section className="space-y-6 pt-6">
          <h2 className="text-xl font-semibold text-foreground">Display & Network</h2>

          <div className="space-y-4">
            <Label className="text-base font-medium">Cover Quality</Label>
            <p className="text-sm text-muted-foreground -mt-3">Choose lower quality on slow connections to save bandwidth.</p>
            <RadioGroup
              value={settings.posterQuality}
              onValueChange={(val) => updateSettings({ posterQuality: val as GetPopularPoster })}
              className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-6"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value={GetPopularPoster.small} id="q-small" />
                <Label htmlFor="q-small" className="font-normal cursor-pointer">Small (Faster)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value={GetPopularPoster.medium} id="q-medium" />
                <Label htmlFor="q-medium" className="font-normal cursor-pointer">Medium</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value={GetPopularPoster.large} id="q-large" />
                <Label htmlFor="q-large" className="font-normal cursor-pointer">Large (Best Quality)</Label>
              </div>
            </RadioGroup>
          </div>

          <Separator />

          <div className="space-y-4">
            <Label className="text-base font-medium">Score Position</Label>
            <p className="text-sm text-muted-foreground -mt-3">Where to show community ratings on details.</p>
            <RadioGroup
              value={settings.scorePosition}
              onValueChange={(val) => updateSettings({ scorePosition: val as GetMangaDetailsScore })}
              className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-6"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value={GetMangaDetailsScore.top} id="s-top" />
                <Label htmlFor="s-top" className="font-normal cursor-pointer">Top</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value={GetMangaDetailsScore.bottom} id="s-bottom" />
                <Label htmlFor="s-bottom" className="font-normal cursor-pointer">Bottom</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value={GetMangaDetailsScore.none} id="s-none" />
                <Label htmlFor="s-none" className="font-normal cursor-pointer">Hidden</Label>
              </div>
            </RadioGroup>
          </div>

          <Separator />

          {/* ── Built-in Image Proxy (VPN) ─────────────────────────────── */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="builtin-vpn" className="text-base font-medium flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                Built-in Image Proxy
              </Label>
              <p className="text-sm text-muted-foreground">
                Route chapter images through the server to bypass regional blocks. May slow loading slightly.
              </p>
            </div>
            <Switch
              id="builtin-vpn"
              checked={isVpnEnabled}
              onCheckedChange={toggleVpn}
            />
          </div>
        </section>

        <Separator />

        {/* Backup & Restore */}
        <section className="space-y-6 pt-6">
          <h2 className="text-xl font-semibold text-foreground">Backup & Restore</h2>
          <p className="text-sm text-muted-foreground -mt-4">
            Save your library, history, and settings to a file, or restore from a previous backup.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Button variant="outline" onClick={handleExport} className="flex-1">
              <Download className="mr-2 h-4 w-4" /> Export Backup
            </Button>
            <div className="flex-1 relative">
              <input
                type="file"
                accept=".json"
                ref={fileInputRef}
                onChange={handleImport}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <Button variant="outline" className="w-full pointer-events-none">
                <Upload className="mr-2 h-4 w-4" /> Import Backup
              </Button>
            </div>
          </div>
          <div className="pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-full sm:w-auto">
                  <AlertTriangle className="mr-2 h-4 w-4" /> Reset Everything
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete your entire library, reading history, custom categories, and settings from this device.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleReset} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Yes, delete everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </section>

        <Separator />

        <section className="text-center py-6">
          <p className="text-sm text-muted-foreground">
            Comix Lounge — a personal reading library powered by comix.to.
          </p>
        </section>
      </div>

      <div className="mt-8 sm:hidden text-center">
        <Link href="/stats">
          <Button variant="outline" className="w-full">
            <BarChart3 className="mr-2 h-4 w-4" />
            View Statistics
          </Button>
        </Link>
      </div>
    </main>
  );
}
