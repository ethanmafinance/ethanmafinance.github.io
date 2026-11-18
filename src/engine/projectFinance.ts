// Engine A: project finance for contracted, finite-life assets.
// Annual periods. Year 1 is the financial close year; inputs are in start-year dollars.
//
// Two simplifications remove the circular references a project finance model usually has:
// 1. Debt is drawn pro rata with capex at the end of each construction year and interest during
//    construction is capitalized onto the debt, so debt at COD = s x (capex compounded to COD).
//    The debt share s then has a closed form from the DSCR and gearing limits.
// 2. Sculpting: each year's debt service is CFADS / target DSCR, where CFADS is after tax and tax
//    deducts that year's interest. Interest depends on the balance, which depends on later debt
//    service, so the sizing balance is solved backward from the last tenor year in closed form
//    (no circular reference, no macro). Loss carryforwards are ignored when sizing, so actual tax
//    is at or below sizing tax and the actual DSCR is at or above the target.
// CCA is claimed on construction capex net of any completion payment, plus maintenance capex
// (IDC excluded from the tax base, conservative). A completion payment, as in Ontario hospital P3s,
// repays a construction facility at COD; long-term debt and equity fund the rest.
import type { Input, Item, ModelDef } from './sheet.ts';

export type Module = {
  id: string; name: string; blurb: string; inputs: Input[]; items: Item[];
  // Which engine builds the model: project finance (default) or regulated utility.
  engine?: 'regulated';
  // Per-module values and sources for the engine's inputs (e.g. the example's financing terms).
  defaults?: Record<string, Pick<Input, 'value' | 'source'>>;
  // The payment a bidder solves for a target equity IRR (bid solver).
  bid?: { input: string; label: string };
  checks?: { label: string; published: number; fmt: 'num' | 'x' | 'pct'; model: (r: { scalar: Record<string, number>; row: Record<string, number[]> }) => number; source: string; info?: string; tol?: number }[];
  // Bid solver wording: who the bidder competes against and on what.
  bidText?: string;
  // Set when the example is an operating asset whose entry price is not public: the page shows equity value at a
  // buyer's target IRR in place of IRR, MOIC and the bid solver. The text says why.
  noEntry?: string;
  // Financial close date of the example, for the credit spread over the GoC long bond on that day.
  closeDate?: string;
  // Shown when the example is modelled from financial close with construction still ahead (a delay case applies).
  delayCase?: boolean;
};

const g = (group: string, list: Omit<Input, 'group'>[]): Input[] => list.map(i => ({ ...i, group }));

