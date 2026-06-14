import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/header";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";

const SearchPage          = lazy(() => import("@/pages/search"));
const MangaDetail         = lazy(() => import("@/pages/manga-detail"));
const Reader              = lazy(() => import("@/pages/reader"));
const SettingsPage        = lazy(() => import("@/pages/settings"));
const LibraryPage         = lazy(() => import("@/pages/library"));
const UpdatesPage         = lazy(() => import("@/pages/updates"));
const HistoryPage         = lazy(() => import("@/pages/history"));
const StatsPage           = lazy(() => import("@/pages/stats"));
const SourcesPage         = lazy(() => import("@/pages/sources"));
const SourceBrowsePage    = lazy(() => import("@/pages/source-browse"));
const SystemPage          = lazy(() => import("@/pages/system"));
const CategoriesPage      = lazy(() => import("@/pages/categories"));
const DownloadsPage       = lazy(() => import("@/pages/downloads"));
const DownloadsLibraryPage = lazy(() => import("@/pages/downloads-library"));

import { useActiveSourceId, applyActiveSource, registerQueryClient } from "@/lib/source";

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

function ActiveSourceSync() {
  const id = useActiveSourceId();
  useEffect(() => {
    applyActiveSource(id);
  }, [id]);
  return null;
}

function AppContent() {
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <Suspense fallback={<PageLoader />}>
        <Switch>
          {/* Reader: no header, no nav */}
          <Route path="/reader/:chapterId" component={Reader} />

          {/* Manga detail: no global header — floating back arrow handles nav */}
          <Route path="/manga/:id" component={MangaDetail} />

          {/* Source-context manga detail: no global nav */}
          <Route path="/sources/:sourceId/manga/:mangaId" component={MangaDetail} />

          {/* Source browse: own immersive header, no global nav */}
          <Route path="/sources/:id" component={SourceBrowsePage} />

          {/* Everything else gets the global header + bottom nav */}
          <Route path="/.*">
            <Header />
            <div className="flex-1 pb-16 md:pb-0">
              <Switch>
                <Route path="/" component={LibraryPage} />
                <Route path="/search" component={SearchPage} />
                <Route path="/sources/:sourceId/manga/:mangaId" component={MangaDetail} />
                <Route path="/settings" component={SettingsPage} />
                <Route path="/updates" component={UpdatesPage} />
                <Route path="/downloads/library" component={DownloadsLibraryPage} />
                <Route path="/downloads" component={DownloadsPage} />
                <Route path="/history" component={HistoryPage} />
                <Route path="/stats" component={StatsPage} />
                <Route path="/sources" component={SourcesPage} />
                <Route path="/system" component={SystemPage} />
                <Route path="/categories" component={CategoriesPage} />
                <Route component={NotFound} />
              </Switch>
            </div>
          </Route>
        </Switch>
      </Suspense>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ActiveSourceSync />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppContent />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
