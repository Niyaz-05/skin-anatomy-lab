import { useId } from 'react';
import { useLab } from '../app/LabContext';
import { LIFE_VIEWS, midMonthDay, type Lesion, type Sim } from '../app/sim';
import { lesionFlags, lesionPath, rng, skinTone } from '../app/visual';
import {
  ABCDE_DIAMETER_MM, AGEING_BY_DECADE, DISORDERS, FITZPATRICK_TYPES, INTRINSIC_VS_PHOTO, MELANIN_NOTES, PHOTOTYPES, VITAMIN_D_PATHWAY,
  abcdeCheck, clearSkyNoonUvIndex, dosesInMed, epidermalTurnoverDays, minutesToErythema, relativeCollagen, sunburnGrade, uvIndexCategory,
  vitaminDEstimateIU, vitaminDSeason, type DisorderId,
} from '../skin/photo';
import { formatMinutes } from '../app/visual';
import { PanelHead, Radios, Readout, Slider, SourcesLine } from './widgets';
import { Approx, EduNote } from './SkinWidgets';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EXPOSED = [{ id: 0.1, label: 'Face & hands' }, { id: 0.25, label: 'Arms & legs' }, { id: 0.85, label: 'Swimsuit' }] as const;
const GRADE: Record<string, string> = { none: 'No sunburn', faint: 'Just pink', moderate: 'Red and painful', 'severe-blistering': 'Severe, blistering' };

function SunView() {
  const { state, dispatch } = useLab();
  const s = state.sim;
  const set = (patch: Partial<Sim>) => dispatch({ type: 'set-sim', patch });
  const med = dosesInMed(s.phototype, s.uvIndex, s.sunMinutes, s.spf);
  const grade = sunburnGrade(med);
  const toBurn = minutesToErythema(s.phototype, s.uvIndex, s.spf);
  const cat = uvIndexCategory(s.uvIndex);
  const day = midMonthDay(s.month);
  const season = vitaminDSeason(s.latitude, day);
  const noonUvi = clearSkyNoonUvIndex(s.latitude, day);
  const vitD = vitaminDEstimateIU(s.phototype, s.uvIndex, s.sunMinutes, s.exposed);
  return (
    <>
      <p className="small">Sun on skin: erythema reddens the papillary dermis and dilates its capillaries; melanin in the basal layer and keratinocytes is the built-in sunscreen.</p>
      <div className="seg-toggle wrap phototypes" role="radiogroup" aria-label="Fitzpatrick skin type">
        {FITZPATRICK_TYPES.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={s.phototype === t} title={PHOTOTYPES[t].reaction} onClick={() => set({ phototype: t })}>
            <span className="tone-dot" style={{ background: skinTone(t) }} aria-hidden="true" /> {t}
          </button>
        ))}
      </div>
      <p className="muted small">Type {s.phototype}: {PHOTOTYPES[s.phototype].reaction.toLowerCase()} — {PHOTOTYPES[s.phototype].description.toLowerCase()}.</p>
      <Slider label="UV index" min={0} max={14} step={1} value={s.uvIndex} onChange={(v) => set({ uvIndex: v })} display={`${s.uvIndex} · ${cat.category.replace('-', ' ')}`} />
      <Slider label="Time in the sun" min={0} max={480} step={5} value={s.sunMinutes} onChange={(v) => set({ sunMinutes: v })} display={formatMinutes(s.sunMinutes)} />
      <Radios label="Sunscreen" options={[{ id: 1, label: 'None' }, { id: 15, label: 'SPF 15' }, { id: 30, label: 'SPF 30' }, { id: 50, label: 'SPF 50' }]} value={s.spf as 1 | 15 | 30 | 50} onChange={(v) => set({ spf: v })} />
      <Readout rows={[
        { label: <>Time to one MED <Approx note="MED per type after Fitzpatrick (1988) and Diffey (2002); individual MEDs vary two- to threefold." /></>, value: <span data-burn-min={Math.round(toBurn)}>{formatMinutes(toBurn)}</span> },
        { label: 'Dose received', value: <span data-med={med.toFixed(2)}>{med.toFixed(1)} MED</span> },
        { label: 'Result after 24 h', value: <span data-grade={grade}>{GRADE[grade]}</span>, tone: grade === 'none' ? 'ok' : grade === 'faint' ? 'warn' : 'bad' },
      ]} />
      <p className="muted small">{cat.advice} SPF assumes 2 mg/cm²; most people apply half that.</p>

      <h3 className="group-title">Vitamin D</h3>
      <Slider label="Latitude" min={-70} max={70} step={1} value={s.latitude} onChange={(v) => set({ latitude: v })} display={`${Math.abs(s.latitude)}° ${s.latitude >= 0 ? 'N' : 'S'}`} />
      <Slider label="Month" min={1} max={12} step={1} value={s.month} onChange={(v) => set({ month: v })} display={MONTHS[s.month - 1]!} />
      <Radios label="Skin exposed" options={EXPOSED} value={s.exposed as 0.1 | 0.25 | 0.85} onChange={(v) => set({ exposed: v })} />
      <Readout rows={[
        { label: 'Noon sun', value: `${Math.round(season.elevationDeg)}° high · clear-sky UVI ≈ ${noonUvi.toFixed(1)}` },
        { label: 'Season', value: <span data-season={season.season}>{season.season === 'good' ? 'Good' : season.season === 'limited' ? 'Limited' : 'Vitamin D winter'}</span>, tone: season.season === 'negligible' ? 'warn' : 'ok' },
        { label: <>Vitamin D from this exposure <Approx note="Semi-quantitative, after Holick (2007); curve shape approximate." /></>, value: <span data-vitd={Math.round(vitD)}>{s.uvIndex === 0 ? 'none' : `≈ ${(Math.round(vitD / 100) * 100).toLocaleString('en-GB')} IU`}</span> },
      ]} />
      <div className="row"><button type="button" className="secondary small-button" onClick={() => set({ uvIndex: Math.round(noonUvi) })}>Use this place's noon UV</button></div>
      <p className="muted small">{season.note} Less than one MED makes nearly as much as more, because previtamin D3 breaks down to inactive products.</p>
      <details className="more"><summary>The vitamin D pathway</summary><ol className="small">{VITAMIN_D_PATHWAY.map((p) => <li key={p}>{p}</li>)}</ol></details>
      <details className="more"><summary>Melanin and tanning</summary><p className="small">{MELANIN_NOTES.sameNumber}</p><p className="small">{MELANIN_NOTES.melanosomes}</p><p className="small">{MELANIN_NOTES.tanning}</p></details>
    </>
  );
}

