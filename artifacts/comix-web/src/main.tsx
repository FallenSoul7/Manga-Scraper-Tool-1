import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setExtraHeader } from "@workspace/api-client-react";

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
