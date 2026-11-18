import { useEffect, useMemo, useState } from 'react';
import { Model } from '../engine/sheet.ts';
import type { Module } from '../engine/projectFinance.ts';
import { defOf } from '../engine/regulated.ts';
import { p3 } from '../modules/p3.ts';
import { renewables } from '../modules/renewables.ts';
import { tollRoad } from '../modules/tollRoad.ts';
import { utility } from '../modules/utility.ts';
import { digital } from '../modules/digital.ts';
import { ModelPage } from './ModelPage.tsx';
import { UtilityPage } from './UtilityPage.tsx';
import { DigitalPage } from './DigitalPage.tsx';
import { HowItWorks } from './HowItWorks.tsx';
import { EQUITY_EXAMPLES, EquityExample, EquityModel, EquityStart, equityVerified, parseEquityRoute } from './EquityPage.tsx';
import { PortfolioPage } from './Portfolio.tsx';
import { MarketsPage, MarketTiles, Source } from './Markets.tsx';
import { useMarket } from '../data/boc.ts';

const LIVE = { p3, renewables, toll: tollRoad, utility, digital };
// Infrastructure asset classes in picker order. `id` set = live module.
const ASSETS: { name: string; blurb: string; id?: keyof typeof LIVE }[] = [
  { name: 'Social infrastructure P3', blurb: 'Hospitals, transit and courthouses paid by availability payments.', id: 'p3' },
  { name: 'Renewables', blurb: 'Solar, onshore wind and battery storage with PPA, P50/P90 output and a merchant tail.', id: 'renewables' },
  { name: 'Toll roads', blurb: 'Transport concessions with traffic ramp-up and toll escalation.', id: 'toll' },
  { name: 'Midstream and pipelines', blurb: 'Take-or-pay capacity contracts plus volume.' },
  { name: 'Regulated utilities', blurb: 'Rate base, deemed equity and allowed ROE.', id: 'utility' },
  { name: 'Data centres', blurb: 'Leased capacity: rent escalators, lease rollover, lease-up and an exit cap rate.', id: 'digital' },
];
// Worked examples built end to end from public sources.
// Shown only while the model reproduces every published figure within 1%, or the wider tolerance a check states
// where the source itself rounds (rule: never show wrong output).
const EXAMPLES = [
  { mod: p3, name: 'Humber River Hospital P3', meta: 'Toronto, financial close 2011', what: 'Rebuilt from the Infrastructure Ontario value for money report and DBRS ratings. Matches published debt, coverage, gearing and payments.' },
  { mod: renewables, name: 'Dufferin Wind', meta: '91.4 MW, Ontario, 2015 bond refinancing', what: 'Rebuilt from Morningstar DBRS releases. Matches the $200 million bond, rating-case coverage, realized FIT prices and later bond balances.' },
  { mod: utility, name: 'Toronto Hydro 2025-2029 rate plan', meta: 'Electricity distribution, Toronto, OEB decision 2024', what: 'Rebuilt from the OEB-approved settlement and draft rate order. Matches rate base, deemed interest, return on equity and revenue requirement in every check; values the equity at a target IRR.' },
  { mod: digital, name: 'Blue Owl data centre portfolio', meta: '12 US data centres, 235 MW, Sep 2026 valuation', what: 'Rebuilt from the trust 10-Q filing. Matches the published gross asset value and all four published value sensitivities to the discount and exit cap rates; tested out of sample on the December 2025 portfolio.' },
  { mod: tollRoad, name: 'Confederation Bridge', meta: 'Toll bridge, PEI, operating asset from Sep 2017', what: 'Rebuilt from DBRS releases. Matches the 6.17% bonds outstanding in 2017 to 2019, 2018 coverage, traffic and tolls; values the equity at a target IRR.' },
];
const verified = (m: Module) => {
  const model = new Model(defOf(m));
  const res = model.results();
  model.hf.destroy();
  return (m.checks ?? []).every(c => c.info || Math.abs(c.model(res) / c.published - 1) <= (c.tol ?? 0.01));
};

