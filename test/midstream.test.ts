import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/engine/sheet.ts';
import { projectFinance } from '../src/engine/projectFinance.ts';
import { midstream } from '../src/modules/midstream.ts';

const def = projectFinance(midstream);
const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('demand revenue is take-or-pay: it does not move with throughput', () => {
  const v = { capacity: 1000, contracted: 0.9, demand_toll: 0.6, toll_index_m: 0, cpi: 0, commodity_toll: 0.03, utilization: 0.9 };
  const a = new Model(def, v).results().row, b = new Model(def, { ...v, utilization: 0.5 }).results().row;
  const k = a.ops_year.indexOf(1);
  close(a.demand_rev[k], 1000 * 0.9 * 365 / 1000 * 0.6);   // 328.5 bcf x C$0.60/mcf = C$197.1m
  close(b.demand_rev[k], a.demand_rev[k]);
  close(a.volume_rev[k], 1000 * 0.9 * 365 / 1000 * 0.03);
  close(b.volume_rev[k], 1000 * 0.5 * 365 / 1000 * 0.03);
});

test('after the contract term demand revenue drops to the recontracting rate; debt is sized on contracted cash flow', () => {
  const { row, scalar } = new Model(def, { ops_years: 30, top_years: 20, tenor: 20, recontract: 0.8, toll_index_m: 0 }).results();
  const k20 = row.ops_year.indexOf(20), k21 = row.ops_year.indexOf(21);
  close(row.demand_rev[k21] / row.demand_rev[k20], 0.8);
  close(row.debt_close[row.ops_year.indexOf(20)], 0);
  assert.ok(scalar.min_dscr >= scalar.min_dscr_b - 1e-9);
  close(scalar.sources, scalar.uses);
});
