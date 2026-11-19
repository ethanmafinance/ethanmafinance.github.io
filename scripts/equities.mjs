// Builds public/data/eq/<TICKER>.json for the equity DCF from free public data:
//   SEC EDGAR XBRL company facts (annual 10-K, 20-F, 40-F figures, each tagged with its filing),
//   Yahoo Finance chart data (last close, 5 years of monthly closes for beta),
//   US Treasury daily par yield curve and Bank of Canada Valet (10-year risk-free rates).
// The site is static and neither SEC nor Yahoo allow browser requests, so this runs ahead of time
// (locally or in the scheduled GitHub Action) and the site reads the JSON.
// Usage: node scripts/equities.mjs [TICKER ...] [--all] [--limit=N]   (no tickers = the UNIVERSE list below)
// Env: FACTS_ZIP / SUBS_ZIP = paths to SEC companyfacts.zip and submissions.zip (bulk, used by the daily job); OUT_DIR = write somewhere other than public/data/eq.
// --all covers every US-listed common stock (Nasdaq screener), writes coverage.json with the reason for each one left out.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pickPeers, rowsOf } from '../src/engine/comps.ts';

// SEC asks automated clients for a name and contact email in the User-Agent; set SEC_UA to your own.
const UA = process.env.SEC_UA || 'infrastructure-investment-modeling-platform contact@example.com';
const OUT = process.env.OUT_DIR ? new URL(`file:///${process.env.OUT_DIR.replace(/\\/g, '/').replace(/\/?$/, '/')}`) : new URL('../public/data/eq/', import.meta.url);

// Curated list (always built first). With --all, every other NYSE and Nasdaq SEC filer is added, one ticker per company.
export const UNIVERSE = [
  // Canadian infrastructure and utilities that file with the SEC
  'ENB', 'TRP', 'PBA', 'FTS', 'CP', 'BN', 'TU',
  // Not usable in XBRL as of 2026-11-18: BIP, BEP, BAM (no current share count), CNI (6-K data only),
  // BCE and AQN (no annual data after 2017), XOM (ticker now maps to a new registrant), V (no share count).
  // US utilities, towers, data centres, midstream, rail, water, waste
  'NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'XEL', 'ED', 'AWK',
  'AMT', 'CCI', 'SBAC', 'EQIX', 'DLR', 'KMI', 'WMB', 'OKE', 'LNG', 'UNP', 'CSX', 'NSC', 'WM', 'RSG',
  // Large caps
  // (no banks or insurers: an unlevered DCF does not fit them)
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'JNJ', 'PG', 'WMT', 'COST', 'HD', 'KO',
];
// TSX symbols that differ from the US ticker (CAD reporters are priced on the TSX).
const TSX = { PBA: 'PPL', TU: 'T', CNI: 'CNR' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, json = true, tries = 3) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': url.includes('sec.gov') ? UA : 'Mozilla/5.0', 'Accept-Encoding': 'gzip' } });
    if (res.ok) return json ? res.json() : res.text();
    if (i >= tries || res.status === 404) throw new Error(`${res.status} ${url}`);
    await sleep(1000 * i);
  }
}

