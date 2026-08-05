// ─────────────────────────────────────────────────────────────────────────────
// ComiHub Video Player
// Reusable template for all in-app video content (Koofr library, anime, etc.)
//
// Layer stack (z-index order, bottom → top):
//   0  <video> element
//   10 Gesture layer  — fullscreen transparent div, receives ALL taps
//   20 Feedback layer — loading spinner, seek ripples, error UI (pointer-events-none)
//   30 Controls layer — gradient bars + interactive buttons
//                       containers: pointer-events-none
//                       buttons/inputs: pointer-events-auto
//
// Gesture map:
//   Single tap             → toggle controls on/off immediately
//   Double-tap left  half  → seek −10 s  (animated ripple)
//   Double-tap right half  → seek +10 s  (animated ripple)
//   Keyboard Space / k     → play / pause
//   Keyboard ← / →         → seek ±10 s
//   Keyboard m             → mute toggle
//   Keyboard f             → fullscreen toggle
//   Keyboard Escape        → back (when not fullscreen)
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ChevronLeft,
  Play,
  Pause,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  RotateCcw,
  ChevronLeft as ArrowLeft,
  ChevronRight as ArrowRight,
} from "lucide-react";
import { apiUrl } from "@/lib/api-url";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VideoPlayerProps {
  /** Direct or relative URL for the video (relative URLs are routed through apiUrl()) */
  url: string;
  /** Primary title shown in the top bar */
  title: string;
  /** Optional subtitle / episode label shown below the title */
  subtitle?: string;
  /** Called when the back button or Escape is pressed */
  onBack: () => void;
}

