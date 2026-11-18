import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/engine/sheet.ts';
import { lease } from '../src/engine/lease.ts';
import { digital } from '../src/modules/digital.ts';

const def = lease(digital);
const base = Object.fromEntries(def.inputs.map(i => [i.id, i.value]));

test('Blue Owl defaults reproduce the published value and all four sensitivities', () => {
  const m = new Model(def, base);
  const r = m.results();
  for (const c of digital.checks!.filter(c => !c.info)) {
    const v = c.model(r);
    assert.ok(Math.abs(v / c.published - 1) <= (c.tol ?? 0.01), `${c.label}: ${v} vs ${c.published}`);
  }
  const dec = digital.checks!.find(c => c.info)!;
  assert.ok(Math.abs(dec.model(r) / dec.published - 1) < 0.02, 'out-of-sample Dec 2025 within 2%');
  m.hf.destroy();
});

test('value equals a hand calculation; IRR at the model value equals the discount rate', () => {
  const v = { ...base, esc: 0.03, margin: 1, ntm: 100, hold: 3, rate: 0.08, cap: 0.06, price: 0 };
  const m = new Model(def, v);
  const s0 = m.results().scalar;
  const hand = 100 / 1.08 + 103 / 1.08 ** 2 + 106.09 / 1.08 ** 3 + 109.2727 / 0.06 / 1.08 ** 3;
  assert.ok(Math.abs(s0.value - hand) < 1e-6, `${s0.value} vs ${hand}`);
  m.set({ ...v, price: s0.value });
  assert.ok(Math.abs(m.results().scalar.irr - 0.08) < 1e-7);
  m.hf.destroy();
});

test('rollover: non-renewal loses downtime rent in the expiry year only, mark-to-market persists', () => {
  const v = { ...base, esc: 0, margin: 1, ntm: 100, exp_1: 0, exp_2: 20, exp_3: 0, renew: 0.5, downtime: 6, mtm: 0.1 };
  const m = new Model(def, v);
  const rent = m.results().row.rent;
  assert.ok(Math.abs(rent[1] - 100) < 1e-9);
  assert.ok(Math.abs(rent[2] - (100 + 2 - 0.5 * 0.5 * 20 * 1.1)) < 1e-9);
  assert.ok(Math.abs(rent[3] - 102) < 1e-9);
  m.hf.destroy();
});
