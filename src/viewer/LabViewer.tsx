import { Component, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, useProgress } from '@react-three/drei';
import * as THREE from 'three';
import { useLab } from '../app/LabContext';
import { isTouch } from '../app/layout';
import { SkinModel, MODEL_URL } from './SkinModel';
import { CameraRig, type ViewInsets } from './CameraRig';
import { Lighting } from './Lighting';
import { LabelLayer } from './LabelLayer';
import { hasWebGL, prefersReducedMotion } from './webgl';
import { homeBounds } from '../skin/anchors';
import { effectiveBodyColour, effectiveMode, effectiveSim, effectiveView } from '../app/state';
import { BodyLegend, ThermalLegend } from './BodyLegend';
import { BodyThermalScene, BurnScene, ReceptorLabels, SimEffects, SweatScene, TwoPointScene, WoundScene } from './ModeScenes';
import { thermoLive } from '../app/live';

/** With reduced motion (or paused) the canvas renders on demand: redraw when the heat balance changes. */
function InvalidateOnThermo() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => thermoLive.subscribe(() => invalidate()), [invalidate]);
  return null;
}

/** A short note over the model saying what the simulation draws and what is exaggerated. */
function simBadge(mode: string, view: string, sim: ReturnType<typeof effectiveSim>): string | null {
  if (mode === 'temperature') return view === 'body' ? 'Skin temperature (thermal colours) · hands and feet cool when vessels constrict' : 'Vessels, sweat and goosebumps follow the heat balance · drops drawn larger';
  if (mode === 'wounds') return sim.woundView === 'healing' ? 'Wound on the front face · cells drawn about 4× larger' : view === 'body' ? 'Tap regions (or palm-sized patches) to map the burn' : 'Click a layer to set the burn depth';
  if (mode === 'touch') return view === 'body' ? (sim.touchView === 'two-point' ? 'Tap a site; the two dots are at true spacing' : 'Tap the body to name its dermatome') : 'Receptors glow with their firing (slowed down)';
  if (mode === 'life') return sim.lifeView === 'age' ? `Skin at ${Math.round(sim.age)} years · front face of the block` : null;
  return null;
}

class SceneBoundary extends Component<{ onError: (e: Error) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function LoadingOverlay() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="viewer-status" role="status">
      <div className="spinner" aria-hidden="true" />
      Loading the skin… {Math.round(progress)}%
    </div>
  );
}

