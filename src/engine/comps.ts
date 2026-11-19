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

// Peers from the comps file (public/data/eq/comps.json, one row per covered company).
export type Row = { ticker: string; sic: string; currency: string; mcap: number; ev: number; rev: number | null; ebitda: number | null; ni: number | null; fy: string; beta?: number | null;
  rev_f?: number | null; ni_f?: number | null };

// Next twelve months (NTM) revenue and earnings from analyst consensus: fiscal years 1 and 2 weighted by the share of year 1
// still to come at the price date, which puts companies with different year ends on one calendar. Null unless both years
// have estimates. Revenue uses consensus growth on the filed revenue; earnings = mean EPS x shares.
export function forward(c: Pick<Company, 'cons' | 'fyEnds' | 'price'>, lastRev: number, shares: number) {
  const [y1, y2] = c.cons?.rows ?? [];
  const f = Math.min(1, Math.max(0, (Date.parse(c.price.date) - Date.parse(c.fyEnds[c.fyEnds.length - 1])) / (365.25 * 864e5)));
  return {
    f,
    rev_f: y1?.g !== undefined && y2?.g !== undefined && lastRev > 0 ? lastRev * (1 + y1.g) * (1 - f + f * (1 + y2.g)) : null,
    ni_f: y1?.eps !== undefined && y2?.eps !== undefined ? ((1 - f) * y1.eps + f * y2.eps) * shares : null,
  };
}
export const rowsOf = (j: { fields: string[]; rows: unknown[][] }): Row[] => j.rows.map(r => Object.fromEntries(j.fields.map((f, k) => [f, r[k]])) as Row);
// Multiples with nonsense removed: negative denominators and values above 100x are not meaningful.
const ok = (v: number) => (Number.isFinite(v) && v > 0 && v <= 100 ? v : undefined);
export const multiples = (r: Row) => ({
  evEbitda: r.ebitda && r.ebitda > 0 ? ok(r.ev / r.ebitda) : undefined,
  evRev: r.rev && r.rev > 0 ? ok(r.ev / r.rev) : undefined,
  pe: r.ni && r.ni > 0 ? ok(r.mcap / r.ni) : undefined,
  peF: r.ni_f && r.ni_f > 0 ? ok(r.mcap / r.ni_f) : undefined,
  evRevF: r.rev_f && r.rev_f > 0 ? ok(r.ev / r.rev_f) : undefined,
});

// The site's curated group if there is one; otherwise companies with the same SIC industry code (4, then 3, then 2 digits)
// until at least 5 qualify, keeping the 10 closest in market value.
export function pickPeers(self: Row, rows: Row[], n = 10): { peers: Row[]; basis: string } {
  const group = groupOf(self.ticker);
  if (group) return { peers: rows.filter(r => GROUPS[group].includes(r.ticker) && r.ticker !== self.ticker), basis: `the site's ${group.toLowerCase()} group` };
  if (!self.sic) return { peers: [], basis: 'no industry code in the SEC data' };
  for (const d of [4, 3, 2]) {
    const code = self.sic.slice(0, d);
    const c = rows.filter(r => r.ticker !== self.ticker && r.sic?.startsWith(code) && r.mcap > 0 && r.ev > 0);
    if (c.length >= 5 || d === 2) {
      const dist = (r: Row) => Math.abs(Math.log(r.mcap / Math.max(self.mcap, 1)));
      return { peers: c.sort((a, b) => dist(a) - dist(b)).slice(0, n), basis: `SEC industry code ${code}${d < 4 ? ` (first ${d} digits of ${self.sic})` : ''}, the ${Math.min(n, c.length)} closest in market value` };
    }
  }
  return { peers: [], basis: '' };
}
