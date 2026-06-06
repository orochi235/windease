import type { LayoutStrategy } from '@windease/core';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

export type StrategyRegistry = ReadonlyMap<string, LayoutStrategy<unknown, string, unknown>>;

const StrategyRegistryContext = createContext<StrategyRegistry | null>(null);

export interface StrategyRegistryProviderProps {
  strategies: Record<string, LayoutStrategy<unknown, string, unknown>>;
  children: ReactNode;
}

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

export function useStrategyRegistry(): StrategyRegistry {
  const r = useContext(StrategyRegistryContext);
  if (!r) {
    throw new Error('useStrategyRegistry must be used inside <StrategyRegistryProvider>');
  }
  return r;
}
