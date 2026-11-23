// Valuation summary for an equity: bear / base / bull toggle, a DCF fit test, a football field across methods
// (DCF on perpetuity growth and on an exit multiple, trading comparables on three multiples, 52-week range) and the peer table.
import { useEffect, useMemo, useState } from 'react';
import { Model, type ModelDef } from '../engine/sheet.ts';
import { SCENARIO, shiftMargin, type Answers, type Company } from '../engine/dcf.ts';
import { blend, dcfFit, quantile, WHY, type Method } from '../engine/fit.ts';
import { forward, multiples, pickPeers, rowsOf, type Row } from '../engine/comps.ts';
import { fmt } from './ModelPage.tsx';
import { DATA } from './EquityPage.tsx';

type V = Record<string, number>;
type Case = Answers['scenario'];
const CASES: [Case, string][] = [['downside', 'Bear'], ['base', 'Base'], ['upside', 'Bull']];

let compsCache: Promise<Row[]> | undefined;
const loadComps = () => (compsCache ??= fetch(DATA + 'comps.json').then(r => (r.ok ? r.json() : { fields: [], rows: [] })).then(rowsOf, () => []));

type Bar = { label: string; lo: number; mid: number; hi: number; basis: string; off?: string; key?: Method };

export function ValuationSummary({ co, a, def, values, res, ccy, onCase, missing }: {
  co: Company; a: Answers; def: ModelDef; values: V; res: { scalar: V; row: Record<string, number[]> }; ccy: string; onCase?: (c: Case) => void; missing?: string[];
}) {
  const [rows, setRows] = useState<Row[]>();
  useEffect(() => { loadComps().then(setRows); }, []);

  // The subject on the same basis as the comps file, using the inputs as edited on the page.
  const H = def.inputs.filter(i => /^rev_h\d+$/.test(i.id)).length;
  const hv = (id: string) => Array.from({ length: H }, (_, k) => values[`${id}_h${k + 1}`]);
  const rev = hv('rev'), ebit = hv('ebit'), da = hv('da'), capex = hv('capex');
  const ni = co.hist.ni.at(-1)?.v;
  const mcap = values.price * values.shares;
  const claims = values.debt - values.cash + values.nci + values.pref;
  const fwd = forward(co, rev[H - 1], values.shares);
  const self: Row = { ticker: co.ticker, sic: co.sic ?? '', currency: co.currency, mcap, ev: mcap + claims, rev: rev[H - 1], ebitda: ebit[H - 1] + da[H - 1], ni: ni ?? null, fy: co.fyEnds.at(-1)!, rev_f: fwd.rev_f, ni_f: fwd.ni_f };
  const perShareFromEv = (ev: number) => (ev - claims) / values.shares;

  const peers = useMemo(() => (rows ? pickPeers(self, rows) : undefined), [rows, co.ticker, co.sic]); // eslint-disable-line react-hooks/exhaustive-deps
  const pm = (peers?.peers ?? []).map(multiples);
  const q = (k: 'evEbitda' | 'evRev' | 'pe' | 'peF' | 'evRevF') => { const xs = pm.map(m => m[k]); const n = xs.filter(x => x !== undefined).length; return n >= 3 ? [quantile(xs, 0.25)!, quantile(xs, 0.5)!, quantile(xs, 0.75)!] as const : undefined; };
  const qEbitda = q('evEbitda'), qRev = q('evRev'), qPe = q('pe'), qPeF = q('peF'), qRevF = q('evRevF');

  const out = useMemo(() => {
    const m = new Model(def, values);
    const cur = SCENARIO[a.scenario];
    const caseVals = (s: Case): V => { const c = SCENARIO[s]; return { ...values, g1: values.g1 + c[0] - cur[0], g2: values.g2 + c[0] - cur[0], m_target: shiftMargin(values.m_target / (1 + (cur[1] - 1) * Math.sign(values.m_target)), c[1]), g_term: values.g_term + c[2] - cur[2] }; };
    const run = (v: V) => { m.set(v); return m.results(); };
    const perp = CASES.map(([s]) => run({ ...caseVals(s), tv_mode: 0 }).scalar.per_share);
    const exitM = qEbitda ?? ([0.8, 1, 1.2].map(f => values.exit_mult * f) as unknown as readonly [number, number, number]);
    const exit = CASES.map(([s], k) => run({ ...caseVals(s), tv_mode: 1, exit_mult: exitM[k] }).scalar.per_share);
    const base = run({ ...caseVals('base') });
    m.hf.destroy();
    const fcfForecast = base.row.fcf.filter((_, k) => base.row.fc[k] === 1);
    const fit = dcfFit({ rev, ebit, capex, fcfForecast, ev: res.scalar.ev, tvShare: res.scalar.tv_share, missing });
    return { perp, exit, exitM, fit };
  }, [def, values, a.scenario, missing?.length, qEbitda?.[0], qEbitda?.[1], qEbitda?.[2]]); // eslint-disable-line react-hooks/exhaustive-deps

  const dcfOff = out.fit.verdict === 'no' ? 'not meaningful' : undefined;
  const bars: Bar[] = [
    { key: 'dcf_g', label: 'DCF, perpetuity growth', lo: out.perp[0], mid: out.perp[1], hi: out.perp[2], basis: 'Bear, base and bull cases', off: dcfOff },
    // The exit-multiple DCF counts in the implied price only on peer multiples: the company's own multiple would just restate its price.
    { key: qEbitda ? 'dcf_x' : undefined, label: 'DCF, exit multiple', lo: out.exit[0], mid: out.exit[1], hi: out.exit[2], basis: !qEbitda && !(values.exit_mult > 0) ? 'No exit multiple: fewer than 3 peers with a meaningful EV / EBITDA and the current multiple is negative' : `Exit EV / EBITDA ${out.exitM.map(x => fmt(x, 'x')).join(', ')} (${qEbitda ? 'peer 25th, median, 75th' : 'current multiple -20%, 0, +20%'}) with the bear, base and bull cases`, off: dcfOff ?? (qEbitda || values.exit_mult > 0 ? undefined : 'no exit multiple') },
  ];
  const compBar = (key: Method, label: string, qs: readonly [number, number, number] | undefined, metric: number | null, toShare: (x: number) => number, what: string) => {
    if (!qs) return bars.push({ label, lo: NaN, mid: NaN, hi: NaN, basis: 'fewer than 3 peers with a meaningful multiple', off: 'no peers' });
    if (!(metric && metric > 0)) return bars.push({ label, lo: NaN, mid: NaN, hi: NaN, basis: `${co.ticker}'s ${what} is negative`, off: 'not meaningful' });
    bars.push({ key, label, lo: toShare(qs[0] * metric), mid: toShare(qs[1] * metric), hi: toShare(qs[2] * metric), basis: `Peer 25th to 75th percentile ${fmt(qs[0], 'x')} to ${fmt(qs[2], 'x')}, median ${fmt(qs[1], 'x')}, on ${what}` });
  };
  // Forward multiples only when the company has consensus for both years (the peers' own count is checked in q).
  const fwdBar = (key: Method, label: string, qs: typeof qPeF, metric: number | null | undefined, toShare: (x: number) => number, what: string) =>
    metric == null ? bars.push({ label, lo: NaN, mid: NaN, hi: NaN, basis: `no analyst consensus for ${co.ticker}'s next two fiscal years`, off: 'no consensus' }) : compBar(key, label, qs, metric, toShare, what);
  compBar('ev_ebitda', 'Comps, EV / EBITDA', qEbitda, self.ebitda, perShareFromEv, 'last-year EBITDA');
  fwdBar('pe_f', 'Comps, forward P / E', qPeF, self.ni_f, x => x / values.shares, 'next twelve months consensus EPS x shares');
  compBar('pe', 'Comps, P / E', qPe, self.ni, x => x / values.shares, 'last-year net income');
  fwdBar('ev_rev_f', 'Comps, forward EV / revenue', qRevF, self.rev_f, perShareFromEv, 'next twelve months consensus revenue');
  compBar('ev_rev', 'Comps, EV / revenue', qRev, self.rev, perShareFromEv, 'last-year revenue');
  if (co.price.lo52 && co.price.hi52) bars.push({ label: '52-week trading range', lo: co.price.lo52, mid: co.price.v, hi: co.price.hi52, basis: `52-week low and high, Yahoo Finance (${co.price.symbol}); mid line is the latest close` });

  // Implied share price: the methods weighted by how well each fits, for the bear, base and bull cases
  // (DCF cases; peer 25th, median and 75th percentile multiples).
  const at = (k: number) => Object.fromEntries(bars.filter(b => b.key && !b.off).map(b => [b.key, [b.lo, b.mid, b.hi][k]])) as Partial<Record<Method, number>>;
  const mixes = [0, 1, 2].map(k => blend(out.fit.verdict, at(k), at(1)));
  const mix = mixes[CASES.findIndex(([c]) => c === a.scenario)], mixBase = mixes[1];
  const s = res.scalar;
  const caseName = a.scenario === 'downside' ? 'bear' : a.scenario === 'upside' ? 'bull' : 'base';
  const kpis: [string, string, string][] = [
    ['Implied share price', mix ? `${ccy}${fmt(mix.value, 'px')}` : 'n/m', mix ? `weighted DCF and comps, ${caseName} case; range ${mixes.map(m => (m ? fmt(m.value, 'px') : 'n/m')).join(' / ')}` : 'no method gives a meaningful value'],
    ['Upside', mix ? fmt(mix.value / values.price - 1, 'pct') : 'n/m', `to the price of ${ccy}${fmt(values.price, 'px')}`],
    ['DCF implied share price', dcfOff ? 'n/m' : `${ccy}${fmt(s.per_share, 'px')}`, dcfOff ? 'DCF not meaningful, no weight' : `${values.tv_mode ? 'exit multiple' : 'perpetuity growth'}, ${caseName} case`],
    ['Enterprise value (DCF)', fmt(s.ev), `${ccy}m; at the price ${fmt(s.mkt_ev)}`],
    ['WACC', fmt(s.wacc, 'pct'), values.wacc_mode ? 'entered' : `Ke ${fmt(s.ke, 'pct')}, debt ${fmt(s.w_d, 'pct')}`],
    ['Terminal value', fmt(s.tv_share, 'pct'), `of DCF enterprise value; ${fmt(s.tv_mult_implied, 'x')} EBITDA`],
  ];

  return (
    <>
    <div className="kpis">
      {kpis.map(([l, v, sub]) => (
        <div className={`card kpi${l === 'Implied share price' ? ' lead' : ''}`} key={l}><div className="label">{l}</div><div className="value">{v}</div><div className="sub">{sub}</div></div>
      ))}
    </div>
    <div className="card">
      <div className="vs-head">
        <h2 style={{ margin: 0 }}>Valuation summary</h2>
        {onCase && (
          <div className="case-toggle" role="group" aria-label="Case">
            {CASES.map(([s, l]) => <button key={s} className={s === a.scenario ? 'on' : ''} aria-pressed={s === a.scenario} onClick={() => onCase(s)}>{l}</button>)}
          </div>
        )}
      </div>
      <FitBanner fit={out.fit} ticker={co.ticker} />
      <FootballField bars={bars} price={values.price} ccy={ccy} />
      <div className="scroll-x"><table>
        <thead><tr><th>Method ({ccy} per share)</th><th>Bear / low</th><th>Base / mid</th><th>Bull / high</th><th>Weight</th><th style={{ textAlign: 'left' }}>Basis</th></tr></thead>
        <tbody>{bars.map(b => (
          <tr key={b.label} className={b.off ? 'muted' : ''}>
            <td>{b.label}</td>
            {b.off ? <td colSpan={3} style={{ textAlign: 'center' }}>{b.off}</td> : [b.lo, b.mid, b.hi].map((v, k) => <td key={k}>{fmt(v, 'px')}</td>)}
            <td>{b.key && mixBase?.weights[b.key] ? fmt(mixBase.weights[b.key], 'pct') : '0%'}</td>
            <td className="note" style={{ textAlign: 'left', whiteSpace: 'normal', minWidth: 240 }}>{b.basis}{!b.key && b.label.startsWith('DCF') ? ". Not weighted: with no peer multiple the exit uses the company's own multiple, which restates its price" : ''}{b.label.startsWith('52') ? ". Not weighted: it is the market's own price, the thing being tested" : ''}</td>
          </tr>
        ))}
        {mixBase && <tr className="total"><td>Implied share price (weighted)</td>{mixes.map((m, k) => <td key={k}>{m ? fmt(m.value, 'px') : 'n/m'}</td>)}<td>100%</td><td className="note" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{WHY[out.fit.verdict]} The weight of a method with no value is spread over the rest.</td></tr>}
        </tbody>
      </table></div>
      <p className="note">Current price {ccy}{fmt(values.price, 'px')}. Bear and bull move years 1 and 2 growth by 3pt, the target EBIT margin by 10% and terminal growth by 0.5pt from the case shown{onCase ? '; the toggle switches the case the whole page uses (edits reset)' : ''}. Trailing multiples apply to the last reported year and forward multiples to the next twelve months of analyst consensus, both through the same bridge as the DCF (debt, cash, non-controlling interests, preferred).{co.cons?.date ? ` Consensus: Yahoo Finance analyst estimates, ${co.cons.date}.` : ''}</p>
      {peers && <PeersTable peers={peers.peers} basis={peers.basis} self={self} />}
    </div>
    </>
  );
}

