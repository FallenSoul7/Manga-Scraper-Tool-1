import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, lazy, Suspense, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PwaProvider } from "@/lib/pwa-context";
import { Header } from "@/components/header";
import { InstallBanner } from "@/components/install-banner";
import { WelcomeOverlay } from "@/components/welcome-overlay";
import { ErrorBoundary } from "@/components/error-boundary";
import { LockLoading } from "@/components/lock-loading";
import { Loader2 } from "lucide-react";
import { BookOpen, Download, RefreshCw, WifiOff } from "lucide-react";
import { isUnlockedThisSession, setUnlocked, shouldLockCurrentMode, refreshServerLock } from "@/lib/lock";
import NotFound from "@/pages/not-found";
import { useOfflineChapters, formatBytes } from "@/lib/offline-db";
import { readerUrl } from "@/lib/utils";

const SearchPage           = lazy(() => import("@/pages/search"));
const MangaDetail          = lazy(() => import("@/pages/manga-detail"));
const Reader               = lazy(() => import("@/pages/reader"));
const SettingsPage         = lazy(() => import("@/pages/settings"));
const LibraryPage          = lazy(() => import("@/pages/library"));
const UpdatesPage          = lazy(() => import("@/pages/updates"));
const HistoryPage          = lazy(() => import("@/pages/history"));
const StatsPage            = lazy(() => import("@/pages/stats"));
const SourcesPage          = lazy(() => import("@/pages/sources"));
const SourceBrowsePage     = lazy(() => import("@/pages/source-browse"));
const PawchiveCreatorPage  = lazy(() => import("@/pages/pawchive-creator"));
const PawchivePostPage     = lazy(() => import("@/pages/pawchive-post"));
const SystemPage           = lazy(() => import("@/pages/system"));
const CategoriesPage       = lazy(() => import("@/pages/categories"));
const DownloadsPage        = lazy(() => import("@/pages/downloads"));
const DownloadsLibraryPage = lazy(() => import("@/pages/downloads-library"));
const ComiAIPage           = lazy(() => import("@/pages/comi-ai"));
const VpnPage              = lazy(() => import("@/pages/vpn"));
const CachePage            = lazy(() => import("@/pages/cache"));
const InstallPage          = lazy(() => import("@/pages/install"));
const LoginPage            = lazy(() => import("@/pages/login"));
const ProfilePage          = lazy(() => import("@/pages/profile"));
const GenerationPage       = lazy(() => import("@/pages/generation"));
const LockPage             = lazy(() => import("@/pages/lock"));
const LockScreen           = lazy(() => import("@/components/lock-screen").then(({ LockScreen }) => ({ default: LockScreen })));

import { useActiveSourceId, applyActiveSource, registerQueryClient } from "@/lib/source";
import { useLibrarySync } from "@/hooks/use-library-sync";
import { useTokenRefresh } from "@/hooks/use-token-refresh";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});
registerQueryClient(queryClient);

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function useOnlineStatus() {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const setOnlineState = () => setOnline(navigator.onLine);
    window.addEventListener("online", setOnlineState);
    window.addEventListener("offline", setOnlineState);
    return () => {
      window.removeEventListener("online", setOnlineState);
      window.removeEventListener("offline", setOnlineState);
    };
  }, []);

  return online;
}

