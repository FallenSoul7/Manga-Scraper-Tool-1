import assert from "node:assert/strict";
import { test } from "node:test";
import { LibrarySyncPayloadSchema } from "../src/lib/library-sync-schema.ts";

const validPayload = () => ({
  library: {
    "manga-1": {
      id: "manga-1",
      title: "Example manga",
      thumbnail: "https://cdn.example.test/cover.jpg",
      addedAt: 1,
      categoryIds: ["default"],
      lastChapterCountSeen: 0,
      pendingUpdates: [],
      updatesEnabled: false,
      updatesInitialized: false,
      trackedChapterIds: [],
    },
  },
  categories: [{ id: "default", name: "Default", order: 0 }],
  installedSourceIds: ["ext.example"],
  progress: {
    "manga-1:1": {
      mangaId: "manga-1",
      chapterId: 1,
      chapterNumber: 1,
      chapterTitle: "Chapter 1",
      mangaTitle: "Example manga",
      mangaThumbnail: "https://cdn.example.test/cover.jpg",
      totalPages: 10,
      lastPageRead: 2,
      isRead: false,
      updatedAt: 2,
    },
  },
  history: ["manga-1:1"],
  strategy: "merge",
});

test("sync schema accepts bounded text library, reading history, and installed IDs", () => {
  assert.equal(LibrarySyncPayloadSchema.safeParse(validPayload()).success, true);
});

test("legacy installed source objects are validated then reduced to IDs", () => {
  const payload = validPayload();
  delete payload.installedSourceIds;
  payload.installedSources = {
    "ext.example": {
      id: "ext.example",
      name: "Example source",
      lang: "en",
      languages: ["en"],
      isNsfw: false,
      iconUrl: null,
      installedAt: 1,
      isPinned: false,
    },
  };
  const parsed = LibrarySyncPayloadSchema.safeParse(payload);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data.installedSourceIds, ["ext.example"]);
    assert.equal(Object.hasOwn(parsed.data, "installedSources"), false);
  }
});

test("sync schema rejects arbitrary executable or unknown fields", () => {
  const payload = validPayload();
  payload.extensionCode = "alert(1)";
  assert.equal(LibrarySyncPayloadSchema.safeParse(payload).success, false);

  const nested = validPayload();
  nested.installedSources = { "ext.example": { id: "ext.example", script: "fetch('https://evil.test')" } };
  assert.equal(LibrarySyncPayloadSchema.safeParse(nested).success, false);
});

test("sync schema rejects embedded image and blob media payloads", () => {
  for (const thumbnail of ["data:image/png;base64,AAAA", "blob:https://comihub.top/id"]) {
    const payload = validPayload();
    payload.library["manga-1"].thumbnail = thumbnail;
    assert.equal(LibrarySyncPayloadSchema.safeParse(payload).success, false);
  }
});

test("sync schema rejects duplicate or invalid source IDs", () => {
  const duplicates = validPayload();
  duplicates.installedSourceIds = ["ext.example", "ext.example"];
  assert.equal(LibrarySyncPayloadSchema.safeParse(duplicates).success, false);

  const invalid = validPayload();
  invalid.installedSourceIds = ["bad/source"];
  assert.equal(LibrarySyncPayloadSchema.safeParse(invalid).success, false);
});
