import { useEffect, useReducer, useRef } from 'react';
import { thermoLive } from './live';
import { thermoBody, thermoEnvironment, type Sim } from './sim';

/**
 * Runs the heat balance in real time while the Temperature mode is open. A new preset or a restart
 * starts again from thermoneutral; other changes of conditions carry on from the current state.
 */
export function useThermoDriver(active: boolean, playing: boolean, sim: Sim) {
  const env = thermoEnvironment(sim);
  const body = thermoBody(sim);
  const key = JSON.stringify([env, body]);
  useEffect(() => { thermoLive.setConditions(env, body); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = useRef<{ preset: string; run: number } | null>(null);
  useEffect(() => {
    if (!active) { last.current = null; return; }
    const prev = last.current;
    if (!prev || prev.run !== sim.thermoRun || (sim.tempPreset !== 'custom' && prev.preset !== sim.tempPreset)) thermoLive.reset();
    last.current = { preset: sim.tempPreset, run: sim.thermoRun };
  }, [active, sim.tempPreset, sim.thermoRun]);
  const speed = useRef(sim.speed);
  speed.current = sim.speed;
  useEffect(() => {
    if (!active || !playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      thermoLive.step((now - last) / 1000, speed.current);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, playing]);
}

/** Re-render a panel when the heat balance changes, at most `hz` times a second. */
export function useThermoLive(hz = 8) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let last = 0, timer = 0;
    const off = thermoLive.subscribe(() => {
      const now = performance.now();
      if (now - last >= 1000 / hz) { last = now; bump(); }
      else if (!timer) timer = window.setTimeout(() => { timer = 0; last = performance.now(); bump(); }, 1000 / hz);
    });
    return () => { off(); window.clearTimeout(timer); };
  }, [hz]);
  return thermoLive;
}
