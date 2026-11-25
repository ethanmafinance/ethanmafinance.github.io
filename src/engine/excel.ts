// Writes the model to .xlsx with live formulas plus cached values, so the file shows numbers on open and
// recalculates when any input changes. Tabs: Dashboard (key inputs and outputs, all linked), Inputs, Model.
// Conventions from banking models: blue = hard-coded input, black = formula, green = link to another tab.
import ExcelJS from 'exceljs';
import HyperFormulaPkg from 'hyperformula';
import { FIRST_YEAR_COL, colLetter, type Fmt, type Model } from './sheet.ts';
import { valuationSheets, type ValuationExport, type XC } from './excelValuation.ts';
export type { ValuationExport } from './excelValuation.ts';
const { HyperFormula } = HyperFormulaPkg as any;

const NUMFMT: Record<Fmt, string> = {
  num: '#,##0.0;(#,##0.0);-', pct: '0.0%', x: '0.00"x"', year: '0', int: '0', flag: '0', px: '#,##0.00',
};
const NAVY = 'FF1F3C6E', SECTION = 'FFE8EEF4', INPUT_FILL = 'FFFFF7D6', BLUE = 'FF0000FF', GREEN = 'FF00703C', GREY = 'FF6A768A', LINE = 'FFD3DAE5';
const solid = (argb: string) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } }) as ExcelJS.Fill;
const bar = (c: ExcelJS.Cell) => { c.fill = solid(NAVY); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; };
const under = (c: ExcelJS.Cell) => { c.border = { bottom: { style: 'hair', color: { argb: LINE } } }; };
const print = (ws: ExcelJS.Worksheet) => { ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }; };

