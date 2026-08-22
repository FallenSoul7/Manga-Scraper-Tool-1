import { useMemo, useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch, setExtraHeader } from "@workspace/api-client-react";
import { ArrowLeft, Calendar, Film, Image as ImageIcon, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { proxyImage } from "@/lib/utils";

type Creator = { id: string; title: string; thumbnail: string; author?: string; synopsis?: string };
type Post = {
  id: string;
  number: number;
  title: string;
  date: number;
  thumbnail?: string;
  mediaType?: "image" | "video" | "mixed";
  attachmentCount?: number;
};

export default function PawchiveCreatorPage() {
  const [, params] = useRoute("/sources/all.pawchive/creator/:creatorId");
  const [, setLocation] = useLocation();
  const creatorId = params?.creatorId ? decodeURIComponent(params.creatorId) : "";
  const [search, setSearch] = useState("");

  useEffect(() => { setExtraHeader("X-Source", "all.pawchive"); }, []);

  const details = useQuery<Creator>({
    queryKey: ["pawchive-creator", creatorId],
    queryFn: () => customFetch<Creator>(`/api/manga/${creatorId}`),
    enabled: !!creatorId,
  });
  const posts = useQuery<{ items: Post[] }>({
    queryKey: ["pawchive-creator-posts", creatorId],
    queryFn: () => customFetch<{ items: Post[] }>(`/api/manga/${creatorId}/chapters?dedupe=false`),
    enabled: !!creatorId,
  });

  const visiblePosts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (posts.data?.items ?? []).filter(post => !needle || post.title.toLowerCase().includes(needle));
  }, [posts.data, search]);

  const title = details.data?.title ?? "Pawchive creator";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/sources/all.pawchive")} aria-label="Close creator gallery">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-serif text-lg font-bold">{title}</h1>
            <p className="text-[11px] text-muted-foreground">Pawchive gallery</p>
          </div>
          <button
            type="button"
            onClick={() => setSearch(v => v ? "" : " ")}
            className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Search posts"
          >
            {search.trim() ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
        </div>
        {search !== "" && (
          <div className="px-4 pb-3">
            <Input autoFocus value={search.trim()} onChange={e => setSearch(e.target.value)} placeholder="Search this creator's posts…" />
          </div>
        )}
      </header>

      <section className="mx-auto max-w-7xl px-4 py-5">
        {details.isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : (
          <div className="mb-5 flex items-center gap-3">
            <img src={proxyImage(details.data?.thumbnail, "all.pawchive")} alt="" className="h-16 w-16 rounded-2xl object-cover" />
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{visiblePosts.length} posts · images, GIFs, videos and attachments</p>
            </div>
          </div>
        )}

        {posts.isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : posts.isError ? (
          <div className="py-20 text-center text-sm text-muted-foreground">This creator’s posts could not be loaded.</div>
        ) : visiblePosts.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">No posts found.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visiblePosts.map(post => (
              <button
                key={post.id}
                type="button"
                onClick={() => setLocation(`/sources/all.pawchive/post/${post.id}?creatorId=${encodeURIComponent(creatorId)}`)}
                className="group overflow-hidden rounded-2xl border border-border/50 bg-card text-left transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg"
              >
                <div className="relative aspect-[4/5] overflow-hidden bg-muted">
                  <img src={proxyImage(post.thumbnail, "all.pawchive")} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
                  <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
                    {post.mediaType === "video" ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                    {post.attachmentCount ?? 1}
                  </div>
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-semibold">{post.title}</p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {post.date ? new Date(post.date * 1000).toLocaleDateString() : "Unknown date"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}