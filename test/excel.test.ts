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
  for (const name of ['Inputs', 'Model']) {
    const grid: unknown[][] = [];
    wb.getWorksheet(name)!.eachRow({ includeEmpty: true }, (row, r) => {
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        const v: any = cell.value;
        (grid[r - 1] ??= [])[c - 1] = v && typeof v === 'object' && 'formula' in v ? (formulas++, '=' + v.formula) : v;
      });
    });
    sheets[name] = grid;
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
});
