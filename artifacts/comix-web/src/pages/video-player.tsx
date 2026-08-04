/**
 * Cinematic video player for Koofr video files.
 * Completely separate from the manga reader — designed for mobile TV-style viewing.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronLeft, Play, Pause, Maximize, Minimize, Volume2, VolumeX, RotateCcw } from "lucide-react";
import { apiUrl } from "@/lib/api-url";

interface VideoPlayerProps {
  url: string;
  title: string;
  subtitle?: string;
  onBack: () => void;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function VideoPlayer({ url, title, subtitle, onBack }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>();

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [seeking, setSeeking] = useState(false);

  // Auto-hide controls after 3s when playing
  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimeout.current);
    if (playing && !seeking) {
      hideTimeout.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [playing, seeking]);

  const showControlsNow = useCallback(() => {
    setShowControls(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    scheduleHide();
    return () => clearTimeout(hideTimeout.current);
  }, [scheduleHide]);

  // Fullscreen change listener
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "k") { e.preventDefault(); togglePlay(); showControlsNow(); }
      if (e.key === "ArrowLeft") { seekBy(-10); showControlsNow(); }
      if (e.key === "ArrowRight") { seekBy(10); showControlsNow(); }
      if (e.key === "m") { toggleMute(); showControlsNow(); }
      if (e.key === "f") { toggleFullscreen(); }
      if (e.key === "Escape" && !document.fullscreenElement) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const seekBy = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
  };

  const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const t = parseFloat(e.target.value);
    v.currentTime = t;
    setCurrentTime(t);
  };

  // Double-tap to seek ±10s
  const lastTap = useRef<{ x: number; time: number } | null>(null);
  const handleTap = (e: React.MouseEvent) => {
    const now = Date.now();
    const x = e.clientX;
    const w = window.innerWidth;
    if (lastTap.current && now - lastTap.current.time < 300 && Math.abs(x - lastTap.current.x) < 80) {
      // Double tap
      const side = x < w / 2 ? -10 : 10;
      seekBy(side);
      lastTap.current = null;
      return;
    }
    lastTap.current = { x, time: now };
    showControlsNow();
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black flex flex-col select-none"
      style={{ touchAction: "none" }}
    >
      {/* ── Video element ─────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        src={apiUrl(url)}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        onClick={handleTap as any}
        onPlay={() => { setPlaying(true); setLoading(false); scheduleHide(); }}
        onPause={() => { setPlaying(false); clearTimeout(hideTimeout.current); setShowControls(true); }}
        onTimeUpdate={() => {
          const v = videoRef.current;
          if (!v || seeking) return;
          setCurrentTime(v.currentTime);
          if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
        }}
        onDurationChange={() => { if (videoRef.current) setDuration(videoRef.current.duration); }}
        onWaiting={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
        onError={() => { setError(true); setLoading(false); }}
        onEnded={() => { setPlaying(false); setShowControls(true); }}
        muted={muted}
      />

      {/* ── Loading / buffering spinner ────────────────────────────────── */}
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
          <div className="relative">
            <div className="h-14 w-14 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          </div>
          <p className="mt-4 text-white/70 text-sm font-medium px-6 text-center line-clamp-1">{title}</p>
        </div>
      )}

      {/* ── Error state ───────────────────────────────────────────────── */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10">
          <div className="text-4xl">⚠️</div>
          <p className="text-white/80 font-semibold">Couldn't load video</p>
          <button
            className="mt-2 flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/15 text-white text-sm font-medium hover:bg-white/25 transition-colors"
            onClick={() => {
              setError(false);
              setLoading(true);
              if (videoRef.current) { videoRef.current.load(); videoRef.current.play().catch(() => {}); }
            }}
          >
            <RotateCcw className="h-4 w-4" /> Retry
          </button>
          <button className="text-white/50 text-sm hover:text-white/80 transition-colors" onClick={onBack}>
            Go back
          </button>
        </div>
      )}

      {/* ── Big center play/pause button (shown when paused or controls visible) ── */}
      {!loading && !error && showControls && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <button
            className="h-18 w-18 pointer-events-auto flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm border border-white/20 transition-transform active:scale-90"
            style={{ width: 72, height: 72 }}
            onClick={(e) => { e.stopPropagation(); togglePlay(); showControlsNow(); }}
          >
            {playing
              ? <Pause className="h-7 w-7 text-white fill-white" />
              : <Play  className="h-7 w-7 text-white fill-white ml-1" />
            }
          </button>
        </div>
      )}

      {/* ── Double-tap seek indicators ─────────────────────────────────── */}
      {/* handled via tap logic above; visual feedback can be added later */}

      {/* ── Controls overlay ──────────────────────────────────────────── */}
      <div
        className={`absolute inset-0 flex flex-col justify-between z-30 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={(e) => { e.stopPropagation(); showControlsNow(); }}
      >
        {/* Top gradient + title bar */}
        <div className="bg-gradient-to-b from-black/80 via-black/40 to-transparent pt-safe-top">
          <div className="flex items-center gap-3 px-3 py-3 sm:px-5 sm:py-4 h-16">
            <button
              className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm border border-white/15 hover:bg-black/60 transition-colors active:scale-90"
              onClick={(e) => { e.stopPropagation(); onBack(); }}
            >
              <ChevronLeft className="h-5 w-5 text-white" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-white font-semibold text-sm sm:text-base leading-tight truncate">{title}</div>
              {subtitle && <div className="text-white/55 text-xs leading-tight truncate mt-0.5">{subtitle}</div>}
            </div>
            <button
              className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm border border-white/15 hover:bg-black/60 transition-colors"
              onClick={(e) => { e.stopPropagation(); toggleMute(); showControlsNow(); }}
            >
              {muted ? <VolumeX className="h-4 w-4 text-white" /> : <Volume2 className="h-4 w-4 text-white" />}
            </button>
          </div>
        </div>

        {/* Spacer — tap area in the middle */}
        <div className="flex-1" />

        {/* Bottom gradient + seek bar + time + fullscreen */}
        <div className="bg-gradient-to-t from-black/90 via-black/50 to-transparent pb-safe-bottom">
          <div className="px-4 pb-4 pt-6 sm:px-6 sm:pb-5 space-y-2">
            {/* Seek bar */}
            <div className="relative h-5 flex items-center group">
              {/* Buffer track */}
              <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/20 w-full" />
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/35"
                style={{ width: `${bufferPct}%` }}
              />
              {/* Progress track */}
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white pointer-events-none"
                style={{ width: `${progress}%` }}
              />
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.5}
                value={currentTime}
                onMouseDown={() => setSeeking(true)}
                onTouchStart={() => setSeeking(true)}
                onMouseUp={() => { setSeeking(false); scheduleHide(); }}
                onTouchEnd={() => { setSeeking(false); scheduleHide(); }}
                onChange={handleSeekInput}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
                style={{ height: "100%" }}
                onClick={(e) => e.stopPropagation()}
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-md pointer-events-none transition-transform group-hover:scale-125"
                style={{ left: `calc(${progress}% - 7px)` }}
              />
            </div>

            {/* Time + fullscreen row */}
            <div className="flex items-center justify-between">
              <span className="text-white/80 text-xs font-medium tabular-nums">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <button
                className="h-9 w-9 flex items-center justify-center rounded-full bg-black/30 hover:bg-black/50 transition-colors active:scale-90"
                onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
              >
                {isFullscreen
                  ? <Minimize className="h-4 w-4 text-white" />
                  : <Maximize className="h-4 w-4 text-white" />
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
