import { useEffect, useId, useState } from 'react';
import { useLab } from '../app/LabContext';
import { TOUCH_VIEWS, type Sim } from '../app/sim';
import { hzFromSlider, sliderFromHz, sliderFromUm, spikeTimes, twoPointTrial, umFromSlider } from '../app/visual';
import {
  DERMATOMES, FIBRES, LANDMARK_DERMATOME, MECHANORECEPTORS, PAIN_ITCH_NOTES, RECEPTORS, RECEPTOR_IDS, THERMO_TRPS, TWO_POINT_THRESHOLD_MM,
  activeTrpChannels, getDermatome, meanVelocityMs, mostSensitiveReceptor, painArrivalMs, sitesByAcuity, stepResponseSeries, thermalSensation,
  twoPointProbability, vibrationResponse, vibrationThresholdUm, type BodySiteId, type LandmarkId, type MechanoreceptorId,
} from '../skin/sensation';
import { MAX_RATE_HZ, PRESS, thresholdColour, touchAnim } from '../viewer/ModeScenes';
import { prefersReducedMotion } from '../viewer/webgl';
import { PanelHead, Radios, Readout, Slider, SourcesLine } from './widgets';
import { Approx, Meter } from './SkinWidgets';

const RC: Record<string, string> = { 'meissner-corpuscle': '#e0485f', 'merkel-discs': '#e0a020', 'pacinian-corpuscle': '#3f74e0', 'ruffini-ending': '#2fae7a', 'hair-follicle-plexus': '#8a5ad0', 'free-nerve-endings': '#7a8a96' };
const SHORT: Record<string, string> = { 'meissner-corpuscle': 'Meissner', 'merkel-discs': 'Merkel', 'pacinian-corpuscle': 'Pacinian', 'ruffini-ending': 'Ruffini', 'hair-follicle-plexus': 'Hair', 'free-nerve-endings': 'Free endings' };
const SITE_LABEL = (s: string) => s.replace('-', ' ').replace(/^./, (c) => c.toUpperCase());
const fmtHz = (f: number) => (f < 10 ? f.toFixed(1) : String(Math.round(f)));

function ReceptorsView() {
  const { state, dispatch } = useLab();
  const r = RECEPTORS[state.sim.receptor];
  return (
    <>
      <p className="small">Click a receptor in the block (or below). The tissue is see-through so the endings show at their true depths.</p>
      <div className="seg-toggle wrap receptor-pick" role="radiogroup" aria-label="Receptor">
        {RECEPTOR_IDS.map((id) => <button key={id} type="button" role="radio" aria-checked={state.sim.receptor === id} onClick={() => dispatch({ type: 'set-sim', patch: { receptor: id } })}>{SHORT[id]}</button>)}
      </div>
      <div className="receptor-card" data-receptor={r.id} style={{ borderInlineStartColor: RC[r.id] }}>
        <h3 className="group-title">{r.label}</h3>
        <p className="small">{r.modality}.</p>
        <Readout rows={[
          { label: 'Unit type', value: r.unitType },
          { label: 'Adaptation', value: { RA: 'Rapid (signals change)', SA: 'Slow (signals pressure held)', mixed: 'Mixed' }[r.adaptation] },
          { label: 'Best stimulus', value: r.bestStimulus },
          { label: <>Receptive field <Approx /></>, value: `${r.receptiveField}, ${r.receptiveFieldMm[0]}–${r.receptiveFieldMm[1]} mm` },
          { label: 'Where', value: r.depth },
          { label: 'Fibre', value: `${r.fibre.join(', ')} · ${r.fibre.map((f) => `${FIBRES[f].velocityMs[0]}–${FIBRES[f].velocityMs[1]} m/s`).join(', ')}` },
          ...(r.densityPerCm2 ? [{ label: <>Density, fingertip / palm <Approx note="Johansson & Vallbo (1979); values approximate." /></>, value: `${r.densityPerCm2.fingertip} / ${r.densityPerCm2.palm} per cm²` }] : []),
          ...(r.handSharePct ? [{ label: 'Share of hand units', value: `${r.handSharePct} %` }] : []),
          ...(r.vibrationHz ? [{ label: 'Vibration band', value: `${r.vibrationHz.band[0]}–${r.vibrationHz.band[1]} Hz, best ≈ ${r.vibrationHz.best} Hz` }] : []),
        ]} />
      </div>
    </>
  );
}

