// Saved models: any model a visitor builds (infrastructure or equity) can be saved with its inputs and reopened
// from the Portfolio page. Saved in this browser only, like the holdings.
import { useState } from 'react';
import type { Answers } from '../engine/dcf.ts';

type V = Record<string, number>;
export type Saved = {
  sid: string; name: string; savedAt: string; headline: string; values: V;
  kind: 'infra' | 'equity'; mod?: string; ticker?: string; a?: Answers;
};
const KEY = 'saved.v1';
export const readSaved = (): Saved[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (s: Saved[]) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: kept for this visit only */ } };
export const removeSaved = (sid: string) => write(readSaved().filter(s => s.sid !== sid));

export function SaveButton({ item }: { item: Omit<Saved, 'sid' | 'savedAt' | 'name'> & { name: string } }) {
  const [done, setDone] = useState<string>();
  const save = () => {
    const name = prompt('Name this model', item.name)?.trim();
    if (!name) return;
    const all = readSaved().filter(s => s.name !== name);
    write([{ ...item, name, sid: Date.now().toString(36), savedAt: new Date().toLocaleDateString('en-CA') }, ...all].slice(0, 50));
    setDone(name);
  };
  return done
    ? <a className="btn" href="#/portfolio">Saved. View in Portfolio</a>
    : <button className="btn" onClick={save}>Save to portfolio</button>;
}

export const savedHref = (s: Saved) => `#/saved/${s.sid}`;

// Dashboard tile body: counts and the latest saved models.
export function SavedTiles() {
  const saved = readSaved();
  let holdings = 0;
  try { holdings = JSON.parse(localStorage.getItem('portfolio.v1') ?? '[]').length || 0; } catch { /* none */ }
  return (
    <>
      <div className="mini-tiles two-up">
        <div><div className="label">Saved models</div><div className="value">{saved.length}</div></div>
        <div><div className="label">Holdings</div><div className="value">{holdings}</div></div>
      </div>
      {saved.length
        ? <ul className="saved-mini">{saved.slice(0, 3).map(s => <li key={s.sid}><span>{s.name}</span><span>{s.headline}</span></li>)}</ul>
        : <span className="tile-note">Build a model and press Save to keep it here. Saved in your browser only.</span>}
    </>
  );
}

export function SavedList() {
  const [saved, setSaved] = useState(readSaved);
  if (!saved.length) return (
    <div className="card"><h2>Saved models</h2><p className="note">No saved models yet. Build an infrastructure or equity model and press Save to portfolio; it appears here with its inputs.</p></div>
  );
  return (
    <div className="card">
      <h2>Saved models</h2>
      <div className="scroll-x"><table>
        <thead><tr><th>Model</th><th>Type</th><th>Key output</th><th>Saved</th><th></th></tr></thead>
        <tbody>{saved.map(s => (
          <tr key={s.sid}>
            <td><a href={savedHref(s)}>{s.name}</a></td>
            <td>{s.kind === 'equity' ? `Equity DCF (${s.ticker})` : 'Infrastructure'}</td>
            <td>{s.headline}</td><td>{s.savedAt}</td>
            <td><a className="btn" href={savedHref(s)}>Open</a>{' '}<button className="btn" onClick={() => { removeSaved(s.sid); setSaved(readSaved()); }} aria-label={`Delete ${s.name}`}>Delete</button></td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="note">Saved in this browser only. Opening a model reruns it with today's engine on the inputs you saved.</p>
    </div>
  );
}
