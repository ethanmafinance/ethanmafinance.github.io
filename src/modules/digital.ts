// Data centres. Defaults reproduce the wholly owned portfolio of Blue Owl Digital Infrastructure Trust
// (12 US data centres, 235 MW) at its Sep 30, 2026 valuation, from the Q3 2026 10-Q, which publishes the gross
// asset value, the weighted discount and exit cap rates behind it, and how value moves for 25bp on each.
// Two inputs are not published and are solved: the rent escalator and the NOI margin. The Dec 31, 2025 portfolio
// in the 10-K is shown as an out-of-sample test. Full notes: research/digital-sources.md.
import type { Module } from '../engine/projectFinance.ts';
import type { Source } from '../engine/sheet.ts';

const Q3: Source = { title: 'Blue Owl Digital Infrastructure Trust, Form 10-Q for Sep 30, 2026', date: 'Nov 6, 2026', url: 'https://www.sec.gov/Archives/edgar/data/2069692/000206969226000069/osnl-20260930.htm' };
const K: Source = { title: 'Blue Owl Digital Infrastructure Trust, Form 10-K for 2025', date: 'Mar 11, 2026', url: 'https://www.sec.gov/Archives/edgar/data/2069692/000206969226000016/osnl-20251231.htm' };
const est = (note: string, base?: Source): Source => ({ ...(base ?? { title: '' }), est: true, note });
const s = (base: Source, note: string, page?: string): Source => ({ ...base, note, page });

// Lease expiry schedule, NTM rent in US$m (10-Q p.34). Year 1 = Q4 2026 plus 2027; year k = calendar 2026 + k.
const EXP = [2.799 + 13.41, 12.088, 16.806, 29.201, 36.2, 4.963, 0, 30.571, 7.116, 0];
const EXP_NOTE = ['2026 remaining ($2.8m) plus 2027 ($13.4m)', '2028', '2029', '2030', '2031', '2032', '2033 (none)', '2034', '2035', 'none listed: the $149.6m "thereafter" is assumed to expire after year 10'];

// Escalator: with a 10-year hold, all four published sensitivities round to the published figures only for an
// escalator of about 2.4% to 2.5%; the midpoint is used. Margin: solved so the value equals the published $4,289.9m.
export const ESC = 0.0245;
export const MARGIN = 0.81265;

// Dec 31, 2025 portfolio by region (10-K p.82 and p.87): NTM rent, discount rate, exit cap, published value.
const DEC25: [string, number, number, number, number][] = [
  ['Midwest', 54.944, 0.075, 0.059, 712.42], ['Southeast', 20.384, 0.082, 0.059, 586.42],
  ['Southwest', 41.805, 0.078, 0.060, 594.63], ['West', 107.867, 0.074, 0.061, 1398.62],
];
const level = (e: number, r: number, c: number, H = 10) => {
  let v = 0;
  for (let t = 1; t <= H; t++) v += (1 + e) ** (t - 1) / (1 + r) ** t;
  return v + (1 + e) ** H / c / (1 + r) ** H;
};
type R = { scalar: Record<string, number>; row: Record<string, number[]> };
const solvedOf = (r: R) => ({ e: r.row.idx[2] / r.row.idx[1] - 1, m: r.row.noi[1] / r.row.rent[1] });

