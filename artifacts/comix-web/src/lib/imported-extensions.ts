import { useSyncExternalStore } from 'react';
import { z } from 'zod';

/**
 * Local-only extension metadata manager.
 *
 * Imported extension manifests are declarative metadata only. They are stored in
 * localStorage on this device and are never executed or sent to a server.
 */

const STORAGE_KEY = 'comix:imported-extensions:v1';

export const MAX_IMPORT_BYTES = 256 * 1024;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const BLOCKED_SCHEME_RE =
  /^\s*(?:javascript|data|file|blob|vbscript|about|chrome|chrome-extension|filesystem|jar|capacitor|mailto)\s*:/i;

const EXECUTABLE_KEYS = new Set([
  'script', 'scripts', 'javascript', 'jsfile', 'eval', 'function', 'fn',
  'code', 'sourcecode', 'exec', 'execute', 'inject', 'payload', 'callback',
  'handler', 'handlers', 'onload', 'onclick', 'onerror', 'onmouseover',
  'onfocus', 'require', 'module', 'imports', 'import', 'constructor',
  'prototype', '__proto__', 'proxy', 'worker', 'webview', 'iframe',
]);

const EXECUTABLE_VALUES: Array<[RegExp, string]> = [
  [/javascript\s*:/i, 'a javascript: URI'],
  [/\beval\s*\(/i, 'an eval() call'],
  [/\bnew\s+function\b/i, 'a Function constructor call'],
  [/\bfunction\s*\(/i, 'a function expression'],
  [/=>/, 'an arrow function'],
  [/\bimport\s*\(/i, 'a dynamic import()'],
  [/\bimportScripts\s*\(/i, 'a dynamic importScripts()'],
  [/\brequire\s*\(/i, 'a require() call'],
  [/\bdocument\s*[.[]/i, 'direct DOM access'],
  [/\bwindow\s*[.[]/i, 'direct window access'],
  [/\bglobalThis\b/i, 'globalThis access'],
  [/\bxmlhttprequest\b/i, 'an XMLHttpRequest reference'],
  [/\bfetch\s*\(/i, 'a fetch() call'],
  [/<script/i, 'an inline <script> tag'],
  [/\/\*|\*\/|<!--|-->/i, 'comment/HTML markers'],
];

const OperationSchema = z.object({
  id: z.string().regex(ID_RE),
  type: z.enum(['search', 'popular', 'latest', 'details', 'chapters', 'pages', 'filters']),
  name: z.string().min(1).max(80).optional(),
  url: z.string().min(1).max(2048).optional(),
});

export type ImportedOperation = z.infer<typeof OperationSchema>;

const ManifestSchema = z.object({
  id: z.string().regex(ID_RE),
  name: z.string().min(1).max(80),
  version: z.string().regex(VERSION_RE),
  mediaType: z.enum(['image', 'video', 'mixed']),
  operations: z.array(OperationSchema).min(1).max(64),
  lang: z.string().regex(/^[A-Za-z]{2,3}$/).optional(),
  baseUrl: z.string().min(1).max(2048).optional(),
  iconUrl: z.string().min(1).max(2048).optional(),
  isNsfw: z.boolean().optional(),
  description: z.string().max(280).optional(),
});

export type ImportedExtension = z.infer<typeof ManifestSchema> & {
  importedAt: number;
};

export type ImportResult =
  | { ok: true; extension: ImportedExtension; replaced: boolean }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scanForExecutableContent(value: unknown, path: string, depth = 0): string | null {
  if (depth > 8) return `${path} is nested too deeply`;
  if (typeof value === 'string') {
    for (const [pattern, label] of EXECUTABLE_VALUES) {
      if (pattern.test(value)) return `${path} contains ${label}`;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = scanForExecutableContent(value[i], `${path}[${i}]`, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (EXECUTABLE_KEYS.has(key.toLowerCase())) {
        return `${path}.${key} is an executable field and is not allowed`;
      }
      const found = scanForExecutableContent(child, `${path}.${key}`, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function checkUrl(value: string, path: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return `${path} is empty`;
  if (BLOCKED_SCHEME_RE.test(trimmed)) {
    return `${path} uses an unsafe URL protocol (only http:// and https:// are allowed)`;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed, 'https://local.invalid/');
  } catch {
    return `${path} is not a valid URL`;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return `${path} uses an unsafe URL protocol (only http:// and https:// are allowed)`;
  }
  return null;
}

function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length;
  }
}

function pathToLabel(path: Array<string | number>): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === 'number') return `${acc}[${part}]`;
    return acc ? `${acc}.${part}` : part;
  }, '');
}

function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Invalid extension manifest';
  const path = first.path.length ? `${pathToLabel(first.path)}: ` : '';
  return `${path}${first.message}`;
}

function readStored(): ImportedExtension[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const kept: ImportedExtension[] = [];
    for (const entry of parsed) {
      if (!isPlainObject(entry)) continue;
      const { importedAt, ...rest } = entry;
      const result = ManifestSchema.safeParse(rest);
      if (!result.success) continue;
      kept.push({
        ...result.data,
        importedAt: typeof importedAt === 'number' ? importedAt : Date.now(),
      });
    }
    return kept;
  } catch {
    return [];
  }
}

let snapshot: ImportedExtension[] = readStored();
const listeners = new Set<() => void>();

function persist(next: ImportedExtension[]) {
  snapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage may be full or unavailable.
  }
  listeners.forEach((listener) => listener());
}

export function getImportedExtensions(): ImportedExtension[] {
  return snapshot;
}

export function useImportedExtensions(): ImportedExtension[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => snapshot,
  );
}

export function validateImportText(text: string): ImportResult {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: 'Paste extension JSON or choose a .json file first.' };
  }
  if (byteLength(text) > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      error: `Import is larger than ${Math.round(MAX_IMPORT_BYTES / 1024)} KB. Trim the file and try again.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unparseable JSON';
    return { ok: false, error: `Malformed JSON: ${detail}` };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'Malformed JSON: the manifest must be a single JSON object.' };
  }

  const executable = scanForExecutableContent(parsed, '$');
  if (executable) {
    return { ok: false, error: `Refused: ${executable}.` };
  }

  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: formatZodError(result.error) };
  }

  const manifest = result.data;
  for (const field of ['baseUrl', 'iconUrl'] as const) {
    const value = manifest[field];
    if (value !== undefined) {
      const problem = checkUrl(value, field);
      if (problem) return { ok: false, error: problem };
    }
  }
  for (const operation of manifest.operations) {
    if (operation.url !== undefined) {
      const problem = checkUrl(operation.url, `operations.${operation.id}.url`);
      if (problem) return { ok: false, error: problem };
    }
  }

  const extension: ImportedExtension = { ...manifest, importedAt: Date.now() };
  const replaced = snapshot.some((existing) => existing.id === manifest.id);
  const next = replaced
    ? snapshot.map((existing) => (existing.id === manifest.id ? extension : existing))
    : [...snapshot, extension];
  persist(next);

  return { ok: true, extension, replaced };
}

export function importExtensionFromText(text: string): ImportResult {
  return validateImportText(text);
}

export function removeImportedExtension(id: string): void {
  if (!snapshot.some((entry) => entry.id === id)) return;
  persist(snapshot.filter((entry) => entry.id !== id));
}

export function resetImportedExtensions(): void {
  persist([]);
}
