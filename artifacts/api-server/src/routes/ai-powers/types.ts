// ai-powers/types.ts

import type { apiFetch as ApiFetchType } from "@/lib/api-fetch"; // Adjust import path as needed

// ────────────────────────────────────────────────
// STORE TYPES (from your storage)
// ────────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
  order: number;
}

export interface LibraryManga {
  id: string;
  title: string;
  sourceId: string;
  categoryIds: string[];
  lastRead?: number;
  totalChapters?: number;
  readChapters?: number;
  coverUrl?: string;
  addedAt: number;
}

export interface StoreSnapshot {
  categories: Category[];
  library: Record<string, LibraryManga>;
  // ... any other store fields
}

export interface StoreActions {
  addCategory: (name: string) => Category;
  removeCategory: (id: string) => void;
  renameCategory?: (id: string, newName: string) => void;
  setMangaCategories: (mangaId: string, categoryIds: string[]) => void;
  removeFromLibrary?: (mangaId: string) => void;
  // ... any other store actions
}

// ────────────────────────────────────────────────
// SKILL CONTEXT
// ────────────────────────────────────────────────

/**
 * Context passed to every skill function.
 */
export interface SkillContext {
  /** Current store snapshot (library, categories, etc.) */
  store: StoreSnapshot;

  /** Store actions (addCategory, removeCategory, setMangaCategories, etc.) */
  actions: StoreActions;

  /** Fetch function that calls your backend API */
  apiFetch: typeof ApiFetchType;

  /** Optional page data for "eyes" skills (injected by frontend) */
  pageData?: PageData;

  /** Optional user preferences (set via set_user_preference) */
  preferences?: Record<string, any>;
}

// ────────────────────────────────────────────────
// PAGE DATA (for "Eyes" skills)
// ────────────────────────────────────────────────

export interface PageData {
  url: string;
  title: string;
  description?: string;
  tags?: string[];
  imageUrl?: string;
  chapters?: ChapterInfo[];
  mangaId?: string;
  sourceId?: string;
  rawHtml?: string; // optional, for debugging
}

export interface ChapterInfo {
  id: string;
  number: number | string;
  title?: string;
  uploadDate?: string;
  url?: string;
}

// ────────────────────────────────────────────────
// SKILL RESULTS
// ────────────────────────────────────────────────

export interface PermissionRequest {
  /** Human‑readable description of what the action will do */
  description: string;
  /** Function to execute if permission is granted */
  execute: () => string;
}

export interface SkillResult {
  /** The result text to show to the user */
  result: string;
  /** If present, the user must grant permission before the action is performed */
  permissionRequest?: PermissionRequest;
}

// ────────────────────────────────────────────────
// SKILL FUNCTION SIGNATURE
// ────────────────────────────────────────────────

/**
 * A skill function.
 * @param args – Arguments from the AI (parsed JSON)
 * @param context – Execution context (store, actions, apiFetch, pageData, preferences)
 * @returns A SkillResult with a result string and optional permission request
 */
export type SkillFunction = (
  args: Record<string, any>,
  context: SkillContext,
) => Promise<SkillResult>;

// ────────────────────────────────────────────────
// SKILL REGISTRY
// ────────────────────────────────────────────────

export type SkillName = string; // or a union of all skill names if you want strict typing

export type SkillRegistry = Record<string, SkillFunction>;

// ────────────────────────────────────────────────
// AGENT MESSAGE PROTOCOL (Optional – from MangaZine)
// ────────────────────────────────────────────────

export interface AgentMessage {
  messageId: string;
  traceId: string;
  parentMessageId: string | null;
  sourceAgent: string;
  targetAgent: string;
  messageType: "request" | "response" | "feedback" | "revision" | "error";
  payload: Record<string, any>;
  timestamp: string; // ISO string
}

export interface MessageLog {
  traceId: string;
  messages: AgentMessage[];
  record: (msg: AgentMessage) => void;
  createMessage: (
    source: string,
    target: string,
    msgType: AgentMessage["messageType"],
    payload?: Record<string, any>,
    parentId?: string | null,
  ) => AgentMessage;
  filterByAgent: (agentName: string) => AgentMessage[];
  toDicts: () => Record<string, any>[];
}

// ────────────────────────────────────────────────
// CHECKPOINT (Optional – for long‑running tasks)
// ────────────────────────────────────────────────

export interface CheckpointManager {
  checkpointsDir: string;
  save: (stepName: string, data: Record<string, any> | any[]) => string;
  load: (stepName: string) => Record<string, any> | any[] | null;
  hasCheckpoint: (stepName: string) => boolean;
  listCheckpoints: () => string[];
}

// ────────────────────────────────────────────────
// CONFIGURATION
// ────────────────────────────────────────────────

export interface AIPowersConfig {
  /** Max tool rounds before stopping */
  maxToolRounds?: number;
  /** Default model mode */
  defaultModelMode?: "auto" | "gemini" | "groq" | "openrouter" | "uncensored";
  /** Whether to enable tracing (OpenTelemetry) */
  enableTracing?: boolean;
  /** Checkpoints directory (for long‑running tasks) */
  checkpointsDir?: string;
}
