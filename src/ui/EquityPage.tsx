// Equities: enter a ticker, answer four questions, and the DCF builds itself from the company's SEC filings.
// Data files come from scripts/equities.mjs (public/data/eq). Every assumption stays editable here and in Excel.
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Model } from '../engine/sheet.ts';
import { dcf, type Answers, type Company, type Overrides } from '../engine/dcf.ts';
import { fortisChecks, fortisEquity } from '../modules/fortisEquity.ts';
import type { Module } from '../engine/projectFinance.ts';
import { ChecksCard, fmt, InputsPanel, useDownload } from './ModelPage.tsx';
import { BarChart, LineChart } from './Charts.tsx';
import { Calibration, MemoCard, Rows } from './Memo.tsx';
import { CasesPanel } from './Cases.tsx';
import { SaveButton } from './Saved.tsx';
import { comp, GROUPS, groupOf, impliedPerShare, median, type Comp } from '../engine/comps.ts';

type V = Record<string, number>;
export type Listing = { ticker: string; name: string; currency: string };
export const DATA = './data/eq/';

let indexCache: Promise<{ generated: string; tickers: Listing[] }> | undefined;
export const loadIndex = () => (indexCache ??= fetch(DATA + 'index.json').then(r => { if (!r.ok) throw new Error('index'); return r.json(); }));

const QUESTIONS: { key: keyof Answers; q: string; options: [string, string, string][] }[] = [
  { key: 'years', q: 'How many years should the explicit forecast run?', options: [['5', '5 years', 'Mature company: growth settles quickly'], ['10', '10 years', 'Still growing: a longer fade to the terminal rate']] },
  { key: 'scenario', q: 'Which case?', options: [['base', 'Base', 'Growth and margins from reported history'], ['downside', 'Downside', 'Year 1 growth -3pt, target margin x0.9'], ['upside', 'Upside', 'Year 1 growth +3pt, target margin x1.1']] },
  { key: 'wacc', q: 'How should the discount rate be set?', options: [['capm', 'Build it (CAPM)', 'Risk-free rate, beta and equity risk premium, weighted with debt'], ['direct', 'I will enter a WACC', 'Starts at 8%; change it in the assumptions']] },
  { key: 'terminal', q: 'How should the terminal value be set?', options: [['growth', 'Perpetuity growth', 'Value driver formula: growth, return on new capital, WACC'], ['multiple', 'Exit multiple', "EV / EBITDA, starting at today's trading multiple"]] },
];
const DEFAULT: Answers = { years: 5, scenario: 'base', wacc: 'capm', terminal: 'growth' };

export const parseEquityRoute = (route: string) => {
  const [path, query = ''] = route.split('?');
  const ticker = path.split('/')[1]?.toUpperCase();
  const q = new URLSearchParams(query);
  const a: Answers = {
    years: [5, 10].includes(+q.get('y')!) ? +q.get('y')! : DEFAULT.years,
    scenario: (['base', 'downside', 'upside'] as const).find(s => s === q.get('s')) ?? DEFAULT.scenario,
    wacc: q.get('w') === 'direct' ? 'direct' : 'capm',
    terminal: q.get('t') === 'multiple' ? 'multiple' : 'growth',
  };
  return { ticker, a, prefill: q.get('ticker')?.toUpperCase() ?? '' };
};
const hrefOf = (t: string, a: Answers) => `#/equity/${t}?y=${a.years}&s=${a.scenario}&w=${a.wacc}&t=${a.terminal}`;

