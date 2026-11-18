// One-page investment committee memo, printed to PDF by the browser (Print > Save as PDF).
// Each page type supplies its own body; everything in it is computed from the live model at the moment
// of printing. The thesis is the reader's own text.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Model, Results } from '../engine/sheet.ts';
import type { Module } from '../engine/projectFinance.ts';
import { equityValue, solve } from './Analysis.tsx';
import { fmt } from './ModelPage.tsx';

type V = Record<string, number>;
export type Sens = { base: number; rows: { label: string; lo: number; hi: number; loLabel: string; hiLabel: string }[] };

export function MemoCard({ title, sub, body, blocked }: { title: string; sub: string; body: () => ReactNode; blocked?: string }) {
  const [thesis, setThesis] = useState('');
  const [memo, setMemo] = useState<ReactNode>();
  useEffect(() => { if (memo) { const t = setTimeout(() => print(), 50); return () => clearTimeout(t); } }, [memo]);
  const build = () => setMemo(
    <article className="memo">
      <header>
        <div className="memo-kicker">Investment committee memo</div>
        <h1>{title}</h1>
        <div className="memo-sub">Model output, {new Date().toISOString().slice(0, 10)}. {sub}</div>
      </header>
      {thesis.trim() && <section><h2>Thesis</h2><p>{thesis.trim()}</p></section>}
      {body()}
      <footer>Built from public sources; inputs marked est. on the site are estimates with their method shown. Model output, not investment advice. {location.href}</footer>
    </article>,
  );
  return (
    <>
      <div className="card">
        <h2>Investment committee memo</h2>
        <p className="note">A one-page summary of this case, from the inputs as they are now: headline value and returns, the main tables, the largest sensitivities and the calibration result. Add a thesis if you want one, then save the print as a PDF.</p>
        <textarea className="memo-thesis" rows={3} maxLength={700} value={thesis} onChange={e => setThesis(e.target.value)} placeholder="Thesis (optional, printed at the top)" />
        {blocked && <p className="note">{blocked}</p>}
        <button className="btn primary" onClick={build} disabled={!!blocked}>Print memo / save as PDF</button>
      </div>
      {memo && createPortal(memo, document.body)}
    </>
  );
}

// Shared pieces.
export const Rows = ({ rows }: { rows: [string, string][] }) => <table><tbody>{rows.map(([l, x]) => <tr key={l}><td>{l}</td><td>{x}</td></tr>)}</tbody></table>;
export function SensTable({ sens, f, title }: { sens: Sens; f: (x: number) => string; title: string }) {
  const top = [...sens.rows].sort((a, b) => Math.abs(b.hi - b.lo) - Math.abs(a.hi - a.lo)).slice(0, 4);
  return (
    <section>
      <h2>{title}</h2>
      <table><tbody>
        <tr><th>Input</th><th>Low</th><th>High</th></tr>
        {top.map(r => <tr key={r.label}><td>{r.label}</td><td>{r.loLabel}: {f(r.lo)}</td><td>{r.hiLabel}: {f(r.hi)}</td></tr>)}
      </tbody></table>
      <p className="memo-note">Base {f(sens.base)}. One input moved at a time.</p>
    </section>
  );
}
export function Calibration({ checks, res }: { checks?: Module['checks']; res: Results }) {
  const used = (checks ?? []).filter(c => !c.info);
  if (!used.length) return null;
  const passed = used.filter(c => Math.abs(c.model(res) / c.published - 1) <= (c.tol ?? 0.01));
  return <section><h2>Calibration</h2><p>{passed.length} of {used.length} published figures reproduced within tolerance: {used.map(c => c.label).join('; ')}.</p></section>;
}

