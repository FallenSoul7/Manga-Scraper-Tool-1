import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAdapter, ExtensionManifest } from "./sdk";
import {
  asMangaSource,
  parseExtensionManifest,
  registerExtensionAdapter,
  UnsupportedExtensionCapabilityError,
} from "./sdk";
import { assertMangaSourceContract } from "./source-contract";
import type { MangaSource } from "../sources/types";

const validManifest = (): ExtensionManifest => ({
  api: 1,
  id: "en.fixture",
  name: "Fixture source",
  version: "1.0.0",
  languages: ["en"],
  baseUrl: "https://fixture.example/",
  icon: "/public/source-icons/fixture.svg",
  adult: false,
  mediaTypes: ["manga"],
  adapter: "api",
  capabilities: {
    popular: true,
    latest: true,
    search: true,
    details: true,
    chapters: true,
    pages: true,
    tags: true,
    videos: false,
    pagination: true,
    requestHeaders: false,
    referer: true,
    rangeRequests: false,
  },
  filters: [
    { id: "query", label: "Search", kind: "search", queryKey: "query" },
    {
      id: "status",
      label: "Status",
      kind: "select",
      queryKey: "status",
      options: [{ value: "ongoing", label: "Ongoing" }],
    },
  ],
});

function fixtureAdapter(manifest = validManifest()): ExtensionAdapter {
  const summary = {
    id: "series-1",
    title: "Fixture title",
    thumbnail: "https://fixture.example/cover.jpg",
    type: "Manga",
    isNsfw: false,
  };
  const detail = {
    id: "series-1",
    title: "Fixture title",
    author: "Author",
    artist: "Artist",
    synopsis: "Fixture description",
    altTitles: [],
    status: "Ongoing",
    type: "Manga",
    isNsfw: false,
    rating: 0,
    thumbnail: "https://fixture.example/cover.jpg",
    genres: ["Action"],
    score: "",
    scorePosition: "none" as const,
  };
  const chapters = {
    items: [{ id: "chapter-1", number: 1, title: "Chapter 1", scanlator: "Fixture", date: 0 }],
  };
  const pages = { chapterId: "chapter-1", pages: [{ index: 0, url: "https://fixture.example/page.jpg" }] };
  return {
    manifest,
    async popular(context) {
      return { items: [summary], page: context.page ?? 1, hasNextPage: true };
    },
    async latest(context) {
      return { items: [summary], page: context.page ?? 1, hasNextPage: false };
    },
    async search(_query, context) {
      return { items: [summary], page: context.page ?? 1, hasNextPage: false };
    },
    async details() { return detail; },
    async chapters() { return chapters; },
    async pages() { return pages; },
    async tags() { return [{ id: "action", name: "Action" }]; },
  };
}

test("manifest parser normalizes valid metadata and preserves filters", () => {
  const input = validManifest();
  input.languages = [" EN ", "en"];
  const parsed = parseExtensionManifest(input);
  assert.deepEqual(parsed.languages, ["en"]);
  assert.equal(parsed.baseUrl, "https://fixture.example");
  assert.equal(parsed.filters.length, 2);
  assert.equal(parsed.capabilities.rangeRequests, false);
});

test("manifest parser rejects unsafe URLs and malformed declarations", () => {
  const insecure = validManifest();
  insecure.baseUrl = "http://fixture.example";
  assert.throws(() => parseExtensionManifest(insecure), /public HTTPS/);

  const local = validManifest();
  local.baseUrl = "https://127.0.0.1";
  assert.throws(() => parseExtensionManifest(local), /public HTTPS/);

  const unknownAdapter = validManifest();
  unknownAdapter.adapter = "eval" as ExtensionManifest["adapter"];
  assert.throws(() => parseExtensionManifest(unknownAdapter), /adapter .* unsupported/);

  const unknownMedia = validManifest();
  unknownMedia.mediaTypes = ["manga", "comic"] as ExtensionManifest["mediaTypes"];
  assert.throws(() => parseExtensionManifest(unknownMedia), /media type .* unsupported/);

  const badFilter = validManifest();
  badFilter.filters = [{ id: "status", label: "Status", kind: "select", queryKey: "status" }];
  assert.throws(() => parseExtensionManifest(badFilter), /requires options/);
});