// Each metric: XBRL concepts in priority order (US GAAP, then IFRS). Flows are annual; 'i' = balance at year end.
const FLOW = {
  rev: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RegulatedAndUnregulatedOperatingRevenue', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense', 'Revenue', 'RevenueFromContractsWithCustomers', 'SalesRevenueGoodsNet', 'SalesRevenueServicesNet'],
  ebit: ['OperatingIncomeLoss', 'ProfitLossFromOperatingActivities'],
  da: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAmortizationAndOther', 'Depreciation', 'DepreciationAndAmortisationExpense', 'DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements', 'PaymentsToAcquireOtherPropertyPlantAndEquipment', 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
  cfo: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'CashFlowsFromUsedInOperatingActivities'],
  pretax: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments', 'ProfitLossBeforeTax'],
  tax: ['IncomeTaxExpenseBenefit', 'IncomeTaxExpenseContinuingOperations'],
  ni: ['NetIncomeLoss', 'ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'],
  int: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt', 'InterestAndDebtExpense', 'FinanceCosts',
    // cash interest paid, when the income statement line is not tagged
    'InterestPaidNet', 'InterestPaid', 'InterestPaidClassifiedAsOperatingActivities'],
};
const BAL = {
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalents', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  // Debt: one total if tagged, otherwise long-term (non-current) plus current portion plus short-term borrowings.
  debt_total: ['LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities', 'DebtLongtermAndShorttermCombinedAmount', 'LongTermDebt', 'Borrowings'],
  ltd: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'LongTermDebtAndFinanceLeaseObligationsNoncurrent', 'NoncurrentPortionOfNoncurrentBorrowings'],
  ltd_cur: ['LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent', 'CurrentPortionOfLongtermBorrowings'],
  std: ['ShortTermBorrowings', 'CommercialPaper', 'ShorttermBorrowings'],
  nci: ['MinorityInterest', 'NoncontrollingInterestInConsolidatedEntity', 'NoncontrollingInterests'],
  pref: ['PreferredStockValue', 'PreferredStockValueOutstanding', 'PreferredStockIncludingAdditionalPaidInCapital'],
};
// Annual reports; 6-K too, because some 40-F filers (e.g. CN Rail) tag their full-year results only there. Flows must span a full year.
const ANNUAL = /^(10-K|20-F|40-F|6-K)/;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

// Annual values by fiscal year end, from the latest filing that reports that year (restatements win).
function series(facts, concept, cur, instant) {
  for (const ns of ['us-gaap', 'ifrs-full']) {
    const units = facts[ns]?.[concept]?.units?.[cur];
    if (!units) continue;
    const byEnd = {};
    for (const f of units) {
      if (!ANNUAL.test(f.form)) continue;
      if (!instant && (!f.start || Math.abs(days(f.start, f.end) - 365) > 20)) continue;
      if (instant && f.start) continue;
      if (!byEnd[f.end] || f.filed > byEnd[f.end].filed) byEnd[f.end] = f;
    }
    if (Object.keys(byEnd).length) return { concept: `${ns}:${concept}`, byEnd };
  }
}
const firstSeries = (facts, list, cur, instant) => { for (const c of list) { const s = series(facts, c, cur, instant); if (s) return s; } };

const link = (cik, accn) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, '')}/`;

// Prices: Yahoo spark endpoint, up to 20 symbols a call, 5 years of monthly closes (split-adjusted, not dividend-adjusted).
async function spark(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 20) {
    const chunk = symbols.slice(i, i + 20);
    try {
      const d = await get(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${chunk.map(encodeURIComponent).join(',')}&range=5y&interval=1mo`);
      for (const r of d.spark?.result ?? []) {
        const x = r.response?.[0];
        if (!x?.timestamp || !x.meta?.regularMarketPrice) continue;
        out[r.symbol] = { meta: x.meta, t: x.timestamp.map(s => new Date(s * 1000).toISOString().slice(0, 10)), close: x.indicators.quote[0].close };
      }
    } catch (e) { console.log(`prices failed for ${chunk.join(',')}: ${e.message}`); }
    await sleep(400);
  }
  return out;
}

// Beta: slope of 60 monthly price returns on the stock against the local index (S&P 500 or S&P/TSX Composite).
function beta(a, b, index) {
  const ib = Object.fromEntries(b.t.map((t, k) => [t.slice(0, 7), b.close[k]]));
  const pairs = a.t.map((t, k) => [a.close[k], ib[t.slice(0, 7)]]).filter(([x, y]) => x != null && y != null);
  pairs.pop(); // drop the current, incomplete month
  const ra = [], rb = [];
  for (let k = 1; k < pairs.length; k++) { ra.push(pairs[k][0] / pairs[k - 1][0] - 1); rb.push(pairs[k][1] / pairs[k - 1][1] - 1); }
  const n = ra.length;
  if (n < 24) return { value: 1, months: n, index, from: a.t[0].slice(0, 7), to: a.t.at(-1).slice(0, 7), basis: `market beta of 1.0: only ${n} months of trading, fewer than the 24 needed for a regression` };
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let cov = 0, vb = 0;
  for (let k = 0; k < n; k++) { cov += (ra[k] - ma) * (rb[k] - mb); vb += (rb[k] - mb) ** 2; }
  return { value: +(cov / vb).toFixed(3), months: n, index, from: a.t[0].slice(0, 7), to: a.t.at(-2).slice(0, 7), basis: 'monthly price returns' };
}

