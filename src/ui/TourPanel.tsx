import { useLab } from '../app/LabContext';
import type { StepParams } from '../contract/schema';
import { TEMP_PRESETS, TOUCH_VIEWS } from '../app/sim';

const MODE_NAME: Record<string, string> = { temperature: 'Temperature', wounds: 'Wounds', touch: 'Touch', life: 'Life' };

/** A short description of a step's settings, if any. */
function summary(p: StepParams): string {
  const out: string[] = [];
  if (typeof p.tempPreset === 'string') out.push(TEMP_PRESETS.find((t) => t.id === p.tempPreset)?.label ?? '');
  if (typeof p.woundType === 'string') out.push({ incision: 'sutured incision', graze: 'graze', deep: 'deep wound' }[p.woundType] ?? '');
  if (typeof p.day === 'number') out.push(`day ${p.day}`);
  if (typeof p.burnDepth === 'string') out.push(`${p.burnDepth.replace('-', ' ')} burn`);
  if (typeof p.burnRegions === 'string') out.push('%TBSA on the body');
  if (typeof p.touchView === 'string') out.push(TOUCH_VIEWS.find((t) => t.id === p.touchView)?.label ?? '');
  if (typeof p.vibHz === 'number') out.push(`${p.vibHz} Hz`);
  if (typeof p.site === 'string') out.push(p.site);
  if (typeof p.dermatome === 'string') out.push(p.dermatome);
  if (typeof p.thermalC === 'number') out.push(`${p.thermalC} °C`);
  if (typeof p.phototype === 'string') out.push(`type ${p.phototype}, UVI ${p.uvIndex ?? ''}`);
  if (typeof p.age === 'number') out.push(`age ${p.age}${p.photoaged ? ', sun-exposed' : ''}`);
  return out.filter(Boolean).join(', ');
}

/** Guided tour from the body to the microscope: one step at a time, with progress and navigation. */
export function TourPanel() {
  const { def, state, dispatch } = useLab();
  const step = def.tour[state.tourIndex];
  if (!step) return null;
  const n = def.tour.length;
  const go = (index: number) => dispatch({ type: 'tour-go', index });
  return (
    <section className="sheet tour-panel" aria-labelledby="tour-title">
      <p className="eyebrow">Guided tour · step {state.tourIndex + 1} of {n}</p>
      <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={n} aria-valuenow={state.tourIndex + 1} aria-label="Tour progress">
        <span style={{ inlineSize: `${((state.tourIndex + 1) / n) * 100}%` }} />
      </div>
      <h2 id="tour-title" className="panel-title" aria-live="polite">{step.title}</h2>
      <p>{step.body}</p>
      {step.mode && step.mode !== 'explore' && (
        <div className="row try-row">
          <span className="tag mode-tag">{MODE_NAME[step.mode]}{summary(step.params ?? {}) ? ` · ${summary(step.params ?? {})}` : ''}</span>
          <button type="button" className="secondary small-button" onClick={() => dispatch({ type: 'try-step' })}>Try it yourself →</button>
        </div>
      )}
      <ul className="chips">
        {step.focus.map((f) => {
          const s = def.structures.find((x) => x.id === f);
          return s ? <li key={f}><span className="chip-static">{s.label}</span></li> : null;
        })}
      </ul>
      <div className="row tour-nav">
        <button type="button" className="secondary" onClick={() => go(state.tourIndex - 1)} disabled={state.tourIndex === 0}>← Back</button>
        {state.tourIndex < n - 1 ? (
          <button type="button" className="primary" onClick={() => go(state.tourIndex + 1)}>Next →</button>
        ) : (
          <button type="button" className="primary" onClick={() => dispatch({ type: 'set-mode', mode: 'explore' })}>Finish</button>
        )}
      </div>
      <ol className="tour-index small">
        {def.tour.map((t, i) => (
          <li key={t.id}>
            <button type="button" className="link" aria-current={i === state.tourIndex ? 'step' : undefined} onClick={() => go(i)}>{t.title}</button>
          </li>
        ))}
      </ol>
    </section>
  );
}
