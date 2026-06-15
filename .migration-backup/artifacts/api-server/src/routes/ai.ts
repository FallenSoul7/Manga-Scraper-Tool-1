export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatAIResponse {
  intent: "CHAT" | "FULL_DB_SCAN";
  response: string;
  command?: string;
}

export interface SortProgressPayload {
  status: "processing" | "done";
  currentCursor: number;
  totalManga: number;
  categories: Record<string, number[]>;
  resultFileName?: string;
}

// Utility: Safely read client-side file headers into a Base64 string for processing
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(",")[1];
      if (base64Data) resolve(base64Data);
      else reject(new Error("Failed to extract Base64 content from file."));
    };
    reader.onerror = (error) => reject(error);
  });
};

/**
 * Dispatches the chat payload array to the server route.
 */
export async function sendAIChat(messages: ChatMessage[], hasFile: boolean): Promise<ChatAIResponse> {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, hasFile }),
  });

  if (!response.ok) {
    throw new Error(`Chat connection dropped with status ${response.status}`);
  }

  return response.json();
}

/**
 * Initializes and loops batch sorting routines sequentially using the waterfall engine.
 */
export async function startMangaLibrarySorting(
  file: File,
  command: string,
  onProgress: (progress: SortProgressPayload) => void
): Promise<{ resultFileName: string; totalCategories: number }> {
  
  const fileData = await fileToBase64(file);

  const initRes = await fetch("/api/ai/sort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "init",
      fileName: file.name,
      fileData,
    }),
  });

  if (!initRes.ok) {
    const errData = await initRes.json();
    throw new Error(errData.error || "Initialization routine failed.");
  }

  const { sessionKey, totalManga } = await initRes.json();

  let cursor = 0;
  let existingCategories: Record<string, number[]> = {};
  let isDone = false;
  let finalResultFileName = "";
  let finalCategoriesCount = 0;

  while (!isDone) {
    const batchRes = await fetch("/api/ai/sort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "batch",
        sessionKey,
        command,
        cursor,
        existingCategories,
      }),
    });

    if (!batchRes.ok) {
      const errData = await batchRes.json();
      throw new Error(errData.error || `Batch segmentation halted at item ${cursor}`);
    }

    const batchData = await batchRes.json();

    if (batchData.status === "processing") {
      cursor = batchData.nextCursor;
      existingCategories = batchData.categories;

      onProgress({
        status: "processing",
        currentCursor: cursor,
        totalManga,
        categories: existingCategories,
      });
    } else if (batchData.status === "done") {
      isDone = true;
      finalResultFileName = batchData.resultFileName;
      finalCategoriesCount = batchData.totalCategories;

      onProgress({
        status: "done",
        currentCursor: totalManga,
        totalManga,
        categories: batchData.categories,
        resultFileName: finalResultFileName,
      });
    }
  }

  return {
    resultFileName: finalResultFileName,
    totalCategories: finalCategoriesCount,
  };
}

/**
 * Forces browser anchor initialization to pull the finished categorized JSON mapping.
 */
export function downloadSortedBackupFile(resultFileName: string): void {
  const downloadUrl = `/api/ai/download?file=${encodeURIComponent(resultFileName)}`;
  
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.setAttribute("download", resultFileName);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