/** Threshold (µm) against frequency on log–log axes for the four mechanoreceptors, with the stimulus. */
function TuningChart({ freq, amp }: { freq: number; amp: number }) {
  const W = 300, H = 150, x0 = 36, x1 = 292, y0 = 10, y1 = 126;
  const sx = (f: number) => x0 + (Math.log10(f) / 3) * (x1 - x0);
  const sy = (um: number) => y1 - ((Math.log10(Math.min(1000, Math.max(0.01, um))) + 2) / 5) * (y1 - y0);
  return (
    <svg className="chart tuning" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Vibration threshold against frequency for the four mechanoreceptors: Meissner lowest near 30 Hz, Pacinian lowest near 250 Hz.">
      {[0.01, 0.1, 1, 10, 100, 1000].map((v) => <g key={v}><line x1={x0} x2={x1} y1={sy(v)} y2={sy(v)} stroke="currentColor" strokeOpacity={0.1} /><text x={x0 - 4} y={sy(v) + 3} fontSize="9" textAnchor="end" fill="currentColor" opacity={0.8}>{v}</text></g>)}
      {[1, 10, 100, 1000].map((f) => <text key={f} x={sx(f)} y={H - 10} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.8}>{f}</text>)}
      <text x={x0 + 4} y={8} fontSize="9" fill="currentColor" opacity={0.7}>threshold, µm (the dip = most sensitive)</text>
      <text x={x1} y={H - 1} fontSize="9" textAnchor="end" fill="currentColor" opacity={0.7}>Hz</text>
      {MECHANORECEPTORS.map((r) => {
        const d = Array.from({ length: 61 }, (_, i) => { const f = 10 ** (i / 20); return `${i ? 'L' : 'M'} ${sx(f).toFixed(1)} ${sy(vibrationThresholdUm(r, f)).toFixed(1)}`; }).join(' ');
        return <path key={r} d={d} fill="none" stroke={RC[r]} strokeWidth={1.8} />;
      })}
      <line x1={x0} x2={x1} y1={sy(amp)} y2={sy(amp)} stroke="currentColor" strokeDasharray="4 3" strokeOpacity={0.6} />
      <circle cx={sx(freq)} cy={sy(amp)} r={4} fill="#18232c" />
    </svg>
  );
}

function VibrationView() {
  const { state, dispatch } = useLab();
  const { vibHz: f, vibUm: a } = state.sim;
  const set = (patch: Partial<Sim>) => dispatch({ type: 'set-sim', patch });
  const best = mostSensitiveReceptor(f);
  return (
    <>
      <p className="small">A probe vibrates the fingertip. Each receptor has a V-shaped tuning curve: Meissner corpuscles feel flutter best near 30 Hz, Pacinian corpuscles the buzz of 200–300 Hz. Active receptors pulse in the block.</p>
      <div className="seg-toggle wrap presets vib-presets" role="group" aria-label="Frequencies">
        {[{ f: 3, t: '3 Hz press' }, { f: 30, t: '30 Hz flutter' }, { f: 250, t: '250 Hz buzz' }].map((p) => <button key={p.f} type="button" aria-pressed={Math.round(f) === p.f} onClick={() => set({ vibHz: p.f })}>{p.t}</button>)}
      </div>
      <Slider label="Frequency" min={0} max={1000} step={1} value={sliderFromHz(f)} onChange={(v) => set({ vibHz: hzFromSlider(v) })} display={<span data-hz={Math.round(f)}>{fmtHz(f)} Hz</span>} valueText={`${fmtHz(f)} hertz`} />
      <Slider label="Amplitude" min={0} max={1000} step={1} value={sliderFromUm(a)} onChange={(v) => set({ vibUm: umFromSlider(v) })} display={`${a < 1 ? a.toFixed(2) : a < 10 ? a.toFixed(1) : Math.round(a)} µm`} />
      <TuningChart freq={f} amp={a} />
      <p className="muted small">Curves after Bolanowski et al. (1988) <Approx note="Tuning-curve shapes and thresholds are approximate, for teaching." /></p>
      <div className="fire-pairs">
        {MECHANORECEPTORS.map((r) => { const v = vibrationResponse(r, f, a); return <Meter key={r} label={SHORT[r]!} value={v} colour={RC[r]!} text={`${Math.round(v * 100)}`} data={{ response: r, value: v.toFixed(2) }} />; })}
      </div>
      <Readout rows={[{ label: 'Most sensitive here', value: <span data-best={best}>{RECEPTORS[best].label}</span> }]} />
    </>
  );
}