export const digital: Module = {
  id: 'digital',
  name: 'Data centres',
  engine: 'lease',
  blurb: 'Leased data centre capacity valued the way appraisers and buyers do: a hold-period DCF of net operating income with rent escalators, lease rollover, lease-up and an exit cap rate. Loaded with Blue Owl Digital Infrastructure Trust\'s 235 MW US portfolio at Sep 30, 2026.',
  noEntry: 'Values the property portfolio (gross asset value), before the trust\'s debt.',
  inputs: [],
  items: [],
  defaults: {
    start_year: { value: 2027, source: est('valuation date Sep 30, 2026; year 1 is the twelve months to Sep 2027, labelled 2027', Q3) },
    hold: { value: 10, source: est('not published. A 10-year hold is the one at which the published sensitivities are reproduced (see the checks); it is also the usual appraisal convention') },
    mw: { value: 235, source: s(Q3, '12 wholly owned data centres, 235 MW of rentable capacity', '33') },
    occ: { value: 0.997, source: s(Q3, '99.7% of capacity leased', '14') },
    ntm: { value: 302.733, source: s(Q3, 'NTM base rent $302.733m; excludes executed leases whose rent has not started', '33') },
    margin: { value: MARGIN, source: est('not published; solved so the value equals the $4,289.9m gross asset value. Cross-check: Q3 2026 base rent $81.6m plus reimbursements $46.8m less property operating costs $65.9m is 76.5% of base rent (p.3 and p.24); the valuation also counts leases signed but not yet paying', Q3) },
    esc: { value: ESC, source: est('the 10-Q says leases have a fixed base rent that escalates annually but gives no rate. With a 10-year hold, 2.4% to 2.5% is the only range where all four published sensitivities round to the published figures; midpoint used', Q3) },
    ...Object.fromEntries(EXP.map((value, k) => [`exp_${k + 1}`, { value: +value.toFixed(3), source: s(Q3, `lease expirations by NTM rent: ${EXP_NOTE[k]}`, '34') }])),
    renew: { value: 1, source: est('not published; the 10-K says leases have initial terms of 10 years or more and often have renewal options. Base case: all renew at the escalated rent, so the solved escalator carries any re-leasing effect. Lower it to test rollover risk', { ...K, page: '15' }) },
    downtime: { value: 12, source: est('used only when renewals are below 100%; not published') },
    mtm: { value: 0, source: est('not published; base case renews at the escalated in-place rent') },
    lu_year: { value: 0, source: est('0.3% of capacity is vacant; not leased in the base case') },
    rate: { value: 0.077, source: s(Q3, 'weighted average discount rate for data centres, 7.7%', '40') },
    cap: { value: 0.061, source: s(Q3, 'weighted average capitalization rate, 6.1%', '40') },
    sell: { value: 0, source: est('not published; the published value is read as before selling costs') },
    price: { value: 4289.88, source: s(Q3, 'gross asset value at Sep 30, 2026, $4,289.880m; enter another price to see the IRR', '33') },
  },
  checks: [
    { label: 'Gross asset value, Sep 30, 2026 (NOI margin solved to match)', published: 4289.88, fmt: 'num', source: '10-Q p.33', model: ({ scalar }) => scalar.value },
    { label: 'Value change, discount rate 25bp lower', published: 0.019, fmt: 'pct', tol: 0.05 / 1.9, source: '10-Q p.40, +1.9%; published to 0.1pt, so it passes when the model rounds to it', model: ({ scalar }) => scalar.s_dr_dn },
    { label: 'Value change, discount rate 25bp higher', published: -0.018, fmt: 'pct', tol: 0.05 / 1.8, source: '10-Q p.40, (1.8)%, to 0.1pt', model: ({ scalar }) => scalar.s_dr_up },
    { label: 'Value change, exit cap 25bp lower', published: 0.024, fmt: 'pct', tol: 0.05 / 2.4, source: '10-Q p.40, +2.4%, to 0.1pt', model: ({ scalar }) => scalar.s_cap_dn },
    { label: 'Value change, exit cap 25bp higher', published: -0.022, fmt: 'pct', tol: 0.05 / 2.2, source: '10-Q p.40, (2.2)%, to 0.1pt', model: ({ scalar }) => scalar.s_cap_up },
    {
      label: 'Out of sample: Dec 31, 2025 portfolio (11 assets, NTM rent $225.0m) at that date\'s regional rates', published: 3292.09, fmt: 'num',
      source: '10-K p.82 and p.87',
      info: 'not used: same solved margin and escalator, each region at its own discount and cap rate. The total is within 1.4%, but regions miss by up to half (the Southeast was 95% leased with leases not yet paying), so it is shown as a test, not a match',
      model: r => { const { e, m } = solvedOf(r); return DEC25.reduce((a, [, n, rr, c]) => a + m * n * level(e, rr, c), 0); },
    },
  ],
};
