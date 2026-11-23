// Worked equity example: Microsoft (NASDAQ: MSFT), a large growth company, valued on analyst consensus for the next two
// fiscal years and its own FY2026 10-K for everything else. Company data is frozen at the build date
// (src/data/msft-2026-11-23.json, from scripts/equities.mjs), so the example and its checks do not move with the daily
// refresh. Only the forecast length differs from the mechanical defaults; every other input shows its own source.
import type { Answers, Company, Overrides } from '../engine/dcf.ts';
import type { Module } from '../engine/projectFinance.ts';
import data from '../data/msft-2026-11-23.json' with { type: 'json' };

const AM26 = 4700; // FY2026 intangible amortization, 10-K intangible assets note; the model runs on EBITA and depreciation

export const msftEquity = {
  id: 'microsoft',
  name: 'Microsoft (MSFT): DCF on analyst consensus and the FY2026 10-K',
  meta: 'Cloud and software, 18% revenue growth in FY2026, NASDAQ, priced Nov 23, 2026',
  company: data as unknown as Company,
  answers: { years: 10, scenario: 'base', wacc: 'capm', terminal: 'growth' } as Answers,
  overrides: {
    years: { value: 10, source: { title: '', est: true, note: 'ten years, not five: revenue grew 18% in FY2026 and consensus has about 20% for FY2027 and FY2028, so a five-year fade to terminal growth would end growth too early' } },
  } as Overrides,
};

// Results columns: 0 = FY2024, 1 = FY2025, 2 = FY2026, 3.. = FY2027E onward.
type R = { row: Record<string, number[]> };
export const msftChecks: NonNullable<Module['checks']> = [
  { label: 'Revenue, FY2026', published: 331839, fmt: 'num', source: 'FY2026 10-K, income statements', model: ({ row }: R) => row.rev[2] },
  { label: 'Revenue, FY2025', published: 281724, fmt: 'num', source: 'FY2026 10-K, income statements', model: ({ row }: R) => row.rev[1] },
  { label: 'Operating income, FY2026 (model EBITA less 4,700 intangible amortization)', published: 155237, fmt: 'num', source: 'FY2026 10-K, income statements', model: ({ row }: R) => row.ebit[2] - AM26 },
  { label: 'Depreciation and amortization, FY2026 (model depreciation plus 4,700 intangible amortization)', published: 34300 + AM26, fmt: 'num', source: 'FY2026 10-K notes: depreciation expense $34.3 billion; intangible assets amortization expense $4.7 billion', model: ({ row }: R) => row.da[2] + AM26 },
  { label: 'Capex, FY2026 (additions to property and equipment)', published: 115948, fmt: 'num', source: 'FY2026 10-K, cash flows statements', model: ({ row }: R) => row.capex[2] },
  { label: 'Revenue growth, FY2027 (analyst consensus)', published: 0.19325, fmt: 'pct', source: 'Yahoo Finance, mean of 47 analysts, Nov 23, 2026', model: ({ row }: R) => row.growth[3] },
  { label: 'Revenue growth, FY2028 (analyst consensus)', published: 0.20657, fmt: 'pct', source: 'Yahoo Finance, mean of 54 analysts, Nov 23, 2026', model: ({ row }: R) => row.growth[4] },
  { label: 'Capex, FY2027 forecast against FY2026', published: 115948, fmt: 'num', source: 'FY2026 10-K, cash flows statements', info: 'Not a target: the model sets capex from the 3-year average reinvestment rate, so FY2027 capex falls 10% from the FY2026 peak. Microsoft gives no annual capex guidance in its filings', model: ({ row }: R) => row.capex[3] },
];