/** Spike rasters for a pressure step: rapidly adapting units fire at on and off, slowly adapting ones throughout. */
function PressureView() {
  const [t, setT] = useState<number | null>(null);
  const press = () => {
    touchAnim.pressAt = performance.now();
    if (prefersReducedMotion()) { setT(PRESS.durationMs); return; }
    const start = performance.now();
    const tick = () => { const e = performance.now() - start; setT(Math.min(PRESS.durationMs, e)); if (e < PRESS.durationMs) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  const rows = ['meissner-corpuscle', 'pacinian-corpuscle', 'hair-follicle-plexus', 'merkel-discs', 'ruffini-ending'] as const;
  const W = 300, x0 = 70, x1 = 292, row = 20, top = 26;
  const sx = (ms: number) => x0 + (ms / PRESS.durationMs) * (x1 - x0);
  const H = top + rows.length * row + 18;
  return (
    <>
      <p className="small">A probe presses the skin for half a second. Rapidly adapting units (RA) signal only the change — on and off; slowly adapting units (SA) keep firing while the pressure lasts.</p>
      <button type="button" className="primary small-button press-button" onClick={press}>Press the probe</button>
      <svg className="chart raster" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spike rasters: Meissner, Pacinian and hair units fire at the onset and offset; Merkel and Ruffini units fire throughout the press.">
        <path d={`M ${x0} 18 L ${sx(PRESS.onMs)} 18 L ${sx(PRESS.onMs) + 4} 6 L ${sx(PRESS.offMs)} 6 L ${sx(PRESS.offMs) + 4} 18 L ${x1} 18`} fill="none" stroke="currentColor" strokeWidth={1.5} />
        <text x={0} y={16} fontSize="9.5" fill="currentColor" opacity={0.8}>Pressure</text>
        {rows.map((r, i) => {
          const y = top + i * row;
          const spikes = spikeTimes(stepResponseSeries(r, PRESS.durationMs, 2, PRESS), MAX_RATE_HZ[r] ?? 150, i + 3);
          return (
            <g key={r} data-raster={r} data-spikes={spikes.length}>
              <text x={0} y={y + 12} fontSize="9.5" fill="currentColor">{SHORT[r]} <tspan opacity={0.6}>{r === 'merkel-discs' || r === 'ruffini-ending' ? 'SA' : 'RA'}</tspan></text>
              {spikes.map((s, k) => <line key={k} x1={sx(s)} x2={sx(s)} y1={y + 2} y2={y + 15} stroke={RC[r]} strokeWidth={1.2} opacity={t === null || s <= t ? 1 : 0.15} />)}
            </g>
          );
        })}
        {[0, 500, 1000].map((ms) => <text key={ms} x={sx(ms)} y={H - 3} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.7}>{ms} ms</text>)}
        {t !== null && t < PRESS.durationMs && <line x1={sx(t)} x2={sx(t)} y1={4} y2={H - 14} stroke="currentColor" strokeWidth={1.2} />}
      </svg>
      <p className="muted small">Time constants after Kandel 6e fig. 19-4 <Approx />. RA units tell the brain an object is slipping; SA units report its shape and weight.</p>
    </>
  );
}

function TwoPointView() {
  const { state, dispatch } = useLab();
  const { site, separationMm: sep } = state.sim;
  const [trials, setTrials] = useState<{ site: BodySiteId; sep: number; two: boolean }[]>([]);
  const [n, setN] = useState(1);
  const th = TWO_POINT_THRESHOLD_MM[site];
  const p = twoPointProbability(site, sep);
  const last = trials[0];
  const here = trials.filter((x) => x.site === site && Math.abs(x.sep - sep) < 0.01);
  const touch = () => { const two = twoPointTrial(site, sep, n); setN(n + 1); setTrials([{ site, sep, two }, ...trials].slice(0, 60)); };
  const sorted = sitesByAcuity();
  const maxTh = 46;
  return (
    <>
      <p className="small">Tap a site on the body, set the gap between the two points, and touch. Can the person tell two points from one? Try to find the gap where they say "two" half the time.</p>
      <label className="select-field small">Site
        <select value={site} onChange={(e) => dispatch({ type: 'set-sim', patch: { site: e.target.value as BodySiteId } })} aria-label="Site">
          {sorted.map((s) => <option key={s} value={s}>{SITE_LABEL(s)}</option>)}
        </select>
      </label>
      <Slider label="Gap between the points" min={0.5} max={60} step={0.5} value={sep} onChange={(v) => dispatch({ type: 'set-sim', patch: { separationMm: v } })} display={`${sep} mm`} />
      <div className="row">
        <button type="button" className="primary small-button touch-button" onClick={touch}>Touch</button>
        {last && <span className="small trial-result" data-two={String(last.two)} aria-live="polite"><strong>{last.two ? '“Two points”' : '“One point”'}</strong> at {last.sep} mm on the {SITE_LABEL(last.site).toLowerCase()}</span>}
      </div>
      <Readout rows={[
        { label: <>Threshold here <Approx note="Weinstein (1968), read from his figure; ±1–2 mm on fingers, ±5 mm elsewhere." /></>, value: <span data-threshold={th}>{th} mm</span> },
        { label: 'Chance of “two”', value: <span data-p={p.toFixed(2)}>{Math.round(p * 100)} %</span> },
        { label: 'Your trials at this gap', value: here.length ? `${here.filter((x) => x.two).length} “two” of ${here.length}` : '—' },
      ]} />
      <h3 className="group-title">Thresholds across the body</h3>
      <svg className="chart threshold-map" viewBox={`0 0 300 ${sorted.length * 12 + 6}`} role="img" aria-label="Two-point thresholds from fingertip (2.5 mm) to calf (45 mm).">
        {sorted.map((s, i) => {
          const v = TWO_POINT_THRESHOLD_MM[s];
          return (
            <g key={s} opacity={s === site ? 1 : 0.8}>
              <text x={64} y={i * 12 + 11} fontSize="9" textAnchor="end" fill="currentColor" fontWeight={s === site ? 700 : 400}>{SITE_LABEL(s)}</text>
              <rect x={68} y={i * 12 + 3} width={(v / maxTh) * 200} height={9} rx={2} fill={thresholdColour(v)} />
              <text x={72 + (v / maxTh) * 200} y={i * 12 + 11} fontSize="9" fill="currentColor">{v}</text>
            </g>
          );
        })}
      </svg>
      <p className="muted small">The gradient follows the density of Merkel and Meissner units and the size of the body part's map in the somatosensory cortex, not skin area.</p>
    </>
  );
}

function DermatomesView() {
  const { state, dispatch } = useLab();
  const d = state.sim.dermatome ? getDermatome(state.sim.dermatome) : null;
  const landmarks = Object.keys(LANDMARK_DERMATOME) as LandmarkId[];
  return (
    <>
      <p className="small">Tap the body to name the dermatome there, or pick a landmark. Each dorsal root supplies one strip; the face is the trigeminal nerve (CN V), not a spinal dermatome.</p>
      <label className="select-field small">Landmark
        <select aria-label="Landmark" value={state.sim.landmark ?? ''} onChange={(e) => dispatch({ type: 'set-sim', patch: { landmark: (e.target.value || null) as never } })}>
          <option value="">—</option>
          {landmarks.map((l) => <option key={l} value={l}>{l.replace(/-/g, ' ')} → {LANDMARK_DERMATOME[l]}</option>)}
        </select>
      </label>
      {d ? (
        <div className="dermatome-card" data-dermatome={d.id}>
          <h3 className="group-title">{d.id} · {d.region}</h3>
          <Readout rows={[{ label: 'Area', value: d.area }, { label: 'Key sensory point (ISNCSCI)', value: d.keyPoint }]} />
          <p className="muted small">Landmarks: {landmarks.filter((l) => LANDMARK_DERMATOME[l] === d.id).map((l) => l.replace(/-/g, ' ')).join(', ') || '—'}.</p>
        </div>
      ) : <p className="small muted dermatome-card" data-dermatome="none">No level picked yet.</p>}
      <div className="seg-toggle wrap presets" role="group" aria-label="Classic levels">
        {(['C6', 'C7', 'T4', 'T10', 'L4', 'S1'] as const).map((l) => <button key={l} type="button" aria-pressed={d?.id === l} onClick={() => dispatch({ type: 'set-sim', patch: { dermatome: l, landmark: null } })}>{l}</button>)}
      </div>
      <p className="muted small">Overlap: neighbouring dermatomes overlap by up to half their width, so cutting one dorsal root numbs little skin, while shingles (one ganglion) draws a single band. Map after Lee et al. (2008) and Keegan & Garrett (1948); boundaries on this body are approximate and vary between people. {DERMATOMES.length} levels, C2–S5.</p>
    </>
  );
}

/** A thermometer with the thermosensitive TRP channels' ranges. */
function Thermometer({ t }: { t: number }) {
  const W = 300, x0 = 46, x1 = 292, sx = (c: number) => x0 + (Math.min(55, Math.max(0, c)) / 55) * (x1 - x0);
  const grad = 'url(#thermo-grad)';
  return (
    <svg className="chart thermometer" viewBox={`0 0 ${W} ${36 + THERMO_TRPS.length * 11}`} role="img" aria-label={`Skin at ${t} degrees; active channels: ${activeTrpChannels(t).join(', ') || 'none'}.`}>
      <defs><linearGradient id="thermo-grad" x1="0" x2="1"><stop offset="0" stopColor="#2f6fd6" /><stop offset="0.55" stopColor="#e8e2dc" /><stop offset="0.75" stopColor="#f0a040" /><stop offset="1" stopColor="#d2302a" /></linearGradient></defs>
      <rect x={x0} y={4} width={x1 - x0} height={10} rx={5} fill={grad} />
      <path d={`M ${sx(t)} 16 l -5 8 h 10 z`} fill="#18232c" />
      {[0, 10, 20, 30, 40, 50].map((c) => <text key={c} x={sx(c)} y={34} fontSize="8.6" textAnchor="middle" fill="currentColor" opacity={0.7}>{c}</text>)}
      {THERMO_TRPS.map((c, i) => {
        const on = activeTrpChannels(t).includes(c.id);
        const y = 40 + i * 11;
        return (
          <g key={c.id} opacity={on ? 1 : 0.4}>
            <text x={0} y={y + 7} fontSize="8.8" fill="currentColor" fontWeight={on ? 700 : 400}>{c.id}</text>
            <rect x={sx(Math.max(0, c.rangeC[0]))} y={y} width={sx(Math.min(55, c.rangeC[1])) - sx(Math.max(0, c.rangeC[0]))} height={8} rx={3} fill={c.rangeC[0] < 30 ? '#3f74e0' : '#e0583a'} />
          </g>
        );
      })}
    </svg>
  );
}

/** First (Aδ) and second (C) pain racing from the toe to the spinal cord. */
function PainRace({ distanceM }: { distanceM: number }) {
  const times = painArrivalMs(distanceM);
  const [t, setT] = useState<number | null>(null);
  const SLOW = 1.5; // shown 1.5× slower than real time
  const go = () => {
    if (prefersReducedMotion()) { setT(times.secondPainMs); return; }
    const start = performance.now();
    const tick = () => { const e = (performance.now() - start) / SLOW; setT(Math.min(times.secondPainMs, e)); if (e < times.secondPainMs) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  useEffect(() => setT(null), [distanceM]);
  const W = 300, x0 = 20, x1 = 280;
  const pos = (ms: number) => x0 + Math.min(1, (t ?? 0) / ms) * (x1 - x0);
  return (
    <>
      <button type="button" className="secondary small-button" onClick={go}>Stub a toe ▶</button>
      <svg className="chart pain-race" viewBox={`0 0 ${W} 58`} role="img" aria-label={`First pain arrives after ${Math.round(times.firstPainMs)} ms, second pain after ${Math.round(times.secondPainMs)} ms.`}>
        <line x1={x0} x2={x1} y1={20} y2={20} stroke="#f0cc70" strokeWidth={4} strokeLinecap="round" />
        <line x1={x0} x2={x1} y1={40} y2={40} stroke="#f0cc70" strokeWidth={2} strokeLinecap="round" />
        <text x={x0} y={12} fontSize="9" fill="currentColor">Toe</text>
        <text x={x1} y={12} fontSize="9" textAnchor="end" fill="currentColor">Spinal cord</text>
        <circle cx={pos(times.firstPainMs)} cy={20} r={5} fill="#e0485f" />
        <circle cx={pos(times.secondPainMs)} cy={40} r={5} fill="#8a5ad0" />
        <text x={x0} y={55} fontSize="8.8" fill="currentColor" opacity={0.8}>{t === null ? 'Aδ (top) and C (bottom) fibres' : `${Math.round(t)} ms`}</text>
      </svg>
    </>
  );
}

function ThermalView() {
  const { state, dispatch } = useLab();
  const { thermalC: t, painM } = state.sim;
  const s = thermalSensation(t);
  const times = painArrivalMs(painM);
  const LABEL: Record<string, string> = { 'noxious-cold': 'Painful cold', cold: 'Cold', cool: 'Cool', neutral: 'Neutral', warm: 'Warm', hot: 'Hot', 'heat-pain': 'Burning heat pain' };
  return (
    <>
      <p className="small">Hold a probe on the skin. Free nerve endings carry temperature through TRP channels: TRPM8 (menthol) for cool, TRPV1 (capsaicin) for heat above about 43 °C.</p>
      <Slider label="Probe temperature" min={0} max={55} step={1} value={t} onChange={(v) => dispatch({ type: 'set-sim', patch: { thermalC: v } })} display={`${t} °C`} />
      <Thermometer t={t} />
      <Readout rows={[
        { label: <>Feels <Approx note="Static sensation bands after Kandel 6e; adaptation shifts them." /></>, value: <span data-sensation={s}>{LABEL[s]}</span>, tone: s === 'heat-pain' || s === 'noxious-cold' ? 'bad' : undefined },
        { label: 'Channels open', value: activeTrpChannels(t).join(', ') || 'none (adapted)' },
      ]} />
      <h3 className="group-title">First and second pain</h3>
      <Slider label="Distance to the spinal cord" min={0.1} max={1.5} step={0.05} value={painM} onChange={(v) => dispatch({ type: 'set-sim', patch: { painM: v } })} display={`${painM.toFixed(2)} m`} />
      <PainRace distanceM={painM} />
      <Readout rows={[
        { label: 'First pain (Aδ, ≈ 20 m/s)', value: <span data-first={Math.round(times.firstPainMs)}>{Math.round(times.firstPainMs)} ms</span> },
        { label: 'Second pain (C, ≈ 1 m/s)', value: <span data-second={Math.round(times.secondPainMs)}>{Math.round(times.secondPainMs)} ms</span> },
        { label: 'Gap', value: `${(times.gapMs / 1000).toFixed(2)} s` },
      ]} />
      <p className="muted small">{PAIN_ITCH_NOTES.firstSecondPain} Mean Aβ velocity ≈ {meanVelocityMs('Aβ')} m/s for comparison. Velocities approximate.</p>
      <details className="more"><summary>Itch, sensitisation and gate control</summary>
        <p className="small">{PAIN_ITCH_NOTES.sensitisation}</p><p className="small">{PAIN_ITCH_NOTES.itch}</p><p className="small">{PAIN_ITCH_NOTES.gateControl}</p>
      </details>
    </>
  );
}

/** Touch: receptors, vibration, pressure, two-point discrimination, dermatomes, heat and pain. */
export function TouchPanel() {
  const { state, dispatch } = useLab();
  const id = useId();
  const tv = state.sim.touchView;
  const TITLE: Record<string, string> = { receptors: 'Four receptors, four features', vibration: 'Tuned to vibration', pressure: 'Rapid and slow adaptation', 'two-point': 'Two-point discrimination', dermatomes: 'Dermatomes', thermal: 'Temperature and pain' };
  return (
    <section className="sheet mode-panel touch-panel" aria-labelledby={`${id}-title`}>
      <PanelHead id={`${id}-title`} eyebrow="Touch" title={TITLE[tv]!} />
      <Radios label="Topic" className="sub-tabs" options={TOUCH_VIEWS} value={tv} onChange={(v) => dispatch({ type: 'set-sim', patch: { touchView: v } })} />
      {tv === 'receptors' && <ReceptorsView />}
      {tv === 'vibration' && <VibrationView />}
      {tv === 'pressure' && <PressureView />}
      {tv === 'two-point' && <TwoPointView />}
      {tv === 'dermatomes' && <DermatomesView />}
      {tv === 'thermal' && <ThermalView />}
      <SourcesLine items={['Kandel et al. 2021 ch. 19–20', 'Johansson & Vallbo 1979', 'Weinstein 1968', 'Bolanowski et al. 1988', 'ASIA ISNCSCI 2019', 'Lee et al. 2008; Keegan & Garrett 1948', 'Caterina 1997; McKemy 2002']} />
    </section>
  );
}

export type { MechanoreceptorId };
