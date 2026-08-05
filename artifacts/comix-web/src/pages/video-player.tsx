/**
 * Cinematic video player for Koofr video files.
 * All interactive controls live inside one overlay div — no z-index fights.
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

function formatTime(s: number): string {
  if (!isFinite(s) || isNaN(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function VideoPlayer({ url, title, subtitle, onBack }: VideoPlayerProps) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  const [playing,      setPlaying]      = useState(false);
  const [currentTime,  setCurrentTime]  = useState(0);
  const [duration,     setDuration]     = useState(0);
  const [buffered,     setBuffered]     = useState(0);
  const [muted,        setMuted]        = useState(false);
  const [visible,      setVisible]      = useState(true);   // controls visible
  const [loading,      setLoading]      = useState(true);
  const [hasError,     setHasError]     = useState(false);
  const [fullscreen,   setFullscreen]   = useState(false);
  const [seeking,      setSeeking]      = useState(false);

  // ── auto-hide controls ───────────────────────────────────────────────
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const resetHideTimer = useCallback(() => {
    clearTimeout(hideTimer.current);
    setVisible(true);
    hideTimer.current = setTimeout(() => {
      if (playingRef.current) setVisible(false);
    }, 3500);
  }, []);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // show controls when paused
  useEffect(() => {
    if (!playing) {
      clearTimeout(hideTimer.current);
      setVisible(true);
    } else {
      resetHideTimer();
    }
  }, [playing, resetHideTimer]);

  // ── fullscreen listener ──────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── helpers ──────────────────────────────────────────────────────────
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else          v.pause();
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function seekTo(t: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
    setCurrentTime(v.currentTime);
  }

  async function toggleFullscreen() {
    if (!wrapRef.current) return;
    if (!document.fullscreenElement) {
      await wrapRef.current.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
  }

  // ── keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "k") { e.preventDefault(); togglePlay(); resetHideTimer(); }
      else if (e.key === "ArrowLeft")  { seekTo((videoRef.current?.currentTime ?? 0) - 10); resetHideTimer(); }
      else if (e.key === "ArrowRight") { seekTo((videoRef.current?.currentTime ?? 0) + 10); resetHideTimer(); }
      else if (e.key === "m") toggleMute();
      else if (e.key === "f") toggleFullscreen();
      else if (e.key === "Escape" && !document.fullscreenElement) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── derived ──────────────────────────────────────────────────────────
  const progress   = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferPct  = duration > 0 ? (buffered   / duration) * 100 : 0;

  // ── render ───────────────────────────────────────────────────────────
  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-50 bg-black select-none overflow-hidden"
    >
      {/* ── 1. VIDEO ──────────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        src={apiUrl(url)}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        // Don't put onClick here — click layer below handles taps
        onPlay={()        => { setPlaying(true);  setLoading(false); }}
        onPause={()       => { setPlaying(false); }}
        onWaiting={()     => setLoading(true)}
        onCanPlay={()     => setLoading(false)}
        onPlaying={()     => setLoading(false)}
        onDurationChange={() => { if (videoRef.current) setDuration(videoRef.current.duration); }}
        onTimeUpdate={()  => {
          const v = videoRef.current;
          if (!v || seeking) return;
          setCurrentTime(v.currentTime);
          if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
        }}
        onEnded={()  => { setPlaying(false); }}
        onError={()  => { setHasError(true); setLoading(false); }}
        muted={muted}
      />

      {/* ── 2. CLICK LAYER (tap to toggle controls) ───────────────────── */}
      {/* Only active when controls are hidden so buttons still work */}
      {!visible && (
        <div
          className="absolute inset-0 z-10 cursor-pointer"
          onClick={resetHideTimer}
        />
      )}

      {/* ── 3. LOADING SPINNER ────────────────────────────────────────── */}
      {loading && !hasError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none">
          <div className="h-12 w-12 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          {title && (
            <p className="mt-4 text-white/60 text-sm px-8 text-center line-clamp-2">{title}</p>
          )}
        </div>
      )}

      {/* ── 4. ERROR STATE ─────────────────────────────────────────────── */}
      {hasError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <span className="text-4xl">⚠️</span>
          <p className="text-white/80 font-semibold">Couldn't load video</p>
          <p className="text-white/40 text-xs">{title}</p>
          <button
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/15 text-white text-sm font-medium hover:bg-white/25 transition-colors"
            onClick={() => {
              setHasError(false); setLoading(true);
              const v = videoRef.current;
              if (v) { v.load(); v.play().catch(() => {}); }
            }}
          >
            <RotateCcw className="h-4 w-4" /> Retry
          </button>
          <button className="text-white/50 text-sm hover:text-white/80 transition-colors" onClick={onBack}>
            Go back
          </button>
        </div>
      )}

      {/* ── 5. CONTROLS OVERLAY ───────────────────────────────────────── */}
      {/* ALL interactive elements live here — no z-index conflict */}
      <div
        className={`absolute inset-0 z-30 flex flex-col justify-between transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Top bar */}
        <div className="flex-shrink-0 bg-gradient-to-b from-black/80 via-black/30 to-transparent">
          <div className="flex items-center gap-3 px-3 h-16 sm:px-5">
            <button
              className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-black/50 backdrop-blur border border-white/15 text-white hover:bg-black/70 active:scale-90 transition-all"
              onClick={onBack}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-white font-semibold text-sm leading-tight truncate">{title}</div>
              {subtitle && <div className="text-white/55 text-xs leading-tight truncate mt-0.5">{subtitle}</div>}
            </div>
            <button
              className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-black/50 backdrop-blur border border-white/15 text-white hover:bg-black/70 active:scale-90 transition-all"
              onClick={toggleMute}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Center: play/pause — tapping here also resets the hide timer */}
        <div className="flex-1 flex items-center justify-center" onClick={resetHideTimer}>
          <button
            className="h-[72px] w-[72px] flex items-center justify-center rounded-full bg-black/50 backdrop-blur border border-white/20 text-white hover:bg-black/70 active:scale-90 transition-all"
            onClick={(e) => { e.stopPropagation(); togglePlay(); resetHideTimer(); }}
          >
            {playing
              ? <Pause className="h-7 w-7 fill-white" />
              : <Play  className="h-7 w-7 fill-white ml-1" />
            }
          </button>
        </div>

        {/* Bottom bar */}
        <div className="flex-shrink-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent">
          <div className="px-4 pb-5 pt-6 sm:px-6 space-y-2">

            {/* Seek bar */}
            <div className="relative h-6 flex items-center">
              {/* Track background */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/20" />
              {/* Buffer */}
              <div
                className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/35 left-0"
                style={{ width: `${bufferPct}%` }}
              />
              {/* Progress */}
              <div
                className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-white left-0 pointer-events-none"
                style={{ width: `${progress}%` }}
              />
              {/* Invisible range input on top */}
              <input
                type="range"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                min={0}
                max={duration > 0 ? duration : 100}
                step={0.25}
                value={currentTime}
                onPointerDown={() => setSeeking(true)}
                onPointerUp={() => { setSeeking(false); resetHideTimer(); }}
                onChange={(e) => seekTo(parseFloat(e.target.value))}
                onClick={(e) => e.stopPropagation()}
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-md pointer-events-none"
                style={{ left: `calc(${progress}% - 7px)` }}
              />
            </div>

            {/* Time + fullscreen */}
            <div className="flex items-center justify-between">
              <span className="text-white/70 text-xs font-medium tabular-nums">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <button
                className="h-9 w-9 flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 active:scale-90 transition-all"
                onClick={toggleFullscreen}
              >
                {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
