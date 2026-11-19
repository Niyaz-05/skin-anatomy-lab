import { BODY_REGIONS, DERMATOME_LEVELS } from '../skin/anchors';
import type { BodyColour } from '../app/state';
import { thermalColour } from '../app/visual';
import { DERMATOME_COLOURS, REGION_COLOURS, TRIGEMINAL_COLOUR } from './palette';

/** Key for the body view's colours: rule-of-nines regions (with the area measured on this body) or dermatomes. */
export function BodyLegend({ colour }: { colour: BodyColour }) {
  if (colour === 'real') return <p className="viewer-badge" aria-hidden="true">Click a region of the body to open the skin there</p>;
  if (colour === 'regions') {
    return (
      <div className="body-legend glass" aria-label="Rule of nines">
        <p className="group-title">Rule of nines · measured on this body</p>
        <ul>
          {BODY_REGIONS.map((r, i) => (
            <li key={r.id}><span className="dot" style={{ background: REGION_COLOURS[i] }} aria-hidden="true" /> {r.label} <span className="muted">{r.percent} % ({r.measuredPercent.toFixed(1)})</span></li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="body-legend glass" aria-label="Dermatomes">
      <p className="group-title">Dermatomes (approximate)</p>
      <ul className="dermatome-key">
        <li><span className="dot" style={{ background: TRIGEMINAL_COLOUR }} aria-hidden="true" /> CN V</li>
        {DERMATOME_LEVELS.map((d, i) => (
          <li key={d}><span className="dot" style={{ background: DERMATOME_COLOURS[i] }} aria-hidden="true" /> {d}</li>
        ))}
      </ul>
    </div>
  );
}

/** Key for the body's thermal colours (skin temperature). */
export function ThermalLegend() {
  const stops = [18, 22, 26, 30, 33, 36, 39, 42];
  const css = (t: number) => `rgb(${thermalColour(t).map((v) => Math.round(v * 255)).join(' ')})`;
  return (
    <div className="body-legend glass thermal-legend" aria-label="Skin temperature colours">
      <p className="group-title">Skin temperature</p>
      <div className="thermal-bar" style={{ background: `linear-gradient(90deg, ${stops.map(css).join(', ')})` }} />
      <p className="thermal-ticks small">{stops.filter((_, i) => i % 2 === 0 || i === stops.length - 1).map((t) => <span key={t}>{t}°</span>)}</p>
      <p className="small muted">Hands and feet cool when their vessels constrict.</p>
    </div>
  );
}
