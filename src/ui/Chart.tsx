export interface Series { label: string; colour: string; values: readonly number[]; dashed?: boolean; width?: number }

/**
 * A small line chart (SVG, after the muscular lab's): a y axis with ticks, an optional reference
 * band, a cursor and event marks. The figure is described by `label` for screen readers.
 */
export function LineChart({ series, xMax, xTicks, y, band, cursor, marks, label, height = 120, className = '' }: {
  series: Series[];
  /** The x value of the last sample (the first is 0). */
  xMax: number;
  xTicks: { at: number; text: string }[];
  y: { min: number; max: number; ticks: number[]; unit: string };
  band?: { from: number; to: number; text?: string };
  cursor?: number;
  marks?: { at: number; text: string }[];
  label: string;
  height?: number;
  className?: string;
}) {
  const W = 300, H = height, x0 = 34, x1 = W - 8, y0 = 12, y1 = H - 18;
  const sx = (x: number) => x0 + (x / xMax) * (x1 - x0);
  const sy = (v: number) => y1 - Math.max(0, Math.min(1, (v - y.min) / (y.max - y.min))) * (y1 - y0);
  return (
    <svg className={`chart ${className}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {band && <rect x={x0} width={x1 - x0} y={sy(band.to)} height={Math.max(1, sy(band.from) - sy(band.to))} fill="currentColor" opacity={0.07} />}
      {band?.text && <text x={x1 - 3} y={sy(band.to) + 9} fontSize="8.8" textAnchor="end" fill="currentColor" opacity={0.65}>{band.text}</text>}
      {y.ticks.map((v) => (
        <g key={v}>
          <line x1={x0} x2={x1} y1={sy(v)} y2={sy(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.3 : 0.1} />
          <text x={x0 - 4} y={sy(v) + 3} fontSize="9.2" textAnchor="end" fill="currentColor" opacity={0.8}>{v}</text>
        </g>
      ))}
      <text x={x0} y={8} fontSize="9.2" fill="currentColor" opacity={0.7}>{y.unit}</text>
      {xTicks.map((t) => <text key={t.at} x={sx(t.at)} y={H - 5} fontSize="9.2" textAnchor="middle" fill="currentColor" opacity={0.8}>{t.text}</text>)}
      {marks?.map((m) => (
        <g key={`${m.at}-${m.text}`}>
          <line x1={sx(m.at)} x2={sx(m.at)} y1={y0} y2={y1} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="2 2" />
          <text x={sx(m.at) + 3} y={y0 + 8} fontSize="8.8" fill="currentColor" opacity={0.8}>{m.text}</text>
        </g>
      ))}
      {series.map((s) => {
        const n = s.values.length;
        const d = s.values.map((v, i) => `${i ? 'L' : 'M'} ${sx((i / Math.max(1, n - 1)) * xMax).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ');
        return <path key={s.label} d={d} fill="none" stroke={s.colour} strokeWidth={s.width ?? 1.7} strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinejoin="round" />;
      })}
      {cursor !== undefined && <line className="chart-cursor" x1={sx(cursor)} x2={sx(cursor)} y1={y0} y2={y1} stroke="currentColor" strokeWidth={1.2} />}
    </svg>
  );
}

/** A colour key: a swatch and a name for each entry. */
export function Legend({ items }: { items: { label: string; colour: string; dashed?: boolean }[] }) {
  return (
    <p className="legend-row small">
      {items.map((i) => (
        <span key={i.label}>
          <span className={`key-line${i.dashed ? ' dashed' : ''}`} aria-hidden="true" style={{ borderColor: i.colour }} /> {i.label}
        </span>
      ))}
    </p>
  );
}