function FitBanner({ fit, ticker }: { fit: ReturnType<typeof dcfFit>; ticker: string }) {
  if (fit.verdict === 'ok') return <p className="fit ok"><strong>DCF fits {ticker}.</strong> Operating income is positive and investment is in line with revenue, so the DCF is a reasonable primary method; the multiples cross-check it.</p>;
  return (
    <div className={`fit ${fit.verdict}`}>
      <strong>{fit.verdict === 'no' ? `A DCF is not meaningful for ${ticker} right now.` : `Use the DCF for ${ticker} with care.`}</strong>
      <ul>{fit.reasons.map(r => <li key={r}>{r}</li>)}</ul>
      {fit.verdict === 'no' && <span>Value it on trading multiples instead: EV / revenue is the usual yardstick while a company is not yet profitable. The DCF stays on the page to show why it fails.</span>}
    </div>
  );
}

function FootballField({ bars, price, ccy }: { bars: Bar[]; price: number; ccy: string }) {
  const live = bars.filter(b => !b.off && [b.lo, b.hi].every(Number.isFinite));
  const all = [price, ...live.flatMap(b => [b.lo, b.hi])];
  const max = Math.max(...all) * 1.08, min = Math.max(0, Math.min(...all) * 0.9);
  const W = 900, L = 190, R = 16, rowH = 30, top = 8, Hh = top + bars.length * rowH + 26;
  const x = (v: number) => L + ((Math.max(min, Math.min(max, v)) - min) / (max - min || 1)) * (W - L - R);
  const ticks = Array.from({ length: 5 }, (_, k) => min + ((max - min) * k) / 4);
  return (
    <div className="chart ff scroll-x" role="img" aria-label="Football field of value per share by method">
      <svg viewBox={`0 0 ${W} ${Hh}`} style={{ minWidth: 620 }}>
        {ticks.map(t => <g key={t} className="axis"><line className="gridline" x1={x(t)} x2={x(t)} y1={top} y2={Hh - 22} /><text x={x(t)} y={Hh - 8} textAnchor="middle">{fmt(t, 'px')}</text></g>)}
        {bars.map((b, k) => {
          const y = top + k * rowH + 6, h = rowH - 12;
          const ok = !b.off && Number.isFinite(b.lo) && Number.isFinite(b.hi);
          const lo = Math.min(b.lo, b.hi), hi = Math.max(b.lo, b.hi);
          return (
            <g key={b.label}>
              <text className="ff-label" x={L - 8} y={y + h / 2 + 4} textAnchor="end">{b.label}</text>
              {ok && hi > min ? <>
                <rect x={x(lo)} y={y} width={Math.max(2, x(hi) - x(lo))} height={h} rx={4} className={k < 2 ? 'ff-dcf' : k === bars.length - 1 && b.label.startsWith('52') ? 'ff-mkt' : 'ff-comp'} />
                <line x1={x(b.mid)} x2={x(b.mid)} y1={y - 2} y2={y + h + 2} className="ff-mid" />
              </> : <text x={L + 6} y={y + h / 2 + 4} className="ff-off">{b.off ?? 'below zero'}</text>}
            </g>
          );
        })}
        <line x1={x(price)} x2={x(price)} y1={top - 4} y2={Hh - 22} className="ff-price" />
        <text x={x(price)} y={top + 2} className="ff-price-label" textAnchor={x(price) > W - 80 ? 'end' : 'start'} dx={x(price) > W - 80 ? -4 : 4}>Price {ccy}{fmt(price, 'px')}</text>
      </svg>
    </div>
  );
}

