import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/engine/sheet.ts';
import { projectFinance } from '../src/engine/projectFinance.ts';
import { tollRoad } from '../src/modules/tollRoad.ts';

const def = projectFinance(tollRoad);
const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
// A greenfield case, so the mechanics are tested away from the Confederation Bridge defaults.
const green = { start_year: 2027, con_years: 3, ops_years: 30, capex: 1000, capex_p1: 0.3, capex_p2: 0.4, capex_p3: 0.3, max_gearing: 0.9, tax_rate: 0.265, tenor: 28, amort: 0, dscr: 1.2, traffic: 10, toll: 5, opex_t: 12, lifecycle_t: 3, ramp_start: 0.7, ramp_years: 3 };

test('ramp-up, growth and toll escalation follow their formulas', () => {
  const { row } = new Model(def, { ...green, ramp_start: 0.6, ramp_years: 4, traffic_growth: 0.02, toll_index: 0.75, cpi: 0.02 }).results();
  const k = (n: number) => row.ops_year.indexOf(n);
  close(row.ramp[k(1)], 0.6);
  close(row.ramp[k(3)], 0.8);
  close(row.ramp[k(5)], 1);
  close(row.trips[k(5)], 10 * 1.02 ** 4);
  close(row.toll_rate[k(1)], 5 * row.index[k(1)] ** 0.75);
  close(row.toll_rev[k(5)], row.trips[k(5)] * row.toll_rate[k(5)]);
});

test('lender haircut sizes less debt; the sponsor case covers more than the sizing case', () => {
  const lo = new Model(def, { ...green, traffic_haircut: 0 }).results().scalar;
  const hi = new Model(def, { ...green, traffic_haircut: 0.2 }).results().scalar;
  assert.ok(hi.debt < lo.debt);
  assert.ok(hi.min_dscr > hi.min_dscr_b);
  close(hi.min_dscr_b, 1.2, 1e-6);
  close(hi.sources, hi.uses);
});

test('debt repays by the end of the tenor', () => {
  const r = new Model(def, green).results();
  close(r.row.debt_close[r.years - 1], 0);
});

test('growing debt service: payments rise at the set rate, repay by the tenor, and the minimum year sits at the target', () => {
  const r = new Model(def, { ...green, amort: 1, ds_growth: 0.03, tenor: 20, ops_years: 25 }).results();
  const ds = r.row.ds.filter((v, k) => r.row.tenor_flag[k] === 1);
  assert.equal(ds.length, 20);
  for (let k = 1; k < ds.length; k++) close(ds[k] / ds[k - 1], 1.03, 1e-9);
  close(r.row.debt_close[r.row.ops_year.indexOf(20)], 0, 1e-6);
  close(r.scalar.min_dscr_b, 1.2, 1e-6);
});

test('Confederation Bridge example passes its published checks', () => {
  const res = new Model(def).results();
  for (const c of tollRoad.checks!) if (!c.info) {
    const d = c.model(res) / c.published - 1;
    assert.ok(Math.abs(d) <= (c.tol ?? 0.01), `${c.label}: ${c.model(res)} vs ${c.published}`);
  }
});
