// One model definition drives both the website and the Excel export.
// Every number on the site is computed by HyperFormula from the same formulas
// that are written into the downloaded workbook, so the two cannot disagree.
import HyperFormulaPkg from 'hyperformula';
const { HyperFormula } = HyperFormulaPkg as any;

export type Source = { title: string; url?: string; page?: string; date?: string; note?: string; est?: boolean };
export type Fmt = 'num' | 'pct' | 'x' | 'year' | 'int' | 'flag' | 'px';

export type Input = {
  id: string; label: string; unit: string; value: number; fmt?: Fmt;
  group: string; source?: Source; timing?: boolean; min?: number; max?: number; step?: number;
};

export type Cx = {
  i: (id: string) => string;          // absolute input cell
  r: (id: string) => string;          // same year column
  p: (id: string) => string;          // previous year column, '0' in the first year
  n: (id: string) => string;          // next year column, '0' in the last year
  row: (id: string) => string;        // whole year range of a row
  s: (id: string) => string;          // scalar cell
  first: boolean; last: boolean; k: number;
};

export type Row = { id: string; label: string; unit?: string; fmt?: Fmt; f: (x: Cx) => string | number; fb?: (x: Cx) => string | number; role?: 'revenue' | 'opex' | 'maint'; bold?: boolean };
export type Scalar = { id: string; label: string; unit?: string; fmt?: Fmt; f: (x: Cx) => string; bold?: boolean };
export type Item = { section: string } | ({ kind: 'row' } & Row) | ({ kind: 'scalar' } & Scalar);

export type ModelDef = { title: string; inputs: Input[]; items: Item[]; columns: (v: Record<string, number>) => number };

export const FIRST_YEAR_COL = 3; // column D
export const INPUT_HEADER_ROWS = 2;

export const colLetter = (n: number): string => {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export type Layout = {
  inputs: (string | number)[][];
  model: (string | number | null)[][];
  inputRow: Record<string, number>;   // 0-based row on Inputs
  itemRow: Record<string, number>;    // 0-based row on Model
  years: number;
};

export function layout(def: ModelDef, values: Record<string, number>): Layout {
  const years = def.columns(values);
  const inputRow: Record<string, number> = {};
  const inputs: (string | number)[][] = [[def.title + ': inputs', '', '', ''], ['Assumption', 'Unit', 'Value', 'Source']];
  let group = '';
  for (const inp of def.inputs) {
    if (inp.group !== group) { group = inp.group; inputs.push([group, '', '', '']); }
    inputRow[inp.id] = inputs.length;
    inputs.push([inp.label, inp.unit, values[inp.id] ?? inp.value, sourceText(inp.source)]);
  }

  const itemRow: Record<string, number> = {};
  const header: (string | number | null)[] = [def.title + ': model', 'Unit', 'Value', ...Array(years).fill(null)];
  const model: (string | number | null)[][] = [header];
  const rowsAt: { item: Item; r: number }[] = [];
  for (const item of def.items) {
    const r = model.length;
    if ('kind' in item) itemRow[item.id] = r;
    rowsAt.push({ item, r });
    model.push([]);
  }

  const abs = (col: number, r: number) => `$${colLetter(col)}$${r + 1}`;
  const need = (map: Record<string, number>, id: string, what: string) => {
    if (!(id in map)) throw new Error(`Unknown ${what} "${id}"`);
    return map[id];
  };
  const cx = (k: number): Cx => ({
    i: id => `Inputs!${abs(2, need(inputRow, id, 'input'))}`,
    r: id => `${colLetter(FIRST_YEAR_COL + k)}${need(itemRow, id, 'row') + 1}`,
    p: id => (k === 0 ? '0' : `${colLetter(FIRST_YEAR_COL + k - 1)}${need(itemRow, id, 'row') + 1}`),
    n: id => (k === years - 1 ? '0' : `${colLetter(FIRST_YEAR_COL + k + 1)}${need(itemRow, id, 'row') + 1}`),
    row: id => { const r = need(itemRow, id, 'row'); return `${abs(FIRST_YEAR_COL, r)}:${abs(FIRST_YEAR_COL + years - 1, r)}`; },
    s: id => abs(2, need(itemRow, id, 'scalar')),
    first: k === 0, last: k === years - 1, k,
  });

  for (const { item, r } of rowsAt) {
    if (!('kind' in item)) { model[r] = [item.section]; continue; }
    if (item.kind === 'scalar') { model[r] = [item.label, item.unit ?? '', item.f(cx(0))]; continue; }
    const cells: (string | number | null)[] = [item.label, item.unit ?? '', null];
    for (let k = 0; k < years; k++) cells.push(item.f(cx(k)));
    model[r] = cells;
  }
  return { inputs, model, inputRow, itemRow, years };
}

export const sourceText = (s?: Source) =>
  !s ? '' : [s.est ? 'est.' : '', s.title, s.page && `p. ${s.page}`, s.date, s.note, s.url].filter(Boolean).join(' | ');

export type Results = { years: number; row: Record<string, number[]>; scalar: Record<string, number> };

export class Model {
  hf: any;
  lay!: Layout;
  values: Record<string, number>;
  def: ModelDef;
  constructor(def: ModelDef, values: Record<string, number> = {}) {
    this.def = def;
    this.values = Object.fromEntries(def.inputs.map(i => [i.id, values[i.id] ?? i.value]));
    this.build();
  }
  private build() {
    this.hf?.destroy();
    this.lay = layout(this.def, this.values);
    this.hf = HyperFormula.buildFromSheets({ Inputs: this.lay.inputs, Model: this.lay.model }, { licenseKey: 'gpl-v3' });
  }
  set(all: Record<string, number>) {
    const changes = Object.fromEntries(Object.entries(all).filter(([id, v]) => this.values[id] !== v));
    const rebuild = Object.keys(changes).some(id => this.def.inputs.find(i => i.id === id)?.timing);
    Object.assign(this.values, changes);
    if (rebuild) return this.build();
    const sheet = this.hf.getSheetId('Inputs')!;
    this.hf.batch(() => {
      for (const [id, v] of Object.entries(changes)) this.hf.setCellContents({ sheet, row: this.lay.inputRow[id], col: 2 }, v);
    });
  }
  results(): Results {
    const vals = this.hf.getSheetValues(this.hf.getSheetId('Model')!);
    const num = (v: unknown) => (typeof v === 'number' ? v : NaN);
    const row: Record<string, number[]> = {}, scalar: Record<string, number> = {};
    for (const item of this.def.items) {
      if (!('kind' in item)) continue;
      const cells = vals[this.lay.itemRow[item.id]];
      if (item.kind === 'scalar') scalar[item.id] = num(cells[2]);
      else row[item.id] = Array.from({ length: this.lay.years }, (_, k) => num(cells[FIRST_YEAR_COL + k]));
    }
    return { years: this.lay.years, row, scalar };
  }
  /** Values for the export: every cell's computed value, by sheet. */
  sheetValues() {
    return { Inputs: this.hf.getSheetValues(this.hf.getSheetId('Inputs')!), Model: this.hf.getSheetValues(this.hf.getSheetId('Model')!) };
  }
}
