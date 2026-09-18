import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SAMPLE_BRAND_MARKS } from '../src/components/discovery/sample-brand-mark-data.ts';

test('sample brand marks are complete, distinct, and leave other brands to the initials fallback', () => {
  assert.equal(Object.keys(SAMPLE_BRAND_MARKS).length, 10);
  assert.equal(new Set(Object.values(SAMPLE_BRAND_MARKS).map((mark) => mark.symbol)).size, 10);
  assert.equal(SAMPLE_BRAND_MARKS['A non-sample brand'], undefined);
});

test('every sample brand mark has a reviewed CC0 SVG Repo source record', async () => {
  const raw = await readFile(new URL('../assets/icons/brand-marks/manifest.json', import.meta.url), 'utf8');
  const manifest = JSON.parse(raw);

  assert.equal(manifest.source, 'SVG Repo');
  assert.equal(manifest.assets.length, 10);
  for (const asset of manifest.assets) {
    assert.ok(SAMPLE_BRAND_MARKS[asset.brand]);
    assert.equal(asset.license, 'CC0 1.0 Universal (CC0 1.0) Public Domain Dedication');
    assert.match(asset.source_page, /^https:\/\/www\.svgrepo\.com\/svg\//);
    assert.doesNotMatch(asset.symbol.toLowerCase(), /logo/);
  }
});
