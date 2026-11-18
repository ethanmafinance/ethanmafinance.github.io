import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/engine/sheet.ts';
import { projectFinance } from '../src/engine/projectFinance.ts';
import { p3 } from '../src/modules/p3.ts';

const def = projectFinance(p3);
const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

// Hand-checkable case: one construction year, two operating years, no tax, no inflation, no costs.
test('tiny case matches a hand calculation', () => {
  const m = new Model(def, {
    con_years: 1, ops_years: 2, tenor: 2, capex: 100, capex_esc: 0, cp: 0, other_costs: 0, capex_p1: 1, capex_p2: 0, capex_p3: 0, cpi: 0, tax_rate: 0,
    rate: 0.1, dscr: 1.25, max_gearing: 0.9, dsra_months: 0, lockup: 1,
    ap_capital: 30, ap_services: 0, deductions: 0, fm_cost: 0, spv_cost: 0, lifecycle: 0,
  });
  const { scalar: s, row } = m.results();
  const P = 24 / 1.1 + 24 / 1.21;            // PV of 30 / 1.25 = 24 a year
  close(s.debt, P);                          // DSCR binds before 90% gearing
  close(s.equity, 100 - P);
  assert.deepEqual(row.ds.map(v => +v.toFixed(9)), [0, 24, 24]);
  close(row.debt_close[2], 0);
  close(s.min_dscr, 1.25);
  close(s.moic, 12 / (100 - P));
});

test('realistic P3 holds the accounting identities', () => {
  const m = new Model(def, { cp: 0 });
  const { scalar: s, row, years } = m.results();
  close(s.sources, s.uses);
  close(row.debt_close[years - 1], 0);                         // repaid by the end of the tenor
  close(sum(row.principal), s.debt);
  assert.ok(s.min_dscr >= 1.25 - 1e-9, `min DSCR ${s.min_dscr}`); // actual tax is lower than sizing tax
  assert.ok(s.gearing <= 0.866 + 1e-9);
  for (const k of ['equity_irr', 'project_irr', 'moic', 'llcr']) assert.ok(Number.isFinite(s[k]), k);
  // IRR recomputed outside the spreadsheet engine
  const npv = (r: number) => row.equity_cf.reduce((a, c, t) => a + c / (1 + r) ** t, 0);
  close(npv(s.equity_irr), 0, 1e-4);
});

test('gearing cap binds when the DSCR allows more debt', () => {
  const m = new Model(def, { cp: 0, dscr: 1.0, max_gearing: 0.5 });
  const { scalar: s } = m.results();
  close(s.gearing, 0.5);
});

test('changing an input updates results; changing timing rebuilds', () => {
  const m = new Model(def);
  const base = m.results().scalar.equity_irr;
  m.set({ ap_capital: 80 });
  assert.ok(m.results().scalar.equity_irr > base);
  m.set({ ops_years: 25, tenor: 23 });
  assert.equal(m.results().years, 29); // 4 construction + 25 operating
});

test('completion payment repays its facility and keeps sources equal to uses', () => {
  const m = new Model(def, { cp: 300 });
  const { scalar: s, row, years } = m.results();
  close(s.cp_src, 300);
  close(s.sources, s.uses);
  close(Math.max(...row.cpf_close.slice(3).map(Math.abs)), 0);      // zero from COD (end of year 4) on
  assert.ok(row.cpf_close[1] > 0);
  close(row.cpf_close[3], 0);
  close(row.debt_close[years - 1], 0);
  assert.ok(s.min_dscr >= 1.25 - 1e-9);
  const without = new Model(def, { cp: 0 }).results().scalar;
  assert.ok(s.debt <= without.debt + 1e-9 && s.equity < without.equity);
});

// The Humber River example is only shown when it reproduces every published figure.
test('Humber River defaults match the published figures within 1%', () => {
  const res = new Model(def).results();
  for (const c of p3.checks!) {
    const m = c.model(res);
    assert.ok(Math.abs(m / c.published - 1) <= 0.01, `${c.label}: model ${m} vs published ${c.published}`);
  }
});

