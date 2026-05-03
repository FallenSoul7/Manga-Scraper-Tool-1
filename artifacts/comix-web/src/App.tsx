import { Route, Switch } from "wouter";
import { Header } from "@/components/header";
import LibraryPage from "@/pages/library";
import SearchPage from "@/pages/search";
import MangaDetail from "@/pages/manga-detail";
import SettingsPage from "@/pages/settings";
import UpdatesPage from "@/pages/updates";
import DownloadsPage from "@/pages/downloads";
import DownloadsLibraryPage from "@/pages/downloads-library";
import HistoryPage from "@/pages/history";
import StatsPage from "@/pages/stats";
import SourcesPage from "@/pages/sources";
import SystemPage from "@/pages/system";
import CategoriesPage from "@/pages/categories";
import NotFound from "@/pages/not-found";
import SourceBrowsePage from "@/pages/source-browse";

export default function App() {
  return (
    <Switch>
      <Route path="/sources/:id" component={SourceBrowsePage} />
      <Route path="/downloads/library" component={DownloadsLibraryPage} />
      <Route path="/downloads" component={DownloadsPage} />

      <Route path="/.*">
        <Header />
        <div className="flex-1 pb-16 md:pb-0">
          <Switch>
            <Route path="/" component={LibraryPage} />
            <Route path="/search" component={SearchPage} />
            <Route path="/sources/:sourceId/manga/:mangaId" component={MangaDetail} />
            <Route path="/settings" component={SettingsPage} />
            <Route path="/updates" component={UpdatesPage} />
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
  );
}
