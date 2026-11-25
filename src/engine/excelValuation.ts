// Equity export extras: valuation inputs and peer data on the Inputs tab (to the right of the DCF inputs, so every input
// stays on one tab), a Comps tab (peer multiples and quartiles) and a Valuation tab (football field table, weights,
// weighted implied share price, chart data). Every number is a formula on the inputs, the Model tab's case blocks
// (dcf.ts) or the Comps tab, and the formulas reproduce valuation.ts (checked in test/excel.test.ts).
import { colLetter, type Fmt, type Model } from './sheet.ts';
import type { Fit, Method } from './fit.ts';
import type { Row } from './comps.ts';

export type ValuationExport = { peers: Row[]; basis: string; self: Row; fit: Fit; weights: Record<Method, number>; why: string; lo52?: number; hi52?: number; consDate?: string };
// st: in = blue input, head = column header, bar = navy band, bold, note = small grey text, link = green link, total = bold with a top rule.
export type XC = { v: string | number | null; f?: Fmt; st?: 'in' | 'head' | 'bar' | 'bold' | 'note' | 'link' | 'total' | 'label' };
type Grid = (XC | undefined)[][];
export const INPUT_X = 5; // the valuation block starts in column F of Inputs

export function valuationSheets(m: Model, vx: ValuationExport) {
  const I = (id: string) => `Inputs!$C$${m.lay.inputRow[id] + 1}`;
  const M = (id: string) => `Model!$C$${m.lay.itemRow[id] + 1}`;
  const H = m.def.inputs.filter(i => /^rev_h\d+$/.test(i.id)).length;
  const ccy = vx.self.currency === 'CAD' ? 'C$' : 'US$';
  const set = (g: Grid, r: number, c: number, x: XC) => { (g[r] ??= [])[c] = x; };

  // Inputs block, columns F to O.
  const inp: Grid = [];
  const X = INPUT_X;
  const vi: Record<string, string> = {};
  set(inp, 0, X, { v: 'Valuation inputs and peer data (comps and football field)', st: 'bar' });
  for (let c = X + 1; c <= X + 9; c++) set(inp, 0, c, { v: '', st: 'bar' });
  ['Valuation input', 'Unit', 'Value', 'Source'].forEach((h, k) => set(inp, 1, X + k, { v: h, st: 'head' }));
  const viRows: [string, string, string, number | string | null | undefined, Fmt | undefined, string][] = [
    ['ni', `Net income, last fiscal year (${vx.self.ticker})`, `${ccy}m`, vx.self.ni, 'num', 'SEC filing, XBRL ProfitLoss or NetIncomeLoss (as on the site)'],
    ['rev_f', 'Revenue, next twelve months (consensus)', `${ccy}m`, vx.self.rev_f ?? null, 'num', vx.self.rev_f == null ? 'no analyst consensus for the next two fiscal years: left empty, so forward multiples show n/m' : `Yahoo Finance analyst estimates${vx.consDate ? `, ${vx.consDate}` : ''}: fiscal years 1 and 2 weighted by the part of year 1 still to come`],
    ['eps_f', 'EPS, next twelve months (consensus)', ccy, vx.self.ni_f == null ? null : vx.self.ni_f / m.values.shares, 'px', vx.self.ni_f == null ? 'no analyst consensus: left empty' : `Yahoo Finance analyst estimates${vx.consDate ? `, ${vx.consDate}` : ''}, mean of analysts, weighted the same way`],
    ['lo52', '52-week low', ccy, vx.lo52, 'px', 'Yahoo Finance'],
    ['hi52', '52-week high', ccy, vx.hi52, 'px', 'Yahoo Finance'],
    ['fit', 'DCF fit (ok, caution or no)', 'text', vx.fit.verdict, undefined, vx.fit.reasons.length ? vx.fit.reasons.join(' ') : 'Operating income is positive and investment is in line with revenue.'],
    ['w_dcf_g', 'Weight: DCF, perpetuity growth', '%', vx.weights.dcf_g, 'pct', vx.why],
    ['w_dcf_x', 'Weight: DCF, exit multiple', '%', vx.weights.dcf_x, 'pct', 'set by the DCF fit, as above'],
    ['w_ev_ebitda', 'Weight: comps, EV / EBITDA', '%', vx.weights.ev_ebitda, 'pct', 'set by the DCF fit, as above'],
    ['w_pe', 'Weight: comps, P / E (forward when consensus exists)', '%', vx.weights.pe, 'pct', 'set by the DCF fit, as above'],
    ['w_ev_rev', 'Weight: comps, EV / revenue (forward when consensus exists)', '%', vx.weights.ev_rev, 'pct', 'set by the DCF fit, as above'],
    ['x_range', 'Exit multiple range when there are no peers (current multiple, plus or minus)', '%', 0.2, 'pct', 'est. illustrative, as on the site'],
    ['mark', 'Width of the current price marker on the chart (share of the price)', '%', 0.01, 'pct', 'chart formatting only'],
  ];
  viRows.forEach(([id, label, unit, value, f, src], k) => {
    const r = 2 + k;
    vi[id] = `Inputs!$${colLetter(X + 2)}$${r + 1}`;
    set(inp, r, X, { v: label, st: 'label' }); set(inp, r, X + 1, { v: unit, st: 'note' });
    set(inp, r, X + 2, { v: value ?? null, f, st: 'in' }); set(inp, r, X + 3, { v: src, st: 'note' });
  });
  const p0 = 2 + viRows.length + 1; // peer block header row
  set(inp, p0, X, { v: `Peer data: ${vx.basis}`, st: 'bar' });
  for (let c = X + 1; c <= X + 9; c++) set(inp, p0, c, { v: '', st: 'bar' });
  const PH = ['Ticker', 'Currency', 'Market cap (m)', 'Enterprise value (m)', 'Revenue (m)', 'EBITDA (m)', 'Net income (m)', 'Revenue NTM (m)', 'Net income NTM (m)', 'Fiscal year end'];
  PH.forEach((h, k) => set(inp, p0 + 1, X + k, { v: h, st: 'head' }));
  const fields: (keyof Row)[] = ['ticker', 'currency', 'mcap', 'ev', 'rev', 'ebitda', 'ni', 'rev_f', 'ni_f', 'fy'];
  const peerCell = (j: number, k: number) => `Inputs!$${colLetter(X + k)}$${p0 + 3 + j}`;
  vx.peers.forEach((p, j) => fields.forEach((fk, k) => set(inp, p0 + 2 + j, X + k, { v: (p[fk] as string | number | null | undefined) ?? null, f: k >= 2 && k <= 8 ? 'num' : undefined, st: 'in' })));
  set(inp, p0 + 2 + vx.peers.length, X, { v: "Latest close; last fiscal year; NTM = next twelve months of analyst consensus (Yahoo Finance). EV = market cap + debt - cash + non-controlling interests + preferred; EBITDA = EBIT + D&A. Millions, in each company's reporting currency (multiples are currency-free). Source: the site's comps file, built daily from SEC filings and Yahoo Finance closes.", st: 'note' });

  // Comps tab.
  const cm: Grid = [];
  const CH = ['Company', 'Market cap', 'Enterprise value', 'Revenue', 'EBITDA', 'Net income', 'Revenue NTM', 'Net income NTM', 'EV / EBITDA', 'EV / revenue', 'EV / revenue NTM', 'P / E', 'P / E NTM', 'Fiscal year end'];
  set(cm, 0, 0, { v: `${vx.self.ticker} trading comparables`, st: 'bar' });
  for (let c = 1; c < CH.length; c++) set(cm, 0, c, { v: '', st: 'bar' });
  set(cm, 1, 0, { v: `Peers: ${vx.basis}. Millions in each company's currency; multiples n/m where the denominator is zero or negative or the multiple is above 100x. Quartiles need 3 or more meaningful peer multiples.`, st: 'note' });
  CH.forEach((h, k) => set(cm, 3, k, { v: h, st: 'head' }));
  const mult = (num: string, den: string) => `=IF(${den}>0,IF(AND(${num}/${den}>0,${num}/${den}<=100),${num}/${den},"n/m"),"n/m")`;
  const rowCells = (r: number, cells: string[], st: XC['st']) => {
    cells.forEach((v, k) => set(cm, r, k + 1, { v, f: 'num', st }));
    const R = r + 1;
    [[`C${R}`, `E${R}`], [`C${R}`, `D${R}`], [`C${R}`, `G${R}`], [`B${R}`, `F${R}`], [`B${R}`, `H${R}`]].forEach(([n, d], k) => set(cm, r, 8 + k, { v: mult(n, d), f: 'x', st: st === 'total' ? 'total' : undefined }));
  };
  set(cm, 4, 0, { v: `${vx.self.ticker} (subject, not in the quartiles)`, st: 'bold' });
  rowCells(4, [`=${I('price')}*${I('shares')}`, `=B5+${M('claims')}`, `=${I(`rev_h${H}`)}`, `=${I(`ebit_h${H}`)}+${I(`da_h${H}`)}`, `=${vi.ni}`, `=${vi.rev_f}`, `=${vi.eps_f}*${I('shares')}`], 'bold');
  set(cm, 4, 13, { v: vx.self.fy, st: 'bold' });
  const first = 5, last = 5 + vx.peers.length - 1;
  vx.peers.forEach((_, j) => {
    const r = first + j;
    set(cm, r, 0, { v: `=${peerCell(j, 0)}`, st: 'link' });
    rowCells(r, [2, 3, 4, 5, 6, 7, 8].map(k => `=${peerCell(j, k)}`), 'link');
    set(cm, r, 13, { v: `=${peerCell(j, 9)}`, st: 'link' });
  });
  const qr = last + 2; // quartile rows
  const qRow: Record<'q1' | 'q2' | 'q3' | 'n', number> = { q1: qr, q2: qr + 1, q3: qr + 2, n: qr + 3 };
  ([['q1', 'Peer 25th percentile', 1], ['q2', 'Peer median', 2], ['q3', 'Peer 75th percentile', 3], ['n', 'Peers with a meaningful multiple', 0]] as const).forEach(([key, label, qn]) => {
    const r = qRow[key];
    set(cm, r, 0, { v: label, st: key === 'q2' ? 'total' : 'bold' });
    for (let k = 8; k <= 12; k++) {
      const L = colLetter(k), rng = vx.peers.length ? `${L}${first + 1}:${L}${last + 1}` : `${L}5:${L}5`;
      set(cm, r, k, { v: !vx.peers.length ? (key === 'n' ? 0 : 'n/m') : key === 'n' ? `=COUNT(${rng})` : `=IF(COUNT(${rng})>=3,QUARTILE.INC(${rng},${qn}),"n/m")`, f: key === 'n' ? 'int' : 'x', st: key === 'q2' ? 'total' : 'bold' });
    }
  });
  const Q = (col: number, k: 0 | 1 | 2) => `Comps!$${colLetter(col)}$${qRow[(['q1', 'q2', 'q3'] as const)[k]] + 1}`;
  const C_EBITDA = 8, C_REV = 9, C_REVF = 10, C_PE = 11, C_PEF = 12;

  // Valuation tab.
  const va: Grid = [];
  const VH = ['Method (per share)', 'Bear / low', 'Base / mid', 'Bull / high', 'Default weight', 'Usable (1 = yes)', 'Weight', 'Bear x weight', 'Base x weight', 'Bull x weight', 'Basis'];
  set(va, 0, 0, { v: `${vx.self.ticker} valuation summary and football field`, st: 'bar' });
  for (let c = 1; c < VH.length; c++) set(va, 0, c, { v: '', st: 'bar' });
  set(va, 1, 0, { v: `${ccy} per share. DCF rows use the bear, base and bull case blocks on the Model tab; comps rows apply the peer 25th percentile, median and 75th percentile multiples (Comps tab) through the DCF's equity bridge. Weights come from the DCF fit on the Inputs tab; a method with no meaningful value drops out and the rest are scaled to 100%.`, st: 'note' });
  VH.forEach((h, k) => set(va, 3, k, { v: h, st: 'head' }));
  const share = `${I('shares')}`, claims = M('claims');
  const cases = ['_bear', '_base', '_bull'] as const;
  type MRow = { label: string; cells: string[]; w: string; usable: string; basis: string };
  const S = (r: number) => r + 1; // 1-based row of grid row r
  const R0 = 4; // first method row
  const rowOf = (k: number) => S(R0 + k);
  const exitM = (k: 0 | 1 | 2) => `IF(ISNUMBER(${Q(C_EBITDA, k)}),${Q(C_EBITDA, k)},${I('exit_mult')}*(1+${k - 1}*${vi.x_range}))`;
  const comp = (col: number, metric: string, ev: boolean) => ([0, 1, 2] as const).map(k => `=IF(AND(ISNUMBER(${Q(col, k)}),${metric}>0),(${Q(col, k)}*${metric}${ev ? `-${claims}` : ''})/${share},"n/m")`);
  const usable = (k: number) => `=IF(AND(ISNUMBER(C${rowOf(k)}),C${rowOf(k)}>0),1,0)`;
  const methods: MRow[] = [
    { label: 'DCF, perpetuity growth', cells: cases.map(c => `=${M('ps_g' + c)}`), w: `=${vi.w_dcf_g}`, usable: `=IF(AND(${vi.fit}<>"no",ISNUMBER(C${rowOf(0)}),C${rowOf(0)}>0),1,0)`, basis: 'Bear, base and bull case blocks (Model tab)' },
    { label: 'DCF, exit multiple', cells: ([0, 1, 2] as const).map(k => `=(${M('eq_pre_tv' + cases[k])}+${exitM(k)}*${M('ebitda_n' + cases[k])}*${M('tv_df')})/${share}`), w: `=${vi.w_dcf_x}`,
      usable: `=IF(AND(${vi.fit}<>"no",ISNUMBER(${Q(C_EBITDA, 1)}),C${rowOf(1)}>0),1,0)`, basis: 'Exit EV / EBITDA at the peer 25th, median and 75th percentile with the bear, base and bull cases; without 3 peer multiples, the current multiple plus or minus the range on Inputs (then not weighted)' },
    { label: 'Comps, EV / EBITDA', cells: comp(C_EBITDA, 'Comps!$E$5', true), w: `=${vi.w_ev_ebitda}`, usable: usable(2), basis: 'Peer quartiles x last-year EBITDA, less debt and other claims' },
    { label: 'Comps, forward P / E', cells: comp(C_PEF, 'Comps!$H$5', false), w: `=IF(F${rowOf(3)}=1,${vi.w_pe},0)`, usable: usable(3), basis: 'Peer quartiles x next twelve months consensus EPS x shares; takes the P / E weight when it has a value' },
    { label: 'Comps, P / E', cells: comp(C_PE, 'Comps!$F$5', false), w: `=IF(F${rowOf(3)}=1,0,${vi.w_pe})`, usable: usable(4), basis: 'Peer quartiles x last-year net income' },
    { label: 'Comps, forward EV / revenue', cells: comp(C_REVF, 'Comps!$G$5', true), w: `=IF(F${rowOf(5)}=1,${vi.w_ev_rev},0)`, usable: usable(5), basis: 'Peer quartiles x next twelve months consensus revenue; takes the EV / revenue weight when it has a value' },
    { label: 'Comps, EV / revenue', cells: comp(C_REV, 'Comps!$D$5', true), w: `=IF(F${rowOf(5)}=1,0,${vi.w_ev_rev})`, usable: usable(6), basis: 'Peer quartiles x last-year revenue' },
  ];
  const n = methods.length, wr = `E${rowOf(0)}:E${rowOf(n - 1)}`, ur = `F${rowOf(0)}:F${rowOf(n - 1)}`;
  methods.forEach((mr, k) => {
    const r = R0 + k, Rr = S(r);
    set(va, r, 0, { v: mr.label, st: 'label' });
    mr.cells.forEach((v, j) => set(va, r, 1 + j, { v, f: 'px' }));
    set(va, r, 4, { v: mr.w, f: 'pct' }); set(va, r, 5, { v: mr.usable, f: 'int' });
    // Fallback when no earnings-based method has a value: forward EV / revenue, else trailing EV / revenue, at 100%.
    const fb = k === 5 ? `F${Rr}` : k === 6 ? `IF(F${rowOf(5)}=1,0,F${Rr})` : '0';
    set(va, r, 6, { v: `=IF(SUMPRODUCT(${wr},${ur})>0,E${Rr}*F${Rr}/SUMPRODUCT(${wr},${ur}),${fb})`, f: 'pct' });
    ['B', 'C', 'D'].forEach((L, j) => set(va, r, 7 + j, { v: `=IF(G${Rr}>0,G${Rr}*MAX(0,${L}${Rr}),0)`, f: 'px' }));
    set(va, r, 10, { v: mr.basis, st: 'note' });
  });
  const r52 = R0 + n, has52 = !!(vx.lo52 && vx.hi52);
  set(va, r52, 0, { v: '52-week trading range (not weighted)', st: 'label' });
  if (has52) { set(va, r52, 1, { v: `=${vi.lo52}`, f: 'px' }); set(va, r52, 2, { v: `=${I('price')}`, f: 'px' }); set(va, r52, 3, { v: `=${vi.hi52}`, f: 'px' }); }
  set(va, r52, 10, { v: "Low, latest close, high: the market's own price, the thing being tested", st: 'note' });
  const rImp = r52 + 1, gsum = `SUM(G${rowOf(0)}:G${rowOf(n - 1)})`;
  set(va, rImp, 0, { v: 'Implied share price (weighted)', st: 'total' });
  ['H', 'I', 'J'].forEach((L, j) => set(va, rImp, 1 + j, { v: `=IF(${gsum}>0,SUM(${L}${rowOf(0)}:${L}${rowOf(n - 1)}),"n/m")`, f: 'px', st: 'total' }));
  set(va, rImp, 6, { v: `=${gsum}`, f: 'pct', st: 'total' });
  const rUp = rImp + 1, rCase = rImp + 2;
  set(va, rUp, 0, { v: 'Upside to the current share price', st: 'bold' });
  ['B', 'C', 'D'].forEach((L, j) => set(va, rUp, 1 + j, { v: `=IF(ISNUMBER(${L}${S(rImp)}),${L}${S(rImp)}/${I('price')}-1,"n/m")`, f: 'pct', st: 'bold' }));
  set(va, rCase, 0, { v: 'Implied share price, case selected on Inputs', st: 'bold' });
  set(va, rCase, 2, { v: `=INDEX(B${S(rImp)}:D${S(rImp)},1,${I('case_now')}+2)`, f: 'px', st: 'bold' });
  set(va, rCase, 3, { v: `=IF(ISNUMBER(C${S(rCase)}),C${S(rCase)}/${I('price')}-1,"n/m")`, f: 'pct', st: 'bold' });
  set(va, rCase, 10, { v: 'upside in column D', st: 'note' });

  // Chart data: one bar per method from the low to the high value (methods with no value, and the DCF when it does not
  // fit, show no bar), plus a thin bar at the current price.
  const chartTop = rCase + 2, chartRows = 22, cd = chartTop + chartRows + 1;
  set(va, cd, 0, { v: 'Football field chart data', st: 'head' }); set(va, cd, 1, { v: 'Bar start', st: 'head' }); set(va, cd, 2, { v: 'Bar length', st: 'head' });
  const labels = [...methods.map(x => x.label), '52-week trading range', 'Current share price'];
  labels.forEach((label, k) => {
    const r = cd + 1 + k, Rr = S(r);
    set(va, r, 0, { v: label, st: 'label' });
    if (k === labels.length - 1) {
      set(va, r, 1, { v: `=${I('price')}*(1-${vi.mark}/2)`, f: 'px' }); set(va, r, 2, { v: `=${I('price')}*${vi.mark}`, f: 'px' });
      return;
    }
    const src = S(R0 + k), shown = k < 2 ? `AND(${vi.fit}<>"no",ISNUMBER(B${src}),ISNUMBER(D${src}))` : `AND(ISNUMBER(B${src}),ISNUMBER(D${src}))`;
    set(va, r, 1, { v: `=IF(${shown},MAX(0,MIN(B${src},D${src})),0)`, f: 'px' });
    set(va, r, 2, { v: `=IF(${shown},MAX(0,MAX(B${src},D${src}))-B${Rr},0)`, f: 'px' });
  });
  const chart = { title: `${vx.self.ticker}: implied share price by method (${ccy})`, top: chartTop, rows: chartRows, cats: `Valuation!$A$${S(cd + 1)}:$A$${S(cd + labels.length)}`,
    start: `Valuation!$B$${S(cd + 1)}:$B$${S(cd + labels.length)}`, len: `Valuation!$C$${S(cd + 1)}:$C$${S(cd + labels.length)}`, first: cd + 1, n: labels.length };

  const dashOuts = [
    { label: 'Implied share price, weighted DCF and comps (case selected on Inputs)', unit: ccy, sheet: 'Valuation', r: rCase, c: 2, fmt: 'px' as Fmt },
    { label: 'Upside to the current share price (weighted)', unit: '%', sheet: 'Valuation', r: rCase, c: 3, fmt: 'pct' as Fmt },
    { label: 'Implied share price: bear, base, bull', unit: ccy, sheet: 'Valuation', r: rImp, c: [1, 2, 3], fmt: 'px' as Fmt },
  ];
  return { inp, comps: cm, val: va, chart, dashOuts, rows: { methods: R0, imp: rImp, case: rCase, q: qRow } };
}