// Company facts: from the SEC bulk file when FACTS_ZIP points at companyfacts.zip (the daily job), else the API.
async function factsOf(cik) {
  if (process.env.FACTS_ZIP) return JSON.parse(execFileSync('unzip', ['-p', process.env.FACTS_ZIP, `CIK${cik}.json`], { maxBuffer: 1 << 30 }).toString());
  return get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
}
// Industry (SIC code) from the SEC submissions file: SUBS_ZIP = path to submissions.zip, else the API. Used to pick peers.
async function sicOf(cik) {
  try {
    const d = process.env.SUBS_ZIP
      ? JSON.parse(execFileSync('unzip', ['-p', process.env.SUBS_ZIP, `CIK${cik}.json`], { maxBuffer: 1 << 28 }).toString())
      : await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
    return d.sic ? { sic: d.sic, sicDesc: d.sicDescription } : {};
  } catch { return {}; }
}

async function rates() {
  const year = new Date().getUTCFullYear();
  const csv = await get(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`, false);
  const [head, row] = csv.trim().split('\n');
  const col = head.split(',').map(s => s.replace(/"/g, '')).indexOf('10 Yr');
  const [m, d, y] = row.split(',')[0].split('/');
  const boc = await get('https://www.bankofcanada.ca/valet/observations/BD.CDN.10YR.DQ.YLD/json?recent=1');
  const o = boc.observations[0];
  return {
    USD: { value: +row.split(',')[col] / 100, date: `${y}-${m}-${d}`, title: 'US Treasury daily par yield curve, 10-year', url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve' },
    CAD: { value: +o['BD.CDN.10YR.DQ.YLD'].v / 100, date: o.d, title: 'Bank of Canada, Government of Canada 10-year benchmark bond yield', url: 'https://www.bankofcanada.ca/rates/interest-rates/canadian-bonds/' },
  };
}

// Step 1 (no prices): everything from the filings. Returns the record and the Yahoo symbol to price it on.
async function build(ticker, cikOf) {
  const co = cikOf[ticker];
  if (!co) throw new Error('not an SEC filer');
  const cik = String(co.cik_str).padStart(10, '0');
  const { facts, entityName } = await factsOf(cik);
  if (!facts) throw new Error('no XBRL facts');
  // Banks and insurers: an unlevered DCF does not fit them.
  const BANK = { 'us-gaap': ['InterestExpenseDeposits', 'NoninterestIncome', 'PremiumsEarnedNet', 'PolicyholderBenefitsAndClaimsIncurredNet'], 'ifrs-full': ['DepositsFromBanks', 'InsuranceContractsThatAreLiabilities', 'LiabilitiesArisingFromInsuranceContracts'] };
  if (Object.entries(BANK).some(([ns, list]) => list.some(c => facts[ns]?.[c]))) throw new Error('bank or insurer');
  // Reporting currency: the unit revenue is tagged in.
  // (the unit of the most recent full-year revenue fact: companies change reporting currency, e.g. Nebius from RUB to USD)
  let cur, curEnd = '';
  for (const c of FLOW.rev) for (const ns of ['us-gaap', 'ifrs-full']) for (const [u, a] of Object.entries(facts[ns]?.[c]?.units ?? {}))
    for (const f of a) if (ANNUAL.test(f.form) && f.start && Math.abs(days(f.start, f.end) - 365) <= 20 && f.end > curEnd) { curEnd = f.end; cur = u; }
  if (!cur) throw new Error('no revenue');
  if (!/^[A-Z]{3}$/.test(cur)) throw new Error(`revenue tagged in ${cur}`);

  // Per year, the highest-priority concept that year was tagged with (companies switch tags over time).
  const merged = (list, units, instant) => {
    const out = { byEnd: {} };
    for (const c of list) { const s = series(facts, c, units, instant); if (!s) continue; for (const [e, f] of Object.entries(s.byEnd)) out.byEnd[e] ??= { ...f, concept: s.concept }; }
    return out;
  };
  const flows = Object.fromEntries(Object.entries(FLOW).map(([k, l]) => [k, merged(l, cur, false)]));
  const rev = flows.rev;
  const ends = Object.keys(rev.byEnd).sort().slice(-5);
  if (ends.length < 2) throw new Error('fewer than 2 years of annual revenue');
  if (days(ends.at(-1), new Date().toISOString().slice(0, 10)) > 550) throw new Error(`latest annual XBRL data is for ${ends.at(-1)}`);
  const hist = {};
  for (const [k, s] of Object.entries(flows)) {
    hist[k] = ends.map(e => {
      const f = s?.byEnd[e];
      return f ? { v: +(f.val / 1e6).toFixed(3), concept: f.concept, form: f.form, filed: f.filed, url: link(co.cik_str, f.accn) } : null;
    });
  }

  const lastEnd = ends.at(-1);
  const bal = {};
  for (const [k, l] of Object.entries(BAL)) {
    const s = firstSeries(facts, l, cur, true);
    const f = s?.byEnd[lastEnd];
    bal[k] = f ? { v: +(f.val / 1e6).toFixed(3), concept: s.concept, form: f.form, filed: f.filed, url: link(co.cik_str, f.accn) } : null;
  }

  // Shares: latest cover-page count (all classes on that date) if it is recent; otherwise diluted weighted
  // average shares for the last fiscal year (some 20-F and 40-F filers stop updating the cover tag).
  let shares;
  const dei = facts.dei?.EntityCommonStockSharesOutstanding?.units?.shares;
  if (dei?.length) {
    const latest = dei.reduce((a, f) => (f.end > a ? f.end : a), '');
    const on = dei.filter(f => f.end === latest);
    const filed = on.reduce((a, f) => (f.filed > a ? f.filed : a), '');
    const use = on.filter(f => f.filed === filed);
    if (days(lastEnd, latest) > -120) shares = { v: +(use.reduce((s, f) => s + f.val, 0) / 1e6).toFixed(3), asOf: latest, concept: 'dei:EntityCommonStockSharesOutstanding', form: use[0].form, url: link(co.cik_str, use[0].accn) };
  }
  const dilLast = merged(['WeightedAverageNumberOfDilutedSharesOutstanding', 'AdjustedWeightedAverageShares', 'WeightedAverageNumberOfSharesOutstandingBasicAndDiluted', 'WeightedAverageNumberOfSharesOutstandingBasic', 'WeightedAverageShares'], 'shares', false).byEnd[lastEnd];
  if (!shares && dilLast) shares = { v: +(dilLast.val / 1e6).toFixed(3), asOf: lastEnd, concept: dilLast.concept + ' (diluted weighted average)', form: dilLast.form, url: link(co.cik_str, dilLast.accn) };

  // CAD reporters are priced on the TSX in CAD; everyone else on the US listing in USD (other currencies are translated, see priced()).
  const sym = cur === 'CAD' ? `${TSX[ticker] ?? ticker.replace(/-/g, '.')}.TO` : ticker.replace(/\./g, '-');
  const foreign = Object.values(hist.rev).some(f => f && /^(20-F|40-F|6-K)/.test(f.form));
  return { sym, rec: { ticker, name: entityName, cik: co.cik_str, ...(await sicOf(cik)), currency: cur, foreign, fyEnds: ends, hist, bal, shares } };
}

// Step 2: price and beta from the spark data, in the reporting currency.
function priced({ sym, rec: r0 }, px, rf, listing) {
  const q = px[sym];
  if (!q) throw new Error(`no price for ${sym}`);
  let rec = r0;
  // Foreign reporting currency: translate every reported figure into the listing currency at the latest spot rate.
  if (q.meta.currency !== rec.currency) {
    if (q.meta.currency !== 'USD') throw new Error(`price in ${q.meta.currency}, filings in ${rec.currency}`);
    const fx = px[`${rec.currency}USD=X`];
    if (!fx) throw new Error(`no ${rec.currency}/USD rate`);
    const rate = fx.meta.regularMarketPrice;
    const tr = f => (f ? { ...f, v: +(f.v * rate).toFixed(3) } : f);
    rec = { ...rec, currency: 'USD', hist: Object.fromEntries(Object.entries(rec.hist).map(([k, a]) => [k, a.map(tr)])), bal: Object.fromEntries(Object.entries(rec.bal).map(([k, f]) => [k, tr(f)])),
      fx: { from: r0.currency, rate: +rate.toPrecision(6), date: new Date(fx.meta.regularMarketTime * 1000).toISOString().slice(0, 10), symbol: `${r0.currency}USD=X` } };
  }
  // Foreign filers and depositary receipts: the filing counts ordinary shares, the US price is per ADS. Reconcile with the
  // listing's market value (Nasdaq screener): ratio = ordinary shares / listed ADS-equivalent shares, which must be a clean ratio.
  const l = listing[rec.ticker];
  const listed = l?.mcap && l.last ? l.mcap / l.last / 1e6 : 0; // listed shares (m) implied by Nasdaq's market value
  const fromListing = why => ({ v: +listed.toFixed(3), asOf: listingDate, concept: `Nasdaq market value / last price (${why})`, form: 'Nasdaq stock screener', url: `https://www.nasdaq.com/market-activity/stocks/${rec.ticker.toLowerCase()}` });
  if (!rec.shares) {
    if (!listed) throw new Error('no share count in the filings or the listing');
    rec = { ...rec, shares: fromListing('the filings tag no current share count') };
  } else if (rec.foreign || /depositary/i.test(l?.name ?? '')) {
    if (!l?.mcap || !l.last) throw new Error('foreign filer with no listing data to reconcile the share count');
    const named = l.name.match(/representing[^()]*?\((\d+(?:\.\d+)?)\)/i);
    const raw = (rec.shares.v * 1e6) / (l.mcap / l.last);
    const near = x => Math.abs(raw / x - 1) < 0.05;
    // Ratio stated in the listing name if it reconciles, else one of the usual ADS ratios (within 5%).
    const ratio = named && near(+named[1]) ? +named[1] : [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 100, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 10].find(near);
    // A filing count within a third of the listing with no clean ratio is a stale count (shares issued since), not an ADS: use the listing.
    if (!ratio && !/depositary/i.test(l.name) && raw > 0.67 && raw < 1.5) rec = { ...rec, shares: fromListing(`the filing count of ${rec.shares.v.toFixed(1)}m dates from ${rec.shares.asOf}`) };
    else if (!ratio) throw new Error(`share count does not reconcile with the US listing (${raw.toFixed(2)} ordinary shares per listed share)`);
    else if (ratio !== 1) rec = { ...rec, shares: { ...rec.shares, v: +(rec.shares.v / ratio).toFixed(3), adr: +ratio.toPrecision(6), concept: `${rec.shares.concept}, divided by ${+ratio.toPrecision(4)} ordinary shares per ADS` } };
  }
  const index = rec.currency === 'CAD' ? '^GSPTSE' : '^GSPC';
  const price = { v: +q.meta.regularMarketPrice.toFixed(4), date: new Date(q.meta.regularMarketTime * 1000).toISOString().slice(0, 10), symbol: sym, exchange: q.meta.fullExchangeName, hi52: q.meta.fiftyTwoWeekHigh, lo52: q.meta.fiftyTwoWeekLow };
  return { ...rec, price, beta: beta(q, px[index], index), rf: rf[rec.currency], generated: new Date().toISOString().slice(0, 10) };
}

const args = process.argv.slice(2);
const all = args.includes('--all');
const limit = +(args.find(x => x.startsWith('--limit='))?.slice(8) ?? 0);
const tickers = args.filter(x => !x.startsWith('--')).map(t => t.toUpperCase());
const cikOf = Object.fromEntries(Object.values(await get('https://www.sec.gov/files/company_tickers.json')).map(c => [c.ticker, c]));
// Every US-listed stock (Nasdaq, NYSE, NYSE American) with its market value, from the Nasdaq screener; the last good copy is
// kept in listing.json so a failed download never shrinks coverage. Used for the universe, ADR ratios and the coverage list.
let listing = {}, listingDate = new Date().toISOString().slice(0, 10);
try {
  const res = await fetch('https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', Accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
  const rows = (await res.json()).data.rows;
  if (rows.length < 5000) throw new Error(`only ${rows.length} rows`);
  for (const r of rows) listing[r.symbol.replace('/', '-')] = { name: r.name.trim(), mcap: +r.marketCap || 0, last: +r.lastsale.replace(/[$,]/g, '') || 0 };
  await writeFile(new URL('listing.json', OUT), JSON.stringify({ date: new Date().toISOString().slice(0, 10), source: 'Nasdaq stock screener (all US exchanges)', listing }));
} catch (e) {
  console.log(`listing download failed (${e.message}); using the saved copy`);
  try { ({ listing, date: listingDate } = JSON.parse(await readFile(new URL('listing.json', OUT), 'utf8'))); } catch {}
}
// Common stock only: warrants, rights, units, preferreds and notes are not companies to value.
const NOT_COMMON = /warrant|\brights?\b(?! to receive)|\bunits?\b(?! representing limited)|preferred|preference shares|\bnotes?\b|debenture|\d+(\.\d+)?%|subordinated|depositary shares,? each representing a/i;
let list = tickers.length ? tickers : UNIVERSE;
const alias = {}; // other share classes of a covered company -> the ticker it is covered under
if (all) {
  const seen = new Map(UNIVERSE.map(t => [cikOf[t]?.cik_str, t]));
  const more = [];
  const syms = Object.keys(listing).length ? Object.entries(listing).filter(([, l]) => !NOT_COMMON.test(l.name)).sort((a, b) => b[1].mcap - a[1].mcap).map(([t]) => t)
    : (await get('https://www.sec.gov/files/company_tickers_exchange.json')).data.filter(r => ['NYSE', 'Nasdaq'].includes(r[3])).map(r => r[2]);
  for (const t of syms) {
    const c = cikOf[t]?.cik_str;
    if (c === undefined) continue;
    if (seen.has(c)) { if (seen.get(c) !== t) alias[t] = seen.get(c); continue; }
    seen.set(c, t); more.push(t);
  }
  list = [...UNIVERSE, ...more];
}
if (limit) list = list.slice(0, limit);
const rf = await rates();
await mkdir(OUT, { recursive: true });
const built = [], skipped = [], why = {};
for (const t of list) {
  try { built.push(await build(t, cikOf)); } catch (e) { skipped.push(t); why[t] = e.message; if (!all) console.log(`skip ${t}: ${e.message}`); }
  if (!process.env.FACTS_ZIP) await sleep(150); // stay under SEC's 10 requests a second
}
const px = await spark([...new Set([...built.map(b => b.sym), ...built.filter(b => !['USD', 'CAD'].includes(b.rec.currency)).map(b => `${b.rec.currency}USD=X`), '^GSPC', '^GSPTSE'])]);
const index = [];
for (const b of built) {
  try {
    const d = priced(b, px, rf, listing);
    await writeFile(new URL(`${d.ticker}.json`, OUT), JSON.stringify(d));
    index.push({ ticker: d.ticker, name: d.name, currency: d.currency, ...(UNIVERSE.includes(d.ticker) ? { f: 1 } : {}) });
    if (!all) console.log(`ok   ${d.ticker} ${d.currency} ${d.fyEnds.at(-1)} price ${d.price.v} beta ${d.beta.value}`);
  } catch (e) { skipped.push(b.rec.ticker); why[b.rec.ticker] = e.message; if (!all) console.log(`skip ${b.rec.ticker}: ${e.message}`); }
}
const tally = {};
for (const m of Object.values(why)) { const k = m.replace(/\d{4}-\d{2}-\d{2}/g, 'DATE').replace(/\(.*\)/, '').replace(/[\d.]+/g, 'N').trim(); tally[k] = (tally[k] ?? 0) + 1; }
console.log('skip reasons:', JSON.stringify(Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 25)));
for (const t of skipped) await rm(new URL(`${t}.json`, OUT), { force: true }); // never leave stale data for a ticker that now fails
console.log(`built ${index.length}, skipped ${skipped.length} of ${list.length}`);
// A partial run (named tickers) keeps the rest of the existing list.
let old = [];
if (tickers.length) try { old = JSON.parse(await readFile(new URL('index.json', OUT), 'utf8')).tickers; } catch {}
const merged = [...old.filter(o => !index.some(n => n.ticker === o.ticker) && !skipped.includes(o.ticker)), ...index].sort((a, b) => a.ticker.localeCompare(b.ticker));
await writeFile(new URL('index.json', OUT), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), rf, tickers: merged }));
// Coverage list: every US-listed ticker that is not covered, with the reason, so a search for it explains itself.
if (all) {
  const covered = new Set(merged.map(m => m.ticker));
  const nc = Object.entries(listing).filter(([t]) => !covered.has(t)).map(([t, l]) => [t, l.name,
    alias[t] && covered.has(alias[t]) ? `alias:${alias[t]}` : NOT_COMMON.test(l.name) ? 'not common stock (warrant, right, unit, preferred or note)' : !cikOf[t] ? 'no SEC filings under this ticker (not an SEC registrant, or files under another symbol)' : why[t] ?? 'not processed']);
  await writeFile(new URL('coverage.json', OUT), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), listed: Object.keys(listing).length, covered: covered.size, notCovered: nc }));
}
// Comps file: one compact row per company for peer multiples (same EV bridge as the DCF; EBITDA = EBIT + D&A, last fiscal year).
const only = tickers.length ? new Set(tickers) : null;
const lastV = a => a?.at(-1)?.v;
const debtV = b => (b.debt_total ? b.debt_total.v : (b.ltd?.v ?? 0) + (b.ltd_cur?.v ?? 0)) + (b.std?.v ?? 0);
const compRows = [];
for (const t of merged.map(i => i.ticker)) {
  let d;
  try { d = JSON.parse(await readFile(new URL(`${t}.json`, OUT), 'utf8')); } catch { continue; }
  const mcap = d.price.v * d.shares.v, ev = mcap + debtV(d.bal) - (d.bal.cash?.v ?? 0) + (d.bal.nci?.v ?? 0) + (d.bal.pref?.v ?? 0);
  const ebit = lastV(d.hist.ebit), da = lastV(d.hist.da);
  const r = n => (n == null || !Number.isFinite(n) ? null : +n.toFixed(1));
  compRows.push([t, d.sic ?? '', d.currency, r(mcap), r(ev), r(lastV(d.hist.rev)), ebit == null || da == null ? null : r(ebit + da), r(lastV(d.hist.ni)), d.fyEnds.at(-1), d.beta.months >= 24 ? d.beta.value : null]);
}
const compsFile = { fields: ['ticker', 'sic', 'currency', 'mcap', 'ev', 'rev', 'ebitda', 'ni', 'fy', 'beta'], rows: compRows };
await writeFile(new URL('comps.json', OUT), JSON.stringify(compsFile));
// Bottom-up beta (Damodaran): unlever each peer's regression beta at its own net debt / equity, take the median, relever at the
// company's net debt / equity. One company's 5-year regression is noisy (a crash or a squeeze can double it); a peer median is not.
const T = 0.25; // marginal tax rate in the unlever / relever formula
const de = r => Math.max(0, r.ev - r.mcap) / r.mcap;
const rows = rowsOf(compsFile);
for (const self of rows) {
  if (only && !only.has(self.ticker)) continue;
  const { peers, basis } = pickPeers(self, rows);
  const bu = peers.filter(p => p.beta != null && p.mcap > 0).map(p => p.beta / (1 + (1 - T) * de(p))).sort((a, b) => a - b);
  if (bu.length < 5) continue;
  const m = bu.length % 2 ? bu[(bu.length - 1) / 2] : (bu[bu.length / 2 - 1] + bu[bu.length / 2]) / 2;
  const f = new URL(`${self.ticker}.json`, OUT);
  const d = JSON.parse(await readFile(f, 'utf8'));
  d.beta.bottomUp = { value: +(m * (1 + (1 - T) * de(self))).toFixed(3), unlevered: +m.toFixed(3), n: bu.length, de: +de(self).toFixed(3), tax: T, peers: basis };
  await writeFile(f, JSON.stringify(d));
}
