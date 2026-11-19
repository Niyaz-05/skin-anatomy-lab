import { useId, useMemo, useState } from 'react';
import { useLab } from '../app/LabContext';
import { effectiveView, isVisible, keptHalf, PEEL, type BodyColour, type ColourBy } from '../app/state';
import { searchStructures } from '../app/search';
import type { AnatomicalStructure, SliceAxis } from '../contract/schema';
import { baseColour } from '../viewer/palette';

const COLOUR_MODES: { id: ColourBy; label: string }[] = [
  { id: 'real', label: 'Real' },
  { id: 'layer', label: 'Layers' },
];

const BODY_COLOURS: { id: BodyColour; label: string }[] = [
  { id: 'real', label: 'Skin' },
  { id: 'regions', label: 'Regions' },
  { id: 'dermatomes', label: 'Nerves' },
];

/** The list, from the surface down, then the appendages, receptors, vessels and nerves. */
const SECTIONS: { title: string; ids: string[] }[] = [
  { title: 'Whole body', ids: ['skin-surface'] },
  { title: 'Epidermis', ids: ['epidermis'] },
  { title: 'Dermis', ids: ['dermis'] },
  { title: 'Hypodermis', ids: ['hypodermis'] },
  { title: 'Hair and glands', ids: ['hair-unit', 'eccrine-gland'] },
  { title: 'Receptors and nerves', ids: ['cutaneous-receptors', 'cutaneous-nerve'] },
  { title: 'Vessels', ids: ['cutaneous-vessels'] },
];

const SLICES: { id: SliceAxis; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'No cut' },
  { id: 'sagittal', label: 'Along', hint: 'Vertical section across x (thin to thick skin)' },
  { id: 'coronal', label: 'Across', hint: 'Vertical section across z (front to back)' },
  { id: 'axial', label: 'Level', hint: 'Horizontal section at a depth' },
];

/** Peel the block from the top, layer by layer. */
function PeelControl() {
  const { state, dispatch } = useLab();
  const id = useId();
  return (
    <div className="peel" role="group" aria-labelledby={`${id}-t`}>
      <span className="group-title" id={`${id}-t`}>Peel</span>
      <input
        type="range" min={0} max={PEEL.length - 1} step={1} value={state.peel}
        aria-label="Peel layers off the top" aria-valuetext={PEEL[state.peel]?.label}
        onChange={(e) => dispatch({ type: 'set-peel', value: Number(e.target.value) })}
      />
      <p className="peel-hint" aria-live="polite">{state.peel === 0 ? 'All layers in place' : `Removed: ${PEEL[state.peel]?.label.toLowerCase()}`}</p>
    </div>
  );
}

/** The cut control: axis, position and which side to keep. */
function SliceControl() {
  const { def, state, dispatch } = useLab();
  const view = effectiveView(def, state);
  const id = useId();
  const s = state.slice;
  return (
    <div className="slice" role="group" aria-labelledby={`${id}-t`}>
      <span className="group-title" id={`${id}-t`}>Cut</span>
      <div className="seg-toggle" role="radiogroup" aria-label="Cut direction">
        {SLICES.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={s.axis === x.id} title={x.hint} onClick={() => dispatch({ type: 'set-slice', axis: x.id })}>
            {x.label}
          </button>
        ))}
      </div>
      {s.axis !== 'off' && (
        <div className="field slice-field">
          <label htmlFor={`${id}-at`} className="sr-only">Cut position</label>
          <input
            id={`${id}-at`}
            type="range" min={-1} max={1} step={0.01} value={s.at}
            aria-valuetext={`${Math.round(((s.at + 1) / 2) * 100)} percent across`}
            onChange={(e) => dispatch({ type: 'set-slice', at: Number(e.target.value) })}
          />
          <button type="button" className="secondary small-button" aria-pressed={s.flip} onClick={() => dispatch({ type: 'set-slice', flip: !s.flip })} title="Keep the other half">
            Flip
          </button>
        </div>
      )}
      {s.axis !== 'off' && <p className="slice-hint" aria-live="polite">Showing {keptHalf(s, view)}</p>}
    </div>
  );
}