function AgeView() {
  const { state, dispatch } = useLab();
  const s = state.sim;
  const decade = AGEING_BY_DECADE.reduce((a, d) => (s.age >= d.decade ? d : a), AGEING_BY_DECADE[0]!);
  return (
    <>
      <p className="small">Slide through a lifetime. The section shows the epidermis thinning, the rete ridges and dermal papillae flattening and the collagen bundles thinning; sun-exposed skin adds solar elastosis.</p>
      <Slider label="Age" min={20} max={90} step={1} value={s.age} onChange={(v) => dispatch({ type: 'set-sim', patch: { age: v } })} display={<span data-age={s.age}>{s.age} years</span>} />
      <Radios label="Skin" options={[{ id: 'protected', label: 'Sun-protected (intrinsic)' }, { id: 'exposed', label: 'Sun-exposed (photoageing)' }] as const} value={s.photoaged ? 'exposed' : 'protected'} onChange={(v) => dispatch({ type: 'set-sim', patch: { photoaged: v === 'exposed' } })} />
      <Readout rows={[
        { label: <>Dermal collagen <Approx note="−1 %/year after 20 (Shuster et al. 1975); approximate." /></>, value: <span data-collagen={relativeCollagen(s.age).toFixed(2)}>{Math.round(relativeCollagen(s.age) * 100)} % of age 20</span> },
        { label: <>Epidermal turnover <Approx /></>, value: <span data-turnover={Math.round(epidermalTurnoverDays(s.age))}>{Math.round(epidermalTurnoverDays(s.age))} days</span> },
      ]} />
      <div className="decade-card">
        <h3 className="group-title">In the {decade.decade}s</h3>
        <p className="small"><strong>Intrinsic:</strong> {decade.intrinsic.join('; ')}.</p>
        <p className="small"><strong>Photoageing:</strong> {decade.photoageing.join('; ')}.</p>
      </div>
      <p className="muted small"><strong>Intrinsic:</strong> {INTRINSIC_VS_PHOTO.intrinsic}</p>
      <p className="muted small"><strong>Photoageing:</strong> {INTRINSIC_VS_PHOTO.photo}</p>
    </>
  );
}

