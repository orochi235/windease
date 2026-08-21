import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from 'react';
import { asNodeId, type NavIntent, type NodeId, resolveNavigation } from '../../index.js';
import { useStore } from '../Provider.js';
import { useStrategyRegistry } from '../strategies.js';
import { useGeometrySource } from './useGeometrySource.js';

interface FocusBinding {
  /** True while the adapter is writing DOM focus from model focus; the
   *  `focusin` this causes must be ignored or the two directions oscillate. */
  applying: { current: boolean };
}

const FocusBindingContext = createContext<FocusBinding | null>(null);

export function useFocusBinding(): FocusBinding | null {
  return useContext(FocusBindingContext);
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const applying = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const binding = useMemo<FocusBinding>(() => ({ applying }), []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onFocusIn = (e: FocusEvent) => {
      if (applying.current) return;
      const target = e.target as Element | null;
      const wrapper = target?.closest('[data-node]');
      const raw = wrapper?.getAttribute('data-node');
      if (!raw) return;
      const id = asNodeId(raw) as NodeId;
      if (store.focusedId === id) return;
      if (!store.hasFocus(id)) return;
      store.focusNode(id);
    };
    el.addEventListener('focusin', onFocusIn);
    return () => el.removeEventListener('focusin', onFocusIn);
  }, [store]);

  useEffect(() => {
    return store.subscribe(() => {
      const el = rootRef.current;
      const id = store.focusedId;
      if (!el || !id) return;
      const wrapper = el.querySelector(`[data-node="${CSS.escape(String(id))}"]`);
      if (!(wrapper instanceof HTMLElement)) return;
      if (document.activeElement === wrapper || wrapper.contains(document.activeElement)) return;
      applying.current = true;
      try {
        wrapper.focus();
      } finally {
        applying.current = false;
      }
    });
  }, [store]);

  const geometry = useGeometrySource();
  const strategies = useStrategyRegistry();

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const from = store.focusedId;
      if (!from) return;
      const target = e.target as Element | null;
      const onWrapper = target instanceof HTMLElement && target.hasAttribute('data-node');

      let intent: NavIntent | null = null;
      if (e.key === 'F6') {
        intent = e.shiftKey ? 'cyclePrev' : 'cycleNext';
      } else if (onWrapper) {
        if (e.key === 'ArrowLeft') intent = 'left';
        else if (e.key === 'ArrowRight') intent = 'right';
        else if (e.key === 'ArrowUp') intent = 'up';
        else if (e.key === 'ArrowDown') intent = 'down';
        else if (e.key === 'Home') intent = 'first';
        else if (e.key === 'End') intent = 'last';
      }
      if (!intent) return;

      const to = resolveNavigation({ store, from, intent, geometry, strategies });
      if (!to) return;
      e.preventDefault();
      store.focusNode(to);
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [store, geometry, strategies]);

  return (
    <FocusBindingContext.Provider value={binding}>
      <div ref={rootRef} className="windease-focus-root">
        {children}
      </div>
    </FocusBindingContext.Provider>
  );
}
