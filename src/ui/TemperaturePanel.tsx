import { useId } from 'react';
import { useLab } from '../app/LabContext';
import { TEMP_PRESETS, type Sim } from '../app/sim';
import { useThermoLive } from '../app/drivers';
import { formatSimMinutes } from '../app/visual';
import { THERMAL_STATES, classifyCoreTemp, wetBulbC, wetBulbRisk, SET_POINTS_C } from '../skin/thermo';
import { LineChart, Legend } from './Chart';
import { PanelHead, PlayButton, Radios, Readout, RouteSteps, Slider, SourcesLine } from './widgets';
import { Approx, Key, StackedBar } from './SkinWidgets';

const ROUTES = [
  { key: 'radiationW', label: 'Radiation', colour: '#e8742a' },
  { key: 'convectionW', label: 'Convection', colour: '#3f8fd6' },
  { key: 'conductionW', label: 'Conduction', colour: '#5a4ab8' },
  { key: 'evaporationW', label: 'Evaporation', colour: '#2fae9a' },
  { key: 'respirationW', label: 'Respiration', colour: '#9aa4ae' },
] as const;

const STATE_TONE: Record<string, 'ok' | 'warn' | 'bad'> = {
  normal: 'ok', elevated: 'warn', 'mild-hypothermia': 'warn', 'heat-exhaustion': 'bad', 'heat-stroke': 'bad', 'moderate-hypothermia': 'bad', 'severe-hypothermia': 'bad',
};
const SPEEDS = [{ id: 0.5, label: '30 s/s' }, { id: 2, label: '2 min/s' }, { id: 10, label: '10 min/s' }] as const;
const activity = (met: number) => (met < 0.9 ? 'sleeping' : met < 1.3 ? 'seated' : met < 1.7 ? 'standing' : met < 3 ? 'walking' : met < 5 ? 'brisk walking' : met < 8 ? 'cycling' : 'running');
const clothing = (clo: number) => (clo < 0.05 ? 'nude' : clo < 0.3 ? 'shorts' : clo < 0.7 ? 'summer clothes' : clo < 1.15 ? 'trousers and shirt' : clo < 1.6 ? 'suit' : clo < 2.6 ? 'winter coat' : 'polar suit');