export const engineInputs: Input[] = [
  ...g('Timing', [
    { id: 'start_year', label: 'Financial close year', unit: 'year', value: 2027, fmt: 'year', timing: true, step: 1 },
    { id: 'con_years', label: 'Construction period', unit: 'years', value: 3, fmt: 'int', timing: true, min: 1, max: 5, step: 1 },
    { id: 'ops_years', label: 'Operations period (concession or asset life)', unit: 'years', value: 30, fmt: 'int', timing: true, min: 1, max: 45, step: 1 },
  ]),
  ...g('Construction', [
    { id: 'capex', label: 'Construction cost (start-year dollars)', unit: 'C$m', value: 1000, fmt: 'num' },
    { id: 'capex_esc', label: 'Construction cost escalation (0 for a fixed-price contract)', unit: '% / yr', value: 0.02, fmt: 'pct' },
    { id: 'capex_p1', label: 'Capex spent in construction year 1', unit: '%', value: 0.3, fmt: 'pct' },
    { id: 'capex_p2', label: 'Capex spent in construction year 2', unit: '%', value: 0.4, fmt: 'pct' },
    { id: 'capex_p3', label: 'Capex spent in construction year 3', unit: '%', value: 0.3, fmt: 'pct' },
    { id: 'capex_p4', label: 'Capex spent in construction year 4', unit: '%', value: 0, fmt: 'pct' },
    { id: 'capex_p5', label: 'Capex spent in construction year 5', unit: '%', value: 0, fmt: 'pct' },
    { id: 'other_costs', label: 'Development, financing and other project costs (nominal, at close)', unit: 'C$m', value: 0, fmt: 'num' },
    { id: 'cp', label: 'Completion payment from the public sponsor at COD (nominal)', unit: 'C$m', value: 0, fmt: 'num' },
  ]),
  ...g('Macro and tax', [
    { id: 'cpi', label: 'Inflation (CPI)', unit: '% / yr', value: 0.02, fmt: 'pct' },
    { id: 'tax_rate', label: 'Corporate tax rate', unit: '%', value: 0.265, fmt: 'pct' },
    { id: 'cca_rate', label: 'CCA rate (declining balance, half-year rule)', unit: '%', value: 0.04, fmt: 'pct' },
    { id: 'ucc_share', label: 'Tax pool at COD (share of construction cost not yet deducted)', unit: '%', value: 1, fmt: 'pct' },
  ]),
  ...g('Debt', [
    { id: 'rate', label: 'All-in interest rate', unit: '% / yr', value: 0.055, fmt: 'pct' },
    { id: 'tenor', label: 'Debt tenor from COD', unit: 'years', value: 28, fmt: 'int', step: 1 },
    { id: 'amort', label: 'Repayment: 0 = sculpted to the target DSCR, 1 = level payments (annuity), growing at the rate below', unit: '0 or 1', value: 0, fmt: 'int', min: 0, max: 1, step: 1 },
    { id: 'ds_growth', label: 'Growth in debt service each year (repayment 1 only; 0 = level)', unit: '% / yr', value: 0, fmt: 'pct' },
    { id: 'dscr', label: 'Target DSCR (every year if sculpted; the minimum year if level)', unit: 'x', value: 1.2, fmt: 'x' },
    { id: 'max_gearing', label: 'Maximum gearing (debt / total uses)', unit: '%', value: 0.9, fmt: 'pct' },
    { id: 'dsra_months', label: 'DSRA size (months of next year debt service)', unit: 'months', value: 6, fmt: 'int' },
    { id: 'lockup', label: 'Distribution lock-up DSCR', unit: 'x', value: 1.1, fmt: 'x' },
    { id: 'maturity', label: 'Legal maturity from COD (0 = repaid by the end of the tenor; shorter = balloon refinanced)', unit: 'years', value: 0, fmt: 'int', min: 0, step: 1 },
    { id: 'refi_spread', label: 'Refinancing rate above the original rate', unit: 'pt', value: 0, fmt: 'pct' },
    { id: 'eq_defer', label: 'Equity timing: 0 = paid in pro rata during construction, 1 = deferred to COD behind a bridge loan (at the debt rate)', unit: '0 or 1', value: 0, fmt: 'int', min: 0, max: 1, step: 1 },
  ]),
  ...g('Downside case (after financial close; debt stays sized on the base case)', [
    { id: 'st_rev', label: 'Revenue change, e.g. deductions or lower volume', unit: '%', value: 0, fmt: 'pct' },
    { id: 'st_opex', label: 'Operating cost change', unit: '%', value: 0, fmt: 'pct' },
    { id: 'st_maint', label: 'Lifecycle and maintenance capex change', unit: '%', value: 0, fmt: 'pct' },
    { id: 'st_cpi', label: 'Actual inflation minus base case', unit: 'pt / yr', value: 0, fmt: 'pct' },
    { id: 'st_delay', label: 'Construction delay after close: operating years lost (contract end fixed; contractor delay damages cover scheduled debt service)', unit: 'years', value: 0, fmt: 'int', min: 0, max: 3, step: 1 },
  ]),
];

const row = (id: string, label: string, unit: string, f: (x: any) => string | number, extra: object = {}): Item =>
  ({ kind: 'row', id, label, unit, f, ...extra }) as Item;
const sc = (id: string, label: string, unit: string, f: (x: any) => string, extra: object = {}): Item =>
  ({ kind: 'scalar', id, label, unit, f, ...extra }) as Item;