export async function toXlsx(m: Model, vx?: ValuationExport): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  // Equity models also get the comps and football field (excelValuation.ts): the extra cells are added to the grids and
  // the whole workbook is recalculated once, so every cached value comes from the same formulas Excel will run.
  const xv = vx ? valuationSheets(m, vx) : undefined;
  let vals: Record<string, unknown[][]> = m.sheetValues();
  if (xv) {
    const raw = (g: (XC | undefined)[][]) => Array.from(g, row => Array.from(row ?? [], c => c?.v ?? null));
    const inputs: unknown[][] = m.lay.inputs.map(r => [...r]);
    xv.inp.forEach((row, r) => row?.forEach((c, k) => { if (c) { inputs[r] ??= []; while (inputs[r].length < k) inputs[r].push(null); inputs[r][k] = c.v; } }));
    const hf = HyperFormula.buildFromSheets({ Inputs: inputs.map(r => Array.from(r ?? [], v => v ?? null)), Model: m.lay.model, Comps: raw(xv.comps), Valuation: raw(xv.val) }, { licenseKey: 'gpl-v3' });
    vals = Object.fromEntries(['Inputs', 'Model', 'Comps', 'Valuation'].map(n => [n, hf.getSheetValues(hf.getSheetId(n))]));
    hf.destroy();
  }
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
  const link = (cell: ExcelJS.Cell, sheet: string, r: number, c: number, f?: Fmt) => {
    const v = vals[sheet][r]?.[c];
    cell.value = { formula: `${sheet}!$${colLetter(c)}$${r + 1}`, result: typeof v === 'number' ? v : undefined } as any;
    cell.font = { color: { argb: GREEN } };
    if (f) cell.numFmt = NUMFMT[f];
  };

  // Dashboard first.
  const dash = wb.addWorksheet('Dashboard', { views: [{ showGridLines: false }], properties: { tabColor: { argb: NAVY } } });
  const inputs = wb.addWorksheet('Inputs', { views: [{ state: 'frozen', ySplit: 2, showGridLines: false }], properties: { tabColor: { argb: 'FF2A78D6' }, outlineLevelCol: 1 } });
  const model = wb.addWorksheet('Model', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1, showGridLines: false }], properties: { tabColor: { argb: 'FF8A95A8' } } });
  const compsWs = xv && wb.addWorksheet('Comps', { views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }], properties: { tabColor: { argb: 'FF2E8B57' } } });
  const valWs = xv && wb.addWorksheet('Valuation', { views: [{ showGridLines: false }], properties: { tabColor: { argb: 'FF2E8B57' } } });

  // Inputs: label, unit, value (blue on light yellow), source. Sources sit in a collapsed column group.
  const inputFmt: Record<number, Fmt | undefined> = {};
  for (const [id, r] of Object.entries(m.lay.inputRow)) inputFmt[r] = fmtOf[id];
  fill(inputs, m.lay.inputs, vals.Inputs, r => inputFmt[r], 2);
  inputs.columns = [{ width: 62 }, { width: 12 }, { width: 13 }, { width: 100, hidden: true, outlineLevel: 1 }, ...(xv ? [{ width: 3 }, { width: 58 }, { width: 10 }, ...Array(8).fill({ width: 14 })] : [])];
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
  if (xv) writeX(inputs, xv.inp, vals.Inputs);
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

  if (xv && compsWs && valWs) {
    writeX(compsWs, xv.comps, vals.Comps);
    compsWs.columns = [{ width: 34 }, ...Array(7).fill({ width: 13 }), ...Array(5).fill({ width: 11 }), { width: 13 }];
    writeX(valWs, xv.val, vals.Valuation);
    valWs.columns = [{ width: 40 }, ...Array(3).fill({ width: 12 }), { width: 10 }, { width: 10 }, { width: 9 }, ...Array(3).fill({ width: 11 }), { width: 90 }];
    print(compsWs); print(valWs);
  }

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
  const xOuts = xv?.dashOuts ?? [];
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
  xOuts.forEach((o, k) => {
    const r = top + 1 + k;
    dash.mergeCells(r, 6, r, typeof o.c === 'number' ? 10 : 8);
    dash.getCell(r, 6).value = o.label; dash.getCell(r, 6).font = { bold: true };
    if (typeof o.c === 'number') { dash.getCell(r, 11).value = o.unit; dash.getCell(r, 11).font = { color: { argb: GREY } }; link(dash.getCell(r, 12), o.sheet, o.r, o.c, o.fmt); dash.getCell(r, 12).font = { bold: true, color: { argb: GREEN } }; }
    else o.c.forEach((c, j) => { link(dash.getCell(r, 9 + j), o.sheet, o.r, c, o.fmt); dash.getCell(r, 9 + j).font = { bold: true, color: { argb: GREEN } }; });
    for (const c of [6, 9, 10, 11, 12]) under(dash.getCell(r, c));
  });
  outs.forEach((id, k0) => {
    const k = k0 + xOuts.length, r = top + 1 + k, it = item(id)!;
    dash.mergeCells(r, 6, r, 10);
    dash.getCell(r, 6).value = it.label;
    dash.getCell(r, 11).value = it.unit ?? ''; dash.getCell(r, 11).font = { color: { argb: GREY } };
    link(dash.getCell(r, 12), 'Model', m.lay.itemRow[id], 2, it.fmt);
    if (k < 3 && !xOuts.length) { dash.getCell(r, 6).font = { bold: true }; dash.getCell(r, 12).font = { bold: true, color: { argb: GREEN } }; }
    for (const c of [6, 11, 12]) under(dash.getCell(r, c));
  });
  const rows = (d?.rows ?? []).filter(id => item(id)?.kind === 'row');
  const s0 = top + 2 + Math.max(ins.length, outs.length + xOuts.length);
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

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return xv && valWs ? addChart(buf, valWs.id, xv.chart, vals.Valuation) : buf;

  // Extra cells with their styles; formulas carry the recalculated value so the file shows numbers before Excel recalculates.
  function writeX(ws: ExcelJS.Worksheet, grid: (XC | undefined)[][], values: unknown[][]) {
    grid.forEach((row, r) => row?.forEach((x, k) => {
      if (!x) return;
      const cell = ws.getCell(r + 1, k + 1), v = values[r]?.[k];
      if (typeof x.v === 'string' && x.v.startsWith('=')) cell.value = { formula: x.v.slice(1), result: typeof v === 'number' || typeof v === 'string' ? v : undefined } as any;
      else if (x.v !== null) cell.value = x.v;
      if (x.f) cell.numFmt = NUMFMT[x.f];
      if (x.st === 'bar') bar(cell);
      else if (x.st === 'head') { cell.font = { bold: true, color: { argb: GREY } }; under(cell); }
      else if (x.st === 'in') { cell.font = { color: { argb: BLUE } }; cell.fill = solid(INPUT_FILL); under(cell); }
      else if (x.st === 'link') cell.font = { color: { argb: GREEN } };
      else if (x.st === 'bold') cell.font = { bold: true };
      else if (x.st === 'total') { cell.font = { bold: true }; cell.border = { top: { style: 'thin', color: { argb: NAVY } } }; cell.fill = solid(SECTION); }
      else if (x.st === 'note') cell.font = { color: { argb: GREY }, size: 9 };
    }));
  }
}

