import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { 
  ArrowLeft, Send, Paperclip, Sparkles, X, Loader2, 
  ShieldCheck, ShieldX, Trash2, Cpu, Brain, Zap, Layers, ZoomIn
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { storeActions, getStoreSnapshot } from "@/lib/storage";

const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const FETCH_TIMEOUT_MS = 60_000;

// ── Types ──────────────────────────────────────────────────────────────────

interface PermissionRequest {
  description: string;
  execute: () => string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  file?: { name: string; size: number };
  timestamp: Date;
  permissionRequest?: PermissionRequest;
  permissionGranted?: boolean;
  permissionDenied?: boolean;
}

interface GroqMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface GroqToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// ── Secure AI call ──────────────────────────────────────────────────────────

async function callAIWithWaterfall(
  msgs: GroqMsg[],
  modelMode: string
): Promise<{ content: string | null; tool_calls?: GroqToolCall[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs, modelMode }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText })) as any;
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = await res.json() as any;
    return { content: data.content ?? null, tool_calls: data.tool_calls ?? undefined };
  } finally {
    clearTimeout(timer);
  }
}

// ── API fetcher ────────────────────────────────────────────────────────────

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ── Helper: format items with thumbnails ──────────────────────────────────

function formatItems(items: any[], sourceId?: string): string {
  return items.slice(0, 15).map((m: any) => {
    const title = m.title || "Untitled";
    const thumb = m.thumbnail || m.imageUrl || m.coverUrl || "";
    const type = m.type ? ` [${m.type}]` : "";
    const src = m.source ? ` (${m.source})` : "";
    return thumb ? `![${title}](${thumb}) **${title}**${type}${src}` : `• **${title}**${type}${src}`;
  }).join("\n");
}

