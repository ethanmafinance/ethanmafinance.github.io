import { SaveButton } from './Saved.tsx';
// Data centre page: lease DCF (Engine D) with the shared input panel, calibration table, cases, memo and Excel export.
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { comp, median, type Comp } from '../engine/comps.ts';
import type { Company } from '../engine/dcf.ts';
import { DATA, loadIndex } from './EquityPage.tsx';
import { irr } from './Analysis.tsx';
import { VALET } from '../data/boc.ts';
import { Model } from '../engine/sheet.ts';
import { lease } from '../engine/lease.ts';
import type { Module } from '../engine/projectFinance.ts';
import { ChecksCard, fmt, InputsPanel, useDownload } from './ModelPage.tsx';
import { BarChart, Tornado } from './Charts.tsx';
import { Calibration, MemoCard, Rows, SensTable } from './Memo.tsx';
import { CasesPanel } from './Cases.tsx';

type V = Record<string, number>;
const STEP = [-0.005, -0.0025, 0, 0.0025, 0.005];
// Sensitivity of value: input, label, move each way, relative or absolute.
const DRIVERS: [string, string, number, 'rel' | 'abs'][] = [
  ['rate', 'Discount rate', 0.0025, 'abs'],
  ['cap', 'Exit cap rate', 0.0025, 'abs'],
  ['esc', 'Rent escalator', 0.005, 'abs'],
  ['margin', 'NOI margin', 0.05, 'rel'],
  ['renew', 'Renewal rate (12 months down otherwise)', 0.25, 'abs'],
  ['mtm', 'Mark-to-market on rollover', 0.1, 'abs'],
];
const pct2 = (v: number) => `${(v * 100).toFixed(2)}%`;
const lab = (d: number, kind: 'rel' | 'abs', id: string) => (kind === 'rel' ? `${d * 100}%` : id === 'renew' || id === 'mtm' ? `${d * 100}pt` : `${d * 1e4}bp`);