const LESION_COLOURS = ['#b07a50', '#5a3420', '#1c1310', '#b0423a', '#d8d0c8', '#5a6a86'];
/** The lesion for the ABCDE checker, drawn to scale (mm ruler and the 6 mm reference). */
function LesionDrawing({ l }: { l: Lesion }) {
  const W = 300, H = 150, cx = 110, cy = 72, pxPerMm = 9;
  const r = (l.diameterMm / 2) * pxPerMm;
  const path = lesionPath(cx, cy, r, l.asymmetry, l.border);
  const rr = rng(5);
  const blobs = Array.from({ length: 10 }, (_, i) => ({ x: cx + (rr() - 0.5) * r * 1.2, y: cy + (rr() - 0.5) * r * 1.2, r: r * (0.25 + rr() * 0.35), c: LESION_COLOURS[1 + (i % Math.max(1, l.colours - 1))] ?? LESION_COLOURS[1]! }));
  return (
    <svg className="chart lesion" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`A pigmented lesion ${l.diameterMm} millimetres across with ${l.colours} colour${l.colours > 1 ? 's' : ''}.`}>
      <rect x={0} y={0} width={W} height={H} rx={8} fill="#e9c2a6" />
      <defs><clipPath id="lesion-clip"><path d={path} /></clipPath><filter id="lesion-blur"><feGaussianBlur stdDeviation={l.border * 2.2} /></filter></defs>
      <g filter="url(#lesion-blur)">
        <path d={path} fill={LESION_COLOURS[0]} />
        {l.colours > 1 && <g clipPath="url(#lesion-clip)">{blobs.map((b, i) => <circle key={i} cx={b.x} cy={b.y} r={b.r} fill={b.c} opacity={0.85} />)}</g>}
      </g>
      <circle cx={245} cy={60} r={3 * pxPerMm} fill="none" stroke="#18232c" strokeDasharray="3 2" />
      <text x={245} y={60 + 3 * pxPerMm + 12} fontSize="9" textAnchor="middle" fill="#18232c">6 mm (pencil eraser)</text>
      <line x1={cx - r} x2={cx + r} y1={H - 14} y2={H - 14} stroke="#18232c" />
      <text x={cx} y={H - 3} fontSize="9" textAnchor="middle" fill="#18232c">{l.diameterMm} mm</text>
    </svg>
  );
}

