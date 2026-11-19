// Regulated electricity distribution. Defaults reproduce Toronto Hydro-Electric System Limited's 2025-2029
// custom rate plan as approved by the Ontario Energy Board (EB-2023-0195): the settled plan (Aug 16, 2024),
// updated in the draft rate order (Nov 26, 2024) for the 2025 cost of capital and the 3.83% debt rate.
// Toronto Hydro is owned by the City of Toronto and has no public sale price, so the valuation shows what
// 100% of the equity would be worth at a buyer's target IRR. Full notes: research/utility-sources.md.
import type { Module } from '../engine/projectFinance.ts';
import type { Source } from '../engine/sheet.ts';

const SP: Source = { title: 'Toronto Hydro, Settlement Proposal, EB-2023-0195', date: 'Aug 16, 2024', url: 'https://torontohydro.com/documents/d/guest/settlement-proposal' };
const DRO: Source = { title: 'Toronto Hydro, Draft Rate Order, EB-2023-0195', date: 'Nov 26, 2024', url: 'https://www.rds.oeb.ca/CMWebDrawer/Record/873331/File/document' };
const DRO26: Source = { title: 'Ontario Energy Board, Decision and Rate Order, Toronto Hydro 2026 rates, EB-2025-0006', date: 'Dec 11, 2025', url: 'https://www.rds.oeb.ca/CMWebDrawer/Record/925317/File/document' };
const CRA: Source = { title: 'Canada Revenue Agency, corporation tax rates: federal 15% plus Ontario 11.5%', url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/corporations/corporation-tax-rates.html' };
const est = (note: string, base?: Source): Source => ({ ...(base ?? { title: '' }), est: true, note });
const s = (base: Source, note: string, page?: string): Source => ({ ...base, note, page });

const ISA = [616.3, 639.7, 726.5, 697.5, 778.0];
const DEP = [286.3, 297.9, 314.0, 332.6, 342.8];
const PILS = [28.1, 29.2, 20.6, 54.5, 46.4];
const plan = (id: string, vals: number[], src: (k: number) => Source) =>
  Object.fromEntries(vals.map((value, k) => [`${id}_${k + 1}`, { value, source: src(k) }]));

export const utility: Module = {
  id: 'utility',
  name: 'Regulated utility',
  engine: 'regulated',
  blurb: 'Electricity distribution under cost-of-service regulation: rate base, deemed capital structure, allowed ROE, revenue requirement and incentive rate-setting. Loaded with Toronto Hydro\'s OEB-approved 2025-2029 plan.',
  noEntry: "Toronto Hydro is owned by the City of Toronto and has no public sale price. The page values 100% of the equity at a buyer's target IRR and shows the IRR at a range of entry prices. Customers pay the deemed interest, so the debt rate moves revenue, not equity value. Equity value turns on the allowed ROE, how fast rate base grows, the stretch factor and the price at exit.",
  inputs: [],
  items: [],
  defaults: {
    start_year: { value: 2025, source: s(SP, 'first year of the 2025-2029 custom rate plan') },
    years: { value: 10, source: est('the five-year plan, then a second five-year plan (2030-2034) projected from the trends below, then exit') },
    nfa_open: { value: 5483.3, source: est('not published as one figure; solved so 2025 average net fixed assets equal the settled $5,648.3m: 5,648.3 less half of (2025 additions 616.3 less depreciation 286.3)', SP) },
    wca: { value: 231.3, source: s(SP, 'settled working capital allowance, $231.3m in each year 2025-2029 (Table 7). The draft rate order trims it slightly for the lower debt rate and PILs; held flat after 2029', '19') },
    ...plan('isa', ISA, () => s(SP, 'settled in-service additions, Table 9', '20')),
    ...plan('dep', DEP, () => s(SP, 'settled depreciation and amortization, Table 13', '22')),
    isa_growth: { value: 0.06, source: est('2025-2029 trend: settled additions grow from $616.3m to $778.0m, 6.0% a year, carried into 2030-2034. The next plan is not filed yet', SP) },
    eq_share: { value: 0.4, source: s(SP, 'deemed capital structure 40% common equity, 56% long-term debt, 4% short-term debt', '21') },
    ltd_share: { value: 0.56, source: s(SP, 'deemed 56% long-term debt', '21') },
    std_share: { value: 0.04, source: s(SP, 'deemed 4% short-term debt', '21') },
    roe: { value: 0.09, source: s(DRO26, 'for 2026-2029 Toronto Hydro updated its ROE to 9.00%, the final 2025 ROE from the generic cost of capital proceeding (EB-2024-0063). Held at 9.00% after the 2030 rebasing (est.): the OEB formula value for 2026 applications is 9.11% (EB-2025-0303, Oct 31, 2025), so this is slightly conservative', '8') },
    roe_y1: { value: 0.0925, source: s(DRO, '2025 rates used the interim 9.25% ROE, final for 2025 with no true-up (EB-2025-0006, p.8)', '3') },
    ltd_rate: { value: 0.0383, source: s(DRO, '2025-2029 long-term debt rate updated from 3.91% to 3.83% for the latest issuances; not subject to a variance account (EB-2025-0006, p.8)', '3') },
    std_rate: { value: 0.0391, source: s(DRO26, 'deemed short-term debt rate finalized at 3.91% for 2026-2029, replacing the interim 5.04%; held after 2029 (est.; the OEB 2026 formula value is 2.72%). Passed through to customers, so it does not move equity value', '8') },
    std_y1: { value: 0.0504, source: s(DRO, '2025 rates set on the interim deemed short-term debt rate of 5.04%; the variance to 3.91% is tracked in a deferral account', '3') },
    om_1: { value: 323.5, source: s(DRO, '2025 OM&A including property taxes, Table 1', '4') },
    om_growth: { value: 0.0241, source: s(DRO, 'agreed OM&A index of 2.41% (inflation plus OM&A growth factor)', '5') },
    ...plan('pils', PILS, k => k === 1
      ? s(DRO26, '2026 PILs at the 9.00% ROE, Table 4.1', '7')
      : k === 0 ? s(DRO, 'approved PILs, Table 1 (from the PILs model, which reflects the timing of tax depreciation)', '4')
        : est('approved PILs from the Nov 2024 draft rate order, set at the 9.25% ROE; the OEB has not republished 2027-2029 PILs at 9.00%, so these slightly overstate revenue. PILs pass through to customers and do not move net income', { ...DRO, page: '4' })),
    tax_rate: { value: 0.265, source: CRA },
    offset_1: { value: 48.2, source: s(DRO, '2025 revenue offsets, Table 1', '4') },
    offset_growth: { value: 0.02, source: s(SP, 'settled other revenue grows from $48.23m in 2025 to $52.21m in 2029, 2.0% a year (Table 15)', '23') },
    stretch: { value: 0.00775, source: est('solved: the stretch factor and the incremental stretch factor on capital reduce 2026-2029 revenue by $7.7m, $16.0m, $25.3m and $34.9m, about 0.775% of the base revenue requirement for each year since 2025', DRO) },
    savings: { value: 0, source: est('conservative: no cost savings beyond the plan, so the stretch reduction comes out of earnings. A utility that finds savings equal to the stretch earns the full allowed ROE') },
    target_irr: { value: 0.08, source: est("illustrative buyer's target for a core regulated asset; change it to test value") },
    entry_mult: { value: 1, source: est('hypothetical: Toronto Hydro is owned by the City of Toronto and has not been sold. 1.0x is book value of rate base') },
    exit_mult: { value: 1, source: est('book value of rate base at exit, conservative: no sale premium assumed') },
  },
};

// Year-column helper: results rows include an entry column (plan year 0), so 2025 is index 1.
const at = (year: number, id: string) => ({ row }: { row: Record<string, number[]> }) => row[id][row.year.indexOf(year)];

utility.checks = [
  { label: 'Average net fixed assets, 2027', published: 6344.8, fmt: 'num', source: 'Settlement Proposal, Table 7', model: at(2027, 'nfa_avg') },
  { label: 'Average net fixed assets, 2029', published: 7096.5, fmt: 'num', source: 'Settlement Proposal, Table 7', model: at(2029, 'nfa_avg') },
  { label: 'Rate base, 2025 (opening assets solved to match)', published: 5879.7, fmt: 'num', source: 'Settlement Proposal, Table 7', model: at(2025, 'rb') },
  { label: 'Rate base, 2029', published: 7327.9, fmt: 'num', source: 'Settlement Proposal, Table 7', model: at(2029, 'rb') },
  { label: 'Deemed interest expense, 2025', published: 137.8, fmt: 'num', source: 'Draft Rate Order, Table 1', model: at(2025, 'int_deemed') },
  { label: 'Deemed interest expense, 2029', published: 171.8, fmt: 'num', source: 'Draft Rate Order, Table 1', model: at(2029, 'int_deemed'),
    info: 'Not used: set at the interim 9.25% ROE and 5.04% short-term debt rate. The OEB updated 2026-2029 to 9.00% and 3.91% (EB-2025-0006, Dec 11, 2025), so this figure is superseded.' },
  { label: 'Return on equity, 2025', published: 217.5, fmt: 'num', source: 'Draft Rate Order, Table 1', model: at(2025, 'roe_ret') },
  { label: 'Return on equity, 2029', published: 271.1, fmt: 'num', source: 'Draft Rate Order, Table 1', model: at(2029, 'roe_ret'),
    info: 'Not used: set at the interim 9.25% ROE and 5.04% short-term debt rate. The OEB updated 2026-2029 to 9.00% and 3.91% (EB-2025-0006, Dec 11, 2025), so this figure is superseded.' },
  { label: 'OM&A, 2029', published: 355.8, fmt: 'num', source: 'Draft Rate Order, Table 1', model: at(2029, 'om') },
  { label: 'Service revenue requirement, 2025', published: 993.2, fmt: 'num', source: 'Draft Rate Order, Table 1', model: at(2025, 'srr') },
  { label: 'Service revenue requirement, 2027', published: 1071.3, fmt: 'num', source: 'Draft Rate Order, Table 1', model: at(2027, 'srr'),
    info: 'Not used: set at the interim 9.25% ROE and 5.04% short-term debt rate. The OEB updated 2026-2029 to 9.00% and 3.91% (EB-2025-0006, Dec 11, 2025), so this figure is superseded.' },
  { label: 'Service revenue requirement, 2029', published: 1188.0, fmt: 'num', source: 'Draft Rate Order, Table 1', model: at(2029, 'srr'),
    info: 'Not used: set at the interim 9.25% ROE and 5.04% short-term debt rate. The OEB updated 2026-2029 to 9.00% and 3.91% (EB-2025-0006, Dec 11, 2025), so this figure is superseded.' },
  { label: 'Base revenue requirement, 2025', published: 944.9, fmt: 'num', source: 'Draft Rate Order, Table 1', model: at(2025, 'brr') },
  { label: 'Revenue after stretch factors, 2026', published: 979.1, fmt: 'num', source: 'Draft Rate Order, Table 1', model: at(2026, 'dist_rev'),
    info: 'Not used: set at the interim 9.25% ROE and 5.04% short-term debt rate. The OEB updated 2026-2029 to 9.00% and 3.91% (EB-2025-0006, Dec 11, 2025), so this figure is superseded.' },
  { label: 'Revenue after stretch factors, 2029', published: 1100.9, fmt: 'num', source: 'Draft Rate Order, Table 1', model: at(2029, 'dist_rev'),
    info: 'Not used: set at the interim 9.25% ROE and 5.04% short-term debt rate. The OEB updated 2026-2029 to 9.00% and 3.91% (EB-2025-0006, Dec 11, 2025), so this figure is superseded.' },
  { label: '2025-2029 revenue after stretch factors, total', published: 5109.1, fmt: 'num', source: 'Draft Rate Order, Table 1',
    model: ({ row }) => row.dist_rev.reduce((a, v, k) => a + (row.plan_flag[k] ? v : 0), 0), info: 'Not used: set at the interim 9.25% ROE and 5.04% short-term debt rate. The OEB updated 2026-2029 to 9.00% and 3.91% (EB-2025-0006, Dec 11, 2025), so this figure is superseded.' },
  { label: 'Deemed interest expense, 2026 (3.91% short-term rate)', published: 143.0, fmt: 'num', source: 'EB-2025-0006 Decision and Rate Order, Table 4.1', model: at(2026, 'int_deemed') },
  { label: 'Return on equity, 2026 (9.00% ROE)', published: 223.9, fmt: 'num', source: 'EB-2025-0006 Decision and Rate Order, Table 4.1', model: at(2026, 'roe_ret') },
  { label: 'Capital-related revenue requirement, 2026 (interest, ROE, depreciation, PILs)', published: 694.0, fmt: 'num', source: 'EB-2025-0006 Decision and Rate Order, Table 4.1',
    model: ({ row }) => { const k = row.year.indexOf(2026); return row.int_deemed[k] + row.roe_ret[k] + row.dep[k] + row.pils[k]; } },
  { label: 'OM&A, 2026', published: 331.3, fmt: 'num', source: 'EB-2025-0006 Decision and Rate Order, Table 4.1', model: at(2026, 'om') },
];