export function DigitalPage({ mod, start, user }: { mod: Module; start?: Record<string, number>; user?: boolean }) {
  const def = useMemo(() => lease(mod), [mod]);
  const defaults = useMemo(() => start ?? Object.fromEntries(def.inputs.map(i => [i.id, i.value])), [def, start]);
  const [values, setValues] = useState<V>(defaults);
  const model = useMemo(() => new Model(def, defaults), [def, defaults]);
  const res = useMemo(() => { model.set(values); return model.results(); }, [model, values]);
  const [busy, download] = useDownload(model, mod.name);
  const scratch = useMemo(() => new Model(def, defaults), [def, defaults]);
  const deferred = useDeferredValue(values);

  const extra = useMemo(() => {
    const m = new Model(def, deferred);
    const val = (ov: V) => { m.set({ ...deferred, ...ov }); return m.results().scalar.value; };
    const grid = STEP.map(a => STEP.map(b => val({ rate: deferred.rate + a, cap: deferred.cap + b })));
    const base = val({});
    const rows = DRIVERS.map(([id, label, d, kind]) => {
      const v = deferred[id];
      const lo = kind === 'rel' ? v * (1 - d) : id === 'renew' ? Math.max(0, v - d) : v - d;
      const hi = kind === 'rel' ? v * (1 + d) : id === 'renew' ? Math.min(1, v + d) : v + d;
      return { label, lo: val({ [id]: lo }), hi: val({ [id]: hi }), loLabel: lo === v ? 'at limit' : `-${lab(d, kind, id)}`, hiLabel: hi === v ? 'at limit' : `+${lab(d, kind, id)}` };
    });
    m.hf.destroy();
    return { grid, base, rows };
  }, [def, deferred]);

  const s = res.scalar, r = res.row;
  const cols = r.year.map((_, k) => k).filter(k => r.hold_flag[k] === 1);
  const pick = (a: number[]) => cols.map(k => a[k]);
  const exitYear = r.year[cols.at(-1)!];

  return (
    <div className="model-layout">
      <InputsPanel def={def} mod={mod} values={values} defaults={defaults} setValues={setValues} />

      <section className="results">
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>{mod.name}</h1>
            <div className="note">{mod.blurb} US$ millions, nominal, annual periods.</div>
          </div>
          <span className="head-actions"><SaveButton item={{ kind: 'infra', mod: mod.id, name: user ? `${mod.name} (my build)` : mod.name, values, headline: `Value US$${fmt(res.scalar.value)}m` }} /><button className="btn primary" onClick={download} disabled={busy}>{busy ? 'Building file...' : 'Download Excel model (live formulas)'}</button></span>
        </div>

        <div className="kpis">
          {([
            ['Portfolio value', fmt(s.value), `US$m, ${fmt(values.rate, 'pct')} discount rate`],
            ['Going-in yield', fmt(s.going_in, 'pct'), `year 1 NOI ${fmt(r.noi[1])}`],
            ['Value per MW', fmt(s.per_mw), `US$m; rent ${fmt(s.rent_mw)} per leased MW`],
            ['Exit value share', fmt(s.tv_share, 'pct'), `exit at ${fmt(values.cap, 'pct')} cap, ${exitYear}`],
            ['IRR at the price', fmt(s.irr, 'pct'), `unlevered, price ${fmt(values.price)}`],
          ] as const).map(([l, v, sub]) => (
            <div className="card kpi" key={l}><div className="label">{l}</div><div className="value">{v}</div><div className="sub">{sub}</div></div>
          ))}
        </div>
        {mod.noEntry && <p className="note card">{mod.noEntry}</p>}

        <div className="card">
          <h2>Value (US$m) by discount rate and exit cap rate</h2>
          <div className="scroll-x"><table>
            <thead><tr><th>Discount / exit cap</th>{STEP.map(b => <th key={b}>{pct2(values.cap + b)}</th>)}</tr></thead>
            <tbody>
              {STEP.map((a, i) => (
                <tr key={a}><td>{pct2(values.rate + a)}</td>{extra.grid[i].map((v, j) => <td key={j} style={i === 2 && j === 2 ? { fontWeight: 700 } : undefined}>{fmt(v)}</td>)}</tr>
              ))}
            </tbody>
          </table></div>
          <p className="note">The two assumptions appraisers disclose. Base case in bold. A 25bp move in either changes value by about {fmt(Math.abs(s.s_dr_up), 'pct')} (discount rate) and {fmt(Math.abs(s.s_cap_up), 'pct')} (exit cap).</p>
        </div>

        <div className="two">
          <div className="card">
            <h2>Value sensitivity</h2>
            <Tornado rows={extra.rows} base={extra.base} fmt={v => fmt(v)} />
            <p className="note">Base case US${fmt(extra.base)}m. Each bar moves one input and holds the rest.</p>
          </div>
          <div className="card">
            <h2>Net operating income</h2>
            <BarChart xs={pick(r.year)} fmt={v => fmt(v)} series={{ name: 'NOI', values: pick(r.noi), color: 'var(--series-1)' }} />
            <p className="note">Rent escalates {pct2(values.esc)} a year; {fmt(values.renew, 'pct')} of expiring rent renews. Exit value US${fmt(s.exit_value)}m at the end of {exitYear}.</p>
          </div>
        </div>

        <PublicPrivate value={s.value} noi1={r.noi[1]} />
        <CurrencyCard cf={r.cf} usdIrr={s.irr} />
        <CasesPanel id={mod.id} m={scratch} values={values} defaults={defaults} setValues={setValues} metrics={[
          ['Portfolio value (US$m)', x => fmt(x.scalar.value)], ['Going-in yield', x => fmt(x.scalar.going_in, 'pct')], ['Value per MW (US$m)', x => fmt(x.scalar.per_mw)],
          ['Exit value share', x => fmt(x.scalar.tv_share, 'pct')], ['IRR at the price', x => fmt(x.scalar.irr, 'pct')],
        ]} />
        <ChecksCard mod={mod} res={res} />
        <MemoCard title={mod.name} sub={`US$ millions, nominal. ${mod.blurb}`} body={() => (
          <>
            <section>
              <h2>Summary</h2>
              <p>The portfolio ({fmt(values.mw)} MW, {fmt(values.occ, 'pct')} leased, NTM base rent US${fmt(values.ntm)}m) is worth US${fmt(s.value)}m at a {fmt(values.rate, 'pct')} discount rate and a {fmt(values.cap, 'pct')} exit cap after {values.hold} years: a {fmt(s.going_in, 'pct')} going-in yield and US${fmt(s.per_mw)}m per MW. The exit is {fmt(s.tv_share, 'pct')} of value. Bought at US${fmt(values.price)}m the unlevered IRR is {fmt(s.irr, 'pct')}.</p>
            </section>
            <div className="memo-two">
              <section><h2>Assumptions</h2><Rows rows={[
                ['Rent escalator', pct2(values.esc)], ['NOI margin on base rent', fmt(values.margin, 'pct')], ['Renewal rate / downtime', `${fmt(values.renew, 'pct')} / ${values.downtime} months`],
                ['Mark-to-market on rollover', fmt(values.mtm, 'pct')], ['Discount rate / exit cap', `${pct2(values.rate)} / ${pct2(values.cap)}`], ['Hold', `${values.hold} years`],
              ]} /></section>
              <section><h2>Value by discount rate and exit cap</h2>
                <table><tbody>
                  <tr><th>Discount</th>{STEP.filter((_, j) => j % 2 === 0).map(b => <th key={b}>{pct2(values.cap + b)}</th>)}</tr>
                  {STEP.map((a, i) => i % 2 === 0 && <tr key={a}><td>{pct2(values.rate + a)}</td>{extra.grid[i].filter((_, j) => j % 2 === 0).map((v, j) => <td key={j}>{fmt(v)}</td>)}</tr>)}
                </tbody></table>
              </section>
            </div>
            <SensTable sens={extra} f={x => fmt(x)} title="Largest sensitivities (value, US$m)" />
            <Calibration checks={mod.checks} res={res} />
          </>
        )} />

        <div className="card">
          <h2>Annual figures (US$m)</h2>
          <div className="scroll-x"><table>
            <thead><tr><th>Line</th>{cols.map(k => <th key={k}>{r.year[k]}</th>)}</tr></thead>
            <tbody>
              {([['Rent on leases in place, escalated', 'rent_contract'], ['Rent expiring this year (NTM basis)', 'expiring'], ['Mark-to-market on rolled leases', 'rent_mtm'], ['Downtime on leases not renewed', 'rent_down'], ['Lease-up', 'rent_lu'], ['Base rent', 'rent'], ['Net operating income', 'noi'], ['Exit value', 'exit_cf']] as const).map(([l, id]) => (
                <tr key={id} className={id === 'rent' || id === 'noi' ? 'total' : ''}><td>{l}</td>{cols.map(k => <td key={k}>{Math.abs(r[id][k]) < 0.05 ? '-' : fmt(r[id][k])}</td>)}</tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </section>
    </div>
  );
}

// Public vs private: listed data centre owners' trading multiples against this portfolio's private value.
const LISTED = ['DLR', 'EQIX'];
function PublicPrivate({ value, noi1 }: { value: number; noi1: number }) {
  const [peers, setPeers] = useState<Comp[] | null>();
  useEffect(() => {
    Promise.all(LISTED.map(t => fetch(`${DATA}${t}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null)))
      .then((cs: (Company | null)[]) => setPeers(cs.flatMap(c => { const x = c && comp(c); return x ? [x] : []; })));
  }, []);
  const med = peers ? median(peers.map(p => p.evEbitda)) : undefined;
  const priv = value / noi1;
  return (
    <div className="card">
      <h2>Public vs private: data centre multiples</h2>
      {peers === undefined ? <p className="note">Loading listed peers...</p> : (
        <div className="scroll-x"><table>
          <thead><tr><th>Owner</th><th>Multiple</th><th>Yield (1 / multiple)</th></tr></thead>
          <tbody>
            <tr><td>This portfolio, private value / year 1 NOI</td><td>{fmt(priv, 'x')}</td><td>{fmt(1 / priv, 'pct')}</td></tr>
            {peers!.map(p => <tr key={p.ticker}><td><a href={`#/equity/${p.ticker}`}>{p.ticker}</a>, listed EV / trailing EBITDA (FY {p.fy.slice(0, 4)})</td><td>{p.evEbitda ? fmt(p.evEbitda, 'x') : 'n/a'}</td><td>{p.evEbitda ? fmt(1 / p.evEbitda, 'pct') : 'n/a'}</td></tr>)}
            {med !== undefined && <tr><td>Listed median</td><td>{fmt(med, 'x')}</td><td>{fmt(1 / med, 'pct')}</td></tr>}
          </tbody>
        </table></div>
      )}
      <p className="note">Listed figures from each company's latest annual SEC filing and closing price, with the same enterprise value bridge as the equity pages. The comparison is indicative: the listed multiple is on trailing EBITDA after corporate costs and includes development pipelines, interconnection and global platforms; the private multiple is on next year's property NOI for stabilized, leased capacity.</p>
    </div>
  );
}

// Currency view for a Canadian investor: the asset's US$ cash flows converted to C$, unhedged at an assumed path for
// the exchange rate, or hedged with forwards priced by covered interest parity on 10-year government yields.
type Rf = { value: number; date: string };
function CurrencyCard({ cf, usdIrr }: { cf: number[]; usdIrr: number }) {
  const [mk, setMk] = useState<{ spot: { v: number; d: string }; usd: Rf; cad: Rf } | null>();
  const [hedge, setHedge] = useState(1);
  useEffect(() => {
    Promise.all([fetch(`${VALET}/observations/FXUSDCAD/json?recent=1`).then(r => r.json()), loadIndex()])
      .then(([fx, idx]) => { const o = fx.observations.at(-1); setMk({ spot: { v: +o.FXUSDCAD.v, d: o.d }, usd: idx.rf.USD, cad: idx.rf.CAD }); })
      .catch(() => setMk(null));
  }, []);
  if (mk === null) return <div className="card"><h2>Currency view (C$ investor)</h2><p className="note">Exchange rate or yield data could not be loaded.</p></div>;
  if (!mk) return <div className="card"><h2>Currency view (C$ investor)</h2><p className="note">Loading the Bank of Canada exchange rate...</p></div>;
  const fwd = (t: number) => ((1 + mk.cad.value) / (1 + mk.usd.value)) ** t;
  const cadIrr = (drift: number) => irr(cf.map((c, t) => c * mk.spot.v * (hedge * fwd(t) + (1 - hedge) * (1 + drift) ** t)));
  const paths: [string, number][] = [['US$ falls 2% a year against C$', -0.02], ['Exchange rate unchanged', 0], ['US$ rises 2% a year against C$', 0.02]];
  return (
    <div className="card">
      <h2>Currency view (C$ investor)</h2>
      <div className="seg" role="group" aria-label="Hedge ratio" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {[0, 0.5, 1].map(h => <button key={h} className={`btn${hedge === h ? ' primary' : ''}`} onClick={() => setHedge(h)}>{h === 0 ? 'Unhedged' : `${h * 100}% hedged`}</button>)}
      </div>
      <div className="scroll-x"><table>
        <thead><tr><th>Exchange rate path</th><th>IRR in C$</th><th>vs US$ IRR {fmt(usdIrr, 'pct')}</th></tr></thead>
        <tbody>{paths.map(([l, d]) => { const x = cadIrr(d); return <tr key={l}><td>{l}{hedge === 1 ? ' (hedged: no effect)' : ''}</td><td>{fmt(x, 'pct')}</td><td>{x >= usdIrr ? '+' : ''}{((x - usdIrr) * 1e4).toFixed(0)} bp</td></tr>; })}</tbody>
      </table></div>
      <p className="note">Spot US$1 = C${mk.spot.v.toFixed(4)} ({mk.spot.d}, Bank of Canada). Hedged cash flows are sold forward at spot x ((1 + GoC 10-year {fmt(mk.cad.value, 'pct')}) / (1 + US Treasury 10-year {fmt(mk.usd.value, 'pct')}))^years, covered interest parity, so with Canadian yields below US yields a full hedge costs about {((mk.usd.value - mk.cad.value) * 100).toFixed(1)}pt a year. This uses long yields as a proxy for the forward curve and ignores hedge margin and rollover costs. Unhedged returns move with the exchange rate path shown.</p>
    </div>
  );
}
