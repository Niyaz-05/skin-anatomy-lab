import { useEffect, useRef } from 'react';
import { useLab } from '../app/LabContext';
import { LAYER_COLOUR } from '../viewer/palette';

/**
 * Source, scope and credits, kept off the main screen. The BodyParts3D attribution
 * required by CC BY 4.0 lives here and is reachable from the ⓘ button and the "Source & credits" link.
 */
export function AboutSheet({ onClose }: { onClose: () => void }) {
  const { def } = useLab();
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    title.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="about-sheet glass" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ghost sheet-close" onClick={onClose} aria-label="Close">✕</button>
        <p className="eyebrow">Source &amp; scope</p>
        <h2 id="about-title" className="sheet-title" tabIndex={-1} ref={title}>About this lab</h2>
        <p>{def.summary}</p>

        <h3 className="group-title">You will learn to</h3>
        <ul className="objectives">
          {def.learningObjectives.map((o) => <li key={o.id}>{o.text}</li>)}
        </ul>

        <h3 className="group-title">Colours</h3>
        <p className="small muted">
          “Real” shows the tissues as a stained section and fresh tissue would look: a pale yellowish cornified layer, a
          clear lucidum, a darker granular layer, pinkish-tan living epidermis, a basal layer darkened by melanin, pale-pink
          papillary and deeper-pink reticular dermis, yellow fat lobules between whitish septa, arteries red, veins blue,
          lymphatics green and nerves yellow. Every cut face carries a microscopic texture for its tissue. “Layers” gives
          each layer one colour. In the body view, colour the skin by rule-of-nines region or by dermatome.
        </p>
        <p className="legend-row">
          {def.layers.map((l) => (
            <span key={l.id}><span className="dot" style={{ background: LAYER_COLOUR[l.id] }} aria-hidden="true" /> {l.label}</span>
          ))}
        </p>

        <h3 className="group-title">Pathways</h3>
        <ul className="small disclaimers">
          {def.routes.flatMap((r) => r.assumptions).map((a) => <li key={a}>{a}</li>)}
        </ul>

        <h3 className="group-title">Please note</h3>
        <ul className="small disclaimers">
          {def.disclaimers.map((d) => <li key={d}>{d}</li>)}
        </ul>

        <h3 className="group-title">Source</h3>
        <p className="small">
          Body surface, hair of the head and pubic hair: BodyParts3D, © The Database Center for Life Science, licensed under CC
          Attribution 4.0 International. The skin block and everything in it are modelled for this lab at true histological scale
          from standard adult dimensions (Ross &amp; Pawlina, Histology 8e; OpenStax Anatomy and Physiology 2e, ch. 5; Kandel,
          Principles of Neural Science 6e). Rule-of-nines regions and dermatomes are classified on the mesh (after Wallace 1951,
          Lee et al. 2008, Keegan &amp; Garrett 1948). DBCLS has not reviewed or endorsed this lab.
        </p>
        <div className="link-list small">
          <a href={`${import.meta.env.BASE_URL}ATTRIBUTION.md`} target="_blank" rel="noopener">Attribution and changes made ↗</a>
          <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html" target="_blank" rel="noopener noreferrer">BodyParts3D ↗</a>
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0 licence ↗</a>
        </div>
      </section>
    </div>
  );
}
