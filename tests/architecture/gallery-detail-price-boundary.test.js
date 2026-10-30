import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps the production detail loader on deferred large-display pricing and forwards planning options intact', () => {
  const source = readFileSync(new URL('../../src/fc27/production-entry.js', import.meta.url), 'utf8');
  expect(source).toMatch(/loadGalleryPriceSnapshot\(pool\.pool\.items,\s*{\s*autoDisplay: true,/);
  expect(source).toContain('galleryPlanningPrices: (ids, options = {}) => publicPrices.load(ids, options)');
});
