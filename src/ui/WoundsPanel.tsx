import { useId } from 'react';
import { useLab } from '../app/LabContext';
import { WOUND_VIEWS, type Sim, type TbsaChartId } from '../app/sim';
import { dayFromSlider, formatDay, sliderFromDay, woundFill } from '../app/visual';
import {
  BODY_REGION_IDS, BURN_DEPTHS, HEALING_FACTORS, HEALING_PHASES, WOUND_TYPES, burnTbsa, getBurnDepth, healingDelayFactor, parkland, phaseTiming,
  regionPercents, tensileStrengthPercent, woundStateOnDay, type BodyRegionId, type TbsaChart, type WoundTypeId,
} from '../skin/wounds';
import { BODY_REGIONS } from '../skin/anchors';
import { WOUND_CELLS } from '../viewer/ModeScenes';
import { BURN_COLOURS } from '../viewer/bodyPaint';
import { LineChart } from './Chart';
import { PanelHead, Radios, Readout, Slider, SourcesLine } from './widgets';
import { Approx, EduNote, Meter } from './SkinWidgets';

const PHASE_COLOURS = { haemostasis: '#8a1e2a', inflammation: '#e05a3a', proliferation: '#e0a020', remodelling: '#5a8ad0' } as const;
const QUICK = [{ d: 1 / 24, t: '1 h' }, { d: 1, t: '1 d' }, { d: 3, t: '3 d' }, { d: 7, t: '1 wk' }, { d: 21, t: '3 wk' }, { d: 90, t: '3 mo' }, { d: 365, t: '1 yr' }];

/** The four phases on a log time axis, with today's position. */
function PhaseTimeline({ day, type, k }: { day: number; type: WoundTypeId; k: number }) {
  const W = 300, x0 = 8, x1 = 292, row = 13;
  const sx = (d: number) => x0 + (sliderFromDay(d) / 1000) * (x1 - x0);
  return (
    <svg className="chart phase-timeline" viewBox={`0 0 ${W} ${HEALING_PHASES.length * row + 26}`} role="img" aria-label={`Healing phases on a time line from minutes to two years; now ${formatDay(day)}.`}>
      {HEALING_PHASES.map((ph, i) => {
        const t = phaseTiming(ph, type, k);
        const y = 4 + i * row;
        return (
          <g key={ph.id}>
            <rect x={sx(t.start)} y={y} width={Math.max(3, sx(t.end) - sx(t.start))} height={row - 4} rx={3} fill={PHASE_COLOURS[ph.id]} opacity={0.85} />
            <text x={Math.min(sx(t.start) + 4, 220)} y={y + row - 6.5} fontSize="8.6" fill="#fff" fontWeight={600}>{ph.label.split(' (')[0]}</text>
          </g>
        );
      })}
      {[{ d: 1 / 24, t: '1 h' }, { d: 1, t: '1 d' }, { d: 7, t: '1 wk' }, { d: 30, t: '1 mo' }, { d: 365, t: '1 yr' }].map((m) => (
        <text key={m.t} x={sx(m.d)} y={HEALING_PHASES.length * row + 18} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.75}>{m.t}</text>
      ))}
      <line className="chart-cursor" x1={sx(day)} x2={sx(day)} y1={0} y2={HEALING_PHASES.length * row + 6} stroke="currentColor" strokeWidth={1.4} />
    </svg>
  );
}

