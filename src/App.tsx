import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LabProvider, useLab } from './app/LabContext';
import { effectiveMode, effectiveSim, effectiveView, type Mode, type View } from './app/state';
import { useThermoDriver } from './app/drivers';
import { validateDefinition } from './contract/validate';
import { skinDefinition } from './skin/definition';
import { LabViewer } from './viewer/LabViewer';
import { StructurePanel } from './ui/StructurePanel';
import { DetailPanel } from './ui/DetailPanel';
import { LifePanel, TemperaturePanel, TouchPanel, WoundsPanel } from './ui/ModePanels';
import { TourPanel } from './ui/TourPanel';
import { AboutSheet } from './ui/AboutSheet';
import { Sheet } from './ui/Sheet';
import { isTouch, panelInsets, useChrome, useLayout, type SheetState } from './app/layout';

const MODES: { id: Mode; label: string }[] = [
  { id: 'explore', label: 'Anatomy' },
  { id: 'temperature', label: 'Temperature' },
  { id: 'wounds', label: 'Wounds' },
  { id: 'touch', label: 'Touch' },
  { id: 'life', label: 'Life' },
  { id: 'tour', label: 'Guided tour' },
];

/** Camera presets shown in the dock only in their own mode. */
const MODE_PRESETS: Record<string, Mode> = { 'block-wound': 'wounds', 'block-burn': 'wounds' };

const VIEWS: { id: View; label: string }[] = [
  { id: 'block', label: 'Skin block' },
  { id: 'body', label: 'Body' },
];

function Toolbar({ structuresOpen, onStructures }: { structuresOpen: boolean; onStructures: () => void }) {
  const { def, state, dispatch } = useLab();
  const view = effectiveView(def, state);
  return (
    <div className="dock glass" role="toolbar" aria-label="View controls">
      <button type="button" className="mobile-only dock-structures" aria-pressed={structuresOpen} onClick={onStructures}>
        Structures
      </button>
      <div className="seg" role="group" aria-label="Scene">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => dispatch({ type: 'set-view', view: v.id })}>{v.label}</button>
        ))}
      </div>
      <span className="dock-sep" aria-hidden="true" />
      <div className="seg" role="group" aria-label="Camera views">
        {def.cameraPresets.filter((c) => c.view === view && (!MODE_PRESETS[c.id] || MODE_PRESETS[c.id] === state.mode)).map((c) => (
          <button key={c.id} type="button" aria-pressed={state.camera.preset === c.id} onClick={() => dispatch({ type: 'camera', preset: c.id })}>
            {c.label}
          </button>
        ))}
      </div>
      <span className="dock-sep" aria-hidden="true" />
      <label className="check toolbar-check">
        <input type="checkbox" checked={state.labels} onChange={(e) => dispatch({ type: 'set-labels', value: e.target.checked })} />
        Labels
      </label>
      <button type="button" className="secondary" onClick={() => dispatch({ type: 'camera', preset: state.camera.preset })} title="Fit the model in view">Fit</button>
      <button type="button" className="secondary" onClick={() => dispatch({ type: 'reset' })} title="Reset camera, layers, selection and mode">Reset</button>
    </div>
  );
}

/** Right-hand sheet: shown only when there is something to show. */
function SidePanel() {
  const { state } = useLab();
  if (state.mode === 'tour') return <TourPanel />;
  if (state.selected) return <DetailPanel />;
  switch (state.mode) {
    case 'temperature': return <TemperaturePanel />;
    case 'wounds': return <WoundsPanel />;
    case 'touch': return <TouchPanel />;
    case 'life': return <LifePanel />;
    default: return <DetailPanel />;
  }
}

