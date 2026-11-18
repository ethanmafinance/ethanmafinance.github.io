// Renewables: onshore wind, solar and storage sold under a long-term contract (Ontario FIT or IESO
// procurement, or a corporate PPA), then a merchant tail at market prices once the contract ends.
// Lenders size debt on a conservative output case (one-year P90, often with a haircut); equity
// returns are read on the expected (P50) case. The model keeps both: the sizing case drives the
// debt, the P50 case drives actual cash flow, DSCR and returns.
// Defaults reproduce the Dufferin Wind project (91.4 MW, Dufferin County, Ontario) at its October
// 2015 bond refinancing, from Morningstar DBRS releases. Full notes: research/renewables-sources.md.
import type { Module } from '../engine/projectFinance.ts';
import type { Item, Source } from '../engine/sheet.ts';

const D15: Source = { title: 'DBRS, final rating of Dufferin Wind Power senior secured bonds', date: 'Oct 2015', url: 'https://dbrs.morningstar.com/research/285877/dbrs-finalizes-provisional-rating-of-dufferin-wind-power-senior-secured-bonds-at-bbb' };
const D20: Source = { title: 'DBRS, Dufferin Wind Power confirmation', date: 'Sep 25, 2020', url: 'https://dbrs.morningstar.com/research/367282/dbrs-morningstar-confirms-ratings-on-dufferin-wind-power-inc-at-bbb-high-with-stable-trends' };
const D23: Source = { title: 'DBRS, Dufferin Wind Power confirmation', date: 'Oct 11, 2023', url: 'https://dbrs.morningstar.com/research/421700/dbrs-morningstar-confirms-credit-ratings-on-dufferin-wind-power-inc-at-bbb-high-with-stable-trends' };
const D24: Source = { title: 'Morningstar DBRS, Dufferin Wind Power confirmation', date: 'Oct 7, 2024', url: 'https://dbrs.morningstar.com/research/440874/morningstar-dbrs-confirms-dufferin-wind-power-inc-at-bbb-high-with-stable-trends' };
const D20R: Source = { title: 'DBRS, Dufferin Wind Power rating report', date: 'Sep 2020', url: 'https://dbrs.morningstar.com/research/367761/dufferin-wind-power-inc-rating-report' };
const K2: Source = { title: 'ReNew Canada, K2 Wind project: $850 million, 270 MW, Ontario, COD 2015', url: 'https://www.renewcanada.net/the-projects/k2-wind-project/' };
const CRA43: Source = { title: 'Canada Revenue Agency, classes of depreciable property: Class 43.2 (50%) for clean energy generation', url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/sole-proprietorships-partnerships/report-business-income-expenses/claiming-capital-cost-allowance/classes-depreciable-property.html' };
const IESO: Source = { title: 'IESO, 2024 year in review: average weighted HOEP 3.37 cents/kWh', url: 'https://www.ieso.ca/Corporate-IESO/Media/Year-End-Data/2024' };
const BOC: Source = { title: 'Bank of Canada, inflation-control target (2% midpoint)', url: 'https://www.bankofcanada.ca/rates/indicators/key-variables/inflation-control-target/' };
const CRA: Source = { title: 'Canada Revenue Agency, corporation tax rates: federal 15% plus Ontario 11.5%', url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/corporations/corporation-tax-rates.html' };
const est = (note: string, base?: Source): Source => ({ ...(base ?? { title: '' }), est: true, note });

const g = 'Renewables: output, price and costs';
const row = (id: string, label: string, unit: string, fmt: 'num' | 'x' | 'flag', f: (x: any) => string, extra: object = {}): Item =>
  ({ kind: 'row', id, label, unit, fmt, f, ...extra }) as Item;

// Output in a given year: annual GWh less degradation from the first operating year.
const output = (id: string) => (x: any) => `${x.r('ops_flag')}*${x.i(id)}*(1-${x.i('degradation')})^MAX(0,${x.r('ops_year')}-1)`;

export const renewables: Module = {
  id: 'renewables',
  name: 'Renewables (wind, solar, storage)',
  blurb: 'Contracted wind and solar with debt sized on P90 output and returns on P50. Loaded with the Dufferin Wind project (91.4 MW, Ontario) at its 2015 bond refinancing.',
  defaults: {
    start_year: { value: 2015, source: est('bonds issued Oct 22, 2015, about 11 months after commercial operation (Dec 1, 2014); the model starts at the refinancing, with the build cost as year 1 spend', D20R) },
    con_years: { value: 1, source: est('operating asset: one period holds the build cost and the bond close') },
    ops_years: { value: 19, source: est('FIT contract to Nov 30, 2034; 2016 to 2034 in annual periods', D15) },
    capex: { value: 287.7, source: est('C$3,148 per kW (K2 Wind: $850 million for 270 MW, Ontario, built 2014 to 2015) times 91.4 MW; Dufferin\'s own cost is not public. Drives equity returns only, not the debt', K2) },
    capex_esc: { value: 0, source: est('already built') },
    capex_p1: { value: 1, source: est('all in the first period') },
    capex_p2: { value: 0, source: est('already built') },
    capex_p3: { value: 0, source: est('already built') },
    other_costs: { value: 0, source: est('included in the cost per kW') },
    cp: { value: 0, source: est('no completion payment for a power project') },
    cpi: { value: 0.02, source: BOC },
    tax_rate: { value: 0.265, source: CRA },
    cca_rate: { value: 0.5, source: est('accelerated class for clean energy generation equipment; that wind equipment falls in it is inference, as the page does not list it by name', CRA43) },
    ucc_share: { value: 0, source: est('tax pool taken as fully used by 2016 (50% CCA claimed through construction and the first operating year): with any tax pool left, rating-case coverage would start well above 1.64x, but it is flat at 1.60x to 1.64x', D15) },
    rate: { value: 0.04317, source: { ...D15, note: '4.317% senior secured bonds' } },
    tenor: { value: 18, source: { ...D20R, note: 'bonds due Nov 30, 2033: 2016 to 2033 in annual periods' } },
    amort: { value: 1, source: est('level payments: the published balances ($161.5m in Sep 2020, $123.8m in Oct 2024) fit a level-payment schedule; the indenture is not public', D24) },
    dscr: { value: 1.6, source: { ...D15, note: 'minimum semi-annual DSCR 1.60x in the rating case (average 1.64x)' } },
    max_gearing: { value: 0.9, source: est('not binding: debt is set by coverage, as in the rating case') },
    dsra_months: { value: 6, source: est('six months of debt service assumed; Dufferin\'s reserve terms are not in the public releases') },
    lockup: { value: 1.2, source: est('distribution test not in the public releases; 1.20x assumed') },
  },
  inputs: [
    { id: 'mw', label: 'Capacity', unit: 'MW', value: 91.4, fmt: 'num', group: g, source: { ...D15, note: '49 GE turbines' } },
    { id: 'energy_p50', label: 'Expected output, P50 (equity case)', unit: 'GWh / yr', value: 266.7, fmt: 'num', group: g,
      source: est('actual generation averaged about 10.4% above the 241.6 GWh rating case from 2015 to mid-2024 (33% capacity factor); the original P50 is not published', D24) },
    { id: 'energy_sizing', label: 'Debt sizing output, one-year P90 rating case', unit: 'GWh / yr', value: 241.6, fmt: 'num', group: g,
      source: { ...D23, note: 'one-year P90 rating case 241.6 GWh (30.2% capacity factor)' } },
    { id: 'degradation', label: 'Output degradation', unit: '% / yr', value: 0, fmt: 'pct', group: g, source: est('rating case is flat at 241.6 GWh in the 2020, 2023 and 2024 releases', D20) },
    { id: 'ppa_price', label: 'Contract price (start year)', unit: 'C$ / MWh', value: 146.6, fmt: 'num', group: g, source: { ...D15, note: 'effective FIT price $146.60/MWh in 2015' } },
    { id: 'ppa_index', label: 'Share of CPI the contract price is indexed to', unit: '%', value: 0.2, fmt: 'pct', group: g, source: { ...D15, note: 'indexed at 20% of Ontario CPI' } },
    { id: 'contract_years', label: 'Contract term from COD', unit: 'years', value: 19, fmt: 'int', group: g, step: 1, source: est('FIT contract to Nov 30, 2034', D15) },
    { id: 'merchant_price', label: 'Merchant power price after the contract (start-year dollars, CPI-indexed)', unit: 'C$ / MWh', value: 28.2, fmt: 'num', group: g,
      source: est('2024 average HOEP of $33.70/MWh deflated to 2015 at 2% a year; used only if operations run past the contract', IESO) },
    { id: 'opex', label: 'Operating costs: O&M, land leases, property tax, insurance (start-year dollars)', unit: 'C$m / yr', value: 2.39, fmt: 'num', group: g,
      source: est('not published; solved so the rating case supports the $200 million bond issue at a 1.60x minimum DSCR. About C$26 per kW a year in 2015 dollars: read it as the net cost the rating case implies with full tax, not as a bottom-up O&M estimate', D15) },
    { id: 'lifecycle_r', label: 'Major maintenance capex, annual average (start-year dollars)', unit: 'C$m / yr', value: 0, fmt: 'num', group: g, source: est('included in operating costs') },
  ],
  items: [
    row('energy', 'Output (P50 case; sizing case in the base rows)', 'GWh', 'num', output('energy_p50'), { fb: output('energy_sizing') }),
    row('contract_flag', 'Under contract', 'flag', 'flag', x => `IF(AND(${x.r('ops_flag')}=1,${x.r('ops_year')}<=${x.i('contract_years')}),1,0)`),
    // FIT indexation: price x (1 + share x (CPI index - 1)), so 20% indexation adds a fifth of cumulative inflation.
    row('price', 'Realized price', 'C$/MWh', 'num',
      x => `${x.r('ops_flag')}*IF(${x.r('contract_flag')}=1,${x.i('ppa_price')}*(1+${x.i('ppa_index')}*(${x.r('index')}-1)),${x.i('merchant_price')}*${x.r('index')})`),
    row('power_rev', 'Power revenue', 'C$m', 'num', x => `${x.r('energy')}*${x.r('price')}/1000`, { role: 'revenue' }),
    row('opex_r', 'Operating costs', 'C$m', 'num', x => `${x.r('ops_flag')}*${x.i('opex')}*${x.r('index')}`, { role: 'opex' }),
    row('lc_r', 'Major maintenance capex', 'C$m', 'num', x => `${x.r('ops_flag')}*${x.i('lifecycle_r')}*${x.r('index')}`, { role: 'maint' }),
  ],
  bid: { input: 'ppa_price', label: 'contract price' },
  bidText: 'In a competitive power procurement, bidders compete on the contract price per MWh.',
};

// Bonds outstanding after the mid-year (May) payment: the prior year-end balance plus half a year of
// interest, less half of the year's debt service (semi-annual payments, the annual model's rate).
const midYear = (year: number) => ({ row }: { row: Record<string, number[]> }) => {
  const k = row.year.indexOf(year);
  const r = row.interest[k] / row.debt_open[k];
  return row.debt_close[k - 1] * Math.sqrt(1 + r) - row.ds[k] / 2;
};
const priceIn = (year: number) => ({ row }: { row: Record<string, number[]> }) => row.price[row.year.indexOf(year)];

renewables.checks = [
  { label: 'Senior secured bonds issued (Oct 2015)', published: 200, fmt: 'num', source: 'DBRS 2020 rating report: $200 million issued Oct 22, 2015', model: ({ scalar }) => scalar.debt },
  { label: 'Bonds outstanding, Sep 2020', published: 161.5, fmt: 'num', tol: 0.02, source: 'DBRS Sep 25, 2020 ("approximately"); model: after the May 2020 payment. 2% tolerance: the source rounds, and the exact repayment schedule is not public', model: midYear(2020) },
  { label: 'Bonds outstanding, Oct 2024', published: 123.8, fmt: 'num', tol: 0.02, source: 'Morningstar DBRS Oct 7, 2024 ("approximately"); model: after the May 2024 payment', model: midYear(2024) },
  { label: 'Bonds outstanding, Oct 2023', published: 127.46, fmt: 'num', source: 'DBRS Oct 11, 2023', model: midYear(2023),
    info: 'Not used: it implies only $3.7m repaid in the next 12 months against about $9m a year before, so it conflicts with the 2024 figure.' },
  { label: 'Minimum DSCR, rating case', published: 1.6, fmt: 'x', source: 'DBRS Oct 2015 (semi-annual)', model: ({ scalar }) => scalar.min_dscr_b },
  { label: 'Average DSCR, rating case', published: 1.64, fmt: 'x', source: 'DBRS Oct 2015 (semi-annual)', model: ({ scalar }) => scalar.avg_dscr_b },
  { label: 'Average realized price, 2019', published: 148.52, fmt: 'num', source: 'DBRS Sep 25, 2020 (C$/MWh)', model: priceIn(2019) },
  { label: 'Average realized price, 2022', published: 151.44, fmt: 'num', source: 'DBRS Oct 11, 2023 (C$/MWh)', model: priceIn(2022) },
  { label: 'Average realized price, 2023', published: 153.52, fmt: 'num', source: 'Morningstar DBRS Oct 7, 2024 (C$/MWh)', model: priceIn(2023),
    info: 'Not used: the model holds inflation at a flat 2% a year, and inflation after 2021 likely ran higher, so the indexed price falls behind here (inference).' },
];