function HealingSection() {
  const { state, dispatch } = useLab();
  const sim = state.sim;
  const set = (patch: Partial<Sim>) => dispatch({ type: 'set-sim', patch });
  const k = healingDelayFactor(sim.factors);
  const st = woundStateOnDay(sim.day, sim.woundType, sim.factors);
  const fill = woundFill(sim.day, sim.woundType, sim.factors);
  const phase = HEALING_PHASES.find((p) => p.id === st.dominantPhase)!;
  const wt = WOUND_TYPES[sim.woundType];
  const curve = Array.from({ length: 51 }, (_, i) => tensileStrengthPercent(dayFromSlider(i * 20), k * (sim.woundType === 'incision' ? 1 : wt.timeScale)));
  const cellNames: Record<string, number> = { platelets: st.cells.platelets, neutrophils: st.cells.neutrophils, macrophages: st.cells.macrophages, fibroblasts: Math.max(st.cells.fibroblasts, st.cells.myofibroblasts), keratinocytes: st.cells.keratinocytes };
  const stage = fill.scar > 0.5 ? 'scar' : fill.epithelium >= 0.999 ? 'closed' : fill.granulation > 0.35 ? 'granulation' : 'clot';
  return (
    <>
      <Radios label="Wound" className="wound-types" options={(Object.keys(WOUND_TYPES) as WoundTypeId[]).map((w) => ({ id: w, label: { incision: 'Sutured incision', graze: 'Graze', deep: 'Deep wound' }[w] }))} value={sim.woundType} onChange={(v) => set({ woundType: v })} />
      <p className="small muted">{wt.description}</p>
      <Slider label="Time since injury" min={0} max={1000} step={1} value={sliderFromDay(sim.day)} onChange={(v) => set({ day: dayFromSlider(v) })} display={<span data-day={sim.day.toFixed(2)}>{formatDay(sim.day)}</span>} valueText={formatDay(sim.day)} />
      <div className="seg-toggle wrap presets" role="group" aria-label="Jump to">
        {QUICK.map((q) => <button key={q.t} type="button" aria-pressed={Math.abs(sim.day - q.d) < q.d * 0.02} onClick={() => set({ day: q.d })}>{q.t}</button>)}
      </div>
      <PhaseTimeline day={sim.day} type={sim.woundType} k={k} />
      <p className="small" data-phase={st.dominantPhase} data-stage={stage} aria-live="polite"><strong style={{ color: PHASE_COLOURS[st.dominantPhase] }}>{phase.label}</strong> · {phase.span}. {phase.events[0]}</p>
      <Readout rows={[
        { label: 'Surface closed', value: <span data-closure={Math.round(st.closurePercent)}>{Math.round(st.closurePercent)} %</span> },
        { label: <>Tensile strength <Approx note="Curve after Levenson et al. (1965) and Robbins 10e; plateau ≈ 70–80 %. Shape approximate." /></>, value: <span data-strength={Math.round(st.tensileStrengthPercent)}>{Math.round(st.tensileStrengthPercent)} % of normal skin</span> },
        { label: 'Delay from factors', value: k > 1 ? `×${k.toFixed(1)} (illustrative)` : 'none', tone: k > 1.5 ? 'warn' : undefined },
      ]} />
      <h3 className="group-title">Cells in the wound <Approx note="Relative abundance after Gurtner et al. (2008), fig. 1; curve shapes approximate." /></h3>
      <div className="fire-pairs cells">
        {WOUND_CELLS.map((c) => <Meter key={c.id} label={c.id} value={cellNames[c.id] ?? 0} colour={c.colour} text={`${Math.round((cellNames[c.id] ?? 0) * 100)}`} />)}
      </div>
      <h3 className="group-title">Tensile strength</h3>
      <LineChart label="Tensile strength of the scar as a percentage of unwounded skin, from day 0 to two years" series={[{ label: 'Strength', colour: '#5a8ad0', values: curve, width: 2 }]} xMax={1000} cursor={sliderFromDay(sim.day)}
        xTicks={[{ at: sliderFromDay(1), text: '1 d' }, { at: sliderFromDay(7), text: '1 wk' }, { at: sliderFromDay(30), text: '1 mo' }, { at: sliderFromDay(365), text: '1 yr' }]} y={{ min: 0, max: 100, ticks: [0, 50, 80, 100], unit: '%' }} band={{ from: 70, to: 80, text: 'plateau' }} height={110} />
      {st.events.length > 0 && <ul className="small events">{st.events.slice(-3).map((e) => <li key={e.day}><strong>{formatDay(Math.max(e.day, 1 / 24) * k)}:</strong> {e.text}</li>)}</ul>}
      <details className="more">
        <summary>Factors that slow healing</summary>
        <div className="factor-list">
          {HEALING_FACTORS.map((f) => (
            <label key={f.id} className="check" title={f.mechanism}>
              <input type="checkbox" checked={sim.factors.includes(f.id)} onChange={(e) => set({ factors: e.target.checked ? [...sim.factors, f.id] : sim.factors.filter((x) => x !== f.id) })} /> {f.label}
            </label>
          ))}
        </div>
        <p className="muted small">The time stretch is illustrative only (product of factor weights, capped at ×4); real effects vary widely.</p>
      </details>
      <details className="more">
        <summary>{phase.label}: events and mediators</summary>
        <ul className="small">{phase.events.map((e) => <li key={e}>{e}</li>)}</ul>
        <p className="small muted">Mediators: {phase.mediators.join(', ')}. Cells: {phase.cells.join(', ')}.</p>
      </details>
      <p className="muted small">{wt.scar} Scar tissue has no hair follicles or sweat glands and a flat dermal–epidermal junction.</p>
    </>
  );
}

