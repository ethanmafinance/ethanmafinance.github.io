// Portfolio tracker: the visitor's holdings, saved only in their own browser (localStorage), valued at the
// latest close in the equities data files and converted to C$ at the Bank of Canada USD/CAD rate.
import { useEffect, useMemo, useState } from 'react';
import { valuePortfolio, type Holding, type Quote } from '../engine/portfolio.ts';
import { DATA, loadIndex, type Listing } from './EquityPage.tsx';
import { VALET } from '../data/boc.ts';
import { SavedList } from './Saved.tsx';

const KEY = 'portfolio.v1';
const read = (): Holding[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (h: Holding[]) => { try { localStorage.setItem(KEY, JSON.stringify(h)); } catch { /* private window: kept for this visit only */ } };

const money = (v: number) => v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : 'n/a');

export function PortfolioPage() {
  const [hs, setHs] = useState<Holding[]>(read);
  const [list, setList] = useState<Listing[]>();
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [fx, setFx] = useState<{ v: number; d: string } | null>();
  const [form, setForm] = useState({ ticker: '', shares: '', cost: '' });

  useEffect(() => { write(hs); }, [hs]);
  useEffect(() => { loadIndex().then(d => setList(d.tickers), () => setList([])); }, []);
  useEffect(() => {
    fetch(`${VALET}/observations/FXUSDCAD/json?recent=1`).then(r => r.json())
      .then(j => { const o = j.observations[0]; setFx({ v: +o.FXUSDCAD.v, d: o.d }); }, () => setFx(null));
  }, []);
  useEffect(() => {
    for (const t of new Set(hs.map(h => h.ticker))) if (!quotes[t])
      fetch(`${DATA}${t}.json`).then(r => r.json()).then(c => setQuotes(q => ({ ...q, [t]: { name: c.name, currency: c.currency, price: c.price.v, date: c.price.date, beta: c.beta.value } })), () => {});
  }, [hs]);

  const t = form.ticker.trim().toUpperCase();
  const known = list?.find(l => l.ticker === t);
  const shares = +form.shares, cost = form.cost === '' ? 0 : +form.cost;
  const ok = known && shares > 0 && cost >= 0 && Number.isFinite(cost);
  const add = () => {
    if (!ok) return;
    setHs(p => {
      const i = p.findIndex(h => h.ticker === t);
      if (i < 0) return [...p, { ticker: t, shares, cost }];
      const o = p[i], n = o.shares + shares; // buying more: average cost
      return p.map((h, k) => (k === i ? { ticker: t, shares: n, cost: (o.shares * o.cost + shares * cost) / n } : h));
    });
    setForm({ ticker: '', shares: '', cost: '' });
  };
  const p = useMemo(() => (fx ? valuePortfolio(hs, quotes, fx.v) : undefined), [hs, quotes, fx]);
  const dates = p ? [...new Set(p.rows.map(r => r.date))].sort() : [];

  return (
    <>
      <h1>Portfolio</h1>
      <p className="lede">Your holdings at the latest close in Canadian dollars, and the models you saved. Saved in this browser only: nothing is sent anywhere, and clearing site data removes it.</p>
      <form className="card eq-form" onSubmit={e => { e.preventDefault(); add(); }}>
        <div className="pf-add">
          <label><span>Ticker</span><input list="pf-tickers" value={form.ticker} onChange={e => setForm({ ...form, ticker: e.target.value })} placeholder="FTS" autoComplete="off" spellCheck={false} /></label>
          <label><span>Shares</span><input type="number" min="0" step="any" value={form.shares} onChange={e => setForm({ ...form, shares: e.target.value })} /></label>
          <label><span>Cost per share{known ? ` (${known.currency})` : ''}</span><input type="number" min="0" step="any" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} placeholder="optional" /></label>
          <button className="btn primary" disabled={!ok}>Add</button>
        </div>
        <datalist id="pf-tickers">{list?.map(l => <option key={l.ticker} value={l.ticker}>{l.name}</option>)}</datalist>
        <div className="note">{t && list && !known ? `${t} is not covered. Holdings use the ${list.length} companies in the equities data.` : known ? known.name : 'Adding a ticker you already hold averages the cost.'}</div>
      </form>

      {fx === null && <div className="card warn">The Bank of Canada exchange rate could not load, so totals in C$ are not shown.</div>}
      {p && p.rows.length > 0 && (
        <>
          <div className="kpis" style={{ margin: "14px 0" }}>
            <div className="card kpi"><div className="label">Market value</div><div className="value">C${money(p.total)}</div><div className="sub">{p.rows.length} holdings</div></div>
            <div className="card kpi"><div className="label">Unrealized gain</div><div className="value">{pct(p.gain)}</div><div className="sub">{p.cost ? `on cost of C$${money(p.cost)}${p.rows.some(r => !r.cost) ? ', holdings with a cost only' : ''}` : 'enter costs to see it'}</div></div>
            <div className="card kpi"><div className="label">Weighted beta</div><div className="value">{p.beta.toFixed(2)}</div><div className="sub">60-month, Blume-adjusted</div></div>
            <div className="card kpi"><div className="label">US dollar exposure</div><div className="value">{(p.usdShare * 100).toFixed(0)}%</div><div className="sub">USD/CAD {fx!.v.toFixed(4)}</div></div>
          </div>
          <div className="card">
            <h2>Holdings</h2>
            <div className="scroll-x">
              <table>
                <thead><tr><th>Ticker</th><th>Shares</th><th>Cost</th><th>Close</th><th>Value (local)</th><th>Value (C$)</th><th>Gain</th><th>Weight</th><th>Beta</th><th></th></tr></thead>
                <tbody>{p.rows.map(r => (
                  <tr key={r.ticker}>
                    <td title={r.name}><a href={`#/equity/${r.ticker}`}>{r.ticker}</a> <span className="note">{r.currency}</span></td>
                    <td>{r.shares.toLocaleString('en-CA')}</td><td>{r.cost ? money(r.cost) : 'n/a'}</td><td>{money(r.price)}</td>
                    <td>{money(r.value)}</td><td>{money(r.valueCad)}</td><td>{r.cost ? pct(r.gain) : 'n/a'}</td>
                    <td><div className="pf-bar"><i style={{ width: `${r.weight * 100}%` }} /></div>{(r.weight * 100).toFixed(1)}%</td>
                    <td>{r.beta.toFixed(2)}</td>
                    <td><button className="btn" type="button" onClick={() => setHs(h => h.filter(x => x.ticker !== r.ticker))} aria-label={`Remove ${r.ticker}`}>Remove</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="note">Closes from Yahoo Finance chart data, {dates.join(' to ')}; refreshed each weekday. USD/CAD: Bank of Canada daily average, {fx!.d}. Gain compares value with cost in each holding's own currency, so it excludes currency moves. Beta is against the S&amp;P 500 for US companies and the S&amp;P/TSX Composite for Canadian ones. Click a ticker to value it.</p>
          </div>
        </>
      )}
      {hs.length === 0 && <p className="note">No holdings yet. Add one above.</p>}
      <div style={{ marginTop: 16 }}><SavedList /></div>
    </>
  );
}
