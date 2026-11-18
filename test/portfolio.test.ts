import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valuePortfolio } from '../src/engine/portfolio.ts';

test('portfolio: C$ totals, weights, beta and gain', () => {
  const q = {
    FTS: { name: 'Fortis', currency: 'CAD', price: 80, date: '2026-11-18', beta: 0.4 },
    NEE: { name: 'NextEra', currency: 'USD', price: 50, date: '2026-11-18', beta: 0.8 },
  };
  const p = valuePortfolio([{ ticker: 'FTS', shares: 10, cost: 64 }, { ticker: 'NEE', shares: 10, cost: 50 }, { ticker: 'ZZZ', shares: 1, cost: 1 }], q, 1.4);
  assert.equal(p.rows.length, 2); // uncovered ticker dropped
  assert.equal(p.total, 800 + 700);
  assert.ok(Math.abs(p.rows[0].gain - 0.25) < 1e-12);
  assert.ok(Math.abs(p.beta - (800 * 0.4 + 700 * 0.8) / 1500) < 1e-12);
  assert.ok(Math.abs(p.gain - 1500 / (640 + 700) + 1) < 1e-12);
  assert.ok(Math.abs(p.usdShare - 700 / 1500) < 1e-12);
  const nc = valuePortfolio([{ ticker: 'FTS', shares: 10, cost: 64 }, { ticker: 'NEE', shares: 10, cost: 0 }], q, 1.4);
  assert.ok(Math.abs(nc.gain - 0.25) < 1e-12, 'no-cost holding excluded from gain');
});
