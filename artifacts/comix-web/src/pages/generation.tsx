import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, Sparkles, Wand2, Video, Brain,
  Loader2, Download, Trash2, RotateCcw, Play, Pause,
  RefreshCw, ImageOff, ChevronRight, X, Zap, Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  getHistory,
  addToHistory,
  deleteFromHistory,
  type ArtHistoryItem,
} from "@/lib/art-history";

const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

// ── Animation engine ──────────────────────────────────────────────────────────

type AnimType = "walk" | "jump" | "fight" | "idle" | "fly" | "spin" | "shake" | "run";
type AnimDir  = "right" | "left" | "up" | "down" | "none";
type AnimSpeed = "slow" | "normal" | "fast";

const SPEED_MAP: Record<AnimSpeed, number> = { slow: 0.5, normal: 1, fast: 2 };

function animateFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvas: HTMLCanvasElement,
  t: number,
  animType: AnimType,
  direction: AnimDir,
  speedMult: number
): void {
  const W = canvas.width;
  const H = canvas.height;
  const s = speedMult;

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);

  // Fit image to canvas keeping aspect ratio
  const scale = Math.min((W * 0.7) / img.naturalWidth, (H * 0.7) / img.naturalHeight);
  const iw = img.naturalWidth * scale;
  const ih = img.naturalHeight * scale;

  let tx = 0;
  let ty = 0;
  let rot = 0;
  let sx = 1;
  let sy = 1;

  switch (animType) {
    case "walk":
    case "run": {
      const speed = animType === "run" ? 1.8 : 1;
      const dir = direction === "left" ? -1 : 1;
      tx = ((t * 60 * s * speed * dir) % (W + iw)) - iw / 2;
      ty = Math.sin(t * 8 * s) * 6;
      rot = Math.sin(t * 8 * s) * 0.02;
      break;
    }
    case "jump": {
      const cycle = ((t * s) % 2) / 2; // 0..1 per cycle
      ty = -Math.abs(Math.sin(cycle * Math.PI)) * 80;
      rot = Math.sin(cycle * Math.PI * 2) * 0.08;
      sx = 1 - Math.abs(Math.sin(cycle * Math.PI)) * 0.05;
      sy = 1 + Math.abs(Math.sin(cycle * Math.PI)) * 0.05;
      break;
    }
    case "fight": {
      tx = Math.sin(t * 12 * s) * 8;
      ty = Math.sin(t * 10 * s) * 5;
      rot = Math.sin(t * 15 * s) * 0.08;
      sx = 1 + Math.abs(Math.sin(t * 12 * s)) * 0.04;
      sy = 1 - Math.abs(Math.sin(t * 12 * s)) * 0.04;
      break;
    }
    case "idle": {
      ty = Math.sin(t * 1.5 * s) * 5;
      sx = 1 + Math.sin(t * 1.5 * s) * 0.01;
      sy = 1 - Math.sin(t * 1.5 * s) * 0.01;
      rot = Math.sin(t * 0.8 * s) * 0.01;
      break;
    }
    case "fly": {
      tx = Math.cos(t * 0.8 * s) * 40;
      ty = Math.sin(t * 1.2 * s) * 30;
      rot = Math.sin(t * 0.8 * s) * 0.05;
      break;
    }
    case "spin": {
      rot = t * 2 * s;
      break;
    }
    case "shake": {
      tx = Math.sin(t * 20 * s) * 10;
      ty = Math.cos(t * 18 * s) * 6;
      break;
    }
  }

  ctx.transform(sx, 0, 0, sy, tx, ty);
  ctx.rotate(rot);
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  ctx.restore();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HistoryPanel({
  history,
  onSelect,
  onDelete,
}: {
  history: ArtHistoryItem[];
  onSelect: (item: ArtHistoryItem) => void;
  onDelete: (id: string) => void;
}) {
  if (history.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Recent Arts ({history.length}/5)
      </h3>
      <div className="flex gap-3 flex-wrap">
        {history.map((item) => (
          <div
            key={item.id}
            className="relative group w-20 h-20 rounded-xl overflow-hidden border border-border cursor-pointer hover:border-primary/60 transition-all"
            onClick={() => onSelect(item)}
          >
            <img
              src={item.imageUrl}
              alt={item.prompt}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
              <button
                className="p-1 rounded bg-destructive/80 text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item.id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5">
              <p className="text-[8px] text-white truncate">{item.prompt}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Draw Tab ──────────────────────────────────────────────────────────────────

function DrawTab() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("manga");
  const [isGenerating, setIsGenerating] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [revisedPrompt, setRevisedPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ArtHistoryItem[]>(() => getHistory().filter(h => h.type === "draw"));

  const styles = [
    { id: "manga", label: "Manga" },
    { id: "anime", label: "Anime" },
    { id: "sketch", label: "Sketch" },
    { id: "watercolor", label: "Watercolor" },
    { id: "realistic", label: "Realistic" },
  ];

  const generate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/generation/draw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), style }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setImageUrl(data.imageUrl);
      setRevisedPrompt(data.revisedPrompt);

      const item: ArtHistoryItem = {
        id: crypto.randomUUID(),
        type: "draw",
        prompt: prompt.trim(),
        imageUrl: data.imageUrl,
        createdAt: Date.now(),
      };
      const next = addToHistory(item);
      setHistory(next.filter(h => h.type === "draw"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDelete = (id: string) => {
    const next = deleteFromHistory(id);
    setHistory(next.filter(h => h.type === "draw"));
  };

  const handleSelect = (item: ArtHistoryItem) => {
    setImageUrl(item.imageUrl);
    setPrompt(item.prompt);
    setRevisedPrompt(null);
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `comix-art-${Date.now()}.png`;
    a.target = "_blank";
    a.click();
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Textarea
          placeholder="Describe what you want to draw… e.g. 'a samurai standing under cherry blossoms at dusk'"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-[90px] resize-none bg-card border-border"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
          }}
        />

        {/* Style pills */}
        <div className="flex gap-2 flex-wrap">
          {styles.map((s) => (
            <button
              key={s.id}
              onClick={() => setStyle(s.id)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                style === s.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <Button
          onClick={generate}
          disabled={isGenerating || !prompt.trim()}
          className="w-full gap-2"
        >
          {isGenerating ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
          ) : (
            <><Wand2 className="h-4 w-4" /> Generate Art</>
          )}
        </Button>
      </div>

      {error && (
        <div className={cn(
          "rounded-xl p-4 text-sm",
          error.includes("OPENAI_API_KEY")
            ? "bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400"
            : "bg-destructive/10 border border-destructive/30 text-destructive"
        )}>
          {error.includes("OPENAI_API_KEY")
            ? "Image generation requires an OpenAI API key (DALL-E 3). This feature is not available without one."
            : error}
        </div>
      )}

      {imageUrl && (
        <div className="space-y-3">
          <div className="relative rounded-2xl overflow-hidden border border-border bg-card">
            <img
              src={imageUrl}
              alt={prompt}
              className="w-full object-contain max-h-[480px]"
            />
            <div className="absolute top-3 right-3 flex gap-2">
              <Button size="sm" variant="secondary" className="gap-1.5 shadow-lg" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" /> Save
              </Button>
            </div>
          </div>
          {revisedPrompt && revisedPrompt !== prompt && (
            <p className="text-xs text-muted-foreground italic px-1">
              <span className="font-medium">AI adjusted prompt:</span> {revisedPrompt}
            </p>
          )}
        </div>
      )}

      <HistoryPanel
        history={history}
        onSelect={handleSelect}
        onDelete={handleDelete}
      />
    </div>
  );
}

// ── Live Draw Tab ─────────────────────────────────────────────────────────────

function LiveDrawTab() {
  const [description, setDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [speedMult, setSpeedMult] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  // Current animation data
  const [animData, setAnimData] = useState<{
    imageUrl: string;
    animationType: AnimType;
    direction: AnimDir;
    speed: AnimSpeed;
    bgColor: string;
    description: string;
  } | null>(null);

  const [history, setHistory] = useState<ArtHistoryItem[]>(() =>
    getHistory().filter((h) => h.type === "animate")
  );

  // Draw loop
  const drawLoop = useCallback(
    (timestamp: number) => {
      const canvas = canvasRef.current;
      const img = imgRef.current;
      if (!canvas || !img || !animData) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (startTimeRef.current === 0) startTimeRef.current = timestamp;
      const t = (timestamp - startTimeRef.current) / 1000;

      // Background
      ctx.fillStyle = animData.bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      animateFrame(ctx, img, canvas, t, animData.animationType, animData.direction, speedMult);

      if (isLooping) {
        rafRef.current = requestAnimationFrame(drawLoop);
      } else {
        // Play once — stop after one full cycle (~2s)
        if (t < 3) {
          rafRef.current = requestAnimationFrame(drawLoop);
        } else {
          setIsPlaying(false);
        }
      }
    },
    [animData, isLooping, speedMult]
  );

  useEffect(() => {
    if (isPlaying && animData) {
      startTimeRef.current = 0;
      rafRef.current = requestAnimationFrame(drawLoop);
    } else {
      cancelAnimationFrame(rafRef.current);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, drawLoop, animData]);

  // Load image into canvas when animData changes
  useEffect(() => {
    if (!animData) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      // Draw first frame
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = animData.bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      animateFrame(ctx, img, canvas, 0, animData.animationType, animData.direction, speedMult);
      setIsPlaying(true);
    };
    img.src = animData.imageUrl;
  }, [animData]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    if (!description.trim()) return;
    setIsGenerating(true);
    setError(null);
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
    imgRef.current = null;

    try {
      const res = await fetch(`${API_BASE}/api/generation/animate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");

      const anim = {
        imageUrl: data.imageUrl as string,
        animationType: (data.animationType ?? "idle") as AnimType,
        direction: (data.direction ?? "none") as AnimDir,
        speed: (data.speed ?? "normal") as AnimSpeed,
        bgColor: (data.bgColor ?? "#1a1a2e") as string,
        description: description.trim(),
      };
      setAnimData(anim);
      setSpeedMult(SPEED_MAP[anim.speed]);

      const item: ArtHistoryItem = {
        id: crypto.randomUUID(),
        type: "animate",
        prompt: description.trim(),
        imageUrl: data.imageUrl,
        animationType: anim.animationType,
        direction: anim.direction,
        speed: anim.speed,
        bgColor: anim.bgColor,
        createdAt: Date.now(),
      };
      const next = addToHistory(item);
      setHistory(next.filter((h) => h.type === "animate"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Record 3s of canvas as WebM
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comix-animation-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };
    recorder.start();
    setTimeout(() => recorder.stop(), 3000);
  };

  const handleSelect = (item: ArtHistoryItem) => {
    setDescription(item.prompt);
    setAnimData({
      imageUrl: item.imageUrl,
      animationType: (item.animationType ?? "idle") as AnimType,
      direction: (item.direction ?? "none") as AnimDir,
      speed: (item.speed ?? "normal") as AnimSpeed,
      bgColor: item.bgColor ?? "#1a1a2e",
      description: item.prompt,
    });
    setSpeedMult(SPEED_MAP[(item.speed ?? "normal") as AnimSpeed]);
  };

  const handleDelete = (id: string) => {
    const next = deleteFromHistory(id);
    setHistory(next.filter((h) => h.type === "animate"));
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Textarea
          placeholder="Describe the animation… e.g. 'a ninja jumping forward' or 'a dragon flying through clouds'"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[90px] resize-none bg-card border-border"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
          }}
        />
        <Button
          onClick={generate}
          disabled={isGenerating || !description.trim()}
          className="w-full gap-2"
        >
          {isGenerating ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Generating animation…</>
          ) : (
            <><Video className="h-4 w-4" /> Generate Live Draw</>
          )}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Canvas */}
      <div
        className={cn(
          "relative rounded-2xl overflow-hidden border border-border transition-all",
          animData ? "block" : "hidden"
        )}
        style={{ background: animData?.bgColor ?? "#1a1a2e" }}
      >
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          className="w-full"
          style={{ display: "block" }}
        />

        {/* Controls overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3 flex items-center gap-3">
          {/* Play / Pause */}
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/20 h-8 w-8"
            onClick={() => setIsPlaying((p) => !p)}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>

          {/* Loop toggle */}
          <button
            onClick={() => setIsLooping((l) => !l)}
            className={cn(
              "flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-all",
              isLooping
                ? "bg-primary/30 border-primary/60 text-primary"
                : "border-white/20 text-white/60"
            )}
          >
            <RefreshCw className="h-3 w-3" />
            Loop
          </button>

          {/* Speed */}
          <div className="flex items-center gap-1 text-xs text-white/60">
            <Zap className="h-3 w-3" />
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.25}
              value={speedMult}
              onChange={(e) => setSpeedMult(Number(e.target.value))}
              className="w-20 accent-primary"
            />
            <span className="w-6 text-right">{speedMult}×</span>
          </div>

          <div className="flex-1" />

          {/* Download */}
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5 h-7 text-xs"
            onClick={handleDownload}
          >
            <Download className="h-3.5 w-3.5" /> Save video
          </Button>
        </div>
      </div>

      {animData && (
        <p className="text-xs text-muted-foreground px-1">
          <span className="font-medium capitalize">{animData.animationType}</span> animation
          {animData.direction !== "none" && ` · ${animData.direction}`}. Images expire from
          DALL-E after ~1 hr — save the video if you want to keep it.
        </p>
      )}

      <HistoryPanel
        history={history}
        onSelect={handleSelect}
        onDelete={handleDelete}
      />
    </div>
  );
}

// ── Knowledge Tab ─────────────────────────────────────────────────────────────

interface KnowledgeStats {
  totalManga: number;
  status: string;
}

interface AnalysisResult {
  stored: boolean;
  title: string;
  tags: string[];
  description: string;
  chapterCount: number;
  pagesAnalyzed: number;
  pageAnalyses: string[];
  setupSql?: string;
  error?: string;
}

function KnowledgeTab() {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [sourceId, setSourceId] = useState<"en.ninehentai" | "all.thunderscans">("en.ninehentai");
  const [mangaId, setMangaId] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/generation/knowledge/stats`)
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => setStats({ totalManga: 0, status: "error" }));
  }, [result]);

  const analyze = async () => {
    if (!mangaId.trim()) return;
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/generation/analyze-manga`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, mangaId: mangaId.trim() }),
      });
      const data: AnalysisResult = await res.json();
      if (!res.ok) throw new Error((data as unknown as { error: string }).error ?? "Failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats card */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4 text-center">
          <div className="text-3xl font-bold text-primary mb-1">
            {stats ? stats.totalManga : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
          </div>
          <div className="text-xs text-muted-foreground">Manga in knowledge base</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 text-center">
          <div className="text-3xl font-bold text-primary mb-1">
            <Brain className="h-6 w-6 mx-auto text-primary" />
          </div>
          <div className="text-xs text-muted-foreground">
            {stats?.status === "table_not_created"
              ? "Table not set up yet"
              : "RAG knowledge active"}
          </div>
        </div>
      </div>

      {stats?.status === "table_not_created" && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 text-sm text-amber-600 dark:text-amber-400">
          <p className="font-semibold mb-2">One-time setup needed</p>
          <p className="text-xs mb-3">
            Run this SQL in your{" "}
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Supabase SQL editor
            </a>{" "}
            to create the knowledge table:
          </p>
          <button
            onClick={() => setShowSql((s) => !s)}
            className="text-xs flex items-center gap-1 text-amber-500 hover:text-amber-400"
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", showSql && "rotate-90")} />
            {showSql ? "Hide" : "Show"} SQL
          </button>
          {showSql && (
            <pre className="mt-2 text-xs bg-black/30 rounded p-3 overflow-auto whitespace-pre-wrap font-mono">
{`CREATE TABLE IF NOT EXISTS manga_knowledge (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id TEXT NOT NULL,
  manga_id TEXT NOT NULL,
  title TEXT,
  author TEXT,
  status TEXT,
  description TEXT,
  tags TEXT[],
  chapter_count INTEGER,
  page_analyses TEXT[],
  analyzed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_id, manga_id)
);`}
            </pre>
          )}
        </div>
      )}

      {/* Analyze form */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Analyze a Manga</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Fetches metadata, tags, and analyzes pages with AI vision. Stored in your knowledge base
          to make Comi AI smarter about your collection.
        </p>

        {/* Source selector */}
        <div className="flex gap-2">
          {(
            [
              { id: "en.ninehentai", label: "NineHentai" },
              { id: "all.thunderscans", label: "ThunderScans" },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              onClick={() => setSourceId(s.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                sourceId === s.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder={
            sourceId === "en.ninehentai"
              ? "Manga ID or URL (e.g. 12345 or https://9hentai.so/...)"
              : "Manga ID or slug (e.g. solo-leveling)"
          }
          value={mangaId}
          onChange={(e) => setMangaId(e.target.value)}
          className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          onKeyDown={(e) => e.key === "Enter" && analyze()}
        />

        <Button
          onClick={analyze}
          disabled={isAnalyzing || !mangaId.trim()}
          className="w-full gap-2"
        >
          {isAnalyzing ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing…</>
          ) : (
            <><Sparkles className="h-4 w-4" /> Analyze &amp; Add to Knowledge Base</>
          )}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className={cn(
              "h-2 w-2 rounded-full",
              result.stored ? "bg-green-500" : "bg-amber-500"
            )} />
            <span className="text-sm font-semibold">
              {result.stored ? "Saved to knowledge base" : "Analyzed (not stored — run SQL above)"}
            </span>
          </div>
          <p className="font-bold text-base">{result.title}</p>
          {result.description && (
            <p className="text-sm text-muted-foreground line-clamp-3">{result.description}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {result.tags.slice(0, 12).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
              >
                {tag}
              </span>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            {result.chapterCount} chapters · {result.pagesAnalyzed} pages analyzed by AI vision
          </div>
          {result.pageAnalyses.length > 0 && (
            <div className="space-y-2 mt-2">
              <p className="text-xs font-semibold text-muted-foreground">Page analysis:</p>
              {result.pageAnalyses.map((analysis, i) => (
                <p key={i} className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-3">
                  {analysis}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GenerationPage() {
  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 max-w-3xl flex items-center gap-3 py-3">
          <Link href="/system">
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="font-serif font-bold text-lg leading-tight">Generation</h1>
            <p className="text-xs text-muted-foreground">AI art, animation &amp; knowledge training</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-primary">Powered by AI</span>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 max-w-3xl py-6">
        <Tabs defaultValue="draw" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="draw" className="gap-1.5 text-xs sm:text-sm">
              <Wand2 className="h-3.5 w-3.5" />
              Draw
            </TabsTrigger>
            <TabsTrigger value="animate" className="gap-1.5 text-xs sm:text-sm">
              <Video className="h-3.5 w-3.5" />
              Live Draw
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="gap-1.5 text-xs sm:text-sm">
              <Brain className="h-3.5 w-3.5" />
              Knowledge
            </TabsTrigger>
          </TabsList>

          <TabsContent value="draw">
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="rounded-full bg-primary/10 p-5">
                <Wand2 className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold">Coming Soon</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                AI art generation is on the way. Check back soon!
              </p>
            </div>
          </TabsContent>

          <TabsContent value="animate">
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="rounded-full bg-primary/10 p-5">
                <Video className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold">Coming Soon</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Live Draw animation is on the way. Check back soon!
              </p>
            </div>
          </TabsContent>

          <TabsContent value="knowledge">
            <KnowledgeTab />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