function OfflineHome() {
  const [, setLocation] = useLocation();
  const chapters = useOfflineChapters();
  const totalBytes = chapters.reduce((sum, chapter) => sum + (chapter.sizeBytes || 0), 0);

  return (
    <main className="container mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <div className="rounded-3xl border border-border/70 bg-card p-6 sm:p-8 shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <WifiOff className="h-6 w-6" />
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Offline mode
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Your saved chapters are ready
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          You are offline, so online discovery is paused. Open a downloaded chapter below or manage your offline library.
        </p>

        {chapters.length > 0 ? (
          <div className="mt-6 space-y-2">
            {chapters.slice(0, 6).map((chapter) => (
              <button
                key={chapter.chapterId}
                type="button"
                onClick={() => setLocation(readerUrl(chapter.chapterId, chapter.mangaId, chapter.sourceId, true))}
                className="flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-background/60 p-3 text-left transition-colors hover:bg-muted/50"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BookOpen className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{chapter.mangaTitle}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    Chapter {chapter.chapterNumber} · {chapter.pageUrls.length} pages
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">Read</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
            No chapters have been saved to this device yet.
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setLocation("/downloads")}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            Offline Library
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        </div>
        {chapters.length > 0 && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            {chapters.length} chapter{chapters.length === 1 ? "" : "s"} · {formatBytes(totalBytes)} stored locally
          </p>
        )}
      </div>
    </main>
  );
}

function HomeRoute() {
  const online = useOnlineStatus();
  return online ? <Lazy><LibraryPage /></Lazy> : <OfflineHome />;
}

function ActiveSourceSync() {
  const id = useActiveSourceId();
  useEffect(() => {
    applyActiveSource(id);
  }, [id]);
  return null;
}

/**
 * Full-screen lock gate. Shows the lock screen whenever a PIN is set and the
 * app has not been unlocked this session (reloads re-lock). Re-locks when the
 * app regains focus (visibilitychange -> visible). Never shows on /lock so the
 * PIN management window itself is always reachable.
 *
 * Lock persistence: `unlockedThisSession` is a module-level flag that only a
 * full reload resets, so we explicitly clear it the moment the app is left
 * (visibilitychange -> hidden, window blur, pagehide). The visible handler then
 * re-locks on return when a PIN is set. This keeps the app unlocked across
 * route changes / focus inside the app, but re-locks after tab switches,
 * home-screen backgrounding, and iOS/Android standalone PWA backgrounding.
 */
function LockGate({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [locked, setLocked] = useState(() => !isUnlockedThisSession() && shouldLockCurrentMode());
  const onLockRoute = location === "/lock";

  // Initial check — also cover logged-in users whose PIN lives on the server
  // (fresh device with no local cache). Skip when already unlocked.
  useEffect(() => {
    if (isUnlockedThisSession()) return;
    refreshServerLock().then((serverLocked) => {
      if (serverLocked && !isUnlockedThisSession()) setLocked(true);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-lock on leaving the app and on focus regain, mirroring welcome-overlay.tsx.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      setUnlocked(false);
    };
    const onPageHide = () => setUnlocked(false);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (isUnlockedThisSession()) return;
      if (shouldLockCurrentMode()) setLocked(true);
      refreshServerLock().then((serverLocked) => {
        if (serverLocked && !isUnlockedThisSession()) setLocked(true);
      });
    };

    document.addEventListener("visibilitychange", onHidden);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (locked && !onLockRoute) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<LockLoading />}>
          <LockScreen
            onUnlocked={() => {
              setUnlocked(true);
              setLocked(false);
            }}
          />
        </Suspense>
      </ErrorBoundary>
    );
  }
  return <>{children}</>;
}

function AppContent() {
  useLibrarySync();
  useTokenRefresh();

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <Switch>
        {/* Reader: no header, no nav */}
        <Route path="/reader/:chapterId">
          <Lazy><Reader /></Lazy>
        </Route>

        {/* Pawchive archive flow: creator/fandom → post gallery → media viewer */}
        <Route path="/sources/all.pawchive/creator/:creatorId">
          <Lazy><PawchiveCreatorPage /></Lazy>
        </Route>
        <Route path="/sources/all.pawchive/post/:postId">
          <Lazy><PawchivePostPage /></Lazy>
        </Route>

        {/* Manga detail: no global header */}
        <Route path="/manga/:id">
          <Lazy><MangaDetail /></Lazy>
        </Route>

        {/* Source-context manga detail */}
        <Route path="/sources/:sourceId/manga/:mangaId">
          <Lazy><MangaDetail /></Lazy>
        </Route>

        {/* Source browse: own immersive header */}
        <Route path="/sources/:id">
          <Lazy><SourceBrowsePage /></Lazy>
        </Route>

        {/* Comi AI: own header, no global nav */}
        <Route path="/comi-ai">
          <Lazy><ComiAIPage /></Lazy>
        </Route>

        {/* VPN: own header, no global nav */}
        <Route path="/vpn">
          <Lazy><VpnPage /></Lazy>
        </Route>

        {/* Everything else: global header + bottom nav */}
        <Route>
          <Header />
          <InstallBanner />
          <WelcomeOverlay />
          <div className="flex-1 pb-16 md:pb-0">
            <Switch>
              <Route path="/">
                <HomeRoute />
              </Route>
              <Route path="/search">
                <Lazy><SearchPage /></Lazy>
              </Route>
              <Route path="/settings">
                <Lazy><SettingsPage /></Lazy>
              </Route>
              <Route path="/updates">
                <Lazy><UpdatesPage /></Lazy>
              </Route>
              <Route path="/downloads/library">
                <Lazy><DownloadsLibraryPage /></Lazy>
              </Route>
              <Route path="/downloads">
                <Lazy><DownloadsPage /></Lazy>
              </Route>
              <Route path="/history">
                <Lazy><HistoryPage /></Lazy>
              </Route>
              <Route path="/stats">
                <Lazy><StatsPage /></Lazy>
              </Route>
              <Route path="/sources">
                <Lazy><SourcesPage /></Lazy>
              </Route>
              <Route path="/system">
                <Lazy><SystemPage /></Lazy>
              </Route>
              <Route path="/categories">
                <Lazy><CategoriesPage /></Lazy>
              </Route>
              <Route path="/cache">
                <Lazy><CachePage /></Lazy>
              </Route>
              <Route path="/install">
                <Lazy><InstallPage /></Lazy>
              </Route>
              <Route path="/login">
                <Lazy><LoginPage /></Lazy>
              </Route>
              <Route path="/profile">
                <Lazy><ProfilePage /></Lazy>
              </Route>
              <Route path="/generation">
                <Lazy><GenerationPage /></Lazy>
              </Route>
              <Route path="/lock">
                <Lazy><LockPage /></Lazy>
              </Route>
              <Route component={NotFound} />
            </Switch>
          </div>
        </Route>
      </Switch>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <PwaProvider>
          <ActiveSourceSync />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <LockGate>
              <AppContent />
            </LockGate>
          </WouterRouter>
          <Toaster />
        </PwaProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