function Lab() {
  const { def, state, dispatch } = useLab();
  const [about, setAbout] = useState(false);
  // Phones and tablets: the structure panel opens over the model from the dock.
  const [structuresOpen, setStructuresOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetState>('half');
  const root = useRef<HTMLDivElement>(null);
  const closeAbout = useCallback(() => setAbout(false), []);
  // The heat balance runs while the Temperature mode (or a tour step in it) is open.
  useThermoDriver(effectiveMode(def, state) === 'temperature', state.playing, effectiveSim(def, state));


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (typing || about) return;
      if (e.key === 'Escape') dispatch({ type: 'select', id: null });
      if (e.key === '0' || e.key === 'Home') dispatch({ type: 'camera', preset: def.defaultCamera });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [def, dispatch, about]);

  // Picking a structure from the panel on a phone closes the panel so the details can show.
  useEffect(() => {
    if (state.selected) setStructuresOpen(false);
  }, [state.selected]);
  // Something new to read opens the sheet halfway.
  useEffect(() => { setSheet('half'); }, [state.selected, state.mode]);
  const toggleStructures = () => { if (!structuresOpen) setSheet('peek'); setStructuresOpen(!structuresOpen); };

  const hasSheet = state.mode !== 'explore' || state.selected !== null;
  // A structure's details (not a mode's own panel) are open: on phones and tablets they take the screen's top bar with them.
  const detail = state.selected !== null && state.mode !== 'tour';
  const { w, h, layout } = useLayout();
  const chrome = useChrome(root);
  const insets = useMemo(() => panelInsets(layout, w, h, { hasSheet, sheet, ...chrome }), [layout, w, h, hasSheet, sheet, chrome]);
  const touch = useMemo(isTouch, []);
  // Show what was picked: on a phone or tablet the camera frames the structure in the space above the sheet,
  // and frames the whole model again when the details close.
  const compact = layout !== 'desktop';
  const picked = useRef<string | null>(null);
  useEffect(() => {
    const before = picked.current;
    picked.current = state.selected;
    if (!compact || state.mode === 'tour' || before === state.selected) return;
    if (state.selected) dispatch({ type: 'camera', preset: state.camera.preset, focus: [state.selected] });
    else if (before) dispatch({ type: 'camera', preset: state.camera.preset });
    // The camera preset is read when the selection changes, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selected, compact, state.mode, dispatch]);
  const meshCount = def.structures.filter((s) => s.kind === 'mesh').length;

  return (
    <div className="app" ref={root} data-mode={state.mode} data-layout={layout} data-sheet={hasSheet ? sheet : 'none'} data-detail={detail ? 'open' : 'closed'}>
      <main className="stage">
        <LabViewer insets={insets} />
      </main>

      <header className="identity">
        <p className="eyebrow"><img className="brand-logo" src="/brand/logo-mark.png" alt="pomeylo" width="76" height="18" /> Interactive anatomy</p>
        <h1>Human Skin</h1>
        <p className="identity-meta">{meshCount} structures · BodyParts3D · modelled</p>
      </header>

      <nav className="top-actions" aria-label="Mode">
        <div className="modes glass">
          {MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={state.mode === m.id} onClick={() => dispatch({ type: 'set-mode', mode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button glass" aria-label="About this lab, sources and credits" onClick={() => setAbout(true)}>
          <span aria-hidden="true">i</span>
        </button>
      </nav>

      <aside className={`left glass ${structuresOpen ? 'mobile-open' : ''}`}>
        <StructurePanel />
      </aside>

      {hasSheet && (
        <Sheet layout={layout} state={sheet} onState={setSheet} dismissible={detail} onClose={() => dispatch({ type: 'select', id: null })} resetKey={`${state.mode}|${state.selected ?? ''}|${state.tourIndex}`}>
          <SidePanel />
        </Sheet>
      )}

      <Toolbar structuresOpen={structuresOpen} onStructures={toggleStructures} />

      <footer className="studio-footer">
        <span className="hint">{touch ? 'Drag to rotate · Pinch to zoom · Tap to inspect' : 'Drag to rotate · Scroll to zoom · Click to inspect'}</span>
        <button type="button" className="link" onClick={() => setAbout(true)}>Source &amp; credits</button>
      </footer>

      {about && <AboutSheet onClose={closeAbout} />}
    </div>
  );
}

export default function App() {
  const result = validateDefinition(skinDefinition);
  if (!result.ok) {
    // A broken definition must be visible, not silently half-rendered.
    return (
      <div className="fatal" role="alert">
        <h1>This simulation definition is invalid</h1>
        <ul>{result.issues.map((i) => <li key={`${i.path}-${i.code}`}><code>{i.path}</code>: {i.message}</li>)}</ul>
      </div>
    );
  }
  return (
    <LabProvider def={result.definition}>
      <Lab />
    </LabProvider>
  );
}
