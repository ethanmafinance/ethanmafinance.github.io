// Engine C: listed company DCF built from SEC filings (scripts/equities.mjs writes the company file).
// Unlevered free cash flow = EBIT x (1 - tax) - net reinvestment, where net reinvestment = capex - D&A.
// Over the forecast, revenue growth fades in a straight line from year 1 to the terminal rate, the EBIT
// margin fades from the last reported year to a target, and the reinvestment rate (net reinvestment / NOPAT)
// fades from its 3-year history to the steady state g / RONIC, so the last forecast year is consistent with
// the terminal value (value driver formula, McKinsey "Valuation"; Damodaran):
//   TV = NOPAT(N+1) x (1 - g / RONIC) / (WACC - g)
// Columns 0..2 are the last three fiscal years as reported; columns 3.. are the forecast.
import type { Input, Item, ModelDef, Source } from './sheet.ts';

type Fact = { v: number; concept: string; form: string; filed?: string; url: string } | null;
export type Company = {
  ticker: string; name: string; cik: number; currency: 'USD' | 'CAD'; fyEnds: string[];
  hist: Record<'rev' | 'ebit' | 'da' | 'capex' | 'cfo' | 'pretax' | 'tax' | 'ni' | 'int', Fact[]> & { amort?: Fact[] };
  bal: Record<'cash' | 'debt_total' | 'ltd' | 'ltd_cur' | 'std' | 'nci' | 'pref', Fact> & { equity?: Fact };
  shares: { v: number; asOf: string; concept: string; form: string; url: string; adr?: number };
  price: { v: number; date: string; symbol: string; exchange: string; hi52?: number; lo52?: number };
  sic?: string; sicDesc?: string;
  beta: { value: number; months: number; index: string; from: string; to: string; basis?: string; se?: number;
    bottomUp?: { value: number; unlevered: number; n: number; de: number; tax: number; peers: string } };
  fx?: { from: string; rate: number; date: string; symbol: string };
  // Analyst consensus for forecast years 1 and 2 (data script): g = revenue growth, eps = mean EPS in the price currency.
  cons?: { date: string; source?: string; url?: string; note?: string; revNote?: string;
    rows?: { end: string; g?: number; nRev?: number; eps?: number; nEps?: number }[] };
  rf: { value: number; date: string; title: string; url: string };
  generated: string;
};
export type Answers = { years: number; scenario: 'base' | 'downside' | 'upside'; wacc: 'capm' | 'direct'; terminal: 'growth' | 'multiple' };

export const HIST = 3;
const STATUTORY = { USD: 0.21, CAD: 0.265 };
// Scenario shifts (illustrative, est.): year 1 growth and target margin move together.
// Bear / base / bull: year 1 growth (pt), target EBIT margin (x), terminal growth (pt).
export const SCENARIO = { base: [0, 1, 0], downside: [-0.03, 0.9, -0.005], upside: [0.03, 1.1, 0.005] } as const;

