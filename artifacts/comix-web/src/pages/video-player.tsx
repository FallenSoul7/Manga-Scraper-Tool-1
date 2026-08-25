import { useEffect, useRef, useState } from "react";
import { ChevronLeft, RotateCcw } from "lucide-react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
import { apiUrl } from "@/lib/api-url";

export interface VideoPlayerProps {
  url: string;
  title: string;
  subtitle?: string;
  onBack: () => void;
}

export default function VideoPlayer({ url, title, subtitle, onBack }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const plyrRef = useRef<Plyr | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [controlsVisible, setControlsVisible] = useState(true);
  const resumeKey = `comix-video-progress:${url}`;
  const resumeTimeRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(resumeKey));
      resumeTimeRef.current = Number.isFinite(saved) && saved > 3 ? saved : 0;
    } catch {
      resumeTimeRef.current = 0;
    }
  }, [resumeKey]);

  useEffect(() => {
    if (!videoRef.current) return;

    const player = new Plyr(videoRef.current, {
      controls: [
        "play-large",
        "play",
        "progress",
        "current-time",
        "duration",
        "mute",
        "volume",
        "settings",
        "pip",
        "fullscreen",
      ],
      settings: ["speed", "quality"],
      speed: [0.5, 0.75, 1, 1.25, 1.5, 2],
      ratio: null,
      seekTime: 10,
      tooltips: { seek: true, volume: true },
      keyboard: { focused: true, global: true },
    });
    plyrRef.current = player;

    player.on("ready", () => {
      setLoading(false);
      const resume = resumeTimeRef.current;
      if (resume > 0 && player.duration && resume < player.duration - 5) {
        player.currentTime = resume;
      }
    });

    player.on("loadedmetadata", () => {
      const resume = resumeTimeRef.current;
      if (resume > 0 && player.duration && resume < player.duration - 5) {
        player.currentTime = resume;
      }
    });

    player.on("error", () => {
      const v = videoRef.current;
      const code = v?.error?.code;
      setErrorMessage(
        code === 4
          ? "This video format or stream is not supported here."
          : "The source did not respond with a playable video."
      );
      setHasError(true);
      setLoading(false);
    });

    player.on("ended", () => {
      try { localStorage.setItem(resumeKey, "0"); } catch { /* storage unavailable */ }
    });

    const onTimeUpdate = () => {
      const t = player.currentTime;
      if (Number.isFinite(t) && t > 3) {
        try { localStorage.setItem(resumeKey, String(Math.floor(t))); } catch { /* storage unavailable */ }
      }
    };
    player.on("timeupdate", onTimeUpdate);

    return () => {
      player.destroy();
      plyrRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  function retry() {
    setHasError(false);
    setErrorMessage("");
    setLoading(true);
    const v = videoRef.current;
    if (!v) return;
    v.load();
    v.play().catch(() => {});
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Escape" && !document.fullscreenElement) {
        onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  useEffect(() => {
    const onFullscreen = () => setControlsVisible(true);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  function handleMouseActivity() {
    setControlsVisible(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (plyrRef.current && plyrRef.current.playing) {
        setControlsVisible(false);
      }
    }, 3000);
  }

  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-50 bg-black select-none overflow-hidden"
      onMouseMove={handleMouseActivity}
      onMouseLeave={() => {
        if (plyrRef.current && plyrRef.current.playing) setControlsVisible(false);
      }}
    >
      <video
        ref={videoRef}
        src={apiUrl(url)}
        className="absolute inset-0 w-full h-full object-contain plyr-video"
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
      />

      {/* Top bar — back button + title (separate from Plyr controls) */}
      <div
        className={`absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/80 via-black/30 to-transparent transition-opacity duration-300 ${
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center gap-3 px-3 h-16 sm:px-5">
          <button
            className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-black/50 backdrop-blur border border-white/15 text-white hover:bg-black/70 active:scale-90 transition-all"
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
        </div>
      </div>

      {/* Loading spinner */}
      {loading && !hasError && (
        <div className="absolute inset-0 z-5 flex items-center justify-center pointer-events-none">
          <div className="h-12 w-12 rounded-full border-2 border-white/20 border-t-white animate-spin" />
        </div>
      )}

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <span className="text-5xl">⚠️</span>
          <p className="text-white font-semibold text-lg">Couldn't load video</p>
          <p className="text-white/50 text-sm truncate max-w-[280px]">{title}</p>
          <p className="text-white/45 text-xs max-w-sm">
            {errorMessage || "The source returned an unavailable stream."}
          </p>
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
    </div>
  );
}