function DisordersView() {
  const { state, dispatch } = useLab();
  const s = state.sim;
  const d = DISORDERS[s.disorder];
  const l = s.lesion;
  const setL = (patch: Partial<Lesion>) => dispatch({ type: 'set-sim', patch: { lesion: { ...l, ...patch } } });
  const res = abcdeCheck({ ...lesionFlags(l.asymmetry, l.border), colourCount: l.colours, diameterMm: l.diameterMm, evolving: l.evolving });
  return (
    <>
      <div className="seg-toggle wrap disorder-pick" role="radiogroup" aria-label="Disorder">
        {(Object.keys(DISORDERS) as DisorderId[]).map((id) => <button key={id} type="button" role="radio" aria-checked={s.disorder === id} onClick={() => dispatch({ type: 'set-sim', patch: { disorder: id } })}>{DISORDERS[id].name.replace(' (dermatitis)', '').replace(' vulgaris', '')}</button>)}
      </div>
      <div className="disorder-card" data-disorder={d.id}>
        <h3 className="group-title">{d.name} <span className="tag">{d.category}</span></h3>
        <p className="small">{d.pathophysiology}</p>
        <p className="small"><strong>Features:</strong> {d.features}</p>
        <p className="small muted"><strong>Epidemiology</strong> <Approx />: {d.epidemiology} {d.note}</p>
        <p className="small muted">Highlighted in the block: {d.structures.join(', ').replace(/-/g, ' ')}.</p>
      </div>
      <h3 className="group-title">ABCDE melanoma check</h3>
      <EduNote>A teaching aid, not a diagnosis. Any new, changing or unusual mole should be seen by a doctor.</EduNote>
      <LesionDrawing l={l} />
      <Slider label="A · Asymmetry" min={0} max={1} step={0.05} value={l.asymmetry} onChange={(v) => setL({ asymmetry: v })} display={`${Math.round(l.asymmetry * 100)} %`} />
      <Slider label="B · Border irregularity" min={0} max={1} step={0.05} value={l.border} onChange={(v) => setL({ border: v })} display={`${Math.round(l.border * 100)} %`} />
      <Slider label="C · Colours" min={1} max={6} step={1} value={l.colours} onChange={(v) => setL({ colours: v })} display={String(l.colours)} />
      <Slider label="D · Diameter" min={1} max={20} step={0.5} value={l.diameterMm} onChange={(v) => setL({ diameterMm: v })} display={`${l.diameterMm} mm`} />
      <label className="check"><input type="checkbox" checked={l.evolving} onChange={(e) => setL({ evolving: e.target.checked })} /> E · Evolving (changing over weeks)</label>
      <div className="abcde" data-concern={res.concern} data-count={res.count}>
        <p className="abcde-flags" aria-label="Criteria met">{(['A', 'B', 'C', 'D', 'E'] as const).map((k) => <span key={k} className={res.flags[k] ? 'on' : ''}>{k}</span>)}</p>
        <p className={`small risk ${res.concern === 'high' ? 'risk-dangerous' : res.concern === 'moderate' ? 'risk-caution' : ''}`} aria-live="polite"><strong>{res.concern === 'high' ? 'High concern' : res.concern === 'moderate' ? 'Some concern' : 'Low concern'}.</strong> {res.message}</p>
      </div>
      <div className="row">
        <button type="button" className="secondary small-button" onClick={() => dispatch({ type: 'set-sim', patch: { lesionPreset: 'melanoma' } })}>Show a melanoma</button>
        <button type="button" className="secondary small-button" onClick={() => dispatch({ type: 'set-sim', patch: { lesionPreset: 'mole' } })}>Ordinary mole</button>
      </div>
      <p className="muted small">D: larger than {ABCDE_DIAMETER_MM} mm. Criteria after Abbasi et al. (2004); nodular melanomas can be small and symmetrical ("EFG": elevated, firm, growing).</p>
    </>
  );
}

/** Life: sun, ageing and disorders. */
export function LifePanel() {
  const { state, dispatch } = useLab();
  const id = useId();
  const lv = state.sim.lifeView;
  return (
    <section className="sheet mode-panel life-panel" aria-labelledby={`${id}-title`}>
      <PanelHead id={`${id}-title`} eyebrow="Skin through life" title={lv === 'sun' ? 'Sun, melanin and vitamin D' : lv === 'age' ? 'Ageing skin' : 'Disorders'} />
      <Radios label="Topic" className="sub-tabs" options={LIFE_VIEWS} value={lv} onChange={(v) => dispatch({ type: 'set-sim', patch: { lifeView: v } })} />
      {lv === 'sun' && <SunView />}
      {lv === 'age' && <AgeView />}
      {lv === 'disorders' && <DisordersView />}
      <SourcesLine items={lv === 'sun' ? ['Fitzpatrick 1988', 'CIE S 007 / ISO 17166', 'WHO 2002 (UV index)', 'Madronich 2007', 'Holick 2007', 'Webb et al. 1988']
        : lv === 'age' ? ['Yaar & Gilchrest 2007', 'Shuster et al. 1975', 'OpenStax A&P 2e §5.4']
          : ['Robbins Basic Pathology 10e ch. 22', 'Abbasi et al. 2004 (ABCDE)', 'OpenStax A&P 2e §5.4']} />
    </section>
  );
}
