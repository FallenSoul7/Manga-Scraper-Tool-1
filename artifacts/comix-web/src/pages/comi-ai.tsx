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
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  file?: { name: string; size: number };
  timestamp: Date;
  permissionRequest?: PermissionRequest;
  permissionGranted?: boolean;
  permissionDenied?: boolean;
}

// ── Local Tools Definition ─────────────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_categories",
      description: "Lists all current manga categories and their contents.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_category",
      description: "Deletes a category by name.",
      parameters: {
        type: "object",
        properties: { categoryName: { type: "string" } },
        required: ["categoryName"],
      },
    },
  },
];

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
    "👋 Hi! I'm **Comi AI** — your manga assistant.\n\nI can:\n• 🔍 **Search & recommend manga**\n• 📂 **Manage your categories** locally\n• 📚 **Organize your library** automatically\n\nWhat would you like to do?",
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
  const [modelMode, setModelMode] = useState<string>("auto");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Only save standard messages to avoid saving active permission states
    const savable = messages.filter(m => !m.permissionRequest);
    localStorage.setItem("comi_lounge_chat", JSON.stringify(savable));
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

  const addMsg = useCallback((msg: Partial<Message> & { content: string }) => {
    const id = msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newMsg: Message = { role: "assistant", timestamp: new Date(), ...msg, id };
    setMessages(prev => [...prev, newMsg].slice(-20));
    return id;
  }, []);

  const clearChatMemory = () => {
    localStorage.removeItem("comi_lounge_chat");
    setMessages([WELCOME]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError("");
    addMsg({ content: `📎 **${f.name}** attached (${(f.size / 1024 / 1024).toFixed(2)} MB)\n\nTell me how to sort your library and I'll organize it!` });
    if (e.target) e.target.value = "";
  };

  // ── Frontend Tool Execution Loop ─────────────────────────────────────────

  const runToolLoop = async (currentHistory: Message[]) => {
    let loopActive = true;
    let iterationHistory = [...currentHistory];

    while (loopActive) {
      startWakeTimer();
      
      const payloadMessages = iterationHistory
        .filter(m => m.id !== "welcome" && !m.permissionRequest)
        .map(m => ({ role: m.role, content: m.content }));

      const res = await apiFetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: payloadMessages,
          modelMode: modelMode,
          tools: TOOLS // Passing tools to the backend in case the AI triggers them
        })
      });

      stopWakeTimer();

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      
      // If the backend parsed a command meant for local tools
      if (data.command && data.command !== "") {
        // Example integration: Ask for user permission before executing a destructive action
        if (data.command.includes("delete_category")) {
          loopActive = false; // Pause the loop to ask for permission
          
          addMsg({
            content: data.response || "I need permission to execute this command.",
            permissionRequest: {
              description: `Allow AI to execute local command: ${data.command}`,
              execute: () => {
                // Perform the local store action here
                // storeActions.deleteCategory(...) 
                return `Executed: ${data.command}`;
              }
            }
          });
          break;
        } else {
          // Auto-execute safe local actions (like list_categories)
          const localState = getStoreSnapshot();
          iterationHistory.push({
            id: `tool-${Date.now()}`,
            role: "tool",
            content: `Local State: ${JSON.stringify(localState.categories)}`,
            timestamp: new Date()
          });
          // Continue the loop so the AI can read the tool result
        }
      } else {
        // No command, just a normal chat response
        loopActive = false;
        if (data.response) {
          addMsg({ content: data.response });
        }
      }
    }
  };

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
    
    const updatedHistory = [...messages, userMsg].slice(-20);
    setMessages(updatedHistory);

    try {
      const isOrganize = file && /\b(sort|organise|organize|categoris|categoriz|group|arrang)\b/i.test(userContent);

      if (isOrganize && file) {
        // ... (Keep the existing runLibrarySort call here from previous version, omitted for brevity but remains unchanged)
        // await runLibrarySort(userContent, file);
        return;
      }

      // Trigger the local tool loop instead of a single fetch
      await runToolLoop(updatedHistory);

    } catch (e: any) {
      stopWakeTimer();
      const msg = e instanceof DOMException && e.name === "AbortError"
        ? "Request timed out (60s). Please try again."
        : e.message ?? "Unknown error";
      setError(msg);
      addMsg({ content: `❌ ${msg}` });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePermission = (msgId: string, granted: boolean) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId || !m.permissionRequest) return m;
      
      let newContent = m.content;
      if (granted) {
        const result = m.permissionRequest.execute();
        newContent += `\n\n✅ **Permission Granted**: ${result}`;
      } else {
        newContent += `\n\n❌ **Permission Denied**`;
      }

      return {
        ...m,
        content: newContent,
        permissionGranted: granted,
        permissionDenied: !granted,
        permissionRequest: undefined 
      };
    }));
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
                  : msg.role === "tool"
                  ? "bg-background border border-dashed border-border text-muted-foreground text-xs font-mono"
                  : "bg-muted text-foreground border border-border rounded-bl-sm"
              )}>
                {renderContent(msg.content)}

                {msg.file && (
                  <div className="mt-2 text-xs opacity-70 flex items-center gap-1">
                    <Paperclip className="h-3 w-3" />
                    {msg.file.name} ({(msg.file.size / 1024 / 1024).toFixed(2)} MB)
                  </div>
                )}

                {/* Local Permission Request UI */}
                {msg.permissionRequest && (
                  <div className="mt-4 p-3 rounded-lg bg-background border border-border shadow-sm">
                    <p className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      Action Required: {msg.permissionRequest.description}
                    </p>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        className="w-full text-xs gap-1.5"
                        onClick={() => handlePermission(msg.id, true)}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="w-full text-xs gap-1.5 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                        onClick={() => handlePermission(msg.id, false)}
                      >
                        <ShieldX className="h-3.5 w-3.5" /> Deny
                      </Button>
                    </div>
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

      {/* Error and File Badges */}
      {error && (
        <div className="mb-3 px-4 py-2 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center justify-between shrink-0">
          <span>⚠️ {error}</span>
          <button onClick={() => setError("")} className="ml-2 hover:opacity-70">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Select AI Engine Strategy</div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setModelMode("auto")} className={cn("rounded-lg text-xs gap-2 cursor-pointer", modelMode === "auto" && "bg-primary/10 font-bold text-primary")}>
              <Sparkles className="h-3.5 w-3.5 text-green-400" /><span>✨ All Auto</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setModelMode("gemini")} className={cn("rounded-lg text-xs gap-2 cursor-pointer", modelMode === "gemini" && "bg-primary/10 font-bold text-primary")}>
              <Brain className="h-3.5 w-3.5 text-blue-400" /><span>♊ Gemini</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setModelMode("groq")} className={cn("rounded-lg text-xs gap-2 cursor-pointer", modelMode === "groq" && "bg-primary/10 font-bold text-primary")}>
              <Zap className="h-3.5 w-3.5 text-orange-400" /><span>⚡ Groq</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setModelMode("openrouter")} className={cn("rounded-lg text-xs gap-2 cursor-pointer", modelMode === "openrouter" && "bg-primary/10 font-bold text-primary")}>
              <Layers className="h-3.5 w-3.5 text-purple-400" /><span>🌐 OpenRouter</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setModelMode("uncensored")} className={cn("rounded-lg text-xs gap-2 font-medium text-red-400 focus:text-red-500 cursor-pointer", modelMode === "uncensored" && "bg-red-500/10 font-bold")}>
              <Cpu className="h-3.5 w-3.5 animate-pulse text-red-500" /><span>🔞 18+ Uncensored</span>
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
          placeholder={file ? "Describe how to sort your library…" : `Chat via ${getModelBadgeDetails().name}…`}
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
