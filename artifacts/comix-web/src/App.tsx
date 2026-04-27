import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/header";
import NotFound from "@/pages/not-found";

import Home from "@/pages/home";
import SearchPage from "@/pages/search";
import MangaDetail from "@/pages/manga-detail";
import Reader from "@/pages/reader";
import SettingsPage from "@/pages/settings";
import LibraryPage from "@/pages/library";
import UpdatesPage from "@/pages/updates";
import HistoryPage from "@/pages/history";
import StatsPage from "@/pages/stats";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

function AppContent() {
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <Switch>
        {/* Reader gets no header */}
        <Route path="/reader/:chapterId" component={Reader} />
        
        {/* Everything else gets header */}
        <Route path="/.*">
          <Header />
          <div className="flex-1">
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/search" component={SearchPage} />
              <Route path="/manga/:id" component={MangaDetail} />
              <Route path="/settings" component={SettingsPage} />
              <Route path="/library" component={LibraryPage} />
              <Route path="/updates" component={UpdatesPage} />
              <Route path="/history" component={HistoryPage} />
              <Route path="/stats" component={StatsPage} />
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
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppContent />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