/** Temperature: conditions in, heat balance out, with the body's effectors working in the block. */
export function TemperaturePanel() {
  const { def, state, dispatch } = useLab();
  const id = useId();
  const live = useThermoLive(6);
  const sim = state.sim;
  const set = (patch: Partial<Sim>) => dispatch({ type: 'set-sim', patch: { ...patch, tempPreset: 'custom' } });
  const b = live.balance, s = live.state;
  const cls = classifyCoreTemp(s.coreC);
  const info = THERMAL_STATES.find((x) => x.id === cls)!;
  const wb = wetBulbC(sim.airC, sim.humidity);
  const risk = wetBulbRisk(wb);
  const h = live.history;
  const t0 = h[0]![0], tN = h[h.length - 1]![0];
  const temps = h.flatMap((x) => [x[1], x[2]]);
  const lo = Math.floor(Math.min(30, ...temps)), hi = Math.ceil(Math.max(38, ...temps));
  const stepT = Math.max(1, Math.ceil((hi - lo) / 6));
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((v) => v % stepT === 0);
  const span = Math.max(1, tN - t0);
  const xTicks = [0, 0.5, 1].map((f) => ({ at: f * span, text: formatSimMinutes(t0 + f * span) }));
  const routes = ROUTES.map((r) => ({ label: r.label, value: b.routes[r.key], colour: r.colour }));
  const maxW = Math.max(150, b.heatProductionW, b.totalLossW, ...routes.map((r) => r.value));
  const route = def.routes.find((r) => r.id === 'heat-loss');

  return (
    <section className="sheet mode-panel temperature-panel" aria-labelledby={`${id}-title`}>
      <PanelHead id={`${id}-title`} eyebrow="Temperature" title="Holding the core near 37 °C"><PlayButton /></PanelHead>
      <p className="small">Choose the conditions and let time run. In the block the vessels flush or blanch, sweat climbs the ducts and evaporates from the pores, and in the cold the arrector pili pull the hair upright.</p>
      <div className="seg-toggle wrap presets" role="group" aria-label="Scenarios">
        {TEMP_PRESETS.map((p) => <button key={p.id} type="button" aria-pressed={sim.tempPreset === p.id} onClick={() => dispatch({ type: 'set-sim', patch: { tempPreset: p.id } })}>{p.label}</button>)}
      </div>

      <Readout rows={[
        { label: 'Time', value: <span data-time={live.tMin.toFixed(1)}>{formatSimMinutes(live.tMin)}</span> },
        { label: 'Core temperature', value: <span data-core={s.coreC.toFixed(2)}>{s.coreC.toFixed(2)} °C</span>, tone: STATE_TONE[cls] },
        { label: 'Mean skin temperature', value: <span data-skin={s.skinC.toFixed(2)}>{s.skinC.toFixed(1)} °C</span> },
      ]} />
      <p className={`small risk state-${STATE_TONE[cls]}`} data-state={cls} aria-live="polite"><strong>{info.label}.</strong> {info.signs}</p>
      {sim.feverK > 0 && <p className="small muted">Fever: prostaglandin E2 has raised the hypothalamic set point to {(SET_POINTS_C.core + sim.feverK).toFixed(1)} °C, so a normal core now feels cold — vasoconstriction, shivering and goosebumps (the chills) heat the body up to the new set point.</p>}

      <LineChart
        label={`Core and skin temperature over the last ${formatSimMinutes(span)}`}
        series={[{ label: 'Core', colour: '#d2452f', values: h.map((x) => x[1]), width: 2 }, { label: 'Skin', colour: '#3f8fd6', values: h.map((x) => x[2]) }]}
        xMax={span} xTicks={xTicks} y={{ min: lo, max: hi, ticks, unit: '°C' }} band={{ from: 36.5, to: 37.5, text: 'normal core' }} height={130}
      />
      <Legend items={[{ label: 'Core', colour: '#d2452f' }, { label: 'Mean skin', colour: '#3f8fd6' }]} />

      <h3 className="group-title">Heat balance</h3>
      <StackedBar className="routes-bar" label={`Heat lost: ${Math.round(b.totalLossW)} W`} max={maxW} unit="W" parts={routes} />
      <StackedBar className="production-bar" label={`Made: ${Math.round(b.heatProductionW)} W`} max={maxW} unit="W" parts={[{ label: 'Metabolism', value: b.metabolicW - b.workW, colour: '#d2a02f' }, { label: 'Shivering', value: b.shiveringW, colour: '#b84a8a' }]} />
      <Key items={ROUTES.map((r) => ({ label: `${r.label} ${Math.round(b.routes[r.key])}`, colour: r.colour }))} />
      <p className="muted small">Watts; bars to the left of the line are heat gained (hot air, sun, hot water). Stored: <strong data-storage={Math.round(b.storageW)}>{b.storageW >= 0 ? '+' : ''}{Math.round(b.storageW)} W</strong> {b.storageW > 15 ? '(warming)' : b.storageW < -15 ? '(cooling)' : '(balanced)'}.</p>

      <Readout rows={[
        { label: 'Sweat rate', value: <span data-sweat={b.sweatLph.toFixed(2)}>{b.sweatLph.toFixed(2)} L/h{b.drippingLph > 0.05 ? ` · ${b.drippingLph.toFixed(2)} drips off` : ''}</span> },
        { label: 'Skin blood flow', value: <span data-skbf={b.skinBloodFlowLpm.toFixed(2)}>{b.skinBloodFlowLpm.toFixed(2)} L/min</span> },
        { label: 'Shivering', value: <span data-shiver={Math.round(b.shiveringW)}>{Math.round(b.shiveringW)} W{b.shiveringW > 20 ? ' · shivering' : ''}</span>, tone: b.shiveringW > 20 ? 'warn' : undefined },
        { label: 'Goosebumps', value: `${Math.round(b.piloerection * 100)} %` },
        { label: 'Skin wettedness', value: `${Math.round(b.wettedness * 100)} %` },
        { label: <>Wet-bulb temperature <Approx note="Stull (2011) fit; risk bands after Sherwood & Huber (2010) and Vecellio et al. (2022) are approximate." /></>, value: <span data-wetbulb={risk.risk}>{wb.toFixed(1)} °C · {risk.risk}</span>, tone: risk.risk === 'safe' ? 'ok' : risk.risk === 'caution' ? 'warn' : 'bad' },
      ]} />
      <p className="muted small">{risk.note}</p>

      <h3 className="group-title">Conditions</h3>
      <Slider label="Air temperature" min={-20} max={50} step={1} value={sim.airC} onChange={(v) => set({ airC: v })} display={`${Math.round(sim.airC)} °C`} />
      <Slider label="Humidity" min={5} max={100} step={1} value={sim.humidity} onChange={(v) => set({ humidity: v })} display={`${Math.round(sim.humidity)} %`} />
      <Slider label="Wind" min={0} max={15} step={0.1} value={sim.windMs} onChange={(v) => set({ windMs: v })} display={`${sim.windMs.toFixed(1)} m/s`} />
      <Slider label="Sunshine (radiant gain)" min={0} max={30} step={1} value={sim.sunK} onChange={(v) => set({ sunK: v })} display={`+${Math.round(sim.sunK)} °C`} />
      <Slider label="Clothing" min={0} max={4} step={0.1} value={sim.clo} onChange={(v) => set({ clo: v })} display={`${sim.clo.toFixed(1)} clo · ${clothing(sim.clo)}`} />
      <Slider label="Activity" min={0.7} max={12} step={0.1} value={sim.met} onChange={(v) => set({ met: v })} display={`${sim.met.toFixed(1)} MET · ${activity(sim.met)}`} />
      <Slider label="Fever (set point raised)" min={0} max={3} step={0.1} value={sim.feverK} onChange={(v) => set({ feverK: v })} display={sim.feverK ? `+${sim.feverK.toFixed(1)} °C` : 'none'} />
      <label className="check"><input type="checkbox" checked={sim.water} onChange={(e) => set({ water: e.target.checked })} /> In water to the neck</label>
      {sim.water && <Slider label="Water temperature" min={0} max={40} step={1} value={sim.waterC} onChange={(v) => set({ waterC: v })} display={`${Math.round(sim.waterC)} °C`} />}

      <div className="row">
        <Radios label="Speed" options={SPEEDS} value={sim.speed as 0.5 | 2 | 10} onChange={(v) => dispatch({ type: 'set-sim', patch: { speed: v } })} />
        <button type="button" className="secondary small-button" onClick={() => dispatch({ type: 'set-sim', patch: { thermoRun: sim.thermoRun + 1 } })}>Restart</button>
      </div>
      <Radios label="Show" className="scene-toggle" options={[{ id: 'block', label: 'Skin block' }, { id: 'body', label: 'Body (skin temperature)' }] as const} value={state.view} onChange={(v) => dispatch({ type: 'set-view', view: v })} />
      <label className="check"><input type="checkbox" checked={sim.xray} onChange={(e) => dispatch({ type: 'set-sim', patch: { xray: e.target.checked } })} /> See-through block (effectors in colour)</label>
      <p className="muted small">Body view (dock: Body) shows skin temperature in thermal colours. A two-node model (core + skin) after Gagge; 70 kg, 1.75 m adult. Educational, not a heat-stress tool.</p>

      {route && (
        <details className="more">
          <summary>{route.label}: step by step</summary>
          <RouteSteps route={route} colour="#d2452f" />
        </details>
      )}
      <SourcesLine items={['Gagge et al. 1971 (two-node model)', 'ASHRAE Fundamentals 2017 ch. 9', 'Parsons 2014', 'Guyton & Hall 14e', 'Stull 2011 (wet bulb)', 'Sherwood & Huber 2010; Vecellio et al. 2022']} />
    </section>
  );
}
