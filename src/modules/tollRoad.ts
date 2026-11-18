// Toll roads and bridges: a concession paid by users. Traffic ramps up after opening, then grows;
// tolls rise each year by a set share of CPI (Canadian concessions often cap increases below CPI).
// Lenders size debt on a traffic case below the sponsor's (a haircut); returns read on the sponsor case.
// Defaults reproduce the Confederation Bridge (Strait Crossing Development Inc.) from Sep 30, 2017, from
// DBRS releases. Model years run October to September, matching the bond balances DBRS reports.
// Full notes: research/toll-sources.md.
import type { Module } from '../engine/projectFinance.ts';
import type { Item, Source } from '../engine/sheet.ts';

const dbrs = (id: number, date: string, note: string): Source =>
  ({ title: 'DBRS, Strait Crossing Development Inc. rating action', date, url: `https://dbrs.morningstar.com/research/${id}`, note });
const S17 = dbrs(319149, 'Nov 16, 2017', 'debt $254.3 million at Sep 30, 2017; 6.17% Revenue Bonds');
const S19 = dbrs(352846, 'Nov 2019', '2018 traffic 864,434 vehicles; 2018 DSCR 1.40x (DBRS); $0.75 two-axle toll increase');
const S24 = dbrs(443559, 'Nov 27, 2024', '2023 traffic 7% above 2019; tolls capped at 75% of national CPI; reserves about $27 million, about one year of debt service');
const S14 = dbrs(274799, 'Dec 8, 2014', 'toll increases constrained to 75% of national CPI under the federal concession');
const WIKI: Source = { title: 'Wikipedia, Confederation Bridge: opened May 31, 1997; operated by the developer until 2032, then transferred to the Government of Canada', url: 'https://en.wikipedia.org/wiki/Confederation_Bridge' };
const BOC: Source = { title: 'Bank of Canada, inflation-control target (2% midpoint)', url: 'https://www.bankofcanada.ca/rates/indicators/key-variables/inflation-control-target/' };
const est = (note: string, base?: Source): Source => ({ ...(base ?? { title: '' }), est: true, note });

const g = 'Toll road: traffic, tolls and costs';
const row = (id: string, label: string, unit: string, fmt: 'num' | 'x' | 'pct', f: (x: any) => string, extra: object = {}): Item =>
  ({ kind: 'row', id, label, unit, fmt, f, ...extra }) as Item;

// Traffic in millions of trips: mature level x growth x ramp-up factor; the sizing case applies the lender haircut.
const traffic = (haircut: boolean) => (x: any) =>
  `${x.r('ops_flag')}*${x.i('traffic')}*(1+${x.i('traffic_growth')})^MAX(0,${x.r('ops_year')}-1)*${x.r('ramp')}${haircut ? `*(1-${x.i('traffic_haircut')})` : ''}`;

