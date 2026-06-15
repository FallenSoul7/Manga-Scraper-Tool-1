import { useStore } from "@/lib/storage";
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Clock, Library, Flame, Trophy, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

function formatDuration(ms: number): { value: string; sub: string } {
  if (ms <= 0) return { value: "0m", sub: "Get reading!" };
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 1) return { value: `${h}h ${m}m`, sub: "Real time tracked" };
  if (m >= 1) return { value: `${m}m`, sub: "Real time tracked" };
  const s = Math.floor(ms / 1000);
  return { value: `${s}s`, sub: "Real time tracked" };
}

export default function StatsPage() {
  const library = useStore(s => s.library);
  const categories = useStore(s => s.categories);
  const progressMap = useStore(s => s.progress);
  const historyKeys = useStore(s => s.history);
  const trackedReadingMs = useStore(s => s.readingTimeMs ?? 0);

  const stats = useMemo(() => {
    const libraryItems = Object.values(library);
    const progressItems = Object.values(progressMap);

    const totalManga = libraryItems.length;
    const chaptersRead = progressItems.filter(p => p.isRead).length;

    // Prefer the real, tracked reading time. Fall back to a chapter-based
    // estimate (~4 min/chapter) until the reader has had a chance to record
    // anything — that way new users don't see "0m" forever.
    const estimatedFallbackMs = chaptersRead * 4 * 60_000;
    const useTracked = trackedReadingMs > 0;
    const effectiveMs = useTracked ? trackedReadingMs : estimatedFallbackMs;
    const formattedTime = formatDuration(effectiveMs);
    const timeSubtitle = useTracked
      ? formattedTime.sub
      : `Est. 4m / chapter${chaptersRead > 0 ? "" : ""}`;

    // Category counts
    const categoryCounts: Record<string, number> = {};
    categories.forEach(c => categoryCounts[c.id] = 0);
    libraryItems.forEach(m => {
      m.categoryIds.forEach(cId => {
        if (categoryCounts[cId] !== undefined) categoryCounts[cId]++;
      });
    });

    // Top 5 most-read manga
    const readCountsByManga: Record<string, { title: string, count: number }> = {};
    progressItems.filter(p => p.isRead).forEach(p => {
      if (!readCountsByManga[p.mangaId]) {
        readCountsByManga[p.mangaId] = { title: p.mangaTitle, count: 0 };
      }
      readCountsByManga[p.mangaId].count++;
    });
    
    const topRead = Object.entries(readCountsByManga)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Reading streak
    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0); // Start of today

    const readingDays = new Set<number>();
    historyKeys.forEach(k => {
      const p = progressMap[k];
      if (p) {
        const d = new Date(p.updatedAt);
        d.setHours(0, 0, 0, 0);
        readingDays.add(d.getTime());
      }
    });

    // Check today or yesterday
    let checkDate = currentDate.getTime();
    if (readingDays.has(checkDate)) {
      streak = 1;
      checkDate -= 86400000;
    } else if (readingDays.has(checkDate - 86400000)) {
      streak = 1;
      checkDate -= 86400000 * 2;
    }

    if (streak > 0) {
      while (readingDays.has(checkDate)) {
        streak++;
        checkDate -= 86400000;
      }
    }

    return {
      totalManga,
      chaptersRead,
      timeDisplay: formattedTime.value,
      timeSubtitle,
      categoryCounts,
      topRead,
      streak,
    };
  }, [library, categories, progressMap, historyKeys, trackedReadingMs]);

  return (
    <main className="container mx-auto px-4 py-12 max-w-4xl animate-in fade-in duration-500">
      <Link href="/system" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary mb-3 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to System
      </Link>
      <div className="mb-10">
        <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Reading Statistics</h1>
        <p className="text-muted-foreground">Your journey through the pages.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Titles in Library</CardTitle>
            <Library className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-serif font-bold">{stats.totalManga}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Chapters Read</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-serif font-bold">{stats.chaptersRead}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Time Read</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-serif font-bold">{stats.timeDisplay}</div>
            <p className="text-xs text-muted-foreground mt-1">{stats.timeSubtitle}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reading Streak</CardTitle>
            <Flame className={`h-4 w-4 ${stats.streak > 0 ? 'text-orange-500' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-serif font-bold flex items-baseline gap-1">
              {stats.streak} <span className="text-lg font-sans font-normal text-muted-foreground">days</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-xl flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" /> Top Series
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topRead.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No reading history yet.</p>
            ) : (
              <div className="space-y-4">
                {stats.topRead.map((item, idx) => (
                  <div key={item.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="text-sm font-bold text-muted-foreground w-4">{idx + 1}</div>
                      <Link href={`/manga/${item.id}`} className="text-sm font-medium truncate hover:text-primary transition-colors">
                        {item.title}
                      </Link>
                    </div>
                    <div className="text-sm text-muted-foreground shrink-0 ml-4">
                      {item.count} ch
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-xl">Library by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <Badge key={cat.id} variant="secondary" className="px-3 py-1 text-sm bg-primary/5 hover:bg-primary/10">
                  {cat.name} <span className="ml-2 opacity-50">{stats.categoryCounts[cat.id] || 0}</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
