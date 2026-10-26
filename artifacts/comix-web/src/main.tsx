import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setExtraHeader, setBaseUrl } from "@workspace/api-client-react";
import { checkForNativeUpdate, markNativeBundleReady } from "@/lib/native-live-update";

// Point every customFetch call at the deployed API server.
// Falls back to relative URLs in local dev when VITE_API_URL is not set.
setBaseUrl(import.meta.env.VITE_API_URL ?? "");

// Register the active source header before any data fetching starts so the
// very first request already carries the correct X-Source value.
try {
  const raw = localStorage.getItem("comix-lounge:v1");
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.activeSourceId === "string") {
      setExtraHeader("X-Source", parsed.activeSourceId);
    }
  }
} catch {
  /* noop */
}

createRoot(document.getElementById("root")!).render(<App />);

// OTA checks are optional and never gate startup. Mark the current bundle healthy
// before doing any network work so a previous update can be rolled back safely.
void markNativeBundleReady().then(() => checkForNativeUpdate());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkForNativeUpdate();
});
