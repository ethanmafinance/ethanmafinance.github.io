// Saved cases side by side: the visitor saves the current inputs under a name (for example base, downside, upside),
// and the table reruns each saved case on the same model. Saved in this browser only, per model page.
import { useMemo, useState } from 'react';
import type { Model, Results } from '../engine/sheet.ts';

type V = Record<string, number>;
type Case = { name: string; values: V };
export type Metric = [string, (r: Results) => string];

const load = (key: string): Case[] => { try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const save = (key: string, c: Case[]) => { try { localStorage.setItem(key, JSON.stringify(c)); } catch { /* private window: kept for this visit */ } };

export function CasesPanel({ id, m, values, defaults, setValues, metrics }: { id: string; m: Model; values: V; defaults: V; setValues: (f: (v: V) => V) => void; metrics: Metric[] }) {
  const key = `cases.${id}`;
  const [cases, setCases] = useState<Case[]>(() => load(key));
  const [name, setName] = useState('');
  const update = (c: Case[]) => { setCases(c); save(key, c); };
  const all: Case[] = [{ name: 'Current inputs', values }, ...cases];
  const out = useMemo(() => {
    const r = all.map(c => { m.set({ ...defaults, ...c.values }); const res = m.results(); return metrics.map(([, f]) => f(res)); });
    m.set(values);
    return r;
  }, [cases, values, m]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = (v: V) => Object.keys(v).filter(k => k in defaults && Math.abs(v[k] - defaults[k]) > 1e-12).length;
  const add = () => {
    const n = name.trim() || `Case ${cases.length + 1}`;
    const diff = Object.fromEntries(Object.entries(values).filter(([k, x]) => Math.abs(x - defaults[k]) > 1e-12)); // store only changes
    update([...cases.filter(c => c.name !== n), { name: n, values: diff }]);
    setName('');
  };
  return (
    <div className="card">
      <h2>Saved cases</h2>
      <p className="note">Save the inputs as they are now under a name, for example base, downside and upside, and compare them side by side. Each case reruns on the same model. Saved in this browser only.</p>
      <div className="pf-add" style={{ gridTemplateColumns: '1fr auto' }}>
        <label><span>Case name</span><input value={name} onChange={e => setName(e.target.value)} placeholder={`Case ${cases.length + 1}`} maxLength={40} /></label>
        <button className="btn primary" onClick={add} disabled={cases.length >= 6}>Save current inputs</button>
      </div>
      <div className="scroll-x" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>Measure</th>{all.map(c => <th key={c.name}>{c.name}</th>)}</tr></thead>
          <tbody>
            {metrics.map(([label], i) => <tr key={label}><td>{label}</td>{out.map((r, j) => <td key={j}>{r[i]}</td>)}</tr>)}
            <tr><td>Inputs changed from the loaded example</td>{all.map(c => <td key={c.name}>{changed(c.values)}</td>)}</tr>
            {cases.length > 0 && (
              <tr><td></td><td></td>{cases.map(c => (
                <td key={c.name}>
                  <button className="btn" onClick={() => setValues(() => ({ ...defaults, ...c.values }))}>Load</button>{' '}
                  <button className="btn" onClick={() => update(cases.filter(x => x.name !== c.name))} aria-label={`Delete ${c.name}`}>Delete</button>
                </td>
              ))}</tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
