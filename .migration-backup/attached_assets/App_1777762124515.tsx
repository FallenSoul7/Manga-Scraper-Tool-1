import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/header";
import NotFound from "@/pages/not-found";

import SearchPage from "@/pages/search";
import MangaDetail from "@/pages/manga-detail";
import Reader from "@/pages/reader";
import SettingsPage from "@/pages/settings";
import LibraryPage from "@/pages/library";
import UpdatesPage from "@/pages/updates";
import HistoryPage from "@/pages/history";
import StatsPage from "@/pages/stats";
import SourcesPage from "@/pages/sources";
import SourceBrowsePage from "@/pages/source-browse";
import SystemPage from "@/pages/system";

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
      <Switch>
        {/* Reader: no header, no nav */}
        <Route path="/reader/:chapterId" component={Reader} />

        {/* Source-context manga detail: no global nav, keeps source header */}
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
              <Route path="/manga/:id" component={MangaDetail} />
              <Route path="/settings" component={SettingsPage} />
              <Route path="/updates" component={UpdatesPage} />
              <Route path="/history" component={HistoryPage} />
              <Route path="/stats" component={StatsPage} />
              <Route path="/sources" component={SourcesPage} />
              <Route path="/system" component={SystemPage} />
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
