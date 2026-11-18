// Regulated utility page: same input panel, calibration table and Excel export as the project finance page,
// with utility outputs (rate base, revenue requirement, earned ROE, equity value against a rate base multiple).
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { comp } from '../engine/comps.ts';
import type { Company } from '../engine/dcf.ts';
import { DATA } from './EquityPage.tsx';
import { Model } from '../engine/sheet.ts';
import { regulated } from '../engine/regulated.ts';
import type { Module } from '../engine/projectFinance.ts';
import { ChecksCard, fmt, InputsPanel, useDownload } from './ModelPage.tsx';
import { BarChart, LineChart, Tornado } from './Charts.tsx';
import { Calibration, MemoCard, Rows, SensTable } from './Memo.tsx';
import { CasesPanel } from './Cases.tsx';

type V = Record<string, number>;
const ENTRY = [1, 1.2, 1.4, 1.6, 1.8];
const EXIT = [1, 1.2, 1.4, 1.6];
// Sensitivity of equity value: input, label, move each way.
const DRIVERS: [string, string, number][] = [
  ['roe', 'Allowed ROE', 0.005],
  ['isa_growth', 'Capital additions growth after the plan', 0.02],
  ['exit_mult', 'Exit multiple of rate base', 0.2],
  ['target_irr', "Buyer's target IRR", 0.01],
  ['stretch', 'Stretch factor', 0.003],
  ['ltd_rate', 'Debt rate (passed through to customers)', 0.01],
];
const pct2 = (v: number) => `${(v * 100).toFixed(2)}%`;
const lab = (id: string, d: number) => (id === 'exit_mult' ? `${d}x` : `${+(d * 100).toFixed(2)}pt`);