// ── Tool execution ─────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, any>): Promise<ExecResult> {
  const state = getStoreSnapshot();

  if (name === "list_sources") {
    try {
      const res = await apiFetch("/api/sources/catalog");
      if (!res.ok) return { result: "Failed to load sources." };
      const data = await res.json() as any;
      const supported = (data.extensions ?? []).filter((e: any) => e.supported);
      if (!supported.length) return { result: "No supported sources found." };
      const list = supported.map((e: any) => `• ${e.name} (ID: ${e.id}, lang: ${e.lang}${e.isNsfw ? ", 18+" : ""})`).join("\n");
      return { result: `Available sources (${supported.length}):\n${list}` };
    } catch {
      return { result: "Could not fetch sources." };
    }
  }

  if (name === "browse_popular") {
    const { sourceId, page = 1 } = args;
    try {
      const res = await apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/popular?page=${page}`);
      if (!res.ok) return { result: `Could not browse ${sourceId}.` };
      const data = await res.json() as any;
      const items: any[] = data.items ?? data.results ?? [];
      if (!items.length) return { result: "No results found." };
      const formatted = formatItems(items);
      return { result: `Popular in ${sourceId}:\n${formatted}` };
    } catch {
      return { result: `Could not browse ${sourceId}.` };
    }
  }

  if (name === "browse_latest") {
    const { sourceId, page = 1 } = args;
    try {
      const res = await apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/latest?page=${page}`);
      if (!res.ok) return { result: `Could not browse latest from ${sourceId}.` };
      const data = await res.json() as any;
      const items: any[] = data.items ?? data.results ?? [];
      if (!items.length) return { result: "No results found." };
      const formatted = formatItems(items);
      return { result: `Latest in ${sourceId}:\n${formatted}` };
    } catch {
      return { result: `Could not browse latest from ${sourceId}.` };
    }
  }

  if (name === "search_manga") {
    const { sourceId, query, page = 1 } = args;
    try {
      const res = await apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/search?q=${encodeURIComponent(query)}&page=${page}`);
      if (!res.ok) return { result: `Search failed in ${sourceId}.` };
      const data = await res.json() as any;
      const items: any[] = data.items ?? data.results ?? [];
      if (!items.length) return { result: `No results for "${query}" in ${sourceId}.` };
      const formatted = formatItems(items);
      return { result: `Search results for "${query}" in ${sourceId}:\n${formatted}` };
    } catch {
      return { result: `Could not search ${sourceId}.` };
    }
  }

  if (name === "global_search") {
    const { query } = args;
    try {
      const res = await apiFetch(`/api/sources/search/global?q=${encodeURIComponent(query)}`);
      if (!res.ok) return { result: `Global search failed for "${query}".` };
      const data = await res.json() as any;
      const items: any[] = data.items ?? data.results ?? [];
      if (!items.length) return { result: `No results found for "${query}" across all sources.` };
      const formatted = formatItems(items, true);
      return { result: `Global search results for "${query}":\n${formatted}` };
    } catch {
      return { result: `Global search failed for "${query}".` };
    }
  }

  if (name === "browse_by_tag") {
    const { sourceId, tagIds, tag, page = 1 } = args;
    // support both old 'tag' string and new 'tagIds' array
    let tagParam = tagIds ? (Array.isArray(tagIds) ? tagIds.join(',') : tagIds) : tag;
    if (!tagParam) return { result: "No tag provided." };
    try {
      const res = await apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/tag/${encodeURIComponent(tagParam)}?page=${page}`);
      if (!res.ok) return { result: `Could not browse tag "${tagParam}" in ${sourceId}.` };
      const data = await res.json() as any;
      const items: any[] = data.items ?? data.results ?? [];
      if (!items.length) return { result: `No results for tag "${tagParam}" in ${sourceId}.` };
      const formatted = formatItems(items);
      return { result: `Results for tag "${tagParam}" in ${sourceId}:\n${formatted}` };
    } catch {
      return { result: `Could not browse tag "${tagParam}" in ${sourceId}.` };
    }
  }

  if (name === "get_source_tags") {
    const { sourceId } = args;
    try {
      const res = await apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/tags`);
      if (!res.ok) return { result: `Could not fetch tags for ${sourceId}.` };
      const tags = await res.json() as any[];
      if (!tags.length) return { result: `No tags found for ${sourceId}.` };
      const list = tags.map((t: any) => `• ${t.name} (ID: ${t.id})${t.count ? ` – ${t.count} titles` : ''}`).join('\n');
      return { result: `Tags for ${sourceId}:\n${list}` };
    } catch {
      return { result: `Could not fetch tags for ${sourceId}.` };
    }
  }

  if (name === "get_manga_details") {
    const { sourceId, mangaId } = args;
    try {
      const res = await apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/manga/${encodeURIComponent(mangaId)}`);
      if (!res.ok) return { result: `Could not fetch details for manga ${mangaId}.` };
      const m = await res.json() as any;
      const genres = m.genres?.join(", ") ?? "N/A";
      const thumb = m.thumbnail || m.imageUrl || m.coverUrl || "";
      const detail = [
        thumb ? `![${m.title}](${thumb})` : "",
        `**${m.title}**`,
        m.description ? `${m.description.slice(0, 300)}${m.description.length > 300 ? "…" : ""}` : "",
        `Author: ${m.author ?? "Unknown"}`,
        `Status: ${m.status ?? "Unknown"}`,
        `Genres: ${genres}`,
        m.chapterCount != null ? `Chapters: ${m.chapterCount}` : "",
      ].filter(Boolean).join("\n");
      return { result: detail };
    } catch {
      return { result: `Could not fetch details for manga ${mangaId}.` };
    }
  }

  if (name === "get_chapters") {
    const { sourceId, mangaId } = args;
    try {
      const res = await apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/manga/${encodeURIComponent(mangaId)}/chapters`);
      if (!res.ok) return { result: `Could not fetch chapters for manga ${mangaId}.` };
      const data = await res.json() as any;
      const chapters: any[] = data.chapters ?? data.items ?? [];
      if (!chapters.length) return { result: "No chapters found." };
      const preview = chapters.slice(0, 10).map((c: any) =>
        `• Ch.${c.number ?? "?"} — ${c.title ?? "Untitled"}${c.uploadDate ? ` (${c.uploadDate})` : ""}`
      ).join("\n");
      const extra = chapters.length > 10 ? `\n…and ${chapters.length - 10} more chapters.` : "";
      return { result: `Chapters (${chapters.length} total):\n${preview}${extra}` };
    } catch {
      return { result: `Could not fetch chapters for manga ${mangaId}.` };
    }
  }

  if (name === "list_categories") {
    const cats = state.categories.sort((a, b) => a.order - b.order);
    const lib = state.library;
    const lines = cats.map(c => {
      const count = Object.values(lib).filter(m => m.categoryIds.includes(c.id)).length;
      return `• ${c.name} (ID: ${c.id}, ${count} manga)`;
    });
    return { result: `User categories:\n${lines.join("\n")}` };
  }

  if (name === "list_library") {
    const { categoryId } = args;
    const lib = Object.values(state.library);
    const filtered = categoryId ? lib.filter(m => m.categoryIds.includes(categoryId)) : lib;
    if (!filtered.length) return { result: "Library is empty (or no manga in that category)." };
    const lines = filtered.slice(0, 30).map(m =>
      `• ${m.title} (ID: ${m.id}${m.categoryIds.length ? `, cats: ${m.categoryIds.join(",")}` : ""})`
    );
    const extra = filtered.length > 30 ? `\n…and ${filtered.length - 30} more.` : "";
    return { result: `Library (${filtered.length} manga):\n${lines.join("\n")}${extra}` };
  }

  if (name === "add_to_library") {
    const { sourceId, mangaId, categoryId } = args;
    try {
      const res = await apiFetch("/api/library/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, mangaId, categoryId }),
      });
      if (!res.ok) return { result: `Failed to add manga to library.` };
      const data = await res.json() as any;
      return { result: `Added "${data.title ?? mangaId}" to library${categoryId ? ` in category ${categoryId}` : ""}.` };
    } catch {
      return { result: `Could not add manga to library.` };
    }
  }

  if (name === "create_category") {
    const { name: catName } = args;
    if (!catName?.trim()) return { result: "Category name cannot be empty." };
    const existing = state.categories.find(c => c.name.toLowerCase() === catName.toLowerCase());
    if (existing) return { result: `Category "${catName}" already exists (ID: ${existing.id}).` };
    const cat = storeActions.addCategory(catName.trim());
    return { result: `Created category "${cat.name}" (ID: ${cat.id}).` };
  }

  if (name === "delete_category") {
    const { categoryId, categoryName } = args;
    if (categoryId === "default") return { result: "Cannot delete the Default category." };
    const cat = state.categories.find(c => c.id === categoryId);
    if (!cat) return { result: `Category "${categoryName}" not found.` };
    const count = Object.values(state.library).filter(m => m.categoryIds.includes(categoryId)).length;
    const desc = `Delete category **"${cat.name}"**${count > 0 ? ` — ${count} manga will be moved to Default` : " (empty category)"}.`;
    return {
      result: `PERMISSION_REQUIRED to delete "${cat.name}". Waiting for user confirmation.`,
      permissionRequest: {
        description: desc,
        execute: () => {
          storeActions.removeCategory(categoryId);
          return `Deleted category "${cat.name}".${count > 0 ? ` ${count} manga moved to Default.` : ""}`;
        },
      },
    };
  }

  if (name === "move_manga_category") {
    const { mangaId, targetCategoryId } = args;
    const manga = state.library[mangaId];
    if (!manga) return { result: `Manga ID "${mangaId}" not found in library.` };
    const cat = state.categories.find(c => c.id === targetCategoryId);
    if (!cat) return { result: `Category ID "${targetCategoryId}" not found.` };
    storeActions.setMangaCategories(mangaId, [targetCategoryId]);
    return { result: `Moved "${manga.title}" to category "${cat.name}".` };
  }

  return { result: `Unknown tool: ${name}` };
}

// ── Welcome message ────────────────────────────────────────────────────────

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "👋 Hi! I'm **Comi AI** — your manga assistant.\n\nI can:\n• 🔍 **Search & recommend manga** across all sources (even ones you haven't installed)\n• 📂 **Manage your categories** — create, delete, move manga between them\n• 📚 **Organize your library** — attach a `.db` or `.tmb` Tachimanga backup to sort everything automatically\n\nWhat would you like to do?",
  timestamp: new Date(),
};

// ── Main component ─────────────────────────────────────────────────────────

export default function ComiAIPage() {
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem("comi_lounge_chat");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
      } catch (_) {
        return [WELCOME];
      }
    }
    return [WELCOME];
  });

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  
  // Model Select State
  const [modelMode, setModelMode] = useState<string>("auto");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localStorage.setItem("comi_lounge_chat", JSON.stringify(messages));
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => { if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current); }, []);

  const startWakeTimer = useCallback(() => {
    if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
    wakeTimerRef.current = setTimeout(() => setIsWakingUp(true), 3000);
  }, []);

  const stopWakeTimer = useCallback(() => {
    if (wakeTimerRef.current) { clearTimeout(wakeTimerRef.current); wakeTimerRef.current = null; }
    setIsWakingUp(false);
  }, []);

  const addMsg = useCallback((content: string, extra: Partial<Message> = {}) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const msg: Message = { id, role: "assistant", content, timestamp: new Date(), ...extra };
    setMessages(prev => [...prev, msg].slice(-50));
    return id;
  }, []);

  const clearChatMemory = () => {
    localStorage.removeItem("comi_lounge_chat");
    setMessages([WELCOME]);
  };

  // ── Grant / Deny permission ──────────────────────────────────────────────

  const handleGrantPermission = useCallback((msgId: string, req: PermissionRequest) => {
    const result = req.execute();
    setMessages(prev => prev.map(m =>
      m.id === msgId ? { ...m, permissionGranted: true, permissionRequest: undefined } : m
    ));
    addMsg(`✅ Done! ${result}`);
  }, [addMsg]);

  const handleDenyPermission = useCallback((msgId: string) => {
    setMessages(prev => prev.map(m =>
      m.id === msgId ? { ...m, permissionDenied: true, permissionRequest: undefined } : m
    ));
    addMsg("❌ Action cancelled.");
  }, [addMsg]);

  // ── Tool-call loop ───────────────────────────────────────────────────────

  const runToolLoop = useCallback(async (groqMsgs: GroqMsg[]) => {
    const MAX_ROUNDS = 8;
    let round = 0;
    let msgs = [...groqMsgs];

    while (round < MAX_ROUNDS) {
      round++;
      const reply = await callAIWithWaterfall(msgs, modelMode);

      if (reply.tool_calls?.length) {
        msgs.push({
          role: "assistant",
          content: reply.content ?? null,
          tool_calls: reply.tool_calls,
        });

        for (const tc of reply.tool_calls) {
          let args: Record<string, any> = {};
          try { args = JSON.parse(tc.function.arguments); } catch { /**/ }

          const { result, permissionRequest } = await executeTool(tc.function.name, args);

          if (permissionRequest) {
            const content = `🔐 **Permission required**\n\n${permissionRequest.description}\n\nClick **Grant Permission** below to proceed, or **Cancel** to skip.`;
            const id = `perm-${Date.now()}`;
            const permMsg: Message = {
              id,
              role: "assistant",
              content,
              timestamp: new Date(),
              permissionRequest,
            };
            setMessages(prev => [...prev, permMsg].slice(-50));
            return;
          }

          msgs.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });
        }
        continue;
      }

      if (reply.content) {
        addMsg(reply.content);
      }
      return;
    }

    addMsg("(Reached maximum tool rounds — please try a simpler request.)");
  }, [addMsg, modelMode]);

  // ── File select ──────────────────────────────────────────────────────────

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError("");
    addMsg(`📎 **${f.name}** attached (${(f.size / 1024 / 1024).toFixed(2)} MB)\n\nTell me how to sort your library and I'll organize it!`);
    if (e.target) e.target.value = "";
  };

  // ── Send ─────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userContent = input.trim();
    setInput("");
    setIsLoading(true);
    setError("");

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userContent,
      file: file ? { name: file.name, size: file.size } : undefined,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg].slice(-50));

    try {
      const isOrganize = file && /\b(sort|organise|organize|categoris|categoriz|group|arrang)\b/i.test(userContent);

      if (isOrganize && file) {
        await runLibrarySort(userContent, file);
        return;
      }

      const history = messages
        .filter(m => m.id !== "welcome" && !m.permissionRequest)
        .map<GroqMsg>(m => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: userContent });

      const aiMsgs: GroqMsg[] = [
        ...history,
      ];

      startWakeTimer();
      await runToolLoop(aiMsgs);
      stopWakeTimer();
    } catch (e: any) {
      stopWakeTimer();
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      const msg = isAbort
        ? "Request timed out (60s). Please try again."
        : e.message ?? "Unknown error";
      setError(msg);
      addMsg(`❌ ${msg}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Library sort via backend ─────────────────────────────────────────────

  const runLibrarySort = async (command: string, sortFile: File) => {
    const addProgress = (content: string, id?: string) => {
      const msgId = id ?? `prog-${Date.now()}`;
      setMessages(prev => {
        if (id && prev.find(m => m.id === id)) {
          return prev.map(m => m.id === id ? { ...m, content } : m);
        }
        return [...prev, { id: msgId, role: "assistant" as const, content, timestamp: new Date() }].slice(-50);
      });
      return msgId;
    };

    try {
      addProgress(`📤 Reading **${sortFile.name}**…`);
      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(sortFile);
      });

      startWakeTimer();
      const initRes = await apiFetch("/api/ai/sort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "init", command, fileData, fileName: sortFile.name }),
      });
      stopWakeTimer();

      if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({ error: "Init failed" }));
        throw new Error(err.error || "Initialization failed");
      }
      const { totalManga, sessionKey } = await initRes.json();
      const progressId = addProgress(`🤖 Found **${totalManga}** manga. Categorising… (0/${totalManga})`);

      let cursor = 0;
      let categories: Record<string, number[]> = {};
      let done = false;
      let resultFile = "";

      while (!done) {
        const batchRes = await apiFetch("/api/ai/sort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "batch", command, cursor, existingCategories: categories, sessionKey, fileName: sortFile.name }),
        });
        if (!batchRes.ok) throw new Error("Batch processing failed.");
        const data = await batchRes.json();
        if (data.status === "processing") {
          cursor = data.nextCursor;
          categories = data.categories;
          addProgress(`🤖 Categorising… (${Math.min(cursor, totalManga)}/${totalManga})`, progressId);
        } else if (data.status === "done") {
          done = true;
          resultFile = data.resultFileName;
          addProgress(`✅ Done! **${data.totalCategories}** categories created.`, progressId);
        }
      }

      addProgress("📥 Downloading sorted backup…");
      const dlRes = await apiFetch(`/api/ai/download?file=${encodeURIComponent(resultFile)}`);
      if (!dlRes.ok) throw new Error("Download failed.");
      const blob = await dlRes.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = resultFile;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addMsg(`✅ **"${resultFile}"** downloaded! Import it into Tachimanga to see your organised library.`);
      setFile(null);
    } catch (e: any) {
      stopWakeTimer();
      throw e;
    }
  };

  // ── Render helpers ───────────────────────────────────────────────────────

  // Render content with markdown images and click-to-zoom
  const renderContent = (text: string) => {
    // Split by image markdown: ![alt](url)
    const parts = text.split(/(!\[[^\]]*\]\([^)]*\))/g);
    return parts.map((part, index) => {
      const imgMatch = part.match(/!\[([^\]]*)\]\(([^)]*)\)/);
      if (imgMatch) {
        const alt = imgMatch[1];
        const url = imgMatch[2];
        return (
          <span key={index} className="inline-block">
            <img
              src={url}
              alt={alt}
              className="max-w-[150px] max-h-[200px] rounded-md cursor-pointer hover:opacity-80 transition-opacity border border-border mt-1 mb-1"
              onClick={() => setZoomedImage(url)}
              loading="lazy"
            />
          </span>
        );
      }
      // Split by bold markdown **text**
      return part.split(/(\*\*[^*]+\*\*)/).map((sub, subIndex) =>
        sub.startsWith("**") && sub.endsWith("**")
          ? <strong key={`${index}-${subIndex}`}>{sub.slice(2, -2)}</strong>
          : <span key={`${index}-${subIndex}`}>{sub}</span>
      );
    });
  };

  const getModelBadgeDetails = () => {
    switch (modelMode) {
      case "gemini": return { name: "Gemini", icon: <Brain className="h-3.5 w-3.5 text-blue-400" /> };
      case "groq": return { name: "Groq", icon: <Zap className="h-3.5 w-3.5 text-orange-400" /> };
      case "openrouter": return { name: "OpenRouter", icon: <Layers className="h-3.5 w-3.5 text-purple-400" /> };
      case "uncensored": return { name: "🔞 18+ Uncensored", icon: <Cpu className="h-3.5 w-3.5 text-red-400" /> };
      default: return { name: "✨ All Auto", icon: <Sparkles className="h-3.5 w-3.5 text-green-400" /> };
    }
  };

  return (
    <main className="container mx-auto px-4 py-6 max-w-3xl h-[100dvh] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <Link href="/system" className="text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="font-serif font-bold text-lg leading-none">Comi AI</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Search · Recommend · Library Grid ({messages.length}/50)
              </p>
            </div>
          </div>
          {messages.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearChatMemory}
              className="text-xs h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1 rounded-xl transition-all"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear Grid
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 rounded-2xl border border-border bg-card/50 p-4 mb-3">
        <div className="flex flex-col gap-4 pb-2">
          {messages.map(msg => (
            <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted text-foreground border border-border rounded-bl-sm"
              )}>
                {renderContent(msg.content)}

                {/* File attachment badge */}
                {msg.file && (
                  <div className="mt-2 text-xs opacity-70 flex items-center gap-1">
                    <Paperclip className="h-3 w-3" />
                    {msg.file.name} ({(msg.file.size / 1024 / 1024).toFixed(2)} MB)
                  </div>
                )}

                {/* Permission buttons */}
                {msg.permissionRequest && !msg.permissionGranted && !msg.permissionDenied && (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5 h-8 text-xs"
                      onClick={() => handleGrantPermission(msg.id, msg.permissionRequest!)}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Grant Permission
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 h-8 text-xs"
                      onClick={() => handleDenyPermission(msg.id)}
                    >
                      <ShieldX className="h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  </div>
                )}
                {msg.permissionGranted && (
                  <p className="mt-2 text-xs text-green-600 flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" /> Permission granted
                  </p>
                )}
                {msg.permissionDenied && (
                  <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                    <ShieldX className="h-3 w-3" /> Cancelled
                  </p>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted border border-border rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                {isWakingUp && (
                  <span className="text-xs text-muted-foreground animate-pulse">
                    Routing to {getModelBadgeDetails().name}…
                  </span>
                )}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Error */}
      {error && (
        <div className="mb-3 px-4 py-2 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center justify-between shrink-0">
          <span>⚠️ {error}</span>
          <button onClick={() => setError("")} className="ml-2 hover:opacity-70">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* File badge */}
      {file && (
        <div className="mb-2 px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary text-xs flex items-center justify-between shrink-0">
          <span className="flex items-center gap-1.5">
            <Paperclip className="h-3.5 w-3.5" />
            {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
          </span>
          <button onClick={() => setFile(null)} className="hover:opacity-70 ml-2">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Input controls */}
      <div className="flex gap-2 items-end shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 rounded-xl border border-border bg-card/60 hover:bg-accent transition-all"
              disabled={isLoading}
              title="Change active cluster provider"
            >
              {getModelBadgeDetails().icon}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 rounded-xl border border-border p-1 bg-popover/95 backdrop-blur-md shadow-xl">
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
              Select AI Engine Strategy
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={() => setModelMode("auto")}
              className={cn("rounded-lg text-xs gap-2 cursor-pointer", modelMode === "auto" && "bg-primary/10 font-bold text-primary")}
            >
              <Sparkles className="h-3.5 w-3.5 text-green-400" />
              <span>✨ All Auto</span>
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => setModelMode("gemini")}
              className={cn("rounded-lg text-xs gap-2 cursor-pointer", modelMode === "gemini" && "bg-primary/10 font-bold text-primary")}
            >
              <Brain className="h-3.5 w-3.5 text-blue-400" />
              <span>♊ Gemini</span>
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => setModelMode("groq")}
              className={cn("rounded-lg text-xs gap-2 cursor-pointer", modelMode === "groq" && "bg-primary/10 font-bold text-primary")}
            >
              <Zap className="h-3.5 w-3.5 text-orange-400" />
              <span>⚡ Groq</span>
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => setModelMode("openrouter")}
              className={cn("rounded-lg text-xs gap-2 cursor-pointer", modelMode === "openrouter" && "bg-primary/10 font-bold text-primary")}
            >
              <Layers className="h-3.5 w-3.5 text-purple-400" />
              <span>🌐 OpenRouter</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={() => setModelMode("uncensored")}
              className={cn("rounded-lg text-xs gap-2 font-medium text-red-400 focus:text-red-500 cursor-pointer", modelMode === "uncensored" && "bg-red-500/10 font-bold")}
            >
              <Cpu className="h-3.5 w-3.5 animate-pulse text-red-500" />
              <span>🔞 18+ Uncensored</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="icon"
          className="shrink-0 rounded-xl"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          title="Attach .db or .tmb backup"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".db,.tmb,.tachibk"
          onChange={handleFileSelect}
          className="hidden"
        />

        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          placeholder={
            file
              ? "Describe how to sort your library…"
              : `Chat via ${getModelBadgeDetails().name}…`
          }
          disabled={isLoading}
          className="min-h-[44px] max-h-[120px] rounded-xl resize-none border border-border bg-card/40 focus-visible:ring-1"
          rows={1}
        />

        <Button
          size="icon"
          className="shrink-0 rounded-xl"
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>

      {/* Zoom Modal */}
      <Dialog open={!!zoomedImage} onOpenChange={() => setZoomedImage(null)}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 bg-transparent border-none shadow-none">
          <div className="relative flex items-center justify-center w-full h-full">
            <img
              src={zoomedImage || ""}
              alt="Zoomed manga cover"
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setZoomedImage(null)}
              className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
