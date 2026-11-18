// Trading comparables from the same SEC data the DCF uses. Peer groups are the site's own sector grouping.
// EV = price x shares + debt - cash + non-controlling interests + preferred (the DCF's bridge); EBITDA = EBIT + D&A
// for the last fiscal year; P/E uses net income including non-controlling interests (us-gaap ProfitLoss when tagged).
import { debtOf, type Company } from './dcf.ts';

export const GROUPS: Record<string, string[]> = {
  'Regulated utilities': ['AEP', 'AWK', 'D', 'DUK', 'ED', 'EXC', 'FTS', 'NEE', 'SO', 'SRE', 'XEL'],
  'Pipelines and midstream': ['ENB', 'KMI', 'LNG', 'OKE', 'PBA', 'TRP', 'WMB'],
  'Towers and data centres': ['AMT', 'CCI', 'DLR', 'EQIX', 'SBAC'],
  'Railways': ['CP', 'CSX', 'NSC', 'UNP'],
  'Waste': ['RSG', 'WM'],
};
export const groupOf = (t: string) => Object.entries(GROUPS).find(([, ts]) => ts.includes(t))?.[0];

export type Comp = { ticker: string; name: string; ev: number; evEbitda?: number; evRev?: number; pe?: number; fy: string };
const v = (f: { v: number } | null | undefined) => f?.v ?? 0;
const lastOf = (a: ({ v: number } | null)[]) => a[a.length - 1];

export function comp(c: Company): Comp | undefined {
  const ebit = lastOf(c.hist.ebit), da = lastOf(c.hist.da), rev = lastOf(c.hist.rev), ni = lastOf(c.hist.ni);
  if (!c.price?.v || !c.shares?.v || !ebit) return undefined;
  const mcap = c.price.v * c.shares.v;
  const ev = mcap + debtOf(c).v - v(c.bal.cash) + v(c.bal.nci) + v(c.bal.pref);
  const ebitda = ebit.v + v(da);
  return {
    ticker: c.ticker, name: c.name, ev, fy: c.fyEnds[c.fyEnds.length - 1],
    evEbitda: da && ebitda > 0 ? ev / ebitda : undefined,
    evRev: rev && rev.v > 0 ? ev / rev.v : undefined,
    pe: ni && ni.v > 0 ? mcap / ni.v : undefined,
  };
}

export const median = (a: (number | undefined)[]) => {
  const s = a.filter((x): x is number => x !== undefined && Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return undefined;
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

// Value per share for the subject at a peer EV / EBITDA multiple, through the same bridge.
export function impliedPerShare(c: Company, multiple: number) {
  const ebitda = v(lastOf(c.hist.ebit)) + v(lastOf(c.hist.da));
  return (multiple * ebitda - debtOf(c).v + v(c.bal.cash) - v(c.bal.nci) - v(c.bal.pref)) / c.shares.v;
}
