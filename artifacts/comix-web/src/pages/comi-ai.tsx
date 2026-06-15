import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, Send, Paperclip, Sparkles, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  file?: { name: string; size: number };
  timestamp: Date;
}


const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "👋 Hi! I'm **Comi AI** — your manga library assistant.\n\nUpload your **Tachimanga backup** (`.db` or `.tmb`) and tell me how you'd like to organize your library — by genre, status, tags, or any rule you can imagine.\n\nOr just chat with me about manga!",
  timestamp: new Date(),
};

export default function ComiAIPage() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError("");
    setMessages(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "assistant",
        content: `📎 **${f.name}** attached (${(f.size / 1024 / 1024).toFixed(2)} MB)\n\nNow type what you want me to do with your library and hit send!`,
        timestamp: new Date(),
      },
    ]);
    if (e.target) e.target.value = "";
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      file: file ? { name: file.name, size: file.size } : undefined,
      timestamp: new Date(),
    };

    const allMsgs = [...messages, userMsg];
    setMessages(allMsgs);
    setInput("");
    setIsLoading(true);
    setError("");

    try {
      const msgsForApi = allMsgs.slice(-50);

      const routerRes = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgsForApi, hasFile: !!file }),
      });

      if (!routerRes.ok) throw new Error("Failed to connect to AI.");
      const routerData = await routerRes.json();

      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: routerData.response,
          timestamp: new Date(),
        },
      ]);

      if (routerData.intent === "FULL_DB_SCAN" && file) {
        const command = routerData.command || userMsg.content;

        const addMsg = (content: string, id?: string) => {
          const msgId = id || `sys-${Date.now()}`;
          setMessages(prev => {
            if (id && prev.find(m => m.id === id)) {
              return prev.map(m => (m.id === id ? { ...m, content } : m));
            }
            return [...prev, { id: msgId, role: "assistant" as const, content, timestamp: new Date() }];
          });
          return msgId;
        };

        addMsg(`📤 Reading **${file.name}** (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);

        // Read file as base64 for JSON transport to the backend parser
        const fileData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const initRes = await fetch("/api/ai/sort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, action: "init", fileData, fileName: file.name }),
        });

        if (!initRes.ok) {
          const err = await initRes.json().catch(() => ({ error: "Initialization failed" }));
          throw new Error(err.error || "Initialization failed — check your GROQ_API_KEY.");
        }
        const { totalManga, sessionKey } = await initRes.json();

        const progressId = `prog-${Date.now()}`;
        addMsg(`🤖 Found **${totalManga}** manga. Starting AI categorization... (0/${totalManga})`, progressId);

        let cursor = 0;
        let categories: Record<string, number[]> = {};
        let done = false;
        let resultFile = "";

        while (!done) {
          const batchRes = await fetch("/api/ai/sort", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command, action: "batch", cursor, existingCategories: categories, sessionKey, fileName: file.name }),
          });

          if (!batchRes.ok) throw new Error("Batch processing failed.");
          const data = await batchRes.json();

          if (data.status === "processing") {
            cursor = data.nextCursor;
            categories = data.categories;
            addMsg(`🤖 Categorizing... (${Math.min(cursor, totalManga)}/${totalManga})`, progressId);
          } else if (data.status === "done") {
            done = true;
            resultFile = data.resultFileName;
            addMsg(`✅ Done! **${data.totalCategories}** categories created.`, progressId);
          }
        }

        addMsg("📥 Downloading your sorted backup...");

        const dlRes = await fetch(`/api/ai/download?file=${encodeURIComponent(resultFile)}`);
        if (!dlRes.ok) throw new Error("Download failed.");
        const blob = await dlRes.blob();

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = resultFile;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setMessages(prev => [
          ...prev,
          {
            id: `done-${Date.now()}`,
            role: "assistant",
            content: `✅ **"${resultFile}"** downloaded! Import it into Tachimanga to see your newly organized library.`,
            timestamp: new Date(),
          },
        ]);
        setFile(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      setMessages(prev => [
        ...prev,
        { id: `err-${Date.now()}`, role: "assistant", content: `❌ ${msg}`, timestamp: new Date() },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderContent = (text: string) => {
    return text.split(/(\*\*[^*]+\*\*)/).map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <main className="container mx-auto px-4 py-6 max-w-3xl h-[100dvh] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <Link href="/system" className="text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h1 className="font-serif font-bold text-lg leading-none">Comi AI</h1>
            <p className="text-xs text-muted-foreground">Library organizer · manga chat</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 rounded-2xl border border-border bg-card/50 p-4 mb-3">
        <div className="flex flex-col gap-4 pb-2">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground border border-border rounded-bl-sm"
                )}
              >
                {renderContent(msg.content)}
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
              <div className="bg-muted border border-border rounded-2xl rounded-bl-sm px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
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

      {/* Input */}
      <div className="flex gap-2 items-end shrink-0">
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
          accept=".db,.tmb"
          onChange={handleFileSelect}
          className="hidden"
        />

        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            file
              ? "Describe how to sort your library — e.g. group by genre, mark completed…"
              : "Ask anything about manga, or attach a backup to organize it…"
          }
          disabled={isLoading}
          className="min-h-[44px] max-h-[120px] rounded-xl resize-none"
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