test("adapter method declarations must agree with manifest capabilities", () => {
  const adapter = fixtureAdapter();
  delete adapter.pages;
  assert.throws(() => asMangaSource(adapter), /capability 'pages' does not match/);
});

test("SDK bridge preserves filters, capabilities, request context, and source IDs", async () => {
  let seenContext: unknown;
  const adapter = fixtureAdapter();
  const originalPopular = adapter.popular!;
  adapter.popular = async context => {
    seenContext = context;
    return originalPopular(context);
  };

  const source = asMangaSource(adapter);
  const options = {
    page: 3,
    nsfw: false,
    poster: "large" as const,
    media: "manga" as const,
    tagIds: ["action", "-romance"],
    sort: "updated",
  };
  await source.popular(options);
  assert.deepEqual(seenContext, {
    ...options,
    request: { referer: "https://fixture.example/" },
  });
  assert.equal(source.id, "en.fixture");
  assert.equal(source.imageReferer, "https://fixture.example/");
  assert.deepEqual(source.manifestCapabilities?.mediaTypes, ["manga"]);
  assert.equal(source.manifestCapabilities?.rangeRequests, false);
  assert.equal(source.manifestFilters?.[1]?.queryKey, "status");
});

test("registry bridge registers a source once and refuses to replace IDs", () => {
  const registry = new Map<string, MangaSource>();
  const adapter = fixtureAdapter();
  const source = registerExtensionAdapter(registry, adapter);
  assert.equal(registry.get("en.fixture"), source);
  assert.throws(() => registerExtensionAdapter(registry, adapter), /already exists/);
});

test("registry bridge refuses adapters missing required source operations", () => {
  const manifest = validManifest();
  manifest.capabilities.search = false;
  manifest.filters = manifest.filters.filter(filter => filter.kind !== "search");
  const adapter = fixtureAdapter(manifest);
  delete adapter.search;
  assert.throws(
    () => registerExtensionAdapter(new Map<string, MangaSource>(), adapter),
    /required source capability 'search' is not implemented/,
  );
});

test("disabled adapter capabilities fail explicitly", async () => {
  const manifest = validManifest();
  manifest.capabilities = {
    popular: false,
    latest: false,
    search: false,
    details: false,
    chapters: false,
    pages: false,
    tags: false,
    videos: false,
    pagination: false,
    requestHeaders: false,
    referer: false,
    rangeRequests: false,
  };
  manifest.filters = [];
  const source = asMangaSource({ manifest });
  await assert.rejects(
    () => source.popular({ page: 1, nsfw: false, poster: "medium" }),
    UnsupportedExtensionCapabilityError,
  );
});

test("fixture-backed source passes the full listing-to-page contract", async () => {
  const source = asMangaSource(fixtureAdapter());
  await assertMangaSourceContract(source, {
    listOptions: { page: 2, nsfw: false, poster: "medium" },
    query: "fixture",
    mangaId: "series-1",
    chapterId: "chapter-1",
  });
});

test("source contract harness catches malformed fixture responses", async () => {
  const source = asMangaSource(fixtureAdapter());
  source.latest = async () => ({
    items: [],
    page: 1,
    hasNextPage: "yes" as unknown as boolean,
  });
  await assert.rejects(
    () => assertMangaSourceContract(source, {
      listOptions: { page: 2, nsfw: false, poster: "medium" },
      query: "fixture",
      mangaId: "series-1",
      chapterId: "chapter-1",
    }),
    /latest\.page must match/,
  );
});
