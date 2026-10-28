import assert from "node:assert/strict";
import type { DetailOptions, ListOptions, MangaSource } from "../sources/types";

export interface SourceContractProbe {
  listOptions: ListOptions;
  query: string;
  mangaId: string;
  chapterId: string;
}

const DETAIL_OPTIONS: DetailOptions = {
  poster: "medium",
  alt: false,
  score: "none",
};

function assertListResponse(value: unknown, expectedPage: number, operation: string): void {
  assert.ok(value && typeof value === "object", `${operation} must return an object`);
  const response = value as { items?: unknown; page?: unknown; hasNextPage?: unknown };
  assert.ok(Array.isArray(response.items), `${operation}.items must be an array`);
  assert.equal(response.page, expectedPage, `${operation}.page must match the requested page`);
  assert.equal(typeof response.hasNextPage, "boolean", `${operation}.hasNextPage must be boolean`);
  for (const [index, rawItem] of response.items.entries()) {
    assert.ok(rawItem && typeof rawItem === "object", `${operation}.items[${index}] must be an object`);
    const item = rawItem as Record<string, unknown>;
    assert.equal(typeof item.id, "string", `${operation}.items[${index}].id must be a string`);
    assert.equal(typeof item.title, "string", `${operation}.items[${index}].title must be a string`);
    assert.equal(typeof item.thumbnail, "string", `${operation}.items[${index}].thumbnail must be a string`);
    assert.equal(typeof item.type, "string", `${operation}.items[${index}].type must be a string`);
    assert.equal(typeof item.isNsfw, "boolean", `${operation}.items[${index}].isNsfw must be boolean`);
  }
}

function assertDetails(value: unknown, mangaId: string): void {
  assert.ok(value && typeof value === "object", "details must return an object");
  const detail = value as Record<string, unknown>;
  assert.equal(detail.id, mangaId, "details.id must preserve the requested ID");
  for (const field of ["title", "author", "artist", "synopsis", "status", "type", "thumbnail", "score"]) {
    assert.equal(typeof detail[field], "string", `details.${field} must be a string`);
  }
  assert.ok(Array.isArray(detail.altTitles), "details.altTitles must be an array");
  assert.ok(Array.isArray(detail.genres), "details.genres must be an array");
  assert.equal(typeof detail.isNsfw, "boolean", "details.isNsfw must be boolean");
  assert.equal(typeof detail.rating, "number", "details.rating must be a number");
  assert.ok(["top", "bottom", "none"].includes(String(detail.scorePosition)), "details.scorePosition is invalid");
}

function assertChapters(value: unknown): void {
  assert.ok(value && typeof value === "object", "chapters must return an object");
  const response = value as { items?: unknown };
  assert.ok(Array.isArray(response.items), "chapters.items must be an array");
  for (const [index, rawItem] of response.items.entries()) {
    assert.ok(rawItem && typeof rawItem === "object", `chapters.items[${index}] must be an object`);
    const chapter = rawItem as Record<string, unknown>;
    assert.ok(typeof chapter.id === "string" || typeof chapter.id === "number", `chapters.items[${index}].id is invalid`);
    assert.equal(typeof chapter.number, "number", `chapters.items[${index}].number must be a number`);
    assert.equal(typeof chapter.title, "string", `chapters.items[${index}].title must be a string`);
    assert.equal(typeof chapter.scanlator, "string", `chapters.items[${index}].scanlator must be a string`);
    assert.equal(typeof chapter.date, "number", `chapters.items[${index}].date must be a number`);
  }
}

function assertPages(value: unknown, chapterId: string): void {
  assert.ok(value && typeof value === "object", "pages must return an object");
  const response = value as { chapterId?: unknown; pages?: unknown };
  assert.equal(String(response.chapterId), chapterId, "pages.chapterId must preserve the requested ID");
  assert.ok(Array.isArray(response.pages), "pages.pages must be an array");
  const indexes = new Set<number>();
  for (const [position, rawPage] of response.pages.entries()) {
    assert.ok(rawPage && typeof rawPage === "object", `pages.pages[${position}] must be an object`);
    const page = rawPage as Record<string, unknown>;
    assert.ok(Number.isInteger(page.index) && Number(page.index) >= 0, `pages.pages[${position}].index is invalid`);
    assert.ok(!indexes.has(Number(page.index)), `pages.pages[${position}].index is duplicated`);
    indexes.add(Number(page.index));
    assert.equal(typeof page.url, "string", `pages.pages[${position}].url must be a string`);
    const url = new URL(String(page.url), "https://comixhub.invalid");
    assert.ok(url.protocol === "http:" || url.protocol === "https:", `pages.pages[${position}].url must use HTTP(S)`);
  }
}

/**
 * Run the stable ComiXHub source contract against a fixture-backed or mocked
 * MangaSource. It deliberately performs no network calls itself.
 */
export async function assertMangaSourceContract(
  source: MangaSource,
  probe: SourceContractProbe,
): Promise<void> {
  const { listOptions, query, mangaId, chapterId } = probe;
  const popular = await source.popular(listOptions);
  assertListResponse(popular, listOptions.page, "popular");

  const latest = await source.latest(listOptions);
  assertListResponse(latest, listOptions.page, "latest");

  const search = await source.search(query, listOptions);
  assertListResponse(search, listOptions.page, "search");

  assertDetails(await source.details(mangaId, DETAIL_OPTIONS), mangaId);
  assertChapters(await source.chapters(mangaId, false));
  assertPages(await source.pages(chapterId), chapterId);

  if (source.tags) {
    const tags: unknown = await source.tags();
    assert.ok(Array.isArray(tags), "tags must return an array");
    for (const [index, rawTag] of tags.entries()) {
      assert.ok(rawTag && typeof rawTag === "object", `tags[${index}] must be an object`);
      const tag = rawTag as Record<string, unknown>;
      assert.equal(typeof tag.id, "string", `tags[${index}].id must be a string`);
      assert.equal(typeof tag.name, "string", `tags[${index}].name must be a string`);
    }
  }
}
