import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/engine/sheet.ts';
import { projectFinance } from '../src/engine/projectFinance.ts';
import { renewables } from '../src/modules/renewables.ts';

const def = projectFinance(renewables);
const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

// The Dufferin Wind example is only shown when it reproduces the published figures.
test('Dufferin Wind defaults match the published figures', () => {
  const res = new Model(def).results();
  for (const c of renewables.checks!) {
    if (c.info) continue;
    const m = c.model(res);
    assert.ok(Math.abs(m / c.published - 1) <= (c.tol ?? 0.01), `${c.label}: model ${m} vs published ${c.published}`);
  }
});

// Hand-checkable level-payment case: no tax, no inflation, flat output.
test('level payments match a hand calculation', () => {
  const m = new Model(def, {
    ops_years: 3, tenor: 3, contract_years: 3, capex: 100, tax_rate: 0, cpi: 0, rate: 0.1, dscr: 1.25, max_gearing: 1, dsra_months: 0,
    energy_p50: 300, energy_sizing: 200, ppa_price: 100, opex: 5, amort: 1,
  });
  const { scalar: s, row } = m.results();
  // Sizing CFADS = 200 GWh x $100 / 1000 - 5 = 15 a year; payment = 15 / 1.25 = 12; debt = PV of 12 for 3 years at 10%.
  const D = 12 * (1 - 1.1 ** -3) / 0.1;
  close(s.debt, D);
  row.ds.slice(1).forEach(v => close(v, 12));
  close(row.debt_close[3], 0);
  close(s.min_dscr_b, 1.25);
  close(s.min_dscr, (300 * 100 / 1000 - 5) / 12);            // P50 case: 25 / 12
});

test('level payments with tax: repaid by the end of the tenor, tightest year on target, identities hold', () => {
  const { scalar: s, row, years } = new Model(def).results();
  close(row.debt_close[years - 1], 0);
  close(sum(row.principal), s.debt);
  close(s.sources, s.uses);
  const ds = row.ds.filter((_, k) => row.tenor_flag[k] === 1);
  ds.forEach(v => close(v, ds[0]));                            // equal payments
  close(s.min_dscr_b, renewables.defaults!.dscr.value, 1e-6);
  assert.ok(s.min_dscr > s.min_dscr_b);                        // P50 covers more than the sizing case
});

test('sculpted option still holds the target DSCR in the sizing case', () => {
  const { scalar: s, row } = new Model(def, { amort: 0 }).results();
  row.dscr_b.forEach((d, k) => { if (row.tenor_flag[k] === 1) close(d, 1.6, 1e-6); });
  close(row.debt_close[row.debt_close.length - 1], 0);
  assert.ok(s.debt > 0);
});

test('merchant tail prices output at the merchant price after the contract', () => {
  const { row } = new Model(def, { ops_years: 25 }).results();
  const k = row.ops_year.indexOf(20);
  assert.equal(row.contract_flag[k], 0);
  close(row.price[k], 28.2 * row.index[k]);
});

// Refinancing risk: a shorter legal maturity leaves a balloon that is refinanced over the rest of the tenor.
test('balloon refinanced at the same rate changes nothing; a higher rate lowers coverage and returns only after maturity', () => {
  const base = new Model(def).results();
  const same = new Model(def, { maturity: 7 }).results();
  close(same.scalar.balloon, base.row.debt_close[base.row.ops_year.indexOf(7)]);
  same.row.ds.forEach((v, k) => close(v, base.row.ds[k], 1e-6));
  const hi = new Model(def, { maturity: 7, refi_spread: 0.02 }).results();
  close(hi.scalar.debt, base.scalar.debt);
  const k8 = hi.row.ops_year.indexOf(8);
  hi.row.ds.forEach((v, k) => (k < k8 ? close(v, base.row.ds[k], 1e-6) : assert.ok(hi.row.tenor_flag[k] === 0 || v > base.row.ds[k])));
  close(hi.row.debt_close[hi.years - 1], 0);
  assert.ok(hi.scalar.equity_irr < base.scalar.equity_irr && hi.scalar.min_dscr < base.scalar.min_dscr);
});