export const tollRoad: Module = {
  id: 'toll',
  name: 'Toll road or bridge',
  blurb: 'User-paid transport concession with traffic ramp-up, toll escalation and a lender traffic haircut. Loaded with the Confederation Bridge (Strait Crossing Development) from Sep 2017.',
  defaults: {
    start_year: { value: 2017, source: est('model starts at Sep 30, 2017, when DBRS reports $254.3 million of bonds; years run October to September', S17) },
    con_years: { value: 1, source: est('operating asset: one period holds the position at Sep 30, 2017') },
    ops_years: { value: 15, source: est('Oct 2017 to Sep 2032; the concession runs to 2032 (an end date of May 31, 2032, 35 years from opening, is inference), so the last period may run about four months long', WIKI) },
    capex: { value: 254.3, source: est('bonds outstanding at Sep 30, 2017. The price of the equity is not public, so equity is valued at a target IRR instead', S17) },
    capex_esc: { value: 0, source: est('already built') },
    capex_p1: { value: 1, source: est('one period') },
    capex_p2: { value: 0, source: est('already built') },
    capex_p3: { value: 0, source: est('already built') },
    other_costs: { value: 0, source: est('none') },
    cp: { value: 0, source: est('no completion payment') },
    cpi: { value: 0.02, source: BOC },
    tax_rate: { value: 0, source: est("SCDI's tax position is not public; the solved operating cost is net of any tax the DBRS DSCR reflects") },
    rate: { value: 0.0617, source: S17 },
    tenor: { value: 14, source: est('repaid by Sep 2031, inside the concession. 13 years fits the balances equally; 14 gives 2024 debt service of about $27.8 million, closest to reserves of "about $27 million", about one year of debt service', S24) },
    amort: { value: 1, source: est('fixed schedule: DBRS describes "accretive amortization of the bonds" (Nov 1, 2013)') },
    ds_growth: { value: 0.02, source: est('principal repaid $9.7m to Sep 2018 and $10.8m to Sep 2019 ($254.3m, $244.6m, $233.8m); with 6.17% interest, debt service rose from $25.4m to $25.9m, or 2.0%', S19) },
    dscr: { value: 1.4, source: { ...S19, note: 'DSCR 1.40x in 2018 as calculated by DBRS (1.35x under the indenture); the first and lowest year, so it sets the debt' } },
    max_gearing: { value: 1, source: est('not binding: debt is the bonds outstanding') },
    dsra_months: { value: 6, source: dbrs(361207, '2020', 'six-month debt service reserve account, fully funded') },
    lockup: { value: 1.1, source: est('distribution test not public; DBRS treats a DSCR at or below 1.10x as a downgrade trigger', S17) },
  },
  noEntry: "The price paid for the equity is not public, so this example shows what 100% of the equity was worth at a buyer's target IRR at Sep 30, 2017, not an IRR. The debt side is calibrated to DBRS figures below. The projection skips the 2020 to 2022 pandemic drop (2020 traffic was 56% of 2019), so values are before that loss.",
  inputs: [
    { id: 'traffic', label: 'Traffic in the first operating year once mature', unit: 'm trips / yr', value: 0.864434, fmt: 'num', group: g, source: { ...S19, note: '864,434 vehicles in 2018' } },
    { id: 'ramp_start', label: 'Ramp-up: first-year traffic as a share of mature traffic', unit: '%', value: 1, fmt: 'pct', group: g, source: est('operating since 1997: no ramp-up') },
    { id: 'ramp_years', label: 'Ramp-up period', unit: 'years', value: 1, fmt: 'int', min: 1, step: 1, group: g, source: est('operating since 1997: no ramp-up') },
    { id: 'traffic_growth', label: 'Traffic growth after ramp-up', unit: '% / yr', value: 0.0191, fmt: 'pct', group: g,
      source: est('growth from 864,434 in 2018 to 2023 traffic of 7% above 2019 (887,882), about 950,000. Skips the 2020 to 2022 pandemic drop; DBRS gives 2.6% a year for 2013 to 2023', S24) },
    { id: 'traffic_haircut', label: 'Lender traffic haircut (debt sizing case)', unit: '%', value: 0, fmt: 'pct', group: g, source: est('debt is sized to the 2018 DSCR on actual traffic, which reproduces the $254.3 million outstanding') },
    { id: 'toll', label: 'Average toll per trip (start-year dollars)', unit: 'C$', value: 46.5, fmt: 'num', group: g,
      source: est('two-axle toll in 2017: $45.50 from Jan 2015 (Trucknews, Dec 18, 2014) plus the $0.50 increases DBRS reports in 2017 and 2018 and $0.75 in 2019 give $46.50, $47.00, $47.75 (the 2016 step is inferred). Trucks pay $7.50 per extra axle, so the true average is higher; operating costs are solved net of that', S19) },
    { id: 'toll_index', label: 'Share of CPI that tolls rise by each year', unit: '%', value: 0.75, fmt: 'pct', group: g, source: S14 },
    { id: 'other_rev', label: 'Other revenue, e.g. government payments (start-year dollars, CPI-indexed)', unit: 'C$m / yr', value: 0, fmt: 'num', group: g,
      source: est('none in the base case. Toll freeze compensation ($2.5m in 2023, $4.5m in 2024) and the federal subsidy behind the Aug 2025 cut to $20 are taken to keep SCDI whole', S24) },
    { id: 'opex_t', label: 'Operating costs: tolling, maintenance, insurance (start-year dollars)', unit: 'C$m / yr', value: 6.1, fmt: 'num', group: g,
      source: est('not published; solved so the 2018 DSCR is 1.40x as DBRS calculated. Net of truck toll revenue above the two-axle rate, major maintenance and tax, so read it as a net figure, not a cost budget', S19) },
    { id: 'lifecycle_t', label: 'Major maintenance and lifecycle capex, annual average (start-year dollars)', unit: 'C$m / yr', value: 0, fmt: 'num', group: g, source: est('included in the net operating cost') },
  ],
  items: [
    row('ramp', 'Ramp-up factor', 'x', 'x',
      x => `${x.r('ops_flag')}*MIN(1,${x.i('ramp_start')}+(1-${x.i('ramp_start')})*MAX(0,${x.r('ops_year')}-1)/${x.i('ramp_years')})`),
    row('trips', 'Traffic (sponsor case; lender case in the base rows)', 'm trips', 'num', traffic(false), { fb: traffic(true) }),
    // Tolls grow at about a set share of CPI each year: toll x (CPI index)^share. Using the index row keeps the
    // lender case on base inflation and the actual case on the downside inflation path.
    row('toll_rate', 'Average toll', 'C$', 'num',
      x => `${x.r('ops_flag')}*${x.i('toll')}*(${x.r('index')})^${x.i('toll_index')}`),
    row('toll_rev', 'Toll revenue', 'C$m', 'num', x => `${x.r('trips')}*${x.r('toll_rate')}`, { role: 'revenue' }),
    row('other_rev_r', 'Other revenue', 'C$m', 'num', x => `${x.r('ops_flag')}*${x.i('other_rev')}*${x.r('index')}`, { role: 'revenue' }),
    row('opex_t_r', 'Operating costs', 'C$m', 'num', x => `${x.r('ops_flag')}*${x.i('opex_t')}*${x.r('index')}`, { role: 'opex' }),
    row('lc_t_r', 'Major maintenance and lifecycle capex', 'C$m', 'num', x => `${x.r('ops_flag')}*${x.i('lifecycle_t')}*${x.r('index')}`, { role: 'maint' }),
  ],
  bid: { input: 'toll', label: 'starting toll' },
  bidText: 'In a user-paid concession, bidders compete on the toll they need or on the payment they offer the grantor.',
};

