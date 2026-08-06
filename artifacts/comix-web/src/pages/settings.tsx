import { useSettings } from "@/hooks/use-settings";
import { GetPopularPoster } from "@/hooks/use-settings";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { useStore, storeActions, THEME_OPTIONS, type Theme } from "@/lib/storage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Download, Upload, AlertTriangle, ArrowLeft, Check, Shield } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useRef, useState } from "react";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="space-y-0.5 min-w-0">
        <Label className="text-sm font-medium leading-none">{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const theme = useStore(s => s.theme);
  const readerSettings = useStore(s => s.reader);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isVpnEnabled, setIsVpnEnabled] = useState(
    () => localStorage.getItem("builtin_vpn_enabled") === "true"
  );
  const toggleVpn = (val: boolean) => {
    setIsVpnEnabled(val);
    localStorage.setItem("builtin_vpn_enabled", String(val));
  };

  const handleExport = () => {
    const data = storeActions.exportBackup();
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comihub-backup-${new Date().toISOString().split('T')[0]}.json`;
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
        toast({ title: "Backup restored", description: "Your library and settings have been restored." });
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
    <main className="container mx-auto px-4 py-8 max-w-xl animate-in fade-in duration-300">
      <Link href="/system" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors gap-1.5">
        <ArrowLeft className="h-4 w-4" /> System
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-serif font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Customize your reading experience.</p>
      </div>

      <div className="space-y-0 divide-y divide-border rounded-2xl border border-border overflow-hidden">

        {/* ── Appearance ─────────────────────────────────────────────── */}
        <div className="p-5 space-y-5 bg-card">
          <Section title="Appearance">
            <div className="space-y-3">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Theme</Label>
              <div className="grid grid-cols-2 gap-2">
                {THEME_OPTIONS.map((opt) => {
                  const active = theme === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => storeActions.setTheme(opt.id as Theme)}
                      aria-pressed={active}
                      className={`relative rounded-xl border p-3 text-left transition-all cursor-pointer flex items-center gap-3 ${
                        active
                          ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                          : "border-border hover:border-primary/40 hover:bg-muted/30"
                      }`}
                    >
                      <span
                        className="relative h-8 w-8 rounded-lg border shrink-0 overflow-hidden"
                        style={{ backgroundColor: opt.bg, borderColor: "rgba(128,128,128,0.2)" }}
                      >
                        <span
                          className="absolute inset-1 rounded-md"
                          style={{
                            backgroundColor: opt.swatch,
                            boxShadow: opt.id === 'neon-green' ? `0 0 6px ${opt.swatch}` : undefined,
                          }}
                        />
                      </span>
                      <span className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">{opt.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {opt.id === 'system' ? 'Follows OS' : opt.isDark ? 'Dark' : 'Light'}
                        </span>
                      </span>
                      {active && (
                        <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                          <Check className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cover Quality</Label>
              <p className="text-xs text-muted-foreground -mt-1">Lower quality loads faster on slow connections.</p>
              <RadioGroup
                value={settings.posterQuality}
                onValueChange={(val) => updateSettings({ posterQuality: val as GetPopularPoster })}
                className="flex gap-4"
              >
                {[
                  { value: GetPopularPoster.small, label: "Small" },
                  { value: GetPopularPoster.medium, label: "Medium" },
                  { value: GetPopularPoster.large, label: "Large" },
                ].map(({ value, label }) => (
                  <div key={value} className="flex items-center space-x-2">
                    <RadioGroupItem value={value} id={`q-${value}`} />
                    <Label htmlFor={`q-${value}`} className="font-normal cursor-pointer text-sm">{label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </Section>
        </div>

        {/* ── Reader ─────────────────────────────────────────────────── */}
        <div className="p-5 space-y-4 bg-card">
          <Section title="Reader">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Direction</Label>
                <Select value={readerSettings.direction} onValueChange={(v: any) => storeActions.setReader({ direction: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="webtoon">Webtoon</SelectItem>
                    <SelectItem value="vertical">Vertical</SelectItem>
                    <SelectItem value="ltr">Left → Right</SelectItem>
                    <SelectItem value="rtl">Right → Left</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Image Fit</Label>
                <Select value={readerSettings.fit} onValueChange={(v: any) => storeActions.setReader({ fit: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="width">Fit Width</SelectItem>
                    <SelectItem value="height">Fit Height</SelectItem>
                    <SelectItem value="original">Original</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label className="text-xs text-muted-foreground">Background</Label>
                <Select value={readerSettings.background} onValueChange={(v: any) => storeActions.setReader({ background: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paper">Paper (Light)</SelectItem>
                    <SelectItem value="black">Black</SelectItem>
                    <SelectItem value="gray">Dark Gray</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-3 pt-1">
              <SettingRow label="Show Page Number">
                <Switch checked={readerSettings.showPageNumber} onCheckedChange={(v) => storeActions.setReader({ showPageNumber: v })} />
              </SettingRow>
              <SettingRow label="Keep Screen On" description="Prevents sleep while reading">
                <Switch checked={readerSettings.keepScreenOn} onCheckedChange={(v) => storeActions.setReader({ keepScreenOn: v })} />
              </SettingRow>
            </div>
          </Section>
        </div>

        {/* ── Content ────────────────────────────────────────────────── */}
        <div className="p-5 space-y-4 bg-card">
          <Section title="Content">
            <div className="space-y-3">
              <SettingRow label="Hide Mature Content" description="Filter 18+ titles from feeds">
                <Switch
                  checked={settings.hideNsfw}
                  onCheckedChange={(checked) => updateSettings({ hideNsfw: checked })}
                />
              </SettingRow>
              <Separator />
              <SettingRow label="Show Alternative Titles" description="Japanese/Korean names on details">
                <Switch
                  checked={settings.showAltNames}
                  onCheckedChange={(checked) => updateSettings({ showAltNames: checked })}
                />
              </SettingRow>
              <Separator />
              <SettingRow label="Deduplicate Chapters" description="Hide duplicate scanlations">
                <Switch
                  checked={settings.dedupeChapters}
                  onCheckedChange={(checked) => updateSettings({ dedupeChapters: checked })}
                />
              </SettingRow>
            </div>
          </Section>
        </div>

        {/* ── Network ────────────────────────────────────────────────── */}
        <div className="p-5 bg-card">
          <Section title="Network">
            <SettingRow
              label="Built-in Image Proxy"
              description="Route images through the server to bypass regional blocks"
            >
              <Switch
                checked={isVpnEnabled}
                onCheckedChange={toggleVpn}
              />
            </SettingRow>
            <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-muted/50">
              <Shield className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                May slow image loading slightly. Use the <Link href="/vpn" className="underline underline-offset-2">VPN page</Link> for full proxy controls.
              </p>
            </div>
          </Section>
        </div>

        {/* ── Backup & Restore ───────────────────────────────────────── */}
        <div className="p-5 space-y-4 bg-card">
          <Section title="Backup & Restore" description="Save or restore your library, history, and settings.">
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={handleExport} className="gap-2 text-sm">
                <Download className="h-4 w-4" /> Export
              </Button>
              <div className="relative">
                <input
                  type="file"
                  accept=".json"
                  ref={fileInputRef}
                  onChange={handleImport}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <Button variant="outline" className="w-full gap-2 text-sm pointer-events-none">
                  <Upload className="h-4 w-4" /> Import
                </Button>
              </div>
            </div>
          </Section>
        </div>

        {/* ── Danger Zone ────────────────────────────────────────────── */}
        <div className="p-5 bg-card">
          <Section title="Danger Zone">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="gap-2">
                  <AlertTriangle className="h-4 w-4" /> Reset Everything
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset everything?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes your entire library, reading history, custom categories, and settings from this device. This cannot be undone.
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
          </Section>
        </div>
      </div>

      <p className="text-xs text-center text-muted-foreground mt-8">ComiHub — your personal reading library</p>
    </main>
  );
}
