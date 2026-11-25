// Valuation summary for an equity, shared by the page (Valuation.tsx) and the Excel export (excel.ts Comps and Valuation tabs):
// the DCF fit test, a football field across methods (DCF on perpetuity growth and on an exit multiple for the bear, base
// and bull cases; trading comparables on five multiples; 52-week range) and the weighted implied share price.
// The DCF values come from the case blocks of the model (dcf.ts), the same formulas the workbook carries.
import type { Results } from './sheet.ts';
import type { Company } from './dcf.ts';
import { blend, dcfFit, quantile, type Fit, type Method } from './fit.ts';
import { forward, multiples, type Row } from './comps.ts';

type V = Record<string, number>;
export type Bar = { label: string; lo: number; mid: number; hi: number; basis: string; off?: string; key?: Method; what?: string };
export type Q = readonly [number, number, number];
export const CASE_SFX = ['_bear', '_base', '_bull'] as const;
const fx = (n: number) => `${n.toFixed(2)}x`;

// The subject on the same basis as the comps file, from the inputs as edited.
export function selfRow(co: Company, values: V): Row {
  const H = Object.keys(values).filter(k => /^rev_h\d+$/.test(k)).length;
  const mcap = values.price * values.shares;
  const claims = values.debt - values.cash + values.nci + values.pref;
  const fwd = forward(co, values[`rev_h${H}`], values.shares);
  return { ticker: co.ticker, sic: co.sic ?? '', ind: co.industry?.name, currency: co.currency, mcap, ev: mcap + claims, rev: values[`rev_h${H}`],
    ebitda: values[`ebit_h${H}`] + values[`da_h${H}`], ni: co.hist.ni.at(-1)?.v ?? null, fy: co.fyEnds.at(-1)!, rev_f: fwd.rev_f, ni_f: fwd.ni_f };
}

// Peer 25th, median and 75th percentile of a multiple; undefined with fewer than 3 meaningful values.
export function quartiles(peers: Row[]) {
  const pm = peers.map(multiples);
  const q = (k: keyof ReturnType<typeof multiples>): Q | undefined => {
    const xs = pm.map(m => m[k]);
    return xs.filter(x => x !== undefined).length >= 3 ? [quantile(xs, 0.25)!, quantile(xs, 0.5)!, quantile(xs, 0.75)!] : undefined;
  };
  return { evEbitda: q('evEbitda'), evRev: q('evRev'), pe: q('pe'), peF: q('peF'), evRevF: q('evRevF') };
}

export function valuation({ co, values, res, peers, missing }: { co: Company; values: V; res: Results; peers: Row[]; missing?: string[] }) {
  const H = Object.keys(values).filter(k => /^rev_h\d+$/.test(k)).length;
  const hv = (id: string) => Array.from({ length: H }, (_, k) => values[`${id}_h${k + 1}`]);
  const self = selfRow(co, values);
  const claims = values.debt - values.cash + values.nci + values.pref;
  const perShareFromEv = (ev: number) => (ev - claims) / values.shares;
  const q = quartiles(peers);
  const s = res.scalar;
  const perp = CASE_SFX.map(x => s['ps_g' + x]);
  const exitM: Q = q.evEbitda ?? [0.8, 1, 1.2].map(f => values.exit_mult * f) as unknown as Q;
  const exit = CASE_SFX.map((x, k) => (s['eq_pre_tv' + x] + exitM[k] * s['ebitda_n' + x] * s.tv_df) / values.shares);
  const fcfForecast = res.row.fcf_base.filter((_, k) => res.row.fc[k] === 1);
  const fit: Fit = dcfFit({ rev: hv('rev'), ebit: hv('ebit'), capex: hv('capex'), fcfForecast, ev: s.ev, tvShare: s.tv_share, missing });

  const dcfOff = fit.verdict === 'no' ? 'not meaningful' : undefined;
  const bars: Bar[] = [
    { key: 'dcf_g', label: 'DCF, perpetuity growth', lo: perp[0], mid: perp[1], hi: perp[2], basis: 'Bear, base and bull cases', off: dcfOff },
    // The exit-multiple DCF counts in the implied price only on peer multiples: the company's own multiple would just restate its price.
    { key: q.evEbitda ? 'dcf_x' : undefined, label: 'DCF, exit multiple', lo: exit[0], mid: exit[1], hi: exit[2],
      basis: !q.evEbitda && !(values.exit_mult > 0) ? 'No exit multiple: fewer than 3 peers with a meaningful EV / EBITDA and the current multiple is negative' : `Exit EV / EBITDA ${exitM.map(fx).join(', ')} (${q.evEbitda ? 'peer 25th, median, 75th' : 'current multiple -20%, 0, +20%'}) with the bear, base and bull cases`,
      off: dcfOff ?? (q.evEbitda || values.exit_mult > 0 ? undefined : 'no exit multiple') },
  ];
  const compBar = (key: Method, label: string, qs: Q | undefined, metric: number | null | undefined, toShare: (x: number) => number, what: string) => {
    if (!qs) return bars.push({ label, lo: NaN, mid: NaN, hi: NaN, basis: 'fewer than 3 peers with a meaningful multiple', off: 'no peers', what });
    if (!(metric && metric > 0)) return bars.push({ label, lo: NaN, mid: NaN, hi: NaN, basis: `${co.ticker}'s ${what} is negative`, off: 'not meaningful', what });
    bars.push({ key, label, lo: toShare(qs[0] * metric), mid: toShare(qs[1] * metric), hi: toShare(qs[2] * metric), basis: `Peer 25th to 75th percentile ${fx(qs[0])} to ${fx(qs[2])}, median ${fx(qs[1])}, on ${what}`, what });
  };
  // Forward multiples only when the company has consensus for both years (the peers' own count is checked in quartiles).
  const fwdBar = (key: Method, label: string, qs: Q | undefined, metric: number | null | undefined, toShare: (x: number) => number, what: string) =>
    metric == null ? bars.push({ label, lo: NaN, mid: NaN, hi: NaN, basis: `no analyst consensus for ${co.ticker}'s next two fiscal years`, off: 'no consensus', what }) : compBar(key, label, qs, metric, toShare, what);
  compBar('ev_ebitda', 'Comps, EV / EBITDA', q.evEbitda, self.ebitda, perShareFromEv, 'last-year EBITDA');
  fwdBar('pe_f', 'Comps, forward P / E', q.peF, self.ni_f, x => x / values.shares, 'next twelve months consensus EPS x shares');
  compBar('pe', 'Comps, P / E', q.pe, self.ni, x => x / values.shares, 'last-year net income');
  fwdBar('ev_rev_f', 'Comps, forward EV / revenue', q.evRevF, self.rev_f, perShareFromEv, 'next twelve months consensus revenue');
  compBar('ev_rev', 'Comps, EV / revenue', q.evRev, self.rev, perShareFromEv, 'last-year revenue');
  if (co.price.lo52 && co.price.hi52) bars.push({ label: '52-week trading range', lo: co.price.lo52, mid: values.price, hi: co.price.hi52, basis: `52-week low and high, Yahoo Finance (${co.price.symbol}); mid line is the latest close` });

  // Implied share price: the methods weighted by how well each fits, for the bear, base and bull cases.
  const at = (k: number) => Object.fromEntries(bars.filter(b => b.key && !b.off).map(b => [b.key, [b.lo, b.mid, b.hi][k]])) as Partial<Record<Method, number>>;
  const mixes = [0, 1, 2].map(k => blend(fit.verdict, at(k), at(1)));
  return { bars, mixes, fit, q, exitM, self, claims };
}