function PeersTable({ peers, basis, self }: { peers: Row[]; basis: string; self: Row }) {
  if (!peers.length) return <p className="note">No peer group: {basis || 'no companies share its industry code'}.</p>;
  const x = (n?: number) => (n === undefined ? 'n/m' : fmt(n, 'x'));
  const ms = peers.map(multiples), me = multiples(self);
  const stat = (p: number) => ({ evEbitda: quantile(ms.map(m => m.evEbitda), p), evRev: quantile(ms.map(m => m.evRev), p), pe: quantile(ms.map(m => m.pe), p), evRevF: quantile(ms.map(m => m.evRevF), p), peF: quantile(ms.map(m => m.peF), p) });
  return (
    <>
      <h2 style={{ marginTop: 16 }}>Trading comparables</h2>
      <p className="note">Peers: {basis}. Trailing multiples on each company's last reported fiscal year, forward (fwd) on the next twelve months of analyst consensus (Yahoo Finance; EPS on the analysts' basis, usually before one-off items), all at the latest close; n/m where earnings are negative, the multiple is above 100x, or fewer than 3 analysts publish estimates.</p>
      <div className="scroll-x"><table>
        <thead><tr><th>Company</th><th>Market cap (m)</th><th>EV (m)</th><th>EV / EBITDA</th><th>EV / revenue</th><th>EV / revenue fwd</th><th>P / E</th><th>P / E fwd</th><th>Fiscal year</th></tr></thead>
        <tbody>
          <tr style={{ fontWeight: 700 }}><td>{self.ticker}</td><td>{self.currency === 'CAD' ? 'C$' : 'US$'}{fmt(self.mcap)}</td><td>{fmt(self.ev)}</td><td>{x(me.evEbitda)}</td><td>{x(me.evRev)}</td><td>{x(me.evRevF)}</td><td>{x(me.pe)}</td><td>{x(me.peF)}</td><td>{self.fy}</td></tr>
          {peers.map((p, k) => (
            <tr key={p.ticker}><td><a href={`#/equity/${p.ticker}`}>{p.ticker}</a></td><td>{p.currency === 'CAD' ? 'C$' : 'US$'}{fmt(p.mcap)}</td><td>{fmt(p.ev)}</td><td>{x(ms[k].evEbitda)}</td><td>{x(ms[k].evRev)}</td><td>{x(ms[k].evRevF)}</td><td>{x(ms[k].pe)}</td><td>{x(ms[k].peF)}</td><td>{p.fy}</td></tr>
          ))}
          {([['25th percentile', 0.25], ['Median', 0.5], ['75th percentile', 0.75]] as const).map(([l, p]) => { const s = stat(p); return <tr key={l} className={p === 0.5 ? 'total' : ''}><td>Peer {l.toLowerCase()}</td><td></td><td></td><td>{x(s.evEbitda)}</td><td>{x(s.evRev)}</td><td>{x(s.evRevF)}</td><td>{x(s.pe)}</td><td>{x(s.peF)}</td><td></td></tr>; })}
        </tbody>
      </table></div>
    </>
  );
}

