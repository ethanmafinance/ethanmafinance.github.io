// Writes the model to .xlsx with live formulas plus cached values, so the file shows numbers on open and
// recalculates when any input changes. Tabs: Dashboard (key inputs and outputs, all linked), Inputs, Model.
// Conventions from banking models: blue = hard-coded input, black = formula, green = link to another tab.
import ExcelJS from 'exceljs';
import { FIRST_YEAR_COL, colLetter, type Fmt, type Model } from './sheet.ts';

const NUMFMT: Record<Fmt, string> = {
  num: '#,##0.0;(#,##0.0);-', pct: '0.0%', x: '0.00"x"', year: '0', int: '0', flag: '0', px: '#,##0.00',
};
const NAVY = 'FF1F3C6E', SECTION = 'FFE8EEF4', INPUT_FILL = 'FFFFF7D6', BLUE = 'FF0000FF', GREEN = 'FF00703C', GREY = 'FF6A768A', LINE = 'FFD3DAE5';
const solid = (argb: string) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } }) as ExcelJS.Fill;
const bar = (c: ExcelJS.Cell) => { c.fill = solid(NAVY); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; };
const under = (c: ExcelJS.Cell) => { c.border = { bottom: { style: 'hair', color: { argb: LINE } } }; };
const print = (ws: ExcelJS.Worksheet) => { ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }; };

