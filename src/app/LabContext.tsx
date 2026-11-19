import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import type { SimulationDefinition } from '../contract/schema';
import { initialState, makeReducer, type LabAction, type LabState } from './state';

interface LabContextValue {
  def: SimulationDefinition;
  state: LabState;
  dispatch: Dispatch<LabAction>;
}

const Ctx = createContext<LabContextValue | null>(null);

export function LabProvider({ def, children }: { def: SimulationDefinition; children: ReactNode }) {
  const reducer = useMemo(() => makeReducer(def), [def]);
  const [state, dispatch] = useReducer(reducer, def, initialState);
  const value = useMemo(() => ({ def, state, dispatch }), [def, state]);
  // Dev server only: lets screenshot scripts drive the lab (window.__lab.dispatch({ type: … })).
  if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __lab?: unknown }).__lab = { dispatch, state };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLab(): LabContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLab must be used inside <LabProvider>');
  return v;
}
