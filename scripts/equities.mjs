// Builds public/data/eq/<TICKER>.json for the equity DCF from free public data:
//   SEC EDGAR XBRL company facts (annual 10-K, 20-F, 40-F figures, each tagged with its filing),
//   Yahoo Finance chart data (last close, 5 years of monthly closes for beta),
//   US Treasury daily par yield curve and Bank of Canada Valet (10-year risk-free rates).
// The site is static and neither SEC nor Yahoo allow browser requests, so this runs ahead of time
// (locally or in the scheduled GitHub Action) and the site reads the JSON.
// Usage: node scripts/equities.mjs [TICKER ...]   (no tickers = the UNIVERSE list below)
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

// SEC asks automated clients for a name and contact email in the User-Agent; set SEC_UA to your own.
const UA = process.env.SEC_UA || 'infrastructure-investment-modeling-platform contact@example.com';
const OUT = new URL('../public/data/eq/', import.meta.url);

// ponytail: curated list, not every SEC filer. Widen with the SEC bulk companyfacts.zip if coverage matters.
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
  rev: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RegulatedAndUnregulatedOperatingRevenue', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense', 'Revenue'],
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
const ANNUAL = /^(10-K|20-F|40-F)/;
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

async function yahoo(sym, range, interval) {
  const d = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`);
  const r = d.chart.result[0];
  const close = r.indicators.adjclose?.[0]?.adjclose ?? r.indicators.quote[0].close;
  return { meta: r.meta, t: r.timestamp.map(s => new Date(s * 1000).toISOString().slice(0, 10)), close };
}

// Beta: slope of 60 monthly returns on the stock against the local index (S&P 500 or S&P/TSX Composite).
async function beta(sym, index) {
  const [a, b] = await Promise.all([yahoo(sym, '5y', '1mo'), yahoo(index, '5y', '1mo')]);
  const ib = Object.fromEntries(b.t.map((t, k) => [t.slice(0, 7), b.close[k]]));
  const pairs = a.t.map((t, k) => [a.close[k], ib[t.slice(0, 7)]]).filter(([x, y]) => x != null && y != null);
  // Drop the current, incomplete month.
  pairs.pop();
  const ra = [], rb = [];
  for (let k = 1; k < pairs.length; k++) { ra.push(pairs[k][0] / pairs[k - 1][0] - 1); rb.push(pairs[k][1] / pairs[k - 1][1] - 1); }
  const n = ra.length, ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let cov = 0, vb = 0;
  for (let k = 0; k < n; k++) { cov += (ra[k] - ma) * (rb[k] - mb); vb += (rb[k] - mb) ** 2; }
  return { value: +(cov / vb).toFixed(3), months: n, index, from: a.t[0].slice(0, 7), to: a.t.at(-2).slice(0, 7) };
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

async function build(ticker, cikOf, rf) {
  const co = cikOf[ticker];
  if (!co) throw new Error('not an SEC filer');
  const cik = String(co.cik_str).padStart(10, '0');
  const { facts, entityName } = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  // Reporting currency: the unit revenue is tagged in.
  const revConcept = FLOW.rev.find(c => facts['us-gaap']?.[c] || facts['ifrs-full']?.[c]);
  const cur = Object.keys((facts['us-gaap']?.[revConcept] ?? facts['ifrs-full']?.[revConcept])?.units ?? {})[0];
  if (cur !== 'USD' && cur !== 'CAD') throw new Error(`reports in ${cur}; only USD and CAD are supported`);

  // Per year, the highest-priority concept that year was tagged with (companies switch tags over time).
  const merged = (list, units, instant) => {
    const out = { byEnd: {} };
    for (const c of list) { const s = series(facts, c, units, instant); if (!s) continue; for (const [e, f] of Object.entries(s.byEnd)) out.byEnd[e] ??= { ...f, concept: s.concept }; }
    return out;
  };
  const flows = Object.fromEntries(Object.entries(FLOW).map(([k, l]) => [k, merged(l, cur, false)]));
  const rev = flows.rev;
  const ends = Object.keys(rev.byEnd).sort().slice(-5);
  if (ends.length < 3) throw new Error(`fewer than 3 annual years of revenue (${ends.join(', ') || 'none'})`);
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
  const dilLast = merged(['WeightedAverageNumberOfDilutedSharesOutstanding', 'AdjustedWeightedAverageShares', 'WeightedAverageNumberOfSharesOutstandingBasicAndDiluted'], 'shares', false).byEnd[lastEnd];
  if (!shares && dilLast) shares = { v: +(dilLast.val / 1e6).toFixed(3), asOf: lastEnd, concept: dilLast.concept + ' (diluted weighted average)', form: dilLast.form, url: link(co.cik_str, dilLast.accn) };
  if (!shares) throw new Error('no share count');

  // Price in the reporting currency: TSX listing for CAD reporters, US listing otherwise.
  const sym = cur === 'CAD' ? `${TSX[ticker] ?? ticker.replace(/-/g, '.')}.TO` : ticker.replace(/\./g, '-');
  const q = await yahoo(sym, '5d', '1d');
  if (q.meta.currency !== cur) throw new Error(`price in ${q.meta.currency}, filings in ${cur}`);
  const k = q.close.findLastIndex(v => v != null);
  const price = { v: +q.close[k].toFixed(4), date: q.t[k], symbol: sym, exchange: q.meta.fullExchangeName };
  const b = await beta(sym, cur === 'CAD' ? '^GSPTSE' : '^GSPC');

  return {
    ticker, name: entityName, cik: co.cik_str, currency: cur, fyEnds: ends, hist, bal, shares, price, beta: b,
    rf: rf[cur], generated: new Date().toISOString().slice(0, 10),
  };
}

const tickers = process.argv.slice(2).map(t => t.toUpperCase());
const list = tickers.length ? tickers : UNIVERSE;
const cikOf = Object.fromEntries(Object.values(await get('https://www.sec.gov/files/company_tickers.json')).map(c => [c.ticker, c]));
const rf = await rates();
await mkdir(OUT, { recursive: true });
const index = [], skipped = [];
for (const t of list) {
  try {
    const d = await build(t, cikOf, rf);
    await writeFile(new URL(`${t}.json`, OUT), JSON.stringify(d));
    index.push({ ticker: t, name: d.name, currency: d.currency });
    console.log(`ok   ${t} ${d.currency} ${d.fyEnds.at(-1)} price ${d.price.v} beta ${d.beta.value}`);
  } catch (e) {
    console.log(`skip ${t}: ${e.message}`);
    skipped.push(t);
    await rm(new URL(`${t}.json`, OUT), { force: true }); // never leave stale data for a ticker that now fails
  }
  await sleep(250); // stay well under SEC's 10 requests a second
}
// Merge with tickers already built so a partial run keeps the rest of the list.
let old = [];
if (tickers.length) try { old = JSON.parse(await readFile(new URL('index.json', OUT), 'utf8')).tickers; } catch {}
const merged = [...old.filter(o => !index.some(n => n.ticker === o.ticker) && !skipped.includes(o.ticker)), ...index].sort((a, b) => a.ticker.localeCompare(b.ticker));
await writeFile(new URL('index.json', OUT), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), rf, tickers: merged }));