// Tax-aware sculpting: with the DSCR binding and no tax losses, every tenor year sits on the target.
test('sculpted debt holds the target DSCR after tax with the interest deduction', () => {
  const { row, scalar: s } = new Model(def, { cp: 0, max_gearing: 0.99, dscr: 1.3 }).results();
  assert.ok(s.share_dscr < s.share_gearing);
  row.dscr_actual.forEach((d, k) => { if (row.tenor_flag[k] === 1 && row.l_loss[k - 1] === 0) close(d, 1.3, 1e-6); });
  close(row.debt_close[row.debt_close.length - 1], 0);
});

// Downside inputs move cash flow but not the debt, which was sized at financial close.
test('downside case keeps base debt service and lowers coverage', () => {
  const base = new Model(def).results();
  const st = new Model(def, { st_opex: 0.25, st_cpi: -0.01, st_rev: -0.01 }).results();
  close(st.scalar.debt, base.scalar.debt);
  st.row.ds.forEach((v, k) => close(v, base.row.ds[k]));
  assert.ok(st.scalar.min_dscr < base.scalar.min_dscr && st.scalar.equity_irr < base.scalar.equity_irr);
  close(st.scalar.sources, st.scalar.uses);
  close(st.row.debt_close[st.years - 1], 0);
});

test('sculpted debt with a balloon at year 10 still repays by the end of the tenor', () => {
  const r = new Model(def, { maturity: 10, refi_spread: 0.015 }).results();
  assert.ok(r.scalar.balloon > 0);
  close(r.row.debt_close[r.years - 1], 0);
  close(r.scalar.sources, r.scalar.uses);
});

test('deferring equity to COD: same value at the debt rate, higher IRR, sources still equal uses', () => {
  const m = new Model(projectFinance(p3));
  const a = m.results();
  m.set({ eq_defer: 1 });
  const b = m.results();
  const con = b.row.con_flag.filter(x => x === 1).length;
  const rate = def.inputs.find(i => i.id === 'rate')!.value;
  // Pro rata contributions compounded to COD at the bridge (debt) rate equal the single deferred contribution.
  const fv = a.row.equity_in.slice(0, con).reduce((s, e, k) => s + (e - a.row.dsra_change[k] * a.row.con_flag[k]) * (1 + rate) ** (con - 1 - k), 0);
  const atCod = b.row.equity_in[con - 1] - b.row.dsra_change[con - 1];
  assert.ok(Math.abs(fv / atCod - 1) < 1e-9, `${fv} vs ${atCod}`);
  assert.ok(b.row.equity_in.slice(0, con - 1).every(e => Math.abs(e) < 1e-9));
  assert.ok(b.scalar.equity_irr > a.scalar.equity_irr);
  assert.ok(Math.abs(b.scalar.sources - b.scalar.uses) < 1e-6);
  assert.equal(b.scalar.debt, a.scalar.debt); // sizing unchanged
  assert.ok(Math.abs(b.scalar.gearing - a.scalar.gearing) < 1e-12);
});

test('construction delay: lost years carry no revenue, damages pay debt service, debt unchanged', async () => {
  const { projectFinance } = await import('../src/engine/projectFinance.ts');
  const { p3 } = await import('../src/modules/p3.ts');
  const { Model } = await import('../src/engine/sheet.ts');
  const def = projectFinance(p3);
  const base = Object.fromEntries(def.inputs.map(i => [i.id, i.value]));
  const m = new Model(def, base);
  const a = m.results();
  m.set({ ...base, st_delay: 1 });
  const b = m.results();
  const k = b.row.ops_year.indexOf(1);
  assert.equal(b.row.revenue[k], 0);
  assert.ok(Math.abs(b.row.ld[k] - b.row.ds[k]) < 1e-9 && b.row.ds[k] > 0);
  assert.ok(!Number.isFinite(b.row.dscr_actual[k]), 'not tested in a delay year');
  assert.ok(Number.isFinite(b.row.dscr_actual[k + 1]));
  assert.ok(Math.abs(b.scalar.debt - a.scalar.debt) < 1e-9, 'debt sized on the base case');
  assert.ok(b.row.revenue.slice(k + 1).every((x, j) => Math.abs(x - a.row.revenue[k + 1 + j]) < 1e-9), 'later years unchanged, contract end fixed');
  assert.ok(b.scalar.equity_irr < a.scalar.equity_irr);
  m.hf.destroy();
});