export function projectFinance(mod: Module): ModelDef {
  const roles = (role: string) =>
    mod.items.filter((i): i is Extract<Item, { kind: 'row' }> => 'kind' in i && i.kind === 'row' && (i as any).role === role).map(i => i.id);
  const sumOf = (ids: string[]) => (x: any) => (ids.length ? ids.map(id => x.r(id)).join('+') : 0);
  // Base case copies of the module rows (suffix _b, on the base inflation index). Debt is sized on
  // these, so the downside inputs move actual cash flows while debt service stays as sized at close.
  // A row's optional fb is its sizing-case formula (e.g. renewables: debt on P90 output, equity on P50).
  const modIds = new Set(mod.items.filter(i => 'kind' in i).map(i => (i as any).id));
  const toB = (id: string) => (modIds.has(id) || id === 'index' ? id + '_b' : id);
  const bx = (x: any) => ({ ...x, r: (id: string) => x.r(toB(id)), p: (id: string) => x.p(toB(id)), n: (id: string) => x.n(toB(id)) });
  const baseItems = mod.items.filter(i => 'kind' in i).map(i => ({ ...i, id: (i as any).id + '_b', label: (i as any).label + ' (base case)', role: undefined, f: (x: any) => ((i as any).fb ?? (i as any).f)(bx(x)) })) as Item[];
  const sumB = (ids: string[]) => (x: any) => (ids.length ? ids.map(id => x.r(id + '_b')).join('+') : 0);

  const items: Item[] = [
    { section: 'Returns and debt summary' },
    sc('equity_irr', 'Equity IRR (post-tax, levered)', '%', x => `IRR(${x.row('equity_cf')})`, { fmt: 'pct', bold: true }),
    sc('project_irr', 'Project IRR (post-tax, unlevered)', '%', x => `IRR(${x.row('project_cf')})`, { fmt: 'pct', bold: true }),
    sc('moic', 'Equity MOIC', 'x', x => `SUMIF(${x.row('equity_cf')},">0")/-SUMIF(${x.row('equity_cf')},"<0")`, { fmt: 'x' }),
    sc('avg_yield', 'Average cash yield in operations', '%', x => `AVERAGE(${x.row('cash_yield')})`, { fmt: 'pct' }),
    sc('payback', 'Equity payback year', 'year', x => `MIN(${x.row('payback_flag')})`, { fmt: 'year' }),
    sc('min_dscr', 'Minimum DSCR', 'x', x => `MIN(${x.row('dscr_actual')})`, { fmt: 'x', bold: true }),
    sc('avg_dscr', 'Average DSCR', 'x', x => `AVERAGE(${x.row('dscr_actual')})`, { fmt: 'x' }),
    sc('llcr', 'LLCR at COD', 'x', x => `IF(${x.s('debt')}>0,SUMPRODUCT(${x.row('cfads')},${x.row('df')})/${x.s('debt')},0)`, { fmt: 'x' }),

    { section: 'Sources and uses at COD' },
    sc('capex_total', 'Construction capex (nominal)', 'C$m', x => `SUM(${x.row('capex_nom')})`, { fmt: 'num' }),
    sc('other_total', 'Development, financing and other costs', 'C$m', x => `SUM(${x.row('cost_nom')})-${x.s('capex_total')}`, { fmt: 'num' }),
    sc('funded_total', 'Construction and other costs', 'C$m', x => `SUM(${x.row('cost_nom')})`, { fmt: 'num' }),
    sc('idc', 'Interest during construction', 'C$m', x => `(${x.s('share')}+${x.s('cp_share')})*(${x.s('capex_fv_total')}-${x.s('funded_total')})`, { fmt: 'num' }),
    sc('dsra_init', 'Initial DSRA funding', 'C$m', x => `SUMPRODUCT(${x.row('dsra_change')},${x.row('con_flag')})`, { fmt: 'num' }),
    sc('ebl_int', 'Equity bridge loan interest (equity deferred to COD)', 'C$m', x => `${x.i('eq_defer')}*(1-${x.s('share')}-${x.s('cp_share')})*(${x.s('capex_fv_total')}-${x.s('funded_total')})`, { fmt: 'num' }),
    sc('uses', 'Total uses', 'C$m', x => `${x.s('funded_total')}+${x.s('idc')}+${x.s('ebl_int')}+${x.s('dsra_init')}`, { fmt: 'num', bold: true }),
    sc('cp_src', 'Completion payment', 'C$m', x => `${x.s('cp_share')}*${x.s('capex_fv_total')}`, { fmt: 'num' }),
    sc('debt', 'Senior debt', 'C$m', x => `${x.s('share')}*${x.s('capex_fv_total')}`, { fmt: 'num' }),
    sc('equity', 'Equity', 'C$m', x => `(1-${x.s('share')}-${x.s('cp_share')})*${x.s('funded_total')}+${x.s('ebl_int')}+${x.s('dsra_init')}`, { fmt: 'num' }),
    sc('sources', 'Total sources', 'C$m', x => `${x.s('cp_src')}+${x.s('debt')}+${x.s('equity')}`, { fmt: 'num', bold: true }),
    sc('gearing', 'Gearing (debt / debt and equity, excluding DSRA)', '%', x => `${x.s('debt')}/(${x.s('debt')}+${x.s('equity')}-${x.s('ebl_int')}-${x.s('dsra_init')})`, { fmt: 'pct' }),

    { section: 'Debt sizing' },
    sc('capex_fv_total', 'Costs compounded to COD at the debt rate', 'C$m', x => `SUM(${x.row('capex_fv')})`, { fmt: 'num' }),
    sc('cp_share', 'Share of capex funded by the completion payment facility', '%', x => `MIN(1,${x.i('cp')}/${x.s('capex_fv_total')})`, { fmt: 'pct' }),
    sc('ann_factor', 'First-year payment per C$ of debt (annuity factor, growing at the debt service growth rate)', 'x',
      x => `IF(ABS(${x.i('rate')}-${x.i('ds_growth')})<0.000000001,(1+${x.i('rate')})/${x.i('tenor')},(${x.i('rate')}-${x.i('ds_growth')})/(1-((1+${x.i('ds_growth')})/(1+${x.i('rate')}))^${x.i('tenor')}))`, { fmt: 'x' }),
    sc('dscr_capacity', 'Debt capacity at target DSCR', 'C$m', x => `IF(${x.i('amort')}=1,MIN(${x.row('ann_cap')}),SUMIF(${x.row('ops_year')},1,${x.row('sz_open')}))`, { fmt: 'num' }),
    sc('share_dscr', 'Debt share of capex allowed by DSCR', '%', x => `${x.s('dscr_capacity')}/${x.s('capex_fv_total')}`, { fmt: 'pct' }),
    sc('share_gearing', 'Debt share of capex allowed by gearing', '%',
      x => `${x.i('max_gearing')}*(1-${x.s('cp_share')})*${x.s('funded_total')}/(${x.s('capex_fv_total')}-${x.i('max_gearing')}*(${x.s('capex_fv_total')}-${x.s('funded_total')}))`, { fmt: 'pct' }),
    sc('share', 'Debt share of capex used (lower of the two)', '%', x => `MAX(0,MIN(${x.s('share_dscr')},${x.s('share_gearing')},1-${x.s('cp_share')}))`, { fmt: 'pct', bold: true }),
    sc('ds_scale', 'Sculpted debt service scaling', 'x', x => `IF(${x.s('dscr_capacity')}>0,${x.s('debt')}/${x.s('dscr_capacity')},0)`, { fmt: 'x' }),
    sc('balloon', 'Balloon refinanced at legal maturity', 'C$m', x => `MAX(${x.row('balloon_r')})`, { fmt: 'num' }),
    sc('refi_factor', 'Refinancing: level payment per C$ over the remaining tenor', 'x', x => `IF(AND(${x.i('maturity')}>0,${x.i('maturity')}<${x.i('tenor')}),(${x.i('rate')}+${x.i('refi_spread')})/(1-(1+${x.i('rate')}+${x.i('refi_spread')})^-(${x.i('tenor')}-${x.i('maturity')})),0)`, { fmt: 'x' }),
    sc('min_dscr_b', 'Minimum DSCR, debt sizing case', 'x', x => `MIN(${x.row('dscr_b')})`, { fmt: 'x' }),
    sc('avg_dscr_b', 'Average DSCR, debt sizing case', 'x', x => `AVERAGE(${x.row('dscr_b')})`, { fmt: 'x' }),

    { section: 'Timing' },
    row('year_idx', 'Period', '#', x => (x.first ? 1 : `${x.p('year_idx')}+1`), { fmt: 'int' }),
    row('year', 'Year', 'year', x => `${x.i('start_year')}+${x.r('year_idx')}-1`, { fmt: 'year', bold: true }),
    row('con_flag', 'Construction flag', 'flag', x => `IF(${x.r('year_idx')}<=${x.i('con_years')},1,0)`, { fmt: 'flag' }),
    row('ops_flag', 'Operations flag', 'flag', x => `IF(AND(${x.r('year_idx')}>${x.i('con_years')},${x.r('year_idx')}<=${x.i('con_years')}+${x.i('ops_years')}),1,0)`, { fmt: 'flag' }),
    row('ops_year', 'Operating year', '#', x => `${x.r('ops_flag')}*(${x.r('year_idx')}-${x.i('con_years')})`, { fmt: 'int' }),
    row('tenor_flag', 'Debt tenor flag', 'flag', x => `IF(AND(${x.r('ops_flag')}=1,${x.r('ops_year')}<=${x.i('tenor')}),1,0)`, { fmt: 'flag' }),
    row('refi_flag', 'Refinanced debt flag', 'flag', x => `IF(AND(${x.r('tenor_flag')}=1,${x.i('maturity')}>0,${x.r('ops_year')}>${x.i('maturity')}),1,0)`, { fmt: 'flag' }),
    row('dly', 'Delay flag: operating year lost to a construction delay', 'flag', x => `IF(AND(${x.r('ops_flag')}=1,${x.r('ops_year')}<=${x.i('st_delay')}),1,0)`, { fmt: 'flag' }),
    row('index', 'Inflation index (actual)', 'x', x => `(1+${x.i('cpi')}+${x.i('st_cpi')})^(${x.r('year_idx')}-1)`, { fmt: 'x' }),
    row('index_b', 'Inflation index (base case)', 'x', x => `(1+${x.i('cpi')})^(${x.r('year_idx')}-1)`, { fmt: 'x' }),
    row('df', 'Discount factor to COD at the debt rate (tenor only)', 'x', x => `${x.r('tenor_flag')}/(1+${x.i('rate')})^${x.r('ops_year')}`, { fmt: 'x' }),

    { section: 'Construction' },
    row('capex_nom', 'Construction capex (nominal)', 'C$m',
      x => `IF(${x.r('con_flag')}=1,${x.i('capex')}*INDEX(Inputs!$C$${idxRow(x, 'capex_p1')}:$C$${idxRow(x, 'capex_p5')},${x.r('year_idx')})*(1+${x.i('capex_esc')})^(${x.r('year_idx')}-1),0)`, { fmt: 'num' }),
    row('cost_nom', 'Construction and other costs funded', 'C$m', x => `${x.r('capex_nom')}+IF(${x.r('year_idx')}=1,${x.i('other_costs')},0)`, { fmt: 'num' }),
    row('capex_fv', 'Costs compounded to COD', 'C$m', x => `${x.r('cost_nom')}*(1+${x.i('rate')})^(${x.i('con_years')}-${x.r('year_idx')})`, { fmt: 'num' }),

    { section: 'Completion payment facility (repaid at COD)' },
    row('cpf_open', 'Opening balance', 'C$m', x => x.p('cpf_close'), { fmt: 'num' }),
    row('cpf_draw', 'Drawdown', 'C$m', x => `${x.s('cp_share')}*${x.r('cost_nom')}`, { fmt: 'num' }),
    row('cpf_int', 'Interest capitalized', 'C$m', x => `${x.r('con_flag')}*${x.r('cpf_open')}*${x.i('rate')}`, { fmt: 'num' }),
    row('cpf_repay', 'Repaid by completion payment', 'C$m', x => `IF(${x.r('year_idx')}=${x.i('con_years')},${x.s('cp_src')},0)`, { fmt: 'num' }),
    row('cpf_close', 'Closing balance', 'C$m', x => `${x.r('cpf_open')}+${x.r('cpf_draw')}+${x.r('cpf_int')}-${x.r('cpf_repay')}`, { fmt: 'num' }),

    { section: mod.name + ': operations' },
    ...mod.items,
    row('revenue', 'Total revenue', 'C$m', x => `(1-${x.r('dly')})*(1+${x.i('st_rev')})*(${sumOf(roles('revenue'))(x)})`, { fmt: 'num', bold: true }),
    row('opex', 'Total operating costs', 'C$m', x => `(1-${x.r('dly')})*(1+${x.i('st_opex')})*(${sumOf(roles('opex'))(x)})`, { fmt: 'num' }),
    // Debt service does not depend on actual revenue (it is set by the base-case sizing rows), so this is not circular.
    row('ld', 'Contractor delay damages (cover scheduled debt service)', 'C$m', x => `${x.r('dly')}*${x.r('ds')}`, { fmt: 'num' }),
    row('ebitda', 'EBITDA', 'C$m', x => `${x.r('revenue')}-${x.r('opex')}+${x.r('ld')}`, { fmt: 'num', bold: true }),
    row('maint', 'Maintenance and lifecycle capex', 'C$m', x => `(1-${x.r('dly')})*(1+${x.i('st_maint')})*(${sumOf(roles('maint'))(x)})`, { fmt: 'num' }),

    { section: 'Base case used to size the debt' },
    ...baseItems,
    row('ebitda_b', 'EBITDA (base case)', 'C$m', x => `${sumB(roles('revenue'))(x)}-(${sumB(roles('opex'))(x)})`, { fmt: 'num' }),
    row('maint_b', 'Maintenance and lifecycle capex (base case)', 'C$m', sumB(roles('maint')), { fmt: 'num' }),
    row('cca_b', 'CCA claimed (base case)', 'C$m', x => `${x.r('ops_flag')}*(${x.p('ucc_b')}+0.5*(IF(${x.r('ops_year')}=1,${x.i('ucc_share')}*MAX(0,${x.s('capex_total')}-${x.s('cp_src')}),0)+${x.r('maint_b')}))*${x.i('cca_rate')}`, { fmt: 'num' }),
    row('ucc_b', 'UCC closing balance (base case)', 'C$m', x => `${x.p('ucc_b')}+IF(${x.r('ops_year')}=1,${x.i('ucc_share')}*MAX(0,${x.s('capex_total')}-${x.s('cp_src')}),0)+${x.r('maint_b')}-${x.r('cca_b')}`, { fmt: 'num' }),

    { section: 'Tax' },
    row('cca_add', 'Additions to CCA pool', 'C$m', x => `IF(${x.r('ops_year')}=1,${x.i('ucc_share')}*MAX(0,${x.s('capex_total')}-${x.s('cp_src')}),0)+${x.r('maint')}`, { fmt: 'num' }),
    row('cca', 'CCA claimed', 'C$m', x => `${x.r('ops_flag')}*(${x.p('ucc')}+0.5*${x.r('cca_add')})*${x.i('cca_rate')}`, { fmt: 'num' }),
    row('ucc', 'UCC closing balance', 'C$m', x => `${x.p('ucc')}+${x.r('cca_add')}-${x.r('cca')}`, { fmt: 'num' }),
    row('u_ti', 'Unlevered taxable income', 'C$m', x => `${x.r('ebitda')}-${x.r('cca')}`, { fmt: 'num' }),
    row('u_tax', 'Unlevered tax (project IRR)', 'C$m', x => `MAX(0,${x.r('u_ti')}-${x.p('u_loss')})*${x.i('tax_rate')}`, { fmt: 'num' }),
    row('u_loss', 'Unlevered loss carryforward', 'C$m', x => `MAX(0,${x.p('u_loss')}-${x.r('u_ti')})`, { fmt: 'num' }),
    row('l_ti', 'Taxable income after interest', 'C$m', x => `${x.r('ebitda')}-${x.r('cca')}-${x.r('int_paid')}`, { fmt: 'num' }),
    row('l_tax', 'Cash tax', 'C$m', x => `MAX(0,${x.r('l_ti')}-${x.p('l_loss')})*${x.i('tax_rate')}`, { fmt: 'num' }),
    row('l_loss', 'Loss carryforward', 'C$m', x => `MAX(0,${x.p('l_loss')}-${x.r('l_ti')})`, { fmt: 'num' }),

    { section: 'Cash flow available for debt service' },
    row('cfads_sizing', 'Unlevered CFADS (after unlevered tax)', 'C$m', x => `${x.r('ebitda')}-${x.r('maint')}-${x.r('u_tax')}`, { fmt: 'num' }),
    row('cfads', 'CFADS (after cash tax)', 'C$m', x => `${x.r('ebitda')}-${x.r('maint')}-${x.r('l_tax')}`, { fmt: 'num', bold: true }),

    { section: 'Senior debt' },
    // Backward solve: open = (close + CFADS/DSCR)/(1+r), with CFADS = EBITDA - maint - tax(EBITDA - CCA - r*open).
    row('sz_close', 'Sizing balance, closing', 'C$m', x => x.n('sz_open'), { fmt: 'num' }),
    row('sz_open_nt', 'Sizing balance, opening, if no tax is due', 'C$m',
      x => `${x.r('tenor_flag')}*(${x.r('sz_close')}+(${x.r('ebitda_b')}-${x.r('maint_b')})/${x.i('dscr')})/(1+${x.i('rate')})`, { fmt: 'num' }),
    row('sz_open', 'Sizing balance, opening', 'C$m',
      x => `${x.r('tenor_flag')}*IF(${x.r('ebitda_b')}-${x.r('cca_b')}-${x.i('rate')}*${x.r('sz_open_nt')}<=0,${x.r('sz_open_nt')},(${x.r('sz_close')}+(${x.r('ebitda_b')}-${x.r('maint_b')}-${x.i('tax_rate')}*(${x.r('ebitda_b')}-${x.r('cca_b')}))/${x.i('dscr')})/(1+${x.i('rate')}-${x.i('tax_rate')}*${x.i('rate')}/${x.i('dscr')}))`, { fmt: 'num' }),
    // Level payments: debt D pays D x annuity factor a each year, and the opening balance per C$ of debt (b) is known,
    // so tax is linear in D and each year's cover test CFADS >= DSCR x a x D gives a cap on D in closed form.
    row('ann_step', 'Level payments: payment growth factor', 'x', x => `${x.r('tenor_flag')}*(1+${x.i('ds_growth')})^(${x.r('ops_year')}-1)`, { fmt: 'x' }),
    // Opening balance = present value of the payments still due, per C$ of debt.
    row('ann_bal', 'Level payments: opening balance per C$ of debt', 'x',
      x => `${x.r('tenor_flag')}*${x.s('ann_factor')}*${x.r('ann_step')}*IF(ABS(${x.i('rate')}-${x.i('ds_growth')})<0.000000001,(${x.i('tenor')}-${x.r('ops_year')}+1)/(1+${x.i('rate')}),(1-((1+${x.i('ds_growth')})/(1+${x.i('rate')}))^(${x.i('tenor')}-${x.r('ops_year')}+1))/(${x.i('rate')}-${x.i('ds_growth')}))`, { fmt: 'x' }),
    row('ann_cap_nt', 'Level payments: debt the year supports if no tax is due', 'C$m',
      x => `(${x.r('ebitda_b')}-${x.r('maint_b')})/(${x.i('dscr')}*${x.s('ann_factor')}*${x.r('ann_step')})`, { fmt: 'num' }),
    row('ann_cap', 'Level payments: debt the year supports at target DSCR', 'C$m',
      x => `IF(${x.r('tenor_flag')}=1,IF(${x.r('ebitda_b')}-${x.r('cca_b')}-${x.i('rate')}*${x.r('ann_bal')}*${x.r('ann_cap_nt')}<=0,${x.r('ann_cap_nt')},(${x.r('ebitda_b')}-${x.r('maint_b')}-${x.i('tax_rate')}*(${x.r('ebitda_b')}-${x.r('cca_b')}))/(${x.i('dscr')}*${x.s('ann_factor')}*${x.r('ann_step')}-${x.i('tax_rate')}*${x.i('rate')}*${x.r('ann_bal')})),1000000000000)`, { fmt: 'num' }),
    row('sizing_ds', 'Sculpted debt service at target DSCR', 'C$m', x => `${x.r('tenor_flag')}*(${x.r('sz_open')}*(1+${x.i('rate')})-${x.r('sz_close')})`, { fmt: 'num' }),
    row('debt_open', 'Opening balance', 'C$m', x => x.p('debt_close'), { fmt: 'num' }),
    row('draw', 'Drawdown', 'C$m', x => `${x.s('share')}*${x.r('cost_nom')}`, { fmt: 'num' }),
    row('interest', 'Interest', 'C$m', x => `${x.r('debt_open')}*(${x.i('rate')}+${x.r('refi_flag')}*${x.i('refi_spread')})`, { fmt: 'num' }),
    row('int_cap', 'Interest capitalized (construction)', 'C$m', x => `${x.r('con_flag')}*${x.r('interest')}`, { fmt: 'num' }),
    row('int_paid', 'Interest paid (operations)', 'C$m', x => `${x.r('ops_flag')}*${x.r('interest')}`, { fmt: 'num' }),
    // After legal maturity the balloon is refinanced as a level-payment loan over the rest of the tenor.
    row('ds', 'Debt service', 'C$m', x => `IF(${x.r('refi_flag')}=1,${x.p('balloon_r')}*${x.s('refi_factor')},IF(${x.i('amort')}=1,${x.s('debt')}*${x.s('ann_factor')}*${x.r('ann_step')},${x.r('sizing_ds')}*${x.s('ds_scale')}))`, { fmt: 'num', bold: true }),
    row('principal', 'Principal repaid', 'C$m', x => `${x.r('tenor_flag')}*(${x.r('ds')}-${x.r('interest')})`, { fmt: 'num' }),
    row('debt_close', 'Closing balance', 'C$m', x => `${x.r('debt_open')}+${x.r('draw')}+${x.r('int_cap')}-${x.r('principal')}`, { fmt: 'num' }),
    // Carried forward from the maturity year; debt service reads last year's value, so there is no circular reference.
    row('balloon_r', 'Balloon at legal maturity (carried forward)', 'C$m', x => `IF(AND(${x.i('maturity')}>0,${x.i('maturity')}<${x.i('tenor')},${x.r('ops_year')}=${x.i('maturity')}),${x.r('debt_close')},${x.p('balloon_r')})`, { fmt: 'num' }),
    row('dscr_actual', 'DSCR (not tested in delay years, when delay damages pay debt service)', 'x', x => `IF(AND(${x.r('ds')}>0,${x.r('dly')}=0),${x.r('cfads')}/${x.r('ds')},"")`, { fmt: 'x' }),

    { section: 'Debt sizing case coverage (on the actual debt)' },
    row('l_ti_b', 'Taxable income after interest (sizing case)', 'C$m', x => `${x.r('ebitda_b')}-${x.r('cca_b')}-${x.r('int_paid')}`, { fmt: 'num' }),
    row('l_tax_b', 'Cash tax (sizing case)', 'C$m', x => `MAX(0,${x.r('l_ti_b')}-${x.p('l_loss_b')})*${x.i('tax_rate')}`, { fmt: 'num' }),
    row('l_loss_b', 'Loss carryforward (sizing case)', 'C$m', x => `MAX(0,${x.p('l_loss_b')}-${x.r('l_ti_b')})`, { fmt: 'num' }),
    row('cfads_b', 'CFADS (sizing case)', 'C$m', x => `${x.r('ebitda_b')}-${x.r('maint_b')}-${x.r('l_tax_b')}`, { fmt: 'num' }),
    row('dscr_b', 'DSCR (sizing case)', 'x', x => `IF(${x.r('ds')}>0,${x.r('cfads_b')}/${x.r('ds')},"")`, { fmt: 'x' }),

    { section: 'Reserve and distributions' },
    row('dsra', 'DSRA balance', 'C$m', x => `${x.i('dsra_months')}/12*${x.n('ds')}`, { fmt: 'num' }),
    row('dsra_change', 'DSRA funding (release)', 'C$m', x => `${x.r('dsra')}-${x.p('dsra')}`, { fmt: 'num' }),
    row('cash_avail', 'Cash available for distribution', 'C$m', x => `${x.r('ops_flag')}*(${x.r('cfads')}-${x.r('ds')}-${x.r('dsra_change')})`, { fmt: 'num' }),
    row('lock', 'Lock-up test failed', 'flag',
      x => `IF(AND(${x.r('ds')}>0,${x.r('dly')}=0,${x.r('ops_year')}<${x.i('ops_years')},${x.r('cfads')}<${x.i('lockup')}*${x.r('ds')}),1,0)`, { fmt: 'flag' }),
    row('trapped', 'Cash trapped by lock-up', 'C$m', x => `IF(${x.r('lock')}=1,${x.p('trapped')}+${x.r('cash_avail')},0)`, { fmt: 'num' }),
    row('dist', 'Distributions to equity', 'C$m', x => `IF(${x.r('lock')}=1,0,${x.r('cash_avail')}+${x.p('trapped')})`, { fmt: 'num', bold: true }),

    { section: 'Equity and project cash flows' },
    row('equity_in', 'Equity contributions', 'C$m', x => `${x.r('con_flag')}*((1-${x.s('share')}-${x.s('cp_share')})*IF(${x.i('eq_defer')}=1,IF(${x.r('year_idx')}=${x.i('con_years')},${x.s('capex_fv_total')},0),${x.r('cost_nom')})+${x.r('dsra_change')})`, { fmt: 'num' }),
    row('equity_cf', 'Equity cash flow', 'C$m', x => `${x.r('dist')}-${x.r('equity_in')}`, { fmt: 'num', bold: true }),
    row('cum_equity', 'Cumulative equity cash flow', 'C$m', x => `${x.p('cum_equity')}+${x.r('equity_cf')}`, { fmt: 'num' }),
    row('payback_flag', 'Payback year', 'year', x => (x.first ? '""' : `IF(AND(${x.r('cum_equity')}>=0,${x.p('cum_equity')}<0),${x.r('year')},"")`), { fmt: 'year' }),
    row('cash_yield', 'Cash yield on equity invested', '%', x => `IF(${x.r('ops_flag')}=1,${x.r('dist')}/${x.s('equity')},"")`, { fmt: 'pct' }),
    row('project_cf', 'Project cash flow (unlevered, post-tax)', 'C$m', x => `${x.r('cfads_sizing')}*${x.r('ops_flag')}-${x.r('cost_nom')}+${x.r('cpf_repay')}`, { fmt: 'num', bold: true }),
  ];

  // Formulas need a leading '=' except plain numbers.
  const withEq = items.map(it => ('kind' in it ? { ...it, f: (x: any) => eq(it.f(x)) } : it)) as Item[];
  return {
    title: mod.name,
    inputs: [...engineInputs.map(i => ({ ...i, ...mod.defaults?.[i.id] })), ...mod.inputs],
    items: withEq,
    columns: v => v.con_years + v.ops_years,
  };
}

const eq = (f: string | number) => (typeof f === 'number' ? f : '=' + f);
// INDEX over the capex profile needs the 1-based input rows; resolved from an input ref like Inputs!$C$12.
const idxRow = (x: any, id: string) => x.i(id).match(/\$(\d+)$/)![1];
