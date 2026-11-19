// Engine B: regulated utility (electricity distribution or transmission, gas distribution).
// The regulator sets revenue each rebasing year equal to the cost of service:
//   service revenue requirement = OM&A + depreciation + deemed interest + return on equity + PILs (tax)
// where the return is earned on rate base (average net fixed assets plus a working capital allowance) at
// a deemed capital structure. Between rebasings, revenue follows an index less a stretch factor.
// The investor view: earnings are the allowed return on deemed equity less any stretch shortfall the
// utility does not offset with savings; equity funds its share of rate base growth (deemed leverage is
// kept), so free cash flow to equity = net income - equity share x change in rate base.
// Column 0 is the close of the year before the plan (entry); columns 1..N are the plan and projection years.
import type { Input, Item, ModelDef } from './sheet.ts';
import { projectFinance, type Module } from './projectFinance.ts';
import { lease } from './lease.ts';

const g = (group: string, list: Omit<Input, 'group'>[]): Input[] => list.map(i => ({ ...i, group }));
const plan = (id: string, label: string, unit: string, vals: number[]) =>
  vals.map((value, k) => ({ id: `${id}_${k + 1}`, label: `${label}, plan year ${k + 1}`, unit, value, fmt: 'num' as const }));

export const PLAN_YEARS = 5;

export const regulatedInputs: Input[] = [
  ...g('Timing', [
    { id: 'start_year', label: 'First year of the rate plan', unit: 'year', value: 2027, fmt: 'year', timing: true, step: 1 },
    { id: 'years', label: 'Years modelled (plan plus projection, then exit)', unit: 'years', value: 10, fmt: 'int', timing: true, min: 5, max: 30, step: 1 },
  ]),
  ...g('Rate base', [
    { id: 'nfa_open', label: 'Net fixed assets at the start of the plan', unit: 'C$m', value: 1000, fmt: 'num' },
    { id: 'wca', label: 'Working capital allowance in rate base', unit: 'C$m', value: 50, fmt: 'num' },
    ...plan('isa', 'In-service capital additions', 'C$m', [100, 100, 100, 100, 100]),
    ...plan('dep', 'Depreciation', 'C$m', [50, 50, 50, 50, 50]),
    { id: 'isa_growth', label: 'Growth in capital additions after the plan', unit: '% / yr', value: 0.03, fmt: 'pct' },
  ]),
  ...g('Cost of capital (deemed)', [
    { id: 'eq_share', label: 'Deemed common equity', unit: '% of rate base', value: 0.4, fmt: 'pct' },
    { id: 'ltd_share', label: 'Deemed long-term debt', unit: '% of rate base', value: 0.56, fmt: 'pct' },
    { id: 'std_share', label: 'Deemed short-term debt', unit: '% of rate base', value: 0.04, fmt: 'pct' },
    { id: 'roe', label: 'Allowed return on equity', unit: '%', value: 0.0925, fmt: 'pct' },
    { id: 'ltd_rate', label: 'Long-term debt rate', unit: '%', value: 0.045, fmt: 'pct' },
    { id: 'std_rate', label: 'Short-term debt rate', unit: '%', value: 0.05, fmt: 'pct' },
  ]),
  ...g('Operating costs, tax and other revenue', [
    { id: 'om_1', label: 'OM&A including property taxes, plan year 1', unit: 'C$m', value: 100, fmt: 'num' },
    { id: 'om_growth', label: 'OM&A growth (inflation plus growth factor)', unit: '% / yr', value: 0.025, fmt: 'pct' },
    ...plan('pils', 'Payments in lieu of taxes (PILs)', 'C$m', [10, 10, 10, 10, 10]),
    { id: 'tax_rate', label: 'Corporate tax rate', unit: '%', value: 0.265, fmt: 'pct' },
    { id: 'offset_1', label: 'Revenue offsets (other revenue), plan year 1', unit: 'C$m', value: 5, fmt: 'num' },
    { id: 'offset_growth', label: 'Revenue offsets growth', unit: '% / yr', value: 0.02, fmt: 'pct' },
  ]),
  ...g('Incentive rate-setting', [
    { id: 'stretch', label: 'Revenue reduction per year after rebasing (stretch factors)', unit: '% / yr', value: 0.006, fmt: 'pct' },
    { id: 'savings', label: 'Share of the stretch reduction offset by cost savings', unit: '%', value: 0, fmt: 'pct', min: 0, max: 1 },
  ]),
  ...g('Valuation', [
    { id: 'target_irr', label: "Buyer's target equity IRR", unit: '%', value: 0.08, fmt: 'pct' },
    { id: 'entry_mult', label: 'Entry price: enterprise value / rate base', unit: 'x', value: 1, fmt: 'x' },
    { id: 'exit_mult', label: 'Exit value: enterprise value / rate base', unit: 'x', value: 1, fmt: 'x' },
  ]),
];