export function UtilityPage({ mod }: { mod: Module }) {
  const def = useMemo(() => regulated(mod), [mod]);
  const defaults = useMemo(() => Object.fromEntries(def.inputs.map(i => [i.id, i.value])), [def]);
  const [values, setValues] = useState<V>(defaults);
  const model = useMemo(() => new Model(def, defaults), [def, defaults]);
  const res = useMemo(() => { model.set(values); return model.results(); }, [model, values]);
  const [busy, download] = useDownload(model, mod.name);
  const scratch = useMemo(() => new Model(def, defaults), [def, defaults]);
  const deferred = useDeferredValue(values);

  const extra = useMemo(() => {
    const m = new Model(def, deferred);
    const val = (ov: V) => { m.set({ ...deferred, ...ov }); return m.results().scalar; };
    const grid = ENTRY.map(e => EXIT.map(x => val({ entry_mult: e, exit_mult: x }).equity_irr));
    const base = val({}).eq_value;
    const rows = DRIVERS.map(([id, label, d]) => ({
      label, lo: val({ [id]: deferred[id] - d }).eq_value, hi: val({ [id]: deferred[id] + d }).eq_value,
      loLabel: `-${lab(id, d)}`, hiLabel: `+${lab(id, d)}`,
    }));
    m.hf.destroy();
    return { grid, base, rows };
  }, [def, deferred]);

  const s = res.scalar, r = res.row;
  const cols = r.year.map((_, k) => k).filter(k => r.op[k] === 1);
  const planCols = cols.filter(k => r.plan_flag[k] === 1);
  const pick = (a: number[], ks = cols) => ks.map(k => a[k]);
  const y0 = r.year[0];

  return (
    <div className="model-layout">
      <InputsPanel def={def} mod={mod} values={values} defaults={defaults} setValues={setValues} />

      <section className="results">
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>{mod.name}</h1>
            <div className="note">{mod.blurb} C$ millions, nominal, annual periods.</div>
          </div>
          <button className="btn primary" onClick={download} disabled={busy}>{busy ? 'Building file...' : 'Download Excel model (live formulas)'}</button>
        </div>

        <div className="kpis">
          {([
            [`Rate base ${r.year[1]}`, fmt(r.rb[1]), `${fmt(s.rb_cagr, 'pct')} a year to ${r.year[planCols.at(-1)!]}`],
            [`Equity value at ${fmt(values.target_irr, 'pct')}`, fmt(s.eq_value), `C$m, at end of ${y0}`],
            ['Implied EV / rate base', fmt(s.ev_rb, 'x'), `exit at ${fmt(values.exit_mult, 'x')}`],
            ['Implied P / E', fmt(s.pe, 'x'), `${r.year[1]} earnings`],
            [`IRR at ${fmt(values.entry_mult, 'x')} entry`, fmt(s.equity_irr, 'pct'), 'EV / rate base paid'],
            ['Average earned ROE', fmt(s.avg_roe, 'pct'), `allowed ${pct2(values.roe)}`],
          ] as const).map(([l, v, sub]) => (
            <div className="card kpi" key={l}><div className="label">{l}</div><div className="value">{v}</div><div className="sub">{sub}</div></div>
          ))}
        </div>
        {mod.noEntry && <p className="note card">{mod.noEntry}</p>}

        <div className="two">
          <div className="card">
            <h2>Revenue requirement build ({r.year[planCols[0]]} to {r.year[planCols.at(-1)!]})</h2>
            <div className="scroll-x"><table>
              <thead><tr><th>C$m</th>{planCols.map(k => <th key={k}>{r.year[k]}</th>)}</tr></thead>
              <tbody>
                {([['OM&A', 'om'], ['Depreciation', 'dep'], ['Deemed interest', 'int_deemed'], ['Return on equity', 'roe_ret'], ['PILs', 'pils'], ['Service revenue requirement', 'srr'], ['Less revenue offsets', 'offsets'], ['Base revenue requirement', 'brr'], ['Less stretch factors', 'stretch_red'], ['Distribution revenue', 'dist_rev']] as const).map(([l, id]) => (
                  <tr key={id} className={id === 'srr' || id === 'dist_rev' ? 'total' : ''}><td>{l}</td>{planCols.map(k => <td key={k}>{Math.abs(r[id][k]) < 0.05 ? '-' : fmt(r[id][k])}</td>)}</tr>
                ))}
              </tbody>
            </table></div>
            <p className="note">Rate base is average net fixed assets plus a working capital allowance. The return is earned on {fmt(values.eq_share, 'pct')} deemed equity at the allowed ROE; interest on {fmt(values.ltd_share + values.std_share, 'pct')} deemed debt.</p>
          </div>
          <div className="card">
            <h2>Equity value sensitivity</h2>
            <Tornado rows={extra.rows} base={extra.base} fmt={v => fmt(v)} />
            <p className="note">Base case C${fmt(extra.base)}m. Each bar moves one input and holds the rest.</p>
          </div>
        </div>

        <div className="card">
          <h2>Equity IRR by entry and exit price</h2>
          <div className="scroll-x"><table>
            <thead><tr><th>Entry EV / rate base</th>{EXIT.map(x => <th key={x}>Exit {fmt(x, 'x')}</th>)}</tr></thead>
            <tbody>
              {ENTRY.map((e, i) => (
                <tr key={e}><td>{fmt(e, 'x')}</td>{extra.grid[i].map((v, j) => <td key={j} className={v < values.target_irr ? 'diff-off' : 'diff-ok'}>{fmt(v, 'pct')}</td>)}</tr>
              ))}
            </tbody>
          </table></div>
          <p className="note">Paying above rate base pulls the IRR below the earned ROE unless the exit carries a similar premium. Green cells meet the {fmt(values.target_irr, 'pct')} target. Entry at the end of {y0}; exit at the end of {r.year.at(-1)}.</p>
        </div>

        <div className="two">
          <div className="card">
            <h2>Rate base</h2>
            <LineChart xs={pick(r.year)} fmt={v => fmt(v)} series={[{ name: 'Rate base', values: pick(r.rb), color: 'var(--series-1)' }]} />
          </div>
          <div className="card">
            <h2>Earned ROE</h2>
            <LineChart xs={pick(r.year)} fmt={v => fmt(v, 'pct')} series={[{ name: 'Earned ROE', values: pick(r.earned_roe), color: 'var(--series-1)' }]}
              refs={[{ label: `Allowed ${pct2(values.roe)}`, value: values.roe }]} />
          </div>
          <div className="card">
            <h2>Revenue and net income</h2>
            <LineChart xs={pick(r.year)} fmt={v => fmt(v)} series={[
              { name: 'Distribution revenue', values: pick(r.dist_rev), color: 'var(--series-1)' },
              { name: 'Net income', values: pick(r.ni), color: 'var(--series-2)' },
            ]} />
          </div>
          <div className="card">
            <h2>Free cash flow to equity</h2>
            <BarChart xs={pick(r.year)} fmt={v => fmt(v)} series={{ name: 'FCFE', values: pick(r.fcfe), color: 'var(--series-1)' }} />
          </div>
        </div>

        <PublicPrivate m={scratch} v={values} evRb={s.ev_rb} />
        <CasesPanel id={mod.id} m={scratch} values={values} defaults={defaults} setValues={setValues} metrics={[
          ['Equity value at target IRR (C$m)', x => fmt(x.scalar.eq_value)], ['Implied EV / rate base', x => fmt(x.scalar.ev_rb, 'x')], ['Implied P / E', x => fmt(x.scalar.pe, 'x')],
          ['IRR at entry multiple', x => fmt(x.scalar.equity_irr, 'pct')], ['Average earned ROE', x => fmt(x.scalar.avg_roe, 'pct')], ['Rate base growth', x => fmt(x.scalar.rb_cagr, 'pct')],
        ]} />
        <ChecksCard mod={mod} res={res} />
        <MemoCard title={mod.name} sub={`C$ millions, nominal. ${mod.blurb}`} body={() => {
          const p0 = planCols[0], pN = planCols.at(-1)!;
          return (
            <>
              <section>
                <h2>Summary</h2>
                <p>Rate base grows from C${fmt(r.rb[p0])}m in {r.year[p0]} to C${fmt(r.rb[pN])}m in {r.year[pN]} ({fmt(s.rb_cagr, 'pct')} a year). At a {fmt(values.target_irr, 'pct')} target IRR the equity is worth C${fmt(s.eq_value)}m at the end of {y0}, an implied {fmt(s.ev_rb, 'x')} EV / rate base and {fmt(s.pe, 'x')} P / E, with exit at {fmt(values.exit_mult, 'x')} rate base. Bought at {fmt(values.entry_mult, 'x')} rate base the IRR is {fmt(s.equity_irr, 'pct')}. Earned ROE averages {fmt(s.avg_roe, 'pct')} against {pct2(values.roe)} allowed.</p>
              </section>
              <div className="memo-two">
                <section><h2>Revenue requirement, {r.year[p0]} and {r.year[pN]}</h2>
                  <table><tbody>
                    <tr><th>C$m</th><th>{r.year[p0]}</th><th>{r.year[pN]}</th></tr>
                    {([['OM&A', 'om'], ['Depreciation', 'dep'], ['Deemed interest', 'int_deemed'], ['Return on equity', 'roe_ret'], ['PILs', 'pils'], ['Service revenue requirement', 'srr'], ['Distribution revenue', 'dist_rev']] as const).map(([l, id]) => <tr key={id}><td>{l}</td><td>{fmt(r[id][p0])}</td><td>{fmt(r[id][pN])}</td></tr>)}
                  </tbody></table>
                </section>
                <section><h2>Structure</h2><Rows rows={[
                  ['Deemed equity / long-term / short-term debt', `${fmt(values.eq_share, 'pct')} / ${fmt(values.ltd_share, 'pct')} / ${fmt(values.std_share, 'pct')}`],
                  ['Allowed ROE', pct2(values.roe)], ['Equity value at target IRR', fmt(s.eq_value)], ['Implied EV / rate base', fmt(s.ev_rb, 'x')], ['Implied P / E', fmt(s.pe, 'x')],
                ]} /></section>
              </div>
              <div className="memo-two">
                <SensTable sens={extra} f={x => fmt(x)} title="Largest sensitivities (equity value, C$m)" />
                <section><h2>Equity IRR by entry and exit EV / rate base</h2>
                  <table><tbody>
                    <tr><th>Entry</th>{EXIT.map(x => <th key={x}>Exit {fmt(x, 'x')}</th>)}</tr>
                    {ENTRY.map((e, i) => <tr key={e}><td>{fmt(e, 'x')}</td>{extra.grid[i].map((v, j) => <td key={j}>{fmt(v, 'pct')}</td>)}</tr>)}
                  </tbody></table>
                </section>
              </div>
              <Calibration checks={mod.checks} res={res} />
            </>
          );
        }} />

        <div className="card">
          <h2>Annual figures (C$m)</h2>
          <div className="scroll-x"><table>
            <thead><tr><th>Line</th>{cols.map(k => <th key={k}>{r.year[k]}</th>)}</tr></thead>
            <tbody>
              {([['In-service additions', 'isa'], ['Depreciation', 'dep'], ['Rate base', 'rb'], ['Distribution revenue', 'dist_rev'], ['Net income', 'ni'], ['Earned ROE', 'earned_roe'], ['Equity funding of growth', 'eq_funding'], ['Free cash flow to equity', 'fcfe']] as const).map(([l, id]) => (
                <tr key={id}><td>{l}</td>{cols.map(k => <td key={k}>{id === 'earned_roe' ? fmt(r[id][k], 'pct') : Math.abs(r[id][k]) < 0.05 ? '-' : fmt(r[id][k])}</td>)}</tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </section>
    </div>
  );
}

// Public vs private: what the listed market pays for regulated rate base (Fortis) against this model's private value,
// and the IRR a private buyer would earn paying the listed multiple.
const FTS_RB = 41900; // C$m, Fortis 2025 mid-year rate base (Q3 2025 release, 6-K Exhibit 99.1)
function PublicPrivate({ m, v, evRb }: { m: Model; v: V; evRb: number }) {
  const [fts, setFts] = useState<Company | null>();
  useEffect(() => { fetch(`${DATA}FTS.json`).then(r => (r.ok ? r.json() : null)).then(setFts, () => setFts(null)); }, []);
  const c = fts ? comp(fts) : undefined;
  const mult = c ? c.ev / FTS_RB : undefined;
  const irr = useMemo(() => {
    if (mult === undefined) return undefined;
    m.set({ ...v, entry_mult: mult }); const a = m.results().scalar.equity_irr;
    m.set({ ...v, entry_mult: mult, exit_mult: mult }); const b = m.results().scalar.equity_irr;
    m.set(v);
    return { a, b };
  }, [m, v, mult]);
  return (
    <div className="card">
      <h2>Public vs private: rate base multiples</h2>
      {fts === null ? <p className="note">Fortis market data could not be loaded.</p> : !c || !irr || mult === undefined ? <p className="note">Loading Fortis market data...</p> : (
        <div className="scroll-x"><table><tbody>
          <tr><td>Fortis (listed): enterprise value / 2025 mid-year rate base</td><td>{fmt(mult, 'x')}</td></tr>
          <tr><td>This utility at a private target IRR of {fmt(v.target_irr, 'pct')}: enterprise value / rate base</td><td>{fmt(evRb, 'x')}</td></tr>
          <tr><td>Equity IRR paying Fortis's multiple, exit at {fmt(v.exit_mult, 'x')}</td><td>{fmt(irr.a, 'pct')}</td></tr>
          <tr><td>Equity IRR paying Fortis's multiple, exit at the same multiple</td><td>{fmt(irr.b, 'pct')}</td></tr>
        </tbody></table></div>
      )}
      <p className="note">Fortis enterprise value is today's share price times shares plus debt, preferred shares and non-controlling interests less cash, from its latest annual SEC filing (C${c ? fmt(c.ev) : '...'}m), over its 2025 mid-year rate base of C$41.9bn (Q3 2025 results release). The listed multiple carries Fortis's own growth (rate base 6.7% a year to 2030), its holding company debt and a small non-regulated business, so it is a market reference, not a like-for-like price.</p>
    </div>
  );
}
