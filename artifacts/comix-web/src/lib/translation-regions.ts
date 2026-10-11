/**
 * Pure geometry helpers shared by the reader's whole-page and select-region
 * translation modes. They contain no DOM or AI-provider dependencies so the
 * coordinate mapping can be reasoned about and tested on its own.
 */

import type { TranslationRegion } from "./translation-cache";

/** A rectangle expressed as 0..1 fractions of the page image, origin at top-left. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MAX_PAGE_REGIONS = 80;

function clamp1000(value: number): number {
  return Math.max(0, Math.min(1000, Math.round(value)));
}

function normalizeRegionText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Map crop-relative boxes (0..1000 of the crop) into page-relative boxes
 * (0..1000 of the whole page). Because the crop rectangle is itself stored as a
 * fraction of the page, the scale factor is simply `region.width`/`height`.
 */
export function mapRegionsToPage(regions: TranslationRegion[], region: NormalizedRect): TranslationRegion[] {
  return regions.flatMap((item, index) => {
    const x = clamp1000(region.x * 1000 + item.x * region.width);
    const y = clamp1000(region.y * 1000 + item.y * region.height);
    const width = clamp1000(item.width * region.width);
    const height = clamp1000(item.height * region.height);
    if (width < 4 || height < 4 || x >= 1000 || y >= 1000) return [];
    return [{
      id: `region-${index + 1}`,
      sourceText: item.sourceText,
      translatedText: item.translatedText,
      x,
      y,
      width: Math.min(width, 1000 - x),
      height: Math.min(height, 1000 - y),
    }];
  });
}

/**
 * Region results are merged with what the page already shows so a reader can
 * translate several bubbles one at a time. Identical source text is not stacked
 * twice, ids are renumbered to stay unique, and the merged list keeps the same
 * 80-region ceiling the page mode uses.
 */
export function mergePageRegions(existing: TranslationRegion[], incoming: TranslationRegion[]): TranslationRegion[] {
  const merged: TranslationRegion[] = [];
  const seen = new Set<string>();
  for (const region of [...existing, ...incoming]) {
    const key = normalizeRegionText(region.sourceText);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(region);
    if (merged.length >= MAX_PAGE_REGIONS) break;
  }
  return merged.map((region, index) => ({ ...region, id: `region-${index + 1}` }));
}

/** Quantize a 0..1 drag coordinate onto the selection grid used for repeatable crops. */
export function quantizeSelectionValue(value: number, grid = 200): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * grid) / grid;
}

/** Build a normalized rectangle from two dragged corner points. */
export function rectFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
): NormalizedRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** A tap or a box this small is treated as a cancel rather than a crop. */
export function isUsableSelection(rect: NormalizedRect): boolean {
  return rect.width >= 0.03 && rect.height >= 0.02;
}