export function EquityStart({ prefill = '' }: { prefill?: string }) {
  const [list, setList] = useState<Listing[]>();
  const [err, setErr] = useState(false);
  const [ticker, setTicker] = useState(prefill);
  const [a, setA] = useState<Answers>(DEFAULT);
  useEffect(() => { loadIndex().then(d => setList(d.tickers), () => setErr(true)); }, []);
  const t = ticker.trim().toUpperCase();
  const known = list?.find(l => l.ticker === t);
  return (
    <>
      <h1>Value a listed company</h1>
      <p className="lede">Enter a ticker and answer four questions. The DCF builds itself from the company's SEC filings and the latest close, and every assumption stays editable here and in the Excel download.</p>
      <form className="card eq-form" onSubmit={e => { e.preventDefault(); if (known) location.hash = hrefOf(t, a); }}>
        <label className="eq-ticker">
          <span>Ticker</span>
          <input list="eq-tickers" value={ticker} onChange={e => setTicker(e.target.value)} placeholder="FTS" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
          <datalist id="eq-tickers">{list?.map(l => <option key={l.ticker} value={l.ticker}>{l.name}</option>)}</datalist>
        </label>
        <div className="note">
          {err ? 'The company list could not load.' : !list ? 'Loading the company list...' : known ? `${known.name}, reports in ${known.currency}.` : t ? `${t} is not covered yet. ${list.length} companies are covered, all SEC filers.` : `${list.length} companies covered, all SEC filers, including Canadian companies that file 40-F reports.`}
        </div>
        {QUESTIONS.map(qn => (
          <fieldset key={qn.key} className="eq-q">
            <legend>{qn.q}</legend>
            <div className="seg">
              {qn.options.map(([val, label, help]) => (
                <label key={val} className={String(a[qn.key]) === val ? 'on' : ''}>
                  <input type="radio" name={qn.key} value={val} checked={String(a[qn.key]) === val}
                    onChange={() => setA(p => ({ ...p, [qn.key]: qn.key === 'years' ? +val : val }))} />
                  <strong>{label}</strong><span className="note">{help}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <button className="btn primary" disabled={!known}>Build the model</button>
      </form>
      {list && (
        <div className="card">
          <h2>Covered companies</h2>
          <ul className="chips eq-list">{list.map(l => <li key={l.ticker}><a href={hrefOf(l.ticker, a)} title={l.name}>{l.ticker}</a></li>)}</ul>
        </div>
      )}
    </>
  );
}

export function EquityModel({ ticker, a, start }: { ticker: string; a: Answers; start?: V }) {
  const [co, setCo] = useState<Company | null>();
  useEffect(() => {
    let live = true;
    fetch(`${DATA}${ticker}.json`).then(r => (r.ok ? r.json() : null)).then(d => live && setCo(d), () => live && setCo(null));
    return () => { live = false; };
  }, [ticker]);
  if (co === undefined) return <p className="note">Loading {ticker}...</p>;
  if (co === null) return <div className="card"><h1>{ticker} is not covered</h1><p className="note">Only companies in the data file can be valued. <a href="#/equity">Choose another ticker</a>.</p></div>;
  return <EquityView key={ticker + JSON.stringify(a)} co={co} a={a} start={start} />;
}

const WACC_STEPS = [-0.01, -0.005, 0, 0.005, 0.01];
const G_STEPS = [-0.01, -0.005, 0, 0.005, 0.01];

// Worked example: frozen company data plus guidance-based assumptions and checks against the filings.
export const EQUITY_EXAMPLES = [{ ...fortisEquity, checks: fortisChecks }];
export const equityVerified = (e: (typeof EQUITY_EXAMPLES)[number]) => {
  const m = new Model(dcf(e.company, e.answers, e.overrides).def);
  const res = m.results();
  m.hf.destroy();
  return e.checks.every(c => c.info || Math.abs(c.model(res) / c.published - 1) <= (c.tol ?? 0.01));
};
export function EquityExample({ id }: { id: string }) {
  const e = EQUITY_EXAMPLES.find(x => x.id === id);
  if (!e || !equityVerified(e)) return <div className="card"><h1>Example not available</h1><p className="note"><a href="#/equity">Value a company</a></p></div>;
  return <EquityView co={e.company} a={e.answers} over={e.overrides} checks={e.checks} title={e.name} />;
}

function EquityView({ co, a, over, checks, title, start }: { co: Company; a: Answers; over?: Overrides; checks?: Module['checks']; title?: string; start?: V }) {
  const { def, missing } = useMemo(() => dcf(co, a, over), [co, a, over]);
  const defaults = useMemo(() => ({ ...Object.fromEntries(def.inputs.map(i => [i.id, i.value])), ...start }), [def, start]);
  const [values, setValues] = useState<V>(defaults);
  const model = useMemo(() => new Model(def, defaults), [def, defaults]);
  const res = useMemo(() => { model.set(values); return model.results(); }, [model, values]);
  const [busy, download] = useDownload(model, `${co.ticker} DCF`);
  const scratch = useMemo(() => new Model(def, defaults), [def, defaults]);
  const deferred = useDeferredValue(values);

  const extra = useMemo(() => {
    const m = new Model(def, deferred);
    const val = (ov: V) => { m.set({ ...deferred, ...ov }); return m.results().scalar; };
    const w0 = val({}).wacc;
    const grid = WACC_STEPS.map(dw => G_STEPS.map(dg => val({ wacc_mode: 1, wacc_in: w0 + dw, g_term: deferred.g_term + dg }).per_share));
    // Reverse DCF: year 1 growth that makes value per share equal the current price (bisection; value rises with growth
    // unless new capital earns less than WACC).
    let lo = -0.3, hi = 0.6, implied: number | undefined;
    const f = (g: number) => val({ g1: g }).per_share - deferred.price;
    const flo = f(lo), fhi = f(hi);
    if (Math.sign(flo) !== Math.sign(fhi)) {
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (Math.sign(f(mid)) === Math.sign(flo)) lo = mid; else hi = mid; }
      implied = (lo + hi) / 2;
    }
    m.hf.destroy();
    return { grid, w0, implied };
  }, [def, deferred]);

  const s = res.scalar, r = res.row;
  const cols = r.year.map((_, k) => k);
  const fc = cols.filter(k => r.fc[k] === 1);
  const ccy = co.currency === 'CAD' ? 'C$' : 'US$';
  const mod = { inputs: def.inputs.filter(i => i.group === 'Forecast') } as unknown as Module; // opens the Forecast group
  const yr = (k: number) => `${r.fc[k] ? '' : 'FY'}${r.year[k]}${r.fc[k] ? 'E' : ''}`;

  return (
    <div className="model-layout">
      <InputsPanel def={def} mod={mod} values={values} defaults={defaults} setValues={setValues} />
      <section className="results">
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>{title ?? `${co.name} (${co.ticker})`}</h1>
            <div className="note">Unlevered DCF, {a.scenario} case, {values.years}-year forecast, {values.tv_mode ? 'exit multiple' : 'perpetuity growth'} terminal value. {ccy} millions except per share. Filings to FY{co.fyEnds.at(-1)!.slice(0, 4)}; price {co.price.date}. <a href="#/equity">Change ticker or answers</a></div>
          </div>
          <span className="head-actions"><SaveButton item={{ kind: 'equity', ticker: co.ticker, a, name: title ?? `${co.ticker} DCF`, values, headline: `${ccy}${fmt(res.scalar.per_share, 'px')} per share` }} /><button className="btn primary" onClick={download} disabled={busy}>{busy ? 'Building file...' : 'Download Excel model (live formulas)'}</button></span>
        </div>

        {missing.length > 0 && (
          <p className="card warn">Not tagged in this company's XBRL data: {missing.join(', ')}. Those years show 0 and the defaults that depend on them are placeholders. Enter the reported figures from the annual report under Reported financials before relying on the value.</p>
        )}

        <div className="kpis">
          {([
            ['Value per share', `${ccy}${fmt(s.per_share, 'px')}`, `price ${ccy}${fmt(values.price, 'px')}`],
            ['Upside', fmt(s.upside, 'pct'), 'to the current price'],
            ['Enterprise value', fmt(s.ev), `${ccy}m; market ${fmt(s.mkt_ev)}`],
            ['WACC', fmt(s.wacc, 'pct'), values.wacc_mode ? 'entered' : `Ke ${fmt(s.ke, 'pct')}, debt ${fmt(s.w_d, 'pct')}`],
            ['Terminal value', fmt(s.tv_share, 'pct'), 'of enterprise value'],
            ['Implied EV / EBITDA', fmt(s.ev_ebitda, 'x'), `forecast year 1; terminal ${fmt(s.tv_mult_implied, 'x')}`],
          ] as const).map(([l, v, sub]) => (
            <div className="card kpi" key={l}><div className="label">{l}</div><div className="value">{v}</div><div className="sub">{sub}</div></div>
          ))}
        </div>

        <div className="card">
          <h2>What the price implies</h2>
          <p style={{ margin: 0 }}>
            {extra.implied === undefined
              ? 'No year 1 growth rate between -30% and +60% reproduces the current price with the other assumptions held, so the gap comes from margins, reinvestment or the discount rate.'
              : <>At {ccy}{fmt(values.price, 'px')} the market is paying for year 1 revenue growth of <strong>{fmt(extra.implied, 'pct')}</strong>, fading to {fmt(values.g_term, 'pct')} by year {values.years}, against {fmt(values.g1, 'pct')} in this model. Every other assumption is held.</>}
          </p>
          <p className="note">A reverse DCF reads the market's expectation out of the price instead of arguing about a target. Solved by bisection on the same formulas as the model.</p>
        </div>

        <div className="card">
          <h2>Free cash flow build ({ccy}m)</h2>
          <div className="scroll-x"><table>
            <thead><tr><th>Line</th>{cols.map(k => <th key={k}>{yr(k)}</th>)}</tr></thead>
            <tbody>
              {([['Revenue', 'rev', 'num'], ['Growth', 'growth', 'pct'], ['EBIT', 'ebit', 'num'], ['EBIT margin', 'margin', 'pct'], ['NOPAT', 'nopat', 'num'], ['Plus D&A', 'da', 'num'], ['Less capex', 'capex', 'num'], ['Reinvestment rate', 'reinv_rate', 'pct'], ['Unlevered free cash flow', 'fcf', 'num'], ['Present value', 'pv_fcf', 'num']] as const).map(([l, id, f]) => (
                <tr key={id} className={id === 'fcf' ? 'total' : ''}><td>{l}</td>{cols.map(k => <td key={k}>{id === 'pv_fcf' && !r.fc[k] ? '' : fmt(r[id][k], f)}</td>)}</tr>
              ))}
            </tbody>
          </table></div>
          <p className="note">FY columns are as reported; E columns are the forecast. Growth fades in a straight line to the terminal rate, the margin to its target, and the reinvestment rate to growth / return on new capital, so the last year is consistent with the terminal value.</p>
        </div>

        <div className="two">
          <div className="card">
            <h2>Value per share by WACC and terminal growth</h2>
            <div className="scroll-x"><table>
              <thead><tr><th>WACC</th>{G_STEPS.map(dg => <th key={dg}>g {fmt(values.g_term + dg, 'pct')}</th>)}</tr></thead>
              <tbody>
                {WACC_STEPS.map((dw, i) => (
                  <tr key={dw}><td>{fmt(extra.w0 + dw, 'pct')}</td>{extra.grid[i].map((v, j) => <td key={j} className={v >= values.price ? 'diff-ok' : 'diff-off'}>{fmt(v, 'px')}</td>)}</tr>
                ))}
              </tbody>
            </table></div>
            <p className="note">Green cells are at or above the current price. {values.tv_mode ? 'The exit multiple method ignores terminal growth, so columns differ only through the forecast fade.' : values.ronic === 0 ? 'With return on new capital equal to WACC, growth adds no value, so the columns barely move. Set RONIC above WACC to value growth.' : ''}</p>
          </div>
          <div className="card">
            <h2>Equity bridge ({ccy}m)</h2>
            <table><tbody>
              {([['Enterprise value', s.ev], ['Less debt', -values.debt], ['Plus cash', values.cash], ['Less non-controlling interests', -values.nci], ['Less preferred shares', -values.pref], ['Equity value', s.eq]] as const).map(([l, v]) => (
                <tr key={l} className={l === 'Equity value' ? 'total' : ''}><td>{l}</td><td>{fmt(v)}</td></tr>
              ))}
              <tr><td>Shares (m)</td><td>{fmt(values.shares)}</td></tr>
              <tr className="total"><td>Value per share ({ccy})</td><td>{fmt(s.per_share, 'px')}</td></tr>
            </tbody></table>
            <p className="note">Debt, non-controlling interests and preferred shares at book value from the last annual filing.</p>
          </div>
        </div>

        <div className="two">
          <div className="card">
            <h2>Revenue and EBIT</h2>
            <LineChart xs={cols.map(yr)} fmt={v => fmt(v)} series={[
              { name: 'Revenue', values: r.rev, color: 'var(--series-1)' },
              { name: 'EBIT', values: r.ebit, color: 'var(--series-2)' },
            ]} />
          </div>
          <div className="card">
            <h2>Unlevered free cash flow</h2>
            <BarChart xs={cols.map(yr)} fmt={v => fmt(v)} series={{ name: 'Free cash flow', values: r.fcf, color: 'var(--series-1)' }} />
          </div>
        </div>
        <CasesPanel id={`eq.${title ? 'example.' : ''}${co.ticker}.${a.years}.${a.scenario}.${a.wacc}.${a.terminal}`} m={scratch} values={values} defaults={defaults} setValues={setValues} metrics={[
          ['Value per share', x => `${ccy}${fmt(x.scalar.per_share, 'px')}`], ['Upside to price', x => fmt(x.scalar.upside, 'pct')], ['Enterprise value', x => fmt(x.scalar.ev)],
          ['WACC', x => fmt(x.scalar.wacc, 'pct')], ['Terminal value share', x => fmt(x.scalar.tv_share, 'pct')], ['Implied EV / EBITDA', x => fmt(x.scalar.ev_ebitda, 'x')],
        ]} />
        {checks && <ChecksCard mod={{ checks } as Module} res={res} />}
        <CompsCard co={co} ccy={ccy} />
        <MemoCard blocked={missing.length && !def.inputs.some(i => i.group === 'Reported financials' && values[i.id] !== defaults[i.id]) ? `Enter the figures missing from the XBRL data (${missing.join(', ')}) under Reported financials first; the value is not meaningful without them.` : undefined}
          title={title ?? `${co.name} (${co.ticker})`} sub={`Unlevered DCF, ${a.scenario} case, ${values.years}-year forecast. ${ccy} millions except per share. Filings to FY${co.fyEnds.at(-1)!.slice(0, 4)}; price ${co.price.date}.`} body={() => (
          <>
            <section>
              <h2>Summary</h2>
              <p>The DCF values {co.ticker} at {ccy}{fmt(s.per_share, 'px')} a share against a price of {ccy}{fmt(values.price, 'px')} ({fmt(s.upside, 'pct')}), at a {fmt(s.wacc, 'pct')} WACC with {fmt(s.tv_share, 'pct')} of enterprise value in the terminal value.
                {extra.implied !== undefined && <> The price implies year 1 revenue growth of {fmt(extra.implied, 'pct')} against {fmt(values.g1, 'pct')} in the model, with every other assumption held.</>}
                {missing.length > 0 && <> Not tagged in the XBRL data and left as placeholders: {missing.join(', ')}.</>}</p>
            </section>
            <div className="memo-two">
              <section><h2>Valuation</h2><Rows rows={[
                ['Enterprise value', fmt(s.ev)], ['Less debt', fmt(-values.debt)], ['Plus cash', fmt(values.cash)], ['Less NCI and preferred', fmt(-values.nci - values.pref)],
                ['Equity value', fmt(s.eq)], ['Shares (m)', fmt(values.shares)], ['Value per share', `${ccy}${fmt(s.per_share, 'px')}`], ['Implied EV / EBITDA, year 1', fmt(s.ev_ebitda, 'x')],
              ]} /></section>
              <section><h2>Assumptions</h2><Rows rows={[
                ['Revenue growth, year 1 to terminal', `${fmt(values.g1, 'pct')} to ${fmt(values.g_term, 'pct')}`], ['EBIT margin, year 1 to target', `${fmt(values.m1, 'pct')} to ${fmt(values.m_target, 'pct')}`],
                ['Reinvestment rate, year 1', fmt(values.reinv1, 'pct')], ['Return on new capital', fmt(s.ronic_used, 'pct')], ['Tax rate', fmt(values.tax, 'pct')],
                ['WACC', values.wacc_mode ? `${fmt(s.wacc, 'pct')} (entered)` : `${fmt(s.wacc, 'pct')}: Ke ${fmt(s.ke, 'pct')}, Kd after tax ${fmt(s.kd_at, 'pct')}, debt ${fmt(s.w_d, 'pct')}`],
                ['Terminal value', values.tv_mode ? `exit at ${fmt(values.exit_mult, 'x')} EBITDA` : `growth, ${fmt(s.tv_mult_implied, 'x')} EBITDA implied`],
              ]} /></section>
            </div>
            <section>
              <h2>Value per share by WACC and terminal growth ({ccy})</h2>
              <table><tbody>
                <tr><th>WACC</th>{G_STEPS.map(dg => <th key={dg}>g {fmt(values.g_term + dg, 'pct')}</th>)}</tr>
                {WACC_STEPS.map((dw, i) => <tr key={dw}><td>{fmt(extra.w0 + dw, 'pct')}</td>{extra.grid[i].map((x, j) => <td key={j}>{fmt(x, 'px')}</td>)}</tr>)}
              </tbody></table>
            </section>
            <Calibration checks={checks} res={res} />
          </>
        )} />
        <p className="note">Forecast years: {fc.length}. Figures are model outputs from public data, not a recommendation.</p>
      </section>
    </div>
  );
}

// Trading comparables: the subject against its sector peers, each from its own latest SEC filing and closing price.
function CompsCard({ co, ccy }: { co: Company; ccy: string }) {
  const group = groupOf(co.ticker);
  const [peers, setPeers] = useState<(Comp & { cur: string })[]>();
  const [skipped, setSkipped] = useState<string[]>([]);
  useEffect(() => {
    if (!group) return;
    let live = true;
    Promise.all(GROUPS[group].map(t => fetch(`${DATA}${t}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null)))
      .then(cs => {
        if (!live) return;
        setPeers(cs.flatMap((c: Company | null) => { const x = c && comp(c); return x ? [{ ...x, cur: c!.currency }] : []; }));
        setSkipped(GROUPS[group].filter((t, k) => !(cs[k] && comp(cs[k]))));
      });
    return () => { live = false; };
  }, [group]);
  if (!group) return null;
  const others = (peers ?? []).filter(p => p.ticker !== co.ticker);
  const med = { evEbitda: median(others.map(p => p.evEbitda)), evRev: median(others.map(p => p.evRev)), pe: median(others.map(p => p.pe)) };
  const self = comp(co);
  const x = (n?: number) => (n === undefined ? 'n/a' : fmt(n, 'x'));
  return (
    <div className="card">
      <h2>Trading comparables: {group.toLowerCase()}</h2>
      {!peers ? <p className="note">Loading peers...</p> : (
        <>
          <div className="scroll-x"><table>
            <thead><tr><th>Company</th><th>EV (m)</th><th>EV / EBITDA</th><th>EV / revenue</th><th>P / E</th><th>Fiscal year</th></tr></thead>
            <tbody>
              {peers.map(p => (
                <tr key={p.ticker} style={p.ticker === co.ticker ? { fontWeight: 700 } : undefined}>
                  <td><a href={`#/equity/${p.ticker}`}>{p.ticker}</a></td><td>{p.cur === 'CAD' ? 'C$' : 'US$'}{fmt(p.ev)}</td><td>{x(p.evEbitda)}</td><td>{x(p.evRev)}</td><td>{x(p.pe)}</td><td>{p.fy}</td>
                </tr>
              ))}
              <tr><td>Peer median (excluding {co.ticker})</td><td></td><td>{x(med.evEbitda)}</td><td>{x(med.evRev)}</td><td>{x(med.pe)}</td><td></td></tr>
            </tbody>
          </table></div>
          {skipped.length > 0 && <p className="note">Not shown: {skipped.join(', ')} (operating income or price missing from the data).</p>}
          {self?.evEbitda !== undefined && med.evEbitda !== undefined && (
            <p>At the peer median EV / EBITDA of {fmt(med.evEbitda, 'x')}, {co.ticker} is worth {ccy}{fmt(impliedPerShare(co, med.evEbitda), 'px')} a share against a price of {ccy}{fmt(co.price.v, 'px')} (it trades at {fmt(self.evEbitda, 'x')}).</p>
          )}
        </>
      )}
      <p className="note">Each company from its latest annual SEC filing and the latest closing price. EV = market value of equity + debt - cash + non-controlling interests + preferred shares, the same bridge as the DCF. EBITDA = operating income + D&A for the last fiscal year (trailing, not forward). P / E uses net income including non-controlling interests where that is what the filing tags. n/a means a figure is missing or negative. Peer groups are this site's grouping.</p>
    </div>
  );
}