// Football field: an XY chart written into the file's XML, because ExcelJS writes no charts. Each method is a thick
// horizontal line from its low to its high value, named by a label point at x = 0; the current price is a solid vertical
// line and the weighted implied price a dotted one, so all share one price axis. Every series points at the chart data on
// the Valuation tab, so Excel redraws it when an input changes.
type ChartSpec = { title: string; top: number; rows: number; first: number; n: number; price: number; implied: number };
async function addChart(buf: ArrayBuffer, sheetId: number, ch: ChartSpec, values: unknown[][]) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf, { createFolders: false });
  const put = (path: string, data: string) => zip.file(path, data, { createFolders: false });
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ref = (r: number, c0: number, c1 = c0) => `Valuation!$${colLetter(c0)}$${r + 1}${c1 > c0 ? `:$${colLetter(c1)}$${r + 1}` : ''}`;
  // Cached copies of the cells (Excel shows them until it recalculates).
  const num = (r: number, c0: number, c1: number) => {
    const pts = Array.from({ length: c1 - c0 + 1 }, (_, k) => values[r]?.[c0 + k]).map((v, k) => (typeof v === 'number' ? `<c:pt idx="${k}"><c:v>${v}</c:v></c:pt>` : '')).join('');
    return `<c:numRef><c:f>${ref(r, c0, c1)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${c1 - c0 + 1}"/>${pts}</c:numCache></c:numRef>`;
  };
  const name = (r: number) => `<c:tx><c:strRef><c:f>${ref(r, 0)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(String(values[r]?.[0] ?? ''))}</c:v></c:pt></c:strCache></c:strRef></c:tx>`;
  const txt = (sz: number, color = '404040', b = 0) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${b}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
  const flags = (ser: 0 | 1) => `<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="${ser}"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>`;
  const noMarker = '<c:marker><c:symbol val="none"/></c:marker>';
  const ln = (w: number, color: string, extra = '') => `<c:spPr><a:ln w="${w}" cap="flat"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${extra}</a:ln></c:spPr>`;
  let idx = 0;
  const ser = (body: string) => `<c:ser><c:idx val="${idx}"/><c:order val="${idx++}"/>${body}<c:smooth val="0"/></c:ser>`;
  const series: string[] = [];
  for (let k = 0; k < ch.n; k++) {
    const r = ch.first + k, color = k < 2 ? '1F3C6E' : k === ch.n - 1 ? '9AA5B5' : '5B84C4';
    // the bar: low to high at height k + 1
    series.push(ser(`${name(r)}${ln(177800, color)}${noMarker}<c:xVal>${num(r, 2, 3)}</c:xVal><c:yVal>${num(r, 5, 6)}</c:yVal>`));
    // its name, as a label left of a point at x = 0 (one point, so no line is drawn)
    series.push(ser(`${name(r)}<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${noMarker}<c:dLbls>${txt(900)}<c:dLblPos val="l"/>${flags(1)}</c:dLbls><c:xVal>${num(r, 1, 1)}</c:xVal><c:yVal>${num(r, 4, 4)}</c:yVal>`));
  }
  const first = idx;
  series.push(ser(`${name(ch.price)}${ln(28575, 'A8354F')}${noMarker}<c:xVal>${num(ch.price, 2, 3)}</c:xVal><c:yVal>${num(ch.price, 5, 6)}</c:yVal>`));
  series.push(ser(`${name(ch.implied)}${ln(28575, '1F3C6E', '<a:prstDash val="sysDot"/>').replace('cap="flat"', 'cap="rnd"')}${noMarker}<c:xVal>${num(ch.implied, 2, 3)}</c:xVal><c:yVal>${num(ch.implied, 5, 6)}</c:yVal>`));
  // Legend: only the two price lines (the bars are named on the chart).
  const legend = '<c:legend><c:legendPos val="t"/>' + Array.from({ length: first }, (_, k) => `<c:legendEntry><c:idx val="${k}"/><c:delete val="1"/></c:legendEntry>`).join('') + `<c:overlay val="0"/>${txt(900)}</c:legend>`;
  const chartXml = HEAD + `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}">`
    + '<c:roundedCorners val="0"/><c:chart>'
    + `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>${esc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
    + '<c:autoTitleDeleted val="0"/><c:plotArea>'
    // room on the left for the method names
    + '<c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="0.25"/><c:y val="0.16"/><c:w val="0.72"/><c:h val="0.72"/></c:manualLayout></c:layout>'
    + `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series.join('')}<c:axId val="50010"/><c:axId val="50020"/></c:scatterChart>`
    // price axis from zero (bars are floored at zero), across the bottom
    + `<c:valAx><c:axId val="50010"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${txt(900)}<c:crossAx val="50020"/><c:crosses val="max"/><c:crossBetween val="midCat"/></c:valAx>`
    // row axis, hidden: row 1 at the top
    + `<c:valAx><c:axId val="50020"/><c:scaling><c:orientation val="maxMin"/><c:max val="${ch.n + 1}"/><c:min val="0"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="none"/><c:crossAx val="50010"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`
    + `</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
    + '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>';
  const drawingXml = HEAD + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.top}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.top + ch.rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
    + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Football field"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${REL}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame>`
    + '<xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';
  put('xl/charts/chart1.xml', chartXml);
  put('xl/drawings/drawing1.xml', drawingXml);
  put('xl/drawings/_rels/drawing1.xml.rels', HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/chart" Target="../charts/chart1.xml"/></Relationships>`);
  const sheetPath = `xl/worksheets/sheet${sheetId}.xml`, relPath = `xl/worksheets/_rels/sheet${sheetId}.xml.rels`;
  let sheet = await zip.file(sheetPath)!.async('string');
  const rels = (await zip.file(relPath)?.async('string')) ?? HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  put(relPath, rels.replace('</Relationships>', `<Relationship Id="rIdFootballField" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`));
  const root = sheet.slice(sheet.indexOf('<worksheet'), sheet.indexOf('>', sheet.indexOf('<worksheet')));
  if (!root.includes('xmlns:r=')) sheet = sheet.replace('<worksheet', `<worksheet xmlns:r="${REL}"`);
  // The drawing element goes after page setup and before any legacy drawing, table parts or extensions (schema order).
  const at = ['<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>']
    .map(t => sheet.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0];
  put(sheetPath, sheet.slice(0, at) + '<drawing r:id="rIdFootballField"/>' + sheet.slice(at));
  const ct = await zip.file('[Content_Types].xml')!.async('string');
  put('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>'));
  for (const n of Object.keys(zip.files)) if (zip.files[n].dir) delete zip.files[n]; // folder entries are not package parts
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
