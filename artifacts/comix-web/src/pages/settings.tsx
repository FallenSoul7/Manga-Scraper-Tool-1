import { useSettings } from "@/hooks/use-settings";
import { GetPopularPoster, GetMangaDetailsScore } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();

  return (
    <main className="container mx-auto px-4 py-12 max-w-2xl animate-in fade-in duration-500">
      <div className="mb-10">
        <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Reading Lounge Settings</h1>
        <p className="text-muted-foreground">Customize your browsing and reading experience.</p>
      </div>

      <div className="space-y-8 bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm">
        
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

      </div>
    </main>
  );
}