/** Keyboard camera control: arrows orbit, +/- zoom. Esc and 0 are handled by the lab shell. */
function KeyboardOrbit({ host }: { host: React.RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const el = host.current;
    if (!el || !controls) return;
    const onKey = (e: KeyboardEvent) => {
      const step = Math.PI / 18;
      const offset = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      if (e.key === 'ArrowLeft') sph.theta -= step;
      else if (e.key === 'ArrowRight') sph.theta += step;
      else if (e.key === 'ArrowUp') sph.phi = Math.max(0.05, sph.phi - step);
      else if (e.key === 'ArrowDown') sph.phi = Math.min(Math.PI - 0.05, sph.phi + step);
      else if (e.key === '+' || e.key === '=') sph.radius *= 0.85;
      else if (e.key === '-' || e.key === '_') sph.radius /= 0.85;
      else return;
      e.preventDefault();
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      camera.lookAt(controls.target);
      controls.update();
      invalidate();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [host, camera, controls, invalidate]);
  return null;
}

const NO_INSETS: ViewInsets = { left: 0, right: 0, top: 0, bottom: 0 };

export function LabViewer({ insets = NO_INSETS }: { insets?: ViewInsets }) {
  const { def, state, dispatch } = useLab();
  const [webgl] = useState(hasWebGL);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const view = effectiveView(def, state);
  const bodyColour = effectiveBodyColour(def, state);
  const mode = effectiveMode(def, state);
  const sim = effectiveSim(def, state);
  // Temperature runs continuously; touch receptors pulse; the rest renders on demand.
  const moving = mode === 'temperature' || (mode === 'touch' && ['receptors', 'vibration', 'pressure', 'thermal'].includes(sim.touchView));
  const animating = !reducedMotion && state.playing && moving;
  const badge = simBadge(mode, view, sim);

  if (!webgl) {
    return (
      <div className="viewer viewer-fallback" role="note">
        <h2>3D view unavailable</h2>
        <p>This browser or device could not start WebGL, which the 3D model needs. You can still use the structure list, search, explanations, the guided tour and the simulation panels.</p>
        <p className="muted">To get the 3D view, turn on hardware acceleration in your browser settings or try another browser.</p>
      </div>
    );
  }

  const [lo, hi] = homeBounds(def, view);
  const radius = new THREE.Vector3(...lo).distanceTo(new THREE.Vector3(...hi)) / 2;
  const modelRadius = Math.max(radius, 0.03);

  return (
    <div
      className="viewer"
      ref={host}
      tabIndex={0}
      data-ready={ready && !error ? 'true' : 'false'}
      data-view={view}
      aria-label={view === 'block' ? '3D block of human skin, thin skin on the left and thick skin on the right, down to the deep fascia. Drag to rotate, scroll or pinch to zoom, right-drag to pan. Arrow keys rotate, plus and minus zoom.' : '3D model of the whole body surface. Click a region to open the skin block. Drag to rotate, scroll or pinch to zoom.'}
    >
      {error ? (
        <div className="viewer-status is-error" role="alert">
          <strong>The 3D model could not be loaded.</strong>
          <span className="muted">{error}</span>
          <button
            type="button"
            onClick={() => {
              // The loader caches a failed request; drop it so the retry really fetches again.
              useGLTF.clear(MODEL_URL);
              setError(null);
              setReady(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <SceneBoundary key={attempt} onError={(e) => setError(e.message || 'Unknown error')}>
          <Canvas
            frameloop={animating ? 'always' : 'demand'}
            // Phones and tablets: a lower pixel ratio keeps the frame rate up on small GPUs.
            dpr={isTouch() ? [1, 1.5] : [1, 2]}
            camera={{ fov: 32, near: 0.0005, far: 60, position: [radius * 4, radius * 3, radius * 5] }}
            gl={{ antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' }}
            onPointerMissed={(e) => {
              if (e.type !== 'click') return;
              dispatch({ type: 'hover', id: null });
              // On a touch screen there is no Esc key: a tap on empty space closes the details.
              if (isTouch() && state.selected && state.mode !== 'tour') dispatch({ type: 'select', id: state.selected });
            }}
            onCreated={({ gl }) => {
              gl.localClippingEnabled = true;
              gl.domElement.addEventListener('webglcontextlost', (ev) => {
                ev.preventDefault();
                setError('The graphics context was lost (the GPU may have been reset).');
              });
            }}
            aria-hidden="true"
          >
            <Lighting />
            <Suspense fallback={null}>
              <SkinModel onReady={onReady} />
              <SimEffects reducedMotion={reducedMotion} />
              {mode === 'temperature' && view === 'block' && <SweatScene />}
              {mode === 'temperature' && view === 'body' && <BodyThermalScene />}
              {mode === 'temperature' && !animating && <InvalidateOnThermo />}
              {mode === 'wounds' && view === 'block' && sim.woundView === 'healing' && <WoundScene sim={sim} labels={labels} />}
              {mode === 'wounds' && view === 'block' && sim.woundView === 'burns' && <BurnScene sim={sim} labels={labels} />}
              {mode === 'touch' && view === 'body' && sim.touchView === 'two-point' && <TwoPointScene sim={sim} labels={labels} />}
              {mode === 'touch' && view === 'block' && <ReceptorLabels sim={sim} labels={labels} />}
            </Suspense>
            <OrbitControls
              makeDefault
              enableDamping={!reducedMotion}
              dampingFactor={0.12}
              minDistance={view === 'body' ? 0.15 : 0.003}
              maxDistance={modelRadius * 8}
              zoomToCursor
              rotateSpeed={0.8}
              autoRotate={false}
              autoRotateSpeed={1.2}
            />
            <CameraRig reducedMotion={reducedMotion} insets={insets} />
            <KeyboardOrbit host={host} />
            <LabelLayer container={labels} />
          </Canvas>
          <LoadingOverlay />
        </SceneBoundary>
      )}
      <div className="label-layer" ref={labels} />
      {!error && view === 'block' && <p className="viewer-badge" aria-hidden="true">{badge ?? 'True scale: 1 mm of skin = 1 cm here · thin skin left, thick skin right'}</p>}
      {!error && view === 'body' && mode === 'temperature' && <ThermalLegend />}
      {!error && view === 'body' && mode !== 'temperature' && (badge ? <p className="viewer-badge" aria-hidden="true">{badge}</p> : <BodyLegend colour={bodyColour} />)}

    </div>
  );
}