type SeekRipple = { id: number; side: "left" | "right" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return "0:00";
  const h   = Math.floor(seconds / 3600);
  const m   = Math.floor((seconds % 3600) / 60);
  const sec = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function VideoPlayer({ url, title, subtitle, onBack }: VideoPlayerProps) {

  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef       = useRef<HTMLVideoElement>(null);
  const wrapRef        = useRef<HTMLDivElement>(null);
  const hideTimerRef   = useRef<ReturnType<typeof setTimeout>>();
  const tapTimerRef    = useRef<ReturnType<typeof setTimeout>>();
  const lastTapRef     = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
  const touchDoneRef   = useRef(false);   // prevents click firing after touchend
  const rippleCounter  = useRef(0);

  // ── State ─────────────────────────────────────────────────────────────────
  const [playing,     setPlaying]     = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(0);
  const [buffered,    setBuffered]    = useState(0);
  const [muted,       setMuted]       = useState(false);
  const [controls,    setControls]    = useState(true);   // whether controls overlay is visible
  const [loading,     setLoading]     = useState(true);
  const [hasError,    setHasError]    = useState(false);
  const [fullscreen,  setFullscreen]  = useState(false);
  const [seeking,     setSeeking]     = useState(false);
  const [ripples,     setRipples]     = useState<SeekRipple[]>([]);

  // Keep a ref in sync so setTimeout callbacks can read the latest value
  const playingRef  = useRef(playing);
  const controlsRef = useRef(controls);
  useEffect(() => { playingRef.current  = playing;  }, [playing]);
  useEffect(() => { controlsRef.current = controls; }, [controls]);

  // ── Controls auto-hide ────────────────────────────────────────────────────

  const startHideTimer = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (playingRef.current) setControls(false);
    }, 3500);
  }, []);

  const showControls = useCallback(() => {
    setControls(true);
    startHideTimer();
  }, [startHideTimer]);

  // Pause = controls always visible; resume = start hide countdown
  useEffect(() => {
    if (!playing) {
      clearTimeout(hideTimerRef.current);
      setControls(true);
    } else {
      startHideTimer();
    }
  }, [playing, startHideTimer]);

  // Cleanup timers on unmount
  useEffect(() => () => {
    clearTimeout(hideTimerRef.current);
    clearTimeout(tapTimerRef.current);
  }, []);

  // ── Fullscreen listener ───────────────────────────────────────────────────

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── Video actions ─────────────────────────────────────────────────────────

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else          v.pause();
  }

  function seekTo(t: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
    setCurrentTime(v.currentTime);
  }

  function seekBy(delta: number) {
    seekTo((videoRef.current?.currentTime ?? 0) + delta);
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  async function toggleFullscreen() {
    if (!wrapRef.current) return;
    if (!document.fullscreenElement) {
      await wrapRef.current.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
  }

  function retry() {
    setHasError(false);
    setLoading(true);
    const v = videoRef.current;
    if (!v) return;
    v.load();
    v.play().catch(() => {});
  }

  // ── Seek ripples ──────────────────────────────────────────────────────────

  function addRipple(side: "left" | "right") {
    const id = ++rippleCounter.current;
    setRipples(r => [...r, { id, side }]);
    setTimeout(() => setRipples(r => r.filter(x => x.id !== id)), 700);
  }

  // ── Gesture handling ──────────────────────────────────────────────────────
  // All taps flow through handleGestureTap — double-tap is detected by timing.

  function handleGestureTap(clientX: number) {
    const now  = Date.now();
    const prev = lastTapRef.current;
    const dt   = now - prev.time;

    if (dt > 0 && dt < 300) {
      // ── Double tap ──────────────────────────────────────────────────────
      clearTimeout(tapTimerRef.current);
      lastTapRef.current = { time: 0, x: 0 };

      const rect   = wrapRef.current?.getBoundingClientRect();
      const isLeft = rect ? clientX < rect.left + rect.width / 2 : false;
      seekBy(isLeft ? -10 : 10);
      addRipple(isLeft ? "left" : "right");
      showControls();
    } else {
      // ── Potential single tap — wait to confirm no second tap follows ────
      clearTimeout(tapTimerRef.current);
      lastTapRef.current = { time: now, x: clientX };

      tapTimerRef.current = setTimeout(() => {
        lastTapRef.current = { time: 0, x: 0 };
        // Single tap confirmed: toggle controls
        if (controlsRef.current) {
          clearTimeout(hideTimerRef.current);
          setControls(false);
        } else {
          showControls();
        }
      }, 300);
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      switch (e.key) {
        case " ": case "k":
          e.preventDefault(); togglePlay(); showControls(); break;
        case "ArrowLeft":
          e.preventDefault(); seekBy(-10); showControls(); break;
        case "ArrowRight":
          e.preventDefault(); seekBy(10); showControls(); break;
        case "m":
          toggleMute(); break;
        case "f":
          toggleFullscreen(); break;
        case "Escape":
          if (!document.fullscreenElement) onBack(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered   / duration) * 100 : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-50 bg-black select-none overflow-hidden touch-none"
    >

      {/* ── Layer 0: Video ─────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        src={apiUrl(url)}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        muted={muted}
        onPlay={()             => { setPlaying(true);  setLoading(false); }}
        onPause={()            => setPlaying(false)}
        onWaiting={()          => setLoading(true)}
        onCanPlay={()          => setLoading(false)}
        onPlaying={()          => setLoading(false)}
        onDurationChange={()   => { if (videoRef.current) setDuration(videoRef.current.duration); }}
        onTimeUpdate={()       => {
          const v = videoRef.current;
          if (!v || seeking) return;
          setCurrentTime(v.currentTime);
          if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
        }}
        onEnded={()            => setPlaying(false)}
        onError={()            => { setHasError(true); setLoading(false); }}
      />

      {/* ── Layer 10: Gesture layer ────────────────────────────────────── */}
      {/* Transparent fullscreen div — receives ALL taps before controls */}
      <div
        className="absolute inset-0 z-10"
        onTouchEnd={e => {
          touchDoneRef.current = true;
          const t = e.changedTouches[0];
          if (t) handleGestureTap(t.clientX);
        }}
        onClick={e => {
          if (touchDoneRef.current) { touchDoneRef.current = false; return; }
          handleGestureTap(e.clientX);
        }}
      />

      {/* ── Layer 20: Feedback (loading, ripples, error) ───────────────── */}
      {/* pointer-events-none so gestures pass through to layer 10        */}

      {/* Loading spinner */}
      {loading && !hasError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="h-12 w-12 rounded-full border-2 border-white/20 border-t-white animate-spin" />
        </div>
      )}

      {/* Error state — needs pointer-events so buttons work */}
      {hasError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <span className="text-5xl">⚠️</span>
          <p className="text-white font-semibold text-lg">Couldn't load video</p>
          <p className="text-white/50 text-sm truncate max-w-[280px]">{title}</p>
          <button
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-white/15 text-white font-medium hover:bg-white/25 active:scale-95 transition-all"
            onClick={retry}
          >
            <RotateCcw className="h-4 w-4" /> Retry
          </button>
          <button
            className="text-white/50 text-sm hover:text-white/80 transition-colors"
            onClick={onBack}
          >
            Go back
          </button>
        </div>
      )}

      {/* Seek ripples (double-tap feedback) */}
      {ripples.map(r => (
        <SeekRippleOverlay key={r.id} side={r.side} />
      ))}

      {/* ── Layer 30: Controls overlay ─────────────────────────────────── */}
      {/* Container is pointer-events-none; only buttons/inputs are auto   */}
      <div
        className={`absolute inset-0 z-30 flex flex-col justify-between transition-opacity duration-300 ${
          controls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Top bar */}
        <div className="pointer-events-none bg-gradient-to-b from-black/80 via-black/30 to-transparent">
          <div className="flex items-center gap-3 px-3 h-16 sm:px-5">
            <button
              className="pointer-events-auto shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-black/50 backdrop-blur border border-white/15 text-white hover:bg-black/70 active:scale-90 transition-all"
              onClick={onBack}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-tight truncate">{title}</p>
              {subtitle && (
                <p className="text-white/55 text-xs leading-tight truncate mt-0.5">{subtitle}</p>
              )}
            </div>

            <button
              className="pointer-events-auto shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-black/50 backdrop-blur border border-white/15 text-white hover:bg-black/70 active:scale-90 transition-all"
              onClick={toggleMute}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Center: play / pause */}
        <div className="pointer-events-none flex items-center justify-center">
          <button
            className="pointer-events-auto h-[72px] w-[72px] flex items-center justify-center rounded-full bg-black/50 backdrop-blur border border-white/20 text-white hover:bg-black/70 active:scale-90 transition-all"
            onClick={e => { e.stopPropagation(); togglePlay(); showControls(); }}
          >
            {playing
              ? <Pause className="h-7 w-7 fill-white" />
              : <Play  className="h-7 w-7 fill-white ml-1" />
            }
          </button>
        </div>

        {/* Bottom bar */}
        <div className="pointer-events-none bg-gradient-to-t from-black/85 via-black/40 to-transparent">
          <div className="px-4 pb-safe-5 pb-5 pt-8 sm:px-6 space-y-2">

            {/* Seek bar */}
            <div className="relative h-6 flex items-center">
              {/* Track */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/20" />
              {/* Buffer */}
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/35 transition-[width] duration-500"
                style={{ width: `${bufferedPct}%` }}
              />
              {/* Progress */}
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white"
                style={{ width: `${progressPct}%` }}
              />
              {/* Invisible range input — sits on top and is the actual interactive element */}
              <input
                type="range"
                className="pointer-events-auto absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                min={0}
                max={duration > 0 ? duration : 100}
                step={0.25}
                value={currentTime}
                onPointerDown={e => { setSeeking(true); (e.target as HTMLInputElement).setPointerCapture(e.pointerId); }}
                onPointerUp={() => { setSeeking(false); showControls(); }}
                onChange={e => seekTo(parseFloat(e.target.value))}
                onClick={e => e.stopPropagation()}
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white shadow pointer-events-none"
                style={{ left: `calc(${progressPct}% - 7px)` }}
              />
            </div>

            {/* Time + fullscreen */}
            <div className="flex items-center justify-between">
              <span className="text-white/70 text-xs font-medium tabular-nums">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <button
                className="pointer-events-auto h-9 w-9 flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 active:scale-90 transition-all"
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

// ─── Seek Ripple ──────────────────────────────────────────────────────────────
// YouTube-style animated overlay shown after a double-tap seek.

function SeekRippleOverlay({ side }: { side: "left" | "right" }) {
  const isLeft = side === "left";
  return (
    <div
      className={`absolute inset-y-0 z-20 w-1/2 flex items-center pointer-events-none ${
        isLeft ? "left-0 justify-start pl-8" : "right-0 justify-end pr-8"
      }`}
    >
      {/* Ripple circle */}
      <div className="relative flex items-center justify-center">
        <div className="h-24 w-24 rounded-full bg-white/10 animate-[ripple_0.6s_ease-out_forwards]" />
        <div className="absolute flex flex-col items-center gap-0.5">
          {/* Arrows */}
          <div className="flex items-center">
            {isLeft ? (
              <>
                <ArrowLeft className="h-5 w-5 text-white -mr-1" />
                <ArrowLeft className="h-5 w-5 text-white -mr-1" />
                <ArrowLeft className="h-5 w-5 text-white" />
              </>
            ) : (
              <>
                <ArrowRight className="h-5 w-5 text-white -mr-1" />
                <ArrowRight className="h-5 w-5 text-white -mr-1" />
                <ArrowRight className="h-5 w-5 text-white" />
              </>
            )}
          </div>
          <span className="text-white text-[11px] font-semibold">10s</span>
        </div>
      </div>
    </div>
  );
}
