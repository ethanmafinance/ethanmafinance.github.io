// Social infrastructure P3 (design, build, finance, maintain): hospitals, transit, courthouses.
// The public sponsor pays a completion payment at substantial completion, then monthly
// availability payments: a capital portion fixed in nominal terms and a services portion
// indexed to CPI, reduced by deductions for performance failures.
// Defaults reproduce the Humber River Hospital P3 (Toronto, financial close 2011) from public
// sources. Full notes: research/p3-sources.md.
import type { Module } from '../engine/projectFinance.ts';
import type { Item, Source } from '../engine/sheet.ts';

const IO: Source = { title: 'Infrastructure Ontario, Humber River Regional Hospital value for money report', url: 'https://www.infrastructureontario.ca/48e23c/contentassets/e94995ec4cc94042a6f76fd0eca4d39c/hrrh-vfm-report.pdf' };
const DBRS: Source = { title: 'DBRS, provisional rating of Plenary Health Care Partnerships Humber LP', date: 'Aug 31, 2011', url: 'https://dbrs.morningstar.com/research/241811' };
const DBRS_NOH: Source = { title: 'Morningstar DBRS, Hospital Infrastructure Partners (NOH) confirmation (comparable Ontario hospital P3)', date: 'Nov 19, 2024', url: 'https://dbrs.morningstar.com/research/443248' };
const BOC: Source = { title: 'Bank of Canada, inflation-control target (2% midpoint)', url: 'https://www.bankofcanada.ca/rates/indicators/key-variables/inflation-control-target/' };
const CRA: Source = { title: 'Canada Revenue Agency, corporation tax rates: federal 15% plus Ontario 11.5%', date: 'modified Oct 21, 2026', url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/corporations/corporation-tax-rates.html' };
const CAL = 'solved together with the other unpublished inputs so the model matches every published figure in the calibration table';
const est = (note: string, base?: Source): Source => ({ ...(base ?? { title: '' }), est: true, note });

const g = 'P3 availability payments and costs';
const r = (id: string, label: string, role: string, f: (x: any) => string): Item =>
  ({ kind: 'row', id, label, unit: 'C$m', fmt: 'num', role, f }) as Item;

export const p3: Module = {
  id: 'p3',
  name: 'Social infrastructure P3',
  blurb: 'Hospitals, transit and courthouses paid by availability payments. Loaded with the Humber River Hospital P3 (Toronto, 2011).',
  defaults: {
    start_year: { value: 2011, source: { ...IO, page: '12', note: 'financial close Sep 26, 2011' } },
    con_years: { value: 4, source: est('43.5 months of construction (Sep 2011 to May 2015) rounded to 4 annual periods', DBRS) },
    ops_years: { value: 30, source: { ...IO, page: '13', note: '30-year maintenance term' } },
    capex: { value: 974.8, source: { ...DBRS, note: 'fixed-price, date-certain construction contract' } },
    capex_esc: { value: 0, source: { ...DBRS, note: 'fixed-price contract, so no escalation' } },
    capex_p1: { value: 0.1, source: est('spend profile assumed; sources give only the total and dates') },
    capex_p2: { value: 0.3, source: est('spend profile assumed') },
    capex_p3: { value: 0.35, source: est('spend profile assumed') },
    capex_p4: { value: 0.25, source: est('spend profile assumed') },
    capex_p5: { value: 0, source: est('4-year build') },
    cp: { value: 611.5, source: { ...IO, page: '14', note: 'substantial completion payment' } },
    cpi: { value: 0.02, source: BOC },
    tax_rate: { value: 0.265, source: CRA },
    cca_rate: { value: 0.04, source: est('building class rate assumed; P3 tax treatment varies by structure') },
    rate: { value: 0.0508, source: est('blended rate of the long amortizing bond and long bullet bond (Plenary project page); coupons not published; ' + CAL + '. Cross-check: a Cbonds listing shows a 4.895% Humber bond due 2039', { title: 'Cbonds', url: 'https://cbonds.com/bonds/190989/' }) },
    other_costs: { value: 157.6, source: est('costs beyond the $974.8m construction contract that the public sources do not break out (inference: development, financing and transaction costs); ' + CAL, DBRS) },
    tenor: { value: 30, source: est('debt assumed to amortize over the 30-year service term') },
    dscr: { value: 1.25, source: { ...DBRS, note: 'DSCR of 1.25x foreseen over the term' } },
    max_gearing: { value: 0.866, source: { ...DBRS, note: 'gearing 86.6% at substantial completion (92.6% at close, including short-term bonds)' } },
    dsra_months: { value: 6, source: est('six-month DSRA at a comparable Ontario hospital P3', DBRS_NOH) },
    lockup: { value: 1.15, source: est('1.15x distribution test at a comparable Ontario hospital P3', DBRS_NOH) },
  },
  inputs: [
    { id: 'ap_capital', label: 'Capital availability payment (fixed nominal)', unit: 'C$m / yr', value: 48.05, fmt: 'num', group: g,
      source: est('fixed nominal capital portion; split not published; ' + CAL, DBRS) },
    { id: 'ap_services', label: 'Services availability payment (start-year dollars, CPI-indexed)', unit: 'C$m / yr', value: 4.0, fmt: 'num', group: g,
      source: est('CPI-indexed services portion; split not published; ' + CAL, IO) },
    { id: 'deductions', label: 'Performance deductions', unit: '% of payment', value: 0, fmt: 'pct', group: g, source: est('assumes full availability') },
    { id: 'fm_cost', label: 'Facilities management and lifecycle costs (start-year dollars)', unit: 'C$m / yr', value: 4.0, fmt: 'num', group: g,
      source: est('assumes the services payment passes through to the facilities manager at cost (Johnson Controls in the consortium); no public cost split') },
    { id: 'spv_cost', label: 'Project company costs (start-year dollars)', unit: 'C$m / yr', value: 0, fmt: 'num', group: g, source: est('included in the line above') },
    { id: 'lifecycle', label: 'Lifecycle capex, annual average (start-year dollars)', unit: 'C$m / yr', value: 0, fmt: 'num', group: g, source: est('included in the line above') },
  ],
  items: [
    r('ap_cap_row', 'Capital availability payment', 'revenue', x => `${x.r('ops_flag')}*${x.i('ap_capital')}`),
    r('ap_svc_row', 'Services availability payment', 'revenue', x => `${x.r('ops_flag')}*${x.i('ap_services')}*${x.r('index')}`),
    r('ded_row', 'Performance deductions', 'revenue', x => `-${x.i('deductions')}*(${x.r('ap_cap_row')}+${x.r('ap_svc_row')})`),
    r('fm_row', 'Facilities management', 'opex', x => `${x.r('ops_flag')}*${x.i('fm_cost')}*${x.r('index')}`),
    r('spv_row', 'Project company costs', 'opex', x => `${x.r('ops_flag')}*${x.i('spv_cost')}*${x.r('index')}`),
    r('lc_row', 'Lifecycle capex', 'maint', x => `${x.r('ops_flag')}*${x.i('lifecycle')}*${x.r('index')}`),
  ],
  closeDate: '2011-09-26',
  bid: { input: 'ap_capital', label: 'capital availability payment' },
  checks: [
    { label: 'Average annual service payment', published: 53.9, fmt: 'num', source: 'IO report p. 14',
      model: ({ row }) => { const v = row.revenue.filter((_, k) => row.ops_flag[k] === 1); return v.reduce((a, b) => a + b, 0) / v.length; } },
    { label: 'Long-term senior debt', published: 522.447, fmt: 'num', source: 'DBRS 2011: Series A $373.437m plus Series B $149.010m', model: ({ scalar }) => scalar.debt },
    { label: 'Debt to first-year CFADS', published: 11.8, fmt: 'x', source: 'DBRS 2011',
      model: ({ scalar, row }) => scalar.debt / row.cfads[row.ops_year.indexOf(1)] },
    { label: 'Minimum DSCR', published: 1.25, fmt: 'x', source: 'DBRS 2011 and 2024', model: ({ scalar }) => scalar.min_dscr },
    { label: 'Gearing at substantial completion', published: 0.866, fmt: 'pct', source: 'DBRS 2011', model: ({ scalar }) => scalar.gearing },
  ],
};