/** Search, colour mode, cut, layer toggles and the grouped structure list. Every entry selects on the model. */
export function StructurePanel() {
  const { def, state, dispatch } = useLab();
  const [query, setQuery] = useState('');
  const id = useId();
  const hits = useMemo(() => searchStructures(def.structures, query), [def, query]);
  const view = effectiveView(def, state);
  const searching = query.trim().length > 0;
  const select = (sid: string) => dispatch({ type: 'select', id: sid });

  const item = (s: AnatomicalStructure, swatch = false) => {
    const shown = s.kind === 'group' ? (s.members ?? []).some((m) => isVisible(def, state, m)) : isVisible(def, state, s.id);
    return (
      <li key={s.id}>
        <button
          type="button"
          aria-pressed={state.selected === s.id}
          className={shown ? undefined : 'is-hidden'}
          onClick={() => select(s.id)}
          onMouseEnter={() => dispatch({ type: 'hover', id: s.kind === 'mesh' ? s.id : null })}
          onMouseLeave={() => dispatch({ type: 'hover', id: null })}
        >
          {swatch && <span className="dot" aria-hidden="true" style={{ background: baseColour(s, state.colourBy) }} />}
          {s.label.replace(/ \((right|left)\)$/, '')}
          {!shown && <span className="tag">hidden</span>}
        </button>
      </li>
    );
  };

  const meshesOf = (g: AnatomicalStructure) => (g.members ?? []).map((m) => def.structures.find((x) => x.id === m)).filter((x): x is AnatomicalStructure => !!x);

  return (
    <section className="panel structure-panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="panel-title">Structures</h2>

      <div className="search">
        <label htmlFor={`${id}-q`} className="sr-only">Search structures</label>
        <input
          id={`${id}-q`}
          type="search"
          placeholder="Search, e.g. Meissner, sweat gland, dermis"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) select(hits[0].structure.id);
            if (e.key === 'Escape') setQuery('');
          }}
          autoComplete="off"
        />
      </div>

      {searching ? (
        <div className="search-results" aria-live="polite">
          {hits.length === 0 ? (
            <p className="muted small">No structure matches “{query.trim()}”.</p>
          ) : (
            <ul className="struct-list">
              {hits.map((h) => (
                <li key={h.structure.id}>
                  <button type="button" aria-pressed={state.selected === h.structure.id} onClick={() => select(h.structure.id)}>
                    <span>{h.structure.label}</span>
                    {h.matched !== h.structure.label && <span className="muted small"> · {h.matched}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="colour-by" role="radiogroup" aria-label="Colour the structures by">
            <span className="group-title">Colour</span>
            <div className="seg-toggle">
              {view === 'body'
                ? BODY_COLOURS.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={state.bodyColour === c.id} onClick={() => dispatch({ type: 'set-body-colour', value: c.id })}>
                    {c.label}
                  </button>
                ))
                : COLOUR_MODES.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={state.colourBy === c.id} onClick={() => dispatch({ type: 'set-colour-by', value: c.id })}>
                    {c.label}
                  </button>
                ))}
            </div>
          </div>

          <SliceControl />
          {view === 'block' && <PeelControl />}

          <fieldset className="layers">
            <legend>Layers</legend>
            {def.layers.map((l) => (
              <label key={l.id} className="check" title={l.description}>
                <input type="checkbox" checked={state.visibleLayers.has(l.id)} onChange={() => dispatch({ type: 'toggle-layer', layer: l.id })} />
                {l.label}
              </label>
            ))}
          </fieldset>

          {SECTIONS.map((sec) => (
            <div key={sec.title} className="group">
              <h3 className="group-title">{sec.title}</h3>
              {sec.ids.map((id) => {
                const st = def.structures.find((x) => x.id === id);
                if (!st) return null;
                if (st.kind === 'mesh') return <ul key={id} className="struct-list">{item(st, state.colourBy !== 'real')}</ul>;
                return (
                  <div key={id} className="tree-branch">
                    <ul className="struct-list">{item(st, true)}</ul>
                    <ul className="struct-list tree-leaves">{meshesOf(st).map((m) => item(m, state.colourBy !== 'real'))}</ul>
                  </div>
                );
              })}
            </div>
          ))}

        </>
      )}
    </section>
  );
}