const ERP: Source = { title: 'Damodaran, implied equity risk premium (FCFE) for the S&P 500, start of 2026', date: 'Jan 7, 2026', url: 'https://pages.stern.nyu.edu/~adamodar/pc/datasets/histimpl.xls' };
const FOMC: Source = { title: 'Federal Reserve, Summary of Economic Projections, September 16, 2026: longer-run median real GDP growth 2.0%, PCE inflation 2.0%', date: 'Sep 16, 2026', url: 'https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm' };
// Terminal growth: below long-run nominal GDP growth (about 4%) because no company outgrows the economy forever, and below the 10-year yield (Damodaran's cap).
export const G_TERM = 0.03;
// Return on invested capital above this is capped: book capital understates intangible-heavy and buyback-heavy companies.
const ROIC_CAP = 0.5;
const VALUATION: Source = { title: 'Koller, Goedhart and Wessels, Valuation (McKinsey), value driver formula; Damodaran, Investment Valuation', note: '' };
const STAT: Record<string, Source> = {
  USD: { title: 'US federal corporate tax rate 21% (IRC section 11)', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/corporate-tax-rates' },
  CAD: { title: 'Canada Revenue Agency, federal 15% plus Ontario 11.5%', url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/corporations/corporation-tax-rates.html' },
};

const est = (note: string, base?: Source): Source => ({ ...(base ?? { title: '' }), est: true, note });
// Set per company: figures reported in another currency are translated to USD at one spot rate (see the data script).
let fxNote = '';
const factSrc = (f: Fact, what: string): Source | undefined =>
  f ? { title: `SEC ${f.form}${f.filed ? ` filed ${f.filed}` : ''}`, note: `${what}, XBRL ${f.concept}${fxNote}`, url: f.url } : undefined;
const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
// Scenario margin: bull raises and bear lowers the margin by a share of its size, also when it is negative (x0.9 would raise a loss).
export const shiftMargin = (m: number, f: number) => m + (f - 1) * Math.abs(m);

// Sum of the debt components the filing tags. Total if tagged; otherwise non-current + current portion; plus short-term borrowings.
export function debtOf(c: Company) {
  const b = c.bal;
  const parts = b.debt_total ? [b.debt_total] : [b.ltd, b.ltd_cur].filter(Boolean);
  if (b.std) parts.push(b.std);
  return { v: parts.reduce((s, f) => s + f!.v, 0), parts: parts as NonNullable<Fact>[] };
}

export type Overrides = Record<string, { value: number; source?: Source }>;

export function dcf(c: Company, a: Answers, over: Overrides = {}): { def: ModelDef; missing: string[] } {
  fxNote = c.fx ? `; reported in ${c.fx.from}, translated at ${c.fx.rate} USD per ${c.fx.from} (Yahoo Finance ${c.fx.symbol}, ${c.fx.date})` : '';
  const H = c.fyEnds.length >= HIST ? HIST : c.fyEnds.length;
  const last = c.fyEnds.slice(-H);
  const fy = last.map(e => +e.slice(0, 4));
  const missing: string[] = [];
  const histVal = (k: keyof Company['hist'], label: string) => {
    const facts = c.hist[k].slice(-H);
    if (facts.some(f => !f)) missing.push(label);
    return facts;
  };
  const rev = histVal('rev', 'Revenue'), ebit = histVal('ebit', 'Operating income (EBIT)'), da = histVal('da', 'Depreciation and amortization'), capex = histVal('capex', 'Capital expenditures');
  const v = (f: Fact) => f?.v ?? 0;

  // Defaults computed from the filings (shown as est. with the method).
  // Amortization of acquired intangibles (when tagged): added back to EBIT and taken out of D&A, so the forecast runs on
  // EBITA and depreciation. It is non-cash and capex does not replace it, so leaving it in would understate acquirers' cash flow.
  const amF = (c.hist.amort ?? []).slice(-H);
  const amRaw = Array.from({ length: H }, (_, k) => Math.max(0, Math.min(v(amF[k] ?? null), v(da[k]))));
  const hasAm = amRaw.some(z => z > 0);
  const r = rev.map(v), d = da.map((f, k) => v(f) - amRaw[k]), x = capex.map(v), e = ebit.map((f, k) => v(f) + amRaw[k]);
  const taxes = c.hist.tax.slice(-H).map(v), pre = c.hist.pretax.slice(-H).map(v);
  const effTax = avg(pre) > 0 ? avg(taxes) / avg(pre) : NaN;
  const useEff = effTax >= 0.05 && effTax <= 0.4;
  const tax = useEff ? effTax : STATUTORY[c.currency];
  const cagr = (r[H - 1] / r[0]) ** (1 / (H - 1)) - 1;
  const [dg, mm, dgt] = SCENARIO[a.scenario];
  const gHist = clamp(cagr, -0.05, 0.25) + dg;
  // Years 1 and 2 from analyst consensus when there are estimates for them (Yahoo's growth on its own prior-year revenue).
  const [c1, c2] = c.cons?.rows ?? [];
  const consG1 = c1?.g !== undefined, consG2 = consG1 && c2?.g !== undefined;
  const g1 = consG1 ? c1.g! + dg : gHist;
  const consSrc = (k: { end: string; g?: number; nRev?: number }, prev: string): Source => ({ title: c.cons!.source ?? 'Yahoo Finance analyst estimates', date: c.cons!.date, url: c.cons!.url,
    est: !!dg, note: `consensus revenue estimate for the year to ${k.end}, mean of ${k.nRev} analysts, ${pct(k.g!)} above ${prev}${dg ? `; ${dg > 0 ? '+' : ''}${dg * 100}pt for the ${a.scenario} case` : ''}` });
  const margins = e.map((m, k) => m / r[k]);
  const nopat = e.map(m => m * (1 - tax));
  const capexOk = capex.every(Boolean);
  const reinv = clamp(avg(x.map((cx, k) => cx - d[k])) / avg(nopat), -0.5, 2);
  const debt = debtOf(c);
  const int = c.hist.int.slice(-1)[0];
  const kd = int && debt.v > 0 ? clamp(int.v / debt.v, c.rf.value, c.rf.value + 0.05) : c.rf.value + 0.015;
  const fyEnd = c.fyEnds.at(-1)!;
  const stub = clamp((Date.parse(c.price.date) - Date.parse(fyEnd)) / (365.25 * 864e5), 0, 0.99);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const ebitda = e[H - 1] + d[H - 1];
  // Return on invested capital, last fiscal year: NOPAT / (book equity + debt + NCI + preferred - cash) at year end.
  const ic = c.bal.equity ? c.bal.equity.v + debt.v + v(c.bal.nci) + v(c.bal.pref) - v(c.bal.cash) : NaN;
  const roicRaw = nopat[H - 1] / ic;
  const roic = !c.bal.equity || nopat[H - 1] <= 0 ? 0 : ic <= 0 || roicRaw > ROIC_CAP ? ROIC_CAP : roicRaw;
  const roicNote = !c.bal.equity ? 'book equity is not tagged, so the return on capital is unknown and new capital is assumed to earn WACC'
    : nopat[H - 1] <= 0 ? `FY${fy[H - 1]} operating income is negative, so new capital is assumed to earn WACC`
    : ic <= 0 ? `book invested capital is negative (buybacks above book equity), so the return on it is not meaningful; capped at ${ROIC_CAP * 100}%`
    : `FY${fy[H - 1]} NOPAT ${nopat[H - 1].toFixed(0)} / invested capital ${ic.toFixed(0)} (book equity ${c.bal.equity.v.toFixed(0)} + debt + NCI + preferred - cash) = ${pct(roicRaw)}${roicRaw > ROIC_CAP ? `, capped at ${ROIC_CAP * 100}%: book capital leaves out brands, software and research, so very high book returns overstate what new capital earns` : ''}`;
  // Beta: the company's own regression when it is precise (60 months, standard error 0.2 or less); otherwise peers.
  const ownPrecise = c.beta.se !== undefined && c.beta.se <= 0.2 && c.beta.months >= 48;
  const evNow = c.price.v * c.shares.v + debt.v - v(c.bal.cash) + v(c.bal.nci) + v(c.bal.pref);
  const cur = c.currency === 'CAD' ? 'C$m' : 'US$m';

  const g = (group: string, list: Omit<Input, 'group'>[]): Input[] => list.map(i => ({ ...i, group }));
  const histInputs = (id: string, label: string, facts: Fact[]) =>
    facts.map((f, k) => ({ id: `${id}_h${k + 1}`, label: `${label}, FY${fy[k]}`, unit: cur, value: v(f), fmt: 'num' as const,
      source: factSrc(f, label) ?? est('not tagged in the XBRL data; enter it from the annual report') }));

  const inputs: Input[] = [
    ...g('Timing', [
      { id: 'years', label: 'Forecast years', unit: 'years', value: a.years, fmt: 'int', timing: true, min: 3, max: 15, step: 1,
        source: est('chosen when the model was built') },
      { id: 'hold', label: 'Forecast years held at the year 1 growth, margin and reinvestment before the fade', unit: 'years', value: 0, fmt: 'int', min: 0, max: 14, step: 1,
        source: est('0 or 1 = fade from year 1. Set to the length of a company plan (e.g. 5) to run its guidance before fading') },
      { id: 'stub', label: 'Share of the current fiscal year already passed at the price date', unit: 'years', value: +stub.toFixed(3), fmt: 'num',
        source: est(`from the fiscal year end (${fyEnd}) to the price date (${c.price.date}). That part of year 1 cash flow is not discounted; it is added to the equity bridge, because the balance sheet is from the year end`) },
      { id: 'mid', label: 'Mid-year discounting (1 = yes, 0 = year end)', unit: 'flag', value: 1, fmt: 'flag', min: 0, max: 1, step: 1,
        source: est('cash arrives through the year, so the usual convention discounts it from mid-year') },
    ]),
    ...g('Reported financials', [
      ...histInputs('rev', 'Revenue', rev),
      ...histInputs('ebit', 'Operating income (EBIT)', ebit),
      ...histInputs('da', 'Depreciation and amortization', da),
      ...histInputs('capex', 'Capital expenditures', capex),
      ...(hasAm ? histInputs('amort', 'Amortization of acquired intangibles (in EBIT and D&A above)', Array.from({ length: H }, (_, k) => amF[k] ?? null)) : []),
    ]),
    ...g('Forecast', [
      { id: 'g1', label: 'Revenue growth, forecast year 1', unit: '%', value: +g1.toFixed(4), fmt: 'pct',
        source: consG1 ? consSrc(c1, `FY${fy[H - 1]} reported revenue`)
          : est(`FY${fy[0]} to FY${fy[H - 1]} revenue CAGR of ${pct(cagr)}, held between -5% and 25%${dg ? `, ${dg > 0 ? '+' : ''}${dg * 100}pt for the ${a.scenario} case` : ''}. No analyst consensus used: ${c.cons?.revNote ?? c.cons?.note ?? (c.cons ? 'fewer than 3 analysts' : 'no estimates published')}`) },
      { id: 'cons', label: 'Year 2 growth from consensus (1 = yes, then fade; 0 = fade straight from year 1)', unit: 'flag', value: consG2 ? 1 : 0, fmt: 'flag', min: 0, max: 1, step: 1,
        source: est(consG2 ? 'consensus covers forecast years 1 and 2' : 'no year 2 consensus, so growth fades straight from year 1') },
      { id: 'g2', label: 'Revenue growth, forecast year 2 (used when the line above is 1)', unit: '%', value: +(consG2 ? c2.g! + dg : g1).toFixed(4), fmt: 'pct',
        source: consG2 ? consSrc(c2, 'the year 1 estimate') : est('not used') },
      { id: 'g_term', label: 'Terminal growth (revenue growth fades to this by the last forecast year)', unit: '%', value: +(G_TERM + dgt).toFixed(4), fmt: 'pct',
        source: est(`${G_TERM * 100}%: below long-run nominal GDP growth of about 4% (2.0% real plus 2.0% inflation), since no company outgrows the economy forever, and below the 10-year yield, the usual cap (Damodaran)${dgt ? `; ${dgt > 0 ? '+' : ''}${dgt * 100}pt for the ${a.scenario} case` : ''}`, FOMC) },
      { id: 'm1', label: 'EBIT margin, forecast year 1', unit: '%', value: +margins[H - 1].toFixed(4), fmt: 'pct',
        source: est(`FY${fy[H - 1]} reported ${hasAm ? 'EBITA (EBIT plus amortization of acquired intangibles)' : 'EBIT'} margin`) },
      { id: 'm_target', label: 'EBIT margin, last forecast year (target)', unit: '%', value: +shiftMargin(med(margins), mm).toFixed(4), fmt: 'pct',
        source: est(`median of the last ${H} reported margins, ${pct(med(margins))} (${margins.map(pct).join(', ')}): the median ignores one unusual year, such as a loss year or a peak${mm !== 1 ? `; ${mm > 1 ? '+' : '-'}${Math.round(Math.abs(mm - 1) * 100)}% of its size for the ${a.scenario} case` : ''}`) },
      { id: 'da_pct', label: hasAm ? 'Depreciation and amortization, excluding acquired intangibles' : 'Depreciation and amortization', unit: '% of revenue', value: +(avg(d) / avg(r)).toFixed(4), fmt: 'pct',
        source: est(`${H}-year reported average`) },
      { id: 'reinv1', label: 'Reinvestment rate, forecast year 1: (capex - D&A) / NOPAT', unit: '%', value: capexOk ? +reinv.toFixed(4) : +(0.02 / 0.08).toFixed(4), fmt: 'pct',
        source: capexOk ? est(`${H}-year reported average`) : est('capex is not tagged, so this starts at the steady state (2% growth / 8% return on new capital); enter reported capex and set this from it') },
      { id: 'roic', label: 'Return on invested capital, last fiscal year (ROIC)', unit: '%', value: +roic.toFixed(4), fmt: 'pct', source: est(roicNote) },
      { id: 'ronic_keep', label: 'Share of the ROIC premium over WACC that new capital keeps in perpetuity', unit: '%', value: 0.5, fmt: 'pct',
        source: est('50%, midway between the two textbook ends: 0% = competition drives returns on new capital down to WACC, so growth adds no value; 100% = a lasting advantage (brand, patents, network) keeps its current return. Return on new capital = WACC + this share x (ROIC - WACC), never below WACC', VALUATION) },
      { id: 'ronic', label: 'Return on new capital, entered directly (0 = use the two lines above)', unit: '%', value: 0, fmt: 'pct',
        source: est('0 = computed from ROIC and the share kept') },
      { id: 'tax', label: 'Tax rate on operating income', unit: '%', value: +tax.toFixed(4), fmt: 'pct',
        source: useEff ? est(`${H}-year effective rate: income tax / pre-tax income from the filings`) : est(`statutory rate: the ${H}-year effective rate (${Number.isFinite(effTax) ? pct(effTax) : 'n/a'}) is outside 5% to 40%`, STAT[c.currency]) },
    ]),
    ...g('Discount rate (WACC)', [
      { id: 'wacc_mode', label: 'WACC method (0 = CAPM build-up below, 1 = enter WACC directly)', unit: 'flag', value: a.wacc === 'direct' ? 1 : 0, fmt: 'flag', min: 0, max: 1, step: 1, source: est('chosen when the model was built') },
      { id: 'wacc_in', label: 'WACC entered directly', unit: '%', value: 0.08, fmt: 'pct', source: est('used only when the method is 1') },
      { id: 'rf', label: `Risk-free rate (${c.currency === 'CAD' ? 'Government of Canada' : 'US Treasury'} 10-year)`, unit: '%', value: c.rf.value, fmt: 'pct', source: { title: c.rf.title, date: c.rf.date, url: c.rf.url } },
      (() => {
        const raw = `${c.beta.value.toFixed(2)} from ${c.beta.basis?.startsWith('market beta') ? c.beta.basis : `a regression of ${c.beta.months} monthly ${c.beta.basis === 'monthly price returns' ? 'price' : 'total'} returns, ${c.beta.from} to ${c.beta.to}, on the ${c.beta.index === '^GSPTSE' ? 'S&P/TSX Composite' : 'S&P 500'} (Yahoo Finance)`}`;
        const bu = c.beta.bottomUp;
        return bu && !ownPrecise
          ? { id: 'beta', label: 'Equity beta (bottom-up, from peers)', unit: 'x', value: +(0.67 * bu.value + 0.33).toFixed(3), fmt: 'x' as const,
              source: est(`Blume-adjusted (0.67 x + 0.33) bottom-up beta of ${bu.value.toFixed(2)}: median unlevered beta of ${bu.n} peers (${bu.peers}), ${bu.unlevered.toFixed(2)}, relevered at ${c.ticker}'s net debt / equity of ${bu.de.toFixed(2)} with a ${bu.tax * 100}% tax rate: beta_L = beta_U x (1 + (1 - t) x D/E) (Damodaran, bottom-up beta). ${c.ticker}'s own regression is not precise enough to use alone (${c.beta.se !== undefined ? `standard error ${c.beta.se.toFixed(2)}, above 0.2` : 'standard error not available'}); raw beta ${raw}`) }
          : { id: 'beta', label: 'Equity beta (adjusted)', unit: 'x', value: +(0.67 * c.beta.value + 0.33).toFixed(3), fmt: 'x' as const,
              source: est(`Blume adjustment 0.67 x raw + 0.33 (betas drift toward 1; the convention behind Bloomberg's adjusted beta). ${ownPrecise ? `The company's own regression is precise (standard error ${c.beta.se!.toFixed(2)}), so it is used${bu ? ` rather than the peer beta of ${(0.67 * bu.value + 0.33).toFixed(2)} adjusted` : ''}` : 'Fewer than 5 peers for a bottom-up beta'}. Raw beta ${raw}`) };
      })(),
      { id: 'erp', label: 'Equity risk premium', unit: '%', value: 0.0423, fmt: 'pct', source: ERP },
      { id: 'kd', label: 'Pre-tax cost of debt', unit: '%', value: +kd.toFixed(4), fmt: 'pct',
        source: int && debt.v > 0 ? est(`FY${fy[H - 1]} interest (${int.concept.split(':')[1]}) / year-end debt, held between the risk-free rate and 5pt above it`) : est('risk-free rate plus 1.5pt: interest expense is not tagged') },
    ]),
    ...g('Equity bridge', [
      { id: 'debt', label: 'Total debt at the last fiscal year end', unit: cur, value: +debt.v.toFixed(3), fmt: 'num',
        source: debt.parts.length ? { title: `SEC ${debt.parts[0].form}`, note: 'sum of ' + debt.parts.map(p => `${p.concept.split(':')[1]} ${p.v.toFixed(1)}`).join(' + '), url: debt.parts[0].url } : est('debt is not tagged in the XBRL data; enter it from the balance sheet') },
      { id: 'cash', label: 'Cash and cash equivalents', unit: cur, value: v(c.bal.cash), fmt: 'num', source: factSrc(c.bal.cash, 'Cash') ?? est('not tagged') },
      { id: 'nci', label: 'Non-controlling interests', unit: cur, value: v(c.bal.nci), fmt: 'num', source: factSrc(c.bal.nci, 'Non-controlling interests, book value') ?? est('none tagged') },
      { id: 'pref', label: 'Preferred shares', unit: cur, value: v(c.bal.pref), fmt: 'num', source: factSrc(c.bal.pref, 'Preferred shares, book value') ?? est('none tagged') },
      { id: 'shares', label: c.shares.adr ? 'Shares outstanding (ADS equivalent)' : 'Shares outstanding', unit: 'm', value: c.shares.v, fmt: 'num', source: { title: c.shares.form.startsWith('Nasdaq') ? c.shares.form : `SEC ${c.shares.form}`, note: `as of ${c.shares.asOf}, ${c.shares.concept}`, url: c.shares.url } },
      { id: 'price', label: `Share price (${c.price.symbol})`, unit: c.currency === 'CAD' ? 'C$' : 'US$', value: c.price.v, fmt: 'px', source: { title: `${c.price.exchange} close, Yahoo Finance`, date: c.price.date } },
    ]),
    ...g('Terminal value', [
      { id: 'tv_mode', label: 'Terminal method (0 = perpetuity growth, 1 = exit multiple)', unit: 'flag', value: a.terminal === 'multiple' ? 1 : 0, fmt: 'flag', min: 0, max: 1, step: 1, source: est('chosen when the model was built') },
      { id: 'exit_mult', label: 'Exit EV / EBITDA multiple', unit: 'x', value: +(evNow / ebitda).toFixed(2), fmt: 'x',
        source: est(`today's trading multiple: enterprise value at the current price / FY${fy[H - 1]} EBITDA`) },
    ]),
  ];

  const row = (id: string, label: string, unit: string, fmt: string, f: (x: any) => string | number, extra: object = {}): Item => ({ kind: 'row', id, label, unit, fmt, f, ...extra }) as Item;
  const sc = (id: string, label: string, unit: string, fmt: string, f: (x: any) => string, extra: object = {}): Item => ({ kind: 'scalar', id, label, unit, fmt, f, ...extra }) as Item;
  const rowNo = (x: any, id: string) => x.i(id).match(/\$(\d+)$/)![1];
  const hv = (x: any, id: string) => `INDEX(Inputs!$C$${rowNo(x, id + '_h1')}:$C$${rowNo(x, id + '_h' + H)},${x.k + 1})`;
  const H_ = H;
  // Straight-line fade from the year 1 value to the last-year value over the forecast.
  // Year 1 value held for `hold` years (e.g. a company's capital plan), then a straight line to the last-year value.
  const fade = (x: any, a1: string, aN: string) => `(${x.i(a1)}+((${aN})-${x.i(a1)})*MAX(0,${x.r('t')}-MAX(1,${x.i('hold')}))/MAX(1,${x.i('years')}-MAX(1,${x.i('hold')})))`;
  const wacc = (x: any) => x.s('wacc');

  const items: Item[] = [
    { section: 'Valuation summary' },
    sc('ev', 'Enterprise value (present value of free cash flow and terminal value)', cur, 'num', x => `SUM(${x.row('pv_fcf')})+${x.s('pv_tv')}`, { bold: true }),
    sc('stub_fcf', 'Free cash flow earned since the fiscal year end (not yet in the year-end balance sheet)', cur, 'num', x => `INDEX(${x.row('fcf')},1,${H_ + 1})*${x.i('stub')}`),
    sc('eq', 'Equity value (EV + cash flow since year end - debt + cash - non-controlling interests - preferred)', cur, 'num', x => `${x.s('ev')}+${x.s('stub_fcf')}-${x.i('debt')}+${x.i('cash')}-${x.i('nci')}-${x.i('pref')}`, { bold: true }),
    sc('per_share', 'DCF implied share price', c.currency === 'CAD' ? 'C$' : 'US$', 'px', x => `${x.s('eq')}/${x.i('shares')}`, { bold: true }),
    sc('upside', 'Upside to the current share price', '%', 'pct', x => `${x.s('per_share')}/${x.i('price')}-1`, { bold: true }),
    sc('tv_share', 'Terminal value share of enterprise value', '%', 'pct', x => `${x.s('pv_tv')}/${x.s('ev')}`),
    sc('ev_ebitda', 'Implied EV / EBITDA, forecast year 1', 'x', 'x', x => `${x.s('ev')}/INDEX(${x.row('ebitda')},1,${H_ + 1})`),
    sc('mkt_ev', 'Enterprise value at the current share price', cur, 'num', x => `${x.i('price')}*${x.i('shares')}+${x.i('debt')}-${x.i('cash')}+${x.i('nci')}+${x.i('pref')}`),

    { section: 'Discount rate' },
    sc('ke', 'Cost of equity (CAPM: risk-free + beta x ERP)', '%', 'pct', x => `${x.i('rf')}+${x.i('beta')}*${x.i('erp')}`),
    sc('kd_at', 'After-tax cost of debt', '%', 'pct', x => `${x.i('kd')}*(1-${x.i('tax')})`),
    sc('mcap', 'Market value of equity (price x shares)', cur, 'num', x => `${x.i('price')}*${x.i('shares')}`),
    sc('w_d', 'Debt weight: debt / (debt + market equity)', '%', 'pct', x => `${x.i('debt')}/(${x.i('debt')}+${x.s('mcap')})`),
    sc('wacc_capm', 'WACC from the build-up', '%', 'pct', x => `(1-${x.s('w_d')})*${x.s('ke')}+${x.s('w_d')}*${x.s('kd_at')}`),
    sc('wacc', 'WACC used', '%', 'pct', x => `IF(${x.i('wacc_mode')}=1,${x.i('wacc_in')},${x.s('wacc_capm')})`, { bold: true }),

    { section: 'Terminal value' },
    sc('nopat_n1', 'NOPAT in the year after the forecast', cur, 'num', x => `INDEX(${x.row('nopat')},1,${x.i('years')}+${H_})*(1+${x.i('g_term')})`),
    sc('ronic_used', 'Return on new capital used: WACC + share kept x (ROIC - WACC)', '%', 'pct', x => `IF(${x.i('ronic')}>0,${x.i('ronic')},${wacc(x)}+${x.i('ronic_keep')}*MAX(0,${x.i('roic')}-${wacc(x)}))`),
    sc('tv_growth', 'Terminal value, perpetuity growth: NOPAT x (1 - g / RONIC) / (WACC - g)', cur, 'num', x => `${x.s('nopat_n1')}*(1-${x.i('g_term')}/${x.s('ronic_used')})/(${wacc(x)}-${x.i('g_term')})`),
    sc('tv_mult', 'Terminal value, exit multiple x last-year EBITDA', cur, 'num', x => `${x.i('exit_mult')}*INDEX(${x.row('ebitda')},1,${x.i('years')}+${H_})`),
    sc('tv', 'Terminal value used', cur, 'num', x => `IF(${x.i('tv_mode')}=1,${x.s('tv_mult')},${x.s('tv_growth')})`, { bold: true }),
    sc('tv_mult_implied', 'Cross-check: EV / EBITDA implied by the terminal value used', 'x', 'x', x => `${x.s('tv')}/INDEX(${x.row('ebitda')},1,${x.i('years')}+${H_})`),
    sc('pv_tv', 'Present value of the terminal value', cur, 'num', x => `${x.s('tv')}/(1+${wacc(x)})^(${x.i('years')}-${x.i('stub')})`),

    { section: 'Timeline' },
    row('t', 'Forecast year (0 or less = reported)', '#', 'int', x => (x.first ? -(H_ - 1) : `${x.p('t')}+1`)),
    row('year', 'Fiscal year', 'year', 'year', x => `${fy[H_ - 1]}+${x.r('t')}`, { bold: true }),
    row('fc', 'Forecast flag', 'flag', 'flag', x => `IF(${x.r('t')}>0,1,0)`),

    { section: 'Operating forecast' },
    // With consensus for year 2: year 1 and year 2 as estimated, then a straight line from year 2 to terminal growth.
    row('growth', 'Revenue growth', '%', 'pct', x => (x.k < H_ ? (x.first ? '""' : `${x.r('rev')}/${x.p('rev')}-1`)
      : `IF(AND(${x.i('cons')}=1,${x.r('t')}>=2),${x.i('g2')}+(${x.i('g_term')}-${x.i('g2')})*MAX(0,${x.r('t')}-MAX(2,${x.i('hold')}))/MAX(1,${x.i('years')}-MAX(2,${x.i('hold')})),${fade(x, 'g1', x.i('g_term'))})`)),
    row('rev', 'Revenue', cur, 'num', x => (x.k < H_ ? hv(x, 'rev') : `${x.p('rev')}*(1+${x.r('growth')})`), { bold: true }),
    row('margin', 'EBIT margin', '%', 'pct', x => (x.k < H_ ? `${x.r('ebit')}/${x.r('rev')}` : fade(x, 'm1', x.i('m_target')))),
    row('ebit', hasAm ? 'EBITA: EBIT before amortization of acquired intangibles' : 'EBIT', cur, 'num', x => (x.k < H_ ? hv(x, 'ebit') + (hasAm ? '+' + hv(x, 'amort') : '') : `${x.r('rev')}*${x.r('margin')}`)),
    row('da', hasAm ? 'Depreciation and amortization, excluding acquired intangibles' : 'Depreciation and amortization', cur, 'num', x => (x.k < H_ ? hv(x, 'da') + (hasAm ? '-' + hv(x, 'amort') : '') : `${x.r('rev')}*${x.i('da_pct')}`)),
    row('ebitda', 'EBITDA', cur, 'num', x => `${x.r('ebit')}+${x.r('da')}`, { bold: true }),
    row('nopat', 'NOPAT: EBIT x (1 - tax)', cur, 'num', x => `${x.r('ebit')}*(1-${x.i('tax')})`),
    row('reinv_rate', 'Reinvestment rate: (capex - D&A) / NOPAT', '%', 'pct',
      x => (x.k < H_ ? `IF(${x.r('nopat')}=0,"",(${x.r('capex')}-${x.r('da')})/${x.r('nopat')})` : fade(x, 'reinv1', `${x.i('g_term')}/${x.s('ronic_used')}`))),
    row('capex', 'Capital expenditures', cur, 'num', x => (x.k < H_ ? hv(x, 'capex') : `${x.r('da')}+${x.r('reinv_rate')}*${x.r('nopat')}`)),
    row('fcf', 'Unlevered free cash flow: NOPAT + D&A - capex', cur, 'num', x => `${x.r('nopat')}+${x.r('da')}-${x.r('capex')}`, { bold: true }),

    { section: 'Discounting' },
    row('fcf_used', 'Free cash flow still to come (year 1 excludes the part already passed)', cur, 'num', x => `${x.r('fc')}*${x.r('fcf')}*IF(${x.r('t')}=1,1-${x.i('stub')},1)`),
    row('period', 'Discount period from the price date (years)', 'years', 'num',
      x => `IF(${x.r('fc')}=0,0,IF(${x.i('mid')}=1,IF(${x.r('t')}=1,(1-${x.i('stub')})/2,${x.r('t')}-0.5-${x.i('stub')}),${x.r('t')}-${x.i('stub')}))`),
    row('dfac', 'Discount factor', 'x', 'num', x => `IF(${x.r('fc')}=0,0,1/(1+${wacc(x)})^${x.r('period')})`),
    row('pv_fcf', 'Present value of free cash flow', cur, 'num', x => `${x.r('fcf_used')}*${x.r('dfac')}`),
  ];
  const eq = (f: string | number) => (typeof f === 'number' ? f : '=' + f);
  return {
    def: {
      title: `${c.name} (${c.ticker}) DCF`,
      inputs: inputs.map(i => ({ ...i, ...over[i.id] })),
      items: items.map(it => ('kind' in it ? { ...it, f: (x: any) => eq(it.f(x)) } : it)) as Item[],
      columns: vv => H_ + vv.years,
      dash: {
        units: `${c.currency} millions except per share; FY = reported, E = forecast`,
        inputs: ['years', 'g1', 'g2', 'g_term', 'm1', 'm_target', 'tax', 'reinv1', 'roic', 'ronic_keep', 'rf', 'beta', 'erp', 'kd', 'wacc_in', 'exit_mult', 'shares', 'price'],
        outputs: ['per_share', 'upside', 'ev', 'eq', 'mkt_ev', 'ke', 'wacc', 'tv_share', 'ev_ebitda'],
        rows: ['rev', 'growth', 'ebitda', 'ebit', 'margin', 'nopat', 'capex', 'fcf'],
      },
    },
    missing,
  };
}
