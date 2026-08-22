import { createContext, type ReactNode, useContext, useRef } from 'react';
import type { LayoutStrategy, StrategyRegistry } from '../index.js';

export type { StrategyRegistry };

const StrategyRegistryContext = createContext<StrategyRegistry | null>(null);

export interface StrategyRegistryProviderProps {
  strategies: Record<string, LayoutStrategy<unknown, string, unknown>>;
  children: ReactNode;
}

function sameEntries(
  registry: StrategyRegistry,
  strategies: Record<string, LayoutStrategy<unknown, string, unknown>>,
): boolean {
  const keys = Object.keys(strategies);
  if (keys.length !== registry.size) return false;
  return keys.every((k) => registry.get(k) === strategies[k]);
}

/** @group Components */
export function StrategyRegistryProvider({ strategies, children }: StrategyRegistryProviderProps) {
  // Compared by entry, not by object identity: every documented call site
  // passes a literal, so identity changes on every render — which rebuilds
  // every ContainerHost below, dropping its layout cache and re-running its
  // subscriptions while rendering correctly the whole time.
  const ref = useRef<StrategyRegistry | null>(null);
  if (ref.current === null || !sameEntries(ref.current, strategies)) {
    ref.current = new Map(Object.entries(strategies));
  }
  const registry = ref.current;
  return (
    <StrategyRegistryContext.Provider value={registry}>{children}</StrategyRegistryContext.Provider>
  );
}

/** @group Hooks */
export function useStrategyRegistry(): StrategyRegistry {
  const r = useContext(StrategyRegistryContext);
  if (!r) {
    throw new Error('useStrategyRegistry must be used inside <StrategyRegistryProvider>');
  }
  return r;
}

/** Variant for components that can function without a registry (e.g. drag
 *  scaffolding that only uses it to enrich `canAccept` checks).
 *
 *  @group Hooks
 */
export function useOptionalStrategyRegistry(): StrategyRegistry | null {
  return useContext(StrategyRegistryContext);
}
