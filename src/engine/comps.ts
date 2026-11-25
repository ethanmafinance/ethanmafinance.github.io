// Trading comparables from the same SEC data the DCF uses. Peer groups are the site's own sector grouping.
// EV = price x shares + debt - cash + non-controlling interests + preferred (the DCF's bridge); EBITDA = EBIT + D&A
// for the last fiscal year; P/E uses net income including non-controlling interests (us-gaap ProfitLoss when tagged).
import { debtOf, type Company } from './dcf.ts';

// Curated by business model for the infrastructure names and the largest companies covered, where the industry label
// gives the wrong peers (Shell's SEC code 1311 matches US shale producers; Yahoo puts Uber with Salesforce, Spotify with
// Baidu, Honeywell with small holding companies). Each group has at least 4 covered members, so every member has 3 or
// more peers; checked against the live comps file on 2026-11-25. Everyone else is matched on industry (pickPeers).
export const GROUPS: Record<string, string[]> = {
  'Regulated utilities': ['AEP', 'AWK', 'D', 'DUK', 'ED', 'EMA', 'EXC', 'FTS', 'NEE', 'SO', 'SRE', 'XEL'],
  'Pipelines and midstream': ['ENB', 'EPD', 'KMI', 'LNG', 'MPLX', 'OKE', 'PBA', 'TRGP', 'TRP', 'WMB'],
  'Renewable power': ['AES', 'BEPC', 'CWEN', 'ENLT', 'ORA', 'XIFR'],
  'Towers and data centres': ['AMT', 'CCI', 'DLR', 'EQIX', 'SBAC'],
  'Railways': ['CNI', 'CP', 'CSX', 'NSC', 'UNP'],
  'Waste': ['CWST', 'GFL', 'RSG', 'WCN', 'WM'],
  'Megacap technology': ['AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT'],
  'Semiconductors': ['ADI', 'AMD', 'ARM', 'AVGO', 'INTC', 'MCHP', 'MRVL', 'NVDA', 'NXPI', 'ON', 'QCOM', 'TXN'],
  'Memory and storage': ['MU', 'SNDK', 'STX', 'WDC'],
  'Computer hardware': ['DELL', 'HPQ', 'NTAP', 'SMCI'],
  'Semiconductor equipment': ['AMAT', 'ASML', 'KLAC', 'LRCX', 'TER'],
  'Enterprise software': ['ADBE', 'ADSK', 'CDNS', 'CRM', 'DDOG', 'INTU', 'NOW', 'ORCL', 'PLTR', 'SAP', 'SNOW', 'SNPS', 'TEAM', 'WDAY'],
  'Security and network software': ['CRWD', 'FTNT', 'NET', 'OKTA', 'PANW', 'ZS'],
  'Networking equipment': ['ANET', 'CIEN', 'CSCO', 'HPE'],
  'E-commerce software': ['CMRC', 'GDDY', 'SHOP', 'WIX'],
  'Ad tech': ['APP', 'CRTO', 'DV', 'MGNI', 'PUBM', 'TTD'],
  'Ride-hailing and delivery': ['CART', 'DASH', 'GRAB', 'LYFT', 'UBER'],
  'Streaming and entertainment': ['DIS', 'NFLX', 'SIRI', 'SPOT'],
  'IT services': ['ACN', 'CTSH', 'EPAM', 'IBM', 'IT'],
  'Payments': ['AFRM', 'CPAY', 'FIS', 'FISV', 'FOUR', 'GPN', 'MA', 'PYPL', 'V', 'XYZ'],
  'Healthcare software and data': ['CERT', 'DOCS', 'GDRX', 'HQY', 'VEEV', 'WAY'],
  'Pharmaceuticals': ['ABBV', 'AMGN', 'AZN', 'BMY', 'GILD', 'JNJ', 'LLY', 'MRK', 'NVO', 'PFE', 'REGN', 'VRTX'],
  'Medical devices': ['ABT', 'BDX', 'BSX', 'EW', 'ISRG', 'MDT', 'SYK'],
  'Life science tools': ['A', 'DHR', 'IQV', 'MTD', 'TMO', 'WAT'],
  'Beverages': ['BUD', 'KDP', 'KO', 'MNST', 'PEP', 'STZ'],
  'Household products': ['CHD', 'CL', 'CLX', 'KMB', 'PG', 'UL'],
  'Packaged food': ['CAG', 'CPB', 'GIS', 'HRL', 'HSY', 'KHC', 'MDLZ', 'MKC', 'SJM'],
  'Tobacco': ['BTI', 'MO', 'PM', 'TPB'],
  'Big-box retail': ['BJ', 'COST', 'DG', 'DLTR', 'TGT', 'WMT'],
  'Restaurants': ['CMG', 'DRI', 'MCD', 'QSR', 'SBUX', 'YUM'],
  'Cruise lines': ['CCL', 'NCLH', 'RCL', 'VIK'],
  'Travel and lodging': ['ABNB', 'BKNG', 'EXPE', 'HLT', 'MAR'],
  'Integrated oil and gas': ['BP', 'CVE', 'CVX', 'E', 'EQNR', 'IMO', 'SHEL', 'SU', 'TTE'],
  'Oil and gas producers': ['CNQ', 'COP', 'DVN', 'EOG', 'FANG', 'OVV', 'OXY'],
  'Refining': ['DK', 'MPC', 'PBF', 'PSX', 'VLO'],
  'Mining': ['BHP', 'FCX', 'NEM', 'RIO', 'SCCO', 'TECK'],
  'AI cloud and data centre hosts': ['APLD', 'CIFR', 'CORZ', 'CRWV', 'IREN', 'NBIS', 'WULF'],
  'Bitcoin miners': ['ABTC', 'BTBT', 'CLSK', 'HIVE', 'HUT', 'MARA', 'RIOT'],
  'Telecom carriers': ['BCE', 'CHTR', 'CMCSA', 'RCI', 'T', 'TMUS', 'TU', 'VZ'],
  'Aerospace and defence': ['BA', 'GD', 'GE', 'HWM', 'LMT', 'NOC', 'RTX', 'TDG'],
  'Machinery': ['CAT', 'CMI', 'DE', 'PCAR', 'WAB'],
  'Diversified industrials': ['AME', 'DOV', 'HON', 'ITW', 'MMM', 'PH'],
  'Electrical and grid equipment': ['EMR', 'ETN', 'GEV', 'HUBB', 'PWR', 'ROK', 'VRT'],
  'Uniform and facility services': ['ABM', 'ARMK', 'CTAS', 'UNF', 'VSTS'],
  'Information services': ['BR', 'EFX', 'FDS', 'RELX', 'TRI', 'TRU', 'VRSK'],
  'Exchanges and data': ['CBOE', 'CME', 'ICE', 'MCO', 'MSCI', 'NDAQ', 'SPGI'],
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
export type Row = { ticker: string; sic: string; ind?: string; currency: string; mcap: number; ev: number; rev: number | null; ebitda: number | null; ni: number | null; fy: string; beta?: number | null;
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

// Peers, in order of preference:
// 1. the site's curated group, where the industry label alone gives the wrong peers;
// 2. companies in the same Yahoo Finance industry (about 140 industries, finer than the SEC code: Doximity is
//    "Health Information Services" with Veeva, not SEC code 7371 with quantum computing start-ups), the 10 closest in
//    size and profitability: distance = |ln(market cap ratio)| + 10 x |EBITDA margin difference|, so a 10pt margin gap
//    counts like a 2.7x size gap (multiples follow margins more than size);
// 3. the same 4-digit SEC industry code, when Yahoo has no industry for the company.
// Fewer than 3 matches: no peers. A short list of relevant companies beats a full list of unrelated ones, so the code
// is never widened to 3 or 2 digits.
const MIN_PEERS = 3;
const marginOf = (r: Row) => (r.rev && r.rev > 0 && r.ebitda != null ? Math.min(1, Math.max(-1, r.ebitda / r.rev)) : undefined);
export function pickPeers(self: Row, rows: Row[], n = 10): { peers: Row[]; basis: string } {
  const group = groupOf(self.ticker);
  if (group) {
    const peers = rows.filter(r => GROUPS[group].includes(r.ticker) && r.ticker !== self.ticker);
    if (peers.length >= MIN_PEERS) return { peers, basis: `the site's ${group[0].toLowerCase() + group.slice(1)} group` };
  }
  const live = (r: Row) => r.ticker !== self.ticker && r.mcap > 0 && r.ev > 0;
  const m0 = marginOf(self);
  const dist = (r: Row) => { const m = marginOf(r); return Math.abs(Math.log(r.mcap / Math.max(self.mcap, 1))) + (m0 === undefined || m === undefined ? 5 : 10 * Math.abs(m - m0)); };
  const closest = (c: Row[]) => [...c].sort((a, b) => dist(a) - dist(b)).slice(0, n);
  if (self.ind) {
    const c = rows.filter(r => live(r) && r.ind === self.ind);
    if (c.length >= MIN_PEERS) return { peers: closest(c), basis: `Yahoo Finance industry "${self.ind}", the ${Math.min(n, c.length)} closest in market value and EBITDA margin${c.length > n ? ` of ${c.length}` : ''}` };
    return { peers: [], basis: `only ${c.length} other covered ${c.length === 1 ? 'company is' : 'companies are'} in its Yahoo Finance industry ("${self.ind}"), fewer than the 3 needed` };
  }
  if (!self.sic) return { peers: [], basis: 'no industry in the Yahoo Finance or SEC data' };
  const c = rows.filter(r => live(r) && r.sic === self.sic);
  if (c.length >= MIN_PEERS) return { peers: closest(c), basis: `SEC industry code ${self.sic} (no Yahoo Finance industry), the ${Math.min(n, c.length)} closest in market value and EBITDA margin` };
  return { peers: [], basis: `fewer than 3 covered companies share its SEC industry code ${self.sic}, and Yahoo Finance gives no industry` };
}
