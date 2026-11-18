import { MemoCard, pfMemo } from './Memo.tsx';
import { CasesPanel, type Metric } from './Cases.tsx';
import { useDeferredValue, useMemo, useState } from 'react';
import { Model, type Fmt, type Input, type ModelDef, type Results, type Source } from '../engine/sheet.ts';
import { projectFinance, type Module } from '../engine/projectFinance.ts';

import { BarChart, LineChart, Tornado, Waterfall } from './Charts.tsx';
import { equityValue, PensionLens, PValueCard, RatesPanel, StressPanel, ValuationPanel } from './Analysis.tsx';

export const fmt = (v: number, f: Fmt | 'num' = 'num') => {
  if (!Number.isFinite(v)) return 'n/a';
  switch (f) {
    case 'pct': return `${(v * 100).toFixed(1)}%`;
    case 'x': return `${v.toFixed(2)}x`;
    case 'px': return v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'year': case 'int': case 'flag': return v ? String(Math.round(v)) : 'n/a';
    default: return v.toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
};
// Inputs show percentages as percent numbers; the model stores fractions.
const toField = (i: Input, v: number) => (i.fmt === 'pct' ? +(v * 100).toFixed(4) : v);
const fromField = (i: Input, v: number) => (i.fmt === 'pct' ? v / 100 : v);

function SourceLine({ s }: { s?: Source }) {
  if (!s) return null;
  const text = [s.title, s.page && `p. ${s.page}`, s.date].filter(Boolean).join(', ');
  return (
    <div className="src">
      {s.est && <span className="est">est.</span>}
      {s.note}{s.note && text ? '. ' : ''}
      {text && (s.url ? <a href={s.url} target="_blank" rel="noreferrer">{text}</a> : text)}
    </div>
  );
}

// Sensitivity drivers: input id, label, and how far to move it each way.
const DRIVERS: [string, string, number, 'rel' | 'abs'][] = [
  ['capex', 'Construction cost', 0.1, 'rel'],
  ['rate', 'Interest rate', 0.01, 'abs'],
  ['cpi', 'Inflation', 0.01, 'abs'],
  ['dscr', 'Target DSCR', 0.1, 'abs'],
  ['ap_capital', 'Capital payment', 0.05, 'rel'],
  ['fm_cost', 'Operating costs', 0.1, 'rel'],
  ['ppa_price', 'Contract price', 0.05, 'rel'],
  ['energy_p50', 'P50 output', 0.05, 'rel'],
  ['opex', 'Operating costs', 0.1, 'rel'],
  ['tax_rate', 'Tax rate', 0.02, 'abs'],
];
// Operating asset with debt already in place: move actual cash flows only (downside inputs), so the debt is not re-sized.
const OPERATING: [string, string, number, 'rel' | 'abs'][] = [
  ['st_rev', 'Revenue (traffic or toll)', 0.05, 'abs'],
  ['st_opex', 'Operating costs', 0.1, 'abs'],
  ['st_cpi', 'Inflation', 0.01, 'abs'],
];

export function ModelPage({ mod }: { mod: Module }) {
  const def = useMemo(() => projectFinance(mod), [mod]);
  const defaults = useMemo(() => Object.fromEntries(def.inputs.map(i => [i.id, i.value])), [def]);
  const [values, setValues] = useState<Record<string, number>>(defaults);
  const model = useMemo(() => new Model(def, defaults), [def, defaults]);
  const res = useMemo(() => { model.set(values); return model.results(); }, [model, values]);
  const deferred = useDeferredValue(values);
  const scratch = useMemo(() => new Model(def, defaults), [def, defaults]); // for scenario runs, separate from the live model
  const sens = useMemo(() => {
    const m = new Model(def, deferred);
    // Operating assets with no public entry price: sensitivity of equity value at 8% instead of IRR.
    const metric = () => { const x = m.results(); return mod.noEntry ? equityValue(x, 0.08) : x.scalar.equity_irr; };
    const base = metric();
    const rows = (mod.noEntry ? OPERATING : DRIVERS).filter(([id]) => id in deferred).map(([id, label, d, kind]) => {
      const v = deferred[id];
      const lo = kind === 'rel' ? v * (1 - d) : v - d, hi = kind === 'rel' ? v * (1 + d) : v + d;
      const run = (x: number) => { m.set({ ...deferred, [id]: x }); return metric(); };
      const out = { label, lo: run(lo), hi: run(hi), loLabel: kind === 'rel' || id === 'st_rev' || id === 'st_opex' ? `-${d * 100}%` : `-${d < 0.05 ? `${d * 100}pt` : d}`, hiLabel: kind === 'rel' || id === 'st_rev' || id === 'st_opex' ? `+${d * 100}%` : `+${d < 0.05 ? `${d * 100}pt` : d}` };
      m.set({ [id]: v });
      return out;
    });
    // Two-way table: interest rate x construction cost (debt re-sized, as at bid), or for an operating asset
    // with no entry price, revenue x operating costs on actual cash flows.
    const S = [-0.1, -0.05, 0, 0.05, 0.1], R = [-0.01, -0.005, 0, 0.005, 0.01];
    const grid = mod.noEntry
      ? { rows: S.map(a => ({ label: `${a > 0 ? '+' : ''}${a * 100}%`, cells: S.map(b => { m.set({ ...deferred, st_rev: a, st_opex: b }); return metric(); }) })), cols: S.map(b => `${b > 0 ? '+' : ''}${b * 100}%`), rowHead: 'Revenue', colHead: 'Operating costs' }
      : { rows: R.map(a => ({ label: fmt(deferred.rate + a, 'pct'), cells: S.map(b => { m.set({ ...deferred, rate: deferred.rate + a, capex: deferred.capex * (1 + b) }); return metric(); }) })), cols: S.map(b => `${b > 0 ? '+' : ''}${b * 100}%`), rowHead: 'Interest rate', colHead: 'Construction cost' };
    m.hf.destroy();
    return { base, rows, grid };
  }, [def, deferred, mod.noEntry]);

  const [busy, download] = useDownload(model, mod.name);

  const s = res.scalar, r = res.row;
  const years = r.year;
  const ops = years.map((_, k) => r.ops_flag[k] === 1);
  const opsYears = years.filter((_, k) => ops[k]);
  const pick = (a: number[]) => a.filter((_, k) => ops[k]);

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
          {(mod.noEntry ? [
            ['Equity value at 7%', fmt(equityValue(res, 0.07)), "C$m, buyer's target IRR"],
            ['Equity value at 8%', fmt(equityValue(res, 0.08)), `C$m, at ${r.year[0]} close`],
            ['Equity value at 9%', fmt(equityValue(res, 0.09)), "C$m, buyer's target IRR"],
            ['Senior debt at close', fmt(s.debt), 'C$m'],
            ['Min DSCR', fmt(s.min_dscr, 'x'), `average ${fmt(s.avg_dscr, 'x')}`],
            ['LLCR at close', fmt(s.llcr, 'x'), 'CFADS PV over debt'],
          ] as const : [
            ['Equity IRR', fmt(s.equity_irr, 'pct'), 'post-tax, levered'],
            ['Project IRR', fmt(s.project_irr, 'pct'), 'post-tax, unlevered'],
            ['Equity MOIC', fmt(s.moic, 'x'), `payback ${fmt(s.payback, 'year')}`],
            ['Avg cash yield', fmt(s.avg_yield, 'pct'), 'distributions / equity'],
            ['Min DSCR', fmt(s.min_dscr, 'x'), Math.abs(s.min_dscr_b - s.min_dscr) > 0.005 ? `debt sizing case ${fmt(s.min_dscr_b, 'x')}` : `average ${fmt(s.avg_dscr, 'x')}`],
            ['LLCR at COD', fmt(s.llcr, 'x'), `gearing ${fmt(s.gearing, 'pct')}`],
          ] as const).map(([l, v, sub]) => (
            <div className="card kpi" key={l}><div className="label">{l}</div><div className="value">{v}</div><div className="sub">{sub}</div></div>
          ))}
        </div>
        {mod.noEntry && <p className="note card">{mod.noEntry}</p>}

        <div className="two">
          {!mod.noEntry && <div className="card">
            <h2>Sources and uses at COD</h2>
            <table>
              <tbody>
                <tr><th>Uses</th><th>C$m</th><th>%</th></tr>
                {[['Construction capex', s.capex_total], ['Development, financing and other costs', s.other_total], ['Interest during construction', s.idc], ...(s.ebl_int > 0.05 ? [['Equity bridge loan interest', s.ebl_int]] : []), ['DSRA initial funding', s.dsra_init]].map(([l, v]) => (
                  <tr key={l as string}><td>{l}</td><td>{fmt(v as number)}</td><td>{fmt((v as number) / s.uses, 'pct')}</td></tr>
                ))}
                <tr className="total"><td>Total uses</td><td>{fmt(s.uses)}</td><td>100.0%</td></tr>
                <tr><th>Sources</th><th></th><th></th></tr>
                {[['Completion payment', s.cp_src], ['Senior debt', s.debt], ['Equity', s.equity]].map(([l, v]) => (
                  <tr key={l as string}><td>{l}</td><td>{fmt(v as number)}</td><td>{fmt((v as number) / s.sources, 'pct')}</td></tr>
                ))}
                <tr className="total"><td>Total sources</td><td>{fmt(s.sources)}</td><td>100.0%</td></tr>
              </tbody>
            </table>
            <p className="note">Debt is the lower of what the target DSCR supports ({fmt(s.share_dscr, 'pct')} of costs) and the gearing cap ({fmt(s.share_gearing, 'pct')}).</p>
          </div>}
          <div className="card" style={mod.noEntry ? { gridColumn: '1 / -1' } : undefined}>
            <h2>{mod.noEntry ? 'Equity value sensitivity (8% target IRR)' : 'Equity IRR sensitivity'}</h2>
            <Tornado rows={sens.rows} base={sens.base} fmt={v => fmt(v, mod.noEntry ? 'num' : 'pct')} />
            <p className="note">Base case {fmt(sens.base, mod.noEntry ? 'num' : 'pct')}. Each bar moves one input and holds the rest.</p>
          </div>
        </div>

        <div className="card">
          <h2>{mod.noEntry ? 'Equity value at 8% (C$m)' : 'Equity IRR'} by {sens.grid.rowHead.toLowerCase()} and {sens.grid.colHead.toLowerCase()}</h2>
          <div className="scroll-x"><table>
            <thead><tr><th>{sens.grid.rowHead} / {sens.grid.colHead}</th>{sens.grid.cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{sens.grid.rows.map((r, i) => (
              <tr key={r.label}><td>{r.label}</td>{r.cells.map((v, j) => <td key={j} style={i === 2 && j === 2 ? { fontWeight: 700 } : undefined}>{fmt(v, mod.noEntry ? 'num' : 'pct')}</td>)}</tr>
            ))}</tbody>
          </table></div>
          <p className="note">{mod.noEntry ? 'Changes to actual revenue and operating costs after the start date; debt service stays as in place.' : 'A rate change before financial close re-sizes the debt, as lenders would at bid. Construction cost moves the whole capex budget.'} Base case in bold.</p>
        </div>

        <div className="two">
          <div className="card">
            <h2>CFADS and debt service</h2>
            <LineChart xs={opsYears} fmt={v => fmt(v)} series={[
              { name: 'CFADS', values: pick(r.cfads), color: 'var(--series-1)' },
              { name: 'Debt service', values: pick(r.ds).map(v => (v > 1e-9 ? v : null)), color: 'var(--series-2)' },
            ]} />
          </div>
          <div className="card">
            <h2>DSCR</h2>
            <LineChart xs={opsYears} fmt={v => fmt(v, 'x')}
              series={[{ name: 'DSCR', values: pick(r.dscr_actual).map(v => (Number.isFinite(v) ? v : null)), color: 'var(--series-1)' }]}
              refs={[{ label: `Target ${fmt(values.dscr, 'x')}`, value: values.dscr }, { label: `Lock-up ${fmt(values.lockup, 'x')}`, value: values.lockup }]} />
          </div>
          <div className="card">
            <h2>Senior debt balance</h2>
            <LineChart xs={years} fmt={v => fmt(v)} series={[{ name: 'Closing balance', values: r.debt_close, color: 'var(--series-1)' }]} />
          </div>
          <div className="card">
            <h2>Equity cash flow</h2>
            <BarChart xs={years} fmt={v => fmt(v)} series={{ name: 'Equity cash flow', values: r.equity_cf, color: 'var(--series-1)' }} />
          </div>
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <h2>Cash flow waterfall, operations {opsYears[0]} to {opsYears.at(-1)} (C$m, nominal)</h2>
            {(() => {
              const t = (a: number[]) => pick(a).reduce((x, y) => x + (Number.isFinite(y) ? y : 0), 0);
              const cfads = t(r.cfads), int = t(r.int_paid), prin = t(r.principal), dist = t(r.dist);
              return <Waterfall fmt={v => fmt(v)} steps={[
                { label: 'Revenue', value: t(r.revenue), total: true }, { label: 'Operating costs', value: -t(r.opex) }, { label: 'Maintenance and lifecycle', value: -t(r.maint) }, { label: 'Cash tax', value: -t(r.l_tax) },
                { label: 'CFADS', value: cfads, total: true }, { label: 'Interest', value: -int }, { label: 'Principal', value: -prin }, { label: 'Reserves and lock-up, net', value: dist - (cfads - int - prin) },
                { label: 'Distributions to equity', value: dist, total: true },
              ]} />;
            })()}
            <p className="note">Totals over the operating years. Reserves and lock-up net out the DSRA and any cash trapped by the lock-up test.</p>
          </div>
        </div>

        <CasesPanel id={mod.id} m={scratch} values={values} defaults={defaults} setValues={setValues} metrics={[
          ...(mod.noEntry ? [['Equity value at 8% (C$m)', (x: Results) => fmt(equityValue(x, 0.08))] as Metric] : [['Equity IRR', (x: Results) => fmt(x.scalar.equity_irr, 'pct')], ['Project IRR', (x: Results) => fmt(x.scalar.project_irr, 'pct')], ['Equity MOIC', (x: Results) => fmt(x.scalar.moic, 'x')]] as Metric[]),
          ['Senior debt (C$m)', x => fmt(x.scalar.debt)], ['Min DSCR', x => fmt(x.scalar.min_dscr, 'x')], ['Average DSCR', x => fmt(x.scalar.avg_dscr, 'x')], ['LLCR', x => fmt(x.scalar.llcr, 'x')],
        ]} />
        <StressPanel m={scratch} v={deferred} noEntry={!!mod.noEntry} delay={mod.delayCase} />
        {'energy_sizing' in values && <PValueCard m={scratch} v={deferred} />}
        {mod.closeDate && <RatesPanel m={scratch} v={values} closeDate={mod.closeDate} onApply={x => setValues(v => ({ ...v, rate: x }))} />}
        {!mod.noEntry && <PensionLens m={scratch} v={values} res={res} />}
        <ValuationPanel m={scratch} v={values} res={res} bid={mod.noEntry ? undefined : mod.bid} bidText={mod.bidText} onApply={(id, x) => setValues(v => ({ ...v, [id]: +x.toFixed(2) }))} />

        <ChecksCard mod={mod} res={res} />
        <MemoCard title={mod.name} sub={`C$ millions, nominal. ${mod.blurb}`} body={() => pfMemo(mod, scratch, values, res, sens)} />

        <div className="card">
          <h2>Annual cash flows (C$m)</h2>
          <div className="scroll-x">
            <table>
              <thead><tr><th>Line</th>{years.map(y => <th key={y}>{y}</th>)}</tr></thead>
              <tbody>
                {([['Revenue', 'revenue'], ['Operating costs', 'opex'], ['EBITDA', 'ebitda'], ['Cash tax', 'l_tax'], ['CFADS', 'cfads'], ['Debt service', 'ds'], ['DSCR', 'dscr_actual'], ['Distributions', 'dist'], ['Equity cash flow', 'equity_cf']] as const).map(([l, id]) => (
                  <tr key={id}><td>{l}</td>{r[id].map((v, k) => <td key={k}>{id === 'dscr_actual' ? (Number.isFinite(v) ? fmt(v, 'x') : '') : Math.abs(v) < 0.05 ? '-' : fmt(v)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

export function InputsPanel({ def, mod, values, defaults, setValues }: { def: ModelDef; mod: Module; values: Record<string, number>; defaults: Record<string, number>; setValues: (f: (v: Record<string, number>) => Record<string, number>) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const groups = [...new Set(def.inputs.map(i => i.group))];
  const changed = Object.keys(values).filter(k => values[k] !== defaults[k]).length;
  return (
      <aside className="card inputs" aria-label="Assumptions">
        <div className="inputs-head">
          <strong>Assumptions</strong>
          <button className="btn" disabled={!changed} onClick={() => { setValues(() => defaults); setDraft({}); }}>Reset{changed ? ` (${changed})` : ''}</button>
        </div>
        {groups.map((g, gi) => (
          <details key={g} className="group" open={gi === 0 || g === def.inputs.find(i => i.id === mod.inputs[0]?.id)?.group}>
            <summary>{g}</summary>
            {def.inputs.filter(i => i.group === g).map(i => (
              <div className="field" key={i.id}>
                <label htmlFor={i.id}>{i.label} <span className="note">({i.unit})</span></label>
                <input id={i.id} type="number" inputMode="decimal" step={i.step ?? 'any'} min={i.min} max={i.max}
                  className={values[i.id] !== defaults[i.id] ? 'changed' : ''}
                  value={draft[i.id] ?? toField(i, values[i.id])}
                  onChange={e => {
                    setDraft(d => ({ ...d, [i.id]: e.target.value }));
                    const n = Number(e.target.value);
                    if (e.target.value !== '' && Number.isFinite(n) && (i.min === undefined || n >= i.min) && (i.max === undefined || n <= i.max))
                      setValues(v => ({ ...v, [i.id]: fromField(i, n) }));
                  }}
                  onBlur={() => setDraft(d => { const { [i.id]: _, ...rest } = d; return rest; })} />
                <SourceLine s={i.source} />
              </div>
            ))}
          </details>
        ))}
      </aside>
  );
}

export function ChecksCard({ mod, res }: { mod: Module; res: Results }) {
  if (!mod.checks) return null;
  return (
          <div className="card">
            <h2>Calibration to published figures</h2>
            <div className="scroll-x"><table>
              <thead><tr><th>Measure</th><th>Published</th><th>Model</th><th>Difference</th><th>Source</th></tr></thead>
              <tbody>
                {mod.checks.map(c => {
                  const m = c.model(res), d = m / c.published - 1;
                  return (
                    <tr key={c.label}>
                      <td>{c.label}</td><td>{fmt(c.published, c.fmt)}</td><td>{fmt(m, c.fmt)}</td>
                      <td className={c.info ? '' : Math.abs(d) <= (c.tol ?? 0.01) ? 'diff-ok' : 'diff-off'}>{d >= 0 ? '+' : ''}{(d * 100).toFixed(1)}%</td>
                      <td className="note" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{c.source}{c.info ? `. ${c.info}` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            <p className="note">Inputs marked est. are not published. They were solved so the model reproduces the figures above (any row marked "Not used" is shown for completeness and explained), which is how an analyst rebuilds a deal or a rate case from public data. Returns and values are model outputs: actual equity returns are not public.</p>
          </div>
  );
}

export function useDownload(model: Model, name: string) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const { toXlsx } = await import('../engine/excel.ts'); // loaded on demand to keep the page light
      const buf = await toXlsx(model);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = `${name.replace(/\W+/g, '_')}_model.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally { setBusy(false); }
  };
  return [busy, download] as const;
}
