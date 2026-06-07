import type { LayoutStrategy } from '../index.js';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

export type StrategyRegistry = ReadonlyMap<string, LayoutStrategy<unknown, string, unknown>>;

const StrategyRegistryContext = createContext<StrategyRegistry | null>(null);

export interface StrategyRegistryProviderProps {
  strategies: Record<string, LayoutStrategy<unknown, string, unknown>>;
  children: ReactNode;
}

/** @group Components */
export function StrategyRegistryProvider({
  strategies,
  children,
}: StrategyRegistryProviderProps) {
  const registry = useMemo(
    () => new Map(Object.entries(strategies)),
    [strategies],
  );
  return (
    <StrategyRegistryContext.Provider value={registry}>
      {children}
    </StrategyRegistryContext.Provider>
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