// Model years end Sep 30, so a year's closing balance is the Sep 30 balance DBRS reports.
const at = (year: number, id: string) => ({ row }: { row: Record<string, number[]> }) => row[id][row.year.indexOf(year)];

tollRoad.checks = [
  { label: 'Revenue Bonds outstanding, Sep 30, 2017', published: 254.3, fmt: 'num', source: 'DBRS Nov 16, 2017', model: ({ scalar }) => scalar.debt },
  { label: 'Revenue Bonds outstanding, Sep 30, 2018', published: 244.6, fmt: 'num', source: 'DBRS Nov 2018', model: at(2018, 'debt_close') },
  { label: 'Revenue Bonds outstanding, Sep 30, 2019', published: 233.8, fmt: 'num', source: 'DBRS Nov 2019', model: at(2019, 'debt_close') },
  { label: 'DSCR, 2018', published: 1.4, fmt: 'x', source: 'DBRS Nov 2019 (DBRS calculation)', model: at(2018, 'dscr_actual') },
  { label: 'Traffic, 2019 (thousand vehicles)', published: 887.882, fmt: 'num', source: 'DBRS 2020: 887,882 vehicles', model: r => at(2019, 'trips')(r) * 1000 },
  { label: 'Two-axle toll, 2022 (C$)', published: 50.25, fmt: 'num', source: 'Wikipedia: $50.25 by January 2022', model: at(2022, 'toll_rate') },
  { label: 'DSCR, 2023', published: 1.62, fmt: 'x', source: 'Morningstar DBRS Nov 27, 2024', model: at(2023, 'dscr_actual'),
    info: 'Not used: 2023 includes $2.5m of toll freeze compensation and traffic regaining its pre-pandemic path, which one growth rate does not capture.' },
  { label: 'DSCR, 2025, DBRS rating case', published: 1.52, fmt: 'x', source: 'Morningstar DBRS Nov 27, 2024', model: at(2025, 'dscr_actual'),
    info: "Not used: the rating case rests on DBRS's own traffic and cost assumptions, which are not public." },
];
