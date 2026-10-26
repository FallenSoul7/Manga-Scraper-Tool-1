import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, lazy, Suspense, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PwaProvider } from "@/lib/pwa-context";
import { Header } from "@/components/header";
import { InstallBanner } from "@/components/install-banner";
import { NativeUpdateBanner } from "@/components/native-update-banner";
import { WelcomeOverlay } from "@/components/welcome-overlay";
import { FirstUseConsent } from "@/components/first-use-consent";
import { ErrorBoundary } from "@/components/error-boundary";
import { LockLoading } from "@/components/lock-loading";
import { Loader2 } from "lucide-react";
import { isUnlockedThisSession, setUnlocked, shouldLockCurrentMode, refreshServerLock } from "@/lib/lock";
import NotFound from "@/pages/not-found";
import { OfflineCatalogPersistence, useOnlineStatus } from "@/lib/offline-catalog";
import { BackendWarmup } from "@/components/backend-warmup";

const SearchPage           = lazy(() => import("@/pages/search"));
const MangaDetail          = lazy(() => import("@/pages/manga-detail"));
const Reader               = lazy(() => import("@/pages/reader"));
const SettingsPage         = lazy(() => import("@/pages/settings"));
function lazyWithChunkRecovery<T extends { default: React.ComponentType<any> }>(loader: () => Promise<T>, key: string) {
  return lazy(async () => {
    try {
      const module = await loader();
      try { sessionStorage.removeItem(`comihub:chunk-recovery:${key}`); } catch { /* storage may be restricted */ }
      return module;
    } catch (error) {
      // An installed PWA can retain an old HTML shell while Vercel has already
      // replaced its hashed lazy chunk. Clear stale app caches and reload once;
      // the session flag prevents an infinite reload loop.
      const recoveryKey = `comihub:chunk-recovery:${key}`;
      let alreadyRetried = false;
      try { alreadyRetried = sessionStorage.getItem(recoveryKey) === "1"; } catch { /* ignore */ }
      if (!alreadyRetried) {
        try { sessionStorage.setItem(recoveryKey, "1"); } catch { /* ignore */ }
        try {
          const registrations = await navigator.serviceWorker?.getRegistrations();
          await Promise.all((registrations ?? []).map(registration => registration.unregister()));
          const cacheKeys = await caches?.keys();
          await Promise.all((cacheKeys ?? []).map(cacheKey => caches.delete(cacheKey)));
        } catch { /* continue with a normal reload */ }
        window.location.reload();
      }
      throw error;
    }
  });
}
const SubscriptionPage     = lazyWithChunkRecovery(() => import("@/pages/subscription"), "subscription");
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
const CachePage            = lazy(() => import("@/pages/cache"));
const InstallPage          = lazy(() => import("@/pages/install"));
const InstallComihubPage   = lazy(() => import("@/pages/install-comix"));
const LoginPage            = lazy(() => import("@/pages/login"));
const OwnerRecoveryPage    = lazy(() => import("@/pages/owner-recovery"));
const ResetPasswordPage    = lazy(() => import("@/pages/reset-password"));
const ProfilePage          = lazy(() => import("@/pages/profile"));
const AboutPage            = lazy(() => import("@/pages/about"));
const ContactPage          = lazy(() => import("@/pages/contact"));
const DmcaPage             = lazy(() => import("@/pages/dmca"));
const PrivacyPage          = lazy(() => import("@/pages/legal").then(({ PrivacyPage }) => ({ default: PrivacyPage })));
const TermsPage            = lazy(() => import("@/pages/legal").then(({ TermsPage }) => ({ default: TermsPage })));
const AdvertisingPage     = lazy(() => import("@/pages/legal").then(({ AdvertisingPage }) => ({ default: AdvertisingPage })));
const LockPage             = lazy(() => import("@/pages/lock"));
const LockScreen           = lazy(() => import("@/components/lock-screen").then(({ LockScreen }) => ({ default: LockScreen })));

import { useActiveSourceId, applyActiveSource, registerQueryClient } from "@/lib/source";
import { useLibrarySync } from "@/hooks/use-library-sync";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 5 * 60 * 1000,
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 4000),
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

function HomeRoute() {
  return <Lazy><LibraryPage /></Lazy>;
}

function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="border-b border-amber-500/25 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-700 dark:text-amber-300">
      Offline mode · your library, history, categories, settings, and downloaded chapters remain available.
    </div>
  );
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
  const isPublicComplianceRoute = ["/privacy", "/terms", "/advertising", "/about", "/contact", "/dmca", "/reset-password"].includes(location);

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

  if (locked && !onLockRoute && !isPublicComplianceRoute) {
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

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <OfflineCatalogPersistence />
      <BackendWarmup />
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

        {/* Everything else: global header + bottom nav */}
        <Route>
          <Header />
          <InstallBanner />
          <NativeUpdateBanner />
          <WelcomeOverlay />
          <OfflineBanner />
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
              <Route path="/subscription">
                <Lazy><SubscriptionPage /></Lazy>
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
              <Route path="/install-comihub">
                <Lazy><InstallComihubPage /></Lazy>
              </Route>
              <Route path="/login">
                <Lazy><LoginPage /></Lazy>
              </Route>
              <Route path="/owner-recovery">
                <Lazy><OwnerRecoveryPage /></Lazy>
              </Route>
              <Route path="/reset-password">
                <Lazy><ResetPasswordPage /></Lazy>
              </Route>
              <Route path="/profile">
                <Lazy><ProfilePage /></Lazy>
              </Route>
              <Route path="/about">
                <Lazy><AboutPage /></Lazy>
              </Route>
              <Route path="/contact">
                <Lazy><ContactPage /></Lazy>
              </Route>
              <Route path="/dmca">
                <Lazy><DmcaPage /></Lazy>
              </Route>
              <Route path="/privacy">
                <Lazy><PrivacyPage /></Lazy>
              </Route>
              <Route path="/terms">
                <Lazy><TermsPage /></Lazy>
              </Route>
              <Route path="/advertising">
                <Lazy><AdvertisingPage /></Lazy>
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
          <FirstUseConsent />
          <Toaster />
          <Analytics />
        </PwaProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
