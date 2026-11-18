// Worked equity example: Fortis Inc. (TSX: FTS) valued on its own 2026-2030 capital plan.
// Company data is frozen at the build date (src/data/fts-2026-11-18.json, from scripts/equities.mjs), so the
// example and its checks do not move with the daily price refresh. Assumptions that differ from the
// mechanical defaults come from Fortis' guidance; each one shows its source.
import type { Answers, Company, Overrides } from '../engine/dcf.ts';
import type { Module } from '../engine/projectFinance.ts';
import type { Source } from '../engine/sheet.ts';
import data from '../data/fts-2026-11-18.json' with { type: 'json' };

const Q3: Source = { title: 'Fortis, Q3 2025 results and 2026-2030 capital plan (6-K, Exhibit 99.1)', date: 'Nov 4, 2025', url: 'https://www.sec.gov/Archives/edgar/data/1666175/000166617525000051/a2025q3ex991pressrelease.htm' };
const MDA: Source = { title: 'Fortis, 2025 Management Discussion and Analysis (40-F, Exhibit 99.3)', date: 'Feb 12, 2026', url: 'https://www.sec.gov/Archives/edgar/data/1666175/000166617526000013/a2025annual-993mda.htm' };
const est = (note: string, base?: Source): Source => ({ ...(base ?? { title: '' }), est: true, note });

// Mid-year rate base C$41.9bn (2025) to C$57.9bn (2030).
const RB_GROWTH = (57.9 / 41.9) ** (1 / 5) - 1;
const MARGIN = 3492 / 12170;

export const fortisEquity = {
  id: 'fortis',
  name: 'Fortis Inc. (FTS): DCF on the 2026-2030 capital plan',
  meta: 'Regulated electric and gas utility, TSX and NYSE, priced Nov 18, 2026',
  company: data as unknown as Company,
  answers: { years: 10, scenario: 'base', wacc: 'capm', terminal: 'growth' } as Answers,
  overrides: {
    years: { value: 10, source: est('five plan years (2026-2030) and five years of fade to terminal growth') },
    hold: { value: 5, source: est('the five years of the 2026-2030 capital plan run at plan growth before the fade', Q3) },
    g1: { value: +RB_GROWTH.toFixed(5), source: est('revenue grows with rate base: mid-year rate base C$41.9bn (2025) to C$57.9bn (2030) is 6.68% a year. Fortis rounds this to 7.0%', Q3) },
    m1: { value: +MARGIN.toFixed(5), source: est('FY2025 EBIT margin, held: revenue 12,170 less energy supply 3,371, operating expenses 3,250 and D&A 2,057, over revenue', MDA) },
    m_target: { value: +MARGIN.toFixed(5), source: est('held at FY2025: a regulated utility earns its allowed return, so the margin does not drift', MDA) },
    reinv1: { value: 0.93916, source: est('solved so 2026-2030 capex sums to the C$28.8bn plan. Fortis measures capex on its own basis (C$5,614m in 2025) against C$5,942m of property, plant and equipment in the cash flow statement', Q3) },
    ronic: { value: 0.06946, source: est('return on rate base: FY2025 NOPAT C$2,910m over 2025 mid-year rate base of C$41.9bn. New regulated capital earns the allowed return, which is above this WACC', Q3) },
  } as Overrides,
};

// Results columns: 0 = FY2023, 1 = FY2024, 2 = FY2025, 3.. = 2026E onward.
type R = { row: Record<string, number[]> };
const sum = (a: number[], from: number, to: number) => a.slice(from, to + 1).reduce((s, v) => s + v, 0);
export const fortisChecks: NonNullable<Module['checks']> = [
  { label: 'Revenue, FY2025', published: 12170, fmt: 'num', source: '2025 MD&A, operating results', model: ({ row }: R) => row.rev[2] },
  { label: 'Revenue, FY2024', published: 11508, fmt: 'num', source: '2025 MD&A, operating results', model: ({ row }: R) => row.rev[1] },
  { label: 'EBIT, FY2025 (revenue less energy supply, operating expenses, D&A)', published: 3492, fmt: 'num', source: '2025 MD&A: 12,170 - 3,371 - 3,250 - 2,057', model: ({ row }: R) => row.ebit[2] },
  { label: 'Depreciation and amortization, FY2025', published: 2057, fmt: 'num', source: '2025 MD&A, operating results', model: ({ row }: R) => row.da[2] },
  { label: 'Depreciation and amortization, FY2024', published: 1927, fmt: 'num', source: '2025 MD&A, operating results', model: ({ row }: R) => row.da[1] },
  { label: 'Capex 2026-2030 (reinvestment rate solved to match)', published: 28800, fmt: 'num', source: 'Q3 2025 release: 2026-2030 capital plan of $28.8 billion', model: ({ row }: R) => sum(row.capex, 3, 7) },
  { label: 'Revenue 2030 / 2025, against mid-year rate base 57.9 / 41.9', published: 57.9 / 41.9, fmt: 'x', source: 'Q3 2025 release: rate base $41.9 billion in 2025 to $57.9 billion by 2030', model: ({ row }: R) => row.rev[7] / row.rev[2] },
  { label: 'Capex, FY2025 on Fortis\' own measure', published: 5614, fmt: 'num', source: '2025 MD&A', info: 'Not used: the model uses cash paid for property, plant and equipment (C$5,942m), a different definition', model: ({ row }: R) => row.capex[2] },
];
