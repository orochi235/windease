import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  asNodeId,
  bindAnnouncer,
  type NavIntent,
  type NodeId,
  navigableLeaves,
  resolveNavigation,
} from '../../index.js';
import { useStore } from '../Provider.js';
import { useStrategyRegistry } from '../strategies.js';
import { createDomFocusAdapter } from './domFocusAdapter.js';
import { useGeometryRegistry, useGeometrySource } from './useGeometrySource.js';

interface FocusBinding {
  /** True while the adapter is writing DOM focus from model focus; the
   *  `focusin` this causes must be ignored or the two directions oscillate. */
  applying: { current: boolean };
  /**
   * Who carries `tabIndex 0` while nothing is model-focused. Without it every
   * wrapper is -1 and the layout has no tab stop at all, so a keyboard user
   * who has not clicked cannot enter it.
   */
  entryId: NodeId | null;
}

const FocusBindingContext = createContext<FocusBinding | null>(null);

export function useFocusBinding(): FocusBinding | null {
  return useContext(FocusBindingContext);
}

export interface FocusProviderProps {
  children: ReactNode;
  /**
   * Speak structural changes that move no focus — the focused pane closing,
   * or being relocated — through a polite live region. On by default; turn it
   * off for a host that owns its own live region.
   */
  announce?: boolean;
}

export function FocusProvider({ children, announce = true }: FocusProviderProps) {
  const store = useStore();
  const applying = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [entryId, setEntryId] = useState<NodeId | null>(null);
  const [spoken, setSpoken] = useState<{ text: string; seq: number } | null>(null);
  const binding = useMemo<FocusBinding>(() => ({ applying, entryId }), [entryId]);

  const adapter = useMemo(
    () =>
      createDomFocusAdapter({
        root: rootRef,
        applying,
        speak: (text) => setSpoken((prev) => ({ text, seq: (prev?.seq ?? 0) + 1 })),
      }),
    [],
  );

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
      if (!store.canFocus(id)) return;
      store.focusNode(id);
    };
    el.addEventListener('focusin', onFocusIn);
    return () => el.removeEventListener('focusin', onFocusIn);
  }, [store]);

  useEffect(() => {
    return store.subscribe(() => adapter.present(store.focusedId));
  }, [store, adapter]);

  useEffect(() => {
    if (!announce) return;
    return bindAnnouncer(store, adapter);
  }, [store, adapter, announce]);

  const geometry = useGeometrySource();
  const registry = useGeometryRegistry();
  const strategies = useStrategyRegistry();

  useEffect(() => {
    const recompute = () => {
      setEntryId(store.focusedId ? null : (navigableLeaves(store, geometry)[0] ?? null));
    };
    recompute();
    const offStore = store.subscribe(recompute);
    const offGeometry = registry?.subscribe(recompute);
    return () => {
      offStore();
      offGeometry?.();
    };
  }, [store, geometry, registry]);

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
        {announce ? (
          <div className="windease-live-region" aria-live="polite" aria-atomic="true">
            {/* Keyed so an identical message replaces the node rather than
                re-rendering it — a screen reader ignores an unchanged region. */}
            {spoken ? <span key={spoken.seq}>{spoken.text}</span> : null}
          </div>
        ) : null}
      </div>
    </FocusBindingContext.Provider>
  );
}
