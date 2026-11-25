// Valuation summary for an equity: bear / base / bull toggle, a DCF fit test, a football field across methods
// (DCF on perpetuity growth and on an exit multiple, trading comparables on three multiples, 52-week range) and the peer table.
import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import type { ModelDef, Results } from '../engine/sheet.ts';
import type { Answers, Company } from '../engine/dcf.ts';
import { dcfFit, quantile, W, WHY } from '../engine/fit.ts';
import { multiples, pickPeers, rowsOf, type Row } from '../engine/comps.ts';
import { selfRow, valuation, type Bar } from '../engine/valuation.ts';
import type { ValuationExport } from '../engine/excel.ts';
import { fmt } from './ModelPage.tsx';
import { DATA } from './EquityPage.tsx';

type V = Record<string, number>;
type Case = Answers['scenario'];
const CASES: [Case, string][] = [['downside', 'Bear'], ['base', 'Base'], ['upside', 'Bull']];

let compsCache: Promise<Row[]> | undefined;
const loadComps = () => (compsCache ??= fetch(DATA + 'comps.json').then(r => (r.ok ? r.json() : { fields: [], rows: [] })).then(rowsOf, () => []));

export function ValuationSummary({ co, a, values, res, ccy, onCase, missing, exportRef }: {
  co: Company; a: Answers; def?: ModelDef; values: V; res: { scalar: V; row: Record<string, number[]> }; ccy: string; onCase?: (c: Case) => void; missing?: string[];
  exportRef?: MutableRefObject<ValuationExport | undefined>;
}) {
  const [rows, setRows] = useState<Row[]>();
  useEffect(() => { loadComps().then(setRows); }, []);

  const self = selfRow(co, values);
  const peers = useMemo(() => (rows ? pickPeers(self, rows) : undefined), [rows, co.ticker, co.sic, co.industry?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = useMemo(() => valuation({ co, values, res: res as Results, peers: peers?.peers ?? [], missing }), [co, values, res, peers, missing?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const { bars, mixes, fit } = v;
  const out = { fit };
  const dcfOff = fit.verdict === 'no' ? 'not meaningful' : undefined;
  // What the Excel export needs to rebuild the comps and the football field with live formulas.
  if (exportRef) exportRef.current = peers ? { peers: peers.peers, basis: peers.basis, self: v.self, fit, weights: W[fit.verdict], why: WHY[fit.verdict], lo52: co.price.lo52, hi52: co.price.hi52, consDate: co.cons?.date } : undefined;
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

