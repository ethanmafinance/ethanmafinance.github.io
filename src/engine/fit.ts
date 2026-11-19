// Is a DCF a sensible primary method for this company? A DCF needs positive, reasonably predictable operating cash flow.
// The test reads the reported history and the model's own base forecast and returns a verdict with plain reasons.
export type Fit = { verdict: 'ok' | 'caution' | 'no'; reasons: string[] };

export function dcfFit(x: { rev: number[]; ebit: number[]; capex: number[]; fcfForecast: number[]; ev: number; tvShare: number }): Fit {
  const no: string[] = [], caution: string[] = [];
  const n = x.ebit.length, lossYears = x.ebit.filter(e => e < 0).length;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (!(x.ev > 0)) no.push('The DCF enterprise value is zero or negative: forecast free cash flow does not cover the investment the model assumes.');
  if (x.ebit[n - 1] < 0 && lossYears >= Math.min(2, n)) no.push(`Operating losses in ${lossYears} of the last ${n} reported years, including the latest. A DCF would rest on an assumed turnaround, not on the company's record.`);
  if (x.fcfForecast.length && x.fcfForecast.every(f => f < 0)) no.push('Free cash flow is negative in every forecast year, so almost all of the value would sit in the terminal value.');
  const capexShare = x.capex[n - 1] / x.rev[n - 1];
  if (capexShare > 0.5) caution.push(`Heavy build-out: capex was ${pct(capexShare)} of revenue in the latest year, so current cash flow says little about steady-state cash flow.`);
  const cagr = (x.rev[n - 1] / x.rev[0]) ** (1 / Math.max(1, n - 1)) - 1;
  if (cagr > 0.4) caution.push(`Revenue grew ${pct(cagr)} a year over the history, too fast for history to be a reliable guide to the forecast.`);
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