const useHash = () => {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => { setH(location.hash); scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h.replace(/^#\/?/, '');
};

export function App() {
  const route = useHash();
  const mod = route.startsWith('model/') ? LIVE[route.slice(6) as keyof typeof LIVE] : undefined;
  const eq = route.startsWith('equity') ? parseEquityRoute(route) : undefined;
  const page = mod ? 'model' : eq ? 'equity' : (['infra', 'markets', 'portfolio', 'how'] as const).find(p => p === route) ?? 'home';
  const nav: [string, string, boolean][] = [
    ['#/', 'Dashboard', page === 'home'],
    ['#/infra', 'Infrastructure', page === 'infra' || page === 'model'],
    ['#/equity', 'Equities', page === 'equity'],
    ['#/markets', 'Market stats', page === 'markets'],
    ['#/portfolio', 'Portfolio', page === 'portfolio'],
    ['#/how', 'How it works', page === 'how'],
  ];
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/">
            <span className="brand-mark"><svg width="16" height="16" viewBox="0 0 32 32"><path d="M6 24h20M9 24V13m7 11V9m7 15V15" stroke="white" strokeWidth="3.5" strokeLinecap="round" /></svg></span>
            Infrastructure Investment Modeling Platform
          </a>
          <nav className="nav">
            {nav.map(([h, l, on]) => <a key={h} href={h} aria-current={on ? 'page' : undefined}>{l}</a>)}
          </nav>
        </div>
      </header>
      <main className="page">
        {page === 'model' && mod && (mod.engine === 'regulated' ? <UtilityPage key={mod.id} mod={mod} /> : mod.engine === 'lease' ? <DigitalPage key={mod.id} mod={mod} /> : <ModelPage key={mod.id} mod={mod} />)}
        {page === 'equity' && eq && (route.startsWith('equity/example/') ? <EquityExample id={route.slice(15)} /> : eq.ticker ? <EquityModel ticker={eq.ticker} a={eq.a} /> : <EquityStart />)}
        {page === 'how' && <HowItWorks />}
        {page === 'markets' && <MarketsPage />}
        {page === 'portfolio' && <PortfolioPage />}
        {page === 'infra' && <InfraPicker />}
        {page === 'home' && <Dashboard />}
      </main>
      <footer>Built from public sources only. Figures marked est. are estimates with the method shown. Not investment advice.</footer>
    </>
  );
}

function Dashboard() {
  const market = useMarket();
  const examples = useMemo(() => EXAMPLES.filter(e => verified(e.mod)), []);
  const eqExamples = useMemo(() => EQUITY_EXAMPLES.filter(equityVerified), []);
  return (
    <>
      <section className="hero">
        <h1>Value infrastructure and equities</h1>
        <p className="lede">Project finance models for contracted infrastructure and DCF valuations for listed companies. Every default shows its public source, and every model downloads to Excel with live formulas.</p>
      </section>

      <div className="primary">
        <div className="glass prime">
          <div className="widget-head"><span className="eyebrow">Infrastructure</span><span className="pill">Live</span></div>
          <strong className="prime-title">Value an infrastructure asset</strong>
          <span className="prime-text">Pick an asset class, set the deal terms, and get sources and uses, sculpted debt, DSCR and LLCR, equity IRR, sensitivities and an Excel model.</span>
          <ul className="chips">
            {ASSETS.map(a => <li key={a.name}>{a.id
              ? <a className="chip on" href={`#/model/${a.id}`}>{a.name}</a>
              : <span className="chip" title="Model in progress">{a.name} <small>soon</small></span>}</li>)}
          </ul>
          <a className="widget-cta" href="#/infra">See all asset classes</a>
        </div>
        <a className="glass prime" href="#/equity">
          <div className="widget-head"><span className="eyebrow">Equities</span><span className="pill">Live</span></div>
          <strong className="prime-title">Value a listed company</strong>
          <span className="prime-text">Enter a ticker and answer four questions. The DCF builds itself from SEC filings and the latest close, with a reverse DCF of what the price implies, and every assumption stays editable on the site or in Excel.</span>
          <div className="ticker-mock" aria-hidden="true"><span>Ticker</span><span className="caret" /></div>
        </a>
      </div>

      <h2 className="side-head">More tools</h2>
      <div className="secondary">
        <a className="glass side" href="#/markets">
          <div className="widget-head"><h3>Market stats</h3><span className="tag live">Live</span></div>
          {market.data ? <MarketTiles data={market.data} /> : <span className="note">{market.error ? 'Bank of Canada data could not load.' : 'Loading Bank of Canada data...'}</span>}
          <span className="widget-cta">Yield curve and inflation</span>
        </a>
        <div className="glass side">
          <div className="widget-head"><h3>Past analysis</h3><span className="tag">{examples.length + eqExamples.length} verified</span></div>
          {examples.map(e => (
            <a key={e.mod.id} className="example" href={`#/model/${e.mod.id}`}>
              <strong>{e.name}</strong>
              <span className="note">{e.meta}. {e.what}</span>
            </a>
          ))}
          {eqExamples.map(e => (
            <a key={e.id} className="example" href={`#/equity/example/${e.id}`}>
              <strong>{e.name.split(':')[0]}</strong>
              <span className="note">{e.meta}. DCF on management's capital plan and rate base growth from its filings, with a reverse DCF of what the price implies. Matches reported revenue, EBIT and D&A and the C$28.8 billion plan.</span>
            </a>
          ))}
          {!examples.length && <span className="note">Examples appear once they match their published figures.</span>}
        </div>
        <a className="glass side" href="#/portfolio">
          <div className="widget-head"><h3>Portfolio tracker</h3><span className="tag live">Live</span></div>
          <span className="note">Your holdings at daily closing prices, saved in your browser only.</span>
        </a>
      </div>
      {market.data && <Source />}
    </>
  );
}

function InfraPicker() {
  return (
    <>
      <h1>Value infrastructure</h1>
      <p className="lede">Choose an asset class. Each one opens a model loaded with a real project's public figures that you can change.</p>
      <div className="grid-cards">
        {ASSETS.map(a => a.id ? (
          <a key={a.name} className="card module-card" href={`#/model/${a.id}`}>
            <span><span className="tag live">Live</span></span>
            <strong>{a.name}</strong>
            <span className="note">{LIVE[a.id].blurb}</span>
          </a>
        ) : (
          <div key={a.name} className="card module-card soon" aria-disabled="true">
            <span><span className="tag">In progress</span></span>
            <strong>{a.name}</strong>
            <span className="note">{a.blurb}</span>
          </div>
        ))}
      </div>
    </>
  );
}
