import { DAILY, MONTHLY, VALET, first, last, useMarket, type Market } from '../data/boc.ts';
import { LineChart } from './Charts.tsx';

const pct = (v: number) => `${v.toFixed(2)}%`;
const bp = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)} bp`;
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
const month = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });

export const Source = () => (
  <p className="note">Source: <a href={`${VALET}/docs`} target="_blank" rel="noreferrer">Bank of Canada Valet API</a>, loaded live when the page opens. <a href="https://www.bankofcanada.ca/terms/" target="_blank" rel="noreferrer">Terms</a>.</p>
);

// Compact tiles for the home dashboard.
export function MarketTiles({ data }: { data: Market }) {
  const { daily: dd, monthly: mm } = data;
  const tiles: [string, ReturnType<typeof last>, string][] = [
    ['GoC 10-year', last(dd, dd.y10), 'yield'],
    ['Policy rate', last(dd, dd.policy), 'overnight target'],
    ['CPI inflation', last(mm, mm.cpi), 'y/y'],
  ];
  return (
    <div className="mini-tiles">
      {tiles.map(([l, o, sub]) => (
        <div key={l}><div className="label">{l}</div><div className="value num">{o ? pct(o.v) : 'n/a'}</div><div className="sub">{sub}{o ? `, ${l === 'CPI inflation' ? month(o.d) : short(o.d)}` : ''}</div></div>
      ))}
    </div>
  );
}

export function MarketsPage() {
  const { data, error } = useMarket();
  return (
    <>
      <h1>Market stats</h1>
      <p className="lede">Canadian rates and inflation, the two market inputs that drive infrastructure values most: debt is priced off Government of Canada yields, and contracted revenue and costs are often indexed to CPI.</p>
      {error && <div className="card">Bank of Canada data could not load ({error}). Refresh to try again.</div>}
      {!data && !error && <div className="card note">Loading Bank of Canada data...</div>}
      {data && <MarketBody data={data} />}
    </>
  );
}

function MarketBody({ data }: { data: Market }) {
  const { daily: dd, monthly: mm } = data;
  const keys = Object.keys(DAILY) as (keyof typeof DAILY)[];
  const curveKeys = ['y2', 'y5', 'y10', 'ylong'] as const;
  const be = dd.d.map((_, k) => (dd.ylong[k] !== null && dd.rrb[k] !== null ? +(dd.ylong[k]! - dd.rrb[k]!).toFixed(2) : null));
  const beNow = last(dd, be), beThen = first(dd, be);
  const start = day(dd.d[0]);

  return (
    <div className="results">
      <div className="kpis">
        {keys.map(k => {
          const now = last(dd, dd[k]), then = first(dd, dd[k]);
          return (
            <div className="card kpi" key={k}>
              <div className="label">{DAILY[k][1]}</div>
              <div className="value">{now ? pct(now.v) : 'n/a'}</div>
              <div className="sub">{now && then ? `${bp(now.v - then.v)} since ${start}` : ''}</div>
            </div>
          );
        })}
        <div className="card kpi">
          <div className="label">Break-even inflation</div>
          <div className="value">{beNow ? pct(beNow.v) : 'n/a'}</div>
          <div className="sub">long bond minus real return bond{beNow && beThen ? `; ${bp(beNow.v - beThen.v)}` : ''}</div>
        </div>
        {(Object.keys(MONTHLY) as (keyof typeof MONTHLY)[]).map(k => {
          const now = last(mm, mm[k]);
          return (
            <div className="card kpi" key={k}>
              <div className="label">{MONTHLY[k][1]}</div>
              <div className="value">{now ? pct(now.v) : 'n/a'}</div>
              <div className="sub">{now ? month(now.d) : ''}</div>
            </div>
          );
        })}
      </div>
      <p className="note">Yields as of {day(last(dd, dd.y10)?.d ?? dd.d[dd.d.length - 1])}. Changes are against the first trading day on or after {start}.</p>

      <div className="two">
        <div className="card">
          <h2>Government of Canada yield curve</h2>
          <LineChart xs={['2-year', '5-year', '10-year', 'Long']} fmt={pct} series={[
            { name: `Now`, values: curveKeys.map(k => last(dd, dd[k])?.v ?? null), color: 'var(--series-1)' },
            { name: `${start}`, values: curveKeys.map(k => first(dd, dd[k])?.v ?? null), color: 'var(--series-2)' },
          ]} />
        </div>
        <div className="card">
          <h2>Yields and policy rate, past year</h2>
          <LineChart xs={dd.d} fmt={pct} series={[
            { name: 'GoC 10-year', values: dd.y10, color: 'var(--series-1)' },
            { name: 'Policy rate', values: dd.policy, color: 'var(--series-2)' },
          ]} />
        </div>
        <div className="card">
          <h2>Inflation, past two years</h2>
          <LineChart xs={mm.d.map(month)} fmt={v => `${v.toFixed(1)}%`} refs={[{ label: '2% target', value: 2 }]} series={[
            { name: 'Total CPI, y/y', values: mm.cpi, color: 'var(--series-1)' },
            { name: 'CPI-trim', values: mm.trim, color: 'var(--series-2)' },
          ]} />
        </div>
        <div className="card">
          <h2>Real yield and break-even inflation, past year</h2>
          <LineChart xs={dd.d} fmt={pct} series={[
            { name: 'Real return bond yield', values: dd.rrb, color: 'var(--series-1)' },
            { name: 'Break-even inflation', values: be, color: 'var(--series-2)' },
          ]} />
        </div>
      </div>

      <div className="card prose" style={{ maxWidth: 'none' }}>
        <h2>How the models use these</h2>
        <p>Long-term project debt is usually priced as a Government of Canada yield of similar term plus a credit spread, so a move in the long bond moves the debt rate, the debt a project can carry and the equity return. The real return bond yield is the market's real risk-free rate, which is the hurdle a pension investor compares an inflation-linked asset against. Break-even inflation is a rough market gauge of expected CPI, useful against the indexation assumption in each model.</p>
        <Source />
      </div>
    </div>
  );
}
