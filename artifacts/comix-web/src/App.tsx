import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PwaProvider } from "@/lib/pwa-context";
import { Header } from "@/components/header";
import { InstallBanner } from "@/components/install-banner";
import { WelcomeOverlay } from "@/components/welcome-overlay";
import { ErrorBoundary } from "@/components/error-boundary";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";

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

function ActiveSourceSync() {
  const id = useActiveSourceId();
  useEffect(() => {
    applyActiveSource(id);
  }, [id]);
  return null;
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
                <Lazy><LibraryPage /></Lazy>
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
            <AppContent />
          </WouterRouter>
          <Toaster />
        </PwaProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