export async function toXlsx(m: Model): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const vals = m.sheetValues();
  const fmtOf: Record<string, Fmt | undefined> = {};
  for (const i of m.def.inputs) fmtOf[i.id] = i.fmt;
  const rowFmt: Record<number, Fmt | undefined> = {};
  const bold = new Set<number>();
  for (const it of m.def.items) if ('kind' in it) { rowFmt[m.lay.itemRow[it.id]] = it.fmt; if (it.bold) bold.add(m.lay.itemRow[it.id]); }
  const lastCol = FIRST_YEAR_COL + m.lay.years; // 1-based last used column on Model

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
  // A linked cell on the Dashboard: formula to another tab, with the cached value so it shows before recalculation.
  const link = (cell: ExcelJS.Cell, sheet: 'Inputs' | 'Model', r: number, c: number, f?: Fmt) => {
    const v = vals[sheet][r]?.[c];
    cell.value = { formula: `${sheet}!$${colLetter(c)}$${r + 1}`, result: typeof v === 'number' ? v : undefined } as any;
    cell.font = { color: { argb: GREEN } };
    if (f) cell.numFmt = NUMFMT[f];
  };

  // Dashboard first.
  const dash = wb.addWorksheet('Dashboard', { views: [{ showGridLines: false }], properties: { tabColor: { argb: NAVY } } });
  const inputs = wb.addWorksheet('Inputs', { views: [{ state: 'frozen', ySplit: 2, showGridLines: false }], properties: { tabColor: { argb: 'FF2A78D6' }, outlineLevelCol: 1 } });
  const model = wb.addWorksheet('Model', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1, showGridLines: false }], properties: { tabColor: { argb: 'FF8A95A8' } } });

  // Inputs: label, unit, value (blue on light yellow), source. Sources sit in a collapsed column group.
  const inputFmt: Record<number, Fmt | undefined> = {};
  for (const [id, r] of Object.entries(m.lay.inputRow)) inputFmt[r] = fmtOf[id];
  fill(inputs, m.lay.inputs, vals.Inputs, r => inputFmt[r], 2);
  inputs.columns = [{ width: 62 }, { width: 12 }, { width: 13 }, { width: 100, hidden: true, outlineLevel: 1 }];
  inputs.getCell('A1').value = `${m.def.title}: inputs. Blue cells are inputs; change them here and every tab recalculates. Sources: click + above the sheet to show them.`;
  for (let c = 1; c <= 4; c++) { bar(inputs.getCell(1, c)); inputs.getCell(2, c).font = { bold: true, color: { argb: GREY } }; under(inputs.getCell(2, c)); }
  for (const r of Object.values(m.lay.inputRow)) {
    const c = inputs.getCell(r + 1, 3);
    c.font = { color: { argb: BLUE } }; c.fill = solid(INPUT_FILL);
    c.border = { top: { style: 'hair', color: { argb: LINE } }, bottom: { style: 'hair', color: { argb: LINE } }, left: { style: 'hair', color: { argb: LINE } }, right: { style: 'hair', color: { argb: LINE } } };
    inputs.getCell(r + 1, 2).font = { color: { argb: GREY } };
    inputs.getCell(r + 1, 4).font = { color: { argb: GREY }, size: 9 };
  }
  m.lay.inputs.forEach((row, r) => { if (r >= 2 && row.slice(1).every(c => c === '')) for (let c = 1; c <= 3; c++) { const x = inputs.getCell(r + 1, c); x.fill = solid(SECTION); x.font = { bold: true }; } });
  print(inputs);

  // Model: year columns, section bands, bold totals.
  fill(model, m.lay.model, vals.Model, r => rowFmt[r], 2);
  model.columns = [{ width: 56 }, { width: 8 }, { width: 11 }, ...Array(m.lay.years).fill({ width: 10 })];
  for (let k = 0; k < m.lay.years; k++) model.getCell(1, FIRST_YEAR_COL + k + 1).value = { formula: `${colLetter(FIRST_YEAR_COL + k)}${m.lay.itemRow.year + 1}`, result: vals.Model[m.lay.itemRow.year]?.[FIRST_YEAR_COL + k] } as any;
  for (let c = 1; c <= lastCol; c++) bar(model.getCell(1, c));
  m.lay.model.forEach((row, r) => {
    if (r === 0) return;
    if (row.length === 1) { for (let c = 1; c <= lastCol; c++) { const x = model.getCell(r + 1, c); x.fill = solid(SECTION); x.font = { bold: true }; } return; }
    model.getCell(r + 1, 2).font = { color: { argb: GREY } };
    if (bold.has(r)) for (let c = 1; c <= lastCol; c++) { const x = model.getCell(r + 1, c); x.font = { bold: true }; x.border = { top: { style: 'thin', color: { argb: LINE } } }; }
  });
  print(model);

  // Dashboard: key assumptions (left), key outputs (right), annual summary (below). Every value links to Inputs or Model.
  const d = m.def.dash;
  dash.columns = [{ width: 2 }, { width: 60 }, ...Array(Math.max(11, m.lay.years + 2)).fill({ width: 11 })];
  dash.getCell('B2').value = m.def.title;
  dash.getCell('B2').font = { bold: true, size: 16, color: { argb: NAVY } };
  dash.getCell('B3').value = `${d?.units ?? ''}. Every figure on this tab links to the Inputs and Model tabs: change a blue cell on Inputs and it updates.`;
  dash.getCell('B3').font = { italic: true, color: { argb: GREY } };
  dash.getCell('B4').value = 'Blue = input, black = formula, green = link to another tab.';
  dash.getCell('B4').font = { size: 9, color: { argb: GREY } };
  const label = (id: string) => m.def.inputs.find(i => i.id === id)?.label;
  const item = (id: string) => m.def.items.find(it => 'kind' in it && it.id === id) as { label: string; unit?: string; fmt?: Fmt; kind: string } | undefined;
  const ins = (d?.inputs ?? []).filter(id => id in m.lay.inputRow);
  const outs = (d?.outputs ?? []).filter(id => item(id)?.kind === 'scalar');
  const top = 6;
  for (const c of [2, 3, 4]) bar(dash.getCell(top, c));
  dash.getCell(top, 2).value = 'Key assumptions';
  dash.mergeCells(top, 6, top, 10);
  bar(dash.getCell(top, 6)); bar(dash.getCell(top, 11)); bar(dash.getCell(top, 12));
  dash.getCell(top, 6).value = 'Key outputs';
  ins.forEach((id, k) => {
    const r = top + 1 + k, inp = m.def.inputs.find(i => i.id === id)!;
    dash.getCell(r, 2).value = label(id)!;
    dash.getCell(r, 3).value = inp.unit; dash.getCell(r, 3).font = { color: { argb: GREY } };
    link(dash.getCell(r, 4), 'Inputs', m.lay.inputRow[id], 2, inp.fmt);
    for (const c of [2, 3, 4]) under(dash.getCell(r, c));
  });
  outs.forEach((id, k) => {
    const r = top + 1 + k, it = item(id)!;
    dash.mergeCells(r, 6, r, 10);
    dash.getCell(r, 6).value = it.label;
    dash.getCell(r, 11).value = it.unit ?? ''; dash.getCell(r, 11).font = { color: { argb: GREY } };
    link(dash.getCell(r, 12), 'Model', m.lay.itemRow[id], 2, it.fmt);
    if (k < 3) { dash.getCell(r, 6).font = { bold: true }; dash.getCell(r, 12).font = { bold: true, color: { argb: GREEN } }; }
    for (const c of [6, 11, 12]) under(dash.getCell(r, c));
  });
  const rows = (d?.rows ?? []).filter(id => item(id)?.kind === 'row');
  const s0 = top + 2 + Math.max(ins.length, outs.length);
  if (rows.length) {
    dash.getCell(s0, 2).value = 'Annual summary';
    for (let c = 2; c <= 3 + m.lay.years; c++) bar(dash.getCell(s0, c));
    for (let k = 0; k < m.lay.years; k++) {
      const c = dash.getCell(s0, 4 + k);
      link(c, 'Model', m.lay.itemRow.year, FIRST_YEAR_COL + k, 'year');
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    }
    rows.forEach((id, j) => {
      const r = s0 + 1 + j, it = item(id)!;
      dash.getCell(r, 2).value = it.label;
      dash.getCell(r, 3).value = it.unit ?? ''; dash.getCell(r, 3).font = { color: { argb: GREY } };
      for (let k = 0; k < m.lay.years; k++) link(dash.getCell(r, 4 + k), 'Model', m.lay.itemRow[id], FIRST_YEAR_COL + k, it.fmt);
      for (let c = 2; c <= 3 + m.lay.years; c++) under(dash.getCell(r, c));
    });
  }
  print(dash);

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
