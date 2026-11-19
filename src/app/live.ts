/**
 * Values that change every frame, shared by the 3D scene and the panels without going through React
 * state: the running two-node heat balance of the Temperature mode. The science is in
 * src/skin/thermo.ts; this only integrates it in time (simulated minutes per real second).
 */
import { NEUTRAL_STATE, heatBalance, thermoStep, type BodyParams, type Environment, type HeatBalance, type ThermoState } from '../skin/thermo';

/** Minutes of history kept for the chart. */
export const HISTORY_MIN = 240;

export class ThermoLive {
  /** Simulated time, minutes. */
  tMin = 0;
  state: ThermoState = { ...NEUTRAL_STATE };
  balance: HeatBalance;
  /** One sample per simulated minute: [t, core, skin]. */
  history: [number, number, number][] = [[0, NEUTRAL_STATE.coreC, NEUTRAL_STATE.skinC]];
  env: Environment = { airTempC: 21, relHumidityPct: 45, windMs: 0.1 };
  body: Partial<BodyParams> = {};
  private listeners = new Set<() => void>();
  version = 0;

  constructor() { this.balance = heatBalance(this.state, this.env, this.body); }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private notify() { this.version++; this.listeners.forEach((f) => f()); }

  /** New conditions; the body carries on from where it is. */
  setConditions(env: Environment, body: Partial<BodyParams>) {
    this.env = env; this.body = body;
    this.balance = heatBalance(this.state, env, body);
    this.notify();
  }

  /** Start again from thermoneutral at time 0. */
  reset() {
    this.tMin = 0;
    this.state = { ...NEUTRAL_STATE };
    this.history = [[0, this.state.coreC, this.state.skinC]];
    this.balance = heatBalance(this.state, this.env, this.body);
    this.notify();
  }

  /** Advance by `dtReal` seconds of real time at `speed` simulated minutes per second. */
  step(dtReal: number, speed: number) {
    const dt = Math.min(0.1, Math.max(0, dtReal));
    if (dt === 0) return;
    const simS = dt * speed * 60;
    this.state = thermoStep(this.state, this.env, simS, this.body);
    // Keep the numbers physical even in extreme settings.
    this.state = { coreC: Math.min(46, Math.max(20, this.state.coreC)), skinC: Math.min(48, Math.max(0, this.state.skinC)) };
    const before = Math.floor(this.tMin);
    this.tMin += simS / 60;
    for (let m = before + 1; m <= Math.floor(this.tMin); m++) this.history.push([m, this.state.coreC, this.state.skinC]);
    while (this.history.length > HISTORY_MIN + 1) this.history.shift();
    this.balance = heatBalance(this.state, this.env, this.body);
    this.notify();
  }
}

export const thermoLive = new ThermoLive();
