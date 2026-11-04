import { useSyncExternalStore } from "react";
import { z } from "zod";
import { customFetch } from "@workspace/api-client-react";
import { cacheExtensionManifest } from "./extension-manifest-db";

export const APPROVED_EXTENSION_REPOSITORY_URL = "https://github.com/FallenSoul7/Frwilxe-Hub";
const OFFICIAL_REGISTRY_ENDPOINT = "/api/sources/registry";
const REGISTRY_STORAGE_KEY = "comihub:extension-registry:v1";
const BREADCRUMB_STORAGE_KEY = "comihub:extension-breadcrumb:v1";
const MAX_REGISTRY_JSON_CHARS = 1024 * 1024;
const REMOVED_SOURCE_IDS = new Set([
  "en.utoon", "local.koofr", "en.comix", "en.comickfan",
  "all.atsu", "en.ravenscans", "en.resetscans",
]);

export type ExtensionBreadcrumbStep = "system" | "extensions" | "browse" | null;

export interface ExtensionBreadcrumbState {
  missingExtensionCount: number;
  step: ExtensionBreadcrumbStep;
}

function readBreadcrumbState(): ExtensionBreadcrumbState {
  if (typeof localStorage === "undefined") return { missingExtensionCount: 0, step: null };
  try {
    const value = JSON.parse(localStorage.getItem(BREADCRUMB_STORAGE_KEY) ?? "null") as Partial<ExtensionBreadcrumbState> | null;
    const step = value?.step === "system" || value?.step === "extensions" || value?.step === "browse" ? value.step : null;
    const count = Number(value?.missingExtensionCount);
    return { missingExtensionCount: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0, step };
  } catch {
    return { missingExtensionCount: 0, step: null };
  }
}

let breadcrumbSnapshot = readBreadcrumbState();
const breadcrumbListeners = new Set<() => void>();

function publishBreadcrumbState(next: ExtensionBreadcrumbState): void {
  if (next.missingExtensionCount === breadcrumbSnapshot.missingExtensionCount && next.step === breadcrumbSnapshot.step) return;
  breadcrumbSnapshot = next;
  try { localStorage.setItem(BREADCRUMB_STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep the reactive in-memory state. */ }
  for (const listener of breadcrumbListeners) listener();
}

export function useExtensionBreadcrumbState(): ExtensionBreadcrumbState {
  return useSyncExternalStore(
    listener => {
      breadcrumbListeners.add(listener);
      return () => breadcrumbListeners.delete(listener);
    },
    () => breadcrumbSnapshot,
    () => breadcrumbSnapshot,
  );
}

export function advanceExtensionBreadcrumb(from: Exclude<ExtensionBreadcrumbStep, null>, to: Exclude<ExtensionBreadcrumbStep, "system" | null>): void {
  if (breadcrumbSnapshot.missingExtensionCount > 0 && breadcrumbSnapshot.step === from) {
    publishBreadcrumbState({ ...breadcrumbSnapshot, step: to });
  }
}

function setMissingExtensionCount(count: number): void {
  const missingExtensionCount = Math.max(0, Math.floor(count));
  publishBreadcrumbState({
    missingExtensionCount,
    step: missingExtensionCount === 0 ? null : breadcrumbSnapshot.step ?? "system",
  });
}

const SafeIconUrlSchema = z.string().max(2048).nullable().refine(value => {
  if (value === null) return true;
  if (value.startsWith("/public/source-icons/")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "Icon URLs must be HTTPS or an official ComiHub source icon path.");

const RegistryEntrySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
  name: z.string().trim().min(1).max(100),
  lang: z.string().trim().min(2).max(12),
  isNsfw: z.boolean(),
  versionCode: z.number().finite().optional(),
  iconUrl: SafeIconUrlSchema,
  compatibility: z.enum(["ready", "experimental"]),
  runtime: z.enum(["device-first", "backend"]).default("backend"),
  kind: z.literal("server"),
}).strict();

const ExtensionRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  repository: z.object({
    id: z.literal("frwilxe-hub"),
    name: z.literal("Frwilxe Hub"),
    url: z.literal(APPROVED_EXTENSION_REPOSITORY_URL),
  }).strict(),
  generatedAt: z.string().max(64).refine(value => Number.isFinite(Date.parse(value))),
  extensions: z.array(RegistryEntrySchema).max(2000),
}).strict().superRefine((registry, context) => {
  const ids = new Set<string>();
  for (const [index, extension] of registry.extensions.entries()) {
    if (extension.id === "builtin.universal") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["extensions", index, "id"], message: "The Universal source is not installable from this repository index." });
    }
    if (ids.has(extension.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["extensions", index, "id"], message: "The repository index contains a duplicate source ID." });
    }
    ids.add(extension.id);
  }
});