const row = (id: string, label: string, unit: string, fmt: string, f: (x: any) => string | number, extra: object = {}): Item =>
  ({ kind: 'row', id, label, unit, fmt, f, ...extra }) as Item;
const sc = (id: string, label: string, unit: string, fmt: string, f: (x: any) => string, extra: object = {}): Item =>
  ({ kind: 'scalar', id, label, unit, fmt, f, ...extra }) as Item;
// Plan-year input k (1..5) for this column, from the five plan inputs.
const planVal = (x: any, id: string) => `INDEX(Inputs!$C$${rowNo(x, id + '_1')}:$C$${rowNo(x, id + '_' + PLAN_YEARS)},${x.r('yr')})`;
const rowNo = (x: any, id: string) => x.i(id).match(/\$(\d+)$/)![1];

export function regulated(mod: Module): ModelDef {
  const debt = (x: any) => `(${x.i('ltd_share')}+${x.i('std_share')})`;
  const items: Item[] = [
    { section: 'Valuation summary' },
    sc('rb0', 'Rate base at entry (year-end, before the plan)', 'C$m', 'num', x => `INDEX(${x.row('rb_close')},1,1)`, { bold: true }),
    sc('rb_plan_end', 'Rate base, last plan year (average)', 'C$m', 'num', x => `INDEX(${x.row('rb')},1,${PLAN_YEARS + 1})`),
    sc('rb_cagr', 'Rate base growth over the plan (average rate base)', '% / yr', 'pct', x => `(${x.s('rb_plan_end')}/INDEX(${x.row('rb')},1,2))^(1/${PLAN_YEARS - 1})-1`),
    sc('eq_value', "Equity value at the buyer's target IRR", 'C$m', 'num', x => `NPV(${x.i('target_irr')},${x.row('val_cf')})*(1+${x.i('target_irr')})`, { bold: true }),
    sc('ev_value', 'Implied enterprise value (equity plus deemed debt at entry)', 'C$m', 'num', x => `${x.s('eq_value')}+${debt(x)}*${x.s('rb0')}`),
    sc('ev_rb', 'Implied enterprise value / rate base', 'x', 'x', x => `${x.s('ev_value')}/${x.s('rb0')}`, { bold: true }),
    sc('pe', 'Implied price / first-year earnings', 'x', 'x', x => `${x.s('eq_value')}/INDEX(${x.row('ni')},1,2)`),
    sc('entry_eq', 'Equity price paid at the entry multiple', 'C$m', 'num', x => `(${x.i('entry_mult')}-${debt(x)})*${x.s('rb0')}`),
    sc('equity_irr', 'Equity IRR at the entry and exit multiples', '%', 'pct', x => `IRR(${x.row('inv_cf')})`, { bold: true }),
    sc('avg_roe', 'Average earned ROE', '%', 'pct', x => `AVERAGEIF(${x.row('op')},1,${x.row('earned_roe')})`),
    { section: 'Timing' },
    row('yr', 'Plan year (0 = entry)', '#', 'int', x => (x.first ? 0 : `${x.p('yr')}+1`)),
    row('year', 'Year', 'year', 'year', x => `${x.i('start_year')}-1+${x.r('yr')}`, { bold: true }),
    row('op', 'Operating year flag', 'flag', 'flag', x => `IF(${x.r('yr')}>0,1,0)`),
    row('plan_flag', 'Rate plan year flag', 'flag', 'flag', x => `IF(AND(${x.r('yr')}>0,${x.r('yr')}<=${PLAN_YEARS}),1,0)`),
    row('plan_year', 'Year within the rate plan (rebases every five years)', '#', 'int', x => `IF(${x.r('yr')}>0,MOD(${x.r('yr')}-1,${PLAN_YEARS})+1,0)`),

    { section: 'Rate base' },
    row('nfa_open', 'Net fixed assets, opening', 'C$m', 'num', x => x.p('nfa_close')),
    row('isa', 'In-service capital additions', 'C$m', 'num', x => `IF(${x.r('yr')}=0,0,IF(${x.r('plan_flag')}=1,${planVal(x, 'isa')},${x.p('isa')}*(1+${x.i('isa_growth')})))`),
    row('dep', 'Depreciation', 'C$m', 'num', x => `IF(${x.r('yr')}=0,0,IF(${x.r('plan_flag')}=1,${planVal(x, 'dep')},${x.p('dep_rate')}*(${x.r('nfa_open')}+${x.r('isa')}/2)))`),
    // Carried forward from the last plan year (reads the previous column, so no circular reference).
    row('dep_rate', 'Depreciation rate used after the plan: last plan year depreciation / (opening NFA + half of additions)', '%', 'pct',
      x => `IF(${x.r('yr')}=${PLAN_YEARS},${x.r('dep')}/(${x.r('nfa_open')}+${x.r('isa')}/2),${x.p('dep_rate')})`),
    row('nfa_close', 'Net fixed assets, closing', 'C$m', 'num', x => `IF(${x.r('yr')}=0,${x.i('nfa_open')},${x.r('nfa_open')}+${x.r('isa')}-${x.r('dep')})`),
    row('nfa_avg', 'Average net fixed assets', 'C$m', 'num', x => `${x.r('op')}*(${x.r('nfa_open')}+${x.r('nfa_close')})/2`),
    row('rb', 'Rate base (average net fixed assets plus working capital allowance)', 'C$m', 'num', x => `${x.r('op')}*(${x.r('nfa_avg')}+${x.i('wca')})`, { bold: true }),
    row('rb_close', 'Rate base at year end (for funding, entry and exit)', 'C$m', 'num', x => `${x.r('nfa_close')}+${x.i('wca')}`),

    { section: 'Revenue requirement' },
    row('om', 'OM&A including property taxes', 'C$m', 'num', x => `${x.r('op')}*${x.i('om_1')}*(1+${x.i('om_growth')})^MAX(0,${x.r('yr')}-1)`),
    row('int_deemed', 'Deemed interest (long-term and short-term debt)', 'C$m', 'num', x => `${x.r('rb')}*(${x.i('ltd_share')}*${x.i('ltd_rate')}+${x.i('std_share')}*${x.i('std_rate')})`),
    row('roe_ret', 'Return on equity (deemed equity x allowed ROE)', 'C$m', 'num', x => `${x.r('rb')}*${x.i('eq_share')}*${x.i('roe')}`),
    // After the plan, PILs keep the plan's ratio to the return on equity (tax timing differences average out).
    row('cum_pils', 'PILs over the plan, cumulative', 'C$m', 'num', x => `${x.p('cum_pils')}+${x.r('plan_flag')}*${x.r('pils')}`),
    row('cum_roe', 'Return on equity over the plan, cumulative', 'C$m', 'num', x => `${x.p('cum_roe')}+${x.r('plan_flag')}*${x.r('roe_ret')}`),
    row('pils', 'PILs (tax), grossed up', 'C$m', 'num', x => `IF(${x.r('yr')}=0,0,IF(${x.r('plan_flag')}=1,${planVal(x, 'pils')},${x.p('cum_pils')}/${x.p('cum_roe')}*${x.r('roe_ret')}))`),
    row('srr', 'Service revenue requirement', 'C$m', 'num', x => `${x.r('om')}+${x.r('dep')}+${x.r('int_deemed')}+${x.r('roe_ret')}+${x.r('pils')}`, { bold: true }),
    row('offsets', 'Revenue offsets (other revenue)', 'C$m', 'num', x => `${x.r('op')}*${x.i('offset_1')}*(1+${x.i('offset_growth')})^MAX(0,${x.r('yr')}-1)`),
    row('brr', 'Base revenue requirement (recovered in distribution rates)', 'C$m', 'num', x => `${x.r('srr')}-${x.r('offsets')}`, { bold: true }),
    row('stretch_red', 'Stretch factor reduction (resets at each rebasing)', 'C$m', 'num', x => `${x.r('brr')}*${x.i('stretch')}*MAX(0,${x.r('plan_year')}-1)`),
    row('dist_rev', 'Distribution revenue', 'C$m', 'num', x => `${x.r('brr')}-${x.r('stretch_red')}`, { bold: true }),

    { section: 'Earnings and equity cash flow' },
    row('ni', 'Net income (allowed return less unrecovered stretch, after tax)', 'C$m', 'num',
      x => `${x.r('roe_ret')}-(1-${x.i('tax_rate')})*(1-${x.i('savings')})*${x.r('stretch_red')}`, { bold: true }),
    row('earned_roe', 'Earned ROE on deemed equity', '%', 'pct', x => `IF(${x.r('op')}=1,${x.r('ni')}/(${x.r('rb')}*${x.i('eq_share')}),"")`),
    row('eq_funding', 'Equity funding of rate base growth (deemed share)', 'C$m', 'num', x => `${x.r('op')}*${x.i('eq_share')}*(${x.r('rb_close')}-${x.p('rb_close')})`),
    row('fcfe', 'Free cash flow to equity (dividend capacity)', 'C$m', 'num', x => `${x.r('ni')}-${x.r('eq_funding')}`, { bold: true }),
    row('exit_eq', 'Equity value at exit (exit multiple x rate base, less deemed debt)', 'C$m', 'num',
      x => (x.last ? `(${x.i('exit_mult')}-${debt(x)})*${x.r('rb_close')}` : 0)),
    row('val_cf', 'Cash flow to a buyer of 100% of the equity', 'C$m', 'num', x => `${x.r('fcfe')}+${x.r('exit_eq')}`),
    row('inv_cf', 'Equity cash flow at the entry multiple', 'C$m', 'num', x => `IF(${x.r('yr')}=0,-${x.s('entry_eq')},${x.r('val_cf')})`, { bold: true }),
  ];
  const eq = (f: string | number) => (typeof f === 'number' ? f : '=' + f);
  return {
    title: mod.name,
    inputs: [...regulatedInputs.map(i => ({ ...i, ...mod.defaults?.[i.id] })), ...mod.inputs],
    items: items.map(it => ('kind' in it ? { ...it, f: (x: any) => eq(it.f(x)) } : it)) as Item[],
    columns: v => v.years + 1,
    dash: {
      units: 'C$ millions, nominal, annual periods',
      inputs: ['start_year', 'years', 'nfa_open', 'isa_growth', 'eq_share', 'roe', 'ltd_rate', 'om_1', 'stretch', 'target_irr', 'entry_mult', 'exit_mult'],
      outputs: ['rb0', 'rb_plan_end', 'rb_cagr', 'avg_roe', 'eq_value', 'ev_value', 'ev_rb', 'pe', 'entry_eq', 'equity_irr'],
      rows: ['rb', 'srr', 'ni', 'earned_roe', 'fcfe', 'inv_cf'],
    },
  };
}

// The model definition for any module, whichever engine it uses.
export const defOf = (m: Module): ModelDef => (m.engine === 'regulated' ? regulated(m) : m.engine === 'lease' ? lease(m) : projectFinance(m));
