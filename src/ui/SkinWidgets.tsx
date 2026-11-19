import type { ReactNode } from 'react';

/** Marks a displayed number as approximate (the science module flags it so; see the sources). */
export function Approx({ note = 'Approximate value: published figures vary; see the sources.' }: { note?: string }) {
  return <span className="approx" title={note} aria-label="approximate">≈ approx.</span>;
}

/** A horizontal stacked bar of signed parts (losses right of zero, gains left), with a key. */
export function StackedBar({ parts, max, unit, label, className = '' }: {
  parts: { label: string; value: number; colour: string }[]; max: number; unit: string; label: string; className?: string;
}) {
  const W = 300, H = 22, x0 = 60, x1 = 292;
  const neg = parts.reduce((n, p) => n + Math.min(0, p.value), 0);
  const scale = (x1 - x0) / Math.max(1, max - Math.min(0, neg));
  const zero = x0 + -Math.min(0, neg) * scale;
  let right = zero, left = zero;
  return (
    <svg className={`stacked ${className}`} viewBox={`0 0 ${W} ${H + 4}`} role="img" aria-label={label}>
      {parts.map((p) => {
        const w = Math.abs(p.value) * scale;
        const x = p.value >= 0 ? right : left - w;
        if (p.value >= 0) right += w; else left -= w;
        return <rect key={p.label} x={x} y={4} width={Math.max(0, w)} height={H - 6} fill={p.colour} opacity={p.value < 0 ? 0.55 : 1}><title>{`${p.label}: ${Math.round(p.value)} ${unit}`}</title></rect>;
      })}
      <line x1={zero} x2={zero} y1={0} y2={H} stroke="currentColor" strokeWidth={1.2} />
      <text x={0} y={H / 2 + 4} fontSize="10" fill="currentColor" opacity={0.85}>{label.split(':')[0]}</text>
    </svg>
  );
}

/** Key for coloured items. */
export function Key({ items }: { items: { label: ReactNode; colour: string }[] }) {
  return (
    <p className="legend-row small">
      {items.map((i, k) => <span key={k}><span className="dot" style={{ background: i.colour }} aria-hidden="true" /> {i.label}</span>)}
    </p>
  );
}

/** A labelled 0–1 bar. */
export function Meter({ label, value, colour, text, data }: { label: string; value: number; colour: string; text: string; data?: Record<string, string> }) {
  return (
    <div className="fire-bar" {...Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]))}>
      <span className="fire-name">{label}</span>
      <span className="fire-track"><span className="fire-fill" style={{ inlineSize: `${Math.max(0, Math.min(1, value)) * 100}%`, background: colour }} /></span>
      <span className="fire-val">{text}</span>
    </div>
  );
}

/** Educational-only notice. */
export function EduNote({ children }: { children: ReactNode }) {
  return <p className="small edu-note" role="note"><strong>Educational only.</strong> {children}</p>;
}
