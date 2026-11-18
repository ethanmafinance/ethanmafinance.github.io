// Bank of Canada Valet API (free, no key, sends CORS headers so the browser reads it directly).
// Docs: https://www.bankofcanada.ca/valet/docs
import { useEffect, useState } from 'react';

export const VALET = 'https://www.bankofcanada.ca/valet';
export const DAILY = {
  policy: ['V39079', 'Policy rate (target overnight)'],
  y2: ['BD.CDN.2YR.DQ.YLD', 'GoC 2-year'],
  y5: ['BD.CDN.5YR.DQ.YLD', 'GoC 5-year'],
  y10: ['BD.CDN.10YR.DQ.YLD', 'GoC 10-year'],
  ylong: ['BD.CDN.LONG.DQ.YLD', 'GoC long-term'],
  rrb: ['BD.CDN.RRB.DQ.YLD', 'Real return bond, long-term'],
} as const;
export const MONTHLY = {
  cpi: ['STATIC_TOTALCPICHANGE', 'Total CPI, y/y'],
  trim: ['CPI_TRIM', 'CPI-trim'],
  median: ['CPI_MEDIAN', 'CPI-median'],
} as const;

type Keys<T> = keyof T;
export type Series<K extends string> = { d: string[] } & Record<K, (number | null)[]>;

// Valet returns observations newest first for `recent`; sort oldest first. Missing days become null.
async function get<T extends Record<string, readonly [string, string]>>(map: T, query: string, fill = false): Promise<Series<Keys<T> & string>> {
  const ids = Object.values(map).map(([id]) => id);
  const res = await fetch(`${VALET}/observations/${ids.join(',')}/json?${query}`);
  if (!res.ok) throw new Error(`Bank of Canada returned ${res.status}`);
  const obs: any[] = (await res.json()).observations;
  obs.sort((a, b) => (a.d < b.d ? -1 : 1));
  const out: any = { d: obs.map(o => o.d) };
  for (const [k, [id]] of Object.entries(map)) {
    let prev: number | null = null; // fill: carry the last value over days one series skips (e.g. holidays)
    out[k] = obs.map(o => { const v = parseFloat(o[id]?.v); return Number.isFinite(v) ? (prev = v) : fill ? prev : null; });
  }
  return out;
}

export type Market = { daily: Series<Keys<typeof DAILY> & string>; monthly: Series<Keys<typeof MONTHLY> & string> };

let cache: Promise<Market> | undefined; // one fetch per page load, shared by every widget
export function loadMarket() {
  if (!cache) {
    const start = new Date(Date.now() - 366 * 864e5).toISOString().slice(0, 10);
    cache = Promise.all([get(DAILY, `start_date=${start}`, true), get(MONTHLY, 'recent=25')])
      .then(([daily, monthly]) => ({ daily, monthly }));
    cache.catch(() => { cache = undefined; }); // allow a retry on the next mount
  }
  return cache;
}

export function useMarket() {
  const [state, setState] = useState<{ data?: Market; error?: string }>({});
  useEffect(() => {
    let live = true;
    loadMarket().then(data => live && setState({ data }), e => live && setState({ error: String(e.message ?? e) }));
    return () => { live = false; };
  }, []);
  return state;
}

// Latest non-null value of a series and its date.
export function last(s: { d: string[] }, v: (number | null)[]) {
  for (let k = v.length - 1; k >= 0; k--) if (v[k] !== null) return { v: v[k] as number, d: s.d[k], k };
  return undefined;
}
export function first(s: { d: string[] }, v: (number | null)[]) {
  for (let k = 0; k < v.length; k++) if (v[k] !== null) return { v: v[k] as number, d: s.d[k], k };
  return undefined;
}
