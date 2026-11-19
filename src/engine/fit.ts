// Is a DCF a sensible primary method for this company? A DCF needs positive, reasonably predictable operating cash flow.
// The test reads the reported history and the model's own base forecast and returns a verdict with plain reasons.
export type Fit = { verdict: 'ok' | 'caution' | 'no'; reasons: string[] };

export function dcfFit(x: { rev: number[]; ebit: number[]; capex: number[]; fcfForecast: number[]; ev: number; tvShare: number; missing?: string[] }): Fit {
  const no: string[] = [], caution: string[] = [];
  if (x.missing?.length) no.push(`Not tagged in the XBRL data: ${x.missing.join(', ')}. The DCF runs on placeholders until those figures are entered from the annual report.`);
  const n = x.ebit.length, lossYears = x.ebit.filter(e => e < 0).length;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (!(x.ev > 0)) no.push('The DCF enterprise value is zero or negative: forecast free cash flow does not cover the investment the model assumes.');
  if (x.ebit[n - 1] < 0 && lossYears >= Math.min(2, n)) no.push(`Operating losses in ${lossYears} of the last ${n} reported years, including the latest. A DCF would rest on an assumed turnaround, not on the company's record.`);
  if (x.fcfForecast.length && x.fcfForecast.every(f => f < 0)) no.push('Free cash flow is negative in every forecast year, so almost all of the value would sit in the terminal value.');
  const capexShare = x.capex[n - 1] / x.rev[n - 1];
  if (capexShare > 0.5) caution.push(`Heavy build-out: capex was ${pct(capexShare)} of revenue in the latest year, so current cash flow says little about steady-state cash flow.`);
  const cagr = (x.rev[n - 1] / x.rev[0]) ** (1 / Math.max(1, n - 1)) - 1;
  if (cagr > 0.4) caution.push(`Revenue grew ${pct(cagr)} a year over the history, too fast for history to be a reliable guide to the forecast.`);
  else if (cagr > 0.2) caution.push(`Revenue grew ${pct(cagr)} a year. A fast grower usually stays fast for longer than a 5-year fade assumes: try a 10-year forecast, and read "What the price implies" for the growth the market is paying for.`);
  if (lossYears > 0 && !no.length) caution.push(`An operating loss in ${lossYears} of the last ${n} years.`);
  if (x.tvShare > 0.85 && x.ev > 0) caution.push(`The terminal value is ${pct(x.tvShare)} of enterprise value, so the result turns mostly on the long-run assumptions.`);
  return no.length ? { verdict: 'no', reasons: [...no, ...caution] } : { verdict: caution.length ? 'caution' : 'ok', reasons: caution };
}

// Interpolated quantile of the finite values in a.
export function quantile(a: (number | undefined)[], p: number) {
  const s = a.filter((v): v is number => v !== undefined && Number.isFinite(v)).sort((x, y) => x - y);
  if (!s.length) return undefined;
  const i = (s.length - 1) * p, lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
}

// Weights for the implied share price: how much each method counts, set by whether the DCF fits.
// A method with no value (no peers, negative earnings, a negative result) drops out and the rest are scaled to 100%.
export type Method = 'dcf_g' | 'dcf_x' | 'ev_ebitda' | 'pe' | 'ev_rev';
const W: Record<Fit['verdict'], Record<Method, number>> = {
  ok: { dcf_g: 0.25, dcf_x: 0.25, ev_ebitda: 0.25, pe: 0.25, ev_rev: 0 },
  caution: { dcf_g: 0.15, dcf_x: 0.15, ev_ebitda: 0.35, pe: 0.35, ev_rev: 0 },
  no: { dcf_g: 0, dcf_x: 0, ev_ebitda: 1 / 3, pe: 1 / 3, ev_rev: 1 / 3 },
};
export const WHY: Record<Fit['verdict'], string> = {
  ok: 'The DCF fits, so it carries half the weight (perpetuity growth and exit multiple equally) and peer EV / EBITDA and P / E the other half. EV / revenue is left out because it ignores margins.',
  caution: 'The DCF is usable with care, so it carries 30% and peer EV / EBITDA and P / E 70%. EV / revenue is left out because it ignores margins.',
  no: 'The DCF is not meaningful, so it carries no weight. The price rests on peer multiples, with EV / revenue included because earnings are negative or not yet representative.',
};
export function blend(verdict: Fit['verdict'], values: Partial<Record<Method, number>>) {
  const ok = (m: Method) => { const v = values[m]; return v !== undefined && Number.isFinite(v) && v > 0; };
  let w = Object.fromEntries((Object.keys(W.ok) as Method[]).map(m => [m, ok(m) ? W[verdict][m] : 0])) as Record<Method, number>;
  // Profitable but every earnings-based method missing: fall back to revenue multiples.
  if (!Object.values(w).some(x => x > 0) && ok('ev_rev')) w = { ...w, ev_rev: 1 };
  const sum = Object.values(w).reduce((s, x) => s + x, 0);
  if (!sum) return undefined;
  const weights = Object.fromEntries(Object.entries(w).map(([m, x]) => [m, x / sum])) as Record<Method, number>;
  return { weights, value: (Object.keys(weights) as Method[]).reduce((s, m) => s + (weights[m] ? weights[m] * values[m]! : 0), 0) };
}
