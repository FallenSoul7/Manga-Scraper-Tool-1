import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { apiUrl } from "@/lib/api-url";
import { getCachedUser, onAuthChanged, setCachedUser, clearCachedUser, type CachedUser } from "@/lib/auth-cache";

interface ReaderComment {
  id: number;
  mangaTitle: string;
  chapterLabel: string;
  sourceId: string;
  username: string;
  body: string;
  createdAt: string;
  likeCount: number;
  liked: boolean;
}

interface ReaderCommentsSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSignIn(): void;
  mangaTitle: string;
  mangaAltTitles: string[];
  chapterNumber: number | string | null;
  chapterTitle: string;
  sourceId: string | null;
  chapterId: string;
  offline?: boolean;
}

function getReaderVoterId(): string {
  const storageKey = "comihub-reader-voter-v1";
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return saved;
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `reader-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(storageKey, id);
    return id;
  } catch {
    return `reader-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  return fallback;
}

export function ReaderCommentsSheet({
  open,
  onOpenChange,
  onSignIn,
  mangaTitle,
  mangaAltTitles,
  chapterNumber,
  chapterTitle,
  sourceId,
  chapterId,
  offline = false,
}: ReaderCommentsSheetProps) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<CachedUser | null>(() => getCachedUser());
  const [voterId] = useState(getReaderVoterId);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [likePending, setLikePending] = useState<Record<number, boolean>>({});
  const [actionError, setActionError] = useState("");

  useEffect(() => onAuthChanged(() => setUser(getCachedUser())), []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch(apiUrl("/api/auth/me"), { credentials: "include" })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        if (data?.user) {
          setCachedUser(data.user as CachedUser);
          setUser(data.user as CachedUser);
        } else {
          if (getCachedUser()) clearCachedUser();
          setUser(null);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [open]);

  const scopeKey = [mangaTitle, ...mangaAltTitles]
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|") + `::${chapterNumber ?? ""}::${chapterTitle}`;
  const queryKey = ["reader-comments", scopeKey];
  const commentsQuery = useQuery<{ comments: ReaderComment[] }>({
    queryKey,
    enabled: open && !offline && !!mangaTitle && !!chapterId,
    staleTime: 15_000,
    queryFn: async () => {
      const params = new URLSearchParams({ mangaTitle, chapterTitle, chapterId });
      if (chapterNumber != null) params.set("chapterNumber", String(chapterNumber));
      if (sourceId) params.set("sourceId", sourceId);
      mangaAltTitles.slice(0, 10).forEach((title) => params.append("mangaAltTitle", title));
      const response = await fetch(apiUrl(`/api/reader-comments?${params.toString()}`), {
        credentials: "include",
        headers: { "X-Reader-Voter": voterId },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(data, "Could not load comments."));
      return data as { comments: ReaderComment[] };
    },
  });

  async function postComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      onSignIn();
      return;
    }
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setActionError("");
    try {
      const response = await fetch(apiUrl("/api/reader-comments"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mangaTitle,
          mangaAltTitles: mangaAltTitles.slice(0, 10),
          chapterNumber,
          chapterTitle,
          sourceId,
          chapterId,
          body,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) {
          clearCachedUser();
          setUser(null);
        }
        throw new Error(errorMessage(data, "Could not post your comment."));
      }
      setDraft("");
      await queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not post your comment.");
    } finally {
      setPosting(false);
    }
  }

  async function toggleLike(comment: ReaderComment) {
    if (likePending[comment.id]) return;
    setLikePending((previous) => ({ ...previous, [comment.id]: true }));
    setActionError("");
    try {
      const response = await fetch(apiUrl(`/api/reader-comments/${comment.id}/like`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Reader-Voter": voterId },
        body: JSON.stringify({ liked: !comment.liked }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(data, "Could not update the like."));
      await queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update the like.");
    } finally {
      setLikePending((previous) => {
        const next = { ...previous };
        delete next[comment.id];
        return next;
      });
    }
  }

  const comments = commentsQuery.data?.comments ?? [];
  const chapterDisplay = chapterNumber != null ? `Ch. ${chapterNumber}` : "Chapter";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        overlayClassName="bg-transparent"
        className="flex w-[58vw] max-w-[58vw] flex-col gap-0 bg-zinc-950 p-0 text-zinc-100 sm:w-[58vw] sm:max-w-[58vw]"
        style={{ width: "58vw", maxWidth: "58vw" }}
      >
        <div className="border-b border-white/10 px-4 pb-4 pt-7 pr-10">
          <SheetHeader className="text-left">
            <SheetTitle className="line-clamp-2 break-words text-left text-zinc-100">
              {mangaTitle || "Comments"} · {chapterDisplay}{chapterTitle ? ` — ${chapterTitle}` : ""}
            </SheetTitle>
          </SheetHeader>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {offline ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Comments need an internet connection.</p>
          ) : commentsQuery.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : commentsQuery.isError ? (
            <div className="space-y-3 py-8 text-center text-sm text-muted-foreground">
              <p>{commentsQuery.error instanceof Error ? commentsQuery.error.message : "Could not load comments."}</p>
              <Button variant="outline" size="sm" onClick={() => void commentsQuery.refetch()}>Try again</Button>
            </div>
          ) : comments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No comments yet. Start the conversation.</p>
          ) : comments.map((comment) => (
            <article key={comment.id} className="rounded-xl border border-white/10 bg-zinc-900 p-3">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{comment.username}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(comment.createdAt).toLocaleString()}
                    {comment.sourceId ? ` · ${comment.sourceId}` : ""}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`h-8 shrink-0 gap-1 px-2 ${comment.liked ? "text-rose-500" : "text-muted-foreground"}`}
                  disabled={!!likePending[comment.id]}
                  aria-label={comment.liked ? "Unlike comment" : "Like comment"}
                  aria-pressed={comment.liked}
                  onClick={() => void toggleLike(comment)}
                >
                  {likePending[comment.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className={`h-4 w-4 ${comment.liked ? "fill-current" : ""}`} />}
                  <span>{comment.likeCount}</span>
                </Button>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{comment.body}</p>
            </article>
          ))}
        </div>

        <div className="shrink-0 border-t border-white/10 bg-zinc-950 p-4 pb-5">
          {actionError && <p className="mb-2 text-sm text-destructive" role="alert">{actionError}</p>}
          {user ? (
            <form onSubmit={(event) => void postComment(event)} className="space-y-2">
              <div className="text-xs text-muted-foreground">Commenting as <span className="font-semibold text-foreground">{user.username || user.displayName}</span></div>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
                placeholder="Write a comment…"
                maxLength={2000}
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white outline-none ring-offset-background placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Write a comment"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">{draft.length}/2000</span>
                <Button type="submit" size="sm" disabled={posting || !draft.trim()}>
                  {posting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Comment
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Sign in to post a comment. Likes do not require an account.</p>
              <Button type="button" className="w-full" onClick={onSignIn}>Sign in to comment</Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
