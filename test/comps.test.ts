import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { comp, impliedPerShare, median, groupOf } from '../src/engine/comps.ts';

const fts = JSON.parse(readFileSync('src/data/fts-2026-11-18.json', 'utf8'));

test('Fortis multiples tie to the filed figures', () => {
  const c = comp(fts)!;
  const ev = 84.46 * 507.34 + (30723 + 3146 + 412) - 367 + 2059 + 1623;
  assert.ok(Math.abs(c.ev - ev) < 1e-6);
  assert.ok(Math.abs(c.evEbitda! - ev / (3492 + 2057)) < 1e-9);
  assert.ok(Math.abs(c.pe! - 84.46 * 507.34 / 1961) < 1e-9);
  assert.equal(groupOf('FTS'), 'Regulated utilities');
});

test('implied value at its own multiple returns the price', () => {
  const c = comp(fts)!;
  assert.ok(Math.abs(impliedPerShare(fts, c.evEbitda!) - fts.price.v) < 1e-9);
});

test('median skips missing values', () => {
  assert.equal(median([3, undefined, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([undefined]), undefined);
});
