import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import HF from 'hyperformula';
import { Model } from '../src/engine/sheet.ts';
import { defOf } from '../src/engine/regulated.ts';
import { toXlsx } from '../src/engine/excel.ts';
import { p3 } from '../src/modules/p3.ts';
import { renewables } from '../src/modules/renewables.ts';
import { tollRoad } from '../src/modules/tollRoad.ts';
import { utility } from '../src/modules/utility.ts';
import { digital } from '../src/modules/digital.ts';

// Read the exported file back, recalculate its formulas from scratch, and compare to the site.
for (const mod of [p3, renewables, tollRoad, utility, digital]) test(`${mod.id}: exported workbook recalculates to the same numbers`, async () => {
  const m = new Model(defOf(mod));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await toXlsx(m));
  const sheets: Record<string, unknown[][]> = {};
  let formulas = 0;
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Dashboard', 'Inputs', 'Model']);
  for (const name of ['Dashboard', 'Inputs', 'Model']) {
    const grid: unknown[][] = [];
    wb.getWorksheet(name)!.eachRow({ includeEmpty: true }, (row, r) => {
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        const v: any = cell.value;
        (grid[r - 1] ??= [])[c - 1] = v && typeof v === 'object' && 'formula' in v ? (formulas++, '=' + v.formula) : v;
      });
    });
    sheets[name] = Array.from(grid, row => (row ? Array.from(row, v => v ?? null) : [])); // fill gaps left by empty rows and cells
  }
  assert.ok(formulas > (mod.engine === 'lease' ? 200 : mod.engine ? 300 : 1000), `only ${formulas} formulas`);
  const hf = (HF as any).HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  const got = hf.getSheetValues(hf.getSheetId('Model'));
  const want = m.sheetValues().Model;
  let compared = 0;
  want.forEach((row: unknown[], r: number) => row.forEach((v, c) => {
    if (typeof v !== 'number') return;
    compared++;
    assert.ok(Math.abs((got[r][c] as number) - v) < 1e-9, `Model!R${r + 1}C${c + 1}: ${got[r][c]} vs ${v}`);
  }));
  assert.ok(compared > (mod.engine === 'lease' ? 150 : mod.engine ? 300 : 1000));
  // Dashboard: every value is a link, and it recalculates to the cell it points at.
  const dash = hf.getSheetValues(hf.getSheetId('Dashboard'));
  let links = 0;
  sheets.Dashboard.forEach((row, r) => row?.forEach((f, c) => {
    if (typeof f !== 'string' || !f.startsWith('=')) return;
    const [, sh, col, rr] = f.match(/^=(Inputs|Model)!\$([A-Z]+)\$(\d+)$/)!;
    const ci = [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const target = sh === 'Model' ? want[+rr - 1][ci] : m.sheetValues().Inputs[+rr - 1][ci];
    links++;
    if (typeof target === 'number') assert.ok(Math.abs((dash[r][c] as number) - target) < 1e-9, `Dashboard!R${r + 1}C${c + 1}`);
  }));
  assert.ok(links > 30, `only ${links} dashboard links`);
  hf.destroy();
});

// Equities add the Comps and Valuation tabs (inputs on the Inputs tab). Fortis with made-up peers, one of them with
// consensus and one with a negative EBITDA: the workbook must give the site's football field and weighted price.
test('equity: Comps and Valuation tabs recalculate to the site valuation', async () => {
  const { readFileSync } = await import('node:fs');
  const { dcf } = await import('../src/engine/dcf.ts');
  const { valuation } = await import('../src/engine/valuation.ts');
  const { W, WHY } = await import('../src/engine/fit.ts');
  const co = JSON.parse(readFileSync(new URL('./fixtures/FTS.json', import.meta.url), 'utf8'));
  co.price.lo52 = 70; co.price.hi52 = 90;
  const { def, missing } = dcf(co, { years: 5, scenario: 'downside', wacc: 'capm', terminal: 'growth' });
  const m = new Model(def), res = m.results();
  const values = Object.fromEntries(def.inputs.map(i => [i.id, i.value]));
  const p = (ticker: string, mcap: number, ev: number, rev: number, ebitda: number, ni: number) => ({ ticker, sic: '4911', currency: 'USD', mcap, ev, rev, ebitda, ni, fy: '2025-12-31', rev_f: null, ni_f: null });
  const peers = [p('AAA', 40000, 70000, 12000, 5500, 2200), p('BBB', 30000, 55000, 9000, 4200, 1500), { ...p('CCC', 60000, 95000, 15000, 7000, 3100), rev_f: 16000, ni_f: 3300 }, p('DDD', 20000, 41000, 8000, 3100, 900), p('EEE', 5000, 9000, 3000, -200, -150)];
  const v = valuation({ co, values, res, peers, missing });
  const vx = { peers, basis: 'test peers', self: v.self, fit: v.fit, weights: W[v.fit.verdict], why: WHY[v.fit.verdict], lo52: 70, hi52: 90 };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await toXlsx(m, vx));
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Dashboard', 'Inputs', 'Model', 'Comps', 'Valuation']);
  const sheets: Record<string, unknown[][]> = {};
  for (const ws of wb.worksheets) {
    const grid: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => row.eachCell({ includeEmpty: true }, (cell, c) => {
      const x: any = cell.value;
      (grid[r - 1] ??= [])[c - 1] = x && typeof x === 'object' && 'formula' in x ? '=' + x.formula : x;
    }));
    sheets[ws.name] = Array.from(grid, row => (row ? Array.from(row, y => y ?? null) : []));
  }
  const hf = (HF as any).HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  for (const n of Object.keys(sheets)) hf.getSheetValues(hf.getSheetId(n)).forEach((row: unknown[], r: number) => row.forEach((x, c) => assert.ok(!(x && typeof x === 'object'), `${n}!R${r + 1}C${c + 1} is an error`)));
  const val = hf.getSheetValues(hf.getSheetId('Valuation'));
  const near = (a: unknown, b: number, what: string) => assert.ok(typeof a === 'number' && Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);
  const byLabel = (label: string) => val.find((row: unknown[]) => row[0] === label)!;
  let bars = 0;
  for (const b of v.bars) {
    const row = byLabel(b.label.startsWith('52-week') ? '52-week trading range (not weighted)' : b.label);
    if (Number.isFinite(b.mid)) { [b.lo, b.mid, b.hi].forEach((x, k) => near(row[1 + k], x, `${b.label} ${k}`)); bars++; }
    else assert.equal(row[2], 'n/m', b.label);
  }
  assert.ok(bars >= 6, `only ${bars} bars compared`);
  const imp = byLabel('Implied share price (weighted)');
  v.mixes.forEach((x, k) => near(imp[1 + k], x!.value, `implied ${k}`));
  near(byLabel('Implied share price, case selected on Inputs')[2], v.mixes[0]!.value, 'selected case (bear)');
  const want = v.mixes[1]!.weights;
  const wcol = (label: string) => byLabel(label)[6];
  near(wcol('DCF, perpetuity growth'), want.dcf_g, 'w dcf_g'); near(wcol('Comps, forward P / E'), want.pe_f, 'w pe_f'); near(wcol('Comps, P / E'), want.pe, 'w pe');
  hf.destroy();
});
