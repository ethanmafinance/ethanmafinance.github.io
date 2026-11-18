// Plain SVG charts: thin marks, one y-axis per chart, hover tooltips, legend for 2+ series.
import { useRef, useState, type ReactNode } from 'react';

export type Series = { name: string; values: (number | null)[]; color: string };
type Ref = { label: string; value: number };

const W = 640, H = 240, L = 48, R = 12, T = 10, B = 26;

function scale(min: number, max: number) {
  if (min === max) { min -= 1; max += 1; }
  const step = niceStep((max - min) / 4);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks, y: (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo)) };
}
function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw || 1)), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function Frame({ xs, s, fmt, children, onHover, hover, tip }: {
  xs: (number | string)[]; s: ReturnType<typeof scale>; fmt: (v: number) => string; children: ReactNode;
  onHover: (k: number | null) => void; hover: number | null; tip: ReactNode;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const bw = (W - L - R) / xs.length;
  const x = (k: number) => L + bw * (k + 0.5);
  const every = Math.ceil(xs.length / 8);
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const k = Math.floor((px - L) / bw);
    onHover(k >= 0 && k < xs.length ? k : null);
  };
  return (
    <div className="chart" style={{ position: 'relative' }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} onPointerMove={move} onPointerLeave={() => onHover(null)} role="img">
        <g className="axis">
          {s.ticks.map(t => (
            <g key={t}>
              <line className={t === 0 ? 'zero' : 'gridline'} x1={L} x2={W - R} y1={s.y(t)} y2={s.y(t)} />
              <text x={L - 6} y={s.y(t) + 4} textAnchor="end">{fmt(t)}</text>
            </g>
          ))}
          {xs.map((v, k) => (k % every === 0 ? <text key={k} x={x(k)} y={H - 8} textAnchor="middle">{v}</text> : null))}
        </g>
        {hover !== null && <rect x={L + bw * hover} y={T} width={bw} height={H - T - B} fill="var(--surface-2)" />}
        {children}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 0, transform: `translateX(${hover > xs.length / 2 ? '-105%' : '5%'})` }}>
          <b>{xs[hover]}</b>{tip}
        </div>
      )}
    </div>
  );
}

