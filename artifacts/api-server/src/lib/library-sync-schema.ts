import { z } from "zod";

const MAX_LIBRARY_ITEMS = 20_000;
const MAX_PROGRESS_ITEMS = 50_000;
const MAX_HISTORY_ITEMS = 20_000;
const MAX_INSTALLED_SOURCES = 500;
const MAX_CATEGORIES = 500;

const text = (max: number, min = 0) => z.string().min(min).max(max).refine(
  (value) => !value.includes("\u0000") && !/^\s*(?:data|blob):/i.test(value),
  "Only bounded text metadata is accepted.",
);
const id = text(2_048, 1);
const sourceId = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/i);
const finiteNumber = z.number().finite();
const nonNegativeInt = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** A URL/path string is metadata, but an embedded byte payload is not. */
const mediaReference = z.string().max(4_096).refine((value) => {
  if (!value) return true;
  if (/^\s*(?:data|blob):/i.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Use a normal media URL or local path; embedded media data is not accepted.");

const PendingChapterSchema = z.object({
  id: z.union([nonNegativeInt, id]),
  number: finiteNumber,
  title: text(500),
  date: finiteNumber,
}).strict();

const SavedMangaSchema = z.object({
  id,
  title: text(500),
  thumbnail: mediaReference,
  type: text(80).optional(),
  isNsfw: z.boolean().optional(),
  author: text(500).optional(),
  status: text(120).optional(),
  sourceId: sourceId.optional(),
  mediaType: z.enum(["image", "video", "mixed"]).optional(),
  thumbnailIsStatic: z.boolean().optional(),
  creatorId: id.optional(),
  creatorTitle: text(500).optional(),
  addedAt: finiteNumber,
  updatedAt: finiteNumber.optional(),
  categoryIds: z.array(id).max(500),
  lastChapterCountSeen: nonNegativeInt,
  pendingUpdates: z.array(PendingChapterSchema).max(2_000).default([]),
  updatesEnabled: z.boolean().default(false),
  updatesInitialized: z.boolean().default(false),
  trackedChapterIds: z.array(id).max(20_000).default([]),
}).strict();

const ChapterProgressSchema = z.object({
  mangaId: id,
  chapterId: z.union([nonNegativeInt, id]),
  chapterNumber: finiteNumber,
  chapterTitle: text(500),
  mangaTitle: text(500),
  mangaThumbnail: mediaReference,
  totalPages: nonNegativeInt,
  lastPageRead: nonNegativeInt,
  scrollOffset: nonNegativeInt.optional(),
  isRead: z.boolean(),
  updatedAt: finiteNumber,
}).strict();

const CategorySchema = z.object({
  id: text(128, 1),
  name: text(120, 1),
  order: nonNegativeInt,
}).strict();

// Legacy source objects may arrive from older clients. Validate their complete
// text-only shape, then transform them to IDs so metadata never reaches JSONB.
const LegacyInstalledSourceSchema = z.object({
  id: sourceId,
  name: text(120, 1),
  lang: text(16, 1),
  languages: z.array(text(16)).max(50).default([]),
  adapter: text(80).optional(),
  manifestVersion: z.number().int().positive().optional(),
  isNsfw: z.boolean(),
  iconUrl: mediaReference.nullable(),
  installedAt: finiteNumber,
  isPinned: z.boolean().optional().default(false),
}).strict();

const LegacyInstalledSourceRecordSchema = z.record(sourceId, LegacyInstalledSourceSchema)
  .refine((entries) => Object.entries(entries).every(([key, entry]) => key === entry.id), "Source keys must match source IDs.")
  .refine((entries) => Object.keys(entries).length <= MAX_INSTALLED_SOURCES, "Too many installed sources.");

const InstalledSourceIdsSchema = z.array(sourceId).max(MAX_INSTALLED_SOURCES)
  .refine((ids) => new Set(ids).size === ids.length, "Installed source IDs must be unique.");

const LibraryRecordSchema = z.record(id, SavedMangaSchema)
  .refine((entries) => Object.entries(entries).every(([key, entry]) => key === entry.id), "Library keys must match entry IDs.")
  .refine((entries) => Object.keys(entries).length <= MAX_LIBRARY_ITEMS, "Too many library entries.");
const ProgressRecordSchema = z.record(id, ChapterProgressSchema)
  .refine((entries) => Object.keys(entries).length <= MAX_PROGRESS_ITEMS, "Too many progress entries.");

/** Canonical JSONB shape: bounded text metadata and installed source IDs only. */
export const LibrarySyncDataSchema = z.object({
  library: LibraryRecordSchema,
  categories: z.array(CategorySchema).max(MAX_CATEGORIES),
  installedSourceIds: InstalledSourceIdsSchema,
  progress: ProgressRecordSchema,
  history: z.array(id).max(MAX_HISTORY_ITEMS),
}).strict();

/**
 * POST body accepts the former installedSources object for one-way migration
 * from older clients, but transforms it to IDs before any database write.
 * Unknown fields, executable code, HTML, and embedded media are rejected.
 */
export const LibrarySyncPayloadSchema = z.object({
  library: LibraryRecordSchema.optional(),
  categories: z.array(CategorySchema).max(MAX_CATEGORIES).optional(),
  installedSourceIds: InstalledSourceIdsSchema.optional(),
  installedSources: LegacyInstalledSourceRecordSchema.optional(),
  progress: ProgressRecordSchema.optional(),
  history: z.array(id).max(MAX_HISTORY_ITEMS).optional(),
  strategy: z.enum(["merge", "upload"]).default("merge"),
}).strict().transform(({ installedSources, ...payload }) => ({
  ...payload,
  installedSourceIds: payload.installedSourceIds ?? Object.keys(installedSources ?? {}),
}));

export type LibrarySyncData = z.infer<typeof LibrarySyncDataSchema>;
export type LibrarySyncPayload = z.infer<typeof LibrarySyncPayloadSchema>;
