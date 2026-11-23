import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import HF from 'hyperformula';
import { Model } from '../src/engine/sheet.ts';
import { dcf, type Company } from '../src/engine/dcf.ts';
import { toXlsx } from '../src/engine/excel.ts';

// Frozen copy of the Fortis data file (the live one in public/data/eq is rebuilt daily).
const co: Company = JSON.parse(readFileSync(new URL('./fixtures/FTS.json', import.meta.url), 'utf8'));
const { def } = dcf(co, { years: 5, scenario: 'base', wacc: 'capm', terminal: 'growth' });
const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test('steady state: enterprise value equals the growing perpetuity FCF1 / (WACC - g)', () => {
  const W = 0.08, g = 0.02;
  const s = new Model(def, { wacc_mode: 1, wacc_in: W, g1: g, g_term: g, m1: 0.25, m_target: 0.25, reinv1: g / W, ronic: 0, stub: 0, mid: 0 }).results();
  const fcf1 = s.row.fcf[s.row.fc.indexOf(1)];
  close(s.scalar.ev, fcf1 / (W - g));
  // and the free cash flow itself grows at g every forecast year
  const f = s.row.fcf.filter((_, k) => s.row.fc[k] === 1);
  for (let k = 1; k < f.length; k++) close(f[k] / f[k - 1], 1 + g);
});

test('equity bridge and per share value', () => {
  const { scalar: s, row } = new Model(def).results();
  const v = Object.fromEntries(def.inputs.map(i => [i.id, i.value]));
  // cash flow earned between the fiscal year end and the price date is added: the balance sheet is from the year end
  close(s.stub_fcf, row.fcf[row.fc.indexOf(1)] * v.stub);
  close(s.eq, s.ev + s.stub_fcf - v.debt + v.cash - v.nci - v.pref);
  close(s.per_share, s.eq / v.shares);
  close(s.wacc, (1 - s.w_d) * (v.rf + v.beta * v.erp) + s.w_d * v.kd * (1 - v.tax));
});

test('reported years reproduce the filing figures', () => {
  const { row } = new Model(def).results();
  // Fortis 2025 40-F XBRL: revenue 12,170, operating income 3,492, D&A 2,057, capex 5,942 (C$m)
  close(row.rev[2], 12170, 1e-3); close(row.ebit[2], 3492, 1e-3); close(row.da[2], 2057, 1e-3); close(row.capex[2], 5942, 1e-3);
});

test('exported workbook recalculates to the same numbers', async () => {
  const m = new Model(def);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await toXlsx(m));
  const sheets: Record<string, unknown[][]> = {};
  for (const name of ['Inputs', 'Model']) {
    const grid: unknown[][] = [];
    wb.getWorksheet(name)!.eachRow({ includeEmpty: true }, (row, r) => row.eachCell({ includeEmpty: true }, (cell, c) => {
      const x: any = cell.value;
      (grid[r - 1] ??= [])[c - 1] = x && typeof x === 'object' && 'formula' in x ? '=' + x.formula : x;
    }));
    sheets[name] = grid;
  }
  const hf = (HF as any).HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  const got = hf.getSheetValues(hf.getSheetId('Model'));
  let n = 0;
  m.sheetValues().Model.forEach((row: unknown[], r: number) => row.forEach((x, c) => {
    if (typeof x === 'string' && /^#[A-Z]/.test(x)) assert.fail(`error ${x} at Model!R${r + 1}C${c + 1}`);
    if (typeof x !== 'number') return;
    n++;
    assert.ok(Math.abs((got[r][c] as number) - x) < 1e-9, `Model!R${r + 1}C${c + 1}: ${got[r][c]} vs ${x}`);
  }));
  assert.ok(n > 100, `only ${n} numbers compared`);
});

test('Fortis example: guidance assumptions reproduce the filings and the capital plan', async () => {
  const { fortisEquity: e, fortisChecks } = await import('../src/modules/fortisEquity.ts');
  const m = new Model(dcf(e.company, e.answers, e.overrides).def);
  const res = m.results();
  for (const c of fortisChecks) if (!c.info) assert.ok(Math.abs(c.model(res) / c.published - 1) <= (c.tol ?? 0.01), c.label);
  assert.ok(res.scalar.ronic_used > res.scalar.wacc, 'new capital earns above WACC');
});

test('Microsoft example: consensus growth and FY2026 10-K figures reproduce', async () => {
  const { msftEquity: e, msftChecks } = await import('../src/modules/msftEquity.ts');
  const res = new Model(dcf(e.company, e.answers, e.overrides).def).results();
  for (const c of msftChecks) if (!c.info) assert.ok(Math.abs(c.model(res) / c.published - 1) <= (c.tol ?? 0.01), c.label);
  assert.ok(res.scalar.ev > 0 && res.scalar.ronic_used > res.scalar.wacc);
});

test('consensus: years 1 and 2 growth as estimated, then a straight fade; NTM forward figures', async () => {
  const { forward } = await import('../src/engine/comps.ts');
  const withCons: Company = { ...co, cons: { date: co.price.date, rows: [{ end: '2026-12-31', g: 0.1, nRev: 5, eps: 4, nEps: 5 }, { end: '2027-12-31', g: 0.06, nRev: 5, eps: 5, nEps: 5 }] } };
  const d = dcf(withCons, { years: 5, scenario: 'base', wacc: 'capm', terminal: 'growth' }).def;
  const { row } = new Model(d).results();
  const g = row.growth.filter((_, k) => row.fc[k] === 1);
  const gt = d.inputs.find(i => i.id === 'g_term')!.value;
  close(g[0], 0.1); close(g[1], 0.06); close(g[4], gt);
  close(g[2], 0.06 + (gt - 0.06) / 3); // straight line from year 2 to year 5
  // bear case moves both consensus years by 3pt
  const bear = dcf(withCons, { years: 5, scenario: 'downside', wacc: 'capm', terminal: 'growth' }).def.inputs;
  close(bear.find(i => i.id === 'g2')!.value, 0.03);
  // NTM: share f of year 1 has passed, so NTM = (1 - f) x year 1 + f x year 2
  const f = forward(withCons, 1000, 10);
  close(f.rev_f!, 1000 * 1.1 * (1 - f.f + f.f * 1.06)); close(f.ni_f!, ((1 - f.f) * 4 + f.f * 5) * 10);
  assert.equal(forward(co, 1000, 10).rev_f, null);
});
