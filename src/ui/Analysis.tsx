// Analyst panels built on the model: downside cases and breakevens, pension lens,
// secondary-market equity value, and the bid solver. Each runs the same spreadsheet
// model with some inputs changed; nothing here uses separate formulas for the cash flows.
import { useMemo, useState } from 'react';
import type { Model, Results } from '../engine/sheet.ts';
import { last, useMarket } from '../data/boc.ts';
import { fmt } from './ModelPage.tsx';

type V = Record<string, number>;
const run = (m: Model, v: V, ov: V = {}) => { m.set({ ...v, ...ov }); return m.results(); };
// Bisection on one input: returns the value where f crosses the target, or undefined if it does not in [lo, hi].
export function solve(f: (x: number) => number, target: number, lo: number, hi: number, iters = 30) {
  let flo = f(lo) - target; const fhi = f(hi) - target;
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) return undefined;
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2, fm = f(mid) - target;
    if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}
const irr = (cf: number[]) => solve(r => cf.reduce((a, c, t) => a + c / (1 + r) ** t, 0), 0, -0.99, 1, 80);
// Value of 100% of the equity at financial close: distributions after the close year discounted at the buyer's target IRR.
export const equityValue = (res: Results, rate: number) => res.row.equity_cf.slice(1).reduce((a, c, t) => a + c / (1 + rate) ** (t + 1), 0);
const count = (a: number[], f: (v: number) => boolean) => a.filter(v => Number.isFinite(v) && f(v)).length;

const SCENARIOS: [string, (v: V) => V][] = [
  ['Base case', () => ({})],
  ['Operating costs +10%', () => ({ st_opex: 0.1 })],
  ['Operating costs +25%', () => ({ st_opex: 0.25 })],
  ['Revenue 2% lower (deductions or output)', () => ({ st_rev: -0.02 })],
  ['Inflation 1pt below base', () => ({ st_cpi: -0.01 })],
  ['Inflation 1pt above base', () => ({ st_cpi: 0.01 })],
  ['Combined: costs +10%, revenue -1%, inflation -1pt', () => ({ st_opex: 0.1, st_rev: -0.01, st_cpi: -0.01 })],
  ['Interest rate +100bp before close (debt re-sized)', v => ({ rate: v.rate + 0.01 })],
];