const DEPTH_SHORT: Record<string, string> = { superficial: 'Superficial', 'superficial-partial': 'Sup. partial', 'deep-partial': 'Deep partial', 'full-thickness': 'Full', 'fourth-degree': '4th degree' };

function BurnsSection() {
  const { def, state, dispatch } = useLab();
  const sim = state.sim;
  const set = (patch: Partial<Sim>) => dispatch({ type: 'set-sim', patch });
  const depth = getBurnDepth(sim.burnDepth);
  const chart: TbsaChart = sim.chart === 'lund' ? { lundBrowderAgeYears: sim.ageYears } : sim.chart;
  const pct = regionPercents(chart);
  const areas = (Object.entries(sim.burnRegions) as [BodyRegionId, number][]).map(([region, fraction]) => ({ region, fraction, depth: sim.burnDepth }));
  const palms = sim.palmSpots.length / 3;
  const tbsa = burnTbsa(areas, chart, palms ? [{ count: palms, depth: sim.burnDepth }] : []);
  const child = sim.chart === 'child' || (sim.chart === 'lund' && sim.ageYears < 15);
  const pk = parkland(sim.weightKg, tbsa.countedPercent, { child });
  const onBody = state.view === 'body';
  const label = (id: BodyRegionId) => BODY_REGIONS.find((r) => r.id === id)?.label ?? id;
  void def;
  return (
    <>
      <h3 className="group-title">Depth</h3>
      <Radios label="Burn depth" className="burn-depths" options={BURN_DEPTHS.map((b) => ({ id: b.id, label: DEPTH_SHORT[b.id]!, title: b.label }))} value={sim.burnDepth} onChange={(v) => set({ burnDepth: v })} />
      <p className="muted small">Or click a layer in the block: the deepest layer destroyed sets the depth.</p>
      <div className="burn-card" data-depth={depth.id} style={{ borderInlineStartColor: BURN_COLOURS[depth.id] }}>
        <p className="small"><strong>{depth.label}</strong> · degree {depth.degree} · {depth.layers}</p>
        <Readout rows={[
          { label: 'Appearance', value: depth.colour },
          { label: 'Blisters', value: depth.blisters ? 'Yes' : 'No' },
          { label: 'Capillary refill', value: depth.blanching },
          { label: 'Pain', value: depth.pain },
          { label: 'Healing', value: depth.healingDays ? `${depth.healingDays[0]}–${depth.healingDays[1]} days` : 'Will not heal alone' },
          { label: 'Grafting', value: { no: 'Not needed', sometimes: 'Sometimes', yes: 'Needed' }[depth.grafting], tone: depth.grafting === 'yes' ? 'bad' : depth.grafting === 'sometimes' ? 'warn' : 'ok' },
          { label: 'Scarring', value: depth.scarring },
        ]} />
        <p className="muted small">{depth.healing}. Example: {depth.example}.{!depth.countsForTbsa ? ' Superficial burns are left out of %TBSA for fluids.' : ''}</p>
      </div>

      <h3 className="group-title">Area (%TBSA)</h3>
      <div className="row">
        <button type="button" className={onBody ? 'secondary small-button' : 'primary small-button'} onClick={() => dispatch({ type: 'set-view', view: onBody ? 'block' : 'body' })}>{onBody ? '← Back to the block' : 'Map the burn on the body →'}</button>
      </div>
      <Radios label="Chart" options={[{ id: 'adult', label: 'Adult nines' }, { id: 'child', label: 'Child nines' }, { id: 'lund', label: 'Lund–Browder' }] as { id: TbsaChartId; label: string }[]} value={sim.chart} onChange={(v) => set({ chart: v })} />
      {sim.chart === 'lund' && <Slider label="Age" min={0} max={18} step={1} value={Math.min(18, sim.ageYears)} onChange={(v) => set({ ageYears: v })} display={<>{sim.ageYears} years <Approx note="Lund & Browder (1944) age table as reproduced in burns texts; values approximate." /></>} />}
      <Radios label="Paint by" options={[{ id: 'region', label: 'Tap regions' }, { id: 'palm', label: 'Palm patches (1 %)' }] as const} value={sim.paintMode} onChange={(v) => set({ paintMode: v, ...(state.view === 'block' ? {} : {}) })} />
      <ul className="chips region-chips">
        {BODY_REGION_IDS.map((r) => (
          <li key={r}><button type="button" aria-pressed={(sim.burnRegions[r] ?? 0) > 0} data-region={r} onClick={() => set({ burnRegions: { ...sim.burnRegions, [r]: (sim.burnRegions[r] ?? 0) > 0 ? 0 : 1 } })}>{label(r)} · {+pct[r].toFixed(1)} %</button></li>
        ))}
      </ul>
      <div className="row small">
        <span>Palm patches: <strong data-palms={palms}>{palms}</strong></span>
        <button type="button" className="secondary small-button" onClick={() => set({ palmSpots: sim.palmSpots.slice(0, -3) })} disabled={!palms}>Remove one</button>
        <button type="button" className="secondary small-button" onClick={() => set({ burnRegions: {}, palmSpots: [] })}>Clear</button>
      </div>
      <Readout rows={[
        { label: 'Burned area', value: <span data-tbsa={tbsa.totalPercent.toFixed(1)}>{tbsa.totalPercent.toFixed(1)} % TBSA</span> },
        { label: 'Counted for fluids', value: <span data-counted={tbsa.countedPercent.toFixed(1)}>{tbsa.countedPercent.toFixed(1)} %</span> },
      ]} />

      <h3 className="group-title">Parkland formula</h3>
      <EduNote>A teaching calculator, not for treating patients.</EduNote>
      <Slider label="Body weight" min={3} max={150} step={1} value={sim.weightKg} onChange={(v) => set({ weightKg: v })} display={`${sim.weightKg} kg`} />
      <Readout rows={[
        { label: 'First 24 h (4 mL × kg × %)', value: <span data-parkland={Math.round(pk.total24hMl)}>{Math.round(pk.total24hMl).toLocaleString('en-GB')} mL</span> },
        { label: 'First 8 h from the burn', value: `${Math.round(pk.first8hMl).toLocaleString('en-GB')} mL · ${Math.round(pk.first8hRateMlPerH)} mL/h` },
        { label: 'Next 16 h', value: `${Math.round(pk.next16hMl).toLocaleString('en-GB')} mL · ${Math.round(pk.next16hRateMlPerH)} mL/h` },
        { label: 'Urine output target', value: `${Math.round(pk.urineTargetMlPerH)} mL/h` },
        { label: 'Formal resuscitation', value: pk.indicated ? 'Usually indicated' : `Not usually (< ${child ? 10 : 15} %)`, tone: pk.indicated ? 'warn' : undefined },
      ]} />
      <p className="muted small">{pk.note} Some guidelines now start adults at 2 mL/kg/%TBSA.</p>
    </>
  );
}

/** Wounds and burns. */
export function WoundsPanel() {
  const { state, dispatch } = useLab();
  const id = useId();
  const sim = state.sim;
  return (
    <section className="sheet mode-panel wounds-panel" aria-labelledby={`${id}-title`}>
      <PanelHead id={`${id}-title`} eyebrow="Wounds & burns" title={sim.woundView === 'healing' ? 'How skin repairs' : 'Depth decides healing'} />
      <Radios label="Topic" className="sub-tabs" options={WOUND_VIEWS} value={sim.woundView} onChange={(v) => dispatch({ type: 'set-sim', patch: { woundView: v } })} />
      {sim.woundView === 'healing' ? <HealingSection /> : <BurnsSection />}
      <SourcesLine items={sim.woundView === 'healing'
        ? ['Gurtner et al. 2008 (phases, cells)', 'Robbins Basic Pathology 10e ch. 3', 'Levenson et al. 1965 (strength)', 'Guo & DiPietro 2010 (factors)']
        : ['Wallace 1951 (rule of nines)', 'Lund & Browder 1944', 'Baxter & Shires 1968 (Parkland)', 'Jeschke et al. 2020', 'OpenStax A&P 2e §5.4']} />
    </section>
  );
}