export type OfficialExtensionEntry = z.infer<typeof RegistryEntrySchema>;
export type OfficialExtensionRegistry = z.infer<typeof ExtensionRegistrySchema>;
export type LoadOfficialSourceRegistryResult =
  | { ok: true; registry: OfficialExtensionRegistry }
  | { ok: false; error: string };

function validateRegistry(value: unknown): LoadOfficialSourceRegistryResult {
  let size: number;
  try {
    size = JSON.stringify(value).length;
  } catch {
    return { ok: false, error: "The source list could not be read." };
  }
  if (size > MAX_REGISTRY_JSON_CHARS) {
    return { ok: false, error: "The source list is larger than allowed." };
  }
  const parsed = ExtensionRegistrySchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: "The official source list failed validation." };
  }
  return {
    ok: true,
    registry: {
      ...parsed.data,
      extensions: parsed.data.extensions.filter(extension => !REMOVED_SOURCE_IDS.has(extension.id)),
    },
  };
}

function readCachedRegistry(): OfficialExtensionRegistry | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(REGISTRY_STORAGE_KEY);
    if (!raw || raw.length > MAX_REGISTRY_JSON_CHARS) return null;
    const result = validateRegistry(JSON.parse(raw));
    return result.ok ? result.registry : null;
  } catch {
    return null;
  }
}

let snapshot = readCachedRegistry();
const listeners = new Set<() => void>();

function publish(registry: OfficialExtensionRegistry): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(registry));
  } catch {
    return false;
  }
  snapshot = registry;
  for (const listener of listeners) listener();
  return true;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (event.key === REGISTRY_STORAGE_KEY) {
      snapshot = readCachedRegistry();
      for (const listener of listeners) listener();
      void checkForMissingExtensionCount();
    } else if (event.key === BREADCRUMB_STORAGE_KEY) {
      breadcrumbSnapshot = readBreadcrumbState();
      for (const listener of breadcrumbListeners) listener();
    }
  });
}

export function useOfficialExtensionRegistry(): OfficialExtensionRegistry | null {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function getOfficialExtensionRegistry(): OfficialExtensionRegistry | null {
  return snapshot;
}

async function fetchRemoteRegistry(): Promise<LoadOfficialSourceRegistryResult> {
  const value = await customFetch<unknown>(OFFICIAL_REGISTRY_ENDPOINT, {
    responseType: "json",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
  });
  return validateRegistry(value);
}

export async function checkForMissingExtensionCount(): Promise<void> {
  try {
    const result = await fetchRemoteRegistry();
    if (!result.ok) return;
    const availableRemoteSources = result.registry.extensions;
    // Local count means official source metadata already synced to this device,
    // not the user's enabled/installed source selections.
    const installedLocalSources = readCachedRegistry()?.extensions ?? [];
    const missingCount = Math.max(0, availableRemoteSources.length - installedLocalSources.length);
    setMissingExtensionCount(missingCount);
  } catch {
    // Preserve any cached breadcrumb state when the registry is unavailable.
  }
}

export async function loadOfficialSourceRegistry(): Promise<LoadOfficialSourceRegistryResult> {
  try {
    const result = await fetchRemoteRegistry();
    if (!result.ok) return result;
    if (!publish(result.registry)) {
      return { ok: false, error: "The index loaded but could not be saved on this device." };
    }
    await Promise.all(result.registry.extensions.map(extension =>
      cacheExtensionManifest(extension.id, extension).catch(() => undefined),
    ));
    const availableRemoteSources = result.registry.extensions;
    const installedLocalSources = readCachedRegistry()?.extensions ?? [];
    setMissingExtensionCount(Math.max(0, availableRemoteSources.length - installedLocalSources.length));
    return result;
  } catch {
    return { ok: false, error: "Could not load official sources. Try again when the content service is online." };
  }
}