const Legend = ({ series, refs }: { series: Series[]; refs?: Ref[] }) =>
  series.length + (refs?.length ?? 0) > 1 ? (
    <div className="legend">
      {series.map(s => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
      {refs?.map(r => <span key={r.label}><i className="dash" />{r.label}</span>)}
    </div>
  ) : null;

export function LineChart({ xs, series, refs = [], fmt }: { xs: (number | string)[]; series: Series[]; refs?: Ref[]; fmt: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const all = [...series.flatMap(s => s.values.filter((v): v is number => v !== null && Number.isFinite(v))), ...refs.map(r => r.value)];
  const s = scale(Math.min(0, ...all), Math.max(...all));
  const bw = (W - L - R) / xs.length, x = (k: number) => L + bw * (k + 0.5);
  const path = (vals: (number | null)[]) => {
    let d = '', pen = false;
    vals.forEach((v, k) => {
      if (v === null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${s.y(v).toFixed(1)}`; pen = true;
    });
    return d;
  };
  return (
    <>
      <Legend series={series} refs={refs} />
      <Frame xs={xs} s={s} fmt={fmt} hover={hover} onHover={setHover}
        tip={series.map(se => { const v = hover === null ? null : se.values[hover]; return v === null || v === undefined || !Number.isFinite(v) ? null : <div key={se.name}>{se.name}: {fmt(v)}</div>; })}>
        {refs.map(r => <line key={r.label} x1={L} x2={W - R} y1={s.y(r.value)} y2={s.y(r.value)} stroke="var(--ref)" strokeDasharray="4 4" strokeWidth={1.5} />)}
        {series.map(se => <path key={se.name} d={path(se.values)} fill="none" stroke={se.color} strokeWidth={2} strokeLinejoin="round" />)}
        {hover !== null && series.map(se => { const v = se.values[hover]; return v === null || !Number.isFinite(v) ? null : <circle key={se.name} cx={x(hover)} cy={s.y(v)} r={4} fill={se.color} stroke="var(--surface)" strokeWidth={2} />; })}
      </Frame>
    </>
  );
}

export function BarChart({ xs, series, fmt }: { xs: (number | string)[]; series: Series; fmt: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = series.values.map(v => (v === null || !Number.isFinite(v) ? 0 : v));
  const s = scale(Math.min(0, ...vals), Math.max(0, ...vals));
  const bw = (W - L - R) / xs.length, gap = Math.min(2, bw * 0.2);
  return (
    <Frame xs={xs} s={s} fmt={fmt} hover={hover} onHover={setHover} tip={hover === null ? null : <div>{series.name}: {fmt(vals[hover])}</div>}>
      {vals.map((v, k) => {
        const y0 = s.y(0), y1 = s.y(v), h = Math.abs(y1 - y0);
        return h < 0.5 ? null : <rect key={k} x={L + bw * k + gap / 2} y={Math.min(y0, y1)} width={bw - gap} height={h} rx={Math.min(2, (bw - gap) / 2)} fill={series.color} />;
      })}
    </Frame>
  );
}

// Tornado: equity IRR when each input moves down or up; bars start from the base case.
export function Tornado({ rows, base, fmt }: { rows: { label: string; lo: number; hi: number; loLabel: string; hiLabel: string }[]; base: number; fmt: (v: number) => string }) {
  const sorted = [...rows].sort((a, b) => Math.abs(b.hi - b.lo) - Math.abs(a.hi - a.lo));
  const ext = Math.max(1e-9, ...sorted.flatMap(r => [Math.abs(r.lo - base), Math.abs(r.hi - base)]));
  const rowH = 30, LW = 210, PW = 380, w = LW + PW + 20, h = sorted.length * rowH + 20;
  const x = (v: number) => LW + PW / 2 + ((v - base) / ext) * (PW / 2 - 50);
  return (
    <>
      <div className="legend"><span><i style={{ background: 'var(--series-1)' }} />Input lower</span><span><i style={{ background: 'var(--series-2)' }} />Input higher</span></div>
      <div className="chart">
        <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Equity IRR sensitivity">
          <line x1={x(base)} x2={x(base)} y1={0} y2={h - 10} stroke="var(--ref)" strokeDasharray="4 4" />
          {sorted.map((r, k) => {
            const y = 6 + k * rowH;
            const bar = (v: number, color: string, label: string) => {
              const a = x(base), b = x(v);
              return (
                <g>
                  <rect x={Math.min(a, b)} y={y + 4} width={Math.max(1, Math.abs(b - a))} height={rowH - 12} rx={2} fill={color} />
                  <text x={b + (b >= a ? 4 : -4)} y={y + rowH / 2 + 2} textAnchor={b >= a ? 'start' : 'end'} fontSize={11} fill="var(--text-2)">{fmt(v)} <tspan fill="var(--muted)">({label})</tspan></text>
                </g>
              );
            };
            return (
              <g key={r.label}>
                <text x={0} y={y + rowH / 2 + 2} fontSize={12} fill="var(--text)">{r.label}</text>
                {Math.max(Math.abs(r.lo - base), Math.abs(r.hi - base)) < 5e-4
                  ? <text x={x(base) + 6} y={y + rowH / 2 + 2} fontSize={11} fill="var(--muted)">no material change</text>
                  : <>{bar(r.lo, 'var(--series-1)', r.loLabel)}{bar(r.hi, 'var(--series-2)', r.hiLabel)}</>}
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}

// Waterfall: horizontal steps from the first total to the last; steps are signed amounts, totals restart from zero.
export function Waterfall({ steps, fmt }: { steps: { label: string; value: number; total?: boolean }[]; fmt: (v: number) => string }) {
  let run = 0;
  const bars = steps.filter(st => st.total || Math.abs(st.value) >= 0.05).map(st => { const a = st.total ? 0 : run, b = st.total ? st.value : run + st.value; run = b; return { ...st, a, b }; });
  const ext = Math.max(1e-9, ...bars.flatMap(b => [Math.abs(b.a), Math.abs(b.b)]));
  const lo = Math.min(0, ...bars.flatMap(b => [b.a, b.b]));
  const rowH = 28, LW = 200, PW = 330, w = LW + PW + 90, h = bars.length * rowH + 8;
  const x = (v: number) => LW + ((v - lo) / (ext - lo)) * PW;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Cash flow waterfall">
        <line x1={x(0)} x2={x(0)} y1={0} y2={h} stroke="var(--ref)" />
        {bars.map((b, k) => {
          const y = 4 + k * rowH, x0 = Math.min(x(b.a), x(b.b)), wd = Math.max(1, Math.abs(x(b.b) - x(b.a)));
          return (
            <g key={b.label}>
              <text x={0} y={y + rowH / 2 + 2} fontSize={12} fill="var(--text)" fontWeight={b.total ? 700 : 400}>{b.label}</text>
              <rect x={x0} y={y + 4} width={wd} height={rowH - 10} rx={2} fill={b.total ? 'var(--series-1)' : b.value < 0 ? 'var(--series-2)' : 'var(--series-3, var(--series-1))'} opacity={b.total ? 1 : 0.85} />
              <text x={x0 + wd + 6} y={y + rowH / 2 + 2} fontSize={11} fill="var(--text-2)">{fmt(b.value)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
