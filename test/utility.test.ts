import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/engine/sheet.ts';
import { regulated } from '../src/engine/regulated.ts';
import { utility } from '../src/modules/utility.ts';

const def = regulated(utility);
const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const flat = (v: number) => Object.fromEntries([1, 2, 3, 4, 5].flatMap(k => [[`isa_${k}`, v], [`dep_${k}`, v]]));

test('revenue requirement adds up from its parts', () => {
  const { row } = new Model(def).results();
  for (let k = 1; k < row.year.length; k++) {
    close(row.srr[k], row.om[k] + row.dep[k] + row.int_deemed[k] + row.roe_ret[k] + row.pils[k]);
    close(row.roe_ret[k], row.rb[k] * 0.4 * (k === 1 ? 0.0925 : 0.09));
    close(row.rb[k], (row.nfa_open[k] + row.nfa_close[k]) / 2 + 231.3);
  }
});

test('no growth, no stretch, bought and sold at book: equity IRR equals the allowed ROE', () => {
  const s = new Model(def, { ...flat(300), isa_growth: 0, stretch: 0, entry_mult: 1, exit_mult: 1, roe_y1: 0 }).results().scalar;
  close(s.equity_irr, 0.09, 1e-7);
  close(s.avg_roe, 0.09, 1e-9);
});

test('buying at the value from the target IRR returns the target IRR', () => {
  const s0 = new Model(def).results().scalar;
  const s1 = new Model(def, { entry_mult: s0.ev_rb }).results().scalar;
  close(s1.equity_irr, 0.08, 1e-7);
});

test('a higher entry multiple lowers the IRR; savings that offset the stretch restore the allowed ROE', () => {
  const lo = new Model(def, { entry_mult: 1.2 }).results().scalar, hi = new Model(def, { entry_mult: 1.6 }).results().scalar;
  assert.ok(hi.equity_irr < lo.equity_irr);
  const { row } = new Model(def, { savings: 1 }).results();
  for (let k = 1; k < row.year.length; k++) close(row.earned_roe[k], k === 1 ? 0.0925 : 0.09, 1e-9);
});

test('Toronto Hydro example passes its published checks', () => {
  const res = new Model(def).results();
  for (const c of utility.checks!) if (!c.info) {
    const d = c.model(res) / c.published - 1;
    assert.ok(Math.abs(d) <= (c.tol ?? 0.01), `${c.label}: ${c.model(res)} vs ${c.published}`);
  }
});