// Project finance body (P3, renewables, toll roads).
export function pfMemo(mod: Module, m: Model, v: V, res: Results, sens: Sens): ReactNode {
  const minD = (ov: V) => { m.set({ ...v, ...ov }); return m.results().scalar.min_dscr; };
  const b = { opex1: solve(x => minD({ st_opex: x }), 1, 0, 10), opexLock: solve(x => minD({ st_opex: x }), v.lockup, 0, 10), rev1: solve(x => minD({ st_rev: x }), 1, -1, 0) };
  m.set(v);
  const s = res.scalar, ne = !!mod.noEntry;
  const be = (x: number | undefined, sign = 1) => (x === undefined ? 'beyond the tested range' : fmt(sign * x, 'pct'));
  const ops = res.row.year.filter((_, k) => res.row.ops_flag[k] === 1);
  const ev = (r: number) => fmt(equityValue(res, r));
  const sized = Math.abs(s.min_dscr_b - s.min_dscr) > 0.005;
  const returns: [string, string][] = ne
    ? [['Equity value at 7% / 8% / 9%', `${ev(0.07)} / ${ev(0.08)} / ${ev(0.09)}`]]
    : [['Equity IRR (levered, post-tax)', fmt(s.equity_irr, 'pct')], ['Project IRR (unlevered, post-tax)', fmt(s.project_irr, 'pct')], ['Equity MOIC', fmt(s.moic, 'x')], ['Average cash yield', fmt(s.avg_yield, 'pct')]];
  returns.push(['Senior debt', fmt(s.debt)], ['Minimum / average DSCR', `${fmt(s.min_dscr, 'x')} / ${fmt(s.avg_dscr, 'x')}`]);
  if (sized) returns.push(['Minimum DSCR, debt sizing case', fmt(s.min_dscr_b, 'x')]);
  returns.push(['LLCR', fmt(s.llcr, 'x')]);
  if (!ne) returns.push(['Gearing', fmt(s.gearing, 'pct')]);
  const nz = (a: [string, number][]) => a.filter(([, x]) => Math.abs(x) > 0.05).map(([l, x]) => [l, fmt(x)] as [string, string]);
  return (
    <>
      <section>
        <h2>Summary</h2>
        <p>
          {ne
            ? <>At the base case the equity is worth C${ev(0.08)}m at an 8% target IRR (C${ev(0.07)}m at 7%, C${ev(0.09)}m at 9%). </>
            : <>At the base case the equity earns {fmt(s.equity_irr, 'pct')} after tax ({fmt(s.project_irr, 'pct')} unlevered), a {fmt(s.moic, 'x')} multiple with payback in {fmt(s.payback, 'year')}. </>}
          Senior debt of C${fmt(s.debt)}m has a minimum DSCR of {fmt(s.min_dscr, 'x')} (average {fmt(s.avg_dscr, 'x')}{sized ? `; ${fmt(s.min_dscr_b, 'x')} on the case the debt is sized on` : ''}) against a {fmt(v.dscr, 'x')} target and a {fmt(v.lockup, 'x')} lock-up, over operations from {ops[0]} to {ops[ops.length - 1]}.
          {' '}Operating costs can rise {be(b.opex1)} before coverage falls to 1.00x, and revenue can fall {be(b.rev1, -1)}.
        </p>
      </section>
      <div className="memo-two">
        <section><h2>Returns and coverage</h2><Rows rows={returns} /></section>
        {ne ? <section><h2>Valuation basis</h2><p>{mod.noEntry}</p></section> : (
          <section>
            <h2>Sources and uses at COD</h2>
            <Rows rows={[...nz([['Construction capex', s.capex_total], ['Other project costs', s.other_total], ['Interest during construction', s.idc], ['Equity bridge loan interest', s.ebl_int], ['DSRA funding', s.dsra_init]]), ['Total uses', fmt(s.uses)], ...nz([['Completion payment', s.cp_src], ['Senior debt', s.debt], ['Equity', s.equity]])]} />
          </section>
        )}
      </div>
      <div className="memo-two">
        <SensTable sens={sens} f={x => fmt(x, ne ? 'num' : 'pct')} title={`Largest sensitivities (${ne ? 'equity value at 8%' : 'equity IRR'})`} />
        <section>
          <h2>Downside</h2>
          <Rows rows={[['Operating cost rise to 1.00x DSCR', be(b.opex1)], [`Operating cost rise to lock-up (${fmt(v.lockup, 'x')})`, be(b.opexLock)], ['Revenue loss to 1.00x DSCR', be(b.rev1, -1)]]} />
          <p className="memo-note">Debt service held as fixed at financial close, as lenders test a closed deal.</p>
        </section>
      </div>
      <Calibration checks={mod.checks} res={res} />
    </>
  );
}
