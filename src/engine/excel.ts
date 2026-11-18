// Writes the model to .xlsx with live formulas plus cached values, so the file shows
// numbers on open and recalculates when any input changes.
import ExcelJS from 'exceljs';
import { FIRST_YEAR_COL, type Fmt, type Model } from './sheet.ts';

const NUMFMT: Record<Fmt, string> = {
  num: '#,##0.0;(#,##0.0);-', pct: '0.0%', x: '0.00"x"', year: '0', int: '0', flag: '0', px: '#,##0.00',
};

export async function toXlsx(m: Model): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const vals = m.sheetValues();
  const fmtOf: Record<string, Fmt | undefined> = {};
  for (const i of m.def.inputs) fmtOf[i.id] = i.fmt;

  const fill = (ws: ExcelJS.Worksheet, cells: unknown[][], values: unknown[][], fmtRow: (r: number) => Fmt | undefined, firstValueCol: number) => {
    cells.forEach((rowCells, r) => rowCells.forEach((c, k) => {
      if (c === null || c === undefined || c === '') return;
      const cell = ws.getCell(r + 1, k + 1);
      const v = values[r]?.[k];
      if (typeof c === 'string' && c.startsWith('=')) cell.value = { formula: c.slice(1), result: typeof v === 'number' || typeof v === 'string' ? v : undefined } as any;
      else cell.value = c as any;
      const f = fmtRow(r);
      if (k >= firstValueCol && f) cell.numFmt = NUMFMT[f];
    }));
  };

  const inputs = wb.addWorksheet('Inputs');
  const inputFmt: Record<number, Fmt | undefined> = {};
  for (const [id, r] of Object.entries(m.lay.inputRow)) inputFmt[r] = fmtOf[id];
  fill(inputs, m.lay.inputs, vals.Inputs, r => inputFmt[r], 2);
  inputs.columns = [{ width: 58 }, { width: 12 }, { width: 12 }, { width: 90 }];
  for (const r of Object.values(m.lay.inputRow)) inputs.getCell(r + 1, 3).font = { color: { argb: 'FF0000FF' } }; // inputs in blue
  styleHeaders(inputs, m.lay.inputs, 1);

  const model = wb.addWorksheet('Model', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
  const rowFmt: Record<number, Fmt | undefined> = {};
  const bold = new Set<number>();
  for (const it of m.def.items) if ('kind' in it) { rowFmt[m.lay.itemRow[it.id]] = it.fmt; if (it.bold) bold.add(m.lay.itemRow[it.id]); }
  fill(model, m.lay.model, vals.Model, r => rowFmt[r], 2);
  model.columns = [{ width: 52 }, { width: 8 }, { width: 11 }, ...Array(m.lay.years).fill({ width: 10 })];
  for (const r of bold) model.getRow(r + 1).font = { bold: true };
  styleHeaders(model, m.lay.model, 1);
  for (let k = 0; k < m.lay.years; k++) model.getCell(1, FIRST_YEAR_COL + k + 1).value = { formula: `${colOf(k)}${m.lay.itemRow.year + 1}` } as any;

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

const colOf = (k: number) => {
  let n = FIRST_YEAR_COL + k + 1, s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// Section header rows have a label only; bold them with a light fill.
function styleHeaders(ws: ExcelJS.Worksheet, cells: unknown[][], headerRows: number) {
  cells.forEach((row, r) => {
    const sectionRow = r < headerRows || (row.length >= 1 && row.slice(1).every(c => c === '' || c === null || c === undefined));
    if (!sectionRow || !row[0]) return;
    const x = ws.getRow(r + 1);
    x.font = { bold: true };
    x.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } };
  });
}
