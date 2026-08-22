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
  applyMove,
  asNodeId,
  bindAnnouncer,
  type NavDirection,
  type NavIntent,
  type NodeId,
  navigableLeaves,
  resolveMove,
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

  const lastFocused = useRef<NodeId | null>(null);
  const caretOurs = useRef(false);
  const [presentSeq, setPresentSeq] = useState(0);

  // Whether the caret belongs to this layout, tracked across the gesture
  // rather than sampled when the store notifies. A drag tears the wrapper out
  // to show it in the ghost, so by drop time the caret is already on `body`
  // and a live check would say the layout never had it.
  //
  // What separates "the DOM changed under the caret" from "the user aimed
  // somewhere else" is a pointerdown, not the focus event: Chromium and
  // Firefox both report the torn-out element as still connected, and WebKit
  // fires no focusout at all.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const aimedOutside = { current: false };
    const onPointerDown = (e: Event) => {
      const t = e.target as Node | null;
      aimedOutside.current = !t || !el.contains(t);
    };
    const onIn = () => {
      caretOurs.current = true;
      aimedOutside.current = false;
    };
    const onOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next) {
        caretOurs.current = el.contains(next);
        return;
      }
      if (aimedOutside.current) caretOurs.current = false;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('focusin', onIn);
    el.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('focusin', onIn);
      el.removeEventListener('focusout', onOut);
    };
  }, []);

  useEffect(() => {
    // Seeded here, not at declaration, so swapping the store does not read as
    // a focus change and pull the caret in.
    lastFocused.current = store.focusedId;
    return store.subscribe(() => {
      const id = store.focusedId;
      const changed = id !== lastFocused.current;
      lastFocused.current = id;
      // An explicit focus move commands the caret. Any other store change may
      // only put back a caret the layout already had — a host that focused
      // something of its own keeps it.
      if (!changed && !caretOurs.current) return;
      adapter.present(id);
      if (caretOurs.current) setPresentSeq((n) => n + 1);
    });
  }, [store, adapter]);

  // A moved or replaced node remounts after React commits, not when the store
  // notifies, so the present above can run against a wrapper that is not there
  // yet. Presenting again post-commit is what restores the caret; `present`
  // no-ops when it is already in the right place.
  useEffect(() => {
    if (presentSeq === 0) return;
    adapter.present(store.focusedId);
  }, [presentSeq, store, adapter]);

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

      const arrow: NavDirection | null =
        e.key === 'ArrowLeft'
          ? 'left'
          : e.key === 'ArrowRight'
            ? 'right'
            : e.key === 'ArrowUp'
              ? 'up'
              : e.key === 'ArrowDown'
                ? 'down'
                : null;

      // Shift+arrow rearranges instead of navigating: the pane takes the slot
      // the same arrow would have moved the caret to, in its own parent or in
      // whichever container that node lives in.
      if (onWrapper && arrow && e.shiftKey) {
        const plan = resolveMove({ store, from, direction: arrow, geometry, strategies });
        if (!plan) return;
        e.preventDefault();
        applyMove(store, plan);
        return;
      }

      let intent: NavIntent | null = null;
      if (e.key === 'F6') {
        intent = e.shiftKey ? 'cyclePrev' : 'cycleNext';
      } else if (onWrapper) {
        if (arrow) intent = arrow;
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