export function StressPanel({ m, v, noEntry }: { m: Model; v: V; noEntry?: boolean }) {
  const out = useMemo(() => {
    const refi = v.maturity > 0 && v.maturity < v.tenor;
    const cases: [string, (v: V) => V][] = refi
      ? [...SCENARIOS, [`Balloon refinanced 2pt above the original rate (year ${v.maturity})`, x => ({ refi_spread: x.refi_spread + 0.02 })]]
      : SCENARIOS;
    // An operating asset's debt is already in place, so the re-sizing case does not apply.
    const rows = cases.filter(([label]) => !(noEntry && label.includes('debt re-sized'))).map(([label, ov]) => {
      const r = run(m, v, ov(v));
      return { label, irr: noEntry ? equityValue(r, 0.08) : r.scalar.equity_irr, min: r.scalar.min_dscr, lock: count(r.row.lock, x => x === 1), below: count(r.row.dscr_actual, x => x < 1) };
    });
    const minD = (ov: V) => run(m, v, ov).scalar.min_dscr;
    const be = {
      opex1: solve(x => minD({ st_opex: x }), 1, 0, 10),
      opexLock: solve(x => minD({ st_opex: x }), v.lockup, 0, 10),
      rev1: solve(x => minD({ st_rev: x }), 1, -1, 0),
    };
    const balloon = run(m, v).scalar.balloon;
    m.set(v);
    return { rows, be, refi, balloon };
  }, [m, v, noEntry]);
  const b = (x: number | undefined, sign = 1) => (x === undefined ? 'beyond range' : fmt(sign * x, 'pct'));
  return (
    <div className="card">
      <h2>Downside cases and breakevens</h2>
      <div className="scroll-x">
        <table>
          <thead><tr><th>Case (debt held as sized at close unless noted)</th><th>{noEntry ? 'Equity value at 8% (C$m)' : 'Equity IRR'}</th><th>Min DSCR</th><th>Lock-up years</th><th>Years below 1.00x</th></tr></thead>
          <tbody>
            {out.rows.map(r => (
              <tr key={r.label}>
                <td>{r.label}</td><td>{fmt(r.irr, noEntry ? 'num' : 'pct')}</td>
                <td className={r.min < 1 ? 'diff-off' : ''}>{fmt(r.min, 'x')}</td>
                <td>{r.lock}</td><td className={r.below ? 'diff-off' : ''}>{r.below}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="kpis" style={{ marginTop: 12 }}>
        <div className="kpi"><div className="label">Cost increase to 1.00x DSCR</div><div className="value">{b(out.be.opex1)}</div><div className="sub">operating costs, every year</div></div>
        <div className="kpi"><div className="label">Cost increase to lock-up</div><div className="value">{b(out.be.opexLock)}</div><div className="sub">min DSCR falls to {fmt(v.lockup, 'x')}</div></div>
        <div className="kpi"><div className="label">Revenue loss to 1.00x DSCR</div><div className="value">{b(out.be.rev1, -1)}</div><div className="sub">deductions or lower volume</div></div>
      </div>
      <p className="note">Downside cases change actual cash flow after financial close while debt service stays as sized on the base case, the way lenders and rating agencies test a closed deal. Breakevens are the uniform change that takes the minimum DSCR to the level shown. {out.refi
        ? `The debt matures in year ${v.maturity} of operations with a balloon of C$${fmt(out.balloon)}m, refinanced as a level-payment loan over the rest of the tenor. The refinancing case shows what a higher rate at that date does to coverage and returns.`
        : 'The debt amortizes fully by its legal maturity, so it carries no refinancing risk. Set a legal maturity shorter than the tenor to test a balloon.'}</p>
    </div>
  );
}

export function PensionLens({ m, v, res }: { m: Model; v: V; res: Results }) {
  const market = useMarket();
  const rrb = market.data ? last(market.data.daily, market.data.daily.rrb) : undefined;
  const s = res.scalar, r = res.row;
  const real = (1 + s.equity_irr) / (1 + v.cpi) - 1;
  const up = useMemo(() => { const x = run(m, v, { st_cpi: 0.01 }).scalar.equity_irr; m.set(v); return x; }, [m, v]);
  const pass = (up - s.equity_irr) / 0.01;
  // Macaulay duration of distributions, in years from COD, discounted at the equity IRR.
  const cod = r.ops_year.indexOf(1);
  let pv = 0, tpv = 0;
  r.dist.forEach((d, k) => { if (k >= cod && d > 0) { const t = k - cod + 1, x = d / (1 + s.equity_irr) ** t; pv += x; tpv += t * x; } });
  const tiles: [string, string, string][] = [
    ['Real equity IRR', fmt(real, 'pct'), `nominal ${fmt(s.equity_irr, 'pct')} less ${fmt(v.cpi, 'pct')} CPI`],
    ['Spread over real return bonds', rrb ? `${Math.round((real * 100 - rrb.v) * 100)} bp` : 'n/a', rrb ? `RRB yield ${rrb.v.toFixed(2)}% today (Bank of Canada)` : 'Bank of Canada data loading'],
    ['Inflation pass-through', fmt(pass, 'pct'), 'equity IRR change per 1pt of CPI (100% = fully real)'],
    ['Duration of distributions', `${(tpv / pv).toFixed(1)} yrs`, 'Macaulay, from COD, at the equity IRR'],
    ['Average cash yield', fmt(s.avg_yield, 'pct'), 'distributions / equity invested'],
  ];
  return (
    <div className="card">
      <h2>Pension lens</h2>
      <div className="kpis">
        {tiles.map(([l, val, sub]) => <div className="kpi" key={l}><div className="label">{l}</div><div className="value">{val}</div><div className="sub">{sub}</div></div>)}
      </div>
      <p className="note">How a pension investor reads the asset: the real return against the real risk-free rate, how much of inflation flows through to equity, and how long the cash takes to come back. The spread compares a project return fixed at financial close with today's real yield, so it shows relative value now, not the spread at the time of the deal.</p>
    </div>
  );
}

export function ValuationPanel({ m, v, res, bid, bidText, onApply }: { m: Model; v: V; res: Results; bid?: { input: string; label: string }; bidText?: string; onApply: (id: string, x: number) => void }) {
  const r = res.row, years = r.year;
  const cod = years[r.ops_year.indexOf(1)], end = years[years.length - 1];
  const [valYear, setValYear] = useState(Math.min(Math.max(new Date().getFullYear(), cod), end - 1));
  const [price, setPrice] = useState('');
  const [target, setTarget] = useState('');
  const [solved, setSolved] = useState<{ t: number; x?: number }>();
  const k0 = years.indexOf(valYear);
  const rest = k0 < 0 ? [] : r.equity_cf.slice(k0 + 1);
  const pvAt = (rate: number) => rest.reduce((a, c, t) => a + c / (1 + rate) ** (t + 1), 0);
  const p = Number(price);
  const impl = price !== '' && p > 0 ? irr([-p, ...rest]) : undefined;
  const runBid = () => {
    if (!bid) return;
    const t = Number(target) / 100;
    const x = solve(y => { const i = run(m, v, { [bid.input]: y }).scalar.equity_irr; return Number.isFinite(i) ? i : -1; }, t, v[bid.input] * 0.3, v[bid.input] * 3, 40);
    m.set(v);
    setSolved({ t, x });
  };
  return (
    <div className="card">
      <h2>Equity value and bid</h2>
      <div className="two">
        <div>
          <h3>Buy the equity in a later year</h3>
          <div className="field" style={{ padding: '0 0 8px' }}>
            <label htmlFor="valYear">Purchase at end of year</label>
            <input id="valYear" type="number" step={1} min={cod} max={end - 1} value={valYear} onChange={e => { const y = Math.round(Number(e.target.value)); if (y >= cod && y < end) setValYear(y); }} />
          </div>
          <table>
            <thead><tr><th>Buyer's target IRR</th><th>Equity value (C$m)</th></tr></thead>
            <tbody>{[0.06, 0.07, 0.08, 0.09, 0.1].map(x => <tr key={x}><td>{fmt(x, 'pct')}</td><td>{fmt(pvAt(x))}</td></tr>)}</tbody>
          </table>
          <div className="field" style={{ padding: '10px 0 0' }}>
            <label htmlFor="price">Or enter a price (C$m) to get the buyer's IRR</label>
            <input id="price" type="number" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
            <div className="src">{impl !== undefined ? `Buyer's IRR ${fmt(impl, 'pct')} on remaining distributions ${valYear + 1} to ${end}` : 'Price of 100% of the equity, paid at the end of the year above.'}</div>
          </div>
        </div>
        {bid && (
          <div>
            <h3>Bid solver</h3>
            <p className="note">{bidText ?? 'Bidders compete on the payment they ask the public sponsor for.'} Enter a target equity IRR to solve the {bid.label} that delivers it. Debt is re-sized at each step, as it would be at bid.</p>
            <div className="field" style={{ padding: '0 0 8px' }}>
              <label htmlFor="target">Target equity IRR (%)</label>
              <input id="target" type="number" inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} />
            </div>
            <button className="btn primary" disabled={!(Number(target) > 0)} onClick={runBid}>Solve</button>
            {solved && (
              <div className="note" style={{ marginTop: 10 }}>
                {solved.x === undefined
                  ? `No ${bid.label} between 30% and 300% of today's value reaches ${fmt(solved.t, 'pct')}.`
                  : <>Required {bid.label}: <b>{fmt(solved.x)}</b> (now {fmt(v[bid.input])}, {fmt(solved.x / v[bid.input] - 1, 'pct')}). <button className="btn" onClick={() => onApply(bid.input, solved.x!)}>Use it</button></>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
