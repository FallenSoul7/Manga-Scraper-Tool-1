import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
import { setExtraHeader } from "@workspace/api-client-react";
import { registerQueryClient } from "@/lib/source";

const queryClient = new QueryClient();
registerQueryClient(queryClient);

try {
  const raw = localStorage.getItem("comix-lounge:v1");
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.activeSourceId === "string") {
      setExtraHeader("X-Source", parsed.activeSourceId);
    }
  }
} catch {
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
