import { useSettings } from "@/hooks/use-settings";
import { GetPopularPoster, GetMangaDetailsScore } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { useStore, storeActions } from "@/lib/storage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Download, Upload, Trash2, BarChart3, AlertTriangle } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useRef } from "react";

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const theme = useStore(s => s.theme);
  const readerSettings = useStore(s => s.reader);
  const categories = useStore(s => s.categories);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        toast({
          title: "Backup restored",
          description: "Your library and settings have been restored successfully.",
        });
      } else {
        toast({
          title: "Restore failed",
          description: error || "Invalid backup file",
          variant: "destructive",
        });
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
      <div className="mb-10 flex items-center justify-between">
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
        
        {/* Appearance Section */}
        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-foreground">Appearance</h2>
          
          <div className="space-y-4">
            <Label className="text-base font-medium">Theme</Label>
            <RadioGroup
              value={theme}
              onValueChange={(val: any) => storeActions.setTheme(val)}
              className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-6"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="light" id="t-light" />
                <Label htmlFor="t-light" className="font-normal cursor-pointer">Light</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="dark" id="t-dark" />
                <Label htmlFor="t-dark" className="font-normal cursor-pointer">Dark</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="system" id="t-system" />
                <Label htmlFor="t-system" className="font-normal cursor-pointer">System</Label>
              </div>
            </RadioGroup>
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

        {/* Display Section */}
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
