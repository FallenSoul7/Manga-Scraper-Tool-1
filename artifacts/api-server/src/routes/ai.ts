import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { 
  ArrowLeft, Send, Paperclip, Sparkles, X, Loader2, 
  ShieldCheck, ShieldX, Trash2, Cpu, Brain, Zap, Layers 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  role: "user" | "assistant" | "system";
  content: string;
  file?: { name: string; size: number };
  timestamp: Date;
  permissionRequest?: PermissionRequest;
  permissionGranted?: boolean;
  permissionDenied?: boolean;
}

// ── API fetcher ────────────────────────────────────────────────────────────

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
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
    setMessages(prev => [...prev, msg].slice(-20));
    return id;
  }, []);

  const clearChatMemory = () => {
    localStorage.removeItem("comi_lounge_chat");
    setMessages([WELCOME]);
  };

  // ── File select ──────────────────────────────────────────────────────────

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError("");
    addMsg(`📎 **${f.name}** attached (${(f.size / 1024 / 1024).toFixed(2)} MB)\n\nTell me how to sort your library and I'll organize it!`);
    if (e.target) e.target.value = "";
  };

  // ── Send to Secure Backend ───────────────────────────────────────────────

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
    setMessages(prev => [...prev, userMsg].slice(-20));

    try {
      const isOrganize = file && /\b(sort|organise|organize|categoris|categoriz|group|arrang)\b/i.test(userContent);

      if (isOrganize && file) {
        await runLibrarySort(userContent, file);
        return;
      }

      // Prepare history for backend
      const history = messages
        .filter(m => m.id !== "welcome" && !m.permissionRequest)
        .map(m => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: userContent });

      startWakeTimer();
      
      // Secure call to Render Backend
      const res = await apiFetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          modelMode: modelMode
        })
      });

      stopWakeTimer();

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      
      // Backend returns { intent, response, command }
      if (data.response) {
        addMsg(data.response);
      }

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
        return [...prev, { id: msgId, role: "assistant" as const, content, timestamp: new Date() }].slice(-20);
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
          body: JSON.stringify({ action: "batch", command, cursor, existingCategories: categories, sessionKey, fileName: sortFile.name, modelMode }),
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

  const renderContent = (text: string) =>
    text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
      part.startsWith("**") && part.endsWith("**")
        ? <strong key={i}>{part.slice(2, -2)}</strong>
        : <span key={i}>{part}</span>
    );

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
                Search · Recommend · Library Grid ({messages.length}/20)
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
                "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
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
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted border border-border rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                {isWakingUp && (
                  <span className="text-xs text-muted-foreground animate-pulse">
                    Routing to {getModelBadgeDetails().name} via Render…
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

      {/* Input controls with Integrated Box Engine Selector */}
      <div className="flex gap-2 items-end shrink-0">
        
        {/* Soft-Edged Model Selection Box Engine */}
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
    </main>
  );
}
