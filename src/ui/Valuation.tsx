// Valuation summary for an equity: bear / base / bull toggle, a DCF fit test, a football field across methods
// (DCF on perpetuity growth and on an exit multiple, trading comparables on three multiples, 52-week range) and the peer table.
import { useEffect, useMemo, useState } from 'react';
import { Model, type ModelDef } from '../engine/sheet.ts';
import { SCENARIO, type Answers, type Company } from '../engine/dcf.ts';
import { dcfFit, quantile } from '../engine/fit.ts';
import { multiples, pickPeers, rowsOf, type Row } from '../engine/comps.ts';
import { fmt } from './ModelPage.tsx';
import { DATA } from './EquityPage.tsx';

type V = Record<string, number>;
type Case = Answers['scenario'];
const CASES: [Case, string][] = [['downside', 'Bear'], ['base', 'Base'], ['upside', 'Bull']];

let compsCache: Promise<Row[]> | undefined;
const loadComps = () => (compsCache ??= fetch(DATA + 'comps.json').then(r => (r.ok ? r.json() : { fields: [], rows: [] })).then(rowsOf, () => []));

type Bar = { label: string; lo: number; mid: number; hi: number; basis: string; off?: string };

export function ValuationSummary({ co, a, def, values, res, ccy, onCase }: {
  co: Company; a: Answers; def: ModelDef; values: V; res: { scalar: V; row: Record<string, number[]> }; ccy: string; onCase?: (c: Case) => void;
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
  const self: Row = { ticker: co.ticker, sic: co.sic ?? '', currency: co.currency, mcap, ev: mcap + claims, rev: rev[H - 1], ebitda: ebit[H - 1] + da[H - 1], ni: ni ?? null, fy: co.fyEnds.at(-1)! };
  const perShareFromEv = (ev: number) => (ev - claims) / values.shares;

  const peers = useMemo(() => (rows ? pickPeers(self, rows) : undefined), [rows, co.ticker, co.sic]); // eslint-disable-line react-hooks/exhaustive-deps
  const pm = (peers?.peers ?? []).map(multiples);
  const q = (k: 'evEbitda' | 'evRev' | 'pe') => { const xs = pm.map(m => m[k]); const n = xs.filter(x => x !== undefined).length; return n >= 3 ? [quantile(xs, 0.25)!, quantile(xs, 0.5)!, quantile(xs, 0.75)!] as const : undefined; };
  const qEbitda = q('evEbitda'), qRev = q('evRev'), qPe = q('pe');

  const out = useMemo(() => {
    const m = new Model(def, values);
    const cur = SCENARIO[a.scenario];
    const caseVals = (s: Case): V => { const c = SCENARIO[s]; return { ...values, g1: values.g1 + c[0] - cur[0], m_target: values.m_target * c[1] / cur[1], g_term: values.g_term + c[2] - cur[2] }; };
    const run = (v: V) => { m.set(v); return m.results(); };
    const perp = CASES.map(([s]) => run({ ...caseVals(s), tv_mode: 0 }).scalar.per_share);
    const exitM = qEbitda ?? ([0.8, 1, 1.2].map(f => values.exit_mult * f) as unknown as readonly [number, number, number]);
    const exit = CASES.map(([s], k) => run({ ...caseVals(s), tv_mode: 1, exit_mult: exitM[k] }).scalar.per_share);
    const base = run({ ...caseVals('base') });
    m.hf.destroy();
    const fcfForecast = base.row.fcf.filter((_, k) => base.row.fc[k] === 1);
    const fit = dcfFit({ rev, ebit, capex, fcfForecast, ev: res.scalar.ev, tvShare: res.scalar.tv_share });
    return { perp, exit, exitM, fit };
  }, [def, values, a.scenario, qEbitda?.[0], qEbitda?.[1], qEbitda?.[2]]); // eslint-disable-line react-hooks/exhaustive-deps

  const dcfOff = out.fit.verdict === 'no' ? 'not meaningful' : undefined;
  const bars: Bar[] = [
    { label: 'DCF, perpetuity growth', lo: out.perp[0], mid: out.perp[1], hi: out.perp[2], basis: 'Bear, base and bull cases', off: dcfOff },
    { label: 'DCF, exit multiple', lo: out.exit[0], mid: out.exit[1], hi: out.exit[2], basis: !qEbitda && !(values.exit_mult > 0) ? 'No exit multiple: fewer than 3 peers with a meaningful EV / EBITDA and the current multiple is negative' : `Exit EV / EBITDA ${out.exitM.map(x => fmt(x, 'x')).join(', ')} (${qEbitda ? 'peer 25th, median, 75th' : 'current multiple -20%, 0, +20%'}) with the bear, base and bull cases`, off: dcfOff ?? (qEbitda || values.exit_mult > 0 ? undefined : 'no exit multiple') },
  ];
  const compBar = (label: string, qs: readonly [number, number, number] | undefined, metric: number | null, toShare: (x: number) => number, what: string) => {
    if (!qs) return bars.push({ label, lo: NaN, mid: NaN, hi: NaN, basis: 'fewer than 3 peers with a meaningful multiple', off: 'no peers' });
    if (!(metric && metric > 0)) return bars.push({ label, lo: NaN, mid: NaN, hi: NaN, basis: `${co.ticker}'s ${what} is negative`, off: 'not meaningful' });
    bars.push({ label, lo: toShare(qs[0] * metric), mid: toShare(qs[1] * metric), hi: toShare(qs[2] * metric), basis: `Peer 25th to 75th percentile ${fmt(qs[0], 'x')} to ${fmt(qs[2], 'x')}, median ${fmt(qs[1], 'x')}, on last-year ${what}` });
  };
  compBar('Comps, EV / EBITDA', qEbitda, self.ebitda, perShareFromEv, 'EBITDA');
  compBar('Comps, EV / revenue', qRev, self.rev, perShareFromEv, 'revenue');
  compBar('Comps, P / E', qPe, self.ni, x => x / values.shares, 'net income');
  if (co.price.lo52 && co.price.hi52) bars.push({ label: '52-week trading range', lo: co.price.lo52, mid: co.price.v, hi: co.price.hi52, basis: `52-week low and high, Yahoo Finance (${co.price.symbol}); mid line is the latest close` });

  return (
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
        <thead><tr><th>Method ({ccy} per share)</th><th>Bear / low</th><th>Base / mid</th><th>Bull / high</th><th style={{ textAlign: 'left' }}>Basis</th></tr></thead>
        <tbody>{bars.map(b => (
          <tr key={b.label} className={b.off ? 'muted' : ''}>
            <td>{b.label}</td>
            {b.off ? <td colSpan={3} style={{ textAlign: 'center' }}>{b.off}</td> : [b.lo, b.mid, b.hi].map((v, k) => <td key={k}>{fmt(v, 'px')}</td>)}
            <td className="note" style={{ textAlign: 'left', whiteSpace: 'normal', minWidth: 240 }}>{b.basis}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="note">Current price {ccy}{fmt(values.price, 'px')}. Bear and bull move year 1 growth by 3pt, the target EBIT margin by 10% and terminal growth by 0.5pt from the case shown{onCase ? '; the toggle switches the case the whole page uses (edits reset)' : ''}. Multiples apply to the last reported year through the same bridge as the DCF (debt, cash, non-controlling interests, preferred).</p>
      {peers && <PeersTable peers={peers.peers} basis={peers.basis} self={self} />}
    </div>
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
  const stat = (p: number) => ({ evEbitda: quantile(ms.map(m => m.evEbitda), p), evRev: quantile(ms.map(m => m.evRev), p), pe: quantile(ms.map(m => m.pe), p) });
  return (
    <>
      <h2 style={{ marginTop: 16 }}>Trading comparables</h2>
      <p className="note">Peers: {basis}. Multiples on each company's last reported fiscal year and latest close; n/m where earnings are negative or the multiple is above 100x.</p>
      <div className="scroll-x"><table>
        <thead><tr><th>Company</th><th>Market cap (m)</th><th>EV (m)</th><th>EV / EBITDA</th><th>EV / revenue</th><th>P / E</th><th>Fiscal year</th></tr></thead>
        <tbody>
          <tr style={{ fontWeight: 700 }}><td>{self.ticker}</td><td>{self.currency === 'CAD' ? 'C$' : 'US$'}{fmt(self.mcap)}</td><td>{fmt(self.ev)}</td><td>{x(me.evEbitda)}</td><td>{x(me.evRev)}</td><td>{x(me.pe)}</td><td>{self.fy}</td></tr>
          {peers.map((p, k) => (
            <tr key={p.ticker}><td><a href={`#/equity/${p.ticker}`}>{p.ticker}</a></td><td>{p.currency === 'CAD' ? 'C$' : 'US$'}{fmt(p.mcap)}</td><td>{fmt(p.ev)}</td><td>{x(ms[k].evEbitda)}</td><td>{x(ms[k].evRev)}</td><td>{x(ms[k].pe)}</td><td>{p.fy}</td></tr>
          ))}
          {([['25th percentile', 0.25], ['Median', 0.5], ['75th percentile', 0.75]] as const).map(([l, p]) => { const s = stat(p); return <tr key={l} className={p === 0.5 ? 'total' : ''}><td>Peer {l.toLowerCase()}</td><td></td><td></td><td>{x(s.evEbitda)}</td><td>{x(s.evRev)}</td><td>{x(s.pe)}</td><td></td></tr>; })}
        </tbody>
      </table></div>
    </>
  );
}

