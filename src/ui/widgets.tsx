import { useId, type ReactNode } from 'react';
import { useLab } from '../app/LabContext';
import type { Route } from '../contract/schema';

/** Pause or resume the animations. */
export function PlayButton() {
  const { state, dispatch } = useLab();
  return (
    <button type="button" className="secondary small-button" onClick={() => dispatch({ type: 'set-playing', value: !state.playing })} aria-pressed={!state.playing}>
      {state.playing ? 'Pause' : 'Play'}
    </button>
  );
}

/** A row of mutually exclusive choices (radio semantics). */
export function Radios<T extends string | number>({ label, options, value, onChange, className = '' }: {
  label: string; options: readonly { id: T; label: string; title?: string }[]; value: T; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div className={`seg-toggle wrap ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" role="radio" aria-checked={value === o.id} title={o.title} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/** A labelled range slider with its value shown beside it. */
export function Slider({ label, min, max, step, value, onChange, display, valueText }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; display: ReactNode; valueText?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={valueText} onChange={(e) => onChange(Number(e.target.value))} />
      <output htmlFor={id}>{display}</output>
    </div>
  );
}

/** Label–value rows. */
export function Readout({ rows }: { rows: { label: ReactNode; value: ReactNode; tone?: 'ok' | 'warn' | 'bad'; data?: Record<string, string> }[] }) {
  return (
    <dl className="readout" aria-live="polite">
      {rows.map((r, i) => (
        <div key={i}>
          <dt>{r.label}</dt>
          <dd className={r.tone} {...Object.fromEntries(Object.entries(r.data ?? {}).map(([k, v]) => [`data-${k}`, v]))}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A panel's title row. */
export function PanelHead({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <>
      <p className="eyebrow">{eyebrow}</p>
      <div className="detail-head"><h2 id={id} className="panel-title">{title}</h2>{children}</div>
    </>
  );
}

/** A route as a numbered list of stages; on-model stages select their structure. */
export function RouteSteps({ route, colour }: { route: Route; colour: string }) {
  const { state, dispatch } = useLab();
  return (
    <ol className="flow-steps">
      {route.steps.map((st, i) => (
        <li key={i}>
          <span className="dot" aria-hidden="true" style={{ background: colour }} />
          {st.structure ? (
            <button type="button" className="link" aria-pressed={state.selected === st.structure} onClick={() => dispatch({ type: 'select', id: st.structure! })}>{st.label}</button>
          ) : (
            <span className="offmodel">{st.label} <span className="tag">not on model</span></span>
          )}
          {st.note && <span className="muted small block">{st.note}</span>}
        </li>
      ))}
    </ol>
  );
}

/** Sources for a panel, in one muted line. */
export function SourcesLine({ items }: { items: string[] }) {
  return <p className="muted small sources-line"><strong>Sources:</strong> {items.join('; ')}.</p>;
}
