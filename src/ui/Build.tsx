// Start from scratch: every infrastructure model opens with empty inputs. The visitor enters the deal, presses
// Build, and the platform builds the model and analysis on those inputs. Case studies open prefilled (#/example/<id>).
import { useMemo, useState } from 'react';
import type { Module } from '../engine/projectFinance.ts';
import { defOf } from '../engine/regulated.ts';
import type { Input } from '../engine/sheet.ts';
import { ModelPage } from './ModelPage.tsx';
import { UtilityPage } from './UtilityPage.tsx';
import { DigitalPage } from './DigitalPage.tsx';

type V = Record<string, number>;
export type PageProps = { mod: Module; start?: V; user?: boolean };

// A user's own build: drop everything that belongs to the case study (published checks, its close date, its notes).
export const userModule = (mod: Module): Module => ({
  ...mod, checks: undefined, closeDate: undefined, delayCase: mod.delayCase,
  noEntry: mod.engine === 'lease' ? mod.noEntry : undefined,
  blurb: mod.blurb.replace(/\s*Loaded with.*$/, ''),
});

export function AssetPage({ mod, start, user }: PageProps) {
  const m = useMemo(() => (user ? userModule(mod) : mod), [mod, user]);
  const P = mod.engine === 'regulated' ? UtilityPage : mod.engine === 'lease' ? DigitalPage : ModelPage;
  return <P mod={m} start={start} user={user} />;
}

// Groups that are analysis settings, not deal inputs: they start at zero (no stress) and can be changed later.
const PRESET_GROUP = /^Downside case/;
const toField = (i: Input, v: number) => (i.fmt === 'pct' ? +(v * 100).toFixed(4) : v);

export function Builder({ mod, example }: { mod: Module; example?: string }) {
  const def = useMemo(() => defOf(mod), [mod]);
  const key = `draft.${mod.id}`;
  const [draft, setDraft] = useState<Record<string, string>>(() => { try { return JSON.parse(sessionStorage.getItem(key) ?? '{}'); } catch { return {}; } });
  const [built, setBuilt] = useState<V>();
  const [tried, setTried] = useState(false);
  const groups = [...new Set(def.inputs.map(i => i.group))];
  const preset = (i: Input) => PRESET_GROUP.test(i.group);
  const parse = (i: Input): number | undefined => {
    const raw = draft[i.id];
    if (raw === undefined || raw.trim() === '') return preset(i) ? 0 : undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    const v = i.fmt === 'pct' ? n / 100 : n;
    if ((i.min !== undefined && v < i.min) || (i.max !== undefined && v > i.max)) return undefined;
    return v;
  };
  const required = def.inputs.filter(i => !preset(i));
  const missing = required.filter(i => parse(i) === undefined);
  const set = (id: string, v: string) => setDraft(d => { const n = { ...d, [id]: v }; try { sessionStorage.setItem(key, JSON.stringify(n)); } catch { /* none */ } return n; });

  if (built) return <AssetPage mod={mod} start={built} user />;

  const build = () => {
    setTried(true);
    if (missing.length) { document.getElementById(`b-${missing[0].id}`)?.focus(); return; }
    setBuilt(Object.fromEntries(def.inputs.map(i => [i.id, parse(i)!])));
  };
  return (
    <div className="builder">
      <section className="card build-head">
        <div>
          <span className="eyebrow-dark">Build a model from scratch</span>
          <h1>{mod.name}</h1>
          <p className="note">{mod.blurb.replace(/\s*Loaded with.*$/, '')}</p>
        </div>
        <ol className="steps">
          <li><b>1</b><span><strong>Enter your inputs.</strong> Every field starts empty. Use your own deal's numbers.</span></li>
          <li><b>2</b><span><strong>Press Build model.</strong> The platform builds the full model and analysis on your inputs.</span></li>
          <li><b>3</b><span><strong>Review and export.</strong> Returns, debt metrics, sensitivities, a memo and an Excel model with live formulas. Save it to your portfolio.</span></li>
        </ol>
        {example && <p className="note">Want to see a finished model first? <a href={`#/example/${mod.id}`}>Open the {example} example case</a>.</p>}
      </section>

      <div className="build-grid">
        {groups.map(g => {
          const list = def.inputs.filter(i => i.group === g);
          const pre = PRESET_GROUP.test(g);
          return (
            <fieldset key={g} className="card build-group">
              <legend>{g}</legend>
              {pre && <p className="note">Optional stress settings. They start at 0 (no stress); you can change them after the build.</p>}
              {list.map(i => {
                const bad = tried && !pre && parse(i) === undefined;
                return (
                  <label className={`build-field${bad ? ' bad' : ''}`} key={i.id} htmlFor={`b-${i.id}`}>
                    <span>{i.label} <span className="unit">{i.unit}</span></span>
                    <input id={`b-${i.id}`} type="number" inputMode="decimal" step="any" value={draft[i.id] ?? ''}
                      placeholder={pre ? '0' : `e.g. ${toField(i, i.value)}`} onChange={e => set(i.id, e.target.value)} />
                  </label>
                );
              })}
            </fieldset>
          );
        })}
      </div>

      <div className="card build-bar">
        <span className="note">{missing.length ? `${required.length - missing.length} of ${required.length} inputs entered. ${missing.length} left.` : 'All inputs entered.'}{tried && missing.length ? ' Fields still empty or out of range are outlined.' : ''} Grey "e.g." values show the format only{example ? `, from the ${example} case study` : ''}.</span>
        <span className="build-actions">
          {Object.keys(draft).length > 0 && <button className="btn" onClick={() => { setDraft({}); setTried(false); try { sessionStorage.removeItem(key); } catch { /* none */ } }}>Clear</button>}
          <button className="btn primary" onClick={build}>Build model</button>
        </span>
      </div>
    </div>
  );
}